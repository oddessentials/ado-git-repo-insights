# Implementation Plan: Deterministic Smoke Tests

**Branch**: `022-deterministic-smoke-tests` | **Date**: 2026-02-02 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/022-deterministic-smoke-tests/spec.md`

## Summary

This feature eliminates all sources of non-determinism from the Playwright smoke test suite by:
1. Replacing `waitForTimeout()` with condition-based waits on `data-testid` selectors
2. Replacing `networkidle` with explicit DOM-state assertions
3. Enforcing `testInfo.outputPath()` for all artifacts
4. Centralizing timeout constants
5. Replacing custom `deepClone` with `structuredClone`
6. Enforcing compile-time-only headers on type tests
7. Adding CI enforcement for Playwright version pinning

## Technical Context

**Language/Version**: TypeScript 5.7.3 (extension), Node.js 22
**Primary Dependencies**: Playwright 1.40.0 (pinned), Jest 30.0.0, esbuild 0.27.0
**Storage**: N/A (static JSON fixtures served via `serve` package)
**Testing**: Playwright (smoke tests), Jest (unit/meta tests)
**Target Platform**: Chromium (headless CI), demo dashboard at localhost:3000/3001
**Project Type**: Web extension with demo dashboard
**Performance Goals**: N/A (timing SLAs explicitly removed per spec)
**Constraints**: Zero `waitForTimeout`, zero `networkidle`, `data-testid` selectors only
**Scale/Scope**: 2 smoke test files, 1 edge case test file, 1 type-test file

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Relevance | Status |
|-----------|-----------|--------|
| III. Deterministic Output | Directly relevant - smoke tests must be deterministic | ALIGNED |
| XXIII. Automated Contract Validation | Smoke tests are contract tests for UI | ALIGNED |
| XXIV. End-to-End Testability | Smoke tests validate E2E dashboard flow | ALIGNED |
| QG-17. Lint + format | ESLint/Prettier must pass | ALIGNED |
| QG-19. Unit + integration tests | Smoke tests are part of test:ci | ALIGNED |

**Gate Status**: PASS - No violations. Changes align with constitution principles.

## Project Structure

### Documentation (this feature)

```text
specs/022-deterministic-smoke-tests/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (N/A - no data model changes)
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── test-contracts.md
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
extension/
├── tests/
│   ├── smoke/
│   │   ├── constants.ts         # NEW: SMOKE_TIMEOUT_MS constant
│   │   ├── filter-display.smoke.ts
│   │   └── negative-fixture.smoke.ts
│   ├── modules/
│   │   └── metrics.edge-cases.test.ts  # Replace deepClone with structuredClone
│   ├── types/
│   │   └── rollup.type-test.ts  # Add COMPILE-TIME ONLY header
│   └── meta/
│       ├── no-runtime-type-imports.test.ts  # NEW: CI enforcement
│       └── playwright-version-guard.test.ts # NEW: CI enforcement
├── playwright.config.ts
├── package.json
└── TOOLING.md               # Add Playwright Version Policy section
```

**Structure Decision**: Existing structure preserved. Only additions:
- `extension/tests/smoke/constants.ts` for centralized timeout
- `extension/tests/meta/no-runtime-type-imports.test.ts` for FR-021
- `extension/tests/meta/playwright-version-guard.test.ts` for FR-017

## Complexity Tracking

> No violations - all changes are straightforward refactoring with no new abstractions.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |
