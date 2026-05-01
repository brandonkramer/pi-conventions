import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { needsContentForPath } from "../src/core/evaluate.ts";
import conventionsGuard from "../src/index.ts";
import { normalizeDocumentationPolicy } from "../src/policies/documentation.ts";
import {
	createTempDir,
	removeTempDir,
	writeJson,
	writeText,
} from "./helpers.ts";

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
				notes: [],
				policies: { documentation },
			}),
		).toBe(false);
		expect(
			needsContentForPath("docs/notes.ts", {
				path: ".pi/conventions.json",
				notes: [],
				policies: { documentation },
			}),
		).toBe(true);
	});
});

describe("runtime diagnostics commands", () => {
	it("reports check and audit findings", async () => {
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
