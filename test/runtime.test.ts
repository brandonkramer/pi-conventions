import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";
import conventionsGuard from "../src/index.ts";
import {
  createTempDir,
  removeTempDir,
  writeJson,
  writeText,
} from "./helpers.ts";

function createHarness() {
  const handlers = new Map<string, Function>();
  const pi = {
    registerCommand: () => undefined,
    on: (name: string, handler: Function) => {
      handlers.set(name, handler);
    },
  } as unknown as ExtensionAPI;

  conventionsGuard(pi);
  return handlers;
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
      const handlers = createHarness();
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
      const handlers = createHarness();
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
});
