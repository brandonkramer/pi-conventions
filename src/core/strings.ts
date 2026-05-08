/** @fileoverview String parsing utilities for config normalization. */
import type { EnforcementMode } from "./types.ts";

export function parseMode(value: unknown, fallback: EnforcementMode): EnforcementMode {
  return value === "warn" || value === "confirm" || value === "block" ? value : fallback;
}

export function parseRuleId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function uniqueStrings(
  values: readonly unknown[] | undefined,
  normalize: (value: string) => string,
): string[] {
  const result = new Set<string>();
  for (const value of values ?? []) {
    if (typeof value !== "string") continue;
    const normalized = normalize(value.trim());
    if (normalized.length > 0) {
      result.add(normalized);
    }
  }
  return [...result];
}
