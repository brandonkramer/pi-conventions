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
