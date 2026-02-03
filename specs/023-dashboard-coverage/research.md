# Research: Dashboard Critical Test Coverage

**Feature**: 023-dashboard-coverage
**Date**: 2026-02-03

## Research Tasks

### 1. Critical Path Set Function Analysis

**Task**: Identify and document the 6 Critical Path Set functions requiring 90%+ coverage.

**Findings**:

| Function | File | Line | Current Coverage | Complexity |
|----------|------|------|------------------|------------|
| `renderPredictionsForState` | dashboard.ts | 703 | Partial | 5-state switch, DOM manipulation |
| `renderInsightsForState` | dashboard.ts | 755 | Partial | 5-state switch, DOM manipulation |
| `getSourceConfig` | dashboard.ts | 269 | Low | Async ExtensionDataService calls |
| `loadDataset` | dataset-loader.ts | Entry | ~82% | Schema validation, error handling |
| `resolveConfiguration` | dashboard.ts | 333 | Low | Complex branching, fallback logic |
| `_authenticatedFetch` | artifact-client.ts | 271 | ~15% | Minimal branching, auth header injection |

**Decision**: Target these 6 functions for 90%+ per-function coverage thresholds in Jest config.

**Rationale**: These functions represent the critical data flow from settings → API → rendering. Failures here cascade to the entire dashboard experience.

**Alternatives Considered**:
- Per-file thresholds only: Rejected because file-level coverage masks untested critical paths
- Statement-based only: Rejected because branch coverage is essential for error handling paths

---

### 2. Fixture Gap Analysis

**Task**: Identify missing fixtures for the 5-state matrix.

**Findings**:

| Artifact Type | ready | no-data | invalid-artifact | unsupported-schema | setup-required |
|---------------|-------|---------|------------------|-------------------|----------------|
| predictions | MISSING | MISSING | ✅ EXISTS | ✅ EXISTS | N/A (no file) |
| insights | MISSING | MISSING | ✅ EXISTS | ✅ EXISTS | N/A (no file) |

**Current Fixtures**:
```
extension/tests/fixtures/
├── predictions-invalid.json
├── predictions-unsupported-v.json
├── insights-invalid.json
├── insights-unsupported-v.json
└── insights-valid.json  # Should be renamed to insights-ready.json
```

**Decision**: Create 4 new fixtures, rename 1 existing fixture:
- Create: `predictions-ready.json`, `predictions-no-data.json`, `insights-no-data.json`
- Rename: `insights-valid.json` → `insights-ready.json`
- `setup-required` state triggered by missing file, no fixture needed

**Rationale**: Aligns fixture naming with ML state machine states for clarity. Missing file = setup-required is already the production behavior.

---

### 3. ExtensionDataService Mock Strategy

**Task**: Determine how to mock VSS.getService(VSS.ServiceIds.ExtensionData) for settings tests.

**Findings**:

Existing `vss-sdk-mock.ts` provides:
```typescript
export function setupVssMocks(): void {
  (global as any).VSS = {
    getService: jest.fn(),
    ServiceIds: { ExtensionData: 'ExtensionData' },
    // ...
  };
}
```

Required mock scenarios:
1. **Valid settings**: Return `{ getValue: () => Promise.resolve(validValue) }`
2. **Missing keys**: Return `{ getValue: () => Promise.resolve(undefined) }`
3. **Invalid values**: Return `{ getValue: () => Promise.resolve(invalidValue) }`
4. **Service error**: Reject with error

**Decision**: Extend vss-sdk-mock.ts with `mockExtensionDataService()` helper that accepts scenario configuration.

**Rationale**: Centralizes mock configuration, prevents duplicate mock setup across tests.

---

### 4. Error Assertion Pattern

**Task**: Define the triple assertion pattern for SC-005 enforcement.

**Findings**:

Jest provides:
- `jest.spyOn(console, 'error')` - spy on console.error calls
- `expect(fn).not.toThrow()` - assert no throws
- DOM assertions via existing harness helpers

**Decision**: Create `createErrorAssertionContext()` helper:

```typescript
interface ErrorAssertionContext {
  consoleErrorSpy: jest.SpyInstance;
  assertNoErrors(): void;
  assertFallbackRendered(containerId: string, fallbackClass: string): void;
}

function createErrorAssertionContext(): ErrorAssertionContext {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  return {
    consoleErrorSpy: spy,
    assertNoErrors() {
      expect(spy).not.toHaveBeenCalled();
    },
    assertFallbackRendered(containerId, fallbackClass) {
      const container = document.getElementById(containerId);
      expect(container?.querySelector(`.${fallbackClass}`)).not.toBeNull();
    }
  };
}
```

**Rationale**: Encapsulates the triple assertion pattern in a reusable helper, ensuring consistent enforcement across all tests.

---

### 5. XSS Test Strategy

**Task**: Determine scope of XSS prevention tests.

**Findings**:

Centralized security module at `ui/modules/shared/security.ts`:
- `escapeHtml(text: string)` - HTML entity encoding
- `safeHtml` template literal - automatic escaping
- `sanitizeUrl(url: string)` - URL scheme validation

**Decision**: Test the 3 security boundary functions exhaustively:
- `escapeHtml`: All HTML special characters (<, >, &, ", ')
- `safeHtml`: Template interpolation with malicious payloads
- `sanitizeUrl`: Block javascript:, data:, vbscript: schemes

**Rationale**: Testing the boundary functions provides coverage for all rendering paths that use them. No need to test individual render functions if they correctly call security functions.

---

### 6. Coverage Threshold Configuration

**Task**: Determine Jest configuration for Critical Path Set function-level coverage.

**Findings**:

Jest `coverageThreshold` supports per-file thresholds but NOT per-function thresholds directly. Options:
1. Per-file thresholds (coarse)
2. Use `collectCoverageFrom` patterns to isolate functions (complex)
3. Custom coverage reporter to check function coverage (overkill)

**Decision**: Use per-file thresholds with targeted `collectCoverageFrom`:

```typescript
coverageThreshold: {
  // Critical Path files
  "ui/dashboard.ts": {
    statements: 70,
    branches: 65,
    functions: 70,
    lines: 70,
  },
  "ui/artifact-client.ts": {
    statements: 40,
    branches: 35,
    functions: 40,
    lines: 40,
  },
  // ... existing thresholds
}
```

**Rationale**: Per-file thresholds are practical with Jest. Function-level coverage is verified by test naming convention and code review. The 90% target for specific functions is achieved by ensuring tests exist for all branches of those functions.

**Alternatives Considered**:
- Custom Jest reporter: Rejected as over-engineering for this scope
- Separate test files per function: Rejected as impractical structure

---

## Summary

All research tasks completed. No blockers identified. Proceed to Phase 1 with:
- 6 Critical Path functions documented
- 4 new fixtures + 1 rename planned
- ExtensionDataService mock extension designed
- Triple assertion pattern helper designed
- XSS tests scoped to 3 security functions
- Jest threshold configuration approach defined
