/** @fileoverview Collects policy violations for a given file or path. */
import {
	dependenciesPolicyMatchesPath,
	evaluateDependenciesViolation,
} from "../policies/dependencies.ts";
import {
	documentationPolicyMatchesPath,
	evaluateDocumentationViolation,
} from "../policies/documentation.ts";
import { evaluateFilesViolation } from "../policies/files.ts";
import { evaluateNamingViolation } from "../policies/naming.ts";
import {
	evaluatePackageViolation,
	packagePolicyMatchesPath,
} from "../policies/package.ts";
import {
	evaluateSizeViolation,
	sizePolicyMatchesPath,
} from "../policies/size.ts";
import { evaluateStructureViolation } from "../policies/structure.ts";
import { matchesAnyPathPattern } from "./pattern.ts";
import type { ConventionsConfig, Violation } from "./types.ts";

const MODE_PRIORITY = {
	warn: 1,
	confirm: 2,
	block: 3,
} as const;

export interface EvaluationInput {
	relativePath: string;
	exists: boolean;
	content?: string;
	cwd?: string;
}

export function collectViolations(
	input: EvaluationInput,
	config: ConventionsConfig,
): Violation[] {
	if (matchesAnyPathPattern(input.relativePath, config.ignoreMatchers)) {
		return [];
	}
	const { relativePath, exists, content, cwd } = input;
	const { policies } = config;
	const out: Violation[] = [];
	const push = (v: Violation | undefined) => {
		if (v) out.push(v);
	};

	if (policies.structure)
		push(evaluateStructureViolation(relativePath, exists, policies.structure));
	if (policies.naming)
		push(evaluateNamingViolation(relativePath, exists, policies.naming));
	if (policies.documentation && content !== undefined)
		push(
			evaluateDocumentationViolation(
				relativePath,
				exists,
				content,
				policies.documentation,
			),
		);
	if (policies.size && content !== undefined)
		push(evaluateSizeViolation(relativePath, exists, content, policies.size));
	if (policies.dependencies && content !== undefined)
		push(
			evaluateDependenciesViolation(
				relativePath,
				exists,
				content,
				policies.dependencies,
			),
		);
	if (policies.package && content !== undefined)
		push(
			evaluatePackageViolation(
				relativePath,
				exists,
				content,
				policies.package,
				cwd,
			),
		);
	if (policies.files)
		push(evaluateFilesViolation(relativePath, exists, policies.files, cwd));

	return out;
}

export function needsContentForPath(
	relativePath: string,
	config: ConventionsConfig,
): boolean {
	const p = config.policies;
	return Boolean(
		(p.documentation &&
			documentationPolicyMatchesPath(relativePath, p.documentation)) ||
			(p.size && sizePolicyMatchesPath(relativePath, p.size)) ||
			(p.dependencies &&
				dependenciesPolicyMatchesPath(relativePath, p.dependencies)) ||
			(p.package && packagePolicyMatchesPath(relativePath, p.package)),
	);
}

export function strongestViolation(
	violations: Violation[],
): Violation | undefined {
	return violations.reduce<Violation | undefined>(
		(s, c) =>
			!s || MODE_PRIORITY[c.mode] > MODE_PRIORITY[s.mode] ? c : s,
		undefined,
	);
}
