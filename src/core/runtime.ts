import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type ExtensionAPI,
  isToolCallEventType,
} from "@mariozechner/pi-coding-agent";
import {
  buildDocumentationPromptLines,
  evaluateDocumentationViolation,
} from "../policies/documentation.ts";
import {
  buildNamingPromptLines,
  evaluateNamingViolation,
} from "../policies/naming.ts";
import {
  buildStructurePromptLines,
  evaluateStructureViolation,
} from "../policies/structure.ts";
import { hasActivePolicies, loadState } from "./config.ts";
import {
  describeScaffoldResult,
  getConventionsCommandArgumentCompletions,
  parseCreateTargetAlias,
  scaffoldConventions,
} from "./create.ts";
import {
  normalizeRelativePath,
  normalizeToolPath,
  pathExists,
} from "./path.ts";
import type { ConventionsConfig, LoadState, Violation } from "./types.ts";

const STATUS_KEY = "conventions";
const MODE_PRIORITY = {
  warn: 1,
  confirm: 2,
  block: 3,
} as const;

export default function conventionsGuard(pi: ExtensionAPI) {
  let cachedState: LoadState | undefined;

  const ensureState = async (
    cwd: string,
    forceReload = false,
  ): Promise<LoadState> => {
    const cwdKey = path.resolve(cwd);
    const existingState = cachedState;
    if (!forceReload && existingState?.cwdKey === cwdKey) {
      return existingState;
    }
    const loadedState = await loadState(cwdKey);
    cachedState = loadedState;
    return loadedState;
  };

  const updateStatus = (
    ctx: { ui: { setStatus: (key: string, value?: string) => void } },
    state: LoadState,
  ) => {
    ctx.ui.setStatus(STATUS_KEY, statusText(state));
  };

  pi.registerCommand("conventions", {
    description: "Show, reload, or create the active conventions policy",
    getArgumentCompletions: getConventionsCommandArgumentCompletions,
    handler: async (args, ctx) => {
      const trimmed = (args || "status").trim().toLowerCase();
      const [action = "status", rawTarget] =
        trimmed.length > 0 ? trimmed.split(/\s+/, 2) : ["status"];

      if (action === "create") {
        const explicitTarget = parseCreateTargetAlias(rawTarget);
        if (rawTarget && !explicitTarget) {
          const message = `Unknown create target '${rawTarget}'. Use rust, typescript, ts, go, python, or fallback.`;
          if (ctx.hasUI) {
            ctx.ui.notify(message, "error");
            return;
          }
          throw new Error(message);
        }

        try {
          const result = await scaffoldConventions(pi, ctx, explicitTarget);
          if (ctx.hasUI) {
            (ctx.ui.notify as (message: string, level: string) => void)(
              `${describeScaffoldResult(result)}. Reloading…`,
              "success",
            );
          }
          await ctx.reload();
          return;
        } catch (error: any) {
          if (ctx.hasUI) {
            ctx.ui.notify(
              error.message,
              error.message === "Cancelled by user." ? "warning" : "error",
            );
            return;
          }
          throw error;
        }
      }

      const state = await ensureState(ctx.cwd, action === "reload");
      updateStatus(ctx, state);
      if (!ctx.hasUI) {
        return;
      }
      if (state.config) {
        ctx.ui.notify(
          `conventions guard active: ${activePolicySummary(state.config)} via ${state.config.path}`,
          notifyLevel(state),
        );
      } else if (state.error) {
        ctx.ui.notify(state.error, "error");
      } else {
        ctx.ui.notify(
          "No .pi/conventions.json found for this project.",
          "warning",
        );
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const state = await ensureState(ctx.cwd, true);
    updateStatus(ctx, state);
    if (state.error && ctx.hasUI) {
      ctx.ui.notify(state.error, "error");
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const state = await ensureState(ctx.cwd);
    if (!state.config || !hasActivePolicies(state.config)) {
      return undefined;
    }
    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildSystemPrompt(state.config)}`,
    };
  });

  pi.on("tool_call", async (event, ctx) => {
    const isWrite = isToolCallEventType("write", event);
    const isEdit = isToolCallEventType("edit", event);
    if (!isWrite && !isEdit) {
      return undefined;
    }

    const state = await ensureState(ctx.cwd);
    if (!state.config || !hasActivePolicies(state.config)) {
      return undefined;
    }

    event.input.path = normalizeToolPath(event.input.path);
    const relativePath = normalizeRelativePath(event.input.path);
    const absolutePath = path.resolve(ctx.cwd, relativePath);
    const exists = await pathExists(absolutePath);
    const postMutationContent = state.config.policies.documentation
      ? await derivePostMutationContent(event.input, absolutePath, isWrite)
      : undefined;
    const violation = strongestViolation(
      collectViolations(
        relativePath,
        exists,
        state.config,
        postMutationContent,
      ),
    );

    if (!violation) {
      return undefined;
    }

    const reason = `${policyDisplayName(violation.policyId)} policy: ${violation.reason} Path: ${relativePath}`;
    if (violation.mode === "warn") {
      if (ctx.hasUI) {
        ctx.ui.notify(reason, "warning");
      }
      return undefined;
    }

    if (violation.mode === "confirm") {
      if (!ctx.hasUI) {
        return {
          block: true,
          reason: `Conventions guard requires confirmation, but no UI is available. ${reason}`,
        };
      }
      const ok = await ctx.ui.confirm(
        "Conventions Guard",
        `${reason}\n\nAllow this mutation anyway?`,
      );
      if (ok) {
        return undefined;
      }
    }

    return {
      block: true,
      reason: `Blocked by conventions guard. ${reason}`,
    };
  });
}

function collectViolations(
  relativePath: string,
  exists: boolean,
  config: ConventionsConfig,
  postMutationContent?: string,
): Violation[] {
  const violations: Violation[] = [];

  if (config.policies.structure) {
    const violation = evaluateStructureViolation(
      relativePath,
      exists,
      config.policies.structure,
    );
    if (violation) {
      violations.push(violation);
    }
  }

  if (config.policies.naming) {
    const violation = evaluateNamingViolation(
      relativePath,
      exists,
      config.policies.naming,
    );
    if (violation) {
      violations.push(violation);
    }
  }

  if (config.policies.documentation && postMutationContent !== undefined) {
    const violation = evaluateDocumentationViolation(
      relativePath,
      exists,
      postMutationContent,
      config.policies.documentation,
    );
    if (violation) {
      violations.push(violation);
    }
  }

  return violations;
}

async function derivePostMutationContent(
  input: {
    content?: unknown;
    oldText?: unknown;
    newText?: unknown;
    edits?: unknown;
  },
  absolutePath: string,
  isWrite: boolean,
): Promise<string | undefined> {
  if (isWrite) {
    return typeof input.content === "string" ? input.content : undefined;
  }

  const edits = normalizeEditInputs(input);
  if (edits.length === 0) {
    return undefined;
  }

  try {
    const currentContent = await readFile(absolutePath, "utf8");
    return applyExactEdits(currentContent, edits);
  } catch {
    return undefined;
  }
}

function normalizeEditInputs(input: {
  oldText?: unknown;
  newText?: unknown;
  edits?: unknown;
}): Array<{ oldText: string; newText: string }> {
  if (typeof input.oldText === "string" && typeof input.newText === "string") {
    return [{ oldText: input.oldText, newText: input.newText }];
  }
  if (!Array.isArray(input.edits)) {
    return [];
  }
  const edits: Array<{ oldText: string; newText: string }> = [];
  for (const edit of input.edits) {
    if (
      typeof edit?.oldText !== "string" ||
      typeof edit?.newText !== "string"
    ) {
      return [];
    }
    edits.push({ oldText: edit.oldText, newText: edit.newText });
  }
  return edits;
}

function applyExactEdits(
  content: string,
  edits: Array<{ oldText: string; newText: string }>,
): string | undefined {
  const ranges: Array<{ start: number; end: number; newText: string }> = [];
  for (const edit of edits) {
    const start = content.indexOf(edit.oldText);
    if (
      start === -1 ||
      content.indexOf(edit.oldText, start + edit.oldText.length) !== -1
    ) {
      return undefined;
    }
    ranges.push({
      start,
      end: start + edit.oldText.length,
      newText: edit.newText,
    });
  }

  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start < ranges[index - 1].end) {
      return undefined;
    }
  }

  let result = content;
  for (const range of ranges.reverse()) {
    result = `${result.slice(0, range.start)}${range.newText}${result.slice(range.end)}`;
  }
  return result;
}

function strongestViolation(violations: Violation[]): Violation | undefined {
  return violations.reduce<Violation | undefined>((strongest, current) => {
    if (!strongest) {
      return current;
    }
    return MODE_PRIORITY[current.mode] > MODE_PRIORITY[strongest.mode]
      ? current
      : strongest;
  }, undefined);
}

function buildSystemPrompt(config: ConventionsConfig): string {
  const lines = ["## Project Conventions Guardrails"];

  if (config.policies.structure) {
    lines.push(
      "",
      "Structure policy:",
      ...buildStructurePromptLines(config.policies.structure),
    );
  }

  if (config.policies.naming) {
    lines.push(
      "",
      "Naming policy:",
      ...buildNamingPromptLines(config.policies.naming),
    );
  }

  if (config.policies.documentation) {
    lines.push(
      "",
      "Documentation policy:",
      ...buildDocumentationPromptLines(config.policies.documentation),
    );
  }

  if (config.notes.length > 0) {
    lines.push("", "Project notes:");
    for (const note of config.notes) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join("\n");
}

function activePolicySummary(config: ConventionsConfig): string {
  const policies: string[] = [];
  if (config.policies.structure) {
    policies.push("structure");
  }
  if (config.policies.naming) {
    policies.push("naming");
  }
  if (config.policies.documentation) {
    policies.push("documentation");
  }
  return policies.length > 0 ? policies.join(", ") : "no active policies";
}

function displayConfigPath(configPath: string): string {
  const home = process.env.HOME;
  if (
    home &&
    configPath.startsWith(path.join(home, ".pi", "agent") + path.sep)
  ) {
    return `~/.pi/agent/${path.basename(configPath)}`;
  }
  return `.pi/${path.basename(configPath)}`;
}

function statusText(state: LoadState): string {
  if (state.error) {
    return "conventions: error";
  }
  if (!state.config) {
    return "conventions: none";
  }
  return `conventions: (${displayConfigPath(state.config.path)})`;
}

function notifyLevel(state: LoadState): "info" | "warning" | "error" {
  if (state.error) return "error";
  if (!state.config) return "warning";
  return "info";
}

function policyDisplayName(policyId: string): string {
  if (policyId === "structure") {
    return "Structure";
  }
  if (policyId === "naming") {
    return "Naming";
  }
  if (policyId === "documentation") {
    return "Documentation";
  }
  return policyId.charAt(0).toUpperCase() + policyId.slice(1);
}
