<!--
  =============================================================================
  SYNC IMPACT REPORT
  =============================================================================
  Version Change: 1.4.0 → 1.5.0 (collection stability + test discipline +
  entry point alignment + bypass marker discipline + build architecture +
  security scan parity)

  Modified Principles:
  - Added Principle XXVI (Collection-Stable Test Definitions) — mirrors the
    new invariant #26 added to agents/INVARIANTS.md; Core Principles count
    updated from 25 to 26

  Added Sections:
  - Test Discipline Gates (QG-43 through QG-46)
  - Entry Point Alignment Gates (QG-47 through QG-49)
  - Change Acknowledgement Gates (QG-50 through QG-52)
  - Build Architecture Gates (QG-53 through QG-55)
  - Security Scan Gates (QG-56)
  - Local/CI Parity Verification (VR-28 through VR-30)

  Updated Items:
  - QG-05 wording refined to match agents/definition-of-done.md §1.3
    (dynamic fixtures, no committed fixture files)
  - VR-03 mypy scope expanded from `mypy src/` to
    `mypy src/ tests/ scripts/ .github/scripts/` (matches preflight and
    LOCAL_CI_PARITY_INVARIANTS.md Row 10)
  - VR-02a added for extension Prettier `format:check`

  Rationale:
  The architecture documented in LOCAL_CI_PARITY_INVARIANTS.md has matured
  substantially since v1.3.0 introduced QG-35 through QG-38. The invariants
  now codified at constitution level are:
  - Test floor discipline is per-commit, first-parent, subject-line-gated
  - `.test-floor-contract.json` is the single source of truth for both
    Python and Extension `--min-collected` floors (no hardcoded integers)
  - Cross-OS Python collection parity is CI-enforced via the
    `python-collection-parity` job
  - Platform-conditional tests use file-name-pattern exclusion with a
    shared `PLATFORM_CONDITIONAL_IGNORE_GLOBS` constant (never
    `pytest.mark.skip`)
  - Pre-commit trigger scope must match or exceed gate compilation scope
  - Worktree-reading pre-commit gates require clean-worktree guards
  - Each gate is defined once and invoked by name everywhere
    (pre-commit, pre-push, `pnpm test:ci`, CI)
  - Bypass markers live in commit subject lines only (bodies ignored)
  - Extension uses split tsconfig (ES2022 type-check vs CommonJS build);
    `dist/ui/` owned exclusively by esbuild
  - Prettier invoked only via authoritative `format:check` script
  - Gitleaks parity: preflight fails fast if gitleaks unavailable

  Additionally, agents/INVARIANTS.md added invariant #26 (collection-stable
  test definitions), which now appears as Core Principle XXVI.

  Evidence Files:
  - agents/INVARIANTS.md (invariant #26)
  - agents/definition-of-done.md §1.3, §6.1
  - LOCAL_CI_PARITY_INVARIANTS.md (authoritative Tier 1 / Tier 2 matrix,
    Governance section, Platform-Conditional Test Collection section)
  - .test-floor-contract.json
  - .coverage-baseline.json
  - .suppression-baseline.json
  - scripts/run_repo_hook.py, scripts/run_pr_preflight.py
  - scripts/check_ratchet_bump.py, scripts/_platform_test_filters.py
  - scripts/check-version-unchanged.py, scripts/check_threshold_changes.py
  - scripts/check_coverage_delta.py
  - scripts/audit-suppressions.py
  - extension/tsconfig.json, extension/tsconfig.build.json
  - extension/tests/meta/build-output-format-guard.test.ts
  - tests/unit/test_hook_triggers.py, tests/unit/test_ci_parity_drift.py
  - tests/unit/test_platform_conditional_collection.py
  - .github/workflows/ci.yml (python-collection-parity, ratchet-bump-guard)

  Templates Updated:
  - .specify/templates/plan-template.md: ✅ Compatible (generic
    Constitution Check placeholder)
  - .specify/templates/spec-template.md: ✅ Compatible
  - .specify/templates/tasks-template.md: ✅ Compatible

  Follow-up TODOs:
  - Keep LOCAL_CI_PARITY_INVARIANTS.md in lockstep when adding new gates;
    constitution codifies governance, LOCAL_CI_PARITY_INVARIANTS.md owns
    the operational contract
  - Whenever a new bypass marker is introduced, add it to the QG-50
    enumeration and prove subject-line-only enforcement
  - When extending `PLATFORM_CONDITIONAL_IGNORE_GLOBS` (e.g., Linux/macOS
    patterns), update QG-46 evidence and regenerate the cross-OS floor
  =============================================================================

  Version Change: 1.3.0 → 1.4.0 (code quality invariants addition)

  Modified Principles: None (Core Principles unchanged)

  Added Sections:
  - Code Quality Invariants (QG-39 through QG-42)

  Rationale:
  Four standing project invariants were identified during the 047 planning
  cycle as constraints that had been verbally enforced but never codified.
  They surfaced late in the planning process (during task generation) when
  they should have been default assumptions from the start:
  - QG-39: Cross-OS compatibility (Windows/macOS/Linux)
  - QG-40: No typing.Any (strict typing with precise types)
  - QG-41: Zero inline suppressions (enforced by suppression audit)
  - QG-42: Enterprise test coverage (every new code path tested)

  Evidence Files:
  - .github/workflows/ci.yml (cross-platform matrix, mypy, ruff, suppression audit)
  - scripts/audit-suppressions.py (suppression baseline enforcement)
  - pyproject.toml (mypy strict, ruff select)
  - tests/ and extension/tests/ (pytest + Jest suites)

  Templates Updated:
  - .specify/templates/plan-template.md: ✅ Compatible
  - .specify/templates/spec-template.md: ✅ Compatible
  - .specify/templates/tasks-template.md: ✅ Compatible

  Follow-up TODOs:
  - Verify QG-39 evidence exists (CI matrix covers multiple OS)
  - Verify QG-40 is enforceable (mypy --strict + no Any in codebase)
  - Verify QG-41 baseline is at 0 after 047 completes
  - Verify QG-42 ratchet thresholds are current
  =============================================================================

  Version Change: 1.2.0 → 1.3.0 (local/CI parity governance addition)

  Modified Principles: None (Core Principles unchanged)

  Added Sections:
  - Local/CI Parity Gates (QG-35 through QG-38)

  Rationale:
  Local/CI parity is a governed invariant. PR #207 exposed recurring
  desync between local hooks and CI checks (tsc, suppression audit,
  smoke tests). Four quality gates now enforce that:
  - Every CI check has a local equivalent (QG-35)
  - No weaker local modes (QG-36)
  - New CI checks require local gate + doc update (QG-37)
  - --no-verify is forbidden (QG-38)

  Evidence Files:
  - LOCAL_CI_PARITY_INVARIANTS.md (authoritative reference)
  - scripts/run_repo_hook.py (pre-commit hooks)
  - scripts/run_pr_preflight.py (pre-push preflight)

  Templates Updated:
  - .specify/templates/plan-template.md: ✅ Compatible
  - .specify/templates/spec-template.md: ✅ Compatible
  - .specify/templates/tasks-template.md: ✅ Compatible

  Follow-up TODOs:
  - Keep LOCAL_CI_PARITY_INVARIANTS.md aligned with any new CI checks
  - Verify parity after CI workflow changes via `python scripts/run_pr_preflight.py`
  =============================================================================

  Version Change: 1.1.0 → 1.2.0 (demo parity governance addition)

  Modified Principles: None (Core Principles unchanged)

  Added Sections:
  - Demo Parity Gates (QG-30 through QG-34)
  - Demo Parity Verification (VR-24 through VR-27)

  Rationale:
  The public demo is a governed product surface. Non-negotiable requirements:
  - CLI and extension dashboards stay in parity
  - GitHub Pages demo and CLI synthetic demo share one canonical dataset
  - docs/data remains a promoted mirror, not a hand-maintained fixture
  - enterprise demo capability coverage is validated automatically

  Evidence Files:
  - tests/demo/test_demo_parity_pipeline.py
  - docs/DEMO-DATA-VERSIONING.md

  Templates Updated:
  - .specify/templates/plan-template.md: ✅ Compatible
  - .specify/templates/spec-template.md: ✅ Compatible
  - .specify/templates/tasks-template.md: ✅ Compatible

  Follow-up TODOs:
  - Keep capability matrix aligned with supported dashboard features
  - Keep startup-state parity checks aligned with hosting behavior
  =============================================================================
-->

# ado-git-repo-insights Constitution

This constitution codifies the non-negotiable governance principles for ado-git-repo-insights.
All implementation choices, code changes, and architectural decisions MUST preserve these properties.
If a principle cannot be satisfied, the change MUST be escalated as a design break.

## Core Principles (Immutable)

The following 26 principles are immutable. Any modification requires a MAJOR version bump
and explicit migration plan with stakeholder approval.

### I. CSV Schema Contract

CSV schema is a hard contract. Each CSV MUST have exactly the expected columns, in exactly
the expected order, with stable names. The CSVs (`organizations`, `projects`, `repositories`,
`pull_requests`, `users`, `reviewers`) define the PowerBI integration boundary.

### II. No Breaking CSV Changes

No breaking changes to CSVs without an explicit version bump and migration plan.
Adding, removing, renaming, or reordering columns is a breaking change unless the
downstream contract is updated intentionally with documented migration steps.

### III. Deterministic CSV Output

CSV output MUST be deterministic. For the same SQLite contents, CSV bytes MUST be stable
across runs:
- Deterministic row ordering (stable sort keys)
- Deterministic null/empty-string handling
- Stable formatting for datetimes and numbers

### IV. PowerBI Frictionless Import

PowerBI imports MUST remain frictionless. The CSVs MUST remain loadable into the existing
PowerBI model without manual fixes. Any schema drift that breaks import is a blocking defect.

### V. SQLite as Source of Truth

SQLite is the source of truth for derived outputs. CSVs are generated from SQLite,
not from raw API JSON directly. All transformations flow through the database layer.

### VI. Pipeline Artifacts as Persistence

Pipeline Artifacts are the primary persistence mechanism. The standard run downloads
the prior SQLite artifact, updates it, and re-uploads it. This enables incremental
extraction without external storage dependencies.

### VII. No Publish on Failure

If extraction or CSV generation fails, the pipeline MUST NOT publish a mutated SQLite
artifact or partial CSV set. The previous good state MUST be preserved.

### VIII. Idempotent State Updates

State updates MUST be idempotent and converge. Re-running the same date range MUST NOT
create duplicate logical entities; it MUST converge via stable keys and UPSERT semantics.

### IX. Recoverable Persistence

Persistence MUST be recoverable. If the SQLite artifact is missing or expired:
- The system MUST initialize a fresh DB
- The run MUST be explicit about "first-run/backfill" behavior
- The resulting outputs MUST still satisfy the CSV contract

### X. Daily Incremental Extraction Default

Daily incremental extraction is the default mode. Standard scheduled runs MUST extract
the minimal incremental range to optimize API usage and pipeline duration.

### XI. Periodic Backfill Required

The system MUST support a bounded "backfill window" mode (e.g., weekly) that re-fetches
and UPSERTs the last N days (e.g., 30-90). This is the primary mechanism to handle late
PR changes without complex change detection.

### XII. No Silent Data Loss

Pagination MUST be complete (continuation tokens) and failures MUST fail the run rather
than produce incomplete "successful" outputs. Silent data loss is a critical defect.

### XIII. Bounded Rate Limiting

Retries, sleeps, and backoff MUST be bounded and configurable. The system MUST NEVER
enter infinite retry loops. Rate limiting failures surface as run failures with
actionable diagnostics.

### XIV. Stable UPSERT Keys

Stable identifiers are required for UPSERT keys. Primary keys MUST be stable across runs
(e.g., `repository_id` + `pull_request_id` → `pull_request_uid`).

### XV. Organization/Project Scoping

All entities MUST be scoped to organization and project where applicable. No table row
or CSV row may be ambiguous across org/project boundaries.

### XVI. Names as Labels, IDs as Identity

Names are labels; IDs are identity. The system MUST support name changes without breaking
identity or duplicating entities. Display names are mutable; identifiers are not.

### XVII. Cross-Agent Compatibility

The Azure DevOps Pipeline Task MUST run in both hosted and self-hosted agents. Any runtime
assumptions (Python version, install method, working directory) MUST be explicit and tested.

### XVIII. Actionable Failure Logs

If configuration is invalid, auth fails, or runtime dependencies are missing, the task
MUST fail fast with a direct error message. Logs MUST be actionable for operators.

### XIX. PAT Secrecy

PATs are secrets and MUST NEVER be logged. Authorization headers and token values MUST
be scrubbed from all debug output, including stack traces.

### XX. Least Privilege Default

PAT requirements MUST be documented and limited to what's necessary (Code Read scope).
The system MUST NOT request or require elevated permissions beyond minimum needs.

### XXI. Single-Authority Storage Backend

Azure Storage fallback is opt-in and MUST be single-authority. When enabled, Azure Storage
becomes the persistence source of truth for SQLite. Mixed-mode (artifact + blob both
writing state) is forbidden.

### XXII. Explicit One-Way Migration

If switching to Azure Storage, the plan MUST define a controlled cutover that prevents
split-brain state. Migration is explicit and one-way with documented rollback procedures.

### XXIII. Automated CSV Contract Validation

CI MUST verify CSV schemas and column order against expected definitions. Contract tests
run on every PR and block merge on failure.

### XXIV. End-to-End Testability

At least one integration test MUST validate:
- Mocked ADO API responses
- SQLite UPSERT convergence
- CSV deterministic output

The extraction → SQLite → CSV pipeline is testable without live API access.

### XXV. Backfill Mode Testing

There MUST be a test proving that a late change (e.g., reviewer vote update) is corrected
after a backfill run. Backfill convergence is a verified capability.

### XXVI. Collection-Stable Test Definitions

Shared-floor tests MUST have collection-stable definitions across all supported interpreter
and OS lanes. Any Python test that contributes to a ratcheted `--min-collected` floor MUST
be defined unconditionally at module scope:
- No `if version_condition:` wrappers around `def test_*`
- No decorators that add or remove test definitions based on environment
- No module-level or class-level import-time gating of test definitions

Environment-specific behavior MUST be handled inside the test body (e.g.,
`pytest.skip(...)` on non-baseline interpreters), because import-time gating breaks
collection parity between local and CI and causes the shared floor to drift by
interpreter version or OS lane. Platform-conditional files MUST use the file-name-pattern
exclusion mechanism (`test_*_windows.py`, etc.) with the shared
`PLATFORM_CONDITIONAL_IGNORE_GLOBS` constant — never `pytest.mark.skip` or runtime
`pytest.skip()` at collection time, because `--max-skips=0` treats both as violations.

## Quality Gates

Work is not complete until the following gates pass. These gates derive from the
Definition of Done and map to CI/CD checkpoints.

### Output Contract Gates

| Gate | Requirement | Evidence |
|------|-------------|----------|
| QG-01 | CSV column names match exactly | `tests/unit/test_csv_contract.py` |
| QG-02 | CSV column order matches exactly | `tests/unit/test_csv_contract.py` |
| QG-03 | CSV headers contain no extras/missing | `tests/unit/test_csv_contract.py` |
| QG-04 | Deterministic output (identical on re-run) | `tests/unit/test_csv_determinism.py` |
| QG-05 | Golden output determinism with dynamic fixtures (no committed fixture files) | `tests/integration/test_golden_outputs.py` |

### Persistence Gates

| Gate | Requirement | Evidence |
|------|-------------|----------|
| QG-06 | Publish-on-success only (no partial outputs) | `sample-pipeline.yml` pattern |
| QG-07 | Working copy approach for mutations | Pipeline runbook test |
| QG-08 | Corruption/invalid DB handling | `tests/integration/test_db_open_failure.py` |

### Extraction Gates

| Gate | Requirement | Evidence |
|------|-------------|----------|
| QG-09 | Pagination completeness | `tests/unit/test_ado_client_pagination.py` |
| QG-10 | Bounded retry + backoff | `tests/unit/test_retry_policy.py` |
| QG-11 | Incremental mode works | `tests/integration/test_incremental_run.py` |
| QG-12 | Backfill convergence | `tests/integration/test_backfill_convergence.py` |

### Identity Gates

| Gate | Requirement | Evidence |
|------|-------------|----------|
| QG-13 | Stable keys enforced | `tests/unit/test_upsert_keys.py` |
| QG-14 | Org/project scoping verified | `tests/integration/test_multi_project_scoping.py` |

### Runtime Gates

| Gate | Requirement | Evidence |
|------|-------------|----------|
| QG-15 | Task executes on hosted agents | Documented pipeline run |
| QG-16 | Secrets never logged | `tests/unit/test_secret_redaction.py` |

### Release Gates

| Gate | Requirement | Evidence |
|------|-------------|----------|
| QG-17 | Lint + format checks pass | `.github/workflows/ci.yml` |
| QG-18 | Type checking passes | `.github/workflows/ci.yml` |
| QG-19 | Unit + integration tests pass | `.github/workflows/ci.yml` |
| QG-20 | Coverage threshold enforced | `.github/workflows/ci.yml` |
| QG-21 | Python package builds | `.github/workflows/release.yml` |
| QG-22 | VSIX extension builds | `.github/workflows/release.yml` |

### Documentation Gates

| Gate | Requirement | Evidence |
|------|-------------|----------|
| QG-23 | Runbook complete | `docs/operations/runbook.md` |
| QG-24 | Configuration reference complete | `config.example.yaml` |

### Scalability Gates

| Gate | Requirement | Evidence |
|------|-------------|----------|
| QG-25 | Synthetic data supports 156+ weeks | `tests/unit/test_synthetic_dataset.py` |
| QG-26 | Synthetic data supports 200+ reviewers | `tests/unit/test_synthetic_dataset.py` |
| QG-27 | Synthetic data includes comment generation | `tests/unit/test_synthetic_dataset.py` |
| QG-28 | Dashboard renders 156 weeks in < 1000ms | `extension/tests/unit/chart-scalability.test.ts` |
| QG-29 | Chart data caps enforced (MAX_*_POINTS) | `extension/tests/scalability-invariants.test.ts` |

### Demo Parity Gates

| Gate | Requirement | Evidence |
|------|-------------|----------|
| QG-30 | CLI and extension dashboards use one shared UI bundle contract | `extension/tests/modules/mode-parity.test.ts` |
| QG-31 | Canonical enterprise demo dataset builds under `artifacts/demo-enterprise/` | `tests/demo/test_demo_parity_pipeline.py` |
| QG-32 | `docs/data/` is a clean promoted mirror with no stale files or directories | `tests/demo/test_demo_parity_pipeline.py` |
| QG-33 | Enterprise demo capability matrix passes for all supported dashboard features | `tests/demo/test_demo_parity_pipeline.py` |
| QG-34 | Normalized startup-state parity passes for docs and CLI demo surfaces | `tests/demo/test_demo_parity_pipeline.py` |

### Local/CI Parity Gates

| Gate | Requirement | Evidence |
|------|-------------|----------|
| QG-35 | Every CI-hard-gate check has a local equivalent that runs automatically via git hooks | `LOCAL_CI_PARITY_INVARIANTS.md` |
| QG-36 | No CI check may exist in a weaker local mode than its CI enforcement level | `LOCAL_CI_PARITY_INVARIANTS.md`, `scripts/run_repo_hook.py`, `scripts/run_pr_preflight.py` |
| QG-37 | Adding a new CI check MUST include a corresponding local gate update and an update to `LOCAL_CI_PARITY_INVARIANTS.md` | `LOCAL_CI_PARITY_INVARIANTS.md` Governance section |
| QG-38 | `--no-verify` is forbidden by project policy; git hooks must never be bypassed | `LOCAL_CI_PARITY_INVARIANTS.md` |

### Code Quality Invariants

| Gate | Requirement | Evidence |
|------|-------------|----------|
| QG-39 | All code MUST work on Windows, macOS, and Linux. No OS-specific assumptions in paths, shell commands, subprocess calls, or file enumeration. | Cross-platform CI matrix, `normalize_path()` in audit tool |
| QG-40 | `typing.Any` MUST NOT be used as a type annotation. Use precise types (`object`, `Callable[..., object]`, `type[T]`, Protocols). Requires explicit stakeholder approval to bypass with documented justification. | `mypy --strict` on `src/`, `tests/`, `scripts/` |
| QG-41 | Zero inline suppression comments (`# noqa`, `# type: ignore`, `// eslint-disable`, `// @ts-ignore`) unless backed by a committed proof artifact, compensating guardrail, and explicit stakeholder approval. | `scripts/audit-suppressions.py --diff`, `.suppression-baseline.json` |
| QG-42 | Every new feature, gate, guardrail, and refactor MUST have enterprise-grade test coverage in both Python (pytest) and TypeScript (Jest) as applicable. No untested code paths in new work. | `--min-collected` ratchet, `--max-skips=0`, coverage thresholds |

### Test Discipline Gates

| Gate | Requirement | Evidence |
|------|-------------|----------|
| QG-43 | Every commit that adds N tests MUST bump the shared floor in `.test-floor-contract.json` by exactly N in the same commit. Per-commit enforcement walks the first-parent range (`{base}..HEAD`) and compares each commit's `floor_delta` against its `actual_delta`; drift on any commit fails the gate. | `scripts/check_ratchet_bump.py`, `.github/workflows/ci.yml` `ratchet-bump-guard` job |
| QG-44 | `.test-floor-contract.json` is the single source of truth for both Python and Extension `--min-collected` floors. `scripts/run_pr_preflight.py` and `.github/workflows/ci.yml` MUST both read via `--min-collected-artifact`; no hardcoded integer floors are permitted in either entry point. Inter-file parity is a non-waivable assertion. | `.test-floor-contract.json`, `scripts/run_pr_preflight.py`, `.github/workflows/ci.yml` |
| QG-45 | The Python floor MUST be the cross-platform minimum collected count (what Linux/macOS and Windows-filtered cells agree on). Cross-OS parity is enforced by the `python-collection-parity` CI job which compares exact node_id sets between Ubuntu and Windows; the ratchet-bump-guard depends on this job passing. | `.github/workflows/ci.yml` `python-collection-parity` and `ratchet-bump-guard` jobs |
| QG-46 | Platform-conditional tests MUST use file-name-pattern exclusion (`test_*_windows.py`, and equivalents for other OSes when added). The glob patterns live in a shared constant `PLATFORM_CONDITIONAL_IGNORE_GLOBS` imported by BOTH `tests/conftest.py` and `scripts/check_ratchet_bump.py` — either site dropping the import fails the AST-level parity test. `pytest.mark.skip`, `pytest.mark.skipIf`, and runtime `pytest.skip()` at collection time are forbidden (`--max-skips=0`). | `scripts/_platform_test_filters.py`, `tests/unit/test_platform_conditional_collection.py`, `tests/unit/test_platform_conditional_collection_windows.py` |

### Entry Point Alignment Gates

| Gate | Requirement | Evidence |
|------|-------------|----------|
| QG-47 | Pre-commit trigger scope MUST match or exceed the effective compilation/audit scope of the gate it guards. Triggers are defined by what the compiler or tool reads (e.g., every path in a tsconfig `include`), not by what the developer intends to change. Any path a gate reads MUST have a corresponding trigger. | `tests/unit/test_hook_triggers.py`, `tests/unit/test_hook_guards.py` |
| QG-48 | Every pre-commit gate that reads the worktree (tsc, parity scripts, etc.) MUST have a corresponding clean-worktree guard covering its full input scope. The guard MUST block commit if unstaged changes exist in any path the gate reads, ensuring the gate validates the staged snapshot. Current guards: `require_clean_ui_sources()`, `require_clean_test_compilation_scope()`, `require_clean_tsconfigs()`. | `scripts/run_repo_hook.py` `require_clean_*()` functions |
| QG-49 | Each gate MUST be defined exactly once as an authoritative command (e.g., an npm/pnpm script or a named CommandSpec) and invoked by name from every entry point: pre-commit, pre-push preflight, `pnpm test:ci`, and CI. `pnpm test:ci` is the documented local equivalent of the CI gate chain; if they diverge, the gate is broken. Direct invocation of underlying tools (e.g., calling `prettier` directly instead of the `format:check` script) is forbidden. | `package.json` `test:ci`, `scripts/run_pr_preflight.py` CommandSpecs, `.github/workflows/ci.yml`, `tests/unit/test_ci_parity_drift.py` |

### Change Acknowledgement Gates

| Gate | Requirement | Evidence |
|------|-------------|----------|
| QG-50 | All bypass markers (`[version-override-acknowledged]`, `[threshold-update]`, `[ratchet-realignment]`, `[ratchet-test-removal]`) MUST appear in a commit SUBJECT LINE within the PR range (`{base}..HEAD`). Markers placed in commit bodies, PR descriptions, or cover notes are NOT honored. Scans use `git log --oneline` (subjects only). This prevents feature-documentation prose from accidentally disarming gates and keeps the marker surface auditable from `git log` alone. | `scripts/check-version-unchanged.py`, `scripts/check_threshold_changes.py`, `scripts/check_ratchet_bump.py` |
| QG-51 | Any change to extension or task manifest version fields MUST carry `[version-override-acknowledged]` in a branch-local commit subject line. The local pre-push hook runs version-guard FIRST (fail-fast before expensive gates) using the identical script that CI runs. Direct pushes to `main` are NEVER bypassed by any marker. Local and CI enforcement are fully symmetric. | `scripts/check-version-unchanged.py`, `scripts/run_repo_hook.py` `run_version_guard()` |
| QG-52 | Python + TypeScript coverage totals MUST NOT drop more than 2% vs `.coverage-baseline.json` on any metric (matching Codecov `project` `target: auto`, `threshold: 2%`). Baseline updates use the `--update` flag. Baseline-change acknowledgement shares the `[threshold-update]` subject-line marker defined in QG-50. | `scripts/check_coverage_delta.py`, `.coverage-baseline.json` |

### Build Architecture Gates

| Gate | Requirement | Evidence |
|------|-------------|----------|
| QG-53 | The extension uses split tsconfigs: `tsconfig.json` (module: `ES2022`, moduleResolution: `bundler`) for type checking, and `tsconfig.build.json` (module: `CommonJS`, moduleResolution: `bundler`) for `dist/` emission. Node-executed scripts in `dist/` require CJS runtime semantics (`__dirname`, `require()`). The `build:tsc` script MUST reference `tsconfig.build.json` explicitly. | `extension/tsconfig.json`, `extension/tsconfig.build.json`, `extension/tests/meta/build-output-format-guard.test.ts` |
| QG-54 | `dist/ui/` is owned exclusively by esbuild (`build:ui`). `tsconfig.build.json` MUST NOT include `ui/` paths — otherwise `build:tsc` silently overwrites IIFE bundles with CJS, breaking browser runtime. The guard pins module + moduleResolution for each config, the build-script entry point, and the `ui/` exclusion. | `extension/tests/meta/build-output-format-guard.test.ts` |
| QG-55 | Prettier is invoked ONLY via the `format:check` script declared in `extension/package.json`. The script owns every flag (`--check`, `--ignore-path ../.prettierignore`, the `**/*.{ts,js,json,md}` glob). Direct Prettier invocation from any entry point (pre-commit, preflight, `test:ci`, CI workflow) is forbidden. Parity-drift regression locks the script flags, the per-entry-point invocation form, and the negative allowlist. | `extension/package.json`, `tests/unit/test_ci_parity_drift.py` `TestFormatCheckParity` |

### Security Scan Gates

| Gate | Requirement | Evidence |
|------|-------------|----------|
| QG-56 | Pre-push preflight MUST run `gitleaks detect --config=.gitleaks.toml` with the same config CI enforces. If `gitleaks` is unavailable locally, authoritative preflight MUST fail fast rather than silently skipping (`--allow-local-degraded` is diagnostic-only and does not count as parity). The pre-commit `detect-private-key` framework hook is a supplementary staged-file check, not a substitute. | `scripts/run_pr_preflight.py` CommandSpec "Secret scan (gitleaks)", `.gitleaks.toml` |

## Verification Requirements

A phase is not complete until every verification step passes without manual intervention.
These requirements derive from Victory Gates and define the final "are we done?" check.

### Local Developer Verification

| Checkpoint | Command | Pass Criteria |
|------------|---------|---------------|
| VR-01 | Environment setup | `pip install -e .[dev]` succeeds |
| VR-02 | Lint/format (Python) | `ruff check . && ruff format --check .` passes |
| VR-02a | Format (Extension) | `pnpm --dir extension run format:check` passes |
| VR-03 | Type checking | `mypy src/ tests/ scripts/ .github/scripts/` passes |
| VR-04 | Unit tests | `pytest tests/unit` all pass, no skipped contract tests |
| VR-05 | Golden outputs | `pytest tests/integration/test_golden_outputs.py` hashes stable |
| VR-06 | Incremental run | `pytest tests/integration/test_incremental_run.py` no duplicates |
| VR-07 | Backfill convergence | `pytest tests/integration/test_backfill_convergence.py` late changes corrected |

### CLI Verification

| Checkpoint | Scenario | Pass Criteria |
|------------|----------|---------------|
| VR-08 | First-run extraction | SQLite created, tables populated, summary printed |
| VR-09 | CSV generation | All CSVs generated, column order matches, no errors |
| VR-10 | Repeatability | Second CSV generation produces identical output |

### Pipeline Verification

| Checkpoint | Scenario | Pass Criteria |
|------------|----------|---------------|
| VR-11 | Clean pipeline run | Pipeline succeeds, artifacts published |
| VR-12 | Incremental pipeline run | Artifact downloaded, incremental extraction, no duplication |
| VR-13 | Failure safety | Pipeline fails on error, previous artifact intact |

### Extension Verification

| Checkpoint | Scenario | Pass Criteria |
|------------|----------|---------------|
| VR-14 | Extension packaging | `.vsix` produced successfully |
| VR-15 | Task execution | Task runs without agent hacks, PAT never logged |

### PowerBI Verification

| Checkpoint | Scenario | Pass Criteria |
|------------|----------|---------------|
| VR-16 | Import test | CSVs import without schema errors or manual fixes |
| VR-17 | Regression confidence | Differences from legacy are explainable |

### Release Verification

| Checkpoint | Scenario | Pass Criteria |
|------------|----------|---------------|
| VR-18 | CI green | All checks passing on `main` |
| VR-19 | Versioned release | Tag pushed, packages built, artifacts published |

### Scalability Verification

| Checkpoint | Scenario | Pass Criteria |
|------------|----------|---------------|
| VR-20 | Scalability dataset generation | `python scripts/build-demo-dataset.py --no-promote` succeeds |
| VR-21 | Dashboard load test (156 weeks) | All charts render without browser freeze, < 1000ms |
| VR-22 | Dashboard load test (200 reviewers) | Reviewer Activity panel displays correctly |
| VR-23 | Dashboard load test (comments enabled) | Dashboard loads with `features.comments: true` |

### Demo Parity Verification

| Checkpoint | Scenario | Pass Criteria |
|------------|----------|---------------|
| VR-24 | Canonical demo build | `python scripts/build-demo-dataset.py` succeeds |
| VR-25 | Capability coverage | `artifacts/demo-enterprise/report/capability-matrix.json` reports `all_passed = true` |
| VR-26 | Startup-state parity | `artifacts/demo-enterprise/report/startup-parity.json` reports `parity_passed = true` |
| VR-27 | Published demo parity | `docs/data/` is byte-identical to promoted canonical output and remains generated-only |

### Local/CI Parity Verification

| Checkpoint | Command | Pass Criteria |
|------------|---------|---------------|
| VR-28 | Full pre-push hook | `python scripts/run_repo_hook.py pre-push` completes with exit code 0 (runs version-guard first, then full preflight) |
| VR-29 | Authoritative preflight | `python scripts/run_pr_preflight.py` returns 0; every CommandSpec passes without `--allow-local-degraded` |
| VR-30 | Ratchet-bump parity | `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml` reports floor == actual on both Python and Extension suites, and inter-file parity (`.test-floor-contract.json` vs preflight vs ci.yml) holds on every commit in the range |

## Governance

### Amendment Procedure

1. **Proposal**: Document the proposed change with rationale and impact analysis
2. **Review**: Changes to Core Principles require explicit stakeholder approval
3. **Migration Plan**: Breaking changes require documented migration steps
4. **Version Bump**: Apply semantic versioning per change scope
5. **Propagation**: Update all dependent templates and documentation

### Versioning Policy

- **MAJOR**: Removal or redefinition of Core Principles (backward-incompatible governance)
- **MINOR**: Addition of new principles, sections, or material guidance expansion
- **PATCH**: Clarifications, wording improvements, typo fixes, non-semantic refinements

### Compliance Review

- All PRs MUST verify compliance with Core Principles
- CI gates MUST enforce Quality Gates
- Phase completion requires all Verification Requirements to pass
- Complexity MUST be justified against simplicity (Principle IV of PowerBI compatibility)

### Decision Log (Locked)

These decisions are final and may not be revisited without MAJOR version change:

- **Primary persistence**: Azure DevOps Pipeline Artifacts (SQLite file)
- **Historical migration**: No MongoDB migration (fresh extraction from configured start date)
- **Output compatibility**: 100% PowerBI CSV parity is mandatory

**Version**: 1.5.0 | **Ratified**: 2026-01-26 | **Last Amended**: 2026-04-16
