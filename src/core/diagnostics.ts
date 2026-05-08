/** @fileoverview Check and audit diagnostics output for conventions. */
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
	collectViolations,
	needsContentForPath,
	strongestViolation,
} from "./evaluate.ts";
import { evaluateFilesGlobalRequireFindings } from "../policies/files.ts";
import { matchesAnyPathPattern } from "./pattern.ts";
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

export const KNOWN_POLICY_IDS = [
	"structure",
	"naming",
	"documentation",
	"size",
	"dependencies",
	"package",
	"files",
] as const;
export type KnownPolicyId = (typeof KNOWN_POLICY_IDS)[number];

export interface AuditConventionsOptions {
	includeIgnored?: boolean;
	changed?: boolean;
	json?: boolean;
	policy?: string;
}

export class ChangedAuditError extends Error {}

export interface CheckConventionsOptions {
	json?: boolean;
	policy?: string;
}

export async function checkConventionsPath(
	cwd: string,
	config: ConventionsConfig,
	rawPath: string,
	options: CheckConventionsOptions = {},
): Promise<string> {
	const relativePath = normalizeRelativePath(rawPath);
	const absolutePath = path.resolve(cwd, relativePath);
	const exists = await pathExists(absolutePath);
	const content = await readContentIfNeeded(cwd, relativePath, exists, config);
	const violations = filterViolations(
		collectViolations({ relativePath, exists, content, cwd }, config),
		options.policy,
	);
	if (options.json) {
		return JSON.stringify(
			{
				path: relativePath,
				exists,
				contentEvaluated: content !== undefined,
				findings: violations.map((v) => violationToJson(relativePath, v)),
			},
			null,
			2,
		);
	}
	return formatCheck(relativePath, exists, content !== undefined, violations);
}

export async function auditConventions(
	cwd: string,
	config: ConventionsConfig,
	options: AuditConventionsOptions = {},
): Promise<string> {
	if (options.changed && options.includeIgnored) {
		throw new ChangedAuditError(
			"--changed and --include-ignored cannot be combined.",
		);
	}
	const files = options.changed
		? await listChangedFiles(cwd, config)
		: await listAuditFiles(cwd, config, options);
	const findings: DiagnosticFinding[] = [];

	for (const relativePath of files) {
		if (!(await pathExists(path.resolve(cwd, relativePath)))) {
			continue;
		}
		const content = await readContentIfNeeded(cwd, relativePath, true, config);
		for (const violation of collectViolations(
			{ relativePath, exists: true, content, cwd },
			config,
		)) {
			if (options.policy && violation.policyId !== options.policy) continue;
			findings.push({ relativePath, violation });
		}
	}

	if (config.policies.files) {
		for (const finding of evaluateFilesGlobalRequireFindings(
			config.policies.files,
			cwd,
		)) {
			if (options.policy && finding.violation.policyId !== options.policy)
				continue;
			findings.push(finding);
		}
	}

	if (options.json) {
		return JSON.stringify(
			{
				findings: findings.map((f) =>
					violationToJson(f.relativePath, f.violation),
				),
			},
			null,
			2,
		);
	}
	return formatAudit(findings);
}

function filterViolations(
	violations: Violation[],
	policy: string | undefined,
): Violation[] {
	return policy ? violations.filter((v) => v.policyId === policy) : violations;
}

function violationToJson(
	relativePath: string,
	violation: Violation,
): Record<string, unknown> {
	return {
		path: relativePath,
		policyId: violation.policyId,
		ruleId: violation.ruleId,
		mode: violation.mode,
		reason: violation.reason,
	};
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

async function listChangedFiles(
	cwd: string,
	config: ConventionsConfig,
): Promise<string[]> {
	try {
		await execFileAsync("git", ["rev-parse", "--git-dir"], { cwd });
	} catch {
		throw new ChangedAuditError(
			"--changed requires a Git repository. Run from inside a Git repo or use a full audit.",
		);
	}
	const { stdout } = await execFileAsync(
		"git",
		["status", "--porcelain=v1", "-z", "--untracked-files=all"],
		{ cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
	);
	return parseGitStatus(stdout)
		.filter((f) => !matchesAnyPathPattern(f, config.ignoreMatchers))
		.sort();
}

function parseGitStatus(stdout: string): string[] {
	const entries = stdout.split("\0");
	const paths = new Set<string>();
	let i = 0;
	while (i < entries.length) {
		const entry = entries[i++];
		if (!entry) continue;
		const [staged, unstaged] = entry;
		const pathPart = entry.slice(3);
		const isRename = staged === "R" || unstaged === "R";
		const isDelete =
			(staged === "D" && unstaged !== "M") ||
			(unstaged === "D" && staged === " ");
		// porcelain v1 -z encodes renames as `XY new\0old\0`; consume the old path.
		if (isRename) i++;
		if (!isDelete) paths.add(normalizeRelativePath(pathPart));
	}
	return [...paths];
}

async function listAuditFiles(
	cwd: string,
	config: ConventionsConfig,
	options: AuditConventionsOptions,
): Promise<string[]> {
	let files: string[];
	if (!options.includeIgnored) {
		try {
			const { stdout } = await execFileAsync(
				"git",
				["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
				{ cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
			);
			files = [
				...new Set(
					stdout.split("\0").filter(Boolean).map(normalizeRelativePath),
				),
			];
		} catch {
			files = [];
			await walk(cwd, "", files);
		}
	} else {
		files = [];
		await walk(cwd, "", files);
	}
	return files
		.filter((f) => !matchesAnyPathPattern(f, config.ignoreMatchers))
		.sort();
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
		const id = violation.ruleId
			? `${violation.policyId}:${violation.ruleId}`
			: violation.policyId;
		lines.push(`- ${violation.mode} ${id}: ${violation.reason}`);
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
			const id = finding.violation.ruleId
				? `${finding.violation.policyId}:${finding.violation.ruleId}`
				: finding.violation.policyId;
			lines.push(
				`- ${finding.violation.mode} ${finding.relativePath}: ${id} — ${finding.violation.reason}`,
			);
		}
	}
	return lines.join("\n");
}

function policyDisplayName(policyId: string): string {
	return policyId.charAt(0).toUpperCase() + policyId.slice(1);
}
