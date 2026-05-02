import { normalizePrefix } from "../core/path.ts";
import {
	compilePathPatterns,
	matchesAnyPathPattern,
	type PathPattern,
} from "../core/pattern.ts";
import { parseMode, uniqueStrings } from "../core/strings.ts";
import type { EnforcementMode, Violation } from "../core/types.ts";

export interface RawSizeLimit {
	prefixes?: unknown[];
	extensions?: unknown[];
	maxLines?: unknown;
	maxBytes?: unknown;
	reason?: unknown;
	ignoreBlankLines?: unknown;
	ignoreCommentLines?: unknown;
	onCreate?: EnforcementMode;
	onEdit?: EnforcementMode;
}

export interface RawSizePolicyConfig {
	mode?: EnforcementMode;
	editMode?: EnforcementMode;
	limits?: RawSizeLimit[];
	notes?: unknown[];
}

export interface SizeLimit {
	prefixes: string[];
	prefixMatchers: PathPattern[];
	extensions: string[];
	maxLines?: number;
	maxBytes?: number;
	reason?: string;
	ignoreBlankLines: boolean;
	ignoreCommentLines: boolean;
	onCreate: EnforcementMode;
	onEdit: EnforcementMode;
}

export interface SizePolicyConfig {
	mode: EnforcementMode;
	editMode: EnforcementMode;
	limits: SizeLimit[];
	notes: string[];
}

const DEFAULT_MODE: EnforcementMode = "warn";
const DEFAULT_EDIT_MODE: EnforcementMode = "warn";

export function normalizeSizePolicy(
	raw: RawSizePolicyConfig | undefined,
): SizePolicyConfig | undefined {
	if (
		raw !== undefined &&
		(typeof raw !== "object" || raw === null || Array.isArray(raw))
	) {
		return undefined;
	}

	const candidate = raw ?? {};
	const mode = parseMode(candidate.mode, DEFAULT_MODE);
	const editMode = parseMode(candidate.editMode, DEFAULT_EDIT_MODE);
	const limits = (candidate.limits ?? [])
		.map((limit): SizeLimit | undefined =>
			normalizeLimit(limit, mode, editMode),
		)
		.filter((limit): limit is SizeLimit => limit !== undefined);
	const notes = uniqueStrings(candidate.notes, (value) => value);

	if (limits.length === 0) {
		return undefined;
	}

	return { mode, editMode, limits, notes };
}

export function sizePolicyMatchesPath(
	relativePath: string,
	config: SizePolicyConfig,
): boolean {
	return config.limits.some((limit) => matchesLimit(relativePath, limit));
}

export function evaluateSizeViolation(
	relativePath: string,
	exists: boolean,
	content: string,
	config: SizePolicyConfig,
): Violation | undefined {
	for (const limit of config.limits) {
		if (!matchesLimit(relativePath, limit)) continue;

		const issue = evaluateLimit(relativePath, content, limit);
		if (issue) {
			return {
				policyId: "size",
				mode: exists ? limit.onEdit : limit.onCreate,
				reason: issue,
			};
		}
	}
	return undefined;
}

export function buildSizePromptLines(config: SizePolicyConfig): string[] {
	const lines = [
		`Default new-file mode: ${config.mode}. Individual inherited limits may keep stricter modes from their source config.`,
		`Default existing-file edit mode: ${config.editMode}.`,
		"Size checks run only when file content is available.",
		"",
		"Size limits:",
	];

	for (const limit of config.limits) {
		const checks: string[] = [];
		if (limit.maxLines !== undefined)
			checks.push(`max ${limit.maxLines} lines`);
		if (limit.maxBytes !== undefined)
			checks.push(`max ${limit.maxBytes} bytes`);
		if (limit.extensions.length > 0)
			checks.push(`extensions ${limit.extensions.join(", ")}`);
		lines.push(
			`- ${limit.prefixes.join(", ")} -> ${checks.join("; ")} (create: ${limit.onCreate}, edit: ${limit.onEdit})`,
		);
		if (limit.reason) {
			lines.push(`  reason: ${limit.reason}`);
		}
	}

	if (config.notes.length > 0) {
		lines.push("", "Size notes:");
		for (const note of config.notes) {
			lines.push(`- ${note}`);
		}
	}

	return lines;
}

function normalizeLimit(
	raw: RawSizeLimit,
	mode: EnforcementMode,
	editMode: EnforcementMode,
): SizeLimit | undefined {
	const prefixes = uniqueStrings(raw?.prefixes, normalizePrefix);
	const maxLines = parsePositiveInteger(raw?.maxLines);
	const maxBytes = parsePositiveInteger(raw?.maxBytes);
	if (
		prefixes.length === 0 ||
		(maxLines === undefined && maxBytes === undefined)
	) {
		return undefined;
	}

	const extensions = uniqueStrings(raw.extensions, normalizeExtension);
	const reason = typeof raw.reason === "string" ? raw.reason.trim() : undefined;
	return {
		prefixes,
		prefixMatchers: compilePathPatterns(prefixes),
		extensions,
		maxLines,
		maxBytes,
		reason: reason && reason.length > 0 ? reason : undefined,
		ignoreBlankLines: raw.ignoreBlankLines === true,
		ignoreCommentLines: raw.ignoreCommentLines === true,
		onCreate: parseMode(raw.onCreate, mode),
		onEdit: parseMode(raw.onEdit, editMode),
	};
}

function matchesLimit(relativePath: string, limit: SizeLimit): boolean {
	if (!matchesAnyPathPattern(relativePath, limit.prefixMatchers)) {
		return false;
	}
	const extension = detectExtension(relativePath);
	return (
		limit.extensions.length === 0 ||
		(extension !== undefined && limit.extensions.includes(extension))
	);
}

function evaluateLimit(
	relativePath: string,
	content: string,
	limit: SizeLimit,
): string | undefined {
	if (limit.maxBytes !== undefined) {
		const bytes = Buffer.byteLength(content, "utf8");
		if (bytes > limit.maxBytes) {
			return (
				limit.reason ??
				`${relativePath} is ${bytes} bytes, exceeding maxBytes ${limit.maxBytes}.`
			);
		}
	}

	if (limit.maxLines !== undefined) {
		const lines = countLines(content, limit);
		if (lines > limit.maxLines) {
			return (
				limit.reason ??
				`${relativePath} has ${lines} lines, exceeding maxLines ${limit.maxLines}.`
			);
		}
	}

	return undefined;
}

function countLines(content: string, limit: SizeLimit): number {
	const lines = content.length === 0 ? [] : content.split(/\r?\n/);
	const effectiveLines = content.endsWith("\n") ? lines.slice(0, -1) : lines;
	return effectiveLines.filter((line) => shouldCountLine(line, limit)).length;
}

function shouldCountLine(line: string, limit: SizeLimit): boolean {
	const trimmed = line.trim();
	if (limit.ignoreBlankLines && trimmed.length === 0) return false;
	if (limit.ignoreCommentLines && isCommentLine(trimmed)) return false;
	return true;
}

function isCommentLine(trimmed: string): boolean {
	return (
		trimmed.startsWith("//") ||
		trimmed.startsWith("#") ||
		trimmed.startsWith("*") ||
		trimmed.startsWith("/*")
	);
}

function detectExtension(relativePath: string): string | undefined {
	const fileName = relativePath.split("/").pop() ?? relativePath;
	if (fileName.endsWith(".d.ts")) return "d.ts";
	const lastDot = fileName.lastIndexOf(".");
	return lastDot > 0 ? fileName.slice(lastDot + 1).toLowerCase() : undefined;
}

function normalizeExtension(value: string): string {
	return value.replace(/^\./, "").toLowerCase();
}

function parsePositiveInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0
		? value
		: undefined;
}
