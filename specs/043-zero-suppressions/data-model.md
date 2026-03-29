# Data Model: Zero Suppressions

**Branch**: `043-zero-suppressions` | **Date**: 2026-03-28

## Overview

No new data entities are introduced. This feature modifies the **values** of two existing tracking artifacts to reflect a zero-suppression codebase.

## Modified Entities

### Suppression Baseline (`.suppression-baseline.json`)

**Schema**: Unchanged (version 1)

**Before** (current state):
```
total: 50
by_scope: { python-backend: 9, typescript-extension: 36, typescript-tests: 5 }
by_type: { eslint-disable-block: 2, eslint-disable-next-line: 38, noqa: 9, ts-expect-error: 1, ... }
by_file: { 25 files with non-zero counts }
by_rule: { 9 rules with non-zero counts }
```

**After** (target state):
```
total: 0
by_scope: { python-backend: 0, typescript-extension: 0, typescript-tests: 0 }
by_type: { all types: 0 }
by_file: { empty — no files have suppressions }
by_rule: { empty — no rules are suppressed }
```

### Ratchet Allowlist (`extension/tests/meta/suppression-ratchet.allowlist.json`)

**Before**:
```json
{
  "caps": [
    { "file": "tests/helpers/fs-test-utils.ts", "max": 1 },
    { "file": "tests/dashboard.test.ts", "max": 1 },
    { "file": "tests/production-issues.test.ts", "max": 2 }
  ],
  "zeroSuppressionFiles": [...]
}
```

**After**:
```json
{
  "caps": [],
  "zeroSuppressionFiles": [
    "tests/helpers/fs-test-utils.ts",
    "tests/dashboard.test.ts",
    "tests/production-issues.test.ts",
    "tests/setup.ts",
    "tests/harness/dom-harness.ts",
    "tests/local-mode-integration.test.ts"
  ]
}
```

All previously-capped files move to `zeroSuppressionFiles`. Caps array becomes empty.

## Code Refactoring (no configuration-level suppressions)

**Constraint**: No ESLint per-file rule disables and no ruff `per-file-ignores`. All suppressions eliminated through code changes only.

### TypeScript Refactors

- 13 files: `Record<string, T>` → `Map<string, T>` for all record lookups flagged by `detect-object-injection`
- 3 files: Array bracket `arr[i]` → `.at(i)` for computed-index access
- 1 file (`types.ts`): `any` → `unknown` for 9 Window globals
- 1 file (`schemas/utils.ts`): Monolithic regex → string-parsing validation function
- 1 file (`fs-test-utils.ts`): Eliminated; fs calls inlined at test sites with literal paths
- 1 file (`negative-fixture.smoke.ts`): `expect.fail()` → `throw new Error()`
- 1 file (`rollup.type-test.ts`): `@ts-expect-error` → `expect-type` library assertions
- 3 test files: `let` → `const state = { value }` object wrappers

### Python Refactors

- 2 files (`cli.py`, `ml/__init__.py`): `import openai` → `importlib.util.find_spec("openai")`
- 1 file (`database.py`): Evaluate UP006 noqa staleness; remove if unnecessary
- 1 file (`aggregators.py`): `random.Random(seed)` → `DeterministicRNG(seed)` subclass
- 1 file (`csv_generator.py`): `f"SELECT ... FROM ..."` → `" ".join(query_parts)`
- 1 file (`run_summary.py`): `subprocess.run(["git", ...])` → `Path(".git/HEAD").read_text()`

### Audit Script (`scripts/audit-suppressions.py`)

- `EXCLUDED_FILE_PATTERNS` set: Remove `*.type-test.ts` — no file exclusions
- `--diff` mode: Fail if loaded baseline total > 0
- Missing baseline: Already fails (no change needed)
- All suppression forms treated equally — no semantic exceptions
