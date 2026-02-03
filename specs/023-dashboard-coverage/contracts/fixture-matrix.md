# Contract: Fixture Matrix

**Feature**: 023-dashboard-coverage
**Date**: 2026-02-03

## Purpose

This contract defines the complete test fixture matrix for ML tab state testing.

## Fixture Naming Convention

```
{artifact_type}-{state}.json
```

Where:
- `artifact_type`: `predictions` | `insights`
- `state`: `ready` | `no-data` | `invalid` | `unsupported-v`

Note: `setup-required` state is triggered by missing file, no fixture needed.

## Required Fixtures

| Fixture File | State | Action Required |
|--------------|-------|-----------------|
| `predictions-ready.json` | ready | CREATE |
| `predictions-no-data.json` | no-data | CREATE |
| `predictions-invalid.json` | invalid-artifact | EXISTS |
| `predictions-unsupported-v.json` | unsupported-schema | EXISTS |
| `insights-ready.json` | ready | RENAME from `insights-valid.json` |
| `insights-no-data.json` | no-data | CREATE |
| `insights-invalid.json` | invalid-artifact | EXISTS |
| `insights-unsupported-v.json` | unsupported-schema | EXISTS |

## Test Coverage Matrix

Each cell represents a required test case:

| State | predictions | insights |
|-------|-------------|----------|
| setup-required | ✅ Test missing file | ✅ Test missing file |
| no-data | ✅ Test empty array | ✅ Test empty array |
| invalid-artifact | ✅ Test schema failure | ✅ Test schema failure |
| unsupported-schema | ✅ Test version check | ✅ Test version check |
| ready | ✅ Test full render | ✅ Test full render |

**Total: 10 test cases minimum**

## DOM Assertions per State

### setup-required
- Container has class `ml-empty-state`
- Contains setup guidance text
- No error styling

### no-data
- Container has class `artifact-state`
- Contains "No Data" message
- No error styling

### invalid-artifact
- Container has class `artifact-error-banner`
- Contains "Invalid" or "validation" text
- Has error styling

### unsupported-schema
- Container has class `artifact-error-banner`
- Contains "Unsupported" and version text
- Has warning styling

### ready
- Container has class `predictions-content` or `insights-content`
- Contains rendered data elements
- No error or empty states visible

## Error Assertion Requirements

Each test MUST include the triple assertion:

```typescript
describe('ML State: {state}', () => {
  it('renders without errors', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    // Assertion 1: No throws
    expect(() => {
      renderPredictionsForState(container, stateObject);
    }).not.toThrow();

    // Assertion 2: No console.error
    expect(errorSpy).not.toHaveBeenCalled();

    // Assertion 3: Correct DOM output
    expect(container.querySelector('.expected-class')).not.toBeNull();

    errorSpy.mockRestore();
  });
});
```

## Fixture Location

All fixtures reside in: `extension/tests/fixtures/`

## Validation

Before merging, verify:
1. All 8 fixture files exist with correct names
2. All 10 test cases pass
3. Triple assertion enforced in each test
4. DOM selectors match actual production CSS classes
