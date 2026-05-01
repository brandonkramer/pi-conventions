import path from "node:path";
import {
	type ExtensionAPI,
	isToolCallEventType,
} from "@mariozechner/pi-coding-agent";
import { buildDocumentationPromptLines } from "../policies/documentation.ts";
import { buildNamingPromptLines } from "../policies/naming.ts";
import { buildSizePromptLines } from "../policies/size.ts";
import { buildStructurePromptLines } from "../policies/structure.ts";
import { hasActivePolicies, loadState } from "./config.ts";
import { derivePostMutationContent } from "./content.ts";
import {
	describeScaffoldResult,
	getConventionsCommandArgumentCompletions,
	parseCreateTargetAlias,
	scaffoldConventions,
} from "./create.ts";
import { auditConventions, checkConventionsPath } from "./diagnostics.ts";
import {
	collectViolations,
	needsContentForPath,
	strongestViolation,
} from "./evaluate.ts";
import {
	normalizeRelativePath,
	normalizeToolPath,
	pathExists,
} from "./path.ts";
import type { ConventionsConfig, LoadState } from "./types.ts";

const STATUS_KEY = "conventions";

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
		description: "Show, reload, create, check, or audit conventions policies",
		getArgumentCompletions: getConventionsCommandArgumentCompletions,
		handler: async (args, ctx) => {
			const rawArgs = (args || "status").trim();
			const [actionRaw = "status", ...rest] =
				rawArgs.length > 0 ? rawArgs.split(/\s+/) : ["status"];
			const action = actionRaw.toLowerCase();
			const rawTarget = rest.join(" ").trim();

			if (action === "create") {
				await handleCreate(rawTarget, pi, ctx);
				return;
			}

			const state = await ensureState(ctx.cwd, action === "reload");
			updateStatus(ctx, state);

			if (action === "check") {
				await notifyCommandResult(
					ctx,
					await handleCheck(rawTarget, ctx.cwd, state),
				);
				return;
			}
			if (action === "audit") {
				await notifyCommandResult(ctx, await handleAudit(ctx.cwd, state));
				return;
			}

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
		const content = needsContentForPath(relativePath, state.config)
			? await derivePostMutationContent(event.input, absolutePath, isWrite)
			: undefined;
		const violation = strongestViolation(
			collectViolations({ relativePath, exists, content }, state.config),
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

async function handleCreate(
	rawTarget: string,
	pi: ExtensionAPI,
	ctx: any,
): Promise<void> {
	const explicitTarget = parseCreateTargetAlias(rawTarget || undefined);
	if (rawTarget && !explicitTarget) {
		const message = `Unknown create target '${rawTarget}'. Use rust, typescript, ts, go, python, documentation, or fallback.`;
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

async function handleCheck(
	rawTarget: string,
	cwd: string,
	state: LoadState,
): Promise<{ message: string; level: "info" | "warning" | "error" }> {
	if (!rawTarget) {
		return { message: "Usage: /conventions check <path>", level: "warning" };
	}
	if (state.error) return { message: state.error, level: "error" };
	if (!state.config || !hasActivePolicies(state.config)) {
		return {
			message: "No active conventions policies found.",
			level: "warning",
		};
	}
	return {
		message: await checkConventionsPath(cwd, state.config, rawTarget),
		level: "info",
	};
}

async function handleAudit(
	cwd: string,
	state: LoadState,
): Promise<{ message: string; level: "info" | "warning" | "error" }> {
	if (state.error) return { message: state.error, level: "error" };
	if (!state.config || !hasActivePolicies(state.config)) {
		return {
			message: "No active conventions policies found.",
			level: "warning",
		};
	}
	return { message: await auditConventions(cwd, state.config), level: "info" };
}

async function notifyCommandResult(
	ctx: any,
	result: { message: string; level: "info" | "warning" | "error" },
): Promise<void> {
	if (ctx.hasUI) {
		ctx.ui.notify(result.message, result.level);
	}
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

	if (config.policies.size) {
		lines.push(
			"",
			"Size policy:",
			...buildSizePromptLines(config.policies.size),
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
	if (config.policies.structure) policies.push("structure");
	if (config.policies.naming) policies.push("naming");
	if (config.policies.documentation) policies.push("documentation");
	if (config.policies.size) policies.push("size");
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
	if (state.error) return "conventions: error";
	if (!state.config) return "conventions: none";
	return `conventions: (${displayConfigPath(state.config.path)})`;
}

function notifyLevel(state: LoadState): "info" | "warning" | "error" {
	if (state.error) return "error";
	if (!state.config) return "warning";
	return "info";
}

function policyDisplayName(policyId: string): string {
	if (policyId === "structure") return "Structure";
	if (policyId === "naming") return "Naming";
	if (policyId === "documentation") return "Documentation";
	if (policyId === "size") return "Size";
	return policyId.charAt(0).toUpperCase() + policyId.slice(1);
}
