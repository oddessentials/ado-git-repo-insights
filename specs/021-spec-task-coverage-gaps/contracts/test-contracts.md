# Test Contracts: Spec-Task Coverage Gap Resolution

**Feature**: 021-spec-task-coverage-gaps
**Date**: 2026-02-01

## Overview

This feature does not introduce new API contracts. Instead, it defines test infrastructure contracts that govern how tests are structured, executed, and validated.

---

## Contract 1: Type Test Configuration

**File**: `extension/tsconfig.type-tests.json`

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": [
    "tests/**/*.type-test.ts"
  ],
  "exclude": [
    "node_modules",
    "dist"
  ]
}
```

**Contract Rules**:
1. MUST extend base tsconfig.json
2. MUST set `noEmit: true` (compile-only, no output)
3. MUST include only `*.type-test.ts` files
4. MUST NOT include regular test files

---

## Contract 2: Playwright Configuration

**File**: `extension/playwright.config.ts`

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/smoke',
  testMatch: '**/*.smoke.ts',

  fullyParallel: false,  // Smoke tests run sequentially
  forbidOnly: !!process.env.CI,
  retries: 0,  // No retries - deterministic tests
  workers: 1,  // Single worker

  reporter: [
    ['html', { outputFolder: 'test-artifacts/smoke-report' }],
    ['list']
  ],

  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'on',  // Always capture
    trace: 'retain-on-failure',
    headless: true,
  },

  outputDir: 'test-artifacts/smoke',

  webServer: {
    command: 'npx serve ../docs -l 3000 --no-clipboard',
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
```

**Contract Rules**:
1. MUST use port 3000 for webServer
2. MUST serve `../docs` directory
3. MUST capture screenshots on all runs
4. MUST NOT retry (deterministic)
5. MUST NOT run in parallel
6. MUST output to `test-artifacts/smoke/`

---

## Contract 3: EC-### Traceability Format

**File Pattern**: `extension/tests/modules/metrics.edge-cases.test.ts`

**Required Comment Format**:
```typescript
// Covers EC-###: <description>
```

**Example**:
```typescript
describe('Edge Case: pr_count NaN handling', () => {
  test('returns 0 for NaN input', () => {
    // Covers EC-001: pr_count NaN returns 0
    const result = toFiniteNumber(NaN);
    expect(result).toBe(0);
  });
});
```

**Contract Rules**:
1. Each EC-001 through EC-005 MUST appear exactly once
2. Comment MUST be inside the test body (not describe block)
3. Format MUST be `// Covers EC-###: <description>`
4. Description MUST match spec acceptance scenario

**Valid IDs**:
| ID | Description |
|----|-------------|
| EC-001 | pr_count NaN handling |
| EC-002 | pr_count string coercion |
| EC-003 | pr_count Infinity handling |
| EC-004 | pr_count -Infinity handling |
| EC-005 | Mixed valid/invalid dataset |

---

## Contract 4: Smoke Test Fixture Schema

**File**: `docs/data/rollup.json`

**Minimum Required Schema**:
```typescript
interface SmokeFixtureContract {
  weekly_rollups: Array<{
    by_repository: Record<string, { pr_count: number }>;
    by_team: Record<string, { pr_count: number }>;
  }>;
}
```

**Contract Rules**:
1. MUST have `weekly_rollups` array with at least 1 element
2. First element MUST have `by_repository` object
3. First element MUST have `by_team` object
4. Each breakdown entry MUST have `pr_count` number field
5. At least one repository and one team MUST exist for filter testing

---

## Contract 5: data-testid Selectors

**File**: `docs/index.html` (and related demo HTML)

**Required Selectors**:
| Selector | Element | Purpose |
|----------|---------|---------|
| `data-testid="total-prs"` | Total PRs display | Validate numeric value |
| `data-testid="filter-repository"` | Repository dropdown | Apply filter |
| `data-testid="filter-team"` | Team dropdown | Apply filter |

**Contract Rules**:
1. Selectors MUST be stable across CSS/layout changes
2. Smoke tests MUST use `page.getByTestId()` only
3. No CSS class or text-based selectors allowed

---

## Contract 6: Package.json Scripts

**File**: `extension/package.json`

**Required Scripts**:
```json
{
  "scripts": {
    "test:types": "tsc --noEmit --project tsconfig.type-tests.json",
    "test:smoke": "playwright test"
  }
}
```

**Contract Rules**:
1. `test:types` MUST use dedicated tsconfig
2. `test:types` MUST use `--noEmit` flag
3. `test:smoke` MUST invoke Playwright CLI
4. Both scripts MUST exit 0 on success, non-zero on failure

---

## Contract Validation

All contracts are validated by:

| Contract | Validation Method |
|----------|-------------------|
| Type Test Config | `pnpm run test:types` execution |
| Playwright Config | `pnpm run test:smoke` execution |
| EC-### Traceability | `ec-traceability.test.ts` meta-test |
| Fixture Schema | Pre-flight check in smoke test |
| data-testid Selectors | Smoke test execution |
| Package.json Scripts | Gate commands in CI |

---

## Breaking Change Policy

Changes to these contracts require:
1. Update to this document
2. Update to all dependent test files
3. Review approval from maintainer
4. CI must pass after changes
