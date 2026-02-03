# Research: Deterministic Smoke Tests

**Feature Branch**: `022-deterministic-smoke-tests`
**Date**: 2026-02-02

## Research Summary

This document captures research findings for making the Playwright smoke test suite deterministic.

---

## 1. Wait Strategy Research

### Problem: `waitForTimeout()` is Non-Deterministic

**Current State**:
- `negative-fixture.smoke.ts:31` uses `await page.waitForTimeout(1000)`
- `negative-fixture.smoke.ts:77` uses `await page.waitForTimeout(1000)`

**Decision**: Replace with explicit DOM-state waits using `waitForSelector` or `expect().toBeVisible()`.

**Rationale**:
- Fixed delays are inherently flaky - CI runners have variable performance
- The 1000ms wait was added to "wait for JS to execute"
- The actual requirement is waiting for error state to render

**Alternative Considered**: Increase timeout to 2000ms
- **Rejected**: Still non-deterministic, just masks timing issues

**Implementation Pattern**:
```typescript
// BEFORE (flaky)
await page.waitForLoadState("networkidle");
await page.waitForTimeout(1000);

// AFTER (deterministic)
await expect(errorSetup.or(errorGeneric)).toBeVisible({ timeout: SMOKE_TIMEOUT_MS });
```

---

## 2. Network Idle Research

### Problem: `networkidle` is Unreliable

**Current State**:
- `filter-display.smoke.ts:148` - after repository filter selection
- `filter-display.smoke.ts:240` - after team filter selection
- `negative-fixture.smoke.ts:28` - page load
- `negative-fixture.smoke.ts:76` - error state load

**Decision**: Replace with explicit DOM state assertions.

**Rationale**:
- `networkidle` waits for 500ms of no network activity
- On fast CI or with cached responses, this may complete before JS renders
- On slow networks, this may timeout unnecessarily
- The actual requirement is "dashboard has rendered"

**Alternative Considered**: Use `load` state instead
- **Rejected**: `load` fires when HTML is parsed, not when JS renders content

**Implementation Pattern**:
```typescript
// BEFORE (unreliable)
await repoFilter.selectOption(secondOption);
await page.waitForLoadState("networkidle");
await expect(totalPrsElement).not.toHaveText("-");

// AFTER (deterministic)
const priorText = await totalPrsElement.textContent();
await repoFilter.selectOption(secondOption);
await expect(totalPrsElement).not.toHaveText(priorText, { timeout: SMOKE_TIMEOUT_MS });
await expect(totalPrsElement).toHaveText(/^\d+$/, { timeout: SMOKE_TIMEOUT_MS });
```

---

## 3. Selector Strategy Research

### Problem: Mixed CSS/ID and data-testid selectors

**Current State**:
- Good: `page.getByTestId("total-prs")`, `page.getByTestId("filter-repository")`
- Bad: `#main-content:not(.hidden)` (line 115, 185)
- Bad: `#team-filter-group` (line 205)
- Bad: `#loading-state` (negative-fixture.smoke.ts:58)
- Bad: `#error-message`, `#setup-message` (negative-fixture.smoke.ts:94, 103)

**Decision**: Keep `data-testid` for all **test-critical** assertions. CSS selectors for internal state checks are acceptable but should be minimized.

**Rationale**:
- `data-testid` is the contract between tests and UI
- CSS class checks like `#main-content:not(.hidden)` are implementation details
- However, checking `.hidden` removal is a valid load-state signal

**Alternative Considered**: Add `data-testid` to every element referenced
- **Rejected**: Over-engineering; `.hidden` class check is semantically clear

**Implementation Pattern**:
```typescript
// Keep for load detection (not assertion target)
await page.waitForSelector("#main-content:not(.hidden)", { timeout: SMOKE_TIMEOUT_MS });

// For assertions, use data-testid exclusively
await expect(page.getByTestId("total-prs")).toBeVisible();
```

---

## 4. Timeout Centralization Research

### Problem: Hardcoded timeout literals throughout tests

**Current State**:
- `filter-display.smoke.ts:116` - `{ timeout: 15000 }`
- `filter-display.smoke.ts:186` - `{ timeout: 15000 }`

**Decision**: Create `extension/tests/smoke/constants.ts` with `SMOKE_TIMEOUT_MS`.

**Rationale**:
- Single source of truth for smoke test timeouts
- Easy to adjust for different CI environments
- Spec requires FR-007, FR-008: "All smoke test waits MUST use `SMOKE_TIMEOUT_MS`"

**Alternative Considered**: Use Playwright config `timeout` setting
- **Rejected**: Config timeout is per-test, not per-assertion; we need granular control

**Implementation**:
```typescript
// extension/tests/smoke/constants.ts
export const SMOKE_TIMEOUT_MS = 15_000;
```

---

## 5. Artifact Path Research

### Problem: Hardcoded screenshot paths in filter-display.smoke.ts

**Current State**:
- `filter-display.smoke.ts:154-156`: `path: "test-artifacts/smoke/repository-filter.png"`
- `filter-display.smoke.ts:216-218`: `path: "test-artifacts/smoke/team-filter-disabled.png"`
- `filter-display.smoke.ts:246-248`: `path: "test-artifacts/smoke/team-filter.png"`
- `filter-display.smoke.ts:263-265`: `path: "test-artifacts/smoke/team-filter-default.png"`

**Good patterns already in use**:
- `negative-fixture.smoke.ts:43`: `testInfo.outputPath("negative-malformed-manifest.png")`
- `negative-fixture.smoke.ts:85`: `testInfo.outputPath("negative-error-message.png")`

**Decision**: Migrate all screenshots to `testInfo.outputPath()`.

**Rationale**:
- `testInfo.outputPath()` generates unique paths per test run
- Prevents artifact collision in parallel execution
- Playwright config already sets per-project `outputDir`

**Alternative Considered**: Use timestamp in filename
- **Rejected**: `testInfo.outputPath()` already handles uniqueness

**Implementation Pattern**:
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

---

## 6. Deep Clone Research

### Problem: Custom `deepClone` function in edge-cases test

**Current State** (`metrics.edge-cases.test.ts:232-244`):
```typescript
function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(deepClone) as T;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    result[key] = deepClone((obj as Record<string, unknown>)[key]);
  }
  return result as T;
}
```

**Decision**: Replace with `structuredClone()`.

**Rationale**:
- Node.js 22 has native `structuredClone()` in global scope
- `structuredClone()` correctly handles `NaN`, `Infinity`, `-Infinity`
- The custom function exists only because JSON.stringify/parse doesn't handle special numeric values
- `structuredClone()` handles the same edge cases

**Alternative Considered**: Keep custom function for explicit control
- **Rejected**: `structuredClone()` is standard, well-tested, and handles more edge cases

**Verification**:
```typescript
// Test that structuredClone handles spec requirements
const original = { a: NaN, b: Infinity, c: -Infinity };
const cloned = structuredClone(original);
console.log(Number.isNaN(cloned.a)); // true
console.log(cloned.b === Infinity);   // true
console.log(cloned.c === -Infinity);  // true
```

---

## 7. Type-Test Header Research

### Problem: Type-test files lack compile-time-only header

**Current State** (`rollup.type-test.ts`):
- Has extensive documentation but no explicit "COMPILE-TIME ONLY" header
- Spec requires FR-020: "Type-test files MUST include a compile-time-only header comment"

**Decision**: Add standardized header at file top.

**Rationale**:
- Clear contract that these files should never be imported
- CI meta-test will enforce no imports from `extension/ui/`

**Implementation**:
```typescript
/**
 * COMPILE-TIME ONLY: This file must never be imported by runtime code paths.
 * ...existing documentation...
 */
```

---

## 8. Playwright Version Policy Research

### Problem: No documented upgrade policy for Playwright

**Current State**:
- `package.json` has `"@playwright/test": "1.40.0"` (exact pin - good)
- No documentation about when/how to upgrade
- CI uses `npx playwright install chromium --with-deps` (bad per FR-013)

**Decision**:
1. Document quarterly upgrade cadence in `TOOLING.md`
2. Add CI meta-test to fail on caret/tilde versions
3. Note: The `npx playwright install` in CI is for **browser binaries**, not the package - this is acceptable

**Rationale**:
- Exact pinning prevents surprise breakages but can cause tech debt if never updated
- Quarterly review ensures security patches while maintaining stability
- Browser installation via `npx playwright install` is standard Playwright workflow

**Clarification on npx Usage**:
- FR-013 forbids `npx` for **runtime tools** (prevents downloading packages at test time)
- `npx playwright install chromium` is a **setup step** that downloads browser binaries
- This is equivalent to other CI setup steps and is acceptable
- The key constraint is: no `npx <some-tool>` inside test execution paths

**Implementation**:
```markdown
## Playwright Version Policy

### Upgrade Cadence
- Quarterly review (Q1, Q2, Q3, Q4)
- Check Playwright releases for security patches monthly

### PR Checklist for Upgrades
- [ ] Update `@playwright/test` version in package.json
- [ ] Run `npx playwright install chromium` locally
- [ ] Verify all smoke tests pass
- [ ] Document breaking changes in PR description
```

---

## 9. CI Enforcement Research

### Problem: No CI enforcement for type-test import violations

**Spec Requirements**:
- FR-021: CI MUST fail if any file under `extension/ui/` imports from `extension/tests/types/`
- FR-017: CI MUST fail if `@playwright/test` uses caret/tilde/range syntax

**Decision**: Add Jest meta-tests for CI enforcement.

**Rationale**:
- Meta-tests run as part of `pnpm test:ci`
- Failed meta-test = failed CI = PR blocked
- No separate CI step needed

**Implementation**:
1. `no-runtime-type-imports.test.ts` - Scans `extension/ui/` for forbidden imports
2. `playwright-version-guard.test.ts` - Validates package.json version format

---

## Summary of Decisions

| Area | Decision | FR Addressed |
|------|----------|--------------|
| Wait Strategy | Condition-based waits on data-testid | FR-001 |
| Network Idle | Replace with DOM state assertions | FR-002 |
| Selectors | data-testid for assertions, CSS for load state | FR-003 |
| Timeouts | Centralize in `constants.ts` | FR-007, FR-008, FR-009 |
| Artifacts | Use `testInfo.outputPath()` exclusively | FR-010, FR-011 |
| Deep Clone | Replace with `structuredClone()` | FR-018, FR-019 |
| Type Tests | Add COMPILE-TIME ONLY header | FR-020 |
| Playwright Policy | Document in TOOLING.md, add CI guard | FR-015, FR-016, FR-017 |
| CI Enforcement | Add meta-tests for import/version guards | FR-017, FR-021 |
