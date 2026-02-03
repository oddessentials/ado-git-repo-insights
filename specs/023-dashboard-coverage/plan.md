# Implementation Plan: Dashboard Critical Test Coverage

**Branch**: `023-dashboard-coverage` | **Date**: 2026-02-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/023-dashboard-coverage/spec.md`

## Summary

Improve test coverage for critical dashboard features by implementing a hybrid threshold strategy (Critical Path Set at 90%+ plus global ratchet), adding the 5-state fixture matrix for ML tab testing, and establishing contract tests for settings integration. This is a test-only feature—no production code changes except Jest configuration updates.

## Technical Context

**Language/Version**: TypeScript 5.7.3
**Primary Dependencies**: Jest 30.0.0, ts-jest 29.2.5, jsdom (test environment)
**Storage**: N/A (in-memory test fixtures only)
**Testing**: Jest with jsdom environment, existing DOM harness infrastructure
**Target Platform**: Node.js 22 (CI canonical), local development on Windows/Linux/macOS
**Project Type**: Extension (browser-based UI tests)
**Performance Goals**: Test suite executes within existing CI time budget
**Constraints**: No new test frameworks, leverage existing harness infrastructure
**Scale/Scope**: 6 Critical Path functions, 10 fixtures (5 states × 2 artifact types), ~15-20 new test files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

This feature is **test infrastructure only** and does not modify production code paths. Constitution applicability:

| Principle | Applies | Status |
|-----------|---------|--------|
| I-IV (CSV Schema) | No | N/A - no CSV changes |
| V-IX (Persistence) | No | N/A - no SQLite changes |
| X-XVI (Extraction) | No | N/A - no API changes |
| XVII-XVIII (Cross-Agent) | No | N/A - no pipeline task changes |
| XIX-XX (PAT Security) | No | N/A - no auth code changes |
| XXI-XXII (Storage Backend) | No | N/A - no storage changes |
| XXIII (CSV Contract Tests) | Tangential | ✅ Adding tests supports this principle |
| XXIV (E2E Testability) | Tangential | ✅ Adding tests supports this principle |
| XXV (Backfill Testing) | No | N/A - not testing backfill |

**Quality Gates Affected**:
- QG-20 (Coverage threshold enforced) - ✅ This feature directly implements this gate

**Verdict**: ✅ PASS - No constitution violations. Feature enhances test infrastructure supporting multiple principles.

## Project Structure

### Documentation (this feature)

```text
specs/023-dashboard-coverage/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (fixture schema definitions)
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (test contracts)
│   ├── fixture-matrix.md
│   └── coverage-thresholds.md
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
extension/
├── ui/
│   ├── dashboard.ts           # Target: Critical Path functions
│   ├── artifact-client.ts     # Target: _authenticatedFetch
│   ├── dataset-loader.ts      # Target: loadDataset
│   └── modules/
│       └── shared/
│           └── security.ts    # Target: XSS validation tests
├── tests/
│   ├── fixtures/
│   │   ├── predictions-ready.json       # NEW: 5-state matrix
│   │   ├── predictions-no-data.json     # NEW
│   │   ├── predictions-invalid.json     # EXISTS
│   │   ├── predictions-unsupported-v.json # EXISTS
│   │   ├── insights-ready.json          # NEW (rename valid)
│   │   ├── insights-no-data.json        # NEW
│   │   ├── insights-invalid.json        # EXISTS
│   │   └── insights-unsupported-v.json  # EXISTS
│   ├── harness/
│   │   ├── dom-harness.ts     # EXISTS - extend for error assertions
│   │   └── vss-sdk-mock.ts    # EXISTS - extend for settings mocks
│   ├── dashboard/
│   │   ├── ml-state-rendering.test.ts   # NEW: 5-state matrix tests (covers Critical Path rendering functions)
│   │   └── settings-contract.test.ts    # NEW: Settings boundary tests (covers getSourceConfig, resolveConfiguration)
│   ├── artifact-client/
│   │   └── http-responses.test.ts       # NEW: HTTP code coverage
│   └── security/
│       └── xss-prevention.test.ts       # NEW: Security boundary tests
└── jest.config.ts             # UPDATE: Add Critical Path thresholds
```

**Structure Decision**: Uses existing extension test structure. New test files organized by module under `tests/`. Fixture naming follows 5-state matrix convention.

## Complexity Tracking

No complexity violations. This feature:
- Adds test files only (no new production modules)
- Uses existing harness infrastructure
- Follows established patterns from existing test files

---

## Phase 0: Research

See [research.md](./research.md) for detailed findings.

### Key Decisions

1. **Critical Path Set Functions Identified**:
   - `renderPredictionsForState` (dashboard.ts:703)
   - `renderInsightsForState` (dashboard.ts:755)
   - `getSourceConfig` (dashboard.ts:269)
   - `loadDataset` (dataset-loader.ts)
   - `resolveConfiguration` (dashboard.ts:333)
   - `_authenticatedFetch` (artifact-client.ts:271)

2. **Fixture Gap Analysis**:
   - Missing: `predictions-ready.json`, `predictions-no-data.json`, `insights-ready.json`, `insights-no-data.json`
   - Existing: `*-invalid.json`, `*-unsupported-v.json` cover error states
   - `setup-required` state = missing file (no fixture needed)

3. **Settings Mock Strategy**:
   - Mock `VSS.getService(VSS.ServiceIds.ExtensionData)` via vss-sdk-mock.ts
   - Test scenarios: valid settings, invalid values, missing keys, null returns

4. **Error Assertion Pattern**:
   - Use `jest.spyOn(console, 'error')` for console.error detection
   - Wrap render calls in try-catch for throw detection
   - Use DOM assertions for fallback UI verification

---

## Phase 1: Design

### Data Model

See [data-model.md](./data-model.md) for fixture schemas and state definitions.

### Contracts

See [contracts/](./contracts/) for:
- `fixture-matrix.md`: Complete 5-state × 2-artifact fixture specification
- `coverage-thresholds.md`: Jest configuration for Critical Path Set

### Quickstart

See [quickstart.md](./quickstart.md) for developer setup and test execution guide.
