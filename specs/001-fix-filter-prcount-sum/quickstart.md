# Quickstart: Fix Dashboard Filter PR Count Summation Bug

**Branch**: `001-fix-filter-prcount-sum`
**Date**: 2026-01-31

## Prerequisites

- Node.js 22+
- pnpm 9.15.0
- Git

## Setup

```bash
# Navigate to extension directory
cd extension

# Install dependencies (if not already done)
pnpm install
```

## Verification Steps

### Step 1: Reproduce the Bug (Optional)

Run the existing tests to observe the current behavior:

```bash
pnpm test:unit -- --testPathPattern=metrics.test
```

Note: Tests may pass currently because fixtures use incorrect primitive numbers. The bug manifests at runtime with real data.

### Step 2: Apply the Fix

Edit `extension/ui/modules/metrics.ts`:

1. Add `toFiniteNumber()` helper (before `applyFiltersToRollups`)
2. Update type guards in lines ~150 and ~188
3. Update reduce operations to use `toFiniteNumber(entry.pr_count)`

### Step 3: Update Test Fixtures

Edit `extension/tests/modules/metrics.test.ts`:

1. Update `by_repository` fixture values from numbers to `{ pr_count: number }` objects
2. Update `by_team` fixture values similarly
3. Add regression test in separate `describe` block

### Step 4: Verify TypeScript Compilation

```bash
pnpm run build:check
```

Expected: No compilation errors. Type guards should enforce `BreakdownEntry`.

### Step 5: Run Unit Tests

```bash
pnpm test:unit -- --testPathPattern=metrics.test
```

Expected: All tests pass, including new regression test.

### Step 6: Rebuild Demo Bundle

```bash
pnpm run build:ui
```

This rebuilds `docs/dashboard.js`.

### Step 7: Verify Bundle Changed

```bash
git diff docs/dashboard.js | head -20
```

Expected: Diff shows changes in the bundle (SC-006 verification).

### Step 8: Run Full Test Suite

```bash
pnpm test:ci
```

Expected: All tests pass.

### Step 9: Verify Lint/Format

```bash
pnpm run lint
pnpm run format:check
```

Expected: No lint errors, format is correct.

## Success Criteria Verification

| Criterion | Command | Expected |
|-----------|---------|----------|
| SC-001/002 | Manual test with demo | Numeric Total PRs on filter |
| SC-003 | `pnpm test:unit` | All tests pass |
| SC-004 | See regression test | Asserts finite number, no `[object` |
| SC-005 | `pnpm run build:check` | Compile fails if `number` used for breakdown |
| SC-006 | `git diff docs/dashboard.js` | Shows changes |
| SC-007 | Manual or automated smoke test | Total PRs parses to finite number |
| SC-008 | Regression test edge cases | 100% finite numbers |

## Commit

When all steps pass:

```bash
git add extension/ui/modules/metrics.ts
git add extension/tests/modules/metrics.test.ts
git add docs/dashboard.js
git commit -m "fix(dashboard): extract pr_count from BreakdownEntry in filter aggregation

Fixes object concatenation bug where Total PRs displayed
'0[object Object]...' when repository/team filters were applied.

- Add toFiniteNumber() helper for safe numeric coercion
- Update type guards to expect BreakdownEntry, not number
- Fix test fixtures to use proper { pr_count: number } shape
- Add regression test for historical failure mode
- Rebuild demo bundle

Closes #XXX"
```
