import { describe, expect, it } from "vitest";
import {
	evaluateDocumentationViolation,
	normalizeDocumentationPolicy,
} from "../src/policies/documentation.ts";
import {
	evaluateNamingViolation,
	normalizeNamingPolicy,
} from "../src/policies/naming.ts";
import {
	evaluateSizeViolation,
	normalizeSizePolicy,
} from "../src/policies/size.ts";
import {
	evaluateStructureViolation,
	normalizeStructurePolicy,
} from "../src/policies/structure.ts";

describe("structure policy", () => {
	it("blocks forbidden catch-all segments on create", () => {
		const config = normalizeStructurePolicy({
			mode: "block",
			editMode: "warn",
			sourceRoots: ["src/"],
			forbiddenSegments: ["utils"],
			newTopLevelFiles: { enabled: false },
		});

		expect(config).toBeDefined();
		expect(
			evaluateStructureViolation("src/utils/http-client.ts", false, config!),
		).toMatchObject({
			policyId: "structure",
			mode: "block",
		});
	});

	it("uses the top-level source file rule for new files", () => {
		const config = normalizeStructurePolicy({
			mode: "warn",
			sourceRoots: ["src/"],
			layers: [{ name: "features", prefixes: ["src/features/"] }],
			newTopLevelFiles: {
				enabled: true,
				mode: "confirm",
				allowedFiles: ["src/main.ts"],
				extensions: ["ts"],
			},
		});

		const violation = evaluateStructureViolation(
			"src/new-file.ts",
			false,
			config!,
		);
		expect(violation).toMatchObject({ policyId: "structure", mode: "confirm" });
		expect(violation?.reason).toContain("declared architecture zone");
	});
});

describe("documentation policy", () => {
	it("requires TSDoc on configured exported declarations", () => {
		const config = normalizeDocumentationPolicy({
			rules: [
				{
					kind: "requireTsdocOnExports",
					paths: ["src/types.ts"],
					declarations: ["interface"],
					requireRemarks: true,
				},
			],
		});

		const missingTsdoc = evaluateDocumentationViolation(
			"src/types.ts",
			false,
			"export interface Result {\n  ok: boolean;\n}\n",
			config!,
		);
		expect(missingTsdoc).toMatchObject({
			policyId: "documentation",
			mode: "warn",
		});
		expect(missingTsdoc?.reason).toContain("needs TSDoc");

		const missingRemarks = evaluateDocumentationViolation(
			"src/types.ts",
			false,
			"/** Result contract. */\nexport interface Result {\n  ok: boolean;\n}\n",
			config!,
		);
		expect(missingRemarks?.reason).toContain("@remarks");

		expect(
			evaluateDocumentationViolation(
				"src/types.ts",
				false,
				"/**\n * Result contract.\n * @remarks Used across module boundaries.\n */\nexport interface Result {\n  ok: boolean;\n}\n",
				config!,
			),
		).toBeUndefined();
	});

	it("detects forbidden headers, invalid TODO format, and missing rationale comments", () => {
		const config = normalizeDocumentationPolicy({
			editMode: "confirm",
			rules: [
				{
					kind: "forbidFileHeaders",
					paths: ["src/**"],
					patterns: ["spdx-license-identifier"],
				},
				{
					kind: "todoFormat",
					paths: ["src/**"],
					allowedTags: ["TODO"],
				},
				{
					kind: "requireRationaleComments",
					paths: ["src/http/**"],
					commentKeywords: ["SSRF", "invariant"],
					minMatches: 1,
				},
			],
		});

		expect(
			evaluateDocumentationViolation(
				"src/client.ts",
				true,
				"// SPDX-License-Identifier: MIT\nexport {};\n",
				config!,
			),
		).toMatchObject({ mode: "confirm" });

		expect(
			evaluateDocumentationViolation(
				"src/client.ts",
				false,
				"// FIXME do it\n",
				config!,
			)?.reason,
		).toContain("not allowed");

		expect(
			evaluateDocumentationViolation(
				"src/http/client.ts",
				false,
				"export {};\n",
				config!,
			)?.reason,
		).toContain("rationale comments");
	});

	it("precompiles glob paths and matches brace patterns", () => {
		const config = normalizeDocumentationPolicy({
			rules: [
				{
					kind: "todoFormat",
					paths: ["src/tools/{define,result,progress}.ts"],
				},
			],
		});

		expect(
			evaluateDocumentationViolation(
				"src/tools/result.ts",
				false,
				"// TODO missing colon\n",
				config!,
			)?.reason,
		).toContain("TODO: description");
		expect(
			evaluateDocumentationViolation(
				"src/tools/other.ts",
				false,
				"// TODO missing colon\n",
				config!,
			),
		).toBeUndefined();
	});

	it("requires file overviews and supports pathPattern aliases", () => {
		const config = normalizeDocumentationPolicy({
			rules: [
				{
					kind: "requireFileOverview",
					pathPattern: ["src/**/*.ts"],
					requiredSections: ["Design:"],
					minMatches: 1,
				},
			],
		});

		expect(
			evaluateDocumentationViolation(
				"src/core/client.ts",
				false,
				"export {};\n",
				config!,
			)?.reason,
		).toContain("@fileoverview");
		expect(
			evaluateDocumentationViolation(
				"src/core/client.ts",
				false,
				"/**\n * @fileoverview Client.\n */\nexport {};\n",
				config!,
			)?.reason,
		).toContain("Design:");
		expect(
			evaluateDocumentationViolation(
				"src/core/client.ts",
				false,
				"/**\n * @fileoverview Client.\n * Design: Keeps transport policy local.\n */\nexport {};\n",
				config!,
			),
		).toBeUndefined();
	});

	it("enforces concrete TODO referents and forbidden comment patterns", () => {
		const config = normalizeDocumentationPolicy({
			rules: [
				{
					kind: "todoFormat",
					paths: ["src/**"],
					format: "TAG: concrete action - referent",
				},
				{
					kind: "forbidCommentPatterns",
					paths: ["src/**"],
					patterns: ["PR #", "ticket"],
				},
			],
		});

		expect(
			evaluateDocumentationViolation(
				"src/client.ts",
				false,
				"// TODO: fix this\n",
				config!,
			)?.reason,
		).toContain("concrete action");
		expect(
			evaluateDocumentationViolation(
				"src/client.ts",
				false,
				"// TODO: add retry backoff - see http/retry.ts\n",
				config!,
			),
		).toBeUndefined();
		expect(
			evaluateDocumentationViolation(
				"src/client.ts",
				false,
				"// See PR #42 for why.\n",
				config!,
			)?.reason,
		).toContain("pr #");
	});
});

describe("size policy", () => {
	it("flags line and byte limits for matching paths", () => {
		const config = normalizeSizePolicy({
			mode: "confirm",
			editMode: "block",
			limits: [
				{
					prefixes: ["src/"],
					extensions: ["ts"],
					maxLines: 2,
					maxBytes: 20,
				},
			],
		});

		expect(
			evaluateSizeViolation("src/file.ts", false, "one\ntwo\nthree\n", config!),
		).toMatchObject({ policyId: "size", mode: "confirm" });
		expect(
			evaluateSizeViolation(
				"src/file.ts",
				true,
				"123456789012345678901",
				config!,
			),
		).toMatchObject({ policyId: "size", mode: "block" });
		expect(
			evaluateSizeViolation(
				"test/file.ts",
				false,
				"one\ntwo\nthree\n",
				config!,
			),
		).toBeUndefined();
	});

	it("can ignore blank and comment lines", () => {
		const config = normalizeSizePolicy({
			limits: [
				{
					prefixes: ["src/"],
					maxLines: 2,
					ignoreBlankLines: true,
					ignoreCommentLines: true,
				},
			],
		});

		expect(
			evaluateSizeViolation(
				"src/file.ts",
				false,
				"// note\n\nconst a = 1;\nconst b = 2;\n",
				config!,
			),
		).toBeUndefined();
	});
});

describe("naming policy", () => {
	it("requires PascalCase for component files when configured", () => {
		const config = normalizeNamingPolicy({
			rules: [
				{
					prefixes: ["src/components/"],
					pathKinds: ["file"],
					requireCase: "PascalCase",
					extensions: ["tsx"],
				},
			],
		});

		const violation = evaluateNamingViolation(
			"src/components/button.tsx",
			false,
			config!,
		);
		expect(violation).toMatchObject({ policyId: "naming", mode: "warn" });
		expect(violation?.reason).toContain("PascalCase");
	});

	it("blocks generic directory names when a directory rule matches", () => {
		const config = normalizeNamingPolicy({
			mode: "confirm",
			rules: [
				{
					prefixes: ["src/features/"],
					pathKinds: ["directory"],
					forbiddenNames: ["helpers"],
				},
			],
		});

		const violation = evaluateNamingViolation(
			"src/features/helpers/use-session.ts",
			false,
			config!,
		);
		expect(violation).toMatchObject({ policyId: "naming", mode: "confirm" });
		expect(violation?.reason).toContain("helpers");
	});
});
