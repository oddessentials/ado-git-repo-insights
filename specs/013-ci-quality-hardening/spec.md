# Feature Specification: CI Quality Gate Hardening

**Feature Branch**: `013-ci-quality-hardening`
**Created**: 2026-01-29
**Status**: Draft
**Input**: User description: "Harden CI quality gates to enforce enterprise-grade type safety, test coverage, and code quality standards. Prevent drift by adding stricter checks for mypy errors, non-null assertions, type ignore comments, and test coverage thresholds."

## Problem Statement

The repository has comprehensive CI/CD infrastructure but critical gaps allow quality issues to drift undetected:

| Gap | Impact | Evidence |
|-----|--------|----------|
| Mypy not running in CI | Type errors can merge to main | 5 mypy errors existed undetected |
| No non-null assertion rule | Unsafe `!` assertions proliferate | Multiple `!` assertions found in production code |
| No suppression tracking | Suppression comments accumulate | 437 total suppressions (all types) with no audit trail |
| Manual coverage ratchet | Thresholds drift without enforcement | Coverage plan documented but not automated |

**Root Cause**: Quality gates validate code but don't prevent erosion of standards over time.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Type Safety Enforcement (Priority: P1)

A developer pushes Python code with a type error. The CI pipeline catches the error and blocks the merge, providing clear feedback on what needs to be fixed.

**Why this priority**: Type errors in production code can cause runtime failures. This is the most critical gap identified - mypy is configured but not running in CI.

**Independent Test**: Push a commit with a deliberate mypy error (e.g., returning `str` from a function declared to return `int`). CI must fail with a clear error message.

**Acceptance Scenarios**:

1. **Given** a PR with Python type errors, **When** CI runs, **Then** the pipeline fails with mypy error output showing file, line, and error description
2. **Given** a PR with valid Python types, **When** CI runs, **Then** mypy passes and does not block the build
3. **Given** mypy runs in CI, **When** optional dependencies (prophet, openai) are not installed, **Then** mypy still passes using configured `ignore_missing_imports` overrides

---

### User Story 2 - Non-Null Assertion Prevention (Priority: P1)

A developer adds TypeScript code using non-null assertions (`value!`). ESLint flags this as an error, requiring the developer to add a proper null check or document why the assertion is safe.

**Why this priority**: Non-null assertions bypass TypeScript's safety checks and can cause runtime errors if assumptions are wrong.

**Independent Test**: Add a file with `const x = obj.value!;` and run ESLint. It must fail with `@typescript-eslint/no-non-null-assertion` error.

**Acceptance Scenarios**:

1. **Given** TypeScript code with a non-null assertion, **When** ESLint runs, **Then** the build fails with a clear error identifying the assertion location
2. **Given** a justified exception exists, **When** developer adds `// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- REASON: <justification>`, **Then** ESLint passes and the exception is tracked
3. **Given** existing code has non-null assertions, **When** this rule is enabled, **Then** a baseline of existing violations is established and new violations are blocked

---

### User Story 3 - Suppression Comment Auditing (Priority: P2)

A code reviewer wants to understand how many lint/type suppressions exist in the codebase and whether new suppressions are being added without justification.

**Why this priority**: Suppression comments are technical debt. Without tracking, they accumulate silently and erode code quality standards.

**Independent Test**: Run the suppression audit script and verify it reports accurate counts by category (eslint-disable, type: ignore, noqa).

**Acceptance Scenarios**:

1. **Given** the codebase has suppression comments, **When** CI runs, **Then** a summary is logged showing counts by suppression type
2. **Given** a PR adds new suppression comments, **When** CI compares to baseline, **Then** new suppressions are flagged in the PR check output
3. **Given** a suppression lacks a justification tag, **When** CI runs, **Then** the suppression is flagged as requiring justification

---

### User Story 4 - Coverage Ratchet Enforcement (Priority: P2)

A developer submits code that reduces test coverage below the documented threshold. CI blocks the merge and explains which threshold was violated.

**Why this priority**: The project has a coverage ratchet plan (COVERAGE_RATCHET.md) but enforcement is manual. Automation prevents regression.

**Independent Test**: Modify jest.config.ts to have thresholds higher than current coverage. CI must fail with coverage threshold error.

**Acceptance Scenarios**:

1. **Given** coverage thresholds are defined, **When** a PR reduces coverage below threshold, **Then** CI fails with clear message showing actual vs required coverage
2. **Given** a module is in Tier 2 (critical paths), **When** PR reduces that module's coverage, **Then** CI fails even if global coverage is acceptable
3. **Given** coverage ratchet schedule exists, **When** scheduled threshold increase date passes, **Then** CI enforces the new higher threshold

---

### User Story 5 - Python Suppression Standardization (Priority: P3)

Python code uses `# type: ignore` or `# noqa` comments. These suppressions must include a justification tag following the same pattern as TypeScript suppressions.

**Why this priority**: Consistency across languages and preventing unjustified suppressions in Python code.

**Independent Test**: Add `# type: ignore` without justification. Pre-commit hook must fail requiring `# type: ignore[error-code] -- REASON: <justification>`.

**Acceptance Scenarios**:

1. **Given** a Python file has `# type: ignore` without justification, **When** pre-commit runs, **Then** hook fails with message requiring justification tag
2. **Given** a justified `# type: ignore[arg-type] -- REASON: numpy stub limitation`, **When** pre-commit runs, **Then** hook passes
3. **Given** existing unjustified suppressions, **When** rule is enabled, **Then** existing violations are baselined and only new violations are blocked

---

### Edge Cases

- What happens when mypy has different behavior across Python versions (3.10 vs 3.11 vs 3.12)?
- How does the system handle suppressions in generated code or third-party type stubs?
- What if a developer needs to add many suppressions for a legitimate refactoring?
- How are false positives from security rules handled without undermining the audit trail?

## Requirements *(mandatory)*

### Functional Requirements

#### Mypy Enforcement
- **FR-001**: CI MUST run mypy on all Python source files in `src/ado_git_repo_insights/`
- **FR-002**: CI MUST fail if mypy reports any errors (exit code != 0)
- **FR-003**: Mypy MUST run with `--strict` mode matching pyproject.toml configuration
- **FR-004**: Mypy MUST handle optional dependencies (prophet, openai, azure.storage.blob) via configured overrides

#### Non-Null Assertion Rule
- **FR-005**: ESLint MUST enforce `@typescript-eslint/no-non-null-assertion` as error
- **FR-006**: Existing non-null assertions MUST be fixed or documented with justification before rule is enabled
- **FR-007**: Justification format MUST follow pattern: `// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- REASON: <explanation>`

#### Suppression Auditing

**Scope Definition** (directories scanned):
- `src/` — Python backend
- `extension/ui/` — TypeScript extension source
- `extension/tests/` — TypeScript tests

**Suppression Forms Counted**:
| Kind | Pattern | Language |
|------|---------|----------|
| `eslint-disable` | `/* eslint-disable */` (block) | TypeScript |
| `eslint-disable-next-line` | `// eslint-disable-next-line` | TypeScript |
| `eslint-disable-line` | `// eslint-disable-line` | TypeScript |
| `ts-ignore` | `// @ts-ignore` | TypeScript |
| `ts-expect-error` | `// @ts-expect-error` | TypeScript |
| `type-ignore` | `# type: ignore` | Python |
| `noqa` | `# noqa` | Python |

**Note**: Both `ts-ignore` and `ts-expect-error` ARE included and counted.

- **FR-008**: CI MUST count all suppression comments in the scopes and forms defined above
- **FR-009**: CI MUST compute suppression count diff vs `main` branch
- **FR-010**: If suppression delta > 0, CI MUST fail UNLESS acknowledgment marker is present:
  - **Source of truth**: PR body contains exact string `SUPPRESSION-INCREASE-APPROVED`
  - **Non-PR events**: Direct pushes to main MUST fail on any suppression increase (no override)
- **FR-011**: CI failure message MUST include: previous count, new count, delta, and copy-pastable instruction: "Add `SUPPRESSION-INCREASE-APPROVED` to PR description to proceed."
- **FR-012**: All new suppressions MUST include a justification tag matching pattern `-- REASON: <explanation>` or `-- SECURITY: <explanation>`

#### Coverage Ratchet
- **FR-013**: Jest coverage thresholds MUST be enforced in CI (already implemented)
- **FR-014**: Pytest coverage threshold MUST be enforced in CI (already implemented at 70%)
- **FR-015**: A mechanism SHOULD exist to automatically increase thresholds per the ratchet schedule

#### Pre-commit/Pre-push Integration (Immutable Invariants)
- **FR-016**: Pre-push hook MUST run both type checkers and MUST fail with non-zero exit code on any type errors:
  - Pre-push MUST run `pnpm typecheck` (or `tsc --noEmit`) and MUST fail non-zero on any TypeScript type errors
  - Pre-push MUST run `mypy` and MUST fail non-zero on any Python type errors
  - Hook MUST print the exact commands executed
  - **Invariant**: `tsc` already exists in pre-push and MUST be preserved as an invariant, not an implementation detail
- **FR-017**: Pre-commit hook MUST run suppression format validation and MUST fail with non-zero exit code if format is invalid. This is **required**, not optional. Malformed or non-standard suppression comments MUST block the commit.
- **FR-018**: Both hooks MUST be runnable directly via scripts (e.g., `pnpm hooks:precommit`, `pnpm hooks:prepush`) so CI can reuse them
- **FR-019**: Hook output MUST print the exact command invoked and a short "how to fix" hint on failure (actionable logs)

#### Implementation Guardrails
- **FR-020**: The suppression audit script MUST fail CI if baseline format, ordering, or scope rules are violated
- **FR-021**: Any change to suppression counting logic MUST require regenerating and committing the baseline

### Key Entities

- **Suppression Baseline**: JSON file tracking current counts of suppression comments. MUST be stable-sorted by: `scope` (ASC), `rule` (ASC), `kind` (ASC). Output MUST be identical across OSes (path normalization required: forward slashes, relative paths).
- **Suppression Audit Report**: CI output showing suppression statistics and any new/unjustified suppressions
- **Coverage Ratchet Schedule**: Documented thresholds with target dates (exists in COVERAGE_RATCHET.md)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero mypy errors can merge to main branch (enforced by CI failure)
- **SC-002**: Zero new non-null assertions without justification can merge (enforced by ESLint)
- **SC-003**: All new suppression comments include justification tags (validated by CI audit)
- **SC-004**: Suppression count does not increase without explicit acknowledgment in PR
- **SC-005**: Test coverage thresholds cannot regress (enforced by existing CI gates)
- **SC-006**: Pre-push hook catches Python type errors locally before CI runs (developer feedback loop under 30 seconds for mypy)
- **SC-007**: Pre-push hook catches TypeScript type errors locally before CI runs (tsc --noEmit)

### Quality Gate Summary

| Gate | Tool | Enforcement | New with this spec |
|------|------|-------------|-------------------|
| Python type safety | mypy | CI fail + pre-push fail on error | **YES** |
| TypeScript type safety | tsc --noEmit | CI fail + pre-push fail on error | **YES** |
| Non-null assertions | ESLint | CI fail on violation | **YES** |
| Suppression audit | Custom script | CI fail on increase (unless acknowledged) | **YES** |
| Suppression justification | Custom script | CI warn on missing tag | **YES** |
| Python coverage | pytest-cov | CI fail under 70% | Existing |
| TypeScript coverage | Jest | CI fail under threshold | Existing |

## Clarifications

### Session 2026-01-29

- Q: What is the enforcement model for local hooks (pre-commit vs pre-push)? → A: Option A - Pre-push for mypy (type checking), Pre-commit for suppression format validation. Mypy ~30s is appropriate for "before it leaves your machine" gate; suppression formatting is cheap and should block at commit-time.
- Q: What is the CI suppression audit enforcement level? → A: Option B - CI MUST fail on suppression count increase unless PR/commit contains explicit marker `SUPPRESSION-INCREASE-APPROVED`. Preserves velocity while making suppression growth intentional and review-visible.
- Q: Should TypeScript type checking also be enforced in pre-push? → A: Option A - Pre-push MUST run both `pnpm typecheck` (tsc --noEmit) for TypeScript AND `mypy` for Python. Both are immutable invariants. Hook prints exact commands executed. Acceptance: TS type error blocks push, Python type error blocks push, `pnpm hooks:prepush` reproduces same failures.
- Q: What scopes does suppression audit cover? → A: Three explicit scopes: `src/` (Python backend), `extension/ui/` (TypeScript extension), `extension/tests/` (TypeScript tests). Excludes node_modules, dist, .venv, build, coverage, vendored files.
- Q: What suppression types are detected? → A: Seven types: `eslint-disable-next-line`, `eslint-disable-line`, `eslint-disable-block`, `ts-ignore`, `ts-expect-error`, `type-ignore`, `noqa`.
- Q: How is baseline determinism ensured? → A: Keys sorted alphabetically, forward-slash paths, ISO 8601 UTC timestamps, 2-space indentation, idempotent regeneration (byte-for-byte identical on re-run).
- Q: What Python version for CI vs local? → A: CI pins Python 3.11 for consistency. Local development allows Python 3.10+ (mypy config targets 3.10 minimum).
- Q: Is suppression format validation required or optional? → A: Required. Pre-commit MUST block malformed/non-standard suppressions.
- Q: What happens on non-PR events (direct push)? → A: Direct pushes to main MUST fail on any suppression increase with no override mechanism.
- Q: Are ts-ignore and ts-expect-error both included? → A: Yes, both are included and counted as suppression types.
- Q: What are the baseline determinism sort keys? → A: Stable-sorted by scope (ASC), rule (ASC), kind (ASC). Cross-OS identical output via path normalization.
- Q: What happens if baseline format/ordering is violated? → A: Suppression audit script MUST fail CI. Any counting logic change requires baseline regeneration.

## Assumptions

- The existing ESLint configuration in `extension/eslint.config.mjs` can be extended without breaking current checks
- The `pyproject.toml` mypy configuration is correct and should be mirrored in CI
- Developers have access to run pre-commit and pre-push hooks locally
- The 437 existing eslint-disable suppressions can be audited and baselined without requiring immediate fixes
- Mypy can run in CI without installing optional [ml] dependencies by using existing `ignore_missing_imports` overrides

## Out of Scope

- Automatic fixing of existing type errors or suppressions (cleanup is separate work)
- Changes to coverage threshold percentages (ratchet schedule already documented)
- Integration test coverage tracking (separate enhancement)
- Suppression expiration/review mechanism (future enhancement)
- Dashboard for suppression metrics visualization (future enhancement)

## Dependencies

- GitHub Actions runner must have Python 3.11 (pinned for CI consistency) and Node.js 22+
- Local development requires Python 3.10+ (mypy config targets 3.10 minimum)
- Existing `.github/workflows/ci.yml` must be modified
- Existing `.husky/pre-push` must be modified
- New suppression baseline file must be committed

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Mypy fails on edge cases not caught locally | Medium | Medium | Run mypy on all Python versions in CI matrix |
| Non-null assertion rule has many existing violations | High | Low | Baseline existing violations, fix incrementally |
| Suppression audit causes CI noise on PRs | Medium | Low | Start with warnings, not failures |
| Pre-push hook slows developer workflow | Low | Medium | Optimize mypy incremental mode |
