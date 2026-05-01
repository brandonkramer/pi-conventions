import { normalizeRelativePath } from "../core/path.ts";
import { parseMode, uniqueStrings } from "../core/strings.ts";
import type { EnforcementMode, Violation } from "../core/types.ts";

export type DocumentationRuleKind =
  | "requireTsdocOnExports"
  | "forbidFileHeaders"
  | "todoFormat"
  | "requireRationaleComments";
export type DocumentationDeclarationKind =
  | "interface"
  | "type"
  | "function"
  | "class"
  | "const";

export interface RawDocumentationRule {
  kind?: unknown;
  paths?: unknown[];
  declarations?: unknown[];
  requireRemarks?: unknown;
  patterns?: unknown[];
  allowedTags?: unknown[];
  format?: unknown;
  commentKeywords?: unknown[];
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
}

export interface RequireTsdocOnExportsRule extends BaseDocumentationRule {
  kind: "requireTsdocOnExports";
  declarations: DocumentationDeclarationKind[];
  requireRemarks: boolean;
}

export interface ForbidFileHeadersRule extends BaseDocumentationRule {
  kind: "forbidFileHeaders";
  patterns: string[];
}

export interface TodoFormatRule extends BaseDocumentationRule {
  kind: "todoFormat";
  allowedTags: string[];
  format: "TAG: description";
}

export interface RequireRationaleCommentsRule extends BaseDocumentationRule {
  kind: "requireRationaleComments";
  commentKeywords: string[];
  minMatches: number;
}

export type DocumentationRule =
  | RequireTsdocOnExportsRule
  | ForbidFileHeadersRule
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

export function evaluateDocumentationViolation(
  relativePath: string,
  exists: boolean,
  content: string,
  config: DocumentationPolicyConfig,
): Violation | undefined {
  for (const rule of config.rules) {
    if (!matchesAnyPath(relativePath, rule.paths)) continue;

    const reason = evaluateRule(relativePath, content, rule);
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
    } else if (rule.kind === "forbidFileHeaders") {
      lines.push(
        `- ${rule.paths.join(", ")} -> forbid blanket file headers matching ${rule.patterns.join(", ")}.`,
      );
    } else if (rule.kind === "todoFormat") {
      lines.push(
        `- ${rule.paths.join(", ")} -> require ${rule.allowedTags.join("/")}: description comments.`,
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
  const kind = parseRuleKind(rule?.kind);
  const paths = uniqueStrings(rule?.paths, normalizeRelativePath);
  if (!kind || paths.length === 0) return undefined;

  if (kind === "requireTsdocOnExports") {
    const declarations = uniqueStrings(
      rule.declarations,
      parseDeclarationKind,
    ).filter((value): value is DocumentationDeclarationKind =>
      DEFAULT_DECLARATIONS.includes(value as DocumentationDeclarationKind),
    );
    return {
      kind,
      paths,
      declarations:
        declarations.length > 0 ? declarations : DEFAULT_DECLARATIONS,
      requireRemarks: rule.requireRemarks === true,
    };
  }

  if (kind === "forbidFileHeaders") {
    const patterns = uniqueStrings(rule.patterns, (value) =>
      value.toLowerCase(),
    );
    return patterns.length > 0 ? { kind, paths, patterns } : undefined;
  }

  if (kind === "todoFormat") {
    const allowedTags = uniqueStrings(rule.allowedTags, (value) =>
      value.toUpperCase(),
    );
    return {
      kind,
      paths,
      allowedTags: allowedTags.length > 0 ? allowedTags : DEFAULT_TODO_TAGS,
      format: "TAG: description",
    };
  }

  const commentKeywords = uniqueStrings(rule.commentKeywords, (value) =>
    value.toLowerCase(),
  );
  if (commentKeywords.length === 0) return undefined;
  return {
    kind,
    paths,
    commentKeywords,
    minMatches: parsePositiveInteger(rule.minMatches, 1),
  };
}

function evaluateRule(
  relativePath: string,
  content: string,
  rule: DocumentationRule,
): string | undefined {
  if (rule.kind === "requireTsdocOnExports") {
    return evaluateTsdocRule(relativePath, content, rule);
  }
  if (rule.kind === "forbidFileHeaders") {
    return evaluateHeaderRule(relativePath, content, rule);
  }
  if (rule.kind === "todoFormat") {
    return evaluateTodoRule(relativePath, content, rule);
  }
  return evaluateRationaleRule(relativePath, content, rule);
}

function evaluateTsdocRule(
  relativePath: string,
  content: string,
  rule: RequireTsdocOnExportsRule,
): string | undefined {
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const declaration = parseExportDeclaration(lines[index]);
    if (!declaration || !rule.declarations.includes(declaration.kind)) continue;

    const tsdoc = findPrecedingTsdoc(lines, index);
    if (!tsdoc) {
      return `Exported ${declaration.kind} '${declaration.name}' in ${relativePath} needs TSDoc.`;
    }
    if (rule.requireRemarks && !tsdoc.includes("@remarks")) {
      return `Exported ${declaration.kind} '${declaration.name}' in ${relativePath} needs TSDoc with @remarks.`;
    }
  }
  return undefined;
}

function evaluateHeaderRule(
  relativePath: string,
  content: string,
  rule: ForbidFileHeadersRule,
): string | undefined {
  const header = content
    .split(/\r?\n/)
    .slice(0, HEADER_LINE_LIMIT)
    .join("\n")
    .toLowerCase();
  const pattern = rule.patterns.find((candidate) => header.includes(candidate));
  return pattern
    ? `Avoid blanket file headers matching '${pattern}' near the top of ${relativePath}.`
    : undefined;
}

function evaluateTodoRule(
  relativePath: string,
  content: string,
  rule: TodoFormatRule,
): string | undefined {
  const comments = extractCommentLines(content);
  for (const comment of comments) {
    const match = /\b(TODO|FIXME)\b\s*(:?)(.*)/i.exec(comment.text);
    if (!match) continue;

    const tag = match[1].toUpperCase();
    const hasColon = match[2] === ":";
    const description = match[3].trim();
    if (!rule.allowedTags.includes(tag)) {
      return `Comment tag '${tag}' in ${relativePath}:${comment.line} is not allowed; use ${rule.allowedTags.join(" or ")}.`;
    }
    if (!hasColon || description.length === 0) {
      return `Use '${tag}: description' format for TODO/FIXME comments in ${relativePath}:${comment.line}.`;
    }
  }
  return undefined;
}

function evaluateRationaleRule(
  relativePath: string,
  content: string,
  rule: RequireRationaleCommentsRule,
): string | undefined {
  const comments = extractComments(content);
  const matches = comments.filter((comment) => {
    const normalized = comment.toLowerCase();
    return rule.commentKeywords.some((keyword) => normalized.includes(keyword));
  }).length;

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

function findPrecedingTsdoc(
  lines: string[],
  declarationIndex: number,
): string | undefined {
  let index = declarationIndex - 1;
  while (index >= 0 && lines[index].trim().length === 0) {
    index -= 1;
  }
  if (index < 0 || !lines[index].trim().endsWith("*/")) return undefined;

  const end = index;
  while (index >= 0 && !lines[index].includes("/**")) {
    index -= 1;
  }
  if (index < 0) return undefined;
  return lines.slice(index, end + 1).join("\n");
}

function extractCommentLines(
  content: string,
): Array<{ line: number; text: string }> {
  const result: Array<{ line: number; text: string }> = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /\/\/\s*(.*)|\/\*+\s*(.*?)\s*\*\//.exec(lines[index]);
    if (match) {
      result.push({ line: index + 1, text: match[1] ?? match[2] ?? "" });
    }
  }
  return result;
}

function extractComments(content: string): string[] {
  const comments: string[] = [];
  for (const match of content.matchAll(/\/\/([^\n]*)|\/\*[\s\S]*?\*\//g)) {
    comments.push(match[1] ?? match[0]);
  }
  return comments;
}

function matchesAnyPath(relativePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesPath(relativePath, pattern));
}

function matchesPath(relativePath: string, pattern: string): boolean {
  if (pattern.endsWith("/") && !hasGlobSyntax(pattern)) {
    return relativePath.startsWith(pattern);
  }
  if (!hasGlobSyntax(pattern)) {
    return relativePath === pattern;
  }
  return globToRegExp(pattern).test(relativePath);
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "{") {
      const close = pattern.indexOf("}", index + 1);
      if (close > index) {
        const options = pattern
          .slice(index + 1, close)
          .split(",")
          .map(escapeRegExp)
          .join("|");
        source += `(?:${options})`;
        index = close;
      } else {
        source += escapeRegExp(char);
      }
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`${source}$`);
}

function hasGlobSyntax(pattern: string): boolean {
  return /[*{}]/.test(pattern);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$+?.()|[\]]/g, "\\$&");
}

function parseRuleKind(value: unknown): DocumentationRuleKind | undefined {
  return value === "requireTsdocOnExports" ||
    value === "forbidFileHeaders" ||
    value === "todoFormat" ||
    value === "requireRationaleComments"
    ? value
    : undefined;
}

function parseDeclarationKind(value: string): string {
  return DEFAULT_DECLARATIONS.includes(value as DocumentationDeclarationKind)
    ? value
    : "";
}

function parsePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}
