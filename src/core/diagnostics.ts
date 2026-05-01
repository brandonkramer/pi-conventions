import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
	collectViolations,
	needsContentForPath,
	strongestViolation,
} from "./evaluate.ts";
import { normalizeRelativePath } from "./path.ts";
import type { ConventionsConfig, Violation } from "./types.ts";

export interface DiagnosticFinding {
	relativePath: string;
	violation: Violation;
}

const IGNORED_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"coverage",
	".vitest",
]);
const IGNORED_EXTENSIONS = [".tgz"];

export async function checkConventionsPath(
	cwd: string,
	config: ConventionsConfig,
	rawPath: string,
): Promise<string> {
	const relativePath = normalizeRelativePath(rawPath);
	const absolutePath = path.resolve(cwd, relativePath);
	const exists = await fileExists(absolutePath);
	const content = await readContentIfNeeded(cwd, relativePath, exists, config);
	const violations = collectViolations(
		{ relativePath, exists, content },
		config,
	);
	return formatCheck(relativePath, exists, content !== undefined, violations);
}

export async function auditConventions(
	cwd: string,
	config: ConventionsConfig,
): Promise<string> {
	const files = await listAuditFiles(cwd);
	const findings: DiagnosticFinding[] = [];

	for (const relativePath of files) {
		const content = await readContentIfNeeded(cwd, relativePath, true, config);
		for (const violation of collectViolations(
			{ relativePath, exists: true, content },
			config,
		)) {
			findings.push({ relativePath, violation });
		}
	}

	return formatAudit(findings);
}

async function readContentIfNeeded(
	cwd: string,
	relativePath: string,
	exists: boolean,
	config: ConventionsConfig,
): Promise<string | undefined> {
	if (!exists || !needsContentForPath(relativePath, config)) {
		return undefined;
	}
	try {
		return await readFile(path.resolve(cwd, relativePath), "utf8");
	} catch {
		return undefined;
	}
}

async function listAuditFiles(cwd: string): Promise<string[]> {
	const result: string[] = [];
	await walk(cwd, "", result);
	return result.sort();
}

async function walk(
	root: string,
	relativeDir: string,
	result: string[],
): Promise<void> {
	const absoluteDir = path.join(root, relativeDir);
	const entries = await readDirectoryEntries(absoluteDir);
	if (!entries) {
		return;
	}

	for (const entry of entries) {
		const relativePath = normalizeRelativePath(
			path.join(relativeDir, entry.name),
		);
		if (entry.isDirectory()) {
			if (!shouldIgnoreDirectory(entry.name)) {
				await walk(root, relativePath, result);
			}
		} else if (entry.isFile() && !shouldIgnoreFile(relativePath)) {
			result.push(relativePath);
		}
	}
}

async function readDirectoryEntries(absoluteDir: string) {
	try {
		return await readdir(absoluteDir, { withFileTypes: true });
	} catch {
		return undefined;
	}
}

async function fileExists(absolutePath: string): Promise<boolean> {
	try {
		return (await stat(absolutePath)).isFile();
	} catch {
		return false;
	}
}

function shouldIgnoreDirectory(name: string): boolean {
	return IGNORED_DIRS.has(name);
}

function shouldIgnoreFile(relativePath: string): boolean {
	return IGNORED_EXTENSIONS.some((extension) =>
		relativePath.endsWith(extension),
	);
}

function formatCheck(
	relativePath: string,
	exists: boolean,
	contentEvaluated: boolean,
	violations: Violation[],
): string {
	if (violations.length === 0) {
		const contentNote = contentEvaluated
			? "content-based policies evaluated"
			: "content-based policies skipped";
		return `Conventions check: no findings for ${relativePath} (${exists ? "existing file" : "new path"}; ${contentNote}).`;
	}

	const strongest = strongestViolation(violations);
	const lines = [
		`Conventions check: ${violations.length} finding(s) for ${relativePath}`,
		`Strongest: ${strongest?.mode ?? "warn"} ${strongest?.policyId ?? "unknown"}`,
		"",
	];
	for (const violation of violations) {
		lines.push(
			`- ${violation.mode} ${violation.policyId}: ${violation.reason}`,
		);
	}
	return lines.join("\n");
}

function formatAudit(findings: DiagnosticFinding[]): string {
	if (findings.length === 0) {
		return "Conventions audit: no findings.";
	}

	const lines = [`Conventions audit: ${findings.length} finding(s)`];
	const policyIds = [
		...new Set(findings.map((finding) => finding.violation.policyId)),
	].sort();
	for (const policyId of policyIds) {
		lines.push("", policyDisplayName(policyId));
		for (const finding of findings.filter(
			(item) => item.violation.policyId === policyId,
		)) {
			lines.push(
				`- ${finding.violation.mode} ${finding.relativePath}: ${finding.violation.reason}`,
			);
		}
	}
	return lines.join("\n");
}

function policyDisplayName(policyId: string): string {
	return policyId.charAt(0).toUpperCase() + policyId.slice(1);
}
