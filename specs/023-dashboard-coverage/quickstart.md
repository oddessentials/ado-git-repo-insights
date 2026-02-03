# Quickstart: Dashboard Critical Test Coverage

**Feature**: 023-dashboard-coverage
**Date**: 2026-02-03

## Overview

This guide explains how to run and extend the dashboard coverage tests.

## Prerequisites

- Node.js 22+
- pnpm 9.15.0+

## Setup

```bash
# Navigate to extension directory
cd extension

# Install dependencies
pnpm install
```

## Running Tests

### All Tests

```bash
pnpm test
```

### With Coverage Report

```bash
pnpm test -- --coverage
```

### Specific Test File

```bash
pnpm test -- tests/dashboard/critical-path.test.ts
```

### Watch Mode (Development)

```bash
pnpm test -- --watch
```

## Test Structure

```
extension/tests/
├── fixtures/                    # JSON test data
│   ├── predictions-ready.json
│   ├── predictions-no-data.json
│   ├── predictions-invalid.json
│   ├── predictions-unsupported-v.json
│   ├── insights-ready.json
│   ├── insights-no-data.json
│   ├── insights-invalid.json
│   └── insights-unsupported-v.json
├── harness/                     # Shared test infrastructure
│   ├── dom-harness.ts          # DOM setup/teardown
│   └── vss-sdk-mock.ts         # Azure DevOps SDK mocks
├── dashboard/                   # Dashboard-specific tests
│   ├── critical-path.test.ts   # Critical Path Set function tests
│   ├── ml-state-rendering.test.ts  # 5-state matrix tests
│   └── settings-contract.test.ts   # Settings boundary tests
├── artifact-client/             # API client tests
│   └── http-responses.test.ts  # HTTP response handling
└── security/                    # Security tests
    └── xss-prevention.test.ts  # XSS prevention validation
```

## Writing Tests

### Using the DOM Harness

```typescript
import { setupDomHarness, teardownDomHarness, getElement } from '../harness/dom-harness';

describe('MyComponent', () => {
  beforeEach(() => {
    setupDomHarness({ fixtures: 'all', withVssSdk: true });
  });

  afterEach(() => {
    teardownDomHarness();
  });

  it('renders correctly', () => {
    const container = getElement('charts-container');
    // ... assertions
  });
});
```

### Triple Assertion Pattern

All tests MUST include error checking:

```typescript
it('renders without runtime errors', () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation();

  // 1. No throws
  expect(() => {
    renderFunction(args);
  }).not.toThrow();

  // 2. No console.error
  expect(errorSpy).not.toHaveBeenCalled();

  // 3. Correct DOM output
  expect(container.querySelector('.expected-class')).not.toBeNull();

  errorSpy.mockRestore();
});
```

### Testing State Machine States

```typescript
import { loadPredictionsFixture } from '../harness/dom-harness';

describe('ML Tab States', () => {
  const states = [
    { name: 'ready', fixture: 'predictions-ready.json', expectedClass: 'predictions-content' },
    { name: 'no-data', fixture: 'predictions-no-data.json', expectedClass: 'artifact-state' },
    { name: 'invalid', fixture: 'predictions-invalid.json', expectedClass: 'artifact-error-banner' },
    { name: 'unsupported', fixture: 'predictions-unsupported-v.json', expectedClass: 'artifact-error-banner' },
  ];

  states.forEach(({ name, fixture, expectedClass }) => {
    it(`handles ${name} state correctly`, () => {
      const data = require(`../fixtures/${fixture}`);
      // ... render and assert
    });
  });
});
```

### Mocking ExtensionDataService

```typescript
import { setupVssMocks, configureExtensionDataService } from '../harness/vss-sdk-mock';

describe('Settings Integration', () => {
  beforeEach(() => {
    setupVssMocks();
  });

  it('handles valid settings', async () => {
    configureExtensionDataService({
      values: {
        'pr-insights-source-project': 'my-project',
        'pr-insights-pipeline-id': 42
      }
    });

    const config = await getSourceConfig();
    expect(config.projectId).toBe('my-project');
  });

  it('handles missing settings', async () => {
    configureExtensionDataService({
      missingKeys: ['pr-insights-source-project', 'pr-insights-pipeline-id']
    });

    const config = await getSourceConfig();
    expect(config.projectId).toBeNull();
  });
});
```

## Coverage Thresholds

### Critical Path Files

| File | Minimum |
|------|---------|
| ui/dashboard.ts | 70% |
| ui/artifact-client.ts | 40% |
| ui/modules/shared/security.ts | 95% |

### Checking Coverage

```bash
# Full coverage report
pnpm test -- --coverage

# Specific file
pnpm test -- --coverage --collectCoverageFrom="ui/dashboard.ts"

# HTML report
open coverage/lcov-report/index.html
```

## Troubleshooting

### Test Fails with "Element not found"

Ensure DOM harness is set up:
```typescript
beforeEach(() => {
  setupDomHarness();
});
```

### VSS Mock Not Working

Ensure VSS mocks are initialized:
```typescript
beforeEach(() => {
  setupDomHarness({ withVssSdk: true });
});
```

### Coverage Below Threshold

1. Check which lines are uncovered: `open coverage/lcov-report/ui/dashboard.ts.html`
2. Add tests for uncovered branches
3. Run coverage again to verify

### Async Test Timeout

Increase timeout for async operations:
```typescript
it('loads data', async () => {
  // ...
}, 10000); // 10 second timeout
```

## CI Integration

Tests run automatically on:
- Pull requests targeting `main`
- Pushes to feature branches

Coverage thresholds are enforced—failing coverage blocks merge.

## Further Reading

- [COVERAGE_RATCHET.md](../../../extension/COVERAGE_RATCHET.md) - Coverage threshold strategy
- [jest.config.ts](../../../extension/jest.config.ts) - Jest configuration
- [tests/setup.ts](../../../extension/tests/setup.ts) - Global test setup
