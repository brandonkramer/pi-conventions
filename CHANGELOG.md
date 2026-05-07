# Changelog

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
