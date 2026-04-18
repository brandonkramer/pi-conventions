import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getConventionsCommandArgumentCompletions,
  parseCreateTargetAlias,
  scaffoldConventions,
} from "../src/core/create.ts";
import { createTempDir, readJson, removeTempDir, writeJson, writeText } from "./helpers.ts";

describe("create helpers", () => {
  it("exposes create completions and aliases", () => {
    expect(parseCreateTargetAlias("ts")).toBe("typescript");
    expect(parseCreateTargetAlias("global")).toBe("fallback");
    expect(getConventionsCommandArgumentCompletions("create t")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "create typescript" }),
        expect.objectContaining({ value: "create ts" }),
      ]),
    );
  });

  it("copies a shipped preset into the project .pi directory", async () => {
    const repo = await createTempDir("pcg-create-preset-");
    try {
      await writeJson(repo, "package.json", { name: "demo" });

      const result = await scaffoldConventions(
        {
          exec: async () => ({ code: 0, stdout: `${repo}\n`, stderr: "", killed: false }),
        } as any,
        { cwd: repo, hasUI: false } as any,
        "typescript",
      );

      expect(result).toMatchObject({ kind: "preset", preset: "typescript", projectRoot: repo });
      expect(await readJson(path.join(repo, ".pi", "conventions.json"))).toMatchObject({
        policies: { structure: { sourceRoots: ["src/"] } },
      });
    } finally {
      await removeTempDir(repo);
    }
  });

  it("generates a repo-specific config from repo inspection", async () => {
    const repo = await createTempDir("pcg-create-generated-");
    try {
      await writeText(repo, "Cargo.toml", "[package]\nname = \"demo\"\nversion = \"0.1.0\"\n");
      await writeText(repo, "src/main.rs", "fn main() {}\n");
      await writeText(repo, "src/kernel/model.rs", "pub struct Model;\n");

      const result = await scaffoldConventions(
        {
          exec: async () => ({ code: 0, stdout: `${repo}\n`, stderr: "", killed: false }),
        } as any,
        { cwd: repo, hasUI: false } as any,
      );

      const config = await readJson<any>(path.join(repo, ".pi", "conventions.json"));
      expect(result).toMatchObject({ kind: "generated", language: "rust", projectRoot: repo });
      expect(config.$schema).toBe("./conventions.schema.json");
      expect(config.policies.structure).toBeDefined();
      expect(config.policies.naming).toBeDefined();
    } finally {
      await removeTempDir(repo);
    }
  });

  it("writes the fallback config under the pi agent directory", async () => {
    const home = await createTempDir("pcg-home-");
    const originalHome = process.env.HOME;

    try {
      process.env.HOME = home;
      const result = await scaffoldConventions(
        {
          exec: async () => ({ code: 1, stdout: "", stderr: "", killed: false }),
        } as any,
        { cwd: home, hasUI: false } as any,
        "fallback",
      );

      expect(result).toMatchObject({ kind: "fallback", targetDir: path.join(home, ".pi", "agent") });
      expect(await readJson(path.join(home, ".pi", "agent", "conventions.json"))).toMatchObject({
        policies: { structure: { mode: "warn" } },
      });
    } finally {
      process.env.HOME = originalHome;
      await removeTempDir(home);
    }
  });
});
