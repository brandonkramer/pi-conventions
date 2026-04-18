import { describe, expect, it } from "vitest";
import { normalizeNamingPolicy, evaluateNamingViolation } from "../src/policies/naming.ts";
import { normalizeStructurePolicy, evaluateStructureViolation } from "../src/policies/structure.ts";

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
    expect(evaluateStructureViolation("src/utils/http-client.ts", false, config!)).toMatchObject({
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

    const violation = evaluateStructureViolation("src/new-file.ts", false, config!);
    expect(violation).toMatchObject({ policyId: "structure", mode: "confirm" });
    expect(violation?.reason).toContain("declared architecture zone");
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

    const violation = evaluateNamingViolation("src/components/button.tsx", false, config!);
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

    const violation = evaluateNamingViolation("src/features/helpers/use-session.ts", false, config!);
    expect(violation).toMatchObject({ policyId: "naming", mode: "confirm" });
    expect(violation?.reason).toContain("helpers");
  });
});
