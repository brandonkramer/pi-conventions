/** @fileoverview Config loading, merging, and normalization for conventions. */
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeDependenciesPolicy } from "../policies/dependencies.ts";
import { normalizeDocumentationPolicy } from "../policies/documentation.ts";
import { normalizeFilesPolicy } from "../policies/files.ts";
import { normalizeNamingPolicy } from "../policies/naming.ts";
import { normalizePackagePolicy } from "../policies/package.ts";
import { normalizeSizePolicy } from "../policies/size.ts";
import { normalizeStructurePolicy } from "../policies/structure.ts";
import { compilePathPatterns } from "./pattern.ts";
import { pathExists } from "./path.ts";
import { uniqueStrings } from "./strings.ts";
import type {
	ConventionsConfig,
	LoadState,
	RawConventionsConfig,
} from "./types.ts";

const PROJECT_CONFIG_RELATIVE_PATH = path.join(".pi", "conventions.json");

export async function findConfigPath(
	startCwd: string,
): Promise<string | undefined> {
	const projectConfigPath = await findProjectConfigPath(startCwd);
	if (projectConfigPath) return projectConfigPath;

	const fallbackPath = globalConfigPath();
	return (await pathExists(fallbackPath)) ? fallbackPath : undefined;
}

export async function loadState(cwd: string): Promise<LoadState> {
	const cwdKey = path.resolve(cwd);
	const projectConfigPath = await findProjectConfigPath(cwdKey);
	if (projectConfigPath) {
		return loadProjectState(cwdKey, projectConfigPath);
	}

	const fallbackPath = globalConfigPath();
	if (!(await pathExists(fallbackPath))) {
		return { cwdKey };
	}

	try {
		const raw = await readConfigJson(fallbackPath);
		return {
			cwdKey,
			config: normalizeConventionsConfig(raw, fallbackPath, [fallbackPath]),
		};
	} catch (error: any) {
		return {
			cwdKey,
			error: `failed to load ${fallbackPath}: ${error.message}`,
		};
	}
}

export function hasActivePolicies(config: ConventionsConfig): boolean {
	return Boolean(
		config.policies.structure ||
			config.policies.naming ||
			config.policies.documentation ||
			config.policies.size ||
			config.policies.dependencies ||
			config.policies.package ||
			config.policies.files,
	);
}

async function findProjectConfigPath(
	startCwd: string,
): Promise<string | undefined> {
	let current = path.resolve(startCwd);

	while (true) {
		const candidatePath = path.join(current, PROJECT_CONFIG_RELATIVE_PATH);
		if (await pathExists(candidatePath)) {
			return candidatePath;
		}

		const parent = path.dirname(current);
		if (parent === current) {
			return undefined;
		}
		current = parent;
	}
}

async function loadProjectState(
	cwdKey: string,
	projectConfigPath: string,
): Promise<LoadState> {
	let projectRaw: unknown;
	try {
		projectRaw = await readConfigJson(projectConfigPath);
	} catch (error: any) {
		return {
			cwdKey,
			error: `failed to load ${projectConfigPath}: ${error.message}`,
		};
	}

	const projectOnly = (warnings?: string[]): LoadState => ({
		cwdKey,
		config: normalizeConventionsConfig(projectRaw, projectConfigPath, [
			projectConfigPath,
		]),
		...(warnings ? { warnings } : {}),
	});

	if (asConventionsConfig(projectRaw)?.extendsGlobal !== true) {
		return projectOnly();
	}

	const fallbackPath = globalConfigPath();
	if (!(await pathExists(fallbackPath))) {
		return projectOnly([
			`extendsGlobal is true, but no global conventions file exists at ${fallbackPath}`,
		]);
	}

	try {
		const globalRaw = await readConfigJson(fallbackPath);
		const mergedRaw = mergeRawConventionsConfig(globalRaw, projectRaw);
		return {
			cwdKey,
			config: normalizeConventionsConfig(mergedRaw, projectConfigPath, [
				projectConfigPath,
				fallbackPath,
			]),
		};
	} catch (error: any) {
		return projectOnly([
			`failed to load global conventions from ${fallbackPath}: ${error.message}`,
		]);
	}
}

async function readConfigJson(configPath: string): Promise<unknown> {
	return JSON.parse(await readFile(configPath, "utf8")) as unknown;
}

function normalizeConventionsConfig(
	raw: unknown,
	configPath: string,
	sourcePaths: string[],
): ConventionsConfig {
	const envelope = asConventionsConfig(raw);
	const ignorePaths = uniqueStrings(envelope?.ignorePaths, (value) => value);
	return {
		path: configPath,
		sourcePaths,
		extendsGlobal: envelope?.extendsGlobal === true,
		ignorePaths,
		ignoreMatchers: compilePathPatterns(ignorePaths),
		notes: uniqueStrings(envelope?.notes, (value) => value),
		policies: {
			structure: normalizeStructurePolicy(envelope?.policies?.structure),
			naming: normalizeNamingPolicy(envelope?.policies?.naming),
			documentation: normalizeDocumentationPolicy(
				envelope?.policies?.documentation,
			),
			size: normalizeSizePolicy(envelope?.policies?.size),
			dependencies: normalizeDependenciesPolicy(
				envelope?.policies?.dependencies,
			),
			package: normalizePackagePolicy(envelope?.policies?.package),
			files: normalizeFilesPolicy(envelope?.policies?.files),
		},
	};
}

function mergeRawConventionsConfig(
	globalRaw: unknown,
	projectRaw: unknown,
): RawConventionsConfig {
	const globalConfig = asConventionsConfig(globalRaw);
	const projectConfig = asConventionsConfig(projectRaw);
	return {
		extendsGlobal: projectConfig?.extendsGlobal,
		ignorePaths: concatArrays(
			globalConfig?.ignorePaths,
			projectConfig?.ignorePaths,
		),
		notes: concatArrays(globalConfig?.notes, projectConfig?.notes),
		policies: {
			structure: mergeFieldsPolicy(
				globalConfig?.policies?.structure,
				projectConfig?.policies?.structure,
				["forbiddenSegments", "layers", "legacyZones", "notes"],
			),
			naming: mergeRulePolicy(
				globalConfig?.policies?.naming,
				projectConfig?.policies?.naming,
				"rules",
			),
			documentation: mergeRulePolicy(
				globalConfig?.policies?.documentation,
				projectConfig?.policies?.documentation,
				"rules",
			),
			size: mergeRulePolicy(
				globalConfig?.policies?.size,
				projectConfig?.policies?.size,
				"limits",
			),
			dependencies: mergeRulePolicy(
				globalConfig?.policies?.dependencies,
				projectConfig?.policies?.dependencies,
				"rules",
			),
			package: mergeFieldsPolicy(
				globalConfig?.policies?.package,
				projectConfig?.policies?.package,
				["manifests", "requireFields", "requireFiles", "notes"],
			),
			files: mergeRulePolicy(
				globalConfig?.policies?.files,
				projectConfig?.policies?.files,
				"rules",
			),
		},
	};
}

function mergeFieldsPolicy(
	globalPolicy: unknown,
	projectPolicy: unknown,
	arrayFields: string[],
): any {
	const g = asRecord(globalPolicy);
	const p = asRecord(projectPolicy);
	if (!g && !p) return undefined;
	const merged: Record<string, unknown> = { ...g, ...p };
	for (const field of arrayFields) {
		merged[field] = concatArrays(g?.[field], p?.[field]);
	}
	return merged;
}

function mergeRulePolicy(
	globalPolicy: unknown,
	projectPolicy: unknown,
	listKey: "rules" | "limits",
): any {
	const globalRecord = asRecord(globalPolicy);
	const projectRecord = asRecord(projectPolicy);
	if (!globalRecord && !projectRecord) return undefined;
	return {
		...globalRecord,
		...projectRecord,
		[listKey]: concatArrays(
			stampRuleModes(globalRecord?.[listKey], globalRecord),
			stampRuleModes(projectRecord?.[listKey], projectRecord),
		),
		notes: concatArrays(globalRecord?.notes, projectRecord?.notes),
	};
}

function stampRuleModes(
	value: unknown,
	policy: Record<string, any> | undefined,
) {
	if (!Array.isArray(value)) return [];
	return value.map((rule) => {
		const record = asRecord(rule);
		if (!record) return rule;
		return {
			...record,
			onCreate: record.onCreate ?? policy?.mode,
			onEdit: record.onEdit ?? policy?.editMode ?? policy?.mode,
		};
	});
}

function concatArrays(globalValue: unknown, projectValue: unknown): unknown[] {
	const globalItems = Array.isArray(globalValue) ? globalValue : [];
	const projectItems = Array.isArray(projectValue) ? projectValue : [];
	return [...globalItems, ...projectItems];
}

function asConventionsConfig(raw: unknown): RawConventionsConfig | undefined {
	return asRecord(raw) as RawConventionsConfig | undefined;
}

function asRecord(value: unknown): Record<string, any> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, any>)
		: undefined;
}

function globalConfigPath(): string {
	return path.join(os.homedir(), ".pi", "agent", "conventions.json");
}
