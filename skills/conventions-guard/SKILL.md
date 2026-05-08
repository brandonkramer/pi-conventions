---
name: conventions-guard
description: Tune existing `.pi/conventions.json` policies after `/conventions create`; not for first scaffolding.
disable-model-invocation: true
---

# Conventions Guard

Use after the extension created a config, or when refining an existing `.pi/conventions.json`.

## Always start here

1. Identify target config: project `.pi/conventions.json` or global `~/.pi/agent/conventions.json`.
2. Read the config before recommending or editing.
3. If no config exists, run `/conventions create` or `/conventions create <preset>`; do not hand-scaffold first.
4. Run `/conventions audit` before tightening broad rules, unless the user asks for a single targeted edit.
5. Match the task to routing below; read only the needed reference.

## Hard rules

- Warnings on files you touched are required follow-up: fix them or explicitly report why not.
- Preserve repo reality over ideals; policies encode stable conventions, not aspirations.
- Prefer deterministic, scoped, low-noise rules; prove with audit before `block`.
- Do not silently add special cases; explain why any exception belongs in policy.
- After editing config, run `/conventions check <changed path>` or `/conventions audit` when practical.

## References

- Generated-file review: `references/scaffold-project-files.md`
  - Use after create, copied examples, or fallback/global layering review.
- Policy tuning: `references/policy-tuning.md`
  - Use for modes, forbidden segments, naming, docs, size, dependencies, framework/monorepo adaptation.

## Routing

- Review generated structure/layers/naming/fallback behavior -> generated-file review.
- Change enforcement or optional policies -> policy tuning.
- React/Astro/monorepo/polyglot adaptation -> both references, then edit config.
- User asks why a warning happened -> inspect matching policy + `/conventions check <path>`.
- User asks to make warnings impossible to ignore -> change noisy-but-required rules from `warn` to `confirm`/`block`, or add this as a documented workflow rule.

## Done when

- Config was read and the relevant reference followed.
- New/tightened rules are scoped to real paths and have clear reasons.
- Any touched-file warnings are fixed or reported.
- Validation command result is reported, or skipped with rationale.
