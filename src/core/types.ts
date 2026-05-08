/** @fileoverview Shared TypeScript types and interfaces. */
import type {
	DependenciesPolicyConfig,
	RawDependenciesPolicyConfig,
} from "../policies/dependencies.ts";
import type {
	DocumentationPolicyConfig,
	RawDocumentationPolicyConfig,
} from "../policies/documentation.ts";
import type {
	NamingPolicyConfig,
	RawNamingPolicyConfig,
} from "../policies/naming.ts";
import type {
	PackagePolicyConfig,
	RawPackagePolicyConfig,
} from "../policies/package.ts";
import type {
	RawSizePolicyConfig,
	SizePolicyConfig,
} from "../policies/size.ts";
import type {
	RawStructurePolicyConfig,
	StructurePolicyConfig,
} from "../policies/structure.ts";

export type EnforcementMode = "warn" | "confirm" | "block";

export interface Violation {
	policyId: string;
	ruleId?: string;
	mode: EnforcementMode;
	reason: string;
}

export interface RawConventionsConfig {
	extendsGlobal?: unknown;
	ignorePaths?: unknown[];
	notes?: unknown[];
	policies?: {
		structure?: RawStructurePolicyConfig;
		naming?: RawNamingPolicyConfig;
		documentation?: RawDocumentationPolicyConfig;
		size?: RawSizePolicyConfig;
		dependencies?: RawDependenciesPolicyConfig;
		package?: RawPackagePolicyConfig;
	};
}

export interface ConventionsConfig {
	path: string;
	sourcePaths?: string[];
	extendsGlobal?: boolean;
	ignorePaths: string[];
	ignoreMatchers: import("./pattern.ts").PathPattern[];
	notes: string[];
	policies: {
		structure?: StructurePolicyConfig;
		naming?: NamingPolicyConfig;
		documentation?: DocumentationPolicyConfig;
		size?: SizePolicyConfig;
		dependencies?: DependenciesPolicyConfig;
		package?: PackagePolicyConfig;
	};
}

export interface LoadState {
	cwdKey: string;
	config?: ConventionsConfig;
	error?: string;
	warnings?: string[];
}
