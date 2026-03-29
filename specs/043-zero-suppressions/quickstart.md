# Quickstart: Zero Suppressions

**Branch**: `043-zero-suppressions` | **Date**: 2026-03-28

## Hard Constraints

- **No ESLint per-file rule disables** — code refactors only
- **No ruff `per-file-ignores`** — code refactors only
- **No temporary relaxations** — every commit must be clean
- **Baseline update is the LAST step** — only after all code changes

## Prerequisites

- Python 3.10+ with `pip install -e .[dev]`
- Node.js with pnpm
- Git hooks installed (`pnpm run prepare`)

## Verify Current State

```bash
# Count current suppressions (expect 50)
python scripts/audit-suppressions.py

# Diff against baseline (expect 0 delta)
python scripts/audit-suppressions.py --diff
```

## Implementation Sequence

### Step 1: TypeScript Map conversions (removes 20 object-injection suppressions)

Convert `Record<string, T>` lookups to `Map<string, T>` in 11 files. Replace `obj[key]` with `map.get(key)`, `obj[key] = val` with `map.set(key, val)`, `delete obj[key]` with `map.delete(key)`.

```bash
cd extension && pnpm run lint && pnpm run build:check
```

### Step 2: TypeScript .at() conversions (removes 4 object-injection suppressions)

Replace array bracket access `arr[computedIndex]` with `arr.at(computedIndex)` in format.ts, security.ts, typeahead-dropdown.ts.

```bash
cd extension && pnpm run lint && pnpm run build:check
```

### Step 3: TypeScript Map accumulation (removes 2 object-injection suppressions)

Convert Object.entries iteration with bracket re-access to Map-based accumulation in cycle-time.ts and predictions.ts.

```bash
cd extension && pnpm run lint
```

### Step 4: types.ts any → unknown (removes 9 suppressions)

Replace all 9 `any` types with `unknown` in Window global declarations (lines 611-629).

```bash
cd extension && pnpm run build:check && pnpm exec jest --runInBand
```

### Step 5: schemas/utils.ts regex → string parser (removes 1 suppression)

Replace the ISO datetime regex with a string-parsing validation function using only fixed-length sub-patterns.

```bash
cd extension && pnpm run lint && pnpm exec jest --runInBand
```

### Step 6: Test file refactors (removes up to 10 suppressions)

- `prefer-const`: Refactor `let` → `const state = { value }` in dashboard.test.ts and production-issues.test.ts
- `expect.fail`: Replace with `throw new Error()` in negative-fixture.smoke.ts
- `fs-test-utils.ts`: Inline fs calls at test sites with literal paths, delete the utility
- `@ts-expect-error`: Install `expect-type`, rewrite type-test assertions in rollup.type-test.ts

```bash
cd extension && pnpm run lint && pnpm exec jest --runInBand
```

### Step 7: Python code refactors (removes 9 suppressions)

- Replace `import openai` with `importlib.util.find_spec("openai")` in cli.py
- Replace `from prophet import Prophet` with `importlib.util.find_spec("prophet")` in ml/__init__.py
- Evaluate and remove UP006 noqa comments in database.py
- Create `DeterministicRNG(random.Random)` subclass in aggregators.py
- Replace f-string SQL with `" ".join(query_parts)` in csv_generator.py
- Replace `subprocess.run(["git", ...])` with `.git/HEAD` reading in run_summary.py

```bash
cd src && ruff check . && pytest
```

### Step 8: Audit script changes

- Remove `*.type-test.ts` from `EXCLUDED_FILE_PATTERNS`
- Add check: fail if baseline total > 0 or baseline missing

```bash
python scripts/audit-suppressions.py  # Must report 0
```

### Step 9: Enforcement hardening

- Reorder gates: suppression audit first in pre-commit, pre-push, and preflight
- Add `test:ci` script with suppression audit + all CI gates
- Update `.pre-commit-config.yaml` hook ordering

### Step 10: Baseline update (LAST)

```bash
# Regenerate baseline at zero
python scripts/audit-suppressions.py --update-baseline

# Verify zero
python scripts/audit-suppressions.py --diff

# Update ratchet allowlist
# Update LOCAL_CI_PARITY_INVARIANTS.md

# Run full preflight to confirm everything passes
python scripts/run_pr_preflight.py
```

## Verification

```bash
# Must report 0 total
python scripts/audit-suppressions.py

# All tests green
cd src && pytest
cd extension && pnpm exec jest --runInBand

# Lint clean
cd src && ruff check .
cd extension && pnpm run lint

# Type check clean
cd extension && pnpm run build:check

# Full preflight green
python scripts/run_pr_preflight.py
```
