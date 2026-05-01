import type {
	DocumentationPolicyConfig,
	RawDocumentationPolicyConfig,
} from "../policies/documentation.ts";
import type {
	NamingPolicyConfig,
	RawNamingPolicyConfig,
} from "../policies/naming.ts";
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
	mode: EnforcementMode;
	reason: string;
}

export interface RawConventionsConfig {
	notes?: unknown[];
	policies?: {
		structure?: RawStructurePolicyConfig;
		naming?: RawNamingPolicyConfig;
		documentation?: RawDocumentationPolicyConfig;
		size?: RawSizePolicyConfig;
	};
}

export interface ConventionsConfig {
	path: string;
	notes: string[];
	policies: {
		structure?: StructurePolicyConfig;
		naming?: NamingPolicyConfig;
		documentation?: DocumentationPolicyConfig;
		size?: SizePolicyConfig;
	};
}

export interface LoadState {
	cwdKey: string;
	config?: ConventionsConfig;
	error?: string;
}
