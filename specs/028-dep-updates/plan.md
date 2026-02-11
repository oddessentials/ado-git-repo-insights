# Implementation Plan: Dependency Updates

**Branch**: `028-dep-updates` | **Date**: 2026-02-10 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/028-dep-updates/spec.md`

## Summary

Update all third-party dependencies based on the audit in NEXT_STEPS.md. Work is organized in 3 sequential batches: safe Dependabot PR merges + lockfile refresh (Batch 1), CI action upgrade (Batch 2), and breaking-change migrations for ruff, Playwright, and glob (Batch 3). No new features, no data model changes, no API changes — purely dependency version management with associated configuration and test updates.

## Technical Context

**Language/Version**: Python 3.10+ (backend), TypeScript 5.7.3 (extension)
**Primary Dependencies**: See NEXT_STEPS.md for full audit — 7 dependency updates across Python, TypeScript, and CI tooling (Dependabot PRs closed; all changes applied manually)
**Storage**: N/A (no storage changes)
**Testing**: pytest (Python), Jest 30 + Playwright (TypeScript), pre-push hook validation
**Target Platform**: Linux (CI), Windows/macOS/Linux (local development)
**Project Type**: Multi-language monorepo (Python backend + TypeScript extension)
**Performance Goals**: N/A (no performance-impacting changes)
**Constraints**: Version coupling (ts-jest@29 ↔ jest@30, Playwright exact pin, serve exact pin, ruff ↔ ruff-pre-commit lockstep)
**Scale/Scope**: 3 safe patch updates, 2 lockfile refreshes, 1 CI action bump, 3 breaking migrations

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

This feature is a dependency maintenance task. It does not modify:
- CSV schema or output (Principles I–IV) — **No impact**
- SQLite persistence or UPSERT logic (Principles V–IX, XIV) — **No impact**
- Extraction behavior or pagination (Principles X–XIII) — **No impact**
- Pipeline task runtime or PAT handling (Principles XV–XX) — **No impact**
- Storage backend (Principles XXI–XXII) — **No impact**
- Contract tests (Principle XXIII) — **No impact** (tests themselves are not changed in logic, only their runner versions)
- End-to-end testability (Principles XXIV–XXV) — **No impact**

**Quality Gate Impact**:
- QG-17 through QG-20 (lint, type check, tests, coverage): These gates MUST still pass after every batch. The ruff migration (Batch 3) will regenerate formatting but must not break lint pass. Coverage thresholds must be maintained.
- QG-22 (VSIX builds): Extension dependency updates must not break VSIX packaging.
- QG-25 through QG-29 (scalability): No scalability impact.

**Verification Requirement Impact**:
- VR-02 (lint/format): Will be directly affected by ruff 0.15.0 migration — must pass after reformatting.
- VR-03 (type checking): Must pass after any type definition changes (@types/node bump).
- VR-14 (extension packaging): Must pass after TypeScript dependency updates.

**Constitution Verdict**: PASS — No core principles are affected. All quality gates remain enforceable. Dependency updates are maintenance operations that preserve existing behavior.

## Project Structure

### Documentation (this feature)

```text
specs/028-dep-updates/
├── plan.md              # This file
├── research.md          # Phase 0: Dependency compatibility research
├── quickstart.md        # Phase 1: Merge order and execution guide
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
# Files modified per batch:

# Batch 1: Safe merges + lockfile refresh
extension/package.json                      # serve pin update
extension/pnpm-lock.yaml                    # lockfile refresh
extension/tests/meta/playwright-version-guard.test.ts  # serve version guard update
pnpm-lock.yaml                              # root lockfile refresh

# Batch 2: CI action upgrade
.github/workflows/ci.yml                    # actions/cache v4 → v5

# Batch 3a: ruff migration
pyproject.toml                              # ruff version pin
.pre-commit-config.yaml                     # ruff-pre-commit rev
.suppression-baseline.json                  # regenerated after reformat
src/**/*.py                                 # reformatted files
tests/**/*.py                               # reformatted files
scripts/**/*.py                             # reformatted files

# Batch 3b: Playwright migration
extension/package.json                      # @playwright/test pin
extension/pnpm-lock.yaml                    # lockfile update

# Batch 3c: glob migration
extension/package.json                      # glob version
extension/pnpm-lock.yaml                    # lockfile update
# Potentially: test files that import glob
```

**Structure Decision**: No new directories or files beyond spec artifacts. All changes are version bumps in existing configuration files, with reformatting of existing source files in Batch 3a.

## Complexity Tracking

No constitution violations. No complexity justifications needed.

## Implementation Phases

### Batch 1: Safe Patch Updates + Lockfile Refresh (P1)

**Estimated scope**: 3 patch-level updates + 2 lockfile refreshes

| Step | Action | Validation |
|------|--------|------------|
| 1.1 | Update dependency-cruiser 17.3.7 → 17.3.8 in `extension/package.json` | CI green |
| 1.2 | Update serve 14.2.0 → 14.2.5 in `extension/package.json` + version guard test | CI green + smoke tests pass |
| 1.3 | Update @types/node 25.1.0 → 25.2.2 in `extension/package.json` | CI green + type check pass |
| 1.4 | Run `pnpm update` in extension/ — picks up typescript-eslint, esbuild in-range bumps | `pnpm test:ci` passes |
| 1.5 | Run `pnpm update` in root/ — picks up semantic-release, @semantic-release/github | Release toolchain functional |

**Risk**: Minimal. All are patch-level or in-range updates.
**Rollback**: Revert the commit.

### Batch 2: CI Action Upgrade (P2)

**Estimated scope**: 1 workflow file change

| Step | Action | Validation |
|------|--------|------------|
| 2.1 | Verify GitHub-hosted runner version meets minimum (2.327.1) | Check runner logs from recent CI run |
| 2.2 | Update `actions/cache@v4` → `actions/cache@v5` in ci.yml | All CI jobs with caching pass |

**Risk**: Low. GitHub-hosted runners should already support v5.
**Rollback**: Revert workflow change.

### Batch 3a: Ruff 0.15.0 Migration (P3)

**Estimated scope**: 2 config files + all Python source files reformatted + baseline regeneration

| Step | Action | Validation |
|------|--------|------------|
| 3a.1 | Update `ruff==0.15.0` in pyproject.toml | pip install succeeds |
| 3a.2 | Update `.pre-commit-config.yaml` rev to `v0.15.0` | CI version parity check passes |
| 3a.3 | Run `ruff format .` to reformat entire codebase | No errors |
| 3a.4 | Run `ruff check .` to identify new violations from stabilized rules (B912 etc.) | Fix or suppress with justification |
| 3a.5 | Run `mypy src/` to verify type checking still passes | Zero errors |
| 3a.6 | Run `pytest tests/` to verify all tests pass | All tests pass, coverage threshold met |
| 3a.7 | Regenerate `.suppression-baseline.json` | Baseline reflects new line numbers |
| 3a.8 | Run `pre-commit run --all-files` | All hooks pass |

**Risk**: Medium. Formatting changes are cosmetic but touch many files. Stabilized rule B912 may surface new violations.
**Rollback**: Revert the commit (single atomic commit for all reformat changes).

### Batch 3b: Playwright 1.58.2 Migration (P3)

**Estimated scope**: 1 package.json pin + lockfile + browser binary download

| Step | Action | Validation |
|------|--------|------------|
| 3b.1 | Update `@playwright/test` pin from `1.50.0` to `1.58.2` in extension/package.json | pnpm install succeeds, chromium downloads |
| 3b.2 | Run `pnpm test:smoke` to verify all smoke tests pass | All smoke tests green |
| 3b.3 | Run `pnpm test:ci` to verify full test suite passes | All tests pass |
| 3b.4 | Verify version guard test passes with new exact version | playwright-version-guard.test.ts passes |

**Risk**: Medium. 8 minor versions may change browser behavior. Smoke tests may need selector/timing adjustments.
**Rollback**: Revert pin change, re-run `pnpm install` to restore old browser binary.

### Batch 3c: glob v13 Migration (P3)

**Estimated scope**: 1 package.json change + lockfile + potential test file updates

| Step | Action | Validation |
|------|--------|------------|
| 3c.1 | Audit all files importing or using `glob` | Document usage sites |
| 3c.2 | Update `glob` version in extension/package.json | pnpm install succeeds |
| 3c.3 | Fix any breaking API usage identified in audit | Tests compile |
| 3c.4 | Run `pnpm test:ci` to verify full test suite passes | All tests pass |
| 3c.5 | Verify no build scripts depend on glob CLI | Build pipeline succeeds |

**Risk**: Medium-High. 3 major versions may break API usage. Node <20 support dropped (not a concern since we require Node 22).
**Rollback**: Revert version change.

## Dependencies Between Batches

```
Batch 1 (P1) ──→ Batch 2 (P2) ──→ Batch 3a (P3)
                                  ──→ Batch 3b (P3)
                                  ──→ Batch 3c (P3)
```

Batch 3a/3b/3c are independent of each other but all depend on Batches 1 and 2 being complete (clean main branch baseline).
