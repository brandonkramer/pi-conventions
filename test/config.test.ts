import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createTempDir,
	removeTempDir,
	writeJson,
	writeText,
} from "./helpers.ts";

describe("config loading", () => {
	afterEach(() => {
		vi.resetModules();
	});

	it("finds the nearest project config by walking parent directories", async () => {
		const repo = await createTempDir("pcg-config-");
		try {
			const nested = path.join(repo, "packages", "app");
			await writeJson(repo, ".pi/conventions.json", {
				policies: { structure: { mode: "warn" } },
			});
			await writeText(repo, "packages/app/index.ts", "export {};\n");

			const { findConfigPath } = await import("../src/core/config.ts");
			expect(await findConfigPath(nested)).toBe(
				path.join(repo, ".pi", "conventions.json"),
			);
		} finally {
			await removeTempDir(repo);
		}
	});

	it("falls back to the global config when no project config exists", async () => {
		const home = await createTempDir("pcg-home-");
		const repo = await createTempDir("pcg-repo-");
		const originalHome = process.env.HOME;

		try {
			process.env.HOME = home;
			await writeJson(home, ".pi/agent/conventions.json", {
				policies: { structure: { mode: "warn" } },
			});

			vi.resetModules();
			const { findConfigPath } = await import("../src/core/config.ts");
			expect(await findConfigPath(repo)).toBe(
				path.join(home, ".pi", "agent", "conventions.json"),
			);
		} finally {
			process.env.HOME = originalHome;
			await removeTempDir(repo);
			await removeTempDir(home);
		}
	});

	it("loads optional documentation policies without requiring structure or naming", async () => {
		const repo = await createTempDir("pcg-doc-config-");
		try {
			await writeJson(repo, ".pi/conventions.json", {
				policies: {
					documentation: {
						rules: [
							{
								kind: "todoFormat",
								paths: ["src/**"],
								allowedTags: ["TODO", "FIXME"],
							},
						],
					},
				},
			});
			const { hasActivePolicies, loadState } = await import(
				"../src/core/config.ts"
			);
			const state = await loadState(repo);

			expect(state.config?.policies.structure?.mode).toBe("warn");
			expect(state.config?.policies.naming).toBeUndefined();
			expect(state.config?.policies.documentation?.mode).toBe("warn");
			expect(hasActivePolicies(state.config!)).toBe(true);
		} finally {
			await removeTempDir(repo);
		}
	});

	it("loads optional size policies without requiring other policies", async () => {
		const repo = await createTempDir("pcg-size-config-");
		try {
			await writeJson(repo, ".pi/conventions.json", {
				policies: {
					size: {
						limits: [
							{
								prefixes: ["src/"],
								extensions: ["ts"],
								maxLines: 500,
							},
						],
					},
				},
			});
			const { hasActivePolicies, loadState } = await import(
				"../src/core/config.ts"
			);
			const state = await loadState(repo);

			expect(state.config?.policies.size?.mode).toBe("warn");
			expect(state.config?.policies.size?.limits[0].maxLines).toBe(500);
			expect(hasActivePolicies(state.config!)).toBe(true);
		} finally {
			await removeTempDir(repo);
		}
	});

	it("loads optional dependency policies without requiring other policies", async () => {
		const repo = await createTempDir("pcg-dependencies-config-");
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
							},
						],
					},
				},
			});
			const { hasActivePolicies, loadState } = await import(
				"../src/core/config.ts"
			);
			const state = await loadState(repo);

			expect(state.config?.policies.dependencies?.mode).toBe("block");
			expect(state.config?.policies.dependencies?.rules[0].from).toEqual([
				"src/**/*.ts",
			]);
			expect(hasActivePolicies(state.config!)).toBe(true);
		} finally {
			await removeTempDir(repo);
		}
	});

	it("does not inherit global fallback when project config omits extendsGlobal", async () => {
		const home = await createTempDir("pcg-home-no-extend-");
		const repo = await createTempDir("pcg-repo-no-extend-");
		const originalHome = process.env.HOME;

		try {
			process.env.HOME = home;
			await writeJson(home, ".pi/agent/conventions.json", {
				policies: {
					size: {
						limits: [{ prefixes: ["src/"], extensions: ["ts"], maxLines: 1 }],
					},
				},
			});
			await writeJson(repo, ".pi/conventions.json", {
				policies: {
					naming: {
						rules: [{ prefixes: ["src/"], requireCase: "kebab-case" }],
					},
				},
			});

			const { loadState } = await import("../src/core/config.ts");
			const state = await loadState(repo);

			expect(state.config?.policies.naming).toBeDefined();
			expect(state.config?.policies.size).toBeUndefined();
			expect(state.config?.sourcePaths).toEqual([
				path.join(repo, ".pi", "conventions.json"),
			]);
		} finally {
			process.env.HOME = originalHome;
			await removeTempDir(repo);
			await removeTempDir(home);
		}
	});

	it("treats extendsGlobal false the same as fallback-only replacement", async () => {
		const home = await createTempDir("pcg-home-false-extend-");
		const repo = await createTempDir("pcg-repo-false-extend-");
		const originalHome = process.env.HOME;

		try {
			process.env.HOME = home;
			await writeJson(home, ".pi/agent/conventions.json", {
				policies: {
					size: {
						limits: [{ prefixes: ["src/"], extensions: ["ts"], maxLines: 1 }],
					},
				},
			});
			await writeJson(repo, ".pi/conventions.json", {
				extendsGlobal: false,
				policies: {
					documentation: { rules: [{ kind: "todoFormat", paths: ["src/**"] }] },
				},
			});

			const { loadState } = await import("../src/core/config.ts");
			const state = await loadState(repo);

			expect(state.config?.policies.documentation).toBeDefined();
			expect(state.config?.policies.size).toBeUndefined();
		} finally {
			process.env.HOME = originalHome;
			await removeTempDir(repo);
			await removeTempDir(home);
		}
	});

	it("layers global fallback policies when project config extendsGlobal", async () => {
		const home = await createTempDir("pcg-home-extend-");
		const repo = await createTempDir("pcg-repo-extend-");
		const originalHome = process.env.HOME;

		try {
			process.env.HOME = home;
			await writeJson(home, ".pi/agent/conventions.json", {
				notes: ["global note"],
				policies: {
					size: {
						mode: "block",
						limits: [{ prefixes: ["src/"], extensions: ["ts"], maxLines: 1 }],
					},
					dependencies: {
						mode: "block",
						rules: [{ from: ["src/**/*.ts"], to: ["src/internal/**"] }],
					},
				},
			});
			await writeJson(repo, ".pi/conventions.json", {
				extendsGlobal: true,
				notes: ["project note"],
				policies: {
					structure: { sourceRoots: ["app/"] },
					naming: {
						rules: [{ prefixes: ["app/"], requireCase: "kebab-case" }],
					},
					size: {
						mode: "warn",
						limits: [{ prefixes: ["app/"], extensions: ["ts"], maxLines: 50 }],
					},
					dependencies: {
						mode: "warn",
						rules: [{ from: ["app/**/*.ts"], to: ["app/legacy/**"] }],
					},
				},
			});

			const { hasActivePolicies, loadState } = await import(
				"../src/core/config.ts"
			);
			const state = await loadState(repo);

			expect(state.config?.extendsGlobal).toBe(true);
			expect(state.config?.notes).toEqual(["global note", "project note"]);
			expect(state.config?.policies.structure?.sourceRoots).toEqual(["app/"]);
			expect(state.config?.policies.naming?.rules).toHaveLength(1);
			expect(state.config?.policies.size?.mode).toBe("warn");
			expect(state.config?.policies.size?.limits).toHaveLength(2);
			expect(state.config?.policies.size?.limits[0].maxLines).toBe(1);
			expect(state.config?.policies.size?.limits[0].onCreate).toBe("block");
			expect(state.config?.policies.size?.limits[1].maxLines).toBe(50);
			expect(state.config?.policies.size?.limits[1].onCreate).toBe("warn");
			expect(state.config?.policies.dependencies?.mode).toBe("warn");
			expect(state.config?.policies.dependencies?.rules).toHaveLength(2);
			expect(state.config?.policies.dependencies?.rules[0].onCreate).toBe(
				"block",
			);
			expect(state.config?.policies.dependencies?.rules[1].onCreate).toBe(
				"warn",
			);
			expect(state.config?.sourcePaths).toEqual([
				path.join(repo, ".pi", "conventions.json"),
				path.join(home, ".pi", "agent", "conventions.json"),
			]);
			expect(hasActivePolicies(state.config!)).toBe(true);
		} finally {
			process.env.HOME = originalHome;
			await removeTempDir(repo);
			await removeTempDir(home);
		}
	});

	it("warns and keeps project config active when extendsGlobal has no global config", async () => {
		const home = await createTempDir("pcg-home-missing-global-");
		const repo = await createTempDir("pcg-repo-missing-global-");
		const originalHome = process.env.HOME;

		try {
			process.env.HOME = home;
			await writeJson(repo, ".pi/conventions.json", {
				extendsGlobal: true,
				policies: { size: { limits: [{ prefixes: ["src/"], maxLines: 1 }] } },
			});

			const { loadState } = await import("../src/core/config.ts");
			const state = await loadState(repo);

			expect(state.error).toBeUndefined();
			expect(state.warnings?.[0]).toContain("extendsGlobal is true");
			expect(state.config?.policies.size?.limits[0].maxLines).toBe(1);
		} finally {
			process.env.HOME = originalHome;
			await removeTempDir(repo);
			await removeTempDir(home);
		}
	});

	it("keeps valid project config active when extended global config cannot parse", async () => {
		const home = await createTempDir("pcg-home-invalid-global-");
		const repo = await createTempDir("pcg-repo-invalid-global-");
		const originalHome = process.env.HOME;

		try {
			process.env.HOME = home;
			await writeText(home, ".pi/agent/conventions.json", "{ invalid json\n");
			await writeJson(repo, ".pi/conventions.json", {
				extendsGlobal: true,
				policies: { size: { limits: [{ prefixes: ["src/"], maxLines: 1 }] } },
			});

			const { loadState } = await import("../src/core/config.ts");
			const state = await loadState(repo);

			expect(state.error).toBeUndefined();
			expect(state.warnings?.[0]).toContain(
				"failed to load global conventions",
			);
			expect(state.config?.policies.size?.limits[0].maxLines).toBe(1);
		} finally {
			process.env.HOME = originalHome;
			await removeTempDir(repo);
			await removeTempDir(home);
		}
	});

	it("returns a readable error when the config file is invalid JSON", async () => {
		const repo = await createTempDir("pcg-invalid-");
		try {
			await writeText(repo, ".pi/conventions.json", "{ invalid json\n");
			const { loadState } = await import("../src/core/config.ts");
			const state = await loadState(repo);

			expect(state.error).toContain("failed to load");
			expect(state.config).toBeUndefined();
		} finally {
			await removeTempDir(repo);
		}
	});
});
