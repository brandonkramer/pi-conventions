# pi-conventions

**Pi package** for enforcing deterministic codebase conventions: structure, naming, documentation, size, and lightweight dependency boundaries.

## Install

```bash
pi install npm:pi-conventions
```

## Quick start

1. Restart pi or run `/reload` after install.
2. Scaffold a config: `/conventions create` (or `create rust|typescript|ts|go|python|documentation|fallback`).
3. Inspect with `/conventions`. Tune with `/skill:conventions-guard` if you want guided review.

Config lookup: project `.pi/conventions.json`, global fallback `~/.pi/agent/conventions.json`. Project replaces global by default; set `"extendsGlobal": true` to layer global policies underneath project rules.

When active policies exist, the extension injects a compact `## Conventions` summary into the system prompt, and intercepts `write`/`edit` to enforce them.

## Commands

| Command                                | Use                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `/conventions`                         | Show active config                                                                              |
| `/conventions create [<lang>]`         | Scaffold config (`rust`, `typescript`, `ts`, `go`, `python`, `documentation`, `fallback`)       |
| `/conventions reload`                  | Reload after manual config edits                                                                |
| `/conventions check <path>`            | Evaluate one file or proposed path                                                              |
| `/conventions audit`                   | Read-only repo scan (Git-aware; falls back to built-in ignore list)                             |
| `/conventions audit --include-ignored` | Include Git-ignored files                                                                       |
| `/conventions audit --changed`         | Audit only locally changed files (staged + unstaged + untracked; deleted files skipped)         |
| `--json`                               | Machine-readable output (works on `check` and `audit`)                                          |
| `--policy <name>`                      | Filter to one family: `structure`, `naming`, `documentation`, `size`, `dependencies`, `package` |

## Config shape

```json
{
  "$schema": "./conventions.schema.json",
  "extendsGlobal": true,
  "ignorePaths": ["vendor/**", "**/*.generated.ts"],
  "policies": {
    "structure": {
      "mode": "block",
      "editMode": "warn",
      "sourceRoots": ["src/"],
      "forbiddenSegments": ["utils", "helpers", "common", "misc"]
    },
    "naming": {
      "rules": [
        {
          "id": "naming.rs.modules",
          "prefixes": ["src/"],
          "pathKinds": ["file"],
          "extensions": ["rs"],
          "requireCase": "snake_case",
          "forbiddenNames": ["util", "utils", "helper", "helpers"]
        }
      ]
    },
    "size": {
      "limits": [
        {
          "id": "size.core.500",
          "prefixes": ["src/"],
          "extensions": ["ts", "tsx", "rs", "go"],
          "exclude": ["src/**/*.generated.ts"],
          "maxLines": 500
        }
      ]
    },
    "dependencies": {
      "mode": "block",
      "rules": [
        {
          "from": ["src/**/*.ts"],
          "exclude": ["src/extract/**"],
          "to": ["src/extract/verticals/**"],
          "reason": "Reach verticals through src/extract/registry.ts only."
        }
      ]
    },
    "documentation": {
      "rules": [
        {
          "kind": "requireFileOverview",
          "paths": ["src/**/*.ts"],
          "exclude": ["src/**/*.d.ts"]
        },
        {
          "kind": "todoFormat",
          "paths": ["src/**", "test/**"],
          "format": "TAG: concrete action - referent"
        }
      ]
    }
  }
}
```

Each rule/limit accepts an optional `id` (surfaced in diagnostics as `policy:id`) and `exclude` (suppresses the rule for matching paths). Top-level `ignorePaths` suppresses findings across all policies. See `schemas/conventions.schema.json` for the full schema.

## Policies

**Structure** — file placement, architecture zones, catch-all folder blocking (`utils`, `helpers`, `common`, `misc`), legacy zones, new top-level file control.

**Naming** — case styles (`kebab-case`, `snake_case`, `camelCase`, `PascalCase`), forbidden generic names, scoped by prefix/extension/path kind.

**Size** — `maxLines` and `maxBytes` budgets, optional `ignoreBlankLines`/`ignoreCommentLines`. Useful as a split-by-responsibility nudge.

**Dependencies** — lightweight relative import boundaries (`from` → `to`, with `exclude`) and raw specifier patterns (`forbidSpecifiers`/`allowSpecifiers`). Each rule supports `allow` to whitelist public entrypoints (e.g. `src/features/*/index.ts`). Scans static `import`/`export ... from` and relative dynamic imports. Does **not** do TS compiler resolution, path aliases, package export maps, call graphs, or circular dep detection. Use a linter for those.

**Documentation** — deterministic rules: `requireTsdocOnExports`, `requireFileOverview`, `forbidFileHeaders`, `forbidCommentPatterns`, `todoFormat`, `requireRationaleComments`.

**Package** — manifest hygiene for npm/Pi packages: `requireFields`, `requireFiles`, `piPackage.requireKeyword`, `piPackage.verifyResourcePaths` (verifies `pi.extensions[]`/`pi.skills[]` paths exist), and `npm.requireFilesCoverage` (verifies `package.json` `files` covers configured entries). All checks are local file/JSON — no network, no `npm publish`.

All policies default to `warn` and are additive — present only what you configure. Modes: `warn`, `confirm`, `block`. See `examples/` for focused starting points (`conventions.size.json`, `conventions.documentation.json`, `conventions.dependencies.json`, `conventions.package.json`, `conventions.extends-global.json`).
