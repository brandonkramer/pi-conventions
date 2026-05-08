import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
	collectViolations,
	needsContentForPath,
	strongestViolation,
} from "./evaluate.ts";
import { normalizeRelativePath, pathExists } from "./path.ts";
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
const execFileAsync = promisify(execFile);

export interface AuditConventionsOptions {
	includeIgnored?: boolean;
}

export async function checkConventionsPath(
	cwd: string,
	config: ConventionsConfig,
	rawPath: string,
): Promise<string> {
	const relativePath = normalizeRelativePath(rawPath);
	const absolutePath = path.resolve(cwd, relativePath);
	const exists = await pathExists(absolutePath);
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
	options: AuditConventionsOptions = {},
): Promise<string> {
	const files = await listAuditFiles(cwd, options);
	const findings: DiagnosticFinding[] = [];

	for (const relativePath of files) {
		if (!(await pathExists(path.resolve(cwd, relativePath)))) {
			continue;
		}
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

async function listAuditFiles(
	cwd: string,
	options: AuditConventionsOptions,
): Promise<string[]> {
	if (!options.includeIgnored) {
		try {
			const { stdout } = await execFileAsync(
				"git",
				["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
				{ cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
			);
			return [
				...new Set(
					stdout.split("\0").filter(Boolean).map(normalizeRelativePath),
				),
			].sort();
		} catch {
			// fall through to filesystem walk
		}
	}

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
	let entries;
	try {
		entries = await readdir(absoluteDir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		const relativePath = normalizeRelativePath(
			path.join(relativeDir, entry.name),
		);
		if (entry.isDirectory()) {
			if (!IGNORED_DIRS.has(entry.name)) {
				await walk(root, relativePath, result);
			}
		} else if (
			entry.isFile() &&
			!IGNORED_EXTENSIONS.some((ext) => relativePath.endsWith(ext))
		) {
			result.push(relativePath);
		}
	}
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
