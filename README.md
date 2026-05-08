# pi-conventions

**Pi package** for enforcing deterministic codebase conventions: structure, naming, documentation, size, and lightweight dependency boundaries.

## Install

```bash
# from npm
pi install npm:pi-conventions
```

Alternatives

```bash
# install into project-local .pi/settings.json instead of global settings
pi install -l npm:pi-conventions

# try the runtime entrypoint temporarily for one run
pi -e /absolute/path/to/pi-conventions/src/index.ts
```

## Usage

1. After install restart pi or run `/reload`
2. Create a policy file with one of these commands:
   - `/conventions create`
   - `/conventions create rust`
   - `/conventions create typescript`
   - `/conventions create ts`
   - `/conventions create go`
   - `/conventions create python`
   - `/conventions create documentation`
   - `/conventions create fallback`
3. Use `/conventions` to inspect the active policy
4. Optionally use `/skill:conventions-guard` to review and tune the generated config after creation

Convention lookup:

- project: `.pi/conventions.json`
- global fallback: `~/.pi/agent/conventions.json`

By default, lookup is fallback-only: if a project config exists, it replaces the global fallback. Add top-level `"extendsGlobal": true` to a project config when it should inherit global policies and layer project rules on top. Inherited rule and limit entries keep the enforcement mode from their source config even when the project policy has a different top-level default.

Status labels use source names instead of file paths: `global`, `project`, or `global + project`.

For example, put a global `policies.size` guard in `~/.pi/agent/conventions.json`, then add this to a repo config that should inherit it:

```json
{
  "extendsGlobal": true,
  "policies": {
    "structure": { "sourceRoots": ["src/"] }
  }
}
```

`/conventions create` inspects the current repo and generates both `structure` and `naming` policies to match the repo's observed layout and naming style.

Language-specific create commands copy from the examples folder.

The companion skill is optional and exists only for guided review and tuning after creation.

When active policies exist, the extension injects a compact `## Conventions` system-prompt summary so agents see the current guardrails before editing. Runtime checks still enforce the full normalized config on write/edit and diagnostics commands.

`/conventions create` and `/conventions create rust|typescript|ts|go|python|documentation` scaffold:

- `.pi/conventions.json`
- `.pi/conventions.schema.json`

`/conventions create fallback` scaffolds:

- `~/.pi/agent/conventions.json`
- `~/.pi/agent/conventions.schema.json`

All create commands reload pi automatically. `/conventions reload` is only needed after you manually edit the config.

Diagnostics commands:

- `/conventions check <path>` evaluates one existing file or proposed path and reports matching policy findings.
- `/conventions audit` runs a read-only repo scan of active policies. In Git repositories it audits Git-visible files using Git's standard ignore rules (`.gitignore`, `.git/info/exclude`, and global excludes). Outside Git repositories it falls back to a conservative built-in ignore list for common generated/dependency outputs such as `.git/`, `node_modules/`, `dist/`, and `coverage/`.
- `/conventions audit --include-ignored` bypasses Git file discovery and uses the fallback walker.
- `/conventions audit --json` and `/conventions check <path> --json` emit machine-readable findings for agents, CI, and pre-commit hooks.
- `/conventions audit --policy <name>` and `/conventions check <path> --policy <name>` filter to a single policy family (`structure`, `naming`, `documentation`, `size`, `dependencies`). Composes with `--json`.

## Config shape

```json
{
  "$schema": "./conventions.schema.json",
  "extendsGlobal": true,
  "ignorePaths": ["vendor/**", "**/*.generated.ts"],
  "notes": ["Keep code organized by responsibility."],
  "policies": {
    "structure": {
      "mode": "block",
      "editMode": "warn",
      "sourceRoots": ["src/"],
      "forbiddenSegments": ["utils", "helpers", "common", "misc"]
    },
    "naming": {
      "mode": "warn",
      "rules": [
        {
          "id": "naming.rs.modules",
          "prefixes": ["src/"],
          "pathKinds": ["file"],
          "requireCase": "snake_case",
          "extensions": ["rs"],
          "forbiddenNames": ["util", "utils", "helper", "helpers"],
          "reason": "Use descriptive snake_case module names."
        }
      ]
    },
    "size": {
      "mode": "warn",
      "limits": [
        {
          "id": "size.core.500",
          "prefixes": ["src/"],
          "extensions": ["ts", "tsx", "rs", "go"],
          "maxLines": 500,
          "exclude": ["src/**/*.generated.ts"],
          "reason": "Split large files by responsibility."
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
          "reason": "Vertical extractors are reached through src/extract/registry.ts only."
        }
      ]
    },
    "documentation": {
      "mode": "warn",
      "rules": [
        {
          "kind": "requireTsdocOnExports",
          "paths": ["src/types.ts", "src/http/**"],
          "declarations": ["interface", "type", "function", "class", "const"],
          "requireRemarks": false
        },
        {
          "id": "docs.file-overview",
          "kind": "requireFileOverview",
          "paths": ["src/**/*.ts"],
          "exclude": ["src/**/*.d.ts"],
          "requiredTags": ["@fileoverview"],
          "requiredSections": ["Design:"],
          "optionalSections": ["Performance:"]
        },
        {
          "kind": "todoFormat",
          "paths": ["src/**", "test/**"],
          "allowedTags": ["TODO", "FIXME"],
          "format": "TAG: concrete action - referent"
        }
      ]
    }
  }
}
```

What it enforces:

- path placement and architecture-zone conventions
- stable file/directory naming conventions
- deterministic documentation hygiene
- file size budgets
- lightweight relative import-boundary rules

### Structure policy

- catch-all folder blocking like `utils`, `helpers`, `common`, `misc`
- legacy zone protection
- new top-level source-file discouragement/blocking
- architecture-zone guidance in the system prompt
- write/edit interception for file-placement violations

### Top-level `ignorePaths`

Add `ignorePaths` at the top level of the config to suppress findings for matching paths across all policies. Patterns support glob syntax (`**`, `*`, `{a,b}`). Ignored paths are skipped in write/edit evaluation, `/conventions check`, and `/conventions audit`.

### Naming policy

- require case styles like `kebab-case`, `snake_case`, `camelCase`, or `PascalCase`
- forbid generic file or directory names like `index`, `helpers`, or `shared` under selected prefixes
- scope rules to selected extensions and path kinds
- optional stable `id` for each rule, shown in diagnostics as `naming:your-id`
- optional per-rule `exclude` to suppress the rule for matching paths without disabling the whole policy
- warn, confirm, or block on create/edit

### Dependencies policy

Dependency checks are additive and disabled unless `policies.dependencies` is present. They inspect post-mutation file content for `write` and `edit` calls, run during audits when matching files are scanned, and default to `warn`.

Supported deterministic rule fields:

- `from` — source file path patterns to check
- `exclude` — source path patterns exempt from the rule
- `to` — resolved repo-relative target path patterns that are forbidden
- `reason` — project-specific explanation shown in guard output
- optional stable `id`, shown in diagnostics as `dependencies:your-id`

The policy only scans static `import` / `export ... from` specifiers and relative dynamic imports like `import("../x.js")`. Relative specifiers are normalized to repo-relative paths before matching. It intentionally does not perform TypeScript compiler resolution, path alias resolution, package export-map resolution, call graph analysis, circular dependency detection, or framework-specific module semantics.

### Size policy

Size checks are additive and disabled unless `policies.size` is present. They inspect file content when available and default to `warn`.

Supported deterministic limits:

- `maxLines` — warn/confirm/block when matching files exceed a configured line count
- `maxBytes` — warn/confirm/block when matching files exceed a configured UTF-8 byte count
- `extensions` — scope a limit to selected file extensions, including `d.ts`
- `ignoreBlankLines` and `ignoreCommentLines` — optionally count only substantive lines
- optional stable `id` for each limit, shown in diagnostics as `size:your-id`
- optional per-limit `exclude` to suppress the limit for matching paths

Use size policy to catch files that should be split by responsibility before they become hard to review. See `examples/conventions.size.json` for a focused starting point.

Size policy can also live in the global fallback config at `~/.pi/agent/conventions.json`. Project configs can inherit those global limits with top-level `"extendsGlobal": true`, which is useful when global size rules should act as a default file-size guard while each repo still owns its local structure/naming/docs rules. See `examples/conventions.extends-global.json` for a project config that layers local rules on top of global defaults.

### Documentation policy

Documentation checks are additive and disabled unless `policies.documentation` is present. They inspect post-mutation file content for `write` and `edit` calls and default to `warn`.

Supported deterministic rules:

- `requireTsdocOnExports` — require immediately preceding `/** ... */` TSDoc before exported `interface`, `type`, `function`, `class`, or `const` declarations in matching paths; optionally require `@remarks`
- `requireFileOverview` — require a leading TSDoc block with tags such as `@fileoverview` and optional section markers like `Design:` or `Performance:`
- `forbidFileHeaders` — flag configured blanket header patterns near the top of matching files, such as `copyright`, `licensed under`, or `spdx-license-identifier`
- `forbidCommentPatterns` — flag configured comment patterns, such as ticket or PR references, anywhere in matching files
- `todoFormat` — require `TODO: description` / `FIXME: description`, or stricter `TODO: concrete action - referent`, comments with configured tags
- `requireRationaleComments` — warn when sensitive matching files do not contain enough comments with configured rationale keywords
- optional stable `id` for each rule, shown in diagnostics as `documentation:your-id`
- optional per-rule `exclude` to suppress the rule for matching paths

Scope documentation rules narrowly and exclude generated, vendored, or unusually large files when possible. Content checks are deterministic and intentionally simple, so matching very large files can add linear scan cost to write/edit hooks.

See `examples/conventions.documentation.json` for a documentation-focused example, or scaffold it with `/conventions create documentation`.
