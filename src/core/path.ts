/** @fileoverview Path normalization and filesystem helpers. */
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";

export function normalizeToolPath(filePath: string): string {
  return filePath.replace(/^@/, "").replace(/\\/g, "/");
}

export function normalizeRelativePath(filePath: string): string {
  return normalizeToolPath(filePath).replace(/^\.\//, "").replace(/\/+/g, "/");
}

export function normalizePrefix(prefix: string): string {
  const normalized = normalizeRelativePath(prefix).replace(/\/+$/g, "");
  if (normalized.length === 0) {
    return normalized;
  }
  return `${normalized}/`;
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
