# Implementation Plan: Spec-Task Coverage Gap Resolution

**Branch**: `021-spec-task-coverage-gaps` | **Date**: 2026-02-01 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/021-spec-task-coverage-gaps/spec.md`

## Summary

This feature adds enterprise-grade testing infrastructure to the `001-fix-filter-prcount-sum` feature by:

1. **Type Safety Gates**: Dedicated `pnpm run test:types` command with positive/negative compile-time tests using `@ts-expect-error`
2. **Deterministic Smoke Tests**: Playwright-based browser automation with `webServer` config, `data-testid` selectors, and screenshot artifacts
3. **Edge Case Coverage Matrix**: 5 explicit tests (EC-001 through EC-005) with meta-test traceability enforcement
4. **Quality Gate Enforcement**: 5 documented gates with pinned commands and exit code semantics

The implementation updates `specs/001-fix-filter-prcount-sum/tasks.md` with new tasks and modifies extension code to support the testing infrastructure.

## Technical Context

**Language/Version**: TypeScript 5.7.3 (extension)
**Primary Dependencies**: Jest 30.0.0, Playwright (pinned), esbuild 0.27.0
**Storage**: N/A (in-memory data processing, static JSON fixtures)
**Testing**: Jest (unit), tsc (type tests), Playwright (smoke tests)
**Target Platform**: Node 22, Browser (Chrome headless via Playwright)
**Project Type**: Extension UI (TypeScript) + Demo (static HTML/JS)
**Performance Goals**: N/A (test infrastructure, not runtime code)
**Constraints**: GitHub Actions only, pnpm 9.15.0, deterministic/reproducible
**Scale/Scope**: 35 new tasks (T024-T058), ~5 new test files, 3 new package.json scripts (test:types, test:smoke, updated test:ci)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CSV Schema Contract | N/A | Feature does not touch CSV output |
| II. No Breaking CSV Changes | N/A | No CSV changes |
| III. Deterministic Output | ✅ PASS | Tests enforce deterministic behavior |
| IV. PowerBI Frictionless | N/A | No PowerBI changes |
| V. SQLite Source of Truth | N/A | Feature is TypeScript-only |
| VI-IX. Persistence | N/A | No persistence changes |
| X-XII. Extraction | N/A | No extraction changes |
| XVII. Cross-Agent Compat | ✅ PASS | Tests run on GitHub Actions hosted agents |
| XVIII. Actionable Failure | ✅ PASS | Gates produce clear error messages (FR-017) |
| XIX. PAT Secrecy | N/A | No PAT handling |
| XXIII. Automated Validation | ✅ PASS | Adds type/smoke/edge-case test automation |
| XXIV. E2E Testability | ✅ PASS | Smoke test validates demo without live API |

**Quality Gates Alignment**:
- QG-17 (Lint): Existing, no change
- QG-18 (Type checking): Enhanced with `test:types` command
- QG-19 (Tests pass): Enhanced with edge case + smoke tests
- QG-20 (Coverage): Defer to existing jest.config.ts ratchet

**Verdict**: No constitution violations. Feature adds testing infrastructure without modifying core data contracts.

## Project Structure

### Documentation (this feature)

```text
specs/021-spec-task-coverage-gaps/
├── spec.md              # Feature specification (complete)
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (minimal - test infrastructure)
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (modifications)

```text
extension/
├── package.json                          # Add Playwright, test:types, test:smoke scripts
├── tsconfig.type-tests.json              # NEW: Type test config
├── playwright.config.ts                  # NEW: Smoke test config
├── TOOLING.md                            # NEW: Pinned versions doc
├── tests/
│   ├── types/
│   │   └── rollup.type-test.ts           # NEW: Type safety tests
│   ├── modules/
│   │   └── metrics.edge-cases.test.ts    # NEW: Edge case tests (EC-001..EC-005)
│   ├── smoke/
│   │   └── filter-display.smoke.ts       # NEW: Playwright smoke test
│   └── meta/
│       └── ec-traceability.test.ts       # NEW: EC-### coverage check
├── test-artifacts/
│   └── smoke/                            # Screenshot output (git-ignored)
└── ui/
    └── (no changes needed)

docs/
└── index.html                            # Add data-testid attributes (total-prs, filter-repository, filter-team)

specs/001-fix-filter-prcount-sum/
└── tasks.md                              # UPDATE: Add new tasks (T024+)
```

**Structure Decision**: Single extension project with new test directories for type tests, smoke tests, and meta-tests. No new top-level projects.

## Complexity Tracking

No constitution violations requiring justification.

## Phase 0: Research Summary

### R1: Type Test Harness with @ts-expect-error

**Decision**: Use `tsc --noEmit --project tsconfig.type-tests.json` with `@ts-expect-error` annotations

**Rationale**:
- No additional dependencies (uses existing tsc)
- `@ts-expect-error` fails compilation if expected error disappears (TS2578)
- Exit code 0 = all expected errors occurred + positive tests passed
- Separate tsconfig isolates type tests from main build

**Alternatives Considered**:
- `tsd` package: Rejected (additional dependency, different syntax)
- `dtslint`: Rejected (designed for DefinitelyTyped, overkill)

### R2: Playwright Smoke Test Configuration

**Decision**: Use Playwright with `webServer` config on port 3000

**Rationale**:
- Built-in static server via `webServer` config (no separate server process)
- Deterministic headless execution
- Screenshot capture on pass AND fail
- Stable selectors via `data-testid`

**Configuration Pattern**:
```typescript
// playwright.config.ts
export default defineConfig({
  webServer: {
    command: 'npx serve ../docs -l 3000',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:3000',
  },
});
```

### R3: Edge Case Traceability Enforcement

**Decision**: Meta-test that scans for `// Covers EC-###` comments

**Rationale**:
- Simple regex scan of test file
- Fails if any EC-001..EC-005 missing or duplicated
- Runs as part of `pnpm test:ci`
- No external tooling required

**Implementation Pattern**:
```typescript
// ec-traceability.test.ts
const content = fs.readFileSync('metrics.edge-cases.test.ts', 'utf-8');
const ecIds = ['EC-001', 'EC-002', 'EC-003', 'EC-004', 'EC-005'];
for (const id of ecIds) {
  expect(content).toContain(`// Covers ${id}:`);
}
```

### R4: Fixture Schema Validation

**Decision**: Pre-flight check in smoke test before browser launch

**Rationale**:
- Fail fast with clear error if fixture missing/malformed
- Validate minimum schema: `{ weekly_rollups: [{ by_repository, by_team }] }`
- Distinguish fixture errors from test failures

### R5: data-testid Selectors

**Decision**: Add to demo UI: `data-testid="total-prs"`, `data-testid="filter-repository"`, `data-testid="filter-team"`

**Rationale**:
- Stable selectors immune to CSS/text changes
- Playwright native support: `page.getByTestId('total-prs')`
- No impact on production functionality

## Phase 1: Design Artifacts

### Data Model

This feature primarily adds test infrastructure. The key data entities are already defined in the 001 spec:

| Entity | Source | Role in Testing |
|--------|--------|-----------------|
| `BreakdownEntry` | `rollup.schema.ts` | Type test target |
| `Rollup` | `rollup.schema.ts` | Type test target |
| Smoke Fixture | `docs/data/rollup.json` | Smoke test input |
| Edge Case Fixtures | Test file inline | Unit test input |

**Fixture Schema Contract** (FR-006):
```typescript
interface SmokeFixture {
  weekly_rollups: Array<{
    by_repository: Record<string, { pr_count: number }>;
    by_team: Record<string, { pr_count: number }>;
  }>;
}
```

### Contracts

No new API contracts. Test contracts defined by:

1. **Type Test Contract**: `tsconfig.type-tests.json` includes only `tests/**/*.type-test.ts`
2. **Smoke Test Contract**: Playwright config defines `webServer`, selectors, artifact paths
3. **EC Traceability Contract**: Meta-test enforces `// Covers EC-###` presence

### Test File Naming Conventions

| Test Type | File Pattern | Command |
|-----------|--------------|---------|
| Type Tests | `*.type-test.ts` | `pnpm run test:types` |
| Edge Case Tests | `metrics.edge-cases.test.ts` | `pnpm test:unit` |
| Smoke Tests | `*.smoke.ts` | `pnpm run test:smoke` |
| Meta Tests | `*-traceability.test.ts` | `pnpm test:unit` |

## Quickstart

### Prerequisites

```bash
cd extension
pnpm install  # Installs Playwright after plan implementation
```

### Run Type Tests

```bash
pnpm run test:types
# Exit 0 = pass, Exit non-zero = type regression or error
```

### Run Edge Case Tests

```bash
pnpm test:unit -- --testPathPattern=metrics.edge-cases.test.ts
# All EC-001..EC-005 must pass
```

### Run Smoke Test

```bash
pnpm run test:smoke
# Starts server on :3000, captures screenshot to test-artifacts/smoke/
```

### Run Full Suite (CI Gate)

```bash
pnpm test:ci
# Runs all tests including type, edge case, smoke, and traceability
```

### Validate Type Test Harness

```bash
# Intentionally break a type to verify gate catches it
# 1. In rollup.schema.ts, temporarily change by_repository to Record<string, number>
# 2. Run pnpm run test:types
# 3. Expect exit code non-zero with TS2578 (unused @ts-expect-error)
# 4. Revert change
```

## Task Structure Preview

The implementation adds 35 new tasks to `specs/021-spec-task-coverage-gaps/tasks.md`:

### Phase 1: Type Test Infrastructure (T024-T030) - US1
- T024-T025: Configuration (tsconfig.type-tests.json, test:types script)
- T026-T029: Type test implementation (2 positive, 2 negative tests)
- T030: Harness validation (intentionally break type to verify gate)

### Phase 2: Smoke Test Infrastructure (T031-T040) - US2
- T031-T032: Dependencies (Playwright, test:smoke script)
- T033-T034: Configuration (playwright.config.ts, .gitignore)
- T035-T037: DOM selectors (data-testid attributes in docs/index.html)
- T038-T040: Smoke test implementation (fixture validation, filter tests)

### Phase 3: Edge Case Traceability (T041-T047) - US3
- T041-T045: Edge case tests (EC-001 through EC-005 with traceability comments)
- T046-T047: Meta-test enforcement (ec-traceability.test.ts, CI integration)

### Phase 4: Quality Gate Documentation (T048-T051) - US4
- T048-T049: Documentation (TOOLING.md, CI artifact upload)
- T050-T051: CI integration (test:ci script update, verification)

### Phase 5: Polish & Verification (T052-T058)
- T052-T058: Final validation (lint, format, success criteria verification)

**Total**: 35 new tasks (T024-T058) in dedicated 021 tasks.md.

## Gate Validation Commands

| Gate | Command | Pass Criteria |
|------|---------|---------------|
| Gate 1 | `pnpm run build:check` | Exit 0 |
| Gate 2 | `pnpm run test:types` | Exit 0 |
| Gate 3 | `pnpm test:unit` | Exit 0, all tests pass |
| Gate 4 | `pnpm run test:smoke` | Exit 0, screenshot in test-artifacts/ |
| Gate 5 | `pnpm test:ci` | Exit 0, all artifacts generated |

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Playwright install fails in CI | Use `npx playwright install --with-deps chromium` in CI |
| Port 3000 conflict | Playwright webServer handles port binding; fail if port in use |
| Flaky smoke test | Use `data-testid` selectors, forbid timing waits |
| Type test harness silent failure | Validation task (T028) proves harness catches regressions |
| EC traceability bypass | Meta-test blocks merge if EC-### comments missing |

## Next Steps

1. Run `/speckit.tasks` to generate detailed task list
2. Implement tasks in order (type tests → smoke tests → traceability → docs)
3. Validate each gate passes before proceeding
4. Update CI workflow with artifact upload
