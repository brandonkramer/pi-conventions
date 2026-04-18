import type {
  RawStructurePolicyConfig,
  StructurePolicyConfig,
} from "../policies/structure.ts";
import type {
  RawNamingPolicyConfig,
  NamingPolicyConfig,
} from "../policies/naming.ts";

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
  };
}

export interface ConventionsConfig {
  path: string;
  notes: string[];
  policies: {
    structure?: StructurePolicyConfig;
    naming?: NamingPolicyConfig;
  };
}

export interface LoadState {
  cwdKey: string;
  config?: ConventionsConfig;
  error?: string;
}
