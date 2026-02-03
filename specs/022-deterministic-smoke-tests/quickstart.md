# Quickstart: Deterministic Smoke Tests

**Feature Branch**: `022-deterministic-smoke-tests`
**Date**: 2026-02-02

## Prerequisites

- Node.js 22 (for `structuredClone` global)
- pnpm 9.15.0
- Playwright browsers installed (`npx playwright install chromium`)

## Quick Verification

Run the full gate chain to verify all changes:

```bash
cd extension
pnpm install --frozen-lockfile
pnpm test:ci
```

**Expected Output**: All gates pass without flaky failures.

## Key Files Changed

| File | Change Type | Purpose |
|------|-------------|---------|
| `tests/smoke/constants.ts` | NEW | Centralized `SMOKE_TIMEOUT_MS` constant |
| `tests/smoke/filter-display.smoke.ts` | MODIFIED | Replace waits, use testInfo.outputPath |
| `tests/smoke/negative-fixture.smoke.ts` | MODIFIED | Replace waits, condition-based error detection |
| `tests/modules/metrics.edge-cases.test.ts` | MODIFIED | Replace deepClone with structuredClone |
| `tests/types/rollup.type-test.ts` | MODIFIED | Add COMPILE-TIME ONLY header |
| `tests/meta/smoke-determinism-guard.test.ts` | NEW | CI enforcement for determinism contracts |
| `tests/meta/playwright-version-guard.test.ts` | NEW | CI enforcement for version pinning |
| `tests/meta/no-runtime-type-imports.test.ts` | NEW | CI enforcement for type-test isolation |
| `TOOLING.md` | MODIFIED | Add Playwright Version Policy section |

## Common Patterns

### Wait Pattern (Before → After)

```typescript
// BEFORE (flaky)
await page.waitForLoadState("networkidle");
await page.waitForTimeout(1000);

// AFTER (deterministic)
import { SMOKE_TIMEOUT_MS } from "./constants";

const priorText = await totalPrsElement.textContent();
await repoFilter.selectOption(value);
await expect(totalPrsElement).not.toHaveText(priorText, { timeout: SMOKE_TIMEOUT_MS });
await expect(totalPrsElement).toHaveText(/^\d+$/, { timeout: SMOKE_TIMEOUT_MS });
```

### Screenshot Pattern (Before → After)

```typescript
// BEFORE (collision-prone)
await page.screenshot({
  path: "test-artifacts/smoke/repository-filter.png",
});

// AFTER (collision-proof)
await page.screenshot({
  path: testInfo.outputPath("repository-filter.png"),
});
```

### Deep Clone Pattern (Before → After)

```typescript
// BEFORE (custom implementation)
function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  // ...custom logic...
}
const copy = deepClone(data);

// AFTER (native)
const copy = structuredClone(data);
```

## Verification Commands

### Check for Forbidden Patterns

```bash
# Should return zero matches
grep -r "waitForTimeout" extension/tests/smoke/
grep -r "networkidle" extension/tests/smoke/
grep -r "deepClone" extension/tests/modules/
```

### Run Determinism Test (3 consecutive runs)

```bash
cd extension
pnpm test:ci && pnpm test:ci && pnpm test:ci
```

All three runs should pass with identical results.

### Check Playwright Version

```bash
grep "@playwright/test" extension/package.json
# Should show exact version like "1.40.0" (no ^ or ~)
```

## Troubleshooting

### Smoke Test Flaky on CI

1. Check for any remaining `waitForTimeout` or `networkidle` patterns
2. Verify all waits use `SMOKE_TIMEOUT_MS`
3. Ensure `testInfo.outputPath()` is used for all screenshots

### structuredClone Not Available

Ensure Node.js 22 is installed:
```bash
node --version  # Should be v22.x.x
```

### Meta-Tests Failing

Run individual meta-tests to identify the issue:
```bash
cd extension
pnpm test:unit -- --testPathPattern=meta
```

## Success Criteria Checklist

- [ ] `grep -r "waitForTimeout" extension/tests/smoke/` returns zero matches
- [ ] `grep -r "networkidle" extension/tests/smoke/` returns zero matches
- [ ] All smoke screenshots use `testInfo.outputPath()`
- [ ] All smoke tests import and use `SMOKE_TIMEOUT_MS`
- [ ] No custom `deepClone` in `extension/tests/`
- [ ] Type-test files have "COMPILE-TIME ONLY" header
- [ ] `pnpm test:ci` passes 3 consecutive runs
- [ ] Playwright version is exactly pinned (no `^` or `~`)
