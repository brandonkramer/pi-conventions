# Policy Tuning

Tune `.pi/conventions.json` after `/conventions create` or after copying a shipped example.

## Required workflow

1. Read current config first.
2. For broad changes, run `/conventions audit` before tightening.
3. Add/change the narrowest deterministic rule that closes the gap.
4. Prefer `warn` -> audit -> `confirm`/`block` for noisy policies.
5. Re-run `/conventions audit` or targeted `/conventions check <path>`.
6. Fix or report any warnings on files you touched.

## Invariants

- Match repo reality; do not encode aspirational architecture.
- Keep rules deterministic, scoped, and low-noise.
- Keep `notes` short and repo-specific.
- Every exception needs a reason; no silent special cases.
- If a rule is mandatory for agents, use `confirm`/`block` or document the follow-up workflow.

## Policy rules

### Structure

- Scope to file placement and architecture zones.
- `forbiddenSegments`: safe defaults `utils`, `helpers`, `common`, `misc`; add `shared` only if it is a junk drawer.
- `legacyZones[].onCreate/onEdit`: directories in transition.
- `newTopLevelFiles`: only when zones/entrypoints are stable.
- Modes: new-file placement mistakes can be `block`; migration edits start `warn`/`confirm`.

Never forbid legitimate framework/toolchain dirs:

- Go: `internal`, `cmd`, `pkg`
- Astro: `pages`, `layouts`, `components`, `actions`, `content`, `styles`, `assets`, `icons`
- Next.js: `app`, `api`, `(group)`, `@slot`
- Rust: `crates`, `target`
- Python: `src`, `tests`, `.venv`
- npm workspaces: `apps`, `packages`, `node_modules`

### Naming

Use only for stable conventions worth enforcing.

- Rust/Python: usually `snake_case` modules/packages.
- TypeScript: `kebab-case` only when repo already uses it.
- React: components/providers often `PascalCase`; support files/folders often `kebab-case`; hooks follow repo convention.
- Astro: components/layouts often `PascalCase`; content slugs usually `kebab-case`; avoid fighting `src/pages/` routes.
- Go: do not blanket-force `snake_case`; prefer blocking generic names.

### Documentation

Use deterministic checks only; leave subjective comment quality to AGENTS/README prose.

Supported: `requireTsdocOnExports`, `requireFileOverview`, `forbidFileHeaders`, `forbidCommentPatterns`, `todoFormat`, `requireRationaleComments`.

- Start `warn` unless proven low-noise.
- Scope paths narrowly; exclude generated/vendor/large files.
- For agent-must-follow rules like `@fileoverview`, prefer `block` once existing findings are resolved.
- Checks are linear scans of matching post-mutation content.

### Size

Use for reviewability/file-splitting pressure.

- Start `warn`; move to `block` only when the limit is an accepted hard cap.
- Scope by `prefixes` + `extensions`.
- `maxLines` = reviewability; `maxBytes` = generated/data-like files.
- `ignoreBlankLines`/`ignoreCommentLines` only if team agrees.
- Avoid generated/vendor directories.

### Dependencies

Use for lightweight relative import boundaries, not full linting.

- Rule shape: `from`, optional `exclude`, `to`, optional `reason`.
- Good use: block imports into implementation-only verticals except via a registry.
- Keep path patterns repo-relative and narrow.
- No TS compiler resolution, path aliases, package exports, call graph, circular deps, or framework semantics.
- For full import architecture, use a linter/dependency tool instead.

### Global fallback layering

Default: project `.pi/conventions.json` replaces `~/.pi/agent/conventions.json`.
Use `extendsGlobal: true` only when global policies should layer in.

- Global notes/rules appear before project notes/rules.
- Global naming/docs/size/dependencies evaluate before project rules.
- Keep fallback mostly `warn` so it works across unrelated projects.

## Common choices

- Greenfield layered repo: structure create `block`, edit `warn`; top-level rule only after entrypoints are clear.
- Mid-migration: structure create `block`, edit `warn`; explicit legacy zones.
- Loose legacy repo: structure create/edit `warn`; top-level rule disabled.
- Fluid naming: omit naming or keep narrow + warn-only.
- Documentation guidance: deterministic docs rules with `warn`; make mandatory only after cleanup.
- Large files growing: scoped size limits.
- Global defaults: project `extendsGlobal: true`.

## Linter boundary

Conventions guard covers placement, stable naming, deterministic docs, size, and lightweight relative import boundaries. Linters cover broader code quality/import graphs.

Examples: ESLint boundaries/Biome, `go-arch-lint`, `clippy`, Ruff, Astro/React framework lint.

If both are active, add a note: `<tool> enforces imports/code quality; conventions guard enforces placement/naming/docs/size/lightweight boundaries.`

## Done when

- Warnings on touched files fixed or explicitly reported.
- Structure maps to real directories and migration boundaries.
- Top-level file exceptions are real entrypoints/intentional exceptions.
- Naming reflects stable conventions.
- Docs/size/dependency rules are deterministic, scoped, and low-noise.
- Forbidden segments do not block legitimate framework/toolchain dirs.
- Notes are short and repo-specific.
- Audit/check result was run or skipped with rationale.
