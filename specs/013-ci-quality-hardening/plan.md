# Implementation Plan: CI Quality Gate Hardening

**Branch**: `013-ci-quality-hardening` | **Date**: 2026-01-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/013-ci-quality-hardening/spec.md`

## Summary

Harden CI quality gates to enforce enterprise-grade type safety and suppression governance. The core gaps are:
1. **Mypy not enforced** - configured in pyproject.toml but not run in CI or pre-push
2. **No non-null assertion rule** - `@typescript-eslint/no-non-null-assertion` not configured
3. **No suppression auditing** - 34+ eslint-disable comments exist with no CI tracking or growth prevention

This plan adds mypy enforcement (pre-push + CI), the non-null assertion ESLint rule, and a suppression audit system that blocks PRs increasing suppression count without explicit acknowledgment.

## Technical Context

**Language/Version**: Python 3.11 (CI), Python 3.10+ (local), TypeScript 5.7.3 (extension)
**Primary Dependencies**: mypy (Python), typescript-eslint 8.53.1 (TypeScript), eslint 9.18.0, pre-commit
**Storage**: N/A (CI configuration + scripts only)
**Testing**: pytest (Python), Jest 30.0.0 (TypeScript)
**Target Platform**: GitHub Actions CI, local development (husky hooks)
**Project Type**: Monorepo (Python backend + TypeScript extension)
**Performance Goals**: Pre-push hook completes in <60 seconds total, mypy portion <30 seconds
**Constraints**: Must work on both Windows (Git Bash) and Linux (CI runners)
**Scale/Scope**: ~34 block-level eslint-disable comments, ~437 total suppression comments across all types (eslint-disable-*, ts-ignore, type: ignore, noqa)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Relevance | Compliance |
|-----------|-----------|------------|
| XVIII. Actionable Failure Logs | HIGH | COMPLIANT - FR-019 requires hooks print exact commands + "how to fix" hints |
| XXIII. Automated CSV Contract Validation | LOW | N/A - This feature doesn't modify CSV contracts |
| QG-17: Lint + format checks pass | HIGH | COMPLIANT - Feature strengthens lint enforcement |
| QG-18: Type checking passes | HIGH | **TARGET** - This feature implements mypy enforcement |
| VR-02: Lint/format | HIGH | COMPLIANT - ESLint rule addition strengthens this |
| VR-03: Type checking | HIGH | **TARGET** - This feature makes mypy a CI gate |

**Pre-Phase 0 Status**: ✅ PASS - Feature directly implements constitution requirements (QG-18, VR-03)

## Project Structure

### Documentation (this feature)

```text
specs/013-ci-quality-hardening/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (suppression baseline schema)
├── quickstart.md        # Phase 1 output
├── contracts/           # N/A - no API contracts for this feature
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
# Existing files to modify:
.github/workflows/ci.yml           # Add mypy job, add suppression audit job
.husky/pre-push                    # Add mypy execution
extension/eslint.config.mjs        # Add no-non-null-assertion rule

# New files to create:
scripts/audit-suppressions.py      # Suppression counting + diff script
.suppression-baseline.json         # Baseline suppression counts (committed)
```

**Structure Decision**: This feature modifies existing CI/hook infrastructure. No new source directories needed. New suppression audit script goes in `scripts/` alongside existing `env_guard.py`.

## Complexity Tracking

> No complexity violations. This feature adds minimal new code (one script, config changes).

| Addition | Justification |
|----------|---------------|
| `audit-suppressions.py` script | Required for FR-008 through FR-012 suppression tracking |
| `.suppression-baseline.json` | Required for FR-009 diff computation against main branch |

---

## Post-Design Constitution Check

*Re-evaluated after Phase 1 design completion.*

| Principle | Compliance | Evidence |
|-----------|------------|----------|
| XVIII. Actionable Failure Logs | ✅ COMPLIANT | quickstart.md documents exact error messages and fix instructions |
| QG-17: Lint + format checks pass | ✅ COMPLIANT | ESLint rule strengthens lint gate |
| QG-18: Type checking passes | ✅ WILL BE COMPLIANT | Plan adds mypy to CI workflow |
| VR-02: Lint/format | ✅ COMPLIANT | No changes to lint behavior, only additions |
| VR-03: Type checking | ✅ WILL BE COMPLIANT | Plan adds mypy enforcement to pre-push and CI |

**Post-Phase 1 Status**: ✅ PASS - All constitution checks satisfied or will be satisfied by implementation

---

## Implementation Phases

### Phase 1: Type Checking Enforcement (FR-001 to FR-004, FR-016)

**Immutable Invariant**: Pre-push MUST run both type checkers and fail non-zero on either:
- `mypy src/` for Python type errors
- `pnpm typecheck` (or `tsc --noEmit`) for TypeScript type errors

**Note**: `tsc` already exists in pre-push and MUST be preserved as an invariant, not an implementation detail.

Tasks:
1. Add mypy to `.husky/pre-push` (after pre-commit, before pytest) - preserving existing tsc
2. Add `mypy` job to `.github/workflows/ci.yml`
3. Verify both mypy and tsc pass with current codebase

### Phase 2: Non-Null Assertion Rule (FR-005 to FR-007)

1. Audit existing non-null assertions in `extension/ui/`
2. Fix or justify all existing violations
3. Add `@typescript-eslint/no-non-null-assertion: 'error'` to eslint.config.mjs

### Phase 3: Suppression Auditing (FR-008 to FR-012, FR-017, FR-020, FR-021)

**Scope**: `src/`, `extension/ui/`, `extension/tests/`
**Forms counted**: `eslint-disable`, `eslint-disable-next-line`, `eslint-disable-line`, `ts-ignore`, `ts-expect-error`, `type-ignore`, `noqa`

**Determinism**: Baseline stable-sorted by scope (ASC), rule (ASC), kind (ASC). Cross-OS identical output via path normalization.

**Acknowledgment**: Marker `SUPPRESSION-INCREASE-APPROVED` in PR body. Direct pushes fail on any increase.

Tasks:
1. Create `scripts/audit-suppressions.py` with deterministic output
2. Generate initial `.suppression-baseline.json` (sorted, normalized)
3. Add `suppression-audit` job to CI workflow (fails on delta > 0 unless marker present)
4. Add suppression format validation to pre-commit (**required**, not optional per FR-017)
5. Add baseline format/ordering validation to audit script (FR-020)

### Phase 4: Documentation and Testing

1. Update pre-push hook with actionable error messages (FR-019)
2. Test all scenarios from quickstart.md
3. Verify CI passes on clean branch

---

## Generated Artifacts

| Artifact | Path | Status |
|----------|------|--------|
| Research | `specs/013-ci-quality-hardening/research.md` | ✅ Complete |
| Data Model | `specs/013-ci-quality-hardening/data-model.md` | ✅ Complete |
| Quickstart | `specs/013-ci-quality-hardening/quickstart.md` | ✅ Complete |
| Contracts | N/A | Not applicable (no APIs) |

---

## Next Steps

Run `/speckit.tasks` to generate the task breakdown for implementation.
