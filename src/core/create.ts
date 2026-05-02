import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import {
	type ConventionsProjectLanguage,
	inferConventionsConfig,
} from "./infer.ts";
import { pathExists } from "./path.ts";

export type ConventionsPreset =
	| "rust"
	| "typescript"
	| "go"
	| "python"
	| "documentation";
export type ConventionsCreateTarget = ConventionsPreset | "fallback";

export interface ScaffoldConventionsResult {
	kind: "generated" | "preset" | "fallback";
	language?: ConventionsProjectLanguage;
	preset?: ConventionsCreateTarget;
	targetDir: string;
	projectRoot?: string;
}

const PACKAGE_ROOT = path.resolve(
	fileURLToPath(new URL("../../", import.meta.url)),
);
const SCHEMA_SOURCE_PATH = path.join(
	PACKAGE_ROOT,
	"schemas",
	"conventions.schema.json",
);
const PRESET_SOURCE_PATHS: Record<ConventionsCreateTarget, string> = {
	rust: path.join(PACKAGE_ROOT, "examples", "conventions.rust.json"),
	typescript: path.join(
		PACKAGE_ROOT,
		"examples",
		"conventions.typescript.json",
	),
	go: path.join(PACKAGE_ROOT, "examples", "conventions.go.json"),
	python: path.join(PACKAGE_ROOT, "examples", "conventions.python.json"),
	documentation: path.join(
		PACKAGE_ROOT,
		"examples",
		"conventions.documentation.json",
	),
	fallback: path.join(PACKAGE_ROOT, "examples", "conventions.fallback.json"),
};
const TARGET_ALIASES: Record<string, ConventionsCreateTarget> = {
	rust: "rust",
	rs: "rust",
	typescript: "typescript",
	ts: "typescript",
	go: "go",
	golang: "go",
	python: "python",
	py: "python",
	documentation: "documentation",
	docs: "documentation",
	doc: "documentation",
	fallback: "fallback",
	global: "fallback",
};
const LANGUAGE_LABELS: Record<ConventionsProjectLanguage, string> = {
	rust: "Rust",
	typescript: "TypeScript",
	go: "Go",
	python: "Python",
};

export function getConventionsCommandArgumentCompletions(prefix: string) {
	const options = [
		"status",
		"reload",
		"audit",
		"audit --include-ignored",
		"check",
		"create",
		"create rust",
		"create rs",
		"create typescript",
		"create ts",
		"create go",
		"create golang",
		"create python",
		"create py",
		"create documentation",
		"create docs",
		"create fallback",
		"create global",
	];
	const normalized = prefix.trim().toLowerCase();
	const matches = options
		.filter((option) => option.startsWith(normalized))
		.map((option) => ({ value: option, label: option }));
	return matches.length > 0 ? matches : null;
}

export function parseCreateTargetAlias(
	value: string | undefined,
): ConventionsCreateTarget | undefined {
	if (!value) return undefined;
	return TARGET_ALIASES[value.toLowerCase()];
}

export async function scaffoldConventions(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	explicitTarget?: ConventionsCreateTarget,
): Promise<ScaffoldConventionsResult> {
	if (explicitTarget === "fallback") {
		const targetDir = path.join(homedir(), ".pi", "agent");
		await scaffoldFromPreset(ctx, targetDir, "fallback");
		return { kind: "fallback", preset: "fallback", targetDir };
	}

	const projectRoot = await resolveProjectRoot(pi, ctx.cwd);
	const targetDir = path.join(projectRoot, ".pi");

	if (explicitTarget) {
		await scaffoldFromPreset(ctx, targetDir, explicitTarget);
		return { kind: "preset", preset: explicitTarget, targetDir, projectRoot };
	}

	const inferred = await inferConventionsConfig(projectRoot);
	const configDocument = {
		$schema: "./conventions.schema.json",
		...inferred.config,
	};
	await scaffoldFromGeneratedConfig(ctx, targetDir, configDocument);
	return {
		kind: "generated",
		language: inferred.language,
		targetDir,
		projectRoot,
	};
}

export function describeScaffoldResult(
	result: ScaffoldConventionsResult,
): string {
	if (result.kind === "fallback") {
		return `Created global fallback conventions in ${result.targetDir}`;
	}
	if (result.kind === "preset") {
		return `Created project conventions in ${result.targetDir} using the ${result.preset} example`;
	}
	return `Created project conventions in ${result.targetDir} from repo inspection (${LANGUAGE_LABELS[result.language!]})`;
}

async function scaffoldFromPreset(
	ctx: ExtensionCommandContext,
	targetDir: string,
	preset: ConventionsCreateTarget,
): Promise<void> {
	const targetConfigPath = path.join(targetDir, "conventions.json");
	const targetSchemaPath = path.join(targetDir, "conventions.schema.json");
	await confirmOverwriteIfNeeded(ctx, targetDir, [
		targetConfigPath,
		targetSchemaPath,
	]);
	await mkdir(targetDir, { recursive: true });
	await copyFile(PRESET_SOURCE_PATHS[preset], targetConfigPath);
	await copyFile(SCHEMA_SOURCE_PATH, targetSchemaPath);
}

async function scaffoldFromGeneratedConfig(
	ctx: ExtensionCommandContext,
	targetDir: string,
	configDocument: object,
): Promise<void> {
	const targetConfigPath = path.join(targetDir, "conventions.json");
	const targetSchemaPath = path.join(targetDir, "conventions.schema.json");
	await confirmOverwriteIfNeeded(ctx, targetDir, [
		targetConfigPath,
		targetSchemaPath,
	]);
	await mkdir(targetDir, { recursive: true });
	await writeFile(
		targetConfigPath,
		`${JSON.stringify(configDocument, null, 2)}\n`,
		"utf8",
	);
	await copyFile(SCHEMA_SOURCE_PATH, targetSchemaPath);
}

async function confirmOverwriteIfNeeded(
	ctx: ExtensionCommandContext,
	targetDir: string,
	targetPaths: string[],
): Promise<void> {
	const existingPaths: string[] = [];
	for (const targetPath of targetPaths) {
		if (await pathExists(targetPath)) {
			existingPaths.push(targetPath);
		}
	}

	if (existingPaths.length === 0) {
		return;
	}

	if (!ctx.hasUI) {
		throw new Error(
			`Refusing to overwrite existing conventions files in ${targetDir} without UI confirmation.`,
		);
	}

	const ok = await ctx.ui.confirm(
		"Conventions Guard",
		`Overwrite existing conventions files in ${targetDir}?\n\nThis will replace:\n${existingPaths.map((p) => `- ${p}`).join("\n")}`,
	);
	if (!ok) {
		throw new Error("Cancelled by user.");
	}
}

async function resolveProjectRoot(
	pi: ExtensionAPI,
	cwd: string,
): Promise<string> {
	const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
		cwd,
	});
	if (result.code === 0) {
		const root = result.stdout.trim();
		if (root.length > 0) {
			return root;
		}
	}
	return cwd;
}
