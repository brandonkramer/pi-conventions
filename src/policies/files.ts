/** @fileoverview File relationship and existence policy. */
import { existsSync } from "node:fs";
import path from "node:path";
import { normalizeRelativePath } from "../core/path.ts";
import {
	compilePathPatterns,
	matchesAnyPathPattern,
	type PathPattern,
} from "../core/pattern.ts";
import { parseMode, uniqueStrings } from "../core/strings.ts";
import type { EnforcementMode, Violation } from "../core/types.ts";

export interface RawFilesRule {
	id?: string;
	source?: unknown[];
	exclude?: unknown[];
	requireAny?: unknown[];
	require?: unknown[];
	forbid?: unknown[];
	reason?: unknown;
	onCreate?: EnforcementMode;
	onEdit?: EnforcementMode;
}

export interface RawFilesPolicyConfig {
	mode?: EnforcementMode;
	editMode?: EnforcementMode;
	rules?: RawFilesRule[];
	notes?: unknown[];
}

export interface FilesRule {
	id?: string;
	source: string[];
	sourceMatchers: PathPattern[];
	exclude: string[];
	excludeMatchers: PathPattern[];
	requireAny: string[];
	require: string[];
	forbid: string[];
	forbidMatchers: PathPattern[];
	reason?: string;
	onCreate: EnforcementMode;
	onEdit: EnforcementMode;
}

export interface FilesPolicyConfig {
	mode: EnforcementMode;
	editMode: EnforcementMode;
	rules: FilesRule[];
	notes: string[];
}

const DEFAULT_MODE: EnforcementMode = "warn";
const DEFAULT_EDIT_MODE: EnforcementMode = "warn";

export function normalizeFilesPolicy(
	raw: RawFilesPolicyConfig | undefined,
): FilesPolicyConfig | undefined {
	if (
		raw !== undefined &&
		(typeof raw !== "object" || raw === null || Array.isArray(raw))
	) {
		return undefined;
	}
	const candidate = raw ?? {};
	const mode = parseMode(candidate.mode, DEFAULT_MODE);
	const editMode = parseMode(candidate.editMode, DEFAULT_EDIT_MODE);
	const rules = (candidate.rules ?? [])
		.map((rule): FilesRule | undefined => normalizeRule(rule, mode, editMode))
		.filter((rule): rule is FilesRule => rule !== undefined);
	const notes = uniqueStrings(candidate.notes, (value) => value);
	if (rules.length === 0) return undefined;
	return { mode, editMode, rules, notes };
}

export function filesPolicyMatchesPath(
	relativePath: string,
	config: FilesPolicyConfig,
): boolean {
	return config.rules.some(
		(rule) =>
			matchesAnyPathPattern(relativePath, rule.sourceMatchers) ||
			matchesAnyPathPattern(relativePath, rule.forbidMatchers),
	);
}

export function evaluateFilesViolation(
	relativePath: string,
	exists: boolean,
	config: FilesPolicyConfig,
	cwd: string | undefined,
): Violation | undefined {
	for (const rule of config.rules) {
		if (
			rule.forbidMatchers.length > 0 &&
			matchesAnyPathPattern(relativePath, rule.forbidMatchers)
		) {
			return buildViolation(
				rule,
				exists,
				rule.reason ?? `${relativePath} is forbidden by files policy.`,
			);
		}

		if (rule.sourceMatchers.length === 0 || rule.requireAny.length === 0)
			continue;
		if (!matchesAnyPathPattern(relativePath, rule.sourceMatchers)) continue;
		if (matchesAnyPathPattern(relativePath, rule.excludeMatchers)) continue;
		if (!cwd) continue;

		const candidates = rule.requireAny.map((pattern) =>
			expandPlaceholders(pattern, relativePath),
		);
		const found = candidates.some((candidate) =>
			existsSync(path.resolve(cwd, candidate)),
		);
		if (!found) {
			return buildViolation(
				rule,
				exists,
				rule.reason ??
					`${relativePath} requires a companion file matching one of: ${candidates.join(", ")}.`,
			);
		}
	}
	return undefined;
}

export function evaluateFilesGlobalRequireFindings(
	config: FilesPolicyConfig,
	cwd: string,
): { relativePath: string; violation: Violation }[] {
	const findings: { relativePath: string; violation: Violation }[] = [];
	for (const rule of config.rules) {
		for (const required of rule.require) {
			if (existsSync(path.resolve(cwd, required))) continue;
			findings.push({
				relativePath: required,
				violation: buildViolation(
					rule,
					false,
					rule.reason ?? `Required file '${required}' is missing.`,
				),
			});
		}
	}
	return findings;
}

export function buildFilesPromptLines(config: FilesPolicyConfig): string[] {
	const lines = [
		`Default new-file mode: ${config.mode}.`,
		`Default existing-file edit mode: ${config.editMode}.`,
		"",
		"File rules:",
	];
	for (const rule of config.rules) {
		if (rule.require.length > 0) {
			lines.push(`- require: ${rule.require.join(", ")}`);
		}
		if (rule.forbid.length > 0) {
			lines.push(`- forbid: ${rule.forbid.join(", ")}`);
		}
		if (rule.source.length > 0 && rule.requireAny.length > 0) {
			const exclude =
				rule.exclude.length > 0 ? ` (exclude ${rule.exclude.join(", ")})` : "";
			lines.push(
				`- ${rule.source.join(", ")}${exclude} -> requireAny ${rule.requireAny.join(", ")}`,
			);
		}
		if (rule.reason) lines.push(`  reason: ${rule.reason}`);
	}
	if (config.notes.length > 0) {
		lines.push("", "Files notes:");
		for (const note of config.notes) lines.push(`- ${note}`);
	}
	return lines;
}

function normalizeRule(
	raw: RawFilesRule,
	mode: EnforcementMode,
	editMode: EnforcementMode,
): FilesRule | undefined {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return undefined;
	}
	const source = uniqueStrings(raw.source, normalizeRelativePath);
	const exclude = uniqueStrings(raw.exclude, normalizeRelativePath);
	const requireAny = uniqueStrings(raw.requireAny, (value) => value);
	const require = uniqueStrings(raw.require, normalizeRelativePath);
	const forbid = uniqueStrings(raw.forbid, normalizeRelativePath);
	const reason = typeof raw.reason === "string" ? raw.reason.trim() : undefined;

	const hasPairing = source.length > 0 && requireAny.length > 0;
	const hasExistence = require.length > 0 || forbid.length > 0;
	if (!hasPairing && !hasExistence) return undefined;

	return {
		id:
			typeof raw.id === "string" && raw.id.trim().length > 0
				? raw.id.trim()
				: undefined,
		source,
		sourceMatchers: compilePathPatterns(source),
		exclude,
		excludeMatchers: compilePathPatterns(exclude),
		requireAny,
		require,
		forbid,
		forbidMatchers: compilePathPatterns(forbid),
		reason: reason && reason.length > 0 ? reason : undefined,
		onCreate: parseMode(raw.onCreate, mode),
		onEdit: parseMode(raw.onEdit, editMode),
	};
}

function expandPlaceholders(pattern: string, sourcePath: string): string {
	const dir = path.posix.dirname(sourcePath);
	const base = path.posix.basename(sourcePath);
	const stem = stripExtensionOnce(base);
	const fullStem = path.posix.join(dir, stem);
	return pattern
		.replace(/\{stem\}/g, stem)
		.replace(/\{dir\}/g, dir)
		.replace(/\{path\}/g, fullStem);
}

function stripExtensionOnce(fileName: string): string {
	if (fileName.endsWith(".d.ts")) return fileName.slice(0, -".d.ts".length);
	const idx = fileName.lastIndexOf(".");
	return idx > 0 ? fileName.slice(0, idx) : fileName;
}

function buildViolation(
	rule: FilesRule,
	exists: boolean,
	reason: string,
): Violation {
	return {
		policyId: "files",
		ruleId: rule.id,
		mode: exists ? rule.onEdit : rule.onCreate,
		reason,
	};
}
