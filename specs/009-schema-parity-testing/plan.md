# Implementation Plan: Schema Parity Testing & Test Coverage

**Branch**: `009-schema-parity-testing` | **Date**: 2026-01-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/009-schema-parity-testing/spec.md`

## Summary

Implement schema validation for JSON artifacts (dataset-manifest, rollup, dimensions, predictions) to ensure parity between extension-mode and local-mode data, with runtime validation in DatasetLoader using validate-once-and-cache strategy. Achieve tiered test coverage (80% logic, 50% UI/DOM) through shared DOM test harness and enumerated VSS SDK mocks.

## Technical Context

**Language/Version**: TypeScript 5.7.3
**Primary Dependencies**: Jest 30.0.0, ts-jest 29.2.5, vss-web-extension-sdk 5.141.0
**Storage**: JSON files (artifacts from ADO pipeline or local fixtures)
**Testing**: Jest with jsdom environment, existing setup in `extension/tests/setup.ts`
**Target Platform**: Azure DevOps Extension (browser), local HTML dashboard
**Project Type**: Browser extension + local web app (single codebase)
**Performance Goals**: Validate-once-and-cache (first load only), <1s validation time
**Constraints**: No runtime validation latency in production after cache hit
**Scale/Scope**: 4 JSON artifact types, ~30 source files in extension/ui/

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Relevance | Compliance |
|-----------|-----------|------------|
| **III. Deterministic Output** | Schema validation ensures consistent data shapes | COMPLIANT - Normalizes data to deterministic shapes |
| **XII. No Silent Data Loss** | Validation catches malformed data | COMPLIANT - Schema errors surface with actionable messages |
| **XVIII. Actionable Failure Logs** | FR-010 requires specific field/type errors | COMPLIANT - Error messages identify field + expected vs actual |
| **XXIII. Automated Contract Validation** | Core requirement of this feature | COMPLIANT - CI validates schemas on every PR |
| **XXIV. End-to-End Testability** | FR-013 requires cross-source parity test | COMPLIANT - Test validates extension + local produce same shape |

**Quality Gates Affected:**
- QG-19: Unit + integration tests pass → New schema validation tests
- QG-20: Coverage threshold enforced → Tiered thresholds (80%/50%)

**Verification Requirements Affected:**
- VR-04: Unit tests → Schema validation tests added
- VR-05: Golden outputs → Schema-validated fixtures

## Project Structure

### Documentation (this feature)

```text
specs/009-schema-parity-testing/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (JSON schemas)
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
extension/
├── ui/
│   ├── schemas/                    # NEW: JSON schema definitions
│   │   ├── index.ts               # Schema exports + validation functions
│   │   ├── manifest.schema.ts     # dataset-manifest.json schema
│   │   ├── rollup.schema.ts       # weekly rollup schema
│   │   ├── dimensions.schema.ts   # dimensions.json schema
│   │   └── predictions.schema.ts  # predictions.json schema (optional file)
│   ├── dataset-loader.ts          # MODIFY: Add validate-once-and-cache
│   ├── types.ts                   # EXISTING: TypeScript interfaces (reference)
│   └── modules/
│       └── ...
├── tests/
│   ├── setup.ts                   # EXISTING: Jest setup
│   ├── harness/                   # NEW: Shared test harness
│   │   ├── dom-harness.ts        # Single shared DOM test harness
│   │   ├── vss-sdk-mock.ts       # Enumerated VSS SDK mocks
│   │   └── index.ts              # Harness exports
│   ├── fixtures/                  # EXISTING: Test fixtures
│   │   ├── extension-artifacts/  # NEW: Captured extension-mode samples
│   │   └── ...
│   ├── schema/                    # NEW: Schema validation tests
│   │   ├── manifest.test.ts
│   │   ├── rollup.test.ts
│   │   ├── dimensions.test.ts
│   │   ├── predictions.test.ts
│   │   └── parity.test.ts        # Cross-source parity test (FR-013)
│   └── ...
└── jest.config.ts                 # MODIFY: Tiered coverage thresholds
```

**Structure Decision**: Extension to existing single-project structure. New `schemas/` directory for schema definitions, new `tests/harness/` for shared test infrastructure. Follows existing one-way dependency rule.

## Complexity Tracking

No complexity violations. This feature:
- Uses existing project structure (no new projects)
- Adds schemas as pure validation logic (no architecture change)
- Extends existing test infrastructure (no framework replacement)

## Post-Design Constitution Re-Check

*Re-verified after Phase 1 design completion.*

| Principle | Design Artifact | Compliance Status |
|-----------|-----------------|-------------------|
| **III. Deterministic Output** | `data-model.md` defines normalize() functions | ✅ VERIFIED |
| **XII. No Silent Data Loss** | `contracts/schema-validator.ts` defines ValidationError | ✅ VERIFIED |
| **XVIII. Actionable Failure Logs** | ValidationError includes field/expected/actual | ✅ VERIFIED |
| **XXIII. Automated Contract Validation** | `contracts/` + test structure defined | ✅ VERIFIED |
| **XXIV. End-to-End Testability** | `tests/schema/parity.test.ts` planned | ✅ VERIFIED |

**Post-Design Gate**: PASS - All constitution principles addressed in design artifacts.

## Phase 0 & 1 Artifacts Generated

| Artifact | Path | Status |
|----------|------|--------|
| Research | `specs/009-schema-parity-testing/research.md` | ✅ Complete |
| Data Model | `specs/009-schema-parity-testing/data-model.md` | ✅ Complete |
| Schema Validator Contract | `specs/009-schema-parity-testing/contracts/schema-validator.ts` | ✅ Complete |
| Test Harness Contract | `specs/009-schema-parity-testing/contracts/test-harness.ts` | ✅ Complete |
| Quickstart | `specs/009-schema-parity-testing/quickstart.md` | ✅ Complete |

## Implementation Dependencies

```
┌─────────────────────────────┐
│ Phase 1: Schema Foundation  │
├─────────────────────────────┤
│ • Schema validators         │
│ • ValidationResult types    │
│ • SchemaValidationError     │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ Phase 2: DatasetLoader      │
├─────────────────────────────┤
│ • Validate-once-and-cache   │
│ • CacheEntry.validated flag │
│ • Integration with schemas  │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ Phase 3: Test Infrastructure│
├─────────────────────────────┤
│ • Shared DOM harness        │
│ • VSS SDK mock allowlist    │
│ • Extension artifact capture│
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ Phase 4: Coverage & CI      │
├─────────────────────────────┤
│ • Tiered thresholds config  │
│ • Skip tagging enforcement  │
│ • Parity test               │
└─────────────────────────────┘
```

## Next Steps

Run `/speckit.tasks` to generate the detailed task breakdown from this plan.
