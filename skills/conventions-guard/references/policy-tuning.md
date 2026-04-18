# Policy Tuning

Tune the repo-local `.pi/conventions.json` after `/conventions create`, or after copying one of the shipped examples into a repo.

## Rules

1. Keep `policies.structure` focused on file placement and architecture zones.
2. Use `policies.structure.legacyZones[].onCreate` and `onEdit` when a directory is in transition.
3. Keep `policies.structure.forbiddenSegments` short and obvious.
   - good: `utils`, `helpers`, `common`, `misc`
   - only add `shared` when it has actually become a junk-drawer in that repo
4. Enable `policies.structure.newTopLevelFiles` only when the architecture zones are already declared and stable.
5. Prefer `warn` or `confirm` for existing-file edits in migration zones before switching them to `block`.
6. Use `policies.naming` only for stable conventions that are worth enforcing.
7. Keep top-level `notes` short and repo-specific.

## Common Patterns

| Situation | Suggested policy |
|---|---|
| Greenfield layered repo | structure create `block`, edit `warn`, top-level rule enabled only when entrypoints are clear |
| Mid-migration repo | structure create `block`, edit `warn`, explicit legacy zones |
| Loose legacy repo | structure create `warn`, edit `warn`, top-level rule disabled |
| Naming conventions still fluid | omit `policies.naming` or keep it narrow and warn-only |

## Language and framework guidance

### Structure policy forbidden segments

These are safe to add in any language:

```json
["utils", "helpers", "common", "misc"]
```

Additional segments to consider only when they have become junk-drawers:

| Stack | Additional segment |
|---|---|
| TypeScript / React | `shared` |
| Astro | `shared` |
| Go | `shared` |

Do **not** add legitimate framework or toolchain directories to forbidden segments.

| Language / framework | Keep these |
|---|---|
| Go | `internal`, `cmd`, `pkg` |
| Astro | `pages`, `layouts`, `components`, `actions`, `content`, `styles`, `assets`, `icons` |
| Next.js | `app`, `api`, `(group)` route groups, `@slot` parallel routes |
| Rust workspaces | `crates`, `target` |
| Python | `src`, `tests`, `.venv` |
| npm workspaces | `apps`, `packages`, `node_modules` |

### Naming policy guidance

- **Rust**: use `snake_case` for module files and directories.
- **Python**: use `snake_case` for module files and package directories.
- **TypeScript**: use `kebab-case` when the repo already treats source files and directories that way.
- **React**: shared component or provider files are often `PascalCase`; support modules and folders are often `kebab-case`; hooks should follow the repo's real convention rather than an arbitrary rule.
- **Astro**: component and layout `.astro` files are often `PascalCase`; content slugs are usually `kebab-case`; avoid naming rules that fight `src/pages/` route conventions.
- **Go**: do **not** force `snake_case` as a blanket rule. Go files and packages are usually short lowercase names. Prefer blocking generic catch-all names over a strict case policy.

### Create vs edit behavior

- Use `block` for obvious new-file placement mistakes.
- Use `warn` or `confirm` for edits in legacy zones during migration.
- Keep the fallback config mostly `warn` so it stays safe across unrelated projects.

## Linter overlap

Conventions guard enforces where files live and what stable names are acceptable. Linters enforce import direction and code quality. Avoid duplicating effort.

| Stack | Linter or tool | What it covers that conventions guard does not |
|---|---|---|
| TypeScript / React | `eslint-plugin-boundaries`, Biome, or similar | Import direction between layers and circular dependencies |
| Go | `go-arch-lint` | Import path rules against declared architecture YAML |
| Rust | `clippy` | Code quality and unsafe or non-idiomatic patterns |
| Python | Ruff | Linting, formatting, and import sorting |
| Astro | ESLint / framework linting as applicable | JSX/TS integration issues, framework code quality checks |

When both conventions guard and a linter are active, add a note like: `"<tool> enforces imports or code quality; conventions guard enforces file placement and naming."`

## Completion Checklist

- [ ] Structure layers map to real directories.
- [ ] Structure legacy zones reflect current migration boundaries.
- [ ] Structure top-level file exceptions list only real entrypoints or intentional exceptions.
- [ ] Naming rules reflect stable conventions, not temporary preferences.
- [ ] Forbidden segments do not accidentally block legitimate framework or toolchain directories.
- [ ] Notes are short and repo-specific.
