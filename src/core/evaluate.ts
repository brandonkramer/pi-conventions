import {
	documentationPolicyMatchesPath,
	evaluateDocumentationViolation,
} from "../policies/documentation.ts";
import { evaluateNamingViolation } from "../policies/naming.ts";
import {
	evaluateSizeViolation,
	sizePolicyMatchesPath,
} from "../policies/size.ts";
import { evaluateStructureViolation } from "../policies/structure.ts";
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
}

export function collectViolations(
	input: EvaluationInput,
	config: ConventionsConfig,
): Violation[] {
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
				sizePolicyMatchesPath(relativePath, config.policies.size)),
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
