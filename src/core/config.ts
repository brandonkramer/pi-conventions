import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeNamingPolicy } from "../policies/naming.ts";
import { normalizeStructurePolicy } from "../policies/structure.ts";
import { pathExists } from "./path.ts";
import { uniqueStrings } from "./strings.ts";
import type { ConventionsConfig, LoadState, RawConventionsConfig } from "./types.ts";

const PROJECT_CONFIG_RELATIVE_PATH = path.join(".pi", "conventions.json");
const GLOBAL_CONFIG_PATH = path.join(os.homedir(), ".pi", "agent", "conventions.json");

export async function findConfigPath(startCwd: string): Promise<string | undefined> {
  let current = path.resolve(startCwd);

  while (true) {
    const candidatePath = path.join(current, PROJECT_CONFIG_RELATIVE_PATH);
    if (await pathExists(candidatePath)) {
      return candidatePath;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return (await pathExists(GLOBAL_CONFIG_PATH)) ? GLOBAL_CONFIG_PATH : undefined;
}

export async function loadState(cwd: string): Promise<LoadState> {
  const cwdKey = path.resolve(cwd);
  const configPath = await findConfigPath(cwdKey);
  if (!configPath) {
    return { cwdKey };
  }

  try {
    const raw = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    return {
      cwdKey,
      config: normalizeConventionsConfig(raw, configPath),
    };
  } catch (error: any) {
    return {
      cwdKey,
      error: `failed to load ${configPath}: ${error.message}`,
    };
  }
}

export function hasActivePolicies(config: ConventionsConfig): boolean {
  return Boolean(config.policies.structure || config.policies.naming);
}

function normalizeConventionsConfig(raw: unknown, configPath: string): ConventionsConfig {
  const envelope = asConventionsConfig(raw);
  return {
    path: configPath,
    notes: uniqueStrings(envelope?.notes, (value) => value),
    policies: {
      structure: normalizeStructurePolicy(envelope?.policies?.structure),
      naming: normalizeNamingPolicy(envelope?.policies?.naming),
    },
  };
}

function asConventionsConfig(raw: unknown): RawConventionsConfig | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as RawConventionsConfig)
    : undefined;
}
