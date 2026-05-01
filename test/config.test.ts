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
