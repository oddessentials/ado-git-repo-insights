# Research: Schema Parity Testing & Test Coverage

**Feature**: 009-schema-parity-testing
**Date**: 2026-01-28

## Research Tasks

### 1. Schema Validation Library Selection

**Decision**: Use TypeScript type guards with runtime validation (no external dependency)

**Rationale**:
- The codebase already has comprehensive TypeScript interfaces in `extension/ui/types.ts`
- Adding ajv or Zod would introduce new dependencies for a bounded problem
- Type guards provide compile-time safety + runtime validation in one pattern
- Per-file strictness (strict vs permissive) is easier to implement with custom validators
- Bundle size is a concern for browser extensions

**Alternatives Considered**:

| Option | Pros | Cons | Rejected Because |
|--------|------|------|------------------|
| ajv (JSON Schema) | Industry standard, reusable schemas | 150KB+ bundle size, separate schema files | Bundle bloat for extension |
| Zod | Type inference, excellent DX | ~50KB, new dependency | Overhead for 4 simple schemas |
| io-ts | FP-style, composable | Learning curve, verbose | Team unfamiliar with FP patterns |
| **Type guards** | Zero dependencies, TypeScript-native | Manual maintenance | Selected - fits bounded scope |

**Implementation Pattern**:
```typescript
// Schema validator pattern (to be implemented)
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  field: string;
  expected: string;
  actual: string;
  message: string;
}

export function validateManifest(data: unknown, strict: boolean): ValidationResult;
export function validateRollup(data: unknown, strict: boolean): ValidationResult;
export function validateDimensions(data: unknown, strict: boolean): ValidationResult;
export function validatePredictions(data: unknown, strict: boolean): ValidationResult;
```

### 2. Per-File Strictness Strategy

**Decision**: Implement strictness as a validator parameter, not separate validator functions

**Rationale**:
- Single validator per schema type with `strict: boolean` parameter
- Strict mode (manifest, dimensions): Unknown fields cause validation failure
- Permissive mode (rollup, predictions): Unknown fields logged as warnings, validation passes
- Consistent API across all validators

**Implementation**:
```typescript
// Strict mode for manifest/dimensions
const manifestResult = validateManifest(data, true);  // strict=true

// Permissive mode for rollup/predictions
const rollupResult = validateRollup(data, false);     // strict=false (logs warnings)
```

### 3. Validate-Once-And-Cache Strategy

**Decision**: Add validation flag to DatasetLoader's existing LRU cache entries

**Rationale**:
- DatasetLoader already implements LRU caching with TTL (5 minutes, 52 weeks size)
- Extend cache entry type to include `validated: boolean` flag
- On first load: validate + cache with `validated: true`
- On cache hit: skip validation if `validated: true`
- Cache invalidation resets validation state

**Implementation Approach**:
```typescript
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  validated: boolean;  // NEW: Track validation state
}

// In loadManifest():
const cached = cache.get(key);
if (cached && cached.validated) {
  return cached.data;  // Skip validation
}

const data = await fetch(...);
const result = validateManifest(data, true);
if (!result.valid) {
  throw new SchemaValidationError(result.errors);
}
cache.set(key, { data, timestamp: Date.now(), validated: true });
return data;
```

### 4. VSS SDK Mock Allowlist

**Decision**: Enumerate exact SDK functions used, mock only these in shared harness

**Research Findings** - SDK functions used in `extension/ui/modules/sdk.ts`:

| Function | Purpose | Mock Behavior |
|----------|---------|---------------|
| `VSS.init(options)` | Initialize SDK | No-op, track call |
| `VSS.ready(callback)` | Wait for SDK ready | Immediate callback |
| `VSS.notifyLoadSucceeded()` | Signal load complete | No-op |
| `VSS.getWebContext()` | Get org/project/user | Return mock context |
| `VSS.getService(ServiceIds.ExtensionData)` | Get settings service | Return mock service |
| `VSS.require(["TFS/Build/RestClient"], cb)` | Get Build API client | Return mock client |

**Additional SDK usage in codebase** (searched with grep):
- `VSS.getAccessToken()` - Not currently used but may be needed
- `VSS.ServiceIds.ExtensionData` - Used via getService

**Mock Harness Structure**:
```typescript
// tests/harness/vss-sdk-mock.ts
export const mockWebContext: VSS.WebContext = {
  account: { name: "test-org", id: "org-id" },
  project: { name: "test-project", id: "proj-id" },
  user: { name: "Test User", id: "user-id" },
};

export const mockExtensionDataService: IExtensionDataService = {
  getValue: jest.fn().mockResolvedValue(null),
  setValue: jest.fn().mockResolvedValue(undefined),
  // ... other methods
};

export function setupVssMocks(): void {
  (global as any).VSS = {
    init: jest.fn(),
    ready: jest.fn((cb) => cb()),
    notifyLoadSucceeded: jest.fn(),
    getWebContext: jest.fn(() => mockWebContext),
    getService: jest.fn().mockResolvedValue(mockExtensionDataService),
    require: jest.fn((deps, cb) => cb({ getClient: () => mockBuildClient })),
    ServiceIds: { ExtensionData: "extension-data" },
  };
}
```

### 5. Tiered Coverage Threshold Configuration

**Decision**: Use Jest's `coverageThreshold` with path-based patterns

**Research Findings**:
- Jest supports glob patterns in coverageThreshold
- Can specify different thresholds for different paths
- Current global threshold: 43/38/50/44 (statements/branches/functions/lines)
- Target: 80% logic, 50% UI/DOM

**Implementation**:
```typescript
// jest.config.ts
coverageThreshold: {
  // Logic modules: 80% threshold
  "ui/schemas/**/*.ts": {
    statements: 80,
    branches: 80,
    functions: 80,
    lines: 80,
  },
  "ui/modules/metrics.ts": {
    statements: 80,
    branches: 80,
    functions: 80,
    lines: 80,
  },
  "ui/modules/shared/**/*.ts": {
    statements: 80,
    branches: 80,
    functions: 80,
    lines: 80,
  },
  // UI/DOM modules: 50% threshold (ratchet baseline)
  "ui/dashboard.ts": {
    statements: 50,
    branches: 50,
    functions: 50,
    lines: 50,
  },
  "ui/settings.ts": {
    statements: 50,
    branches: 50,
    functions: 50,
    lines: 50,
  },
  "ui/modules/dom.ts": {
    statements: 50,
    branches: 50,
    functions: 50,
    lines: 50,
  },
  "ui/modules/errors.ts": {
    statements: 50,
    branches: 50,
    functions: 50,
    lines: 50,
  },
  // Global fallback (maintains current minimum)
  global: {
    statements: 43,
    branches: 38,
    functions: 50,
    lines: 44,
  },
}
```

### 6. DOM Test Harness Design

**Decision**: Single shared harness extending existing setup.ts patterns

**Research Findings**:
- Existing `tests/setup.ts` provides fetch mocks, performance polyfills
- Need to add: DOM element creation, VSS SDK mocks, common fixtures
- Pattern: Export harness functions, import in tests that need them
- Prohibit per-test bespoke mocks via ESLint rule or PR review

**Harness Structure**:
```typescript
// tests/harness/dom-harness.ts
export interface DomHarnessOptions {
  fixtures?: "manifest" | "dimensions" | "rollup" | "predictions" | "all";
  withVssSdk?: boolean;
}

export function setupDomHarness(options: DomHarnessOptions = {}): void {
  // Create standard DOM structure
  document.body.innerHTML = `
    <div id="app">
      <div id="loading-state"></div>
      <div id="main-content"></div>
      <div id="error-panel"></div>
    </div>
  `;

  if (options.withVssSdk) {
    setupVssMocks();
  }

  // Setup fetch mocks for requested fixtures
  if (options.fixtures) {
    setupFixtureMocks(options.fixtures);
  }
}

export function teardownDomHarness(): void {
  document.body.innerHTML = "";
  jest.clearAllMocks();
}
```

### 7. Cross-Source Parity Test Strategy

**Decision**: Capture extension-mode artifacts once, compare against local fixtures

**Rationale**:
- Cannot fetch live extension artifacts in unit tests (no auth)
- Capture representative artifacts from real extension run
- Store in `tests/fixtures/extension-artifacts/`
- Parity test validates both sources against same schema
- Asserts normalized in-memory shape is identical

**Implementation**:
```typescript
// tests/schema/parity.test.ts
describe("Cross-source schema parity", () => {
  const localManifest = require("../fixtures/dataset-manifest.json");
  const extensionManifest = require("../fixtures/extension-artifacts/dataset-manifest.json");

  it("both sources validate against manifest schema", () => {
    expect(validateManifest(localManifest, true).valid).toBe(true);
    expect(validateManifest(extensionManifest, true).valid).toBe(true);
  });

  it("both sources normalize to identical shape", () => {
    const localNormalized = normalizeManifest(localManifest);
    const extensionNormalized = normalizeManifest(extensionManifest);
    expect(localNormalized).toEqual(extensionNormalized);
  });
});
```

### 8. Skip Tagging Enforcement

**Decision**: ESLint rule + Jest reporter for skip tracking

**Research Findings**:
- Jest supports custom reporters
- Can detect `it.skip`, `describe.skip`, `test.skip` via AST
- Require format: `it.skip("test name", () => { /* SKIP_REASON: reason */ })`
- CI reporter outputs all skipped tests with reasons

**Implementation Options**:
1. **ESLint rule** (preferred): Fail lint if skip without SKIP_REASON comment
2. **Jest reporter**: Post-run summary of all skips with reasons
3. **Both**: ESLint catches at dev time, reporter catches at CI time

**Chosen**: ESLint rule + custom Jest reporter

```typescript
// Custom ESLint rule sketch
"no-untagged-skips": {
  meta: { type: "problem" },
  create(context) {
    return {
      CallExpression(node) {
        if (isSkipCall(node) && !hasSkipReasonComment(node)) {
          context.report({ node, message: "Skipped test must have SKIP_REASON comment" });
        }
      }
    };
  }
}
```

## Summary of Decisions

| Area | Decision | Key Rationale |
|------|----------|---------------|
| Schema library | TypeScript type guards | Zero dependencies, fits bounded scope |
| Strictness | Parameter-based (`strict: boolean`) | Consistent API, configurable per-call |
| Runtime validation | Validate-once-and-cache | Performance: validate first load only |
| VSS mocks | Enumerated allowlist (6 functions) | Bounded scope, shared harness |
| Coverage | Path-based tiered thresholds | Realistic targets for DOM vs logic |
| DOM harness | Single shared module | No bespoke mocks, consistent setup |
| Parity test | Captured artifacts comparison | Deterministic without live auth |
| Skip enforcement | ESLint + Jest reporter | Catch at dev + CI time |

## Unresolved Items

None. All NEEDS CLARIFICATION items from spec were resolved in clarification session.
