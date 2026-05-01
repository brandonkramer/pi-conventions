# pi-conventions

**Pi package** for enforcing codebase conventions.

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
   - `/conventions create fallback`
3. Use `/conventions` to inspect the active policy
4. Optionally use `/skill:conventions-guard` to review and tune the generated config after creation

Convention lookup:

- project: `.pi/conventions.json`
- global fallback: `~/.pi/agent/conventions.json`

`/conventions create` inspects the current repo and generates both `structure` and `naming` policies to match the repo's observed layout and naming style.

Language-specific create commands copy from the examples folder.

The companion skill is optional and exists only for guided review and tuning after creation.

`/conventions create` and `/conventions create rust|typescript|ts|go|python` scaffold:

- `.pi/conventions.json`
- `.pi/conventions.schema.json`

`/conventions create fallback` scaffolds:

- `~/.pi/agent/conventions.json`
- `~/.pi/agent/conventions.schema.json`

All create commands reload pi automatically. `/conventions reload` is only needed after you manually edit the config.

## Config shape

```json
{
  "$schema": "./conventions.schema.json",
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
          "prefixes": ["src/"],
          "pathKinds": ["file"],
          "requireCase": "snake_case",
          "extensions": ["rs"],
          "forbiddenNames": ["util", "utils", "helper", "helpers"],
          "reason": "Use descriptive snake_case module names."
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
          "kind": "todoFormat",
          "paths": ["src/**", "test/**"],
          "allowedTags": ["TODO", "FIXME"],
          "format": "TAG: description"
        }
      ]
    }
  }
}
```

What it enforces:

### Structure policy

- catch-all folder blocking like `utils`, `helpers`, `common`, `misc`
- legacy zone protection
- new top-level source-file discouragement/blocking
- architecture-zone guidance in the system prompt
- write/edit interception for file-placement violations

### Naming policy

- require case styles like `kebab-case`, `snake_case`, `camelCase`, or `PascalCase`
- forbid generic file or directory names like `index`, `helpers`, or `shared` under selected prefixes
- scope rules to selected extensions and path kinds
- warn, confirm, or block on create/edit

### Documentation policy (optional)

Documentation checks are additive and disabled unless `policies.documentation` is present. They inspect post-mutation file content for `write` and `edit` calls and default to `warn`.

Supported deterministic rules:

- `requireTsdocOnExports` — require immediately preceding `/** ... */` TSDoc before exported `interface`, `type`, `function`, `class`, or `const` declarations in matching paths; optionally require `@remarks`
- `forbidFileHeaders` — flag configured blanket header patterns near the top of matching files, such as `copyright`, `licensed under`, or `spdx-license-identifier`
- `todoFormat` — require `TODO: description` / `FIXME: description` style comments with configured tags
- `requireRationaleComments` — warn when sensitive matching files do not contain enough comments with configured rationale keywords

Scope documentation rules narrowly and exclude generated, vendored, or unusually large files when possible. Content checks are deterministic and intentionally simple, so matching very large files can add linear scan cost to write/edit hooks.

See `examples/conventions.documentation.json` for a documentation-focused example. Copy it manually for now if you want a documentation-only starting point.
