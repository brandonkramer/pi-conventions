# Review Generated Conventions Files

Start with extension commands, not ad hoc JSON.

## Required workflow

1. Create/copy with `/conventions create...` unless intentionally editing an existing config.
2. Read the generated config and schema.
3. Run `/conventions audit` to find noisy or missing rules before tightening.
4. Tune only policies that match real repo structure and stable conventions.
5. Re-run `/conventions audit` or targeted `/conventions check <path>` after edits when practical.

## Create commands

```text
/conventions create
/conventions create rust|typescript|ts|go|python|documentation
/conventions create fallback
```

- `create`: inspect repo -> generate `structure` + `naming`.
- Presets: copy shipped examples into repo.
- `fallback`: write global config to `~/.pi/agent/conventions.json`.
- Commands reload pi and ask before overwrite when UI exists.

## Files

Project:

- `.pi/conventions.json`
- `.pi/conventions.schema.json`

Global fallback:

- `~/.pi/agent/conventions.json`
- `~/.pi/agent/conventions.schema.json`

Default lookup is replacement: project config replaces global fallback. Use `extendsGlobal: true` only when global policies should layer into the repo.

## Review order

1. `notes` — short, repo-specific.
2. `structure.sourceRoots` — real source roots.
3. `structure.layers` — high-value real directories.
4. `structure.legacyZones` — actual migration boundaries.
5. `structure.newTopLevelFiles` — stable entrypoint expectations.
6. `naming.rules` — stable naming only.
7. Optional `documentation.rules` — deterministic comment checks.
8. Optional `size.limits` — scoped line/byte budgets.
9. Optional `dependencies.rules` — lightweight relative import boundaries.
10. `extendsGlobal` — only when inherited defaults should apply.

## Examples

Use as tuning references, not blind replacements:

- `examples/conventions.react.json`
- `examples/conventions.astro.json`
- `examples/conventions.typescript.json`
- `examples/conventions.documentation.json`
- `examples/conventions.size.json`
- `examples/conventions.dependencies.json`
- `examples/conventions.extends-global.json`

## Guardrails

- If naming is stable: keep/tighten `policies.naming`.
- If naming is fluid: keep `warn`, narrow prefixes, or remove naming.
- One root monorepo config is OK only when one policy truly governs the repo.
- If broad/noisy, tighten `sourceRoots`, `layers`, and prefixes before adding exceptions.
- Keep polyglot root configs conservative; add language/framework detail only where it pays.
- Do not switch broad rules to `block` until audit output is clean enough.

## Done when

- Config/schema reviewed.
- Paths/layers/naming reflect real repo state.
- Legacy zones and top-level exceptions are intentional.
- Optional docs/size/dependency rules are scoped and low-noise.
- `extendsGlobal` is intentional.
- Audit/check result was run or skipped with rationale.
