---
name: conventions-guard
description: Review and tune an existing `.pi/conventions.json` after `/conventions create`, adapting structure, naming, and optional documentation policies for a repo, framework, or monorepo. Use for auditing or refining conventions configs. Do not use for deterministic scaffolding; prefer `/conventions create...`.
disable-model-invocation: true
---

# Conventions Guard

Use this skill after the extension has created a conventions file, or when you need to review and tune an existing one.

## References

| Topic                   | File                                                                         | When to read                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Review generated config | [references/scaffold-project-files.md](references/scaffold-project-files.md) | After `/conventions create`, when comparing against shipped examples, or when reviewing a copied config                         |
| Tune policy behavior    | [references/policy-tuning.md](references/policy-tuning.md)                   | Tightening or loosening structure, naming, and optional documentation rules, or adapting the config for a framework or monorepo |

## Quick Decisions

**Need a first config?** -> Use `/conventions create` or `/conventions create <preset>` first. Do not use this skill as the primary scaffolding path.

**Reviewing generated structure, layers, naming, or fallback behavior?** -> Read [review generated config](references/scaffold-project-files.md)

**Changing create vs edit enforcement, forbidden segments, naming rules, or documentation checks?** -> Read [tune policy behavior](references/policy-tuning.md)

**Adapting the generated config for React, Astro, or a monorepo?** -> Read both references, then tune `.pi/conventions.json` directly.
