# Extension Tooling Documentation

This document describes the tooling and quality gates for the extension codebase.

## Required Versions

| Tool       | Version | Purpose                                              |
| ---------- | ------- | ---------------------------------------------------- |
| Node.js    | 22      | Runtime                                              |
| pnpm       | 9.15.0  | Package manager (declared in `packageManager` field) |
| TypeScript | 5.7.3   | Type checking and compilation                        |
| Playwright | 1.40.0  | Browser automation for smoke tests                   |
| Jest       | 30.0.0  | Unit test framework                                  |
| ESLint     | 9.18.0  | Code linting                                         |

## Quality Gates

The CI pipeline runs 5 quality gates in sequence. All gates must pass for CI to succeed.

### Gate 1: Build Check

Validates TypeScript compilation without emitting files.

```bash
pnpm run build:check
```

**Pass criteria**: Exit code 0, no type errors

### Gate 2: Type Tests

Validates compile-time type safety tests with fail-on-regression detection.

```bash
pnpm run test:types
```

**Pass criteria**: Exit code 0, all `@ts-expect-error` annotations satisfied

**Test file**: `tests/types/rollup.type-test.ts`

### Gate 3: Unit Tests

Runs all Jest unit tests including:

- Module tests (`tests/modules/`)
- Schema validation tests
- Edge case tests (EC-001 through EC-005)
- Meta-tests (traceability enforcement)

```bash
pnpm test:unit
```

**Pass criteria**: Exit code 0, all tests pass

**Edge case coverage**: EC-001 through EC-005 in `tests/modules/metrics.edge-cases.test.ts`

### Gate 4: Smoke Tests

Runs Playwright browser automation tests against the demo dashboard.

```bash
pnpm run test:smoke
```

**Pass criteria**: Exit code 0, screenshot artifacts in `test-artifacts/smoke/`

**Test file**: `tests/smoke/filter-display.smoke.ts`

**Artifacts**:

- `test-artifacts/smoke/repository-filter.png`
- `test-artifacts/smoke/team-filter.png` or `team-filter-disabled.png`

### Gate 5: Full CI Suite

Runs all gates in sequence (used by CI workflow).

```bash
pnpm test:ci
```

**Sequence**: `build:check` → `test:types` → `test:unit` → `test:smoke`

**Pass criteria**: Exit code 0, all gates pass

## Running Locally

### Quick Verification

```bash
# Run all quality gates
pnpm test:ci
```

### Individual Gates

```bash
# Gate 1: Type compilation
pnpm run build:check

# Gate 2: Type tests
pnpm run test:types

# Gate 3: Unit tests
pnpm test:unit

# Gate 4: Smoke tests (requires docs/data fixtures)
pnpm run test:smoke
```

### Development Workflow

```bash
# Watch mode for unit tests
pnpm test:watch

# Code formatting
pnpm run format

# Lint check
pnpm run lint
```

## Test Artifact Locations

| Artifact          | Location                | Git Status               |
| ----------------- | ----------------------- | ------------------------ |
| Smoke screenshots | `test-artifacts/smoke/` | Ignored (uploaded in CI) |
| Playwright report | `playwright-report/`    | Ignored                  |
| Coverage report   | `coverage/`             | Ignored                  |
| Jest JUnit report | `test-results.xml`      | Ignored                  |

## Edge Case Traceability

Edge case tests in `tests/modules/metrics.edge-cases.test.ts` use standardized markers:

```typescript
// Covers EC-001: pr_count NaN returns 0
// Covers EC-002: pr_count string coercion
// Covers EC-003: pr_count Infinity returns 0
// Covers EC-004: pr_count -Infinity returns 0
// Covers EC-005: mixed valid/invalid dataset sums correctly
```

The meta-test in `tests/meta/ec-traceability.test.ts` enforces that all EC-001 through EC-005 markers are present and not duplicated.

## CI Workflow

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs:

1. Install dependencies: `pnpm install --frozen-lockfile`
2. Build UI: `pnpm run build:ui`
3. Install Playwright: `npx playwright install chromium --with-deps`
4. Run test suite: `pnpm test:ci`
5. Upload artifacts: Smoke screenshots with 7-day retention
