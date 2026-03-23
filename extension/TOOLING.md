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
- Determinism guard meta-tests (`tests/meta/`)

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

**Test files**:

- `tests/smoke/filter-display.smoke.ts` - Positive tests with valid fixtures
- `tests/smoke/negative-fixture.smoke.ts` - Negative tests with malformed fixtures

**Artifacts**:

- `test-artifacts/smoke/chromium/` - Positive test screenshots
- `test-artifacts/smoke/chromium-negative/` - Negative test screenshots

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

## Determinism Guard Meta-Tests

Meta-tests in `tests/meta/` enforce code quality contracts that prevent flaky tests:

| Meta-Test                          | Contract                                 | Purpose                                   |
| ---------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `smoke-determinism-guard.test.ts`  | WPC-001, WPC-002, TC-002, AC-001, CQ-001 | Scans smoke tests for forbidden patterns  |
| `playwright-version-guard.test.ts` | DC-001                                   | Enforces exact Playwright version pinning |
| `no-runtime-type-imports.test.ts`  | CQ-003                                   | Prevents ui/ from importing tests/types/  |
| `type-test-header-guard.test.ts`   | CQ-002                                   | Enforces COMPILE-TIME ONLY header         |

### Contracts Enforced

- **WPC-001**: No `waitForTimeout()` in smoke tests (use condition-based waits)
- **WPC-002**: No `networkidle` waits (use explicit DOM state assertions)
- **TC-002**: No timeout literals (use `SMOKE_TIMEOUT_MS` constant)
- **AC-001**: All screenshots must use `testInfo.outputPath()`
- **CQ-001**: No custom `deepClone` implementations (use `structuredClone()`)
- **CQ-002**: Type-test files must have COMPILE-TIME ONLY header
- **CQ-003**: Runtime code must not import from tests/types/
- **DC-001**: Playwright version must be exactly pinned

## Playwright Version Policy

### Pinning Requirements

The `@playwright/test` dependency MUST be exactly pinned (no `^` or `~` prefix).

**Current version**: 1.40.0

**Contract**: CI meta-test `tests/meta/playwright-version-guard.test.ts` enforces exact pinning.

### Upgrade Cadence

- **Quarterly review**: Check for new Playwright releases at the start of each quarter (Q1, Q2, Q3, Q4)
- **Security patches**: Check monthly for security advisories; patch immediately if critical
- **Major upgrades**: Require explicit testing and documentation

### PR Checklist for Playwright Upgrades

When upgrading Playwright version, include in the PR:

- [ ] Update `@playwright/test` version in `package.json` (exact pin, no `^` or `~`)
- [ ] Run `npx playwright install chromium` locally to download matching browser binaries
- [ ] Verify all smoke tests pass locally (`pnpm run test:smoke`)
- [ ] Run full CI suite 3 times to verify determinism
- [ ] Document any breaking changes or API migrations in PR description
- [ ] Update this TOOLING.md with new version number

### Browser Installation

Playwright browsers are installed via `npx playwright install chromium --with-deps` in CI.
This downloads browser binaries matching the pinned Playwright version.

**Note**: The `npx playwright install` command is a CI setup step (downloading binaries),
not a runtime tool invocation. This is acceptable per FR-013.

## CI Workflow

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs:

1. Install dependencies: `pnpm install --frozen-lockfile`
2. Build UI: `pnpm run build:ui`
3. Install Playwright: `npx playwright install chromium --with-deps`
4. Run test suite: `pnpm test:ci`
5. Upload artifacts: Smoke screenshots with 7-day retention
