/**
 * @fileoverview Lightweight import-boundary policy for deterministic repo-local dependency rules.
 */
import path from "node:path";
import { normalizeRelativePath } from "../core/path.ts";
import {
	compilePathPatterns,
	compileSpecifierPatterns,
	matchesAnyPathPattern,
	type PathPattern,
} from "../core/pattern.ts";
import { parseMode, uniqueStrings } from "../core/strings.ts";
import type { EnforcementMode, Violation } from "../core/types.ts";

export interface RawDependencyRule {
	id?: string;
	from?: unknown[];
	exclude?: unknown[];
	to?: unknown[];
	allow?: unknown[];
	forbidSpecifiers?: unknown[];
	allowSpecifiers?: unknown[];
	reason?: unknown;
	onCreate?: EnforcementMode;
	onEdit?: EnforcementMode;
}

export interface RawDependenciesPolicyConfig {
	mode?: EnforcementMode;
	editMode?: EnforcementMode;
	rules?: RawDependencyRule[];
	notes?: unknown[];
}

export interface DependencyRule {
	id?: string;
	from: string[];
	fromMatchers: PathPattern[];
	exclude: string[];
	excludeMatchers: PathPattern[];
	to: string[];
	toMatchers: PathPattern[];
	allow: string[];
	allowMatchers: PathPattern[];
	forbidSpecifiers: string[];
	forbidSpecifierMatchers: PathPattern[];
	allowSpecifiers: string[];
	allowSpecifierMatchers: PathPattern[];
	reason?: string;
	onCreate: EnforcementMode;
	onEdit: EnforcementMode;
}

export interface DependenciesPolicyConfig {
	mode: EnforcementMode;
	editMode: EnforcementMode;
	rules: DependencyRule[];
	notes: string[];
}

const DEFAULT_MODE: EnforcementMode = "warn";
const DEFAULT_EDIT_MODE: EnforcementMode = "warn";

export function normalizeDependenciesPolicy(
	raw: RawDependenciesPolicyConfig | undefined,
): DependenciesPolicyConfig | undefined {
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
		.map((rule): DependencyRule | undefined =>
			normalizeRule(rule, mode, editMode),
		)
		.filter((rule): rule is DependencyRule => rule !== undefined);
	const notes = uniqueStrings(candidate.notes, (value) => value);

	if (rules.length === 0) {
		return undefined;
	}

	return { mode, editMode, rules, notes };
}

export function dependenciesPolicyMatchesPath(
	relativePath: string,
	config: DependenciesPolicyConfig,
): boolean {
	return config.rules.some((rule) => matchesSource(relativePath, rule));
}

export function evaluateDependenciesViolation(
	relativePath: string,
	exists: boolean,
	content: string,
	config: DependenciesPolicyConfig,
): Violation | undefined {
	const specifiers = extractImportSpecifiers(content);
	const sourceDir = path.posix.dirname(normalizeRelativePath(relativePath));

	for (const rule of config.rules) {
		if (!matchesSource(relativePath, rule)) continue;

		if (rule.toMatchers.length > 0) {
			for (const specifier of specifiers) {
				if (!specifier.startsWith(".")) continue;
				const targetPath = normalizeRelativePath(
					path.posix.normalize(path.posix.join(sourceDir, specifier)),
				);
				if (!matchesAnyPathPattern(targetPath, rule.toMatchers)) continue;
				if (matchesAnyPathPattern(targetPath, rule.allowMatchers)) continue;
				return {
					policyId: "dependencies",
					ruleId: rule.id,
					mode: exists ? rule.onEdit : rule.onCreate,
					reason:
						rule.reason ??
						`${relativePath} imports ${specifier} (${targetPath}), which crosses a configured dependency boundary.`,
				};
			}
		}

		if (rule.forbidSpecifierMatchers.length > 0) {
			for (const specifier of specifiers) {
				if (!matchesAnyPathPattern(specifier, rule.forbidSpecifierMatchers))
					continue;
				if (matchesAnyPathPattern(specifier, rule.allowSpecifierMatchers))
					continue;
				return {
					policyId: "dependencies",
					ruleId: rule.id,
					mode: exists ? rule.onEdit : rule.onCreate,
					reason:
						rule.reason ??
						`${relativePath} imports '${specifier}', which matches a forbidden specifier pattern.`,
				};
			}
		}
	}

	return undefined;
}

export function buildDependenciesPromptLines(
	config: DependenciesPolicyConfig,
): string[] {
	const lines = [
		`Default new-file mode: ${config.mode}.`,
		`Default existing-file edit mode: ${config.editMode}.`,
		"Dependency checks scan static import/export specifiers and relative dynamic imports only.",
		"No TypeScript compiler, path alias, package export-map, call graph, or circular dependency resolution is performed.",
		"",
		"Dependency boundary rules:",
	];

	for (const rule of config.rules) {
		const excludes =
			rule.exclude.length > 0 ? ` except ${rule.exclude.join(", ")}` : "";
		if (rule.to.length > 0) {
			const allow =
				rule.allow.length > 0 ? ` (allow ${rule.allow.join(", ")})` : "";
			lines.push(
				`- from ${rule.from.join(", ")}${excludes} MUST NOT import ${rule.to.join(", ")}${allow} (create: ${rule.onCreate}, edit: ${rule.onEdit})`,
			);
		}
		if (rule.forbidSpecifiers.length > 0) {
			const allow =
				rule.allowSpecifiers.length > 0
					? ` (allow ${rule.allowSpecifiers.join(", ")})`
					: "";
			lines.push(
				`- from ${rule.from.join(", ")}${excludes} MUST NOT match specifiers ${rule.forbidSpecifiers.join(", ")}${allow} (create: ${rule.onCreate}, edit: ${rule.onEdit})`,
			);
		}
		if (rule.reason) {
			lines.push(`  reason: ${rule.reason}`);
		}
	}

	if (config.notes.length > 0) {
		lines.push("", "Dependency notes:");
		for (const note of config.notes) {
			lines.push(`- ${note}`);
		}
	}

	return lines;
}

function normalizeRule(
	raw: RawDependencyRule,
	mode: EnforcementMode,
	editMode: EnforcementMode,
): DependencyRule | undefined {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return undefined;
	}
	const from = uniqueStrings(raw.from, normalizeRelativePath);
	const to = uniqueStrings(raw.to, normalizeRelativePath);
	const allow = uniqueStrings(raw.allow, normalizeRelativePath);
	const forbidSpecifiers = uniqueStrings(
		raw.forbidSpecifiers,
		(value) => value,
	);
	const allowSpecifiers = uniqueStrings(
		raw.allowSpecifiers,
		(value) => value,
	);
	if (from.length === 0) return undefined;
	if (to.length === 0 && forbidSpecifiers.length === 0) return undefined;

	const exclude = uniqueStrings(raw.exclude, normalizeRelativePath);
	const reason = typeof raw.reason === "string" ? raw.reason.trim() : undefined;
	return {
		id:
			typeof raw.id === "string" && raw.id.trim().length > 0
				? raw.id.trim()
				: undefined,
		from,
		fromMatchers: compilePathPatterns(from),
		exclude,
		excludeMatchers: compilePathPatterns(exclude),
		to,
		toMatchers: compilePathPatterns(to),
		allow,
		allowMatchers: compilePathPatterns(allow),
		forbidSpecifiers,
		forbidSpecifierMatchers: compileSpecifierPatterns(forbidSpecifiers),
		allowSpecifiers,
		allowSpecifierMatchers: compileSpecifierPatterns(allowSpecifiers),
		reason: reason && reason.length > 0 ? reason : undefined,
		onCreate: parseMode(raw.onCreate, mode),
		onEdit: parseMode(raw.onEdit, editMode),
	};
}

function matchesSource(relativePath: string, rule: DependencyRule): boolean {
	return (
		matchesAnyPathPattern(relativePath, rule.fromMatchers) &&
		!matchesAnyPathPattern(relativePath, rule.excludeMatchers)
	);
}

function extractImportSpecifiers(content: string): string[] {
	const stripped = stripComments(content);
	const specifiers = new Set<string>();
	const patterns = [
		/\b(?:import|export)\s+(?:type\s+)?[^;]*?\bfrom\s*["']([^"']+)["']/g,
		/\bimport\s*["']([^"']+)["']/g,
		/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
	];

	for (const pattern of patterns) {
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(stripped)) !== null) {
			if (match[1]) specifiers.add(match[1]);
		}
	}
	return [...specifiers];
}

function stripComments(content: string): string {
	let result = "";
	let quote: string | undefined;
	for (let index = 0; index < content.length; index += 1) {
		const char = content[index];
		const next = content[index + 1];

		if (quote) {
			result += char;
			if (char === "\\") {
				index += 1;
				result += content[index] ?? "";
			} else if (char === quote) {
				quote = undefined;
			}
			continue;
		}

		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			result += char;
			continue;
		}

		if (char === "/" && next === "/") {
			while (index < content.length && content[index] !== "\n") {
				result += " ";
				index += 1;
			}
			result += content[index] ?? "";
			continue;
		}

		if (char === "/" && next === "*") {
			result += "  ";
			index += 2;
			while (
				index < content.length &&
				!(content[index] === "*" && content[index + 1] === "/")
			) {
				result += content[index] === "\n" ? "\n" : " ";
				index += 1;
			}
			if (index < content.length) {
				result += "  ";
				index += 1;
			}
			continue;
		}

		result += char;
	}
	return result;
}
