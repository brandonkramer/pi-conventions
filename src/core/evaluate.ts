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
	const violations: Violation[] = [];

	if (config.policies.structure) {
		const violation = evaluateStructureViolation(
			input.relativePath,
			input.exists,
			config.policies.structure,
		);
		if (violation) violations.push(violation);
	}

	if (config.policies.naming) {
		const violation = evaluateNamingViolation(
			input.relativePath,
			input.exists,
			config.policies.naming,
		);
		if (violation) violations.push(violation);
	}

	if (config.policies.documentation && input.content !== undefined) {
		const violation = evaluateDocumentationViolation(
			input.relativePath,
			input.exists,
			input.content,
			config.policies.documentation,
		);
		if (violation) violations.push(violation);
	}

	if (config.policies.size && input.content !== undefined) {
		const violation = evaluateSizeViolation(
			input.relativePath,
			input.exists,
			input.content,
			config.policies.size,
		);
		if (violation) violations.push(violation);
	}

	if (config.policies.dependencies && input.content !== undefined) {
		const violation = evaluateDependenciesViolation(
			input.relativePath,
			input.exists,
			input.content,
			config.policies.dependencies,
		);
		if (violation) violations.push(violation);
	}

	if (config.policies.package && input.content !== undefined) {
		const violation = evaluatePackageViolation(
			input.relativePath,
			input.exists,
			input.content,
			config.policies.package,
			input.cwd,
		);
		if (violation) violations.push(violation);
	}

	if (config.policies.files) {
		const violation = evaluateFilesViolation(
			input.relativePath,
			input.exists,
			config.policies.files,
			input.cwd,
		);
		if (violation) violations.push(violation);
	}

	return violations;
}

export function needsContentForPath(
	relativePath: string,
	config: ConventionsConfig,
): boolean {
	return Boolean(
		(config.policies.documentation &&
			documentationPolicyMatchesPath(
				relativePath,
				config.policies.documentation,
			)) ||
			(config.policies.size &&
				sizePolicyMatchesPath(relativePath, config.policies.size)) ||
			(config.policies.dependencies &&
				dependenciesPolicyMatchesPath(
					relativePath,
					config.policies.dependencies,
				)) ||
			(config.policies.package &&
				packagePolicyMatchesPath(relativePath, config.policies.package)),
	);
}

export function strongestViolation(
	violations: Violation[],
): Violation | undefined {
	return violations.reduce<Violation | undefined>((strongest, current) => {
		if (!strongest) {
			return current;
		}
		return MODE_PRIORITY[current.mode] > MODE_PRIORITY[strongest.mode]
			? current
			: strongest;
	}, undefined);
}
