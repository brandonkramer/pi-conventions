/** @fileoverview Package manifest governance policy for npm/Pi package hygiene. */
import { existsSync } from "node:fs";
import path from "node:path";
import {
	compilePathPatterns,
	matchesAnyPathPattern,
	type PathPattern,
} from "../core/pattern.ts";
import { parseMode, parseRuleId, uniqueStrings } from "../core/strings.ts";
import type { EnforcementMode, Violation } from "../core/types.ts";

export interface RawPackagePiSection {
	requireKeyword?: unknown;
	verifyResourcePaths?: unknown;
}

export interface RawPackageNpmSection {
	requireFilesCoverage?: unknown[];
}

export interface RawPackagePolicyConfig {
	id?: string;
	mode?: EnforcementMode;
	editMode?: EnforcementMode;
	manifests?: unknown[];
	requireFields?: unknown[];
	requireFiles?: unknown[];
	piPackage?: RawPackagePiSection;
	npm?: RawPackageNpmSection;
	notes?: unknown[];
}

export interface PackagePolicyConfig {
	id?: string;
	mode: EnforcementMode;
	editMode: EnforcementMode;
	manifests: string[];
	manifestMatchers: PathPattern[];
	requireFields: string[];
	requireFiles: string[];
	piRequireKeyword?: string;
	piVerifyResourcePaths: boolean;
	npmRequireFilesCoverage: string[];
	notes: string[];
}

const DEFAULT_MODE: EnforcementMode = "warn";
const DEFAULT_EDIT_MODE: EnforcementMode = "warn";
const DEFAULT_MANIFESTS = ["package.json"];

export function normalizePackagePolicy(
	raw: RawPackagePolicyConfig | undefined,
): PackagePolicyConfig | undefined {
	if (raw !== undefined && (typeof raw !== "object" || raw === null || Array.isArray(raw))) return undefined;

	const candidate = raw ?? {};
	const manifests = uniqueStrings(candidate.manifests, (value) => value);
	const requireFields = uniqueStrings(
		candidate.requireFields,
		(value) => value,
	);
	const requireFiles = uniqueStrings(candidate.requireFiles, (value) => value);
	const npmRequireFilesCoverage = uniqueStrings(
		candidate.npm?.requireFilesCoverage,
		(value) => value,
	);
	const piRequireKeyword =
		typeof candidate.piPackage?.requireKeyword === "string" &&
		candidate.piPackage.requireKeyword.trim().length > 0
			? candidate.piPackage.requireKeyword.trim()
			: undefined;
	const piVerifyResourcePaths =
		candidate.piPackage?.verifyResourcePaths === true;

	if (
		requireFields.length === 0 &&
		requireFiles.length === 0 &&
		!piRequireKeyword &&
		!piVerifyResourcePaths &&
		npmRequireFilesCoverage.length === 0
	) {
		return undefined;
	}

	const effectiveManifests =
		manifests.length > 0 ? manifests : DEFAULT_MANIFESTS;
	return {
		id:
			parseRuleId(candidate.id),
		mode: parseMode(candidate.mode, DEFAULT_MODE),
		editMode: parseMode(candidate.editMode, DEFAULT_EDIT_MODE),
		manifests: effectiveManifests,
		manifestMatchers: compilePathPatterns(effectiveManifests),
		requireFields,
		requireFiles,
		piRequireKeyword,
		piVerifyResourcePaths,
		npmRequireFilesCoverage,
		notes: uniqueStrings(candidate.notes, (value) => value),
	};
}

export function packagePolicyMatchesPath(
	relativePath: string,
	config: PackagePolicyConfig,
): boolean {
	return matchesAnyPathPattern(relativePath, config.manifestMatchers);
}

export function evaluatePackageViolation(
	relativePath: string,
	exists: boolean,
	content: string,
	config: PackagePolicyConfig,
	cwd: string | undefined,
): Violation | undefined {
	if (!matchesAnyPathPattern(relativePath, config.manifestMatchers)) {
		return undefined;
	}

	let manifest: any;
	try {
		manifest = JSON.parse(content);
	} catch {
		return {
			policyId: "package",
			ruleId: config.id,
			mode: exists ? config.editMode : config.mode,
			reason: `${relativePath} is not valid JSON.`,
		};
	}

	if (typeof manifest !== "object" || manifest === null) {
		return {
			policyId: "package",
			ruleId: config.id,
			mode: exists ? config.editMode : config.mode,
			reason: `${relativePath} must be a JSON object.`,
		};
	}

	for (const field of config.requireFields) {
		if (!(field in manifest)) {
			return buildViolation(
				config,
				exists,
				`${relativePath} is missing required field '${field}'.`,
			);
		}
	}

	if (config.piRequireKeyword) {
		const keywords = Array.isArray(manifest.keywords) ? manifest.keywords : [];
		if (!keywords.includes(config.piRequireKeyword)) {
			return buildViolation(
				config,
				exists,
				`${relativePath} keywords must include '${config.piRequireKeyword}'.`,
			);
		}
	}

	const manifestDir = cwd
		? path.resolve(cwd, path.dirname(relativePath))
		: undefined;

	for (const required of config.requireFiles) {
		if (!manifestDir) break;
		if (!existsSync(path.resolve(manifestDir, required))) {
			return buildViolation(
				config,
				exists,
				`${relativePath} requires sibling file '${required}', but it is missing.`,
			);
		}
	}

	if (config.piVerifyResourcePaths && manifestDir) {
		const pi = manifest.pi;
		if (pi && typeof pi === "object") {
			const extensions = Array.isArray(pi.extensions) ? pi.extensions : [];
			for (const entry of extensions) {
				if (typeof entry !== "string") continue;
				if (!existsSync(path.resolve(manifestDir, entry))) {
					return buildViolation(
						config,
						exists,
						`${relativePath} declares pi.extensions entry '${entry}', but the path is missing.`,
					);
				}
			}
			const skills = Array.isArray(pi.skills) ? pi.skills : [];
			for (const entry of skills) {
				if (typeof entry !== "string") continue;
				if (!existsSync(path.resolve(manifestDir, entry))) {
					return buildViolation(
						config,
						exists,
						`${relativePath} declares pi.skills entry '${entry}', but the path is missing.`,
					);
				}
			}
		}
	}

	if (config.npmRequireFilesCoverage.length > 0) {
		const files = Array.isArray(manifest.files) ? manifest.files : [];
		for (const required of config.npmRequireFilesCoverage) {
			if (!files.includes(required)) {
				return buildViolation(
					config,
					exists,
					`${relativePath} 'files' must include '${required}' for publish coverage.`,
				);
			}
		}
	}

	return undefined;
}



function buildViolation(
	config: PackagePolicyConfig,
	exists: boolean,
	reason: string,
): Violation {
	return {
		policyId: "package",
		ruleId: config.id,
		mode: exists ? config.editMode : config.mode,
		reason,
	};
}
