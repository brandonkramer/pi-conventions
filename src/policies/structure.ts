/** @fileoverview Structure policy normalization and evaluation. */
import { normalizePrefix, normalizeRelativePath } from "../core/path.ts";
import { parseMode, uniqueStrings } from "../core/strings.ts";
import type { EnforcementMode, Violation } from "../core/types.ts";

export interface RawStructureLayer {
	name?: string;
	description?: string;
	prefixes?: unknown[];
}

export interface RawStructureLegacyZone {
	id?: string;
	prefixes?: unknown[];
	reason?: string;
	onCreate?: EnforcementMode;
	onEdit?: EnforcementMode;
}

export interface RawTopLevelFileRule {
	enabled?: boolean;
	mode?: EnforcementMode;
	allowedFiles?: unknown[];
	extensions?: unknown[];
}

export interface RawStructurePolicyConfig {
	mode?: EnforcementMode;
	editMode?: EnforcementMode;
	sourceRoots?: unknown[];
	forbiddenSegments?: unknown[];
	layers?: RawStructureLayer[];
	legacyZones?: RawStructureLegacyZone[];
	newTopLevelFiles?: RawTopLevelFileRule;
	notes?: unknown[];
}

export interface StructureLayer {
	name: string;
	description?: string;
	prefixes: string[];
}

export interface StructureLegacyZone {
	id?: string;
	prefixes: string[];
	reason: string;
	onCreate: EnforcementMode;
	onEdit: EnforcementMode;
}

export interface StructureTopLevelFileRule {
	enabled: boolean;
	mode: EnforcementMode;
	allowedFiles: Set<string>;
	extensions: string[];
}

export interface StructurePolicyConfig {
	mode: EnforcementMode;
	editMode: EnforcementMode;
	sourceRoots: string[];
	forbiddenSegments: string[];
	layers: StructureLayer[];
	legacyZones: StructureLegacyZone[];
	newTopLevelFiles: StructureTopLevelFileRule;
	notes: string[];
}

const DEFAULT_MODE: EnforcementMode = "warn";
const DEFAULT_EDIT_MODE: EnforcementMode = "warn";
const DEFAULT_SOURCE_ROOTS = ["src/"];
const DEFAULT_FORBIDDEN_SEGMENTS = ["utils", "helpers", "common", "misc"];
const DEFAULT_TOP_LEVEL_EXTENSIONS = [
	"rs",
	"go",
	"ts",
	"tsx",
	"mts",
	"cts",
	"d.ts",
];

export function normalizeStructurePolicy(
	raw: RawStructurePolicyConfig | undefined,
): StructurePolicyConfig | undefined {
	if (
		raw !== undefined &&
		(typeof raw !== "object" || raw === null || Array.isArray(raw))
	) {
		return undefined;
	}

	const candidate = raw ?? {};
	const mode = parseMode(candidate.mode, DEFAULT_MODE);
	const editMode = parseMode(candidate.editMode, DEFAULT_EDIT_MODE);
	const sourceRoots = uniqueStrings(candidate.sourceRoots, normalizePrefix);
	const forbiddenSegments = uniqueStrings(
		candidate.forbiddenSegments,
		(value) => value.toLowerCase(),
	);
	const layers = (candidate.layers ?? [])
		.map((layer): StructureLayer | undefined => {
			if (typeof layer?.name !== "string") return undefined;
			const prefixes = uniqueStrings(layer.prefixes, normalizePrefix);
			if (prefixes.length === 0) return undefined;
			return {
				name: layer.name.trim(),
				description:
					typeof layer.description === "string"
						? layer.description.trim()
						: undefined,
				prefixes,
			};
		})
		.filter((layer): layer is StructureLayer => layer !== undefined);
	const legacyZones = (candidate.legacyZones ?? [])
		.map((zone): StructureLegacyZone | undefined => {
			const prefixes = uniqueStrings(zone.prefixes, normalizePrefix);
			if (
				prefixes.length === 0 ||
				typeof zone.reason !== "string" ||
				zone.reason.trim().length === 0
			) {
				return undefined;
			}
			return {
				id:
					typeof zone.id === "string" && zone.id.trim().length > 0
						? zone.id.trim()
						: undefined,
				prefixes,
				reason: zone.reason.trim(),
				onCreate: parseMode(zone.onCreate, mode),
				onEdit: parseMode(zone.onEdit, editMode),
			};
		})
		.filter((zone): zone is StructureLegacyZone => zone !== undefined);
	const topLevelRule = candidate.newTopLevelFiles ?? {};
	const topLevelExtensions = uniqueStrings(topLevelRule.extensions, (value) =>
		value.toLowerCase(),
	);
	const notes = uniqueStrings(candidate.notes, (value) => value);

	return {
		mode,
		editMode,
		sourceRoots: sourceRoots.length > 0 ? sourceRoots : DEFAULT_SOURCE_ROOTS,
		forbiddenSegments:
			forbiddenSegments.length > 0
				? forbiddenSegments
				: DEFAULT_FORBIDDEN_SEGMENTS,
		layers,
		legacyZones,
		newTopLevelFiles: {
			enabled: topLevelRule.enabled ?? true,
			mode: parseMode(topLevelRule.mode, mode),
			allowedFiles: new Set(
				uniqueStrings(topLevelRule.allowedFiles, normalizeRelativePath),
			),
			extensions:
				topLevelExtensions.length > 0
					? topLevelExtensions
					: DEFAULT_TOP_LEVEL_EXTENSIONS,
		},
		notes,
	};
}

export function evaluateStructureViolation(
	relativePath: string,
	exists: boolean,
	config: StructurePolicyConfig,
): Violation | undefined {
	if (!isUnderSourceRoot(relativePath, config)) {
		return undefined;
	}

	const forbiddenSegment = findForbiddenSegment(relativePath, config);
	if (forbiddenSegment) {
		return {
			policyId: "structure",
			mode: exists ? config.editMode : config.mode,
			reason: `Avoid catch-all modules or folders such as '${forbiddenSegment}'. Create or keep code in a responsibility-specific module instead.`,
		};
	}

	const legacyZone = findLegacyZone(relativePath, config);
	if (legacyZone) {
		return {
			policyId: "structure",
			ruleId: legacyZone.id,
			mode: exists ? legacyZone.onEdit : legacyZone.onCreate,
			reason: legacyZone.reason,
		};
	}

	if (exists) {
		return undefined;
	}

	if (
		config.newTopLevelFiles.enabled &&
		isNewTopLevelSourceFile(relativePath, config)
	) {
		return {
			policyId: "structure",
			mode: config.newTopLevelFiles.mode,
			reason: buildTopLevelFileReason(config),
		};
	}

	return undefined;
}

export function buildStructurePromptLines(
	config: StructurePolicyConfig,
): string[] {
	const lines = [
		`Default new-file mode: ${config.mode}.`,
		`Default existing-file edit mode: ${config.editMode}.`,
	];

	if (config.layers.length > 0) {
		lines.push("", "Declared architecture zones:");
		for (const layer of config.layers) {
			const description = layer.description ? ` — ${layer.description}` : "";
			lines.push(`- ${layer.name}: ${layer.prefixes.join(", ")}${description}`);
		}
	}

	if (config.forbiddenSegments.length > 0) {
		lines.push(
			"",
			`Avoid creating catch-all path segments: ${config.forbiddenSegments.join(", ")}.`,
		);
	}

	if (config.legacyZones.length > 0) {
		lines.push("", "Legacy zones that should not grow with new files:");
		for (const zone of config.legacyZones) {
			lines.push(
				`- ${zone.prefixes.join(", ")} -> create: ${zone.onCreate}, edit: ${zone.onEdit}. ${zone.reason}`,
			);
		}
	}

	if (config.newTopLevelFiles.enabled) {
		const allowedRootFiles = [...config.newTopLevelFiles.allowedFiles];
		if (allowedRootFiles.length > 0) {
			lines.push(
				"",
				`Allowed top-level source files: ${allowedRootFiles.join(", ")}.`,
			);
		}
		lines.push(
			"",
			"Do not create new top-level source files when a declared architecture zone is a better fit.",
		);
	}

	if (config.notes.length > 0) {
		lines.push("", "Structure notes:");
		for (const note of config.notes) {
			lines.push(`- ${note}`);
		}
	}

	return lines;
}

function isUnderSourceRoot(
	relativePath: string,
	config: StructurePolicyConfig,
): boolean {
	return config.sourceRoots.some((root) => relativePath.startsWith(root));
}

function findForbiddenSegment(
	relativePath: string,
	config: StructurePolicyConfig,
): string | undefined {
	const segments = relativePath
		.split("/")
		.map((segment) => segment.toLowerCase());
	return config.forbiddenSegments.find((segment) => segments.includes(segment));
}

function findLegacyZone(
	relativePath: string,
	config: StructurePolicyConfig,
): StructureLegacyZone | undefined {
	return config.legacyZones.find((zone) =>
		zone.prefixes.some((prefix) => relativePath.startsWith(prefix)),
	);
}

function isNewTopLevelSourceFile(
	relativePath: string,
	config: StructurePolicyConfig,
): boolean {
	for (const root of config.sourceRoots) {
		if (!relativePath.startsWith(root)) continue;
		const relativeToRoot = relativePath.slice(root.length);
		if (relativeToRoot.length === 0 || relativeToRoot.includes("/")) {
			return false;
		}
		if (config.newTopLevelFiles.allowedFiles.has(relativePath)) {
			return false;
		}
		const extension = relativeToRoot.endsWith(".d.ts")
			? "d.ts"
			: relativeToRoot.split(".").pop()?.toLowerCase();
		return (
			extension !== undefined &&
			config.newTopLevelFiles.extensions.includes(extension)
		);
	}
	return false;
}

function buildTopLevelFileReason(config: StructurePolicyConfig): string {
	if (config.layers.length === 0) {
		return "New top-level source files are discouraged. Put new code under an existing responsibility-specific subdirectory instead.";
	}

	const layerSummary = config.layers
		.map((layer) => `${layer.name}: ${layer.prefixes.join(", ")}`)
		.join("; ");
	return `New top-level source files are discouraged. Put new code under a declared architecture zone instead (${layerSummary}).`;
}
