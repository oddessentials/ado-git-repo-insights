# Test Contracts: Deterministic Smoke Tests

**Feature Branch**: `022-deterministic-smoke-tests`
**Date**: 2026-02-02

This document defines the test contracts enforced by CI for this feature.

---

## 1. Wait Pattern Contracts

### WPC-001: No waitForTimeout

**Enforced By**: Grep-based check in CI (meta-test)
**Files**: `extension/tests/smoke/**/*.smoke.ts`

```
MUST NOT contain: page.waitForTimeout
MUST NOT contain: waitForTimeout(
```

**Verification Command**:
```bash
grep -r "waitForTimeout" extension/tests/smoke/ && exit 1 || exit 0
```

### WPC-002: No networkidle

**Enforced By**: Grep-based check in CI (meta-test)
**Files**: `extension/tests/smoke/**/*.smoke.ts`

```
MUST NOT contain: networkidle
MUST NOT contain: waitForLoadState("networkidle")
MUST NOT contain: waitForLoadState('networkidle')
```

**Verification Command**:
```bash
grep -r "networkidle" extension/tests/smoke/ && exit 1 || exit 0
```

---

## 2. Selector Contracts

### SC-001: data-testid Required Selectors

**Contract**: These `data-testid` values MUST exist in the dashboard HTML:

| Selector | Element Type | Purpose |
|----------|--------------|---------|
| `total-prs` | `<div>` | Total PRs metric display |
| `filter-repository` | `<select>` | Repository filter dropdown |
| `filter-team` | `<select>` | Team filter dropdown |
| `error-generic` | `<div>` | Generic error panel |
| `error-setup-required` | `<div>` | Setup required error panel |

**Enforced By**: `tests/meta/data-testid-validation.test.ts` (existing)

### SC-002: No CSS/ID Selectors for Assertions

**Enforced By**: Manual review (low-risk - CSS selectors are for load state, not assertions)

**Guideline**:
- Assertions MUST use `page.getByTestId()` or `expect(locator)`
- Load state detection MAY use CSS selectors (e.g., `#main-content:not(.hidden)`)

---

## 3. Timeout Contracts

### TC-001: Centralized Timeout Constant

**File**: `extension/tests/smoke/constants.ts`

```typescript
export const SMOKE_TIMEOUT_MS = 15_000;
```

**Contract**:
- All smoke tests MUST import `SMOKE_TIMEOUT_MS` from this file
- No timeout literals (e.g., `{ timeout: 5000 }`) allowed in smoke tests
- Exception: Playwright config `timeout` settings are separate

### TC-002: No Timeout Literals

**Enforced By**: Meta-test
**Files**: `extension/tests/smoke/**/*.smoke.ts`

**Pattern to detect**:
```regex
timeout:\s*\d+
```

**Allowed**:
```typescript
{ timeout: SMOKE_TIMEOUT_MS }  // Constant reference OK
```

**Forbidden**:
```typescript
{ timeout: 5000 }              // Literal forbidden
{ timeout: 15000 }             // Literal forbidden
```

---

## 4. Artifact Contracts

### AC-001: testInfo.outputPath() Required

**Contract**: All `page.screenshot()` calls MUST use `testInfo.outputPath()`.

**Pattern to detect** (forbidden):
```typescript
page.screenshot({
  path: "test-artifacts/..."  // Hardcoded path forbidden
});
```

**Required pattern**:
```typescript
page.screenshot({
  path: testInfo.outputPath("filename.png")
});
```

**Enforced By**: Meta-test scanning for hardcoded paths

### AC-002: CI Artifact Upload

**Contract**: CI MUST upload `extension/test-artifacts/smoke/` tree.

**Verification**: `.github/workflows/ci.yml` contains:
```yaml
- name: Upload Smoke Test Screenshots
  uses: actions/upload-artifact@v4
  with:
    name: smoke-test-screenshots
    path: extension/test-artifacts/smoke/
```

---

## 5. Dependency Contracts

### DC-001: Playwright Exact Pin

**File**: `extension/package.json`
**Field**: `devDependencies["@playwright/test"]`

**Contract**:
- Version MUST be exact (no `^`, no `~`, no range)
- Format: `"1.40.0"` (three-part semver, no prefix)

**Enforced By**: `tests/meta/playwright-version-guard.test.ts`

**Verification Logic**:
```typescript
const version = packageJson.devDependencies["@playwright/test"];
expect(version).toMatch(/^\d+\.\d+\.\d+$/);  // No ^ or ~ prefix
```

### DC-002: No npx in Gate Paths

**Contract**: `npx` commands are forbidden in test execution paths.

**Allowed**:
- `npx playwright install chromium` (CI setup step, not test execution)
- `npx ts-node` (development only, not CI gate)

**Forbidden**:
- `npx some-tool` in test files
- `npx` in `pnpm test:ci` script chain

---

## 6. Code Quality Contracts

### CQ-001: No Custom Deep Clone

**Files**: `extension/tests/**/*.ts`
**Contract**: No custom `deepClone` function implementations.

**Forbidden patterns**:
```typescript
function deepClone<T>(obj: T): T { ... }
const deepClone = (obj) => { ... }
```

**Required pattern**:
```typescript
structuredClone(obj)
```

**Enforced By**: Grep-based meta-test

### CQ-002: Type-Test Compile-Time Header

**Files**: `extension/tests/types/*.type-test.ts`

**Contract**: First non-whitespace content MUST be:
```typescript
/**
 * COMPILE-TIME ONLY: This file must never be imported by runtime code paths.
```

**Enforced By**: Meta-test scanning file headers

### CQ-003: No Runtime Type-Test Imports

**Contract**: Files under `extension/ui/` MUST NOT import from `extension/tests/types/`.

**Enforced By**: `tests/meta/no-runtime-type-imports.test.ts`

**Verification Logic**:
```typescript
// Scan all .ts files in extension/ui/
// Check for import patterns:
// - import ... from "../../tests/types/..."
// - import ... from "../tests/types/..."
// - require("...tests/types...")
```

---

## 7. CI Gate Contracts

### GC-001: Gate Chain Sequence

**Command**: `pnpm test:ci`

**Required Sequence**:
1. `build:check` - TypeScript compilation (no emit)
2. `test:types` - Type-test compile validation
3. Unit tests (Jest)
4. `test:smoke` - Playwright smoke tests

**Contract**: All gates MUST pass. Any failure blocks PR merge.

### GC-002: 3-Run Determinism

**Contract**: `pnpm test:ci` MUST produce identical results across 3 consecutive runs.

**Verification**: Manual (run 3 times locally before PR)

### GC-003: Artifact Existence

**Contract**: After `test:smoke` completes, the following artifact directories MUST exist:
- `extension/test-artifacts/smoke/chromium/`
- `extension/test-artifacts/smoke/chromium-negative/`

**Contract**: Each project directory MUST contain screenshots.

---

## Meta-Test Implementation Summary

| Contract | Meta-Test File | Test Name |
|----------|----------------|-----------|
| WPC-001 | `smoke-determinism-guard.test.ts` | `no waitForTimeout in smoke tests` |
| WPC-002 | `smoke-determinism-guard.test.ts` | `no networkidle in smoke tests` |
| TC-002 | `smoke-determinism-guard.test.ts` | `no timeout literals in smoke tests` |
| AC-001 | `smoke-determinism-guard.test.ts` | `all screenshots use testInfo.outputPath` |
| DC-001 | `playwright-version-guard.test.ts` | `Playwright version is exactly pinned` |
| CQ-001 | `smoke-determinism-guard.test.ts` | `no custom deepClone implementations` |
| CQ-002 | `type-test-header-guard.test.ts` | `type-test files have COMPILE-TIME ONLY header` |
| CQ-003 | `no-runtime-type-imports.test.ts` | `no imports from tests/types in ui/` |
