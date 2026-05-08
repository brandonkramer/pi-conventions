import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { needsContentForPath } from "../src/core/evaluate.ts";
import conventionsGuard from "../src/index.ts";
import { normalizeDependenciesPolicy } from "../src/policies/dependencies.ts";
import { normalizeDocumentationPolicy } from "../src/policies/documentation.ts";
import {
	createTempDir,
	removeTempDir,
	writeJson,
	writeText,
} from "./helpers.ts";

async function runGit(cwd: string, args: string[]): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		execFile("git", args, { cwd }, (error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

function createHarness() {
	const handlers = new Map<string, Function>();
	const commands = new Map<string, any>();
	const pi = {
		registerCommand: (name: string, command: any) => {
			commands.set(name, command);
		},
		on: (name: string, handler: Function) => {
			handlers.set(name, handler);
		},
	} as unknown as ExtensionAPI;

	conventionsGuard(pi);
	return { handlers, commands };
}

describe("runtime documentation policy", () => {
	it("evaluates documentation violations against write content", async () => {
		const repo = await createTempDir("pcg-runtime-doc-write-");
		try {
			await writeJson(repo, ".pi/conventions.json", {
				policies: {
					documentation: {
						mode: "confirm",
						rules: [
							{
								kind: "todoFormat",
								paths: ["src/**"],
								allowedTags: ["TODO"],
							},
						],
					},
				},
			});
			const { handlers } = createHarness();
			const result = await handlers.get("tool_call")!(
				{
					toolName: "write",
					toolCallId: "call-1",
					input: {
						path: "src/task.ts",
						content: "// TODO missing colon\n",
					},
				},
				{ cwd: repo, hasUI: false, ui: { notify: () => undefined } },
			);

			expect(result).toMatchObject({ block: true });
			expect(result.reason).toContain("Documentation policy");
			expect(result.reason).toContain("TODO: description");
		} finally {
			await removeTempDir(repo);
		}
	});

	it("evaluates documentation violations against derived edit content", async () => {
		const repo = await createTempDir("pcg-runtime-doc-edit-");
		try {
			await writeJson(repo, ".pi/conventions.json", {
				policies: {
					documentation: {
						mode: "warn",
						editMode: "confirm",
						rules: [
							{
								kind: "requireTsdocOnExports",
								paths: ["src/**"],
								declarations: ["function"],
							},
						],
					},
				},
			});
			await writeText(repo, "src/tool.ts", "const value = 1;\n");
			const { handlers } = createHarness();
			const result = await handlers.get("tool_call")!(
				{
					toolName: "edit",
					toolCallId: "call-1",
					input: {
						path: "src/tool.ts",
						edits: [
							{
								oldText: "const value = 1;",
								newText: "export function toolResult() {}",
							},
						],
					},
				},
				{ cwd: repo, hasUI: false, ui: { notify: () => undefined } },
			);

			expect(result).toMatchObject({ block: true });
			expect(result.reason).toContain("needs TSDoc");
		} finally {
			await removeTempDir(repo);
		}
	});

	it("prefilters paths before content-based documentation checks", () => {
		const documentation = normalizeDocumentationPolicy({
			rules: [{ kind: "todoFormat", paths: ["docs/**"] }],
		});

		expect(
			needsContentForPath("src/other.ts", {
				path: ".pi/conventions.json",
				ignorePaths: [],
				ignoreMatchers: [],
				notes: [],
				policies: { documentation },
			}),
		).toBe(false);
		expect(
			needsContentForPath("docs/notes.ts", {
				path: ".pi/conventions.json",
				ignorePaths: [],
				ignoreMatchers: [],
				notes: [],
				policies: { documentation },
			}),
		).toBe(true);
	});
});

describe("runtime dependencies policy", () => {
	it("evaluates dependency violations against write content", async () => {
		const repo = await createTempDir("pcg-runtime-dependencies-write-");
		try {
			await writeJson(repo, ".pi/conventions.json", {
				policies: {
					dependencies: {
						mode: "block",
						rules: [
							{
								from: ["src/**/*.ts"],
								exclude: ["src/extract/**"],
								to: ["src/extract/verticals/**"],
								reason:
									"Vertical extractors are reached through src/extract/registry.ts only.",
							},
						],
					},
				},
			});
			const { handlers } = createHarness();
			const result = await handlers.get("tool_call")!(
				{
					toolName: "write",
					toolCallId: "call-1",
					input: {
						path: "src/features/reddit.ts",
						content:
							"import { reddit } from '../extract/verticals/reddit.js';\n",
					},
				},
				{ cwd: repo, hasUI: false, ui: { notify: () => undefined } },
			);

			expect(result).toMatchObject({ block: true });
			expect(result.reason).toContain("Dependencies policy");
			expect(result.reason).toContain("registry.ts");
		} finally {
			await removeTempDir(repo);
		}
	});

	it("prefilters paths before dependency checks", () => {
		const dependencies = normalizeDependenciesPolicy({
			rules: [
				{
					from: ["src/**/*.ts"],
					exclude: ["src/extract/**"],
					to: ["src/extract/verticals/**"],
				},
			],
		});

		expect(
			needsContentForPath("src/extract/registry.ts", {
				path: ".pi/conventions.json",
				ignorePaths: [],
				ignoreMatchers: [],
				notes: [],
				policies: { dependencies },
			}),
		).toBe(false);
		expect(
			needsContentForPath("src/features/reddit.ts", {
				path: ".pi/conventions.json",
				ignorePaths: [],
				ignoreMatchers: [],
				notes: [],
				policies: { dependencies },
			}),
		).toBe(true);
	});
});

describe("runtime diagnostics commands", () => {
	it("reports check and audit findings with the non-Git fallback walker", async () => {
		const repo = await createTempDir("pcg-runtime-diagnostics-");
		try {
			await writeJson(repo, ".pi/conventions.json", {
				policies: {
					size: {
						limits: [{ prefixes: ["src/"], extensions: ["ts"], maxLines: 1 }],
					},
				},
			});
			await writeText(repo, "src/big.ts", "one\ntwo\n");
			const { commands } = createHarness();
			const messages: string[] = [];
			const ctx = {
				cwd: repo,
				hasUI: true,
				ui: {
					setStatus: () => undefined,
					notify: (message: string) => messages.push(message),
				},
			};

			await commands.get("conventions").handler("check src/big.ts", ctx);
			await commands.get("conventions").handler("audit", ctx);

			expect(messages.join("\n")).toContain("Conventions check");
			expect(messages.join("\n")).toContain("Conventions audit");
			expect(messages.join("\n")).toContain("maxLines");
		} finally {
			await removeTempDir(repo);
		}
	});

	it("uses Git-visible files for audit discovery in Git repos", async () => {
		const repo = await createTempDir("pcg-runtime-audit-git-");
		try {
			await runGit(repo, ["init"]);
			await writeJson(repo, ".pi/conventions.json", {
				policies: {
					size: {
						limits: [{ prefixes: ["src/"], extensions: ["ts"], maxLines: 1 }],
					},
				},
			});
			await writeText(repo, ".gitignore", "src/ignored.ts\n");
			await writeText(repo, ".git/info/exclude", "src/info-ignored.ts\n");
			await writeText(repo, "src/tracked.ts", "one\ntwo\n");
			await writeText(repo, "src/untracked.ts", "one\ntwo\n");
			await writeText(repo, "src/ignored.ts", "one\ntwo\n");
			await writeText(repo, "src/info-ignored.ts", "one\ntwo\n");
			await runGit(repo, ["add", ".gitignore", "src/tracked.ts"]);

			const { commands } = createHarness();
			const messages: string[] = [];
			const ctx = {
				cwd: repo,
				hasUI: true,
				ui: {
					setStatus: () => undefined,
					notify: (message: string) => messages.push(message),
				},
			};

			await commands.get("conventions").handler("audit", ctx);
			const audit = messages[messages.length - 1] ?? "";

			expect(audit).toContain("src/tracked.ts");
			expect(audit).toContain("src/untracked.ts");
			expect(audit).not.toContain("src/ignored.ts");
			expect(audit).not.toContain("src/info-ignored.ts");
		} finally {
			await removeTempDir(repo);
		}
	});

	it("can include ignored files with the audit fallback walker", async () => {
		const repo = await createTempDir("pcg-runtime-audit-include-ignored-");
		try {
			await runGit(repo, ["init"]);
			await writeJson(repo, ".pi/conventions.json", {
				policies: {
					size: {
						limits: [{ prefixes: ["src/"], extensions: ["ts"], maxLines: 1 }],
					},
				},
			});
			await writeText(repo, ".gitignore", "src/ignored.ts\n");
			await writeText(repo, "src/ignored.ts", "one\ntwo\n");

			const { commands } = createHarness();
			const messages: string[] = [];
			const ctx = {
				cwd: repo,
				hasUI: true,
				ui: {
					setStatus: () => undefined,
					notify: (message: string) => messages.push(message),
				},
			};

			await commands.get("conventions").handler("audit --include-ignored", ctx);

			expect(messages[messages.length - 1]).toContain("src/ignored.ts");
		} finally {
			await removeTempDir(repo);
		}
	});
});

describe("runtime extendsGlobal layering", () => {
	it("uses inherited global policies for tool calls, check, audit, and system prompt", async () => {
		const home = await createTempDir("pcg-runtime-extend-home-");
		const repo = await createTempDir("pcg-runtime-extend-repo-");
		const originalHome = process.env.HOME;

		try {
			process.env.HOME = home;
			await writeJson(home, ".pi/agent/conventions.json", {
				policies: {
					size: {
						mode: "confirm",
						limits: [{ prefixes: ["src/"], extensions: ["ts"], maxLines: 1 }],
					},
				},
			});
			await writeJson(repo, ".pi/conventions.json", {
				extendsGlobal: true,
				policies: {
					naming: {
						rules: [{ prefixes: ["src/"], requireCase: "kebab-case" }],
					},
				},
			});
			await writeText(repo, "src/big.ts", "one\ntwo\n");

			const { commands, handlers } = createHarness();
			const messages: string[] = [];
			const ctx = {
				cwd: repo,
				hasUI: true,
				ui: {
					setStatus: () => undefined,
					notify: (message: string) => messages.push(message),
				},
			};

			const toolResult = await handlers.get("tool_call")!(
				{
					toolName: "write",
					toolCallId: "call-1",
					input: { path: "src/huge.ts", content: "one\ntwo\n" },
				},
				{ cwd: repo, hasUI: false, ui: { notify: () => undefined } },
			);
			const promptResult = await handlers.get("before_agent_start")!(
				{ systemPrompt: "base" },
				{ cwd: repo },
			);
			await commands.get("conventions").handler("check src/big.ts", ctx);
			await commands.get("conventions").handler("audit", ctx);

			expect(toolResult).toMatchObject({ block: true });
			expect(toolResult.reason).toContain("Size policy");
			expect(promptResult.systemPrompt).toContain("Size policy");
			expect(promptResult.systemPrompt).toContain("Naming policy");
			expect(messages.join("\n")).toContain("Conventions check");
			expect(messages.join("\n")).toContain("Conventions audit");
			expect(messages.join("\n")).toContain("maxLines");
		} finally {
			process.env.HOME = originalHome;
			await removeTempDir(repo);
			await removeTempDir(home);
		}
	});
});

describe("runtime size policy", () => {
	it("evaluates size violations against write content", async () => {
		const repo = await createTempDir("pcg-runtime-size-write-");
		try {
			await writeJson(repo, ".pi/conventions.json", {
				policies: {
					size: {
						mode: "confirm",
						limits: [{ prefixes: ["src/"], extensions: ["ts"], maxLines: 1 }],
					},
				},
			});
			const { handlers } = createHarness();
			const result = await handlers.get("tool_call")!(
				{
					toolName: "write",
					toolCallId: "call-1",
					input: { path: "src/big.ts", content: "one\ntwo\n" },
				},
				{ cwd: repo, hasUI: false, ui: { notify: () => undefined } },
			);

			expect(result).toMatchObject({ block: true });
			expect(result.reason).toContain("Size policy");
			expect(result.reason).toContain("maxLines");
		} finally {
			await removeTempDir(repo);
		}
	});

	it("evaluates size violations against derived edit content", async () => {
		const repo = await createTempDir("pcg-runtime-size-edit-");
		try {
			await writeJson(repo, ".pi/conventions.json", {
				policies: {
					size: {
						mode: "warn",
						editMode: "confirm",
						limits: [{ prefixes: ["src/"], extensions: ["ts"], maxLines: 1 }],
					},
				},
			});
			await writeText(repo, "src/file.ts", "one\n");
			const { handlers } = createHarness();
			const result = await handlers.get("tool_call")!(
				{
					toolName: "edit",
					toolCallId: "call-1",
					input: {
						path: "src/file.ts",
						oldText: "one",
						newText: "one\ntwo",
					},
				},
				{ cwd: repo, hasUI: false, ui: { notify: () => undefined } },
			);

			expect(result).toMatchObject({ block: true });
			expect(result.reason).toContain("maxLines");
		} finally {
			await removeTempDir(repo);
		}
	});
});

describe("runtime ignorePaths", () => {
	it("skips ignored paths during tool_call evaluation", async () => {
		const repo = await createTempDir("pcg-runtime-ignore-");
		try {
			await writeJson(repo, ".pi/conventions.json", {
				ignorePaths: ["vendor/**", "**/*.generated.ts"],
				policies: {
					size: {
						mode: "block",
						limits: [{ prefixes: ["src/"], extensions: ["ts"], maxLines: 1 }],
					},
				},
			});
			const { handlers } = createHarness();

			const ignored = await handlers.get("tool_call")!(
				{
					toolName: "write",
					toolCallId: "call-1",
					input: { path: "vendor/lib.ts", content: "one\ntwo\n" },
				},
				{ cwd: repo, hasUI: false, ui: { notify: () => undefined } },
			);
			expect(ignored).toBeUndefined();

			const ignoredGlob = await handlers.get("tool_call")!(
				{
					toolName: "write",
					toolCallId: "call-2",
					input: { path: "src/types.generated.ts", content: "one\ntwo\n" },
				},
				{ cwd: repo, hasUI: false, ui: { notify: () => undefined } },
			);
			expect(ignoredGlob).toBeUndefined();

			const notIgnored = await handlers.get("tool_call")!(
				{
					toolName: "write",
					toolCallId: "call-3",
					input: { path: "src/types.ts", content: "one\ntwo\n" },
				},
				{ cwd: repo, hasUI: false, ui: { notify: () => undefined } },
			);
			expect(notIgnored).toMatchObject({ block: true });
		} finally {
			await removeTempDir(repo);
		}
	});

	it("skips ignored paths in audit output", async () => {
		const repo = await createTempDir("pcg-runtime-ignore-audit-");
		try {
			await writeJson(repo, ".pi/conventions.json", {
				ignorePaths: ["vendor/**"],
				policies: {
					size: {
						limits: [
							{
								prefixes: ["src/", "vendor/"],
								extensions: ["ts"],
								maxLines: 1,
							},
						],
					},
				},
			});
			await writeText(repo, "src/file.ts", "one\ntwo\n");
			await writeText(repo, "vendor/lib.ts", "one\ntwo\n");
			await runGit(repo, ["init", "--quiet"]);
			await runGit(repo, ["add", "-A"]);

			const { commands } = createHarness();
			const messages: string[] = [];
			const ctx = {
				cwd: repo,
				hasUI: true,
				ui: {
					setStatus: () => undefined,
					notify: (message: string) => messages.push(message),
				},
			};
			await commands.get("conventions").handler("audit", ctx);
			const auditMessage = messages[messages.length - 1] ?? "";

			expect(auditMessage).toContain("src/file.ts");
			expect(auditMessage).not.toContain("vendor/lib.ts");
		} finally {
			await removeTempDir(repo);
		}
	});
});

describe("runtime rule ids in diagnostics", () => {
	it("includes rule ids in check output when configured", async () => {
		const repo = await createTempDir("pcg-runtime-rule-id-");
		try {
			await writeJson(repo, ".pi/conventions.json", {
				policies: {
					naming: {
						rules: [
							{
								id: "naming.components.pascal",
								prefixes: ["src/components/"],
								pathKinds: ["file"],
								requireCase: "PascalCase",
							},
						],
					},
				},
			});
			const { commands } = createHarness();
			const messages: string[] = [];
			const ctx = {
				cwd: repo,
				hasUI: true,
				ui: {
					setStatus: () => undefined,
					notify: (message: string) => messages.push(message),
				},
			};
			await commands
				.get("conventions")
				.handler("check src/components/button.tsx", ctx);
			const checkMessage = messages[messages.length - 1] ?? "";

			expect(checkMessage).toContain("naming:naming.components.pascal");
		} finally {
			await removeTempDir(repo);
		}
	});
});

describe("runtime audit JSON and policy filter", () => {
	async function runConventions(repo: string, args: string): Promise<string> {
		const { commands } = createHarness();
		const messages: string[] = [];
		const ctx = {
			cwd: repo,
			hasUI: true,
			ui: {
				setStatus: () => undefined,
				notify: (message: string) => messages.push(message),
			},
		};
		await commands.get("conventions").handler(args, ctx);
		return messages[messages.length - 1] ?? "";
	}

	it("emits stable JSON for audit --json", async () => {
		const repo = await createTempDir("pcg-runtime-audit-json-");
		try {
			await writeJson(repo, ".pi/conventions.json", {
				policies: {
					size: {
						limits: [
							{
								id: "size.cap",
								prefixes: ["src/"],
								extensions: ["ts"],
								maxLines: 1,
							},
						],
					},
				},
			});
			await writeText(repo, "src/file.ts", "one\ntwo\n");
			await runGit(repo, ["init", "--quiet"]);
			await runGit(repo, ["add", "-A"]);

			const output = await runConventions(repo, "audit --json");
			const parsed = JSON.parse(output);
			expect(parsed.findings).toHaveLength(1);
			expect(parsed.findings[0]).toMatchObject({
				path: "src/file.ts",
				policyId: "size",
				ruleId: "size.cap",
				mode: "warn",
			});
			expect(typeof parsed.findings[0].reason).toBe("string");
		} finally {
			await removeTempDir(repo);
		}
	});

	it("filters audit by --policy name", async () => {
		const repo = await createTempDir("pcg-runtime-audit-policy-");
		try {
			await writeJson(repo, ".pi/conventions.json", {
				policies: {
					size: {
						limits: [{ prefixes: ["src/"], extensions: ["ts"], maxLines: 1 }],
					},
					documentation: {
						rules: [
							{
								kind: "requireFileOverview",
								paths: ["src/**"],
							},
						],
					},
				},
			});
			await writeText(repo, "src/file.ts", "one\ntwo\n");
			await runGit(repo, ["init", "--quiet"]);
			await runGit(repo, ["add", "-A"]);

			const sizeOnly = await runConventions(repo, "audit --policy size");
			expect(sizeOnly).toContain("Size");
			expect(sizeOnly).not.toContain("Documentation");

			const docsJson = await runConventions(
				repo,
				"audit --json --policy documentation",
			);
			const parsed = JSON.parse(docsJson);
			expect(parsed.findings.length).toBeGreaterThan(0);
			for (const finding of parsed.findings) {
				expect(finding.policyId).toBe("documentation");
			}
		} finally {
			await removeTempDir(repo);
		}
	});

	it("reports usage on unknown policy filter", async () => {
		const repo = await createTempDir("pcg-runtime-audit-bad-policy-");
		try {
			await writeJson(repo, ".pi/conventions.json", {
				policies: {
					size: {
						limits: [{ prefixes: ["src/"], extensions: ["ts"], maxLines: 1 }],
					},
				},
			});

			const output = await runConventions(repo, "audit --policy bogus");
			expect(output).toContain("Unknown policy 'bogus'");
		} finally {
			await removeTempDir(repo);
		}
	});

	it("emits JSON for check --json", async () => {
		const repo = await createTempDir("pcg-runtime-check-json-");
		try {
			await writeJson(repo, ".pi/conventions.json", {
				policies: {
					naming: {
						rules: [
							{
								id: "naming.components.pascal",
								prefixes: ["src/components/"],
								pathKinds: ["file"],
								requireCase: "PascalCase",
							},
						],
					},
				},
			});
			const output = await runConventions(
				repo,
				"check src/components/button.tsx --json",
			);
			const parsed = JSON.parse(output);
			expect(parsed.path).toBe("src/components/button.tsx");
			expect(parsed.findings).toHaveLength(1);
			expect(parsed.findings[0]).toMatchObject({
				policyId: "naming",
				ruleId: "naming.components.pascal",
			});
		} finally {
			await removeTempDir(repo);
		}
	});
});

describe("runtime audit --changed", () => {
	async function runConventions(repo: string, args: string): Promise<string> {
		const { commands } = createHarness();
		const messages: string[] = [];
		const ctx = {
			cwd: repo,
			hasUI: true,
			ui: {
				setStatus: () => undefined,
				notify: (message: string) => messages.push(message),
			},
		};
		await commands.get("conventions").handler(args, ctx);
		return messages[messages.length - 1] ?? "";
	}

	it("audits staged, unstaged, and untracked files only", async () => {
		const repo = await createTempDir("pcg-runtime-audit-changed-");
		try {
			await writeJson(repo, ".pi/conventions.json", {
				policies: {
					size: {
						limits: [{ prefixes: ["src/"], extensions: ["ts"], maxLines: 1 }],
					},
				},
			});
			await writeText(repo, "src/clean.ts", "a\nb\n");
			await writeText(repo, "src/staged.ts", "a\n");
			await writeText(repo, "src/unstaged.ts", "a\n");
			await runGit(repo, ["init", "--quiet"]);
			await runGit(repo, [
				"-c",
				"user.email=t@t",
				"-c",
				"user.name=t",
				"add",
				"-A",
			]);
			await runGit(repo, [
				"-c",
				"user.email=t@t",
				"-c",
				"user.name=t",
				"commit",
				"-m",
				"init",
			]);
			await writeText(repo, "src/staged.ts", "a\nb\n");
			await writeText(repo, "src/unstaged.ts", "a\nb\n");
			await writeText(repo, "src/untracked.ts", "a\nb\n");
			await runGit(repo, ["add", "src/staged.ts"]);

			const output = await runConventions(repo, "audit --changed --json");
			const parsed = JSON.parse(output);
			const paths = parsed.findings.map((f: any) => f.path).sort();
			expect(paths).toEqual([
				"src/staged.ts",
				"src/unstaged.ts",
				"src/untracked.ts",
			]);
		} finally {
			await removeTempDir(repo);
		}
	});

	it("composes with --policy filter", async () => {
		const repo = await createTempDir("pcg-runtime-audit-changed-policy-");
		try {
			await writeJson(repo, ".pi/conventions.json", {
				policies: {
					size: {
						limits: [{ prefixes: ["src/"], extensions: ["ts"], maxLines: 1 }],
					},
					documentation: {
						rules: [{ kind: "requireFileOverview", paths: ["src/**"] }],
					},
				},
			});
			await writeText(repo, "src/file.ts", "a\nb\n");
			await runGit(repo, ["init", "--quiet"]);

			const output = await runConventions(
				repo,
				"audit --changed --json --policy size",
			);
			const parsed = JSON.parse(output);
			expect(parsed.findings.length).toBeGreaterThan(0);
			for (const finding of parsed.findings) {
				expect(finding.policyId).toBe("size");
			}
		} finally {
			await removeTempDir(repo);
		}
	});

	it("skips deleted files without crashing", async () => {
		const repo = await createTempDir("pcg-runtime-audit-changed-delete-");
		try {
			await writeJson(repo, ".pi/conventions.json", {
				policies: {
					size: {
						limits: [{ prefixes: ["src/"], extensions: ["ts"], maxLines: 1 }],
					},
				},
			});
			await writeText(repo, "src/will-delete.ts", "a\nb\n");
			await runGit(repo, ["init", "--quiet"]);
			await runGit(repo, [
				"-c",
				"user.email=t@t",
				"-c",
				"user.name=t",
				"add",
				"-A",
			]);
			await runGit(repo, [
				"-c",
				"user.email=t@t",
				"-c",
				"user.name=t",
				"commit",
				"-m",
				"init",
			]);
			await runGit(repo, ["rm", "src/will-delete.ts"]);

			const output = await runConventions(repo, "audit --changed --json");
			const parsed = JSON.parse(output);
			expect(parsed.findings).toEqual([]);
		} finally {
			await removeTempDir(repo);
		}
	});

	it("reports clear error outside Git", async () => {
		const repo = await createTempDir("pcg-runtime-audit-changed-nogit-");
		try {
			await writeJson(repo, ".pi/conventions.json", {
				policies: {
					size: {
						limits: [{ prefixes: ["src/"], extensions: ["ts"], maxLines: 1 }],
					},
				},
			});

			const output = await runConventions(repo, "audit --changed");
			expect(output).toContain("requires a Git repository");
		} finally {
			await removeTempDir(repo);
		}
	});

	it("rejects --changed combined with --include-ignored", async () => {
		const repo = await createTempDir("pcg-runtime-audit-changed-ignored-");
		try {
			await writeJson(repo, ".pi/conventions.json", {
				policies: {
					size: {
						limits: [{ prefixes: ["src/"], extensions: ["ts"], maxLines: 1 }],
					},
				},
			});
			await runGit(repo, ["init", "--quiet"]);

			const output = await runConventions(
				repo,
				"audit --changed --include-ignored",
			);
			expect(output).toContain("cannot be combined");
		} finally {
			await removeTempDir(repo);
		}
	});
});
