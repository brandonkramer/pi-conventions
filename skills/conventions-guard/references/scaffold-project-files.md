# Review Generated Conventions Files

Start with the extension command, not the skill.

## 1. Create the config first

Use one of these commands:

```text
/conventions create
/conventions create rust
/conventions create typescript
/conventions create ts
/conventions create go
/conventions create python
/conventions create documentation
/conventions create fallback
```

Use them this way:

- `/conventions create` inspects the current repo and generates repo-specific `structure` and `naming` policies.
- `/conventions create rust|typescript|ts|go|python|documentation` copies a shipped example into the repo.
- `/conventions create fallback` writes the global fallback config to `~/.pi/agent/conventions.json`.
- All create commands reload pi automatically.

## 2. Read the generated files

For project-local configs, review:

- `.pi/conventions.json`
- `.pi/conventions.schema.json`

For the global fallback, review:

- `~/.pi/agent/conventions.json`
- `~/.pi/agent/conventions.schema.json`

Project configs replace the global fallback by default. Set top-level `extendsGlobal: true` in a project config when global policies such as `policies.size` should also apply in that repo.

## 3. Review these sections first

Check these in order:

1. top-level `notes`
2. `policies.structure.sourceRoots`
3. `policies.structure.layers`
4. `policies.structure.legacyZones`
5. `policies.structure.newTopLevelFiles`
6. `policies.naming.rules`
7. optional `policies.documentation.rules`
8. optional `policies.size.limits`
9. top-level `extendsGlobal` when global defaults should apply

## 4. Compare against shipped examples when helpful

For frameworks without explicit preset commands, start with `/conventions create` and compare the generated file against the shipped examples.

Useful examples:

- `examples/conventions.react.json`
- `examples/conventions.astro.json`
- `examples/conventions.typescript.json`

Use examples as a tuning reference, not as something to copy blindly over a repo-specific config.

## 5. Decide whether naming rules are mature enough

If the repo has a stable naming convention, keep `policies.naming` and tighten it.

If naming is still in flux, it is acceptable to:

- keep naming at `warn`
- narrow the naming rules to only a few stable prefixes
- remove `policies.naming` entirely until the convention is real

## 6. Re-run create only when you want to replace the file

If conventions files already exist, rerun the command only when you intentionally want to replace them.

The command will ask for overwrite confirmation when a UI is available.

## Monorepo notes

- Use one shared root config only when one policy genuinely governs the whole repo.
- If one root config becomes too broad, tighten `sourceRoots`, `layers`, and naming prefixes before inventing many special cases.
- For polyglot repos, keep the root config conservative and put framework- or language-specific details only where they clearly pay for themselves.
- Use `extendsGlobal: true` when repo-local rules should layer on top of global fallback defaults instead of replacing them.

## Completion Checklist

- [ ] Conventions files were created with `/conventions create...`, not by ad hoc manual scaffolding.
- [ ] `sourceRoots` match the real repo layout.
- [ ] `layers` reflect real high-value directories, not aspirational architecture.
- [ ] `legacyZones` only cover actual migration boundaries.
- [ ] `newTopLevelFiles` matches real entrypoint expectations.
- [ ] Naming rules reflect stable conventions rather than temporary preferences.
- [ ] `extendsGlobal` is set only when inherited global policies should apply in this repo.
