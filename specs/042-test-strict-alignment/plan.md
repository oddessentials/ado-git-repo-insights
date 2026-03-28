# Implementation Plan: Align Test Type-Checking with Production Strictness

**Branch**: `042-test-strict-alignment` | **Date**: 2026-03-28 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/042-test-strict-alignment/spec.md`

## Summary

Remove the 4 strictness overrides from `extension/tsconfig.test.json` so test files inherit full production type-checking rules, fix the resulting 574 type errors across 33 test files, add a CI gate that enforces resolved-config parity between production and test configurations, and prove behavioral equivalence via before/after snapshot comparison.

## Technical Context

**Language/Version**: TypeScript 5.x (extension test suite)
**Primary Dependencies**: Jest 30 (test runner), ts-jest (TypeScript transformer), esbuild (UI bundler — not affected)
**Storage**: N/A (no storage changes)
**Testing**: Jest (`extension/tests/`), tsc `--noEmit` (type-check gate)
**Target Platform**: Node.js (test environment), Azure DevOps extension (production)
**Project Type**: Azure DevOps extension with metrics dashboard
**Performance Goals**: N/A (type-annotation-only changes; no runtime impact)
**Constraints**: Zero test behavior changes (proven by snapshot comparison); zero new suppression comments; fix ordering: helpers before leaf tests
**Scale/Scope**: 574 type errors across 33 files; 2,024 existing tests across 95 files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Phase 0 Gate Evaluation

| Gate | Relevance | Status |
|------|-----------|--------|
| QG-17 | Lint + format checks pass | **PASS** — no lint/format changes |
| QG-18 | Type checking passes | **AFFECTED** — this is the gate being strengthened; currently passes against `tsconfig.json` only; will be extended to cover `tsconfig.test.json` |
| QG-19 | Unit + integration tests pass | **AFFECTED** — all 2,024 tests must continue passing |
| QG-20 | Coverage threshold enforced | **PASS** — type annotations don't affect coverage |
| QG-28 | Dashboard renders 156 weeks < 1000ms | **PASS** — no runtime changes |
| QG-35 | Every CI check has a local equivalent | **AFFECTED** — new test-config type-check gate must exist in both pre-commit and CI |
| QG-36 | No CI check may exist in weaker local mode | **AFFECTED** — must be identical command in both environments |
| QG-37 | New CI check requires local gate + doc update | **AFFECTED** — resolved-config parity gate is new; requires `LOCAL_CI_PARITY_INVARIANTS.md` update |
| QG-38 | `--no-verify` forbidden | **PASS** — will not bypass hooks |

**Gate verdict**: No violations. QG-18, QG-19, QG-35, QG-36, QG-37 are affected and will be satisfied by this feature.

### Core Principles Impact

| Principle | Impact |
|-----------|--------|
| XXIII. Automated CSV Contract Validation | **None** — CSV tests unaffected |
| XXIV. End-to-End Testability | **None** — test behavior preserved |
| XXV. Backfill Mode Testing | **None** — Python tests unaffected |

No constitution violations. Proceeding to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/042-test-strict-alignment/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # N/A (no data model changes)
├── quickstart.md        # Phase 1 output
├── contracts/           # N/A (no external contracts)
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
extension/
├── tsconfig.json              # Production config (strict: true) — unchanged
├── tsconfig.test.json         # Test config — overrides removed
├── tsconfig.type-tests.json   # Type-test config — unchanged
├── jest.config.ts             # Jest config (references tsconfig.test.json) — unchanged
├── package.json               # Add build:check-tests + test:config-parity scripts
├── tests/
│   ├── setup.ts                    # Global setup — already typed
│   ├── harness/
│   │   ├── index.ts                # Barrel export — already typed
│   │   ├── dom-harness.ts          # DOM harness — already typed
│   │   └── vss-sdk-mock.ts         # VSS SDK mock — 8 errors to fix
│   ├── helpers/
│   │   └── fs-test-utils.ts        # FS utilities — already typed
│   ├── mocks/
│   │   └── ado-sdk.ts              # ADO SDK mock — 4 implicit any to fix
│   ├── python-integration/
│   │   ├── python-subprocess.ts    # Python helper — already typed
│   │   └── synthetic-fixtures.test.ts  # 19 errors
│   ├── modules/
│   │   ├── metrics.test.ts         # 196 errors (largest)
│   │   └── metrics.edge-cases.test.ts  # 34 errors
│   ├── dashboard.test.ts           # 166 errors (2nd largest)
│   ├── e2e/
│   │   └── dashboard-render.test.ts    # 16 errors
│   └── ... (remaining 24 files with < 15 errors each)
│
├── scripts/
│   └── check-test-config-parity.mjs   # NEW: resolved-config parity check
│
└── LOCAL_CI_PARITY_INVARIANTS.md       # Updated with new gate

scripts/
├── run_repo_hook.py           # Pre-commit — add tsconfig.test.json check
├── run_pr_preflight.py        # Pre-push — add tsconfig.test.json check
└── audit-suppressions.py      # Suppression audit — unchanged
```

**Structure Decision**: No new directories. Changes are within the existing `extension/` tree. One new script (`check-test-config-parity.mjs`) for resolved-config comparison.

## Complexity Tracking

No constitution violations to justify.

---

## Phase 0: Research

### Research Task 1: How tsc is currently invoked across all three environments

**Decision**: All three environments (pre-commit, pre-push, CI) use `pnpm run build:check` → `tsc --noEmit` but **only against `tsconfig.json` (production)**. `tsconfig.test.json` is never checked by an explicit tsc invocation — it's only used indirectly by ts-jest during test execution. ts-jest does NOT perform type checking; it only transpiles.

**Rationale**: This is the root parity gap. Strict errors in test files are invisible in every gate today. The existing `run_extension_typecheck()` in `run_repo_hook.py` (lines 407–424) runs `pnpm run build:check` which targets `tsconfig.json` with `"exclude": ["tests"]`. The CI step "TypeScript Type Check" (ci.yml line 828–830) does the same.

**Alternatives considered**: Relying on ts-jest to catch type errors — rejected because ts-jest's `diagnostics` option is off by default and enabling it is slower and less reliable than a standalone `tsc --noEmit`.

### Research Task 2: What the resolved-config parity check should compare

**Decision**: Create a script (`check-test-config-parity.mjs`) that uses `tsc --showConfig` to resolve both `tsconfig.json` and `tsconfig.test.json`, then compares all `compilerOptions` and fails if any non-allowlisted key differs.

**Rationale**: `extends` is shallow and any local key wins silently. `tsc --showConfig` outputs the fully resolved configuration after inheritance. Comparing resolved configs catches both explicit overrides and implicit gaps when new flags are added to production.

**Allowlisted differences** (test-specific settings that may legitimately differ):
- `noEmit` (tests don't emit)
- `declaration` (tests don't generate declarations)
- `sourceMap` (tests don't need source maps)
- `outDir` (irrelevant when noEmit is true)
- `rootDir` (may differ for test include paths)
- `include` / `exclude` (different file sets)

**Alternatives considered**: Manual flag comparison in a shell script — rejected because it would need updating every time TypeScript adds a new compilerOption. The resolved-config approach is forward-looking.

### Research Task 3: How to prove behavioral equivalence

**Decision**: Capture a before-migration snapshot consisting of: (1) Jest JSON output (`--json` flag) containing per-test pass/fail/skip status, (2) assertion count from the JSON reporter, (3) coverage summary percentages. After migration, re-run and diff the two snapshots. Any difference is a blocker.

**Rationale**: Non-null assertions (`!`) change runtime semantics — if a value is actually null, the code throws a different error. Type guards (`if (x != null)`) can alter control flow. Only a mechanical comparison of test results can prove "zero behavior change."

**Alternatives considered**: Manual review of each non-null assertion — rejected as unscalable at 470+ null/undefined errors. Snapshot comparison is automated and exhaustive.

### Research Task 4: Error categorization (mechanical vs semantic)

**Decision**: The 574 errors break down into three categories:

| Category | Error Codes | Count | Fix Strategy |
|----------|------------|------:|-------------|
| Null/undefined safety | TS2532, TS18047, TS18048, TS2531, TS18049 | 470 | Mechanical: add non-null assertions (`!`) where test logic guarantees non-null, or add guards where the value could genuinely be null |
| Implicit any | TS7006, TS7053, TS7005, TS7034 | 44 | Mechanical: add explicit parameter types, index signatures, or variable type annotations |
| Type mismatch | TS2345, TS2322, TS2769, TS2488 | 60 | **Semantic review required**: each must be inspected to determine whether the test or the production interface has the wrong contract |

**Rationale**: The 60 type-mismatch errors (TS2345: 34, TS2322: 20, TS2769: 4, TS2488: 2) cannot be fixed with a blanket `as Type` cast. They indicate the test is passing a value that doesn't match the expected interface. This could mean: (a) the mock is incomplete, (b) the test fixture is wrong, or (c) the production interface changed and the test wasn't updated.

### Research Task 5: Skipped test inventory

**Decision**: All 9 skipped tests + 1 skipped suite are **conditional skips** based on environment availability, not permanent skips:

| Location | Skip Condition | Count |
|----------|---------------|------:|
| `tests/vsix-artifact-inspection.test.ts` | VSIX artifact doesn't exist on disk | 1 suite |
| `tests/unit/chart-scalability.test.ts` | Scalability dataset not generated | 4 tests |
| `tests/python-integration/performance.test.ts` | Python subprocess not available | ~3 tests |
| `tests/python-integration/synthetic-fixtures.test.ts` | Python subprocess not available | ~2 tests |

**Rationale**: These are legitimate environment-gated skips (not broken tests), but they must still compile cleanly under strict mode. Each will be reviewed as part of the migration to confirm the skip condition is still valid.

### Research Task 6: Current suppression baseline in test files

**Decision**: 5 existing suppressions in test files (all `eslint-disable-next-line` or `ts-expect-error`). These are pre-existing and will NOT be increased. The baseline is:

| File | Count | Type |
|------|------:|------|
| `tests/dashboard.test.ts` | 1 | eslint-disable-next-line |
| `tests/helpers/fs-test-utils.ts` | 1 | eslint-disable-next-line |
| `tests/production-issues.test.ts` | 2 | eslint-disable-next-line |
| `tests/smoke/negative-fixture.smoke.ts` | 1 | eslint-disable-next-line |

**Rationale**: FR-005 requires zero **new** suppression comments. The audit-suppressions.py script and `.suppression-baseline.json` already enforce this via the `--diff` mode in CI. No `@ts-ignore` or `@ts-expect-error` will be added for strict-mode fixes.

### Research Task 7: Pre-commit trigger conditions for test files

**Decision**: The current pre-commit hook (`run_repo_hook.py` lines 218–232, 437–440) only triggers `tsc --noEmit` when staged files match UI trigger patterns. Test files (`tests/**/*.ts`) are NOT in the UI trigger list. This means after migration, a contributor could commit a type error in a test file and the pre-commit hook would not catch it.

**Rationale**: This is a parity gap that must be closed. Two changes are needed:
1. Add `tests/**/*.ts` to the pre-commit trigger conditions
2. Add a separate `tsc --noEmit --project tsconfig.test.json` invocation (or modify the existing one to also check the test config)

**Alternative considered**: Only checking at pre-push — rejected because QG-35 requires every CI gate to have a local equivalent, and the earlier the catch, the better the developer experience.

---

## Phase 1: Design

### Data Model

N/A — This feature involves no data model changes. All changes are type annotations in existing files and configuration changes.

### Contracts

N/A — This feature exposes no new external interfaces. The tsconfig changes are internal to the development toolchain.

### Implementation Design

#### Layer 1: Infrastructure (must be done first)

**1a. Resolved-config parity script** (`extension/scripts/check-test-config-parity.mjs`)

Purpose: Compare resolved `compilerOptions` between `tsconfig.json` and `tsconfig.test.json` using `tsc --showConfig`. Fail if any non-allowlisted key differs.

Behavior:
- Run `tsc --showConfig -p tsconfig.json` and `tsc --showConfig -p tsconfig.test.json`
- Parse both JSON outputs
- Compare every key in `compilerOptions`
- Allowlist: `noEmit`, `declaration`, `sourceMap`, `outDir`, `rootDir`
- If any non-allowlisted key differs → exit 1 with diff report
- If all match → exit 0

Integration points:
- `package.json`: add `"test:config-parity": "node scripts/check-test-config-parity.mjs"` script
- `run_repo_hook.py`: invoke when any `tsconfig*.json` is staged
- `run_pr_preflight.py`: add to command list
- CI (`ci.yml`): add step in `extension-tests` job before type check
- `LOCAL_CI_PARITY_INVARIANTS.md`: document new gate

**1b. Behavioral equivalence baseline capture**

Purpose: Capture pre-migration snapshot of test output for comparison.

Steps:
- Run `npx jest --json --outputFile=baseline-snapshot.json` to capture per-test results
- Run `npx jest --coverage --coverageReporters=json-summary` to capture coverage
- Store both in `specs/042-test-strict-alignment/` (not committed — for local comparison only)
- After migration, re-run and diff

Comparison criteria:
- Same number of test suites (95)
- Same number of tests (2,024)
- Same number of passes (2,015), skips (9), failures (0)
- Same per-test pass/fail/skip status (by test name)
- Coverage percentages within ±0.1% (type annotations may marginally affect branch coverage)

**1c. Test-config tsc gate**

Purpose: Add explicit `tsc --noEmit --project tsconfig.test.json` as a gate.

Integration points (identical command in all environments per QG-35/QG-36):
- `package.json`: add `"build:check-tests": "tsc --noEmit --project tsconfig.test.json"` script
- `run_repo_hook.py`: call `pnpm run build:check-tests` when test files or tsconfig files are staged
- `run_pr_preflight.py`: add `CommandSpec("Extension test type check", (PNPM_SENTINEL, "run", "build:check-tests"), cwd=EXTENSION_ROOT)`
- CI (`ci.yml`): add step `pnpm run build:check-tests` in `extension-tests` job after the production type check

#### Layer 2: Error Triage

**2a. Categorize all 574 errors**

Run strict tsc and classify each error:
- **Mechanical** (~514): TS2532, TS18047, TS18048, TS2531, TS18049 (null/undefined), TS7006, TS7053, TS7005, TS7034 (implicit any)
- **Semantic** (~60): TS2345, TS2322, TS2769, TS2488 (type mismatch)

For each semantic error, document:
- File and line
- What type is expected vs what is provided
- Whether the test, the mock, or the production interface is wrong
- Resolution: fix test, fix mock, or fix interface

Block merge if any semantic error reveals a genuine contract violation that requires production code changes (escalate to separate issue).

#### Layer 3: Fix shared helpers first (FR-008)

Fix order for shared utilities (before any leaf test files):

1. `tests/mocks/ado-sdk.ts` — 4 implicit `any` types → add explicit types for `webContext`, error callback, `runs`, `artifacts`
2. `tests/harness/vss-sdk-mock.ts` — 8 errors → fix null/undefined and type issues

After these compile clean, proceed to leaf tests.

#### Layer 4: Fix leaf test files (by error count, descending)

Fix in batches, largest files first to maximize error reduction per file:

| Batch | Files | Errors | Cumulative % |
|-------|-------|-------:|------------:|
| A | `metrics.test.ts`, `dashboard.test.ts` | 362 | 63% |
| B | `version-adapter-integration.test.ts`, `metrics.edge-cases.test.ts`, `ml.test.ts` | 96 | 80% |
| C | `synthetic-fixtures.test.ts`, `dashboard-render.test.ts`, `vsix-packaging.test.ts` | 48 | 88% |
| D | Remaining 24 files (all < 10 errors each) | 68 | 100% |

Fix patterns by error type:
- **TS2532/TS18047/TS18048/TS2531/TS18049** (null/undefined): Add `!` assertion where test logic guarantees non-null (e.g., `document.getElementById(...)!` in test setup). Add guard (`if (x == null) throw ...`) where genuineness is uncertain.
- **TS7006** (implicit any parameter): Add explicit parameter type from the function being tested.
- **TS7053** (implicit any index): Add index type assertion or type the collection.
- **TS2345/TS2322** (type mismatch): Case-by-case from triage (Layer 2).

#### Layer 5: Config change and verification

1. Remove strictness overrides from `tsconfig.test.json`:
   ```json
   {
     "extends": "./tsconfig.json",
     "compilerOptions": {
       "noEmit": true,
       "declaration": false,
       "sourceMap": false
     },
     "include": ["tests/**/*.ts", "ui/**/*.ts", "../types/vss.d.ts"],
     "exclude": ["node_modules", "dist"]
   }
   ```

2. Verify: `tsc --noEmit --project tsconfig.test.json` → 0 errors
3. Verify: `npx jest` → 2,024 tests, 2,015 pass, 9 skip, 0 fail
4. Compare behavioral equivalence snapshot (Layer 1b)
5. Verify: `node scripts/check-test-config-parity.mjs` → exit 0
6. Verify: full preflight passes (`python scripts/run_pr_preflight.py`)

#### Layer 6: Skipped test review (FR-009)

Review each conditionally-skipped test:

| File | Skip Condition | Expected Resolution |
|------|---------------|-------------------|
| `vsix-artifact-inspection.test.ts` | VSIX artifact not on disk | Legitimate conditional skip — document justification |
| `chart-scalability.test.ts` (×4) | Scalability dataset not generated | Legitimate conditional skip — document justification |
| `performance.test.ts` (~3) | Python not available | Legitimate conditional skip — document justification |
| `synthetic-fixtures.test.ts` (~2) | Python not available | Legitimate conditional skip — document justification |

All must compile cleanly under strict mode. Each receives a one-line justification comment at the skip site.

#### Layer 7: Documentation updates

1. **`LOCAL_CI_PARITY_INVARIANTS.md`**: Add two new gates:
   - Test type-check: `pnpm run build:check-tests` (pre-commit + pre-push + CI)
   - Config parity: `pnpm run test:config-parity` (pre-push + CI)

2. **`CLAUDE.md`**: No update needed (generated from feature plans)

### Post-Phase 1 Constitution Re-Check

| Gate | Status |
|------|--------|
| QG-18 | **SATISFIED** — tsc now checks both production and test configs |
| QG-19 | **SATISFIED** — behavioral equivalence proven by snapshot comparison |
| QG-35 | **SATISFIED** — new gates exist in pre-commit, pre-push, and CI |
| QG-36 | **SATISFIED** — identical `pnpm run build:check-tests` command in all environments |
| QG-37 | **SATISFIED** — `LOCAL_CI_PARITY_INVARIANTS.md` updated with new gates |
| QG-38 | **SATISFIED** — no `--no-verify` usage |

No constitution violations. Design is complete.

---

## Quickstart

See [quickstart.md](quickstart.md) for developer setup and verification instructions.
