import { normalizePrefix } from "../core/path.ts";
import { parseMode, uniqueStrings } from "../core/strings.ts";
import type { EnforcementMode, Violation } from "../core/types.ts";

export type NamingPathKind = "file" | "directory";
export type NamingCaseStyle = "kebab-case" | "snake_case" | "camelCase" | "PascalCase";

export interface RawNamingRule {
  prefixes?: unknown[];
  pathKinds?: unknown[];
  requireCase?: unknown;
  forbiddenNames?: unknown[];
  extensions?: unknown[];
  reason?: string;
  onCreate?: EnforcementMode;
  onEdit?: EnforcementMode;
}

export interface RawNamingPolicyConfig {
  mode?: EnforcementMode;
  editMode?: EnforcementMode;
  rules?: RawNamingRule[];
  notes?: unknown[];
}

export interface NamingRule {
  prefixes: string[];
  pathKinds: NamingPathKind[];
  requireCase?: NamingCaseStyle;
  forbiddenNames: Set<string>;
  extensions: string[];
  reason?: string;
  onCreate: EnforcementMode;
  onEdit: EnforcementMode;
}

export interface NamingPolicyConfig {
  mode: EnforcementMode;
  editMode: EnforcementMode;
  rules: NamingRule[];
  notes: string[];
}

const DEFAULT_MODE: EnforcementMode = "warn";
const DEFAULT_EDIT_MODE: EnforcementMode = "warn";
const DEFAULT_PATH_KINDS: NamingPathKind[] = ["file"];
const VALID_CASE_STYLES: NamingCaseStyle[] = [
  "kebab-case",
  "snake_case",
  "camelCase",
  "PascalCase",
];

export function normalizeNamingPolicy(
  raw: RawNamingPolicyConfig | undefined,
): NamingPolicyConfig | undefined {
  if (raw !== undefined && (typeof raw !== "object" || raw === null || Array.isArray(raw))) {
    return undefined;
  }

  const candidate = raw ?? {};
  const mode = parseMode(candidate.mode, DEFAULT_MODE);
  const editMode = parseMode(candidate.editMode, DEFAULT_EDIT_MODE);
  const rules = (candidate.rules ?? [])
    .map((rule): NamingRule | undefined => {
      const prefixes = uniqueStrings(rule.prefixes, normalizePrefix);
      if (prefixes.length === 0) return undefined;

      const pathKinds = uniqueStrings(rule.pathKinds, parsePathKind).filter(
        (value): value is NamingPathKind => value === "file" || value === "directory",
      );
      const requireCase = parseCaseStyle(rule.requireCase);
      const forbiddenNames = new Set(
        uniqueStrings(rule.forbiddenNames, (value) => value.toLowerCase()),
      );
      const extensions = uniqueStrings(rule.extensions, normalizeExtension);
      const reason = typeof rule.reason === "string" ? rule.reason.trim() : undefined;

      if (!requireCase && forbiddenNames.size === 0) {
        return undefined;
      }

      return {
        prefixes,
        pathKinds: pathKinds.length > 0 ? pathKinds : DEFAULT_PATH_KINDS,
        requireCase,
        forbiddenNames,
        extensions,
        reason,
        onCreate: parseMode(rule.onCreate, mode),
        onEdit: parseMode(rule.onEdit, editMode),
      };
    })
    .filter((rule): rule is NamingRule => rule !== undefined);

  const notes = uniqueStrings(candidate.notes, (value) => value);

  if (rules.length === 0) {
    return undefined;
  }

  return {
    mode,
    editMode,
    rules,
    notes,
  };
}

export function evaluateNamingViolation(
  relativePath: string,
  exists: boolean,
  config: NamingPolicyConfig,
): Violation | undefined {
  for (const rule of config.rules) {
    const prefix = rule.prefixes.find((candidate) => relativePath.startsWith(candidate));
    if (!prefix) continue;

    const relativeToPrefix = relativePath.slice(prefix.length);
    const segments = relativeToPrefix.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    if (rule.pathKinds.includes("directory")) {
      for (const segment of segments.slice(0, -1)) {
        const issue = buildNamingIssue(segment, "directory", rule, prefix);
        if (issue) {
          return {
            policyId: "naming",
            mode: exists ? rule.onEdit : rule.onCreate,
            reason: issue,
          };
        }
      }
    }

    if (rule.pathKinds.includes("file")) {
      const fileSegment = segments[segments.length - 1];
      const extension = detectExtension(fileSegment);
      if (rule.extensions.length > 0 && (!extension || !rule.extensions.includes(extension))) {
        continue;
      }
      const stem = stripExtension(fileSegment, extension);
      const issue = buildNamingIssue(stem, "file", rule, prefix);
      if (issue) {
        return {
          policyId: "naming",
          mode: exists ? rule.onEdit : rule.onCreate,
          reason: issue,
        };
      }
    }
  }

  return undefined;
}

export function buildNamingPromptLines(config: NamingPolicyConfig): string[] {
  const lines = [
    `Default new-file mode: ${config.mode}.`,
    `Default existing-file edit mode: ${config.editMode}.`,
  ];

  lines.push("", "Naming rules:");
  for (const rule of config.rules) {
    const checks: string[] = [];
    if (rule.requireCase) {
      checks.push(`require ${rule.requireCase}`);
    }
    if (rule.forbiddenNames.size > 0) {
      checks.push(`forbid names ${[...rule.forbiddenNames].join(", ")}`);
    }
    if (rule.extensions.length > 0) {
      checks.push(`extensions ${rule.extensions.join(", ")}`);
    }
    lines.push(
      `- ${rule.prefixes.join(", ")} -> ${rule.pathKinds.join("+")} (${checks.join("; ")})`,
    );
    if (rule.reason) {
      lines.push(`  reason: ${rule.reason}`);
    }
  }

  if (config.notes.length > 0) {
    lines.push("", "Naming notes:");
    for (const note of config.notes) {
      lines.push(`- ${note}`);
    }
  }

  return lines;
}

function buildNamingIssue(
  name: string,
  kind: NamingPathKind,
  rule: NamingRule,
  prefix: string,
): string | undefined {
  if (rule.forbiddenNames.has(name.toLowerCase())) {
    return (
      rule.reason ??
      `Avoid generic ${kind} names like '${name}' under ${prefix}. Use a more responsibility-specific name instead.`
    );
  }

  if (rule.requireCase && !matchesCaseStyle(name, rule.requireCase)) {
    return (
      rule.reason ??
      `Use ${rule.requireCase} for ${kind} names under ${prefix}. Found '${name}'.`
    );
  }

  return undefined;
}

function parsePathKind(value: string): string {
  return value === "file" || value === "directory" ? value : "";
}

function parseCaseStyle(value: unknown): NamingCaseStyle | undefined {
  return typeof value === "string" && VALID_CASE_STYLES.includes(value as NamingCaseStyle)
    ? (value as NamingCaseStyle)
    : undefined;
}

function normalizeExtension(value: string): string {
  return value.replace(/^\./, "").toLowerCase();
}

function detectExtension(fileName: string): string | undefined {
  if (fileName.endsWith(".d.ts")) {
    return "d.ts";
  }
  const index = fileName.lastIndexOf(".");
  if (index <= 0 || index === fileName.length - 1) {
    return undefined;
  }
  return fileName.slice(index + 1).toLowerCase();
}

function stripExtension(fileName: string, extension: string | undefined): string {
  if (!extension) {
    return fileName;
  }
  return extension === "d.ts"
    ? fileName.slice(0, -".d.ts".length)
    : fileName.slice(0, -(extension.length + 1));
}

function matchesCaseStyle(name: string, style: NamingCaseStyle): boolean {
  switch (style) {
    case "kebab-case":
      return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
    case "snake_case":
      return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(name);
    case "camelCase":
      return /^[a-z][A-Za-z0-9]*$/.test(name) && !/[-_]/.test(name);
    case "PascalCase":
      return /^[A-Z][A-Za-z0-9]*$/.test(name) && !/[-_]/.test(name);
  }
}
