# Quickstart: Spec-Task Coverage Gap Resolution

**Feature**: 021-spec-task-coverage-gaps
**Date**: 2026-02-01

## Prerequisites

```bash
cd extension
pnpm install
```

After implementation, this will also install Playwright:
```bash
npx playwright install chromium
```

## Commands Reference

| Command | Purpose | Gate |
|---------|---------|------|
| `pnpm run build:check` | TypeScript compilation | Gate 1 |
| `pnpm run test:types` | Type safety tests | Gate 2 |
| `pnpm test:unit` | Unit + edge case + meta tests | Gate 3 |
| `pnpm run test:smoke` | Playwright smoke test | Gate 4 |
| `pnpm test:ci` | Full CI suite | Gate 5 |

## Running Type Tests

```bash
cd extension
pnpm run test:types
```

**Expected Output (Pass)**:
```
(no output, exit code 0)
```

**Expected Output (Regression)**:
```
tests/types/rollup.type-test.ts:15:3 - error TS2578: Unused '@ts-expect-error' directive.
```

### Verifying Type Test Harness Works

1. Temporarily modify `extension/ui/schemas/rollup.schema.ts`:
   ```typescript
   // Change from:
   by_repository: Record<string, BreakdownEntry>;
   // To:
   by_repository: Record<string, number>;
   ```

2. Run type tests:
   ```bash
   pnpm run test:types
   ```

3. Expect exit code non-zero with TS2578

4. Revert the change

## Running Edge Case Tests

```bash
cd extension
pnpm test:unit -- --testPathPattern=metrics.edge-cases.test.ts
```

**Expected Output**:
```
 PASS  tests/modules/metrics.edge-cases.test.ts
  Edge Case: pr_count NaN handling
    ✓ EC-001: returns 0 for NaN pr_count
  Edge Case: pr_count string coercion
    ✓ EC-002: coerces "50" to 50
  Edge Case: pr_count Infinity handling
    ✓ EC-003: returns 0 for Infinity
    ✓ EC-004: returns 0 for -Infinity
  Edge Case: mixed valid/invalid dataset
    ✓ EC-005: sums only valid values (30)

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
```

## Running Smoke Test

```bash
cd extension
pnpm run test:smoke
```

**What happens**:
1. Validates fixture at `docs/data/rollup.json`
2. Starts static server on port 3000
3. Opens Chromium headless
4. Navigates to demo dashboard
5. Selects repository filter
6. Captures screenshot
7. Validates Total PRs is finite number
8. Repeats for team filter
9. Stops server

**Expected Output (Pass)**:
```
Running 2 tests using 1 worker

  ✓ filter-display.smoke.ts:12:5 › repository filter shows numeric Total PRs (2s)
  ✓ filter-display.smoke.ts:24:5 › team filter shows numeric Total PRs (1s)

  2 passed (4s)
```

**Artifacts Location**:
```
extension/test-artifacts/smoke/
├── repository-filter-1234567890.png
└── team-filter-1234567890.png
```

## Running Full CI Suite

```bash
cd extension
pnpm test:ci
```

This runs:
1. Build check (Gate 1)
2. Type tests (Gate 2)
3. Unit tests including edge cases (Gate 3)
4. Traceability meta-test
5. Smoke tests (Gate 4)

## Validating EC-### Traceability

```bash
cd extension
pnpm test:unit -- --testPathPattern=ec-traceability.test.ts
```

**Expected Output**:
```
 PASS  tests/meta/ec-traceability.test.ts
  EC-### Traceability
    ✓ EC-001 is covered exactly once
    ✓ EC-002 is covered exactly once
    ✓ EC-003 is covered exactly once
    ✓ EC-004 is covered exactly once
    ✓ EC-005 is covered exactly once

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
```

**Expected Output (Missing EC-003)**:
```
 FAIL  tests/meta/ec-traceability.test.ts
  EC-### Traceability
    ✓ EC-001 is covered exactly once
    ✓ EC-002 is covered exactly once
    ✕ EC-003 is covered exactly once
    ✓ EC-004 is covered exactly once
    ✓ EC-005 is covered exactly once

  ● EC-### Traceability › EC-003 is covered exactly once

    expect(received).not.toBeNull()

    Received: null
```

## Troubleshooting

### Type Test: "Cannot find module"
```bash
# Ensure tsconfig.type-tests.json exists and includes correct paths
cat extension/tsconfig.type-tests.json
```

### Smoke Test: "Port 3000 in use"
```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9
# Or let Playwright fail if truly in use
```

### Smoke Test: "Fixture missing"
```bash
# Verify fixture exists
cat docs/data/rollup.json | head -20
```

### Smoke Test: "Element not found"
```bash
# Check data-testid attributes exist
grep -r "data-testid" docs/index.html
```

### Edge Case Test: "Test not found"
```bash
# Verify file exists
ls -la extension/tests/modules/metrics.edge-cases.test.ts
```

## Success Criteria Checklist

| Criterion | Validation Command | Pass Condition |
|-----------|-------------------|----------------|
| SC-001 | `wc -l specs/001-*/tasks.md` | 30+ tasks |
| SC-002 | Review tasks.md | All FR-001..FR-038 covered |
| SC-003 | `pnpm run test:types` | Exit 0, 2+ positive, 2+ negative |
| SC-004 | `pnpm run test:smoke` | Screenshot in test-artifacts/ |
| SC-005 | `pnpm test:unit -- metrics.edge-cases` | 5 tests pass |
| SC-006 | Review plan.md | All 5 gates documented |
| SC-007 | Run `/speckit.analyze` | 0 critical/medium issues |
| SC-008 | Review tasks.md | No "manual verification" without automation |

## Next Steps After Implementation

1. Run `/speckit.tasks` to generate detailed task list
2. Create PR with all new files
3. Verify CI workflow uploads smoke artifacts
4. Merge to complete feature
