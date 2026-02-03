# Research: Spec-Task Coverage Gap Resolution

**Feature**: 021-spec-task-coverage-gaps
**Date**: 2026-02-01

## R1: Type Test Harness Mechanism

### Question
How to implement compile-time type tests that detect regressions when types change?

### Decision
Use `tsc --noEmit --project tsconfig.type-tests.json` with `// @ts-expect-error` annotations.

### Rationale
1. **No additional dependencies**: Uses existing TypeScript compiler
2. **Built-in regression detection**: `@ts-expect-error` produces error TS2578 if the expected error doesn't occur
3. **Clear exit codes**: Exit 0 = all expected errors occurred AND positive tests passed
4. **Isolation**: Separate tsconfig prevents interference with main build

### Implementation
```typescript
// tests/types/rollup.type-test.ts

import type { Rollup, BreakdownEntry } from '../../ui/schemas/rollup.schema';

// Positive test: accessing pr_count should compile
function positiveTest(rollup: Rollup) {
  const entry: BreakdownEntry | undefined = rollup.by_repository?.['repo-a'];
  if (entry) {
    const prCount: number = entry.pr_count; // Should compile
  }
}

// Negative test: treating BreakdownEntry as number should fail
function negativeTest(rollup: Rollup) {
  const entry = rollup.by_repository?.['repo-a'];
  // @ts-expect-error - BreakdownEntry is not assignable to number
  const num: number = entry;
}
```

### Alternatives Rejected
| Alternative | Reason for Rejection |
|-------------|---------------------|
| `tsd` package | Additional dependency, different API |
| `dtslint` | Designed for DefinitelyTyped, overkill |
| Runtime type checks | Don't catch compile-time regressions |

---

## R2: Playwright Smoke Test Configuration

### Question
How to run deterministic browser tests for the demo UI without manual server setup?

### Decision
Use Playwright with `webServer` configuration on fixed port 3000.

### Rationale
1. **Built-in server management**: Playwright starts/stops server automatically
2. **Deterministic execution**: Headless Chrome, no timing dependencies
3. **Artifact capture**: Screenshot on pass AND fail
4. **Stable selectors**: `data-testid` attributes avoid CSS churn

### Implementation
```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/smoke',
  testMatch: '**/*.smoke.ts',
  webServer: {
    command: 'npx serve ../docs -l 3000 --no-clipboard',
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
  },
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'on',
    trace: 'retain-on-failure',
  },
  outputDir: './test-artifacts/smoke',
});
```

### Alternatives Rejected
| Alternative | Reason for Rejection |
|-------------|---------------------|
| Puppeteer | Less mature webServer support |
| Cypress | Heavier, designed for E2E apps |
| Manual server | Non-deterministic, requires documentation |
| `file://` protocol | CORS issues, browser security blocks |

---

## R3: Edge Case Traceability Enforcement

### Question
How to ensure every documented edge case (EC-001 through EC-005) has a corresponding test?

### Decision
Create a meta-test that scans test files for `// Covers EC-###:` comments.

### Rationale
1. **Simple implementation**: Regex scan, no tooling dependencies
2. **Runs in CI**: Part of `pnpm test:ci`
3. **Catches gaps and duplicates**: Both missing and duplicate IDs are errors
4. **Self-documenting**: Comments explain what each test covers

### Implementation
```typescript
// tests/meta/ec-traceability.test.ts
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('EC-### Traceability', () => {
  const testFile = resolve(__dirname, '../modules/metrics.edge-cases.test.ts');
  const content = readFileSync(testFile, 'utf-8');

  const requiredIds = ['EC-001', 'EC-002', 'EC-003', 'EC-004', 'EC-005'];

  test.each(requiredIds)('%s is covered exactly once', (id) => {
    const matches = content.match(new RegExp(`// Covers ${id}:`, 'g'));
    expect(matches).not.toBeNull();
    expect(matches?.length).toBe(1);
  });
});
```

### Alternatives Rejected
| Alternative | Reason for Rejection |
|-------------|---------------------|
| ESLint rule | Overkill, custom plugin needed |
| Manual review | Not enforceable in CI |
| Test naming convention only | Doesn't prevent omissions |

---

## R4: Fixture Schema Validation

### Question
How to fail fast when smoke test fixture is missing or malformed?

### Decision
Pre-flight validation in smoke test setup, before browser launch.

### Rationale
1. **Clear error messages**: "Fixture missing" vs "element not found"
2. **Fail fast**: Don't start browser if fixture is wrong
3. **Schema enforcement**: Validate minimum required fields

### Implementation
```typescript
// tests/smoke/filter-display.smoke.ts
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const FIXTURE_PATH = resolve(__dirname, '../../../docs/data/rollup.json');

test.beforeAll(() => {
  // Pre-flight fixture validation
  if (!existsSync(FIXTURE_PATH)) {
    throw new Error(`Smoke test fixture missing: ${FIXTURE_PATH}`);
  }

  const data = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));

  if (!Array.isArray(data.weekly_rollups) || data.weekly_rollups.length === 0) {
    throw new Error('Fixture must have non-empty weekly_rollups array');
  }

  const rollup = data.weekly_rollups[0];
  if (!rollup.by_repository || !rollup.by_team) {
    throw new Error('Fixture weekly_rollups[0] must have by_repository and by_team');
  }
});
```

---

## R5: data-testid Selectors

### Question
How to ensure smoke test selectors are stable across UI changes?

### Decision
Add `data-testid` attributes to key DOM elements.

### Rationale
1. **Immune to CSS changes**: `data-testid` is purely for testing
2. **Playwright native support**: `page.getByTestId()`
3. **Self-documenting**: Clear which elements are test targets
4. **No production impact**: Browsers ignore unknown attributes

### Implementation
```html
<!-- docs/index.html -->
<div class="metric-card" data-testid="total-prs">
  <span class="value"><!-- PR count here --></span>
</div>

<select data-testid="filter-repository">
  <!-- Repository options -->
</select>

<select data-testid="filter-team">
  <!-- Team options -->
</select>
```

```typescript
// Smoke test selector usage
await page.getByTestId('filter-repository').selectOption('repo-a');
const totalPrs = await page.getByTestId('total-prs').textContent();
expect(Number(totalPrs?.replace(/,/g, ''))).toBeFinite();
```

---

## Summary

| Research Item | Decision | Confidence |
|---------------|----------|------------|
| R1: Type test harness | `tsc` + `@ts-expect-error` | High |
| R2: Smoke test | Playwright + webServer | High |
| R3: EC traceability | Meta-test with comment scan | High |
| R4: Fixture validation | Pre-flight schema check | High |
| R5: Stable selectors | `data-testid` attributes | High |

All research items resolved. No NEEDS CLARIFICATION remaining.
