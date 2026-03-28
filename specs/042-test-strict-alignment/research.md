# Research: Align Test Type-Checking with Production Strictness

**Feature Branch**: `042-test-strict-alignment`
**Date**: 2026-03-28

## R1: tsc invocation across environments

**Decision**: All three environments (pre-commit, pre-push, CI) use `pnpm run build:check` → `tsc --noEmit` against `tsconfig.json` only. `tsconfig.test.json` is never checked by an explicit tsc invocation — it's only used by ts-jest during test execution, which does NOT perform type checking.

**Rationale**: This is the root parity gap. The existing `run_extension_typecheck()` in `run_repo_hook.py` (lines 407–424) and the CI step "TypeScript Type Check" (ci.yml line 828–830) both target `tsconfig.json` which excludes the `tests/` directory. A new, separate `tsc --noEmit --project tsconfig.test.json` gate must be added to all three environments.

**Alternatives considered**:
- Enabling ts-jest diagnostics: Rejected — slower, less reliable, and not equivalent to a standalone tsc invocation
- Merging test files into the production tsconfig include: Rejected — production config should not include test files

## R2: Resolved-config parity mechanism

**Decision**: Use `tsc --showConfig` to resolve both configs and compare all `compilerOptions`, failing on non-allowlisted differences.

**Rationale**: `extends` is shallow merge — any local key wins silently. `tsc --showConfig` outputs the fully resolved configuration after inheritance. This is forward-looking: new TypeScript flags added in future versions are automatically covered because only allowlisted deviations are permitted.

**Allowlist**: `noEmit`, `declaration`, `sourceMap`, `outDir`, `rootDir` (legitimate test-specific differences).

**Alternatives considered**:
- Manual flag comparison in shell: Rejected — requires updating when TypeScript adds new flags
- Relying on `extends` keyword trust: Rejected — the whole point of FR-001 is that `extends` is insufficient

## R3: Behavioral equivalence proof

**Decision**: Capture before/after Jest JSON output (`--json`) and coverage summary. Diff per-test pass/fail/skip status and coverage percentages.

**Rationale**: Non-null assertions (`!`) change runtime semantics — if a value is actually null at runtime, the code throws a different error or silently proceeds. Type guards can alter control flow. Only a mechanical comparison of test results can prove "zero behavior change."

**Alternatives considered**:
- Manual review of each assertion: Rejected — unscalable at 470+ null/undefined errors
- Coverage-only comparison: Rejected — same coverage can hide different execution paths

## R4: Error categorization

**Decision**: 574 errors categorized as mechanical (~514) or semantic (~60).

**Breakdown**:

| Category | Codes | Count | Strategy |
|----------|-------|------:|----------|
| Null/undefined safety | TS2532, TS18047, TS18048, TS2531, TS18049 | 470 | Mechanical fix |
| Implicit any | TS7006, TS7053, TS7005, TS7034 | 44 | Mechanical fix |
| Type mismatch | TS2345, TS2322, TS2769, TS2488 | 60 | Semantic review |

**Rationale**: The 60 type-mismatch errors indicate a test passing a value that doesn't match the expected interface. These cannot be blindly cast — each must be reviewed to determine root cause (bad mock, outdated test fixture, or changed production interface).

**Alternatives considered**:
- Treating all errors as mechanical: Rejected — per FR-006 tightening, this risks masking real contract violations

## R5: Skipped test inventory

**Decision**: All 9 skipped tests + 1 skipped suite are conditional skips based on environment availability (VSIX artifact, Python subprocess, scalability dataset). All are legitimate and will be documented.

**Rationale**: These are not broken tests. The skip conditions are runtime environment checks that correctly gate tests requiring specific tooling. Each must compile under strict mode and receive an explicit justification.

## R6: Current suppression baseline

**Decision**: 5 existing suppressions in test files (all `eslint-disable-next-line`). Zero new suppressions will be added. Enforced by `audit-suppressions.py --diff` in CI.

**Rationale**: The existing suppression audit infrastructure and `.suppression-baseline.json` already prevent suppression increases. FR-005 requires a hard zero on new additions.

## R7: Pre-commit trigger gap

**Decision**: Test files (`tests/**/*.ts`) are not in the current pre-commit UI trigger list. Must be added to close the QG-35 parity gap.

**Rationale**: The current pre-commit hook only triggers tsc when UI source files are staged (lines 218–232 of `run_repo_hook.py`). After migration, test files must also trigger the type-check gate. Without this, contributors could commit type errors in tests that pass pre-commit but fail in CI.

---

All NEEDS CLARIFICATION items resolved. No blockers for Phase 1 design.
