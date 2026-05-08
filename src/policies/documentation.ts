import { normalizeRelativePath } from "../core/path.ts";
import {
	compilePathPatterns,
	matchesAnyPathPattern,
	type PathPattern,
} from "../core/pattern.ts";
import { parseMode, uniqueStrings } from "../core/strings.ts";
import type { EnforcementMode, Violation } from "../core/types.ts";
export interface LeadingBlockComment {
	line: number;
	text: string;
}

export function findLeadingBlockComment(
	content: string,
): LeadingBlockComment | undefined {
	let pos = 0;
	if (content.startsWith("#!")) {
		const nl = content.indexOf("\n", pos);
		pos = nl === -1 ? content.length : nl + 1;
	}
	while (pos < content.length) {
		const c = content[pos];
		if (c === " " || c === "\t" || c === "\r" || c === "\n") {
			pos++;
		} else {
			break;
		}
	}
	if (!content.startsWith("/**", pos)) return undefined;

	const start = pos;
	const end = content.indexOf("*/", pos + 3);
	if (end === -1) return undefined;

	let line = 1;
	for (let i = 0; i < start; i++) {
		if (content[i] === "\n") line++;
	}
	return { line, text: content.slice(start, end + 2) };
}

export type DocumentationRuleKind =
	| "requireTsdocOnExports"
	| "requireFileOverview"
	| "forbidFileHeaders"
	| "forbidCommentPatterns"
	| "todoFormat"
	| "requireRationaleComments";
export type DocumentationDeclarationKind =
	| "interface"
	| "type"
	| "function"
	| "class"
	| "const";

const DECLARATION_BITS: Record<DocumentationDeclarationKind, number> = {
	interface: 1,
	type: 2,
	function: 4,
	class: 8,
	const: 16,
};

export interface RawDocumentationRule {
	kind?: unknown;
	paths?: unknown[];
	pathPattern?: unknown[];
	declarations?: unknown[];
	requireRemarks?: unknown;
	patterns?: unknown[];
	allowedTags?: unknown[];
	format?: unknown;
	commentKeywords?: unknown[];
	requiredTags?: unknown[];
	requiredSections?: unknown[];
	optionalSections?: unknown[];
	allowPackageDocumentation?: unknown;
	description?: unknown;
	minMatches?: unknown;
}

export interface RawDocumentationPolicyConfig {
	mode?: EnforcementMode;
	editMode?: EnforcementMode;
	rules?: RawDocumentationRule[];
	notes?: unknown[];
}

interface BaseDocumentationRule {
	kind: DocumentationRuleKind;
	paths: string[];
	pathMatchers: PathPattern[];
}

export interface RequireTsdocOnExportsRule extends BaseDocumentationRule {
	kind: "requireTsdocOnExports";
	declarations: DocumentationDeclarationKind[];
	declarationMask: number;
	requireRemarks: boolean;
}

export interface RequireFileOverviewRule extends BaseDocumentationRule {
	kind: "requireFileOverview";
	requiredTags: string[];
	requiredSections: string[];
	optionalSections: string[];
	allowPackageDocumentation: boolean;
	minMatches: number;
	description?: string;
}

export interface ForbidFileHeadersRule extends BaseDocumentationRule {
	kind: "forbidFileHeaders";
	patterns: string[];
}

export interface ForbidCommentPatternsRule extends BaseDocumentationRule {
	kind: "forbidCommentPatterns";
	patterns: string[];
}

export type TodoFormat = "TAG: description" | "TAG: concrete action - referent";

export interface TodoFormatRule extends BaseDocumentationRule {
	kind: "todoFormat";
	allowedTags: string[];
	format: TodoFormat;
}

export interface RequireRationaleCommentsRule extends BaseDocumentationRule {
	kind: "requireRationaleComments";
	commentKeywords: string[];
	minMatches: number;
}

export type DocumentationRule =
	| RequireTsdocOnExportsRule
	| RequireFileOverviewRule
	| ForbidFileHeadersRule
	| ForbidCommentPatternsRule
	| TodoFormatRule
	| RequireRationaleCommentsRule;

export interface DocumentationPolicyConfig {
	mode: EnforcementMode;
	editMode: EnforcementMode;
	rules: DocumentationRule[];
	notes: string[];
}

const DEFAULT_MODE: EnforcementMode = "warn";
const DEFAULT_EDIT_MODE: EnforcementMode = "warn";
const DEFAULT_DECLARATIONS: DocumentationDeclarationKind[] = [
	"interface",
	"type",
	"function",
	"class",
	"const",
];
const DEFAULT_TODO_TAGS = ["TODO", "FIXME"];
const HEADER_LINE_LIMIT = 20;

export function normalizeDocumentationPolicy(
	raw: RawDocumentationPolicyConfig | undefined,
): DocumentationPolicyConfig | undefined {
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
		.map(normalizeRule)
		.filter((rule): rule is DocumentationRule => rule !== undefined);
	const notes = uniqueStrings(candidate.notes, (value) => value);

	if (rules.length === 0) {
		return undefined;
	}

	return { mode, editMode, rules, notes };
}

export function documentationPolicyMatchesPath(
	relativePath: string,
	config: DocumentationPolicyConfig,
): boolean {
	return config.rules.some((rule) =>
		matchesAnyPathPattern(relativePath, rule.pathMatchers),
	);
}

export function evaluateDocumentationViolation(
	relativePath: string,
	exists: boolean,
	content: string,
	config: DocumentationPolicyConfig,
): Violation | undefined {
	for (const rule of config.rules) {
		if (!matchesAnyPathPattern(relativePath, rule.pathMatchers)) continue;

		const reason =
			rule.kind === "requireTsdocOnExports"
				? evaluateTsdocRule(relativePath, content, rule)
				: rule.kind === "requireFileOverview"
					? evaluateFileOverviewRule(relativePath, content, rule)
					: rule.kind === "forbidFileHeaders"
						? evaluateHeaderRule(relativePath, content, rule)
						: rule.kind === "forbidCommentPatterns"
							? evaluateCommentPatternRule(relativePath, content, rule)
							: rule.kind === "todoFormat"
								? evaluateTodoRule(relativePath, content, rule)
								: evaluateRationaleRule(relativePath, content, rule);
		if (reason) {
			return {
				policyId: "documentation",
				mode: exists ? config.editMode : config.mode,
				reason,
			};
		}
	}
	return undefined;
}

export function buildDocumentationPromptLines(
	config: DocumentationPolicyConfig,
): string[] {
	const lines = [
		`Default new-file mode: ${config.mode}.`,
		`Default existing-file edit mode: ${config.editMode}.`,
		"Documentation checks are deterministic and additive.",
	];

	lines.push("", "Documentation rules:");
	for (const rule of config.rules) {
		if (rule.kind === "requireTsdocOnExports") {
			const remarks = rule.requireRemarks ? "; require @remarks" : "";
			lines.push(
				`- ${rule.paths.join(", ")} -> require TSDoc on exported ${rule.declarations.join(", ")}${remarks}.`,
			);
		} else if (rule.kind === "requireFileOverview") {
			const sections =
				rule.requiredSections.length > 0
					? ` with ${rule.requiredSections.join(", ")}`
					: "";
			const optional =
				rule.optionalSections.length > 0
					? ` Optional: ${rule.optionalSections.join(", ")}.`
					: "";
			lines.push(
				`- ${rule.paths.join(", ")} -> require leading @fileoverview${sections}.${optional}`,
			);
		} else if (rule.kind === "forbidFileHeaders") {
			lines.push(
				`- ${rule.paths.join(", ")} -> forbid blanket file headers matching ${rule.patterns.join(", ")}.`,
			);
		} else if (rule.kind === "forbidCommentPatterns") {
			lines.push(
				`- ${rule.paths.join(", ")} -> forbid comments matching ${rule.patterns.join(", ")}.`,
			);
		} else if (rule.kind === "todoFormat") {
			lines.push(
				`- ${rule.paths.join(", ")} -> require TODO/FIXME comments in ${rule.format} format.`,
			);
		} else {
			lines.push(
				`- ${rule.paths.join(", ")} -> require rationale comments with ${rule.commentKeywords.join(", ")}.`,
			);
		}
	}

	if (config.notes.length > 0) {
		lines.push("", "Documentation notes:");
		for (const note of config.notes) {
			lines.push(`- ${note}`);
		}
	}

	return lines;
}

function normalizeRule(
	rule: RawDocumentationRule,
): DocumentationRule | undefined {
	const kind =
		rule?.kind === "requireTsdocOnExports" ||
		rule?.kind === "requireFileOverview" ||
		rule?.kind === "forbidFileHeaders" ||
		rule?.kind === "forbidCommentPatterns" ||
		rule?.kind === "todoFormat" ||
		rule?.kind === "requireRationaleComments"
			? rule?.kind
			: undefined;
	const paths = uniqueStrings(
		rule?.paths ?? rule?.pathPattern,
		normalizeRelativePath,
	);
	const pathMatchers = compilePathPatterns(paths);
	if (!kind || paths.length === 0) return undefined;

	if (kind === "requireTsdocOnExports") {
		const declarations = uniqueStrings(rule.declarations, (value) =>
			DEFAULT_DECLARATIONS.includes(value as DocumentationDeclarationKind)
				? value
				: "",
		).filter((value): value is DocumentationDeclarationKind =>
			DEFAULT_DECLARATIONS.includes(value as DocumentationDeclarationKind),
		);
		return {
			kind,
			paths,
			pathMatchers,
			declarations:
				declarations.length > 0 ? declarations : DEFAULT_DECLARATIONS,
			declarationMask: (declarations.length > 0
				? declarations
				: DEFAULT_DECLARATIONS
			).reduce((mask, kind) => mask | DECLARATION_BITS[kind], 0),
			requireRemarks: rule.requireRemarks === true,
		};
	}

	if (kind === "requireFileOverview") {
		const requiredTags = uniqueStrings(
			rule.requiredTags,
			(value) => value,
		).filter((value) => value.startsWith("@"));
		return {
			kind,
			paths,
			pathMatchers,
			requiredTags: requiredTags.length > 0 ? requiredTags : ["@fileoverview"],
			requiredSections: uniqueStrings(rule.requiredSections, (value) => value),
			optionalSections: uniqueStrings(rule.optionalSections, (value) => value),
			allowPackageDocumentation: rule.allowPackageDocumentation === true,
			description:
				typeof rule.description === "string" ? rule.description : undefined,
			minMatches:
				typeof rule.minMatches === "number" &&
				Number.isInteger(rule.minMatches) &&
				rule.minMatches > 0
					? rule.minMatches
					: 1,
		};
	}

	if (kind === "forbidFileHeaders" || kind === "forbidCommentPatterns") {
		const patterns = uniqueStrings(rule.patterns, (value) =>
			value.toLowerCase(),
		);
		return patterns.length > 0
			? { kind, paths, pathMatchers, patterns }
			: undefined;
	}

	if (kind === "todoFormat") {
		const allowedTags = uniqueStrings(rule.allowedTags, (value) =>
			value.toUpperCase(),
		);
		return {
			kind,
			paths,
			pathMatchers,
			allowedTags: allowedTags.length > 0 ? allowedTags : DEFAULT_TODO_TAGS,
			format:
				rule.format === "TAG: concrete action - referent"
					? rule.format
					: "TAG: description",
		};
	}

	const commentKeywords = uniqueStrings(rule.commentKeywords, (value) =>
		value.toLowerCase(),
	);
	if (commentKeywords.length === 0) return undefined;
	return {
		kind,
		paths,
		pathMatchers,
		commentKeywords,
		minMatches:
			typeof rule.minMatches === "number" &&
			Number.isInteger(rule.minMatches) &&
			rule.minMatches > 0
				? rule.minMatches
				: 1,
	};
}

function evaluateTsdocRule(
	relativePath: string,
	content: string,
	rule: RequireTsdocOnExportsRule,
): string | undefined {
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.length > 0 && line.charCodeAt(line.length - 1) === 13) {
			lines[i] = line.slice(0, -1);
		}
	}

	// First pass: index all TSDoc block ranges.
	const blocks: { start: number; end: number }[] = [];
	let inBlock = false;
	let blockStart = -1;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!inBlock) {
			let pos = 0;
			while (pos < line.length && (line[pos] === " " || line[pos] === "\t"))
				pos++;
			if (line.startsWith("/**", pos)) {
				inBlock = true;
				blockStart = i;
			}
		}
		if (inBlock && line.includes("*/")) {
			inBlock = false;
			blocks.push({ start: blockStart, end: i });
		}
	}

	// Second pass: match exports to immediately-preceding blocks.
	let blockIdx = 0;
	for (let index = 0; index < lines.length; index += 1) {
		while (blockIdx < blocks.length && blocks[blockIdx].end < index) {
			blockIdx++;
		}
		const activeBlock = blockIdx > 0 ? blocks[blockIdx - 1] : undefined;

		const declaration = parseExportDeclaration(lines[index]);
		if (
			!declaration ||
			!(DECLARATION_BITS[declaration.kind] & rule.declarationMask)
		)
			continue;

		let tsdoc: string | undefined;
		if (activeBlock) {
			let allEmpty = true;
			for (let j = activeBlock.end + 1; j < index; j++) {
				const gap = lines[j];
				let nonEmpty = false;
				for (let k = 0; k < gap.length; k++) {
					if (gap[k] !== " " && gap[k] !== "\t") {
						nonEmpty = true;
						break;
					}
				}
				if (nonEmpty) {
					allEmpty = false;
					break;
				}
			}
			if (allEmpty) {
				tsdoc = lines.slice(activeBlock.start, activeBlock.end + 1).join("\n");
			}
		}

		if (!tsdoc) {
			return `Exported ${declaration.kind} '${declaration.name}' in ${relativePath} needs TSDoc.`;
		}
		if (rule.requireRemarks && !tsdoc.includes("@remarks")) {
			return `Exported ${declaration.kind} '${declaration.name}' in ${relativePath} needs TSDoc with @remarks.`;
		}
	}
	return undefined;
}

function evaluateFileOverviewRule(
	relativePath: string,
	content: string,
	rule: RequireFileOverviewRule,
): string | undefined {
	const overview = findLeadingBlockComment(content);
	if (!overview) {
		return `Add a leading TSDoc @fileoverview comment to ${relativePath}.`;
	}

	const normalized = overview.text.toLowerCase();
	const tags = rule.allowPackageDocumentation
		? [...rule.requiredTags, "@packagedocumentation"]
		: rule.requiredTags;
	const matches = tags.filter((tag) =>
		normalized.includes(tag.toLowerCase()),
	).length;
	if (matches < rule.minMatches) {
		return `Add ${rule.requiredTags.join(" or ")} to the leading TSDoc comment in ${relativePath}.`;
	}

	const missingSection = rule.requiredSections.find(
		(section) => !overview.text.includes(section),
	);
	return missingSection
		? `Add '${missingSection}' to the @fileoverview comment in ${relativePath}.`
		: undefined;
}

function evaluateHeaderRule(
	relativePath: string,
	content: string,
	rule: ForbidFileHeadersRule,
): string | undefined {
	const header = content
		.split(/\r?\n/, HEADER_LINE_LIMIT + 1)
		.slice(0, HEADER_LINE_LIMIT)
		.join("\n")
		.toLowerCase();
	const pattern = rule.patterns.find((candidate) => header.includes(candidate));
	return pattern
		? `Avoid blanket file headers matching '${pattern}' near the top of ${relativePath}.`
		: undefined;
}

function evaluateCommentPatternRule(
	relativePath: string,
	content: string,
	rule: ForbidCommentPatternsRule,
): string | undefined {
	const re = /\/\/([^\n]*)|\/\*[\s\S]*?\*\//g;
	re.lastIndex = 0;
	let m;
	while ((m = re.exec(content)) !== null) {
		const comment = (m[1] ?? m[0]).toLowerCase();
		for (const pattern of rule.patterns) {
			if (comment.includes(pattern)) {
				return `Avoid comments matching '${pattern}' in ${relativePath}.`;
			}
		}
	}
	return undefined;
}

function evaluateTodoRule(
	relativePath: string,
	content: string,
	rule: TodoFormatRule,
): string | undefined {
	const re = /^[ \t]*\/\/[ \t]*(TODO|FIXME)[ \t]*(:?)[ \t]*(.*)$/gim;
	re.lastIndex = 0;
	let line = 1;
	let lastIndex = 0;
	let match;
	while ((match = re.exec(content)) !== null) {
		for (let i = lastIndex; i < match.index; i++) {
			if (content[i] === "\n") line++;
		}
		lastIndex = match.index;
		const tag = match[1].toUpperCase();
		const hasColon = match[2] === ":";
		const description = match[3].trim();
		if (!rule.allowedTags.includes(tag)) {
			return `Comment tag '${tag}' in ${relativePath}:${line} is not allowed; use ${rule.allowedTags.join(" or ")}.`;
		}
		if (!hasColon || description.length === 0) {
			return `Use '${tag}: description' format for TODO/FIXME comments in ${relativePath}:${line}.`;
		}
		if (
			rule.format === "TAG: concrete action - referent" &&
			!/\S.{2,}\s+-\s+\S/.test(description)
		) {
			return `Use '${tag}: concrete action - referent' format for TODO/FIXME comments in ${relativePath}:${line}.`;
		}
	}
	return undefined;
}

function evaluateRationaleRule(
	relativePath: string,
	content: string,
	rule: RequireRationaleCommentsRule,
): string | undefined {
	const re = /\/\/([^\n]*)|\/\*[\s\S]*?\*\//g;
	re.lastIndex = 0;
	let m;
	let matches = 0;
	while ((m = re.exec(content)) !== null) {
		const comment = (m[1] ?? m[0]).toLowerCase();
		if (rule.commentKeywords.some((keyword) => comment.includes(keyword))) {
			matches++;
			if (matches >= rule.minMatches) return undefined;
		}
	}
	return matches < rule.minMatches
		? `Add rationale comments in ${relativePath} containing at least ${rule.minMatches} of: ${rule.commentKeywords.join(", ")}.`
		: undefined;
}

function parseExportDeclaration(
	line: string,
): { kind: DocumentationDeclarationKind; name: string } | undefined {
	const match =
		/^\s*export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(interface|type|function|class|const)\s+([A-Za-z_$][\w$]*)/.exec(
			line,
		);
	if (!match) return undefined;
	return { kind: match[1] as DocumentationDeclarationKind, name: match[2] };
}
