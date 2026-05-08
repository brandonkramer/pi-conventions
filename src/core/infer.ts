/** @fileoverview Infers conventions from repository structure and files. */
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { RawConventionsConfig } from "./types.ts";
import { pathExists } from "./path.ts";
import type { NamingCaseStyle } from "../policies/naming.ts";

export type ConventionsProjectLanguage =
	| "rust"
	| "typescript"
	| "go"
	| "python";

interface RepoFile {
	path: string;
	extension: string;
	family: ConventionsProjectLanguage;
	stem: string;
}

interface RepoInventory {
	files: RepoFile[];
	directories: string[];
}

export interface InferredConventionsConfig {
	config: RawConventionsConfig;
	language: ConventionsProjectLanguage;
	sourceRoots: string[];
}

const EXCLUDED_DIR_NAMES = new Set([
	".git",
	".pi",
	".semantic-index",
	"node_modules",
	"dist",
	"build",
	"target",
	"coverage",
	"vendor",
	".next",
	".turbo",
	".venv",
	"venv",
	"__pycache__",
]);
const FORBIDDEN_SEGMENTS = ["utils", "helpers", "common", "misc"];
const FILE_FORBIDDEN_NAMES = [
	"util",
	"utils",
	"helper",
	"helpers",
	"common",
	"misc",
];
const DIRECTORY_FORBIDDEN_NAMES = ["utils", "helpers", "common", "misc"];
const LANGUAGE_LABELS: Record<ConventionsProjectLanguage, string> = {
	rust: "Rust",
	typescript: "TypeScript",
	go: "Go",
	python: "Python",
};
const LANGUAGE_EXTENSIONS: Record<ConventionsProjectLanguage, string[]> = {
	rust: ["rs"],
	typescript: ["ts", "tsx", "mts", "cts", "d.ts"],
	go: ["go"],
	python: ["py"],
};
const DEFAULT_CASE_STYLE: Record<ConventionsProjectLanguage, NamingCaseStyle> =
	{
		rust: "snake_case",
		typescript: "kebab-case",
		go: "snake_case",
		python: "snake_case",
	};
const ROOT_CANDIDATES: Record<ConventionsProjectLanguage, string[]> = {
	rust: ["src"],
	typescript: ["src", "app", "lib", "tests"],
	go: ["internal", "pkg", "cmd"],
	python: ["src", "tests", "test"],
};
const MAX_SCAN_DEPTH = 6;
const MAX_SCANNED_FILES = 4000;

export async function inferConventionsConfig(
	projectRoot: string,
): Promise<InferredConventionsConfig> {
	const inventory = await collectRepoInventory(projectRoot);
	const language = await detectProjectLanguage(projectRoot, inventory);
	if (!language) {
		throw new Error(
			"Could not infer project conventions automatically. Use `/conventions create rust|typescript|go|python|fallback` instead.",
		);
	}

	const sourceRoots = detectSourceRoots(language, inventory);
	if (sourceRoots.length === 0) {
		throw new Error(
			`Detected a ${LANGUAGE_LABELS[language]} repo, but could not find a stable source root. Use an explicit create command instead.`,
		);
	}

	const languageFiles = inventory.files.filter(
		(file) =>
			file.family === language &&
			sourceRoots.some((root) => file.path.startsWith(root)),
	);
	const layerPrefixes = buildLayerPrefixes(sourceRoots, language, inventory);
	const usedFileNames = new Set(
		languageFiles.map((file) => file.stem.toLowerCase()),
	);
	const usedDirectoryNames = new Set(
		inventory.directories
			.filter((directory) =>
				sourceRoots.some((root) => `${directory}/`.startsWith(root)),
			)
			.map((directory) => path.posix.basename(directory).toLowerCase()),
	);
	const observedExtensions = [
		...new Set(languageFiles.map((file) => file.extension)),
	];
	const fileRules = buildFileNamingRules(
		language,
		languageFiles,
		sourceRoots,
		usedFileNames,
		observedExtensions,
	);
	const directoryCase =
		detectDominantCaseStyle(
			inventory.directories
				.filter((directory) =>
					sourceRoots.some((root) => `${directory}/`.startsWith(root)),
				)
				.map((directory) => path.posix.basename(directory)),
		) ?? DEFAULT_CASE_STYLE[language];

	return {
		language,
		sourceRoots,
		config: {
			notes: [
				`Generated from repo inspection for a ${LANGUAGE_LABELS[language]} codebase. Review and tighten as the repo evolves.`,
			],
			policies: {
				structure: {
					mode: "block",
					editMode: "warn",
					sourceRoots,
					forbiddenSegments: FORBIDDEN_SEGMENTS,
					layers: layerPrefixes.map((prefix) => ({
						name: path.posix.basename(prefix.slice(0, -1)),
						prefixes: [prefix],
					})),
					legacyZones: buildLegacyZones(sourceRoots, inventory),
					newTopLevelFiles: buildTopLevelFileRule(
						language,
						sourceRoots,
						languageFiles,
						observedExtensions,
					),
				},
				naming: {
					mode: "warn",
					editMode: "warn",
					rules: [
						...fileRules,
						{
							prefixes: sourceRoots,
							pathKinds: ["directory"],
							requireCase: directoryCase,
							forbiddenNames: DIRECTORY_FORBIDDEN_NAMES.filter(
								(name) => !usedDirectoryNames.has(name),
							),
							reason: `Use ${directoryCase} directory names to match the existing repo naming style.`,
						},
					],
				},
			},
		},
	};
}

async function collectRepoInventory(
	projectRoot: string,
): Promise<RepoInventory> {
	const inventory: RepoInventory = { files: [], directories: [] };
	await walk(projectRoot, "", 0, inventory);
	return inventory;
}

async function walk(
	projectRoot: string,
	relativeDir: string,
	depth: number,
	inventory: RepoInventory,
): Promise<void> {
	if (depth > MAX_SCAN_DEPTH || inventory.files.length >= MAX_SCANNED_FILES) {
		return;
	}

	const absoluteDir = path.join(projectRoot, relativeDir);
	const entries = await readdir(absoluteDir, { withFileTypes: true });
	entries.sort((a, b) => a.name.localeCompare(b.name));

	for (const entry of entries) {
		if (inventory.files.length >= MAX_SCANNED_FILES) {
			return;
		}

		const relativePath = relativeDir
			? path.posix.join(relativeDir, entry.name)
			: entry.name;
		if (entry.isDirectory()) {
			if (EXCLUDED_DIR_NAMES.has(entry.name) || entry.name.startsWith(".")) {
				continue;
			}
			inventory.directories.push(relativePath);
			await walk(projectRoot, relativePath, depth + 1, inventory);
			continue;
		}

		if (!entry.isFile()) {
			continue;
		}

		const detected = detectLanguageFile(relativePath);
		if (!detected) {
			continue;
		}

		inventory.files.push(detected);
	}
}

async function detectProjectLanguage(
	projectRoot: string,
	inventory: RepoInventory,
): Promise<ConventionsProjectLanguage | undefined> {
	const scores: Record<ConventionsProjectLanguage, number> = {
		rust: 0,
		typescript: 0,
		go: 0,
		python: 0,
	};

	for (const file of inventory.files) {
		scores[file.family] += 5;
	}

	if (await hasProjectMarker(projectRoot, "Cargo.toml")) {
		scores.rust += 100;
	}
	if (await hasProjectMarker(projectRoot, "go.mod")) {
		scores.go += 100;
	}
	if (
		(await hasProjectMarker(projectRoot, "pyproject.toml")) ||
		(await hasProjectMarker(projectRoot, "setup.py")) ||
		(await hasProjectMarker(projectRoot, "requirements.txt"))
	) {
		scores.python += 100;
	}
	if (
		(await hasProjectMarker(projectRoot, "tsconfig.json")) ||
		(await hasProjectMarker(projectRoot, "tsconfig.base.json"))
	) {
		scores.typescript += 100;
	}
	if (await hasProjectMarker(projectRoot, "package.json")) {
		scores.typescript += 20;
	}

	const ranked = Object.entries(scores)
		.filter(([, score]) => score > 0)
		.sort((a, b) => b[1] - a[1]) as Array<[ConventionsProjectLanguage, number]>;
	return ranked[0]?.[0];
}

async function hasProjectMarker(
	projectRoot: string,
	fileName: string,
): Promise<boolean> {
	return pathExists(path.join(projectRoot, fileName));
}

function detectSourceRoots(
	language: ConventionsProjectLanguage,
	inventory: RepoInventory,
): string[] {
	const preferredRoots = ROOT_CANDIDATES[language]
		.filter((candidate) =>
			containsLanguageFileUnder(candidate, language, inventory),
		)
		.map((candidate) => `${candidate}/`);
	if (preferredRoots.length > 0) {
		return preferredRoots;
	}

	const fallbackRoots = [
		...new Set(
			inventory.files
				.filter((file) => file.family === language)
				.map((file) => file.path.split("/")[0])
				.filter((segment) => segment.length > 0),
		),
	]
		.filter((segment) => !segment.includes("."))
		.map((segment) => `${segment}/`);

	return fallbackRoots;
}

function containsLanguageFileUnder(
	candidate: string,
	language: ConventionsProjectLanguage,
	inventory: RepoInventory,
): boolean {
	const prefix = `${candidate}/`;
	return inventory.files.some(
		(file) => file.family === language && file.path.startsWith(prefix),
	);
}

function buildLayerPrefixes(
	sourceRoots: string[],
	language: ConventionsProjectLanguage,
	inventory: RepoInventory,
): string[] {
	const layers: string[] = [];

	for (const root of sourceRoots) {
		const rootDepth = root.split("/").filter(Boolean).length;
		const children = inventory.directories.filter((directory) => {
			if (!`${directory}/`.startsWith(root)) {
				return false;
			}
			const depth = directory.split("/").filter(Boolean).length;
			if (depth !== rootDepth + 1) {
				return false;
			}
			const basename = path.posix.basename(directory).toLowerCase();
			if (FORBIDDEN_SEGMENTS.includes(basename)) {
				return false;
			}
			return inventory.files.some(
				(file) =>
					file.family === language && file.path.startsWith(`${directory}/`),
			);
		});

		for (const child of children.sort()) {
			layers.push(`${child}/`);
		}
	}

	return [...new Set(layers)].slice(0, 20);
}

function buildLegacyZones(sourceRoots: string[], inventory: RepoInventory) {
	const prefixes = inventory.directories
		.filter((directory) =>
			sourceRoots.some((root) => `${directory}/`.startsWith(root)),
		)
		.filter((directory) =>
			FORBIDDEN_SEGMENTS.includes(path.posix.basename(directory).toLowerCase()),
		)
		.map((directory) => `${directory}/`);

	return [...new Set(prefixes)].map((prefix) => ({
		prefixes: [prefix],
		onCreate: "block" as const,
		onEdit: "warn" as const,
		reason: `Replace catch-all folders like '${path.posix.basename(prefix.slice(0, -1))}' with responsibility-specific modules.`,
	}));
}

function buildTopLevelFileRule(
	language: ConventionsProjectLanguage,
	sourceRoots: string[],
	languageFiles: RepoFile[],
	observedExtensions: string[],
) {
	if (language === "go" || language === "python") {
		return { enabled: false };
	}

	const allowedFiles = [
		...new Set(
			languageFiles
				.filter((file) =>
					sourceRoots.some((root) => isDirectChildOfRoot(file.path, root)),
				)
				.map((file) => file.path),
		),
	];

	return {
		enabled: true,
		mode: "block" as const,
		allowedFiles,
		extensions:
			observedExtensions.length > 0
				? observedExtensions
				: LANGUAGE_EXTENSIONS[language],
	};
}

function buildFileNamingRules(
	language: ConventionsProjectLanguage,
	languageFiles: RepoFile[],
	prefixes: string[],
	usedFileNames: Set<string>,
	observedExtensions: string[],
) {
	const extensions =
		observedExtensions.length > 0
			? observedExtensions
			: LANGUAGE_EXTENSIONS[language];
	const groupedByCase = new Map<NamingCaseStyle, string[]>();

	for (const extension of extensions) {
		const names = languageFiles
			.filter((file) => file.extension === extension)
			.map((file) => file.stem);
		const caseStyle =
			detectDominantCaseStyle(names) ?? DEFAULT_CASE_STYLE[language];
		groupedByCase.set(caseStyle, [
			...(groupedByCase.get(caseStyle) ?? []),
			extension,
		]);
	}

	return [...groupedByCase.entries()].map(([caseStyle, caseExtensions]) => ({
		prefixes,
		pathKinds: ["file"],
		requireCase: caseStyle,
		extensions: caseExtensions,
		forbiddenNames: FILE_FORBIDDEN_NAMES.filter(
			(name) => !usedFileNames.has(name),
		),
		reason: `Use ${caseStyle} file names to match the existing repo naming style.`,
	}));
}

function detectDominantCaseStyle(names: string[]): NamingCaseStyle | undefined {
	const counts = new Map<NamingCaseStyle, number>();

	for (const name of names) {
		const style = classifyCaseStyle(name);
		if (!style) {
			continue;
		}
		counts.set(style, (counts.get(style) ?? 0) + 1);
	}

	return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function classifyCaseStyle(name: string): NamingCaseStyle | undefined {
	if (name.length === 0 || /^[0-9]+$/.test(name)) {
		return undefined;
	}
	if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(name)) {
		return "kebab-case";
	}
	if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(name)) {
		return "snake_case";
	}
	if (/^[A-Z][A-Za-z0-9]*$/.test(name) && !name.includes("_")) {
		return "PascalCase";
	}
	if (/^[a-z][A-Za-z0-9]*$/.test(name) && /[A-Z]/.test(name)) {
		return "camelCase";
	}
	return undefined;
}

function detectLanguageFile(relativePath: string): RepoFile | undefined {
	if (relativePath.endsWith(".d.ts")) {
		return {
			path: relativePath,
			extension: "d.ts",
			family: "typescript",
			stem: relativePath.split("/").pop()!.slice(0, -".d.ts".length),
		};
	}

	const match = /\.([^./]+)$/.exec(relativePath);
	if (!match) {
		return undefined;
	}

	const extension = match[1].toLowerCase();
	const family = detectLanguageFamily(extension);
	if (!family) {
		return undefined;
	}

	const fileName = relativePath.split("/").pop()!;
	return {
		path: relativePath,
		extension,
		family,
		stem: fileName.slice(0, -(extension.length + 1)),
	};
}

function detectLanguageFamily(
	extension: string,
): ConventionsProjectLanguage | undefined {
	if (extension === "rs") return "rust";
	if (["ts", "tsx", "mts", "cts"].includes(extension)) return "typescript";
	if (extension === "go") return "go";
	if (extension === "py") return "python";
	return undefined;
}

function isDirectChildOfRoot(relativePath: string, root: string): boolean {
	if (!relativePath.startsWith(root)) {
		return false;
	}
	const rest = relativePath.slice(root.length);
	return rest.length > 0 && !rest.includes("/");
}
