import { describe, expect, it } from "vitest";
import { inferConventionsConfig } from "../src/core/infer.ts";
import { createTempDir, removeTempDir, writeJson, writeText } from "./helpers.ts";

describe("inferConventionsConfig", () => {
  it("infers a React-like TypeScript repo from observed file layout and naming", async () => {
    const repo = await createTempDir("pcg-infer-ts-");
    try {
      await writeJson(repo, "package.json", { name: "demo" });
      await writeJson(repo, "tsconfig.json", { compilerOptions: {} });
      await writeText(repo, "src/components/Button.tsx", "export function Button() { return null; }\n");
      await writeText(repo, "src/features/auth/use-session.ts", "export function useSession() {}\n");
      await writeText(repo, "src/lib/http-client.ts", "export const httpClient = {};\n");

      const inferred = await inferConventionsConfig(repo);
      const namingRules = inferred.config.policies?.naming?.rules ?? [];
      const tsxRule = namingRules.find((rule) => Array.isArray(rule.extensions) && rule.extensions.includes("tsx"));
      const tsRule = namingRules.find((rule) => Array.isArray(rule.extensions) && rule.extensions.includes("ts"));

      expect(inferred.language).toBe("typescript");
      expect(inferred.sourceRoots).toEqual(["src/"]);
      expect(inferred.config.policies?.structure?.layers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ prefixes: ["src/components/"] }),
          expect.objectContaining({ prefixes: ["src/features/"] }),
          expect.objectContaining({ prefixes: ["src/lib/"] }),
        ]),
      );
      expect(tsxRule).toMatchObject({ requireCase: "PascalCase" });
      expect(tsRule).toMatchObject({ requireCase: "kebab-case" });
    } finally {
      await removeTempDir(repo);
    }
  });

  it("infers a Rust repo and preserves existing top-level entrypoints", async () => {
    const repo = await createTempDir("pcg-infer-rust-");
    try {
      await writeText(repo, "Cargo.toml", "[package]\nname = \"demo\"\nversion = \"0.1.0\"\n");
      await writeText(repo, "src/main.rs", "fn main() {}\n");
      await writeText(repo, "src/kernel/model.rs", "pub struct Model;\n");
      await writeText(repo, "src/adapters/sqlite.rs", "pub fn connect() {}\n");

      const inferred = await inferConventionsConfig(repo);
      const structure = inferred.config.policies?.structure;

      expect(inferred.language).toBe("rust");
      expect(structure?.newTopLevelFiles).toMatchObject({ enabled: true, mode: "block" });
      expect(structure?.newTopLevelFiles).toMatchObject({
        allowedFiles: expect.arrayContaining(["src/main.rs"]),
      });
    } finally {
      await removeTempDir(repo);
    }
  });
});
