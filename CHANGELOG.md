# Changelog

## 0.4.0

- Add `policies.files` for file relationship/existence checks (`feat`).
  - `require` / `forbid` paths and `source` + `requireAny` pairing rules with `{stem}`/`{dir}`/`{path}` placeholders and `exclude` scoping.
- Add `policies.package` for npm/Pi manifest hygiene (`feat`).
  - `requireFields`, `requireFiles`, `piPackage.requireKeyword`, `piPackage.verifyResourcePaths`, `npm.requireFilesCoverage`.
- Add `/conventions audit --changed` to scope audit to staged + unstaged + untracked Git changes (`feat`).
  - Composes with `--json` and `--policy <name>`; rejects `--include-ignored`; clear error outside a Git repo.
- Extend dependencies policy with public-API allow lists and raw specifier rules (`feat`).
  - `allow` whitelist for public entrypoints; `forbidSpecifiers` / `allowSpecifiers` match raw module specifiers (e.g. `@scope/*/src/**`).
- Add stable rule `id`s, per-rule `exclude` patterns, top-level `ignorePaths`, `--json` output, and `--policy <name>` filter to `check` and `audit` (`feat`).
- Migrate peer dependency to `@earendil-works/pi-coding-agent` scope (`chore`).
- Simplify source: −464 SLOC (−10.4%), same behavior, 82 tests pass (`refactor`).
- Simplify README with command table and tighter policy summaries (`docs`).

## 0.3.0

- Add dependencies policy for lightweight relative import-boundary enforcement.
  - Supports repo-relative `from`/`to` path rules with `exclude` exemptions.
  - Evaluates static import/export specifiers and relative dynamic imports on write/edit and audit.
  - Updates schema, README, examples, runtime prompt summary, and conventions-guard skill guidance.

## 0.2.4

- Simplify: remove 81 lines and 20 functions without changing behavior (`chore`).
  - Collapse `documentation-comments.ts` into `documentation.ts`.
  - Inline 12 single-use wrapper functions (`parseRuleKind`, `evaluateRule`, `greenText`, `unique`, `shouldIgnoreDirectory`, `fileExists`, `readDirectoryEntries`, `listGitAuditFiles`, `shouldSkipDirectory`, etc.).
  - Replace duplicate `fileExists` with existing `pathExists`.
  - Use standard JS idioms (`[...new Set(...)]`) over custom helpers.
  - Metrics: 3044 LOC → 2963 (-2.7%), 405 functions → 385 (-4.9%).

## 0.2.3

- Performance: optimize documentation policy evaluation hot path (`perf`).
  - Forward-scan TSDoc block indexing instead of backward walks per export.
  - Direct raw-string regex scan for TODO/FIXME (avoids line-split overhead).
  - Inline whitespace scan (avoids `trimStart()`/`trim()` string allocation).
  - Direct `RegExp.exec` loops for comment/rationale rules (avoids `matchAll` + array allocation).
  - Bitwise AND mask for declaration kind checks (avoids `.includes()` per export).
  - Raw-string scan for file overview (avoids second `content.split()`).
  - `RegExp.lastIndex` reset correctness fix for shared regex singletons.
  - Metrics: `eval_medium_us` 44.7μs → ~32μs (-28%), `eval_large_us` 545μs → ~129μs (-76%).

## 0.2.2

- Improve conventions source status labels, showing `global`, `project`, or `global + project`.

## 0.2.1

- Fix GitHub Actions npm Trusted Publishing setup.

## 0.2.0

- Add size policy and file-size diagnostics (`feat`).
- Add deterministic documentation policy enforcing TSDoc, headers, todos, and rationale (`feat`).
- Add git-aware audit with global config layering support (`feat`).

## 0.1.0

- Initial public release of `pi-conventions`.
