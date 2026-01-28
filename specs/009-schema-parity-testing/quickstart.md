# Quickstart: Schema Parity Testing

**Feature**: 009-schema-parity-testing
**Date**: 2026-01-28

## Overview

This feature adds schema validation for JSON artifacts to ensure the dashboard renders identically across extension mode and local mode. It also provides test infrastructure to achieve tiered coverage thresholds.

## Prerequisites

- Node.js 18+
- pnpm (package manager)
- Extension development environment set up

## Quick Validation

```bash
# Run schema validation tests
cd extension
pnpm test -- --testPathPattern="schema/"

# Run full test suite with coverage
pnpm test -- --coverage

# Check tiered coverage thresholds
pnpm test -- --coverage --coverageThreshold='{"ui/schemas/**/*.ts":{"statements":80}}'
```

## Key Files

| File | Purpose |
|------|---------|
| `ui/schemas/index.ts` | Schema validators and exports |
| `ui/schemas/manifest.schema.ts` | Manifest validation (strict) |
| `ui/schemas/rollup.schema.ts` | Rollup validation (permissive) |
| `ui/schemas/dimensions.schema.ts` | Dimensions validation (strict) |
| `ui/schemas/predictions.schema.ts` | Predictions validation (permissive) |
| `tests/harness/dom-harness.ts` | Shared DOM test harness |
| `tests/harness/vss-sdk-mock.ts` | Enumerated VSS SDK mocks |
| `tests/schema/parity.test.ts` | Cross-source parity test |

## Usage

### Validating Data

```typescript
import { validateManifest, validateRollup } from "../ui/schemas";

// Strict validation (manifest, dimensions)
const manifestResult = validateManifest(manifestData);
if (!manifestResult.valid) {
  console.error("Validation errors:", manifestResult.errors);
}

// Permissive validation (rollup, predictions)
const rollupResult = validateRollup(rollupData);
if (rollupResult.warnings.length > 0) {
  console.warn("Unknown fields:", rollupResult.warnings);
}
```

### Using the Test Harness

```typescript
import { setupDomHarness, teardownDomHarness, setupVssMocks } from "../harness";

describe("Dashboard rendering", () => {
  beforeEach(() => {
    setupDomHarness({
      fixtures: "all",
      withVssSdk: true,
    });
  });

  afterEach(() => {
    teardownDomHarness();
  });

  it("renders main content", () => {
    // Test code with full DOM and mock setup
  });
});
```

### Skip Tagging (FR-012)

```typescript
// CORRECT: Skip with reason
it.skip("handles edge case", () => {
  // SKIP_REASON: Requires external service mock not yet implemented
});

// INCORRECT: Skip without reason (will fail lint)
it.skip("some test", () => {
  // Missing SKIP_REASON - lint error
});
```

## Coverage Thresholds

| Module Type | Threshold | Files |
|-------------|-----------|-------|
| Logic (schemas, metrics, shared) | 80% | `ui/schemas/**`, `ui/modules/metrics.ts`, `ui/modules/shared/**` |
| UI/DOM | 50% | `ui/dashboard.ts`, `ui/settings.ts`, `ui/modules/dom.ts`, `ui/modules/errors.ts` |
| Global fallback | 43/38/50/44 | All other files |

## Validation Modes

| Artifact | Mode | Unknown Fields |
|----------|------|----------------|
| dataset-manifest.json | Strict | Error |
| dimensions.json | Strict | Error |
| weekly rollup | Permissive | Warning (logged) |
| predictions.json | Permissive | Warning (logged) |

## Common Tasks

### Adding a New Schema Field

1. Update the TypeScript interface in `ui/types.ts`
2. Update the validator in `ui/schemas/<type>.schema.ts`
3. Update test fixtures in `tests/fixtures/`
4. Run validation tests: `pnpm test -- --testPathPattern="schema/"`

### Capturing Extension Artifacts for Parity Testing

1. Run the extension in ADO with real data
2. Use browser DevTools to capture JSON responses
3. Save to `tests/fixtures/extension-artifacts/`
4. Run parity test: `pnpm test -- --testPathPattern="parity"`

### Mocking a New VSS SDK Function

1. Document the function in `tests/harness/vss-sdk-mock.ts` (requires approval)
2. Add to the `VssSdkMocks` interface
3. Implement in `setupVssMocks()`
4. Update this quickstart with the new function

## Troubleshooting

### "Schema validation failed" in DatasetLoader

Check the error message for specific field and expected vs actual type. Common causes:
- Missing required field (`manifest_schema_version`)
- Invalid date format (should be ISO 8601)
- Negative count value
- Unknown field in strict mode (manifest, dimensions)

### Coverage threshold not met

Run coverage with verbose output:
```bash
pnpm test -- --coverage --verbose
```

Check which files are under threshold and add tests for uncovered branches.

### VSS SDK mock not working

Ensure you called `setupDomHarness({ withVssSdk: true })` before using SDK functions.

## Next Steps

After implementation:
1. Run full test suite: `pnpm test`
2. Verify coverage thresholds pass
3. Check CI for any skipped tests (should have SKIP_REASON)
4. Review captured extension artifacts for parity
