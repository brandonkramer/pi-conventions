import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import { createTempDir, readJson, removeTempDir, writeJson } from "./helpers.ts";

const EXTENSION_ENTRY_PATH = fileURLToPath(new URL("../src/index.ts", import.meta.url));

function createProbeExtension(logPath: string) {
  return (pi: ExtensionAPI) => {
    pi.registerCommand("probe-check", {
      description: "Test-only probe command",
      handler: async () => {
        await appendFile(logPath, `${JSON.stringify({ event: "probe-command" })}\n`, "utf8");
      },
    });
  };
}

async function createTestSession(cwd: string, agentDir: string, logPath: string) {
  const sessionManager = SessionManager.inMemory(cwd);
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    additionalExtensionPaths: [EXTENSION_ENTRY_PATH],
    extensionFactories: [createProbeExtension(logPath)],
  });
  await resourceLoader.reload();

  return createAgentSession({
    cwd,
    agentDir,
    resourceLoader,
    sessionManager,
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
    sessionStartEvent: { type: "session_start", reason: "startup" },
  });
}

async function readProbeLog(logPath: string) {
  try {
    const content = await readFile(logPath, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { event: string });
  } catch {
    return [];
  }
}

describe("SDK integration", () => {
  it("loads the package extension into a real session", async () => {
    const cwd = await createTempDir("pcg-sdk-commands-");
    const agentDir = await createTempDir("pcg-sdk-agent-");
    const logPath = path.join(agentDir, "probe-log.jsonl");

    try {
      const { extensionsResult } = await createTestSession(cwd, agentDir, logPath);
      const commandNames = extensionsResult.extensions.flatMap((extension) => [...extension.commands.keys()]);

      expect(commandNames).toContain("conventions");
      expect(commandNames).toContain("probe-check");
    } finally {
      await removeTempDir(agentDir);
      await removeTempDir(cwd);
    }
  });

  it("routes extension slash commands through session.prompt", async () => {
    const cwd = await createTempDir("pcg-sdk-probe-");
    const agentDir = await createTempDir("pcg-sdk-agent-");
    const logPath = path.join(agentDir, "probe-log.jsonl");

    try {
      const { session } = await createTestSession(cwd, agentDir, logPath);
      await session.prompt("/probe-check");

      expect(await readProbeLog(logPath)).toEqual([
        { event: "probe-command" },
      ]);
    } finally {
      await removeTempDir(agentDir);
      await removeTempDir(cwd);
    }
  });

  it("executes /conventions create rust in a real session", async () => {
    const cwd = await createTempDir("pcg-sdk-rust-");
    const agentDir = await createTempDir("pcg-sdk-agent-");
    const logPath = path.join(agentDir, "probe-log.jsonl");

    try {
      await writeJson(cwd, "package.json", { name: "demo" });
      const { session } = await createTestSession(cwd, agentDir, logPath);

      await session.prompt("/conventions create rust");

      const config = await readJson<any>(path.join(cwd, ".pi", "conventions.json"));
      expect(config.policies.structure.sourceRoots).toEqual(["src/"]);
      expect(config.policies.naming).toBeDefined();
    } finally {
      await removeTempDir(agentDir);
      await removeTempDir(cwd);
    }
  });

  it("executes /conventions create fallback in a real session", async () => {
    const cwd = await createTempDir("pcg-sdk-fallback-");
    const agentDir = await createTempDir("pcg-sdk-agent-");
    const home = await createTempDir("pcg-sdk-home-");
    const logPath = path.join(agentDir, "probe-log.jsonl");
    const originalHome = process.env.HOME;

    try {
      process.env.HOME = home;
      const { session } = await createTestSession(cwd, agentDir, logPath);

      await session.prompt("/conventions create fallback");

      const fallbackConfig = await readJson<any>(path.join(home, ".pi", "agent", "conventions.json"));
      expect(fallbackConfig.policies.structure.mode).toBe("warn");
    } finally {
      process.env.HOME = originalHome;
      await removeTempDir(home);
      await removeTempDir(agentDir);
      await removeTempDir(cwd);
    }
  });
});
