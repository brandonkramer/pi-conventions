/**
 * @fileoverview Runtime extension entrypoint for loading conventions, injecting guardrail prompts, and intercepting file mutations.
 */
import path from "node:path";
import {
	type ExtensionAPI,
	isToolCallEventType,
} from "@mariozechner/pi-coding-agent";
import { hasActivePolicies, loadState } from "./config.ts";
import { derivePostMutationContent } from "./content.ts";
import {
	describeScaffoldResult,
	getConventionsCommandArgumentCompletions,
	parseCreateTargetAlias,
	scaffoldConventions,
} from "./create.ts";
import {
	auditConventions,
	ChangedAuditError,
	checkConventionsPath,
	KNOWN_POLICY_IDS,
} from "./diagnostics.ts";
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
const ANSI_GREEN = "\x1b[32m";
const ANSI_RESET = "\x1b[0m";

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
				await notifyCommandResult(
					ctx,
					await handleAudit(rawTarget, ctx.cwd, state),
				);
				return;
			}

			if (!ctx.hasUI) {
				return;
			}
			if (state.config) {
				ctx.ui.notify(
					`conventions guard active: ${activePolicySummary(state.config)} via ${displayConfigSources(state.config)}`,
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
		if (state.warnings && ctx.hasUI) {
			for (const warning of state.warnings) {
				ctx.ui.notify(warning, "warning");
			}
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
			collectViolations(
				{ relativePath, exists, content, cwd: ctx.cwd },
				state.config,
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
	const tokens = rawTarget.split(/\s+/).filter(Boolean);
	const json = tokens.includes("--json");
	let policy: string | undefined;
	const positional: string[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token === "--json") continue;
		if (token === "--policy") {
			policy = tokens[++i];
			continue;
		}
		if (token.startsWith("--policy=")) {
			policy = token.slice("--policy=".length);
			continue;
		}
		positional.push(token);
	}
	const target = positional[0];
	if (!target) {
		return {
			message: "Usage: /conventions check <path> [--json] [--policy <name>]",
			level: "warning",
		};
	}
	if (state.error) return { message: state.error, level: "error" };
	if (!state.config || !hasActivePolicies(state.config)) {
		return {
			message: "No active conventions policies found.",
			level: "warning",
		};
	}
	if (policy && !KNOWN_POLICY_IDS.includes(policy as any)) {
		return {
			message: `Unknown policy '${policy}'. Known: ${KNOWN_POLICY_IDS.join(", ")}.`,
			level: "warning",
		};
	}
	return {
		message: await checkConventionsPath(cwd, state.config, target, {
			json,
			policy,
		}),
		level: "info",
	};
}

async function handleAudit(
	rawTarget: string,
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
	const tokens = rawTarget.split(/\s+/).filter(Boolean);
	const includeIgnored = tokens.includes("--include-ignored");
	const json = tokens.includes("--json");
	const changed = tokens.includes("--changed");
	let policy: string | undefined;
	const unknown: string[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (
			token === "--include-ignored" ||
			token === "--json" ||
			token === "--changed"
		)
			continue;
		if (token === "--policy") {
			policy = tokens[++i];
			continue;
		}
		if (token.startsWith("--policy=")) {
			policy = token.slice("--policy=".length);
			continue;
		}
		unknown.push(token);
	}
	if (unknown.length > 0) {
		return {
			message:
				"Usage: /conventions audit [--include-ignored] [--changed] [--json] [--policy <name>]",
			level: "warning",
		};
	}
	if (policy && !KNOWN_POLICY_IDS.includes(policy as any)) {
		return {
			message: `Unknown policy '${policy}'. Known: ${KNOWN_POLICY_IDS.join(", ")}.`,
			level: "warning",
		};
	}
	try {
		return {
			message: await auditConventions(cwd, state.config, {
				includeIgnored,
				changed,
				json,
				policy,
			}),
			level: "info",
		};
	} catch (error) {
		if (error instanceof ChangedAuditError) {
			return { message: error.message, level: "warning" };
		}
		throw error;
	}
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
	const lines = ["## Conventions"];

	if (config.policies.structure) {
		const policy = config.policies.structure;
		lines.push(
			`Structure policy: create ${policy.mode}; edit ${policy.editMode}; forbid segments ${policy.forbiddenSegments.join(", ")}.`,
		);
		for (const layer of policy.layers) {
			lines.push(`- zone ${layer.name}: ${layer.prefixes.join(", ")}`);
		}
		for (const zone of policy.legacyZones) {
			lines.push(
				`- legacy ${zone.prefixes.join(", ")}: create ${zone.onCreate}; edit ${zone.onEdit}; ${zone.reason}`,
			);
		}
		if (policy.newTopLevelFiles.enabled) {
			const allowed = [...policy.newTopLevelFiles.allowedFiles];
			const suffix =
				allowed.length > 0 ? ` allowed ${allowed.join(", ")};` : "";
			lines.push(
				`- new top-level files: ${policy.newTopLevelFiles.mode};${suffix} prefer declared zones.`,
			);
		}
	}

	if (config.policies.naming) {
		const policy = config.policies.naming;
		lines.push(
			`Naming policy: create ${policy.mode}; edit ${policy.editMode}.`,
		);
		for (const rule of policy.rules) {
			const checks = [
				rule.requireCase ? `case ${rule.requireCase}` : "",
				rule.forbiddenNames.size > 0
					? `forbid ${[...rule.forbiddenNames].join(",")}`
					: "",
				rule.extensions.length > 0 ? `ext ${rule.extensions.join(",")}` : "",
			]
				.filter(Boolean)
				.join("; ");
			lines.push(
				`- ${rule.prefixes.join(",")}: ${rule.pathKinds.join("+")}; ${checks}`,
			);
		}
	}

	if (config.policies.documentation) {
		const policy = config.policies.documentation;
		lines.push(
			`Documentation policy: create ${policy.mode}; edit ${policy.editMode}.`,
		);
		for (const rule of policy.rules) {
			lines.push(
				`- ${rule.paths.join(",")}: ${documentationRuleSummary(rule)}`,
			);
		}
	}

	if (config.policies.size) {
		const policy = config.policies.size;
		lines.push(`Size policy: create ${policy.mode}; edit ${policy.editMode}.`);
		for (const limit of policy.limits) {
			const checks = [
				limit.maxLines !== undefined ? `maxLines ${limit.maxLines}` : "",
				limit.maxBytes !== undefined ? `maxBytes ${limit.maxBytes}` : "",
				limit.extensions.length > 0 ? `ext ${limit.extensions.join(",")}` : "",
			]
				.filter(Boolean)
				.join("; ");
			const reason = limit.reason ? `; ${limit.reason}` : "";
			lines.push(
				`- ${limit.prefixes.join(",")}: ${checks}; create ${limit.onCreate}; edit ${limit.onEdit}${reason}`,
			);
		}
	}

	if (config.policies.dependencies) {
		const policy = config.policies.dependencies;
		lines.push(
			`Dependencies policy: create ${policy.mode}; edit ${policy.editMode}.`,
		);
		for (const rule of policy.rules) {
			const exclude =
				rule.exclude.length > 0 ? ` except ${rule.exclude.join(",")}` : "";
			const reason = rule.reason ? `; ${rule.reason}` : "";
			if (rule.to.length > 0) {
				const allow =
					rule.allow.length > 0 ? ` allow ${rule.allow.join(",")}` : "";
				lines.push(
					`- ${rule.from.join(",")}${exclude} -> no imports to ${rule.to.join(",")}${allow}; create ${rule.onCreate}; edit ${rule.onEdit}${reason}`,
				);
			}
			if (rule.forbidSpecifiers.length > 0) {
				const allow =
					rule.allowSpecifiers.length > 0
						? ` allow ${rule.allowSpecifiers.join(",")}`
						: "";
				lines.push(
					`- ${rule.from.join(",")}${exclude} -> no specifiers ${rule.forbidSpecifiers.join(",")}${allow}; create ${rule.onCreate}; edit ${rule.onEdit}${reason}`,
				);
			}
		}
	}

	if (config.policies.package) {
		const policy = config.policies.package;
		lines.push(
			`Package policy: create ${policy.mode}; edit ${policy.editMode}.`,
		);
		const checks: string[] = [];
		if (policy.requireFields.length > 0)
			checks.push(`fields ${policy.requireFields.join(",")}`);
		if (policy.requireFiles.length > 0)
			checks.push(`files ${policy.requireFiles.join(",")}`);
		if (policy.piRequireKeyword)
			checks.push(`keyword ${policy.piRequireKeyword}`);
		if (policy.piVerifyResourcePaths) checks.push("verify pi resource paths");
		if (policy.npmRequireFilesCoverage.length > 0)
			checks.push(`files coverage ${policy.npmRequireFilesCoverage.join(",")}`);
		if (checks.length > 0) {
			lines.push(`- ${policy.manifests.join(",")}: ${checks.join("; ")}`);
		}
	}

	return lines.join("\n");
}

function documentationRuleSummary(
	rule: NonNullable<
		ConventionsConfig["policies"]["documentation"]
	>["rules"][number],
): string {
	if (rule.kind === "requireTsdocOnExports") {
		return `TSDoc exports ${rule.declarations.join(",")}${rule.requireRemarks ? "; @remarks" : ""}`;
	}
	if (rule.kind === "requireFileOverview") {
		const sections =
			rule.requiredSections.length > 0
				? `; sections ${rule.requiredSections.join(",")}`
				: "";
		return `@fileoverview${sections}`;
	}
	if (rule.kind === "forbidFileHeaders") {
		return `forbid file headers ${rule.patterns.join(",")}`;
	}
	if (rule.kind === "forbidCommentPatterns") {
		return `forbid comments ${rule.patterns.join(",")}`;
	}
	if (rule.kind === "todoFormat") {
		return `TODO/FIXME ${rule.format}`;
	}
	return `rationale comments ${rule.commentKeywords.join(",")}`;
}

function activePolicySummary(config: ConventionsConfig): string {
	const policies: string[] = [];
	if (config.policies.structure) policies.push("structure");
	if (config.policies.naming) policies.push("naming");
	if (config.policies.documentation) policies.push("documentation");
	if (config.policies.size) policies.push("size");
	if (config.policies.dependencies) policies.push("dependencies");
	if (config.policies.package) policies.push("package");
	return policies.length > 0 ? policies.join(", ") : "no active policies";
}

function displayConfigSources(config: ConventionsConfig): string {
	const paths =
		config.sourcePaths && config.sourcePaths.length > 0
			? config.sourcePaths
			: [config.path];
	const labels = paths.map(displayConfigSourceLabel);
	const orderedLabels = ["global", "project"].filter((label) =>
		labels.includes(label),
	);
	const otherLabels = labels.filter((label) => !orderedLabels.includes(label));
	return [...orderedLabels, ...otherLabels]
		.map((v) => `${ANSI_GREEN}${v}${ANSI_RESET}`)
		.join(" + ");
}

function displayConfigSourceLabel(configPath: string): string {
	const home = process.env.HOME;
	if (
		home &&
		path.resolve(configPath) ===
			path.join(home, ".pi", "agent", "conventions.json")
	) {
		return "global";
	}
	if (path.basename(configPath) === "conventions.json") {
		return "project";
	}
	return `.pi/${path.basename(configPath)}`;
}

function statusText(state: LoadState): string {
	if (state.error) return "conventions: error";
	if (!state.config) return "conventions: none";
	const warning =
		state.warnings && state.warnings.length > 0 ? "; warnings" : "";
	return `conventions: (${displayConfigSources(state.config)}${warning})`;
}

function notifyLevel(state: LoadState): "info" | "warning" | "error" {
	if (state.error) return "error";
	if (!state.config || (state.warnings && state.warnings.length > 0))
		return "warning";
	return "info";
}

function policyDisplayName(policyId: string): string {
	return policyId.charAt(0).toUpperCase() + policyId.slice(1);
}
