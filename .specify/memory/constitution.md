<!--
  =============================================================================
  SYNC IMPACT REPORT
  =============================================================================
  Version Change: N/A → 1.0.0 (initial constitution from existing governance)

  Modified Principles: N/A (initial creation)

  Added Sections:
  - 25 Immutable Principles (from agents/INVARIANTS.md)
  - Quality Gates (from agents/definition-of-done.md)
  - Verification Requirements (from agents/victory-gates.md)
  - Governance rules and amendment procedures

  Removed Sections: N/A (initial creation)

  Templates Updated:
  - .specify/templates/plan-template.md: ✅ Compatible (Constitution Check section exists)
  - .specify/templates/spec-template.md: ✅ Compatible (requirements structure aligns)
  - .specify/templates/tasks-template.md: ✅ Compatible (phase structure supports invariants)

  Follow-up TODOs:
  - None
  =============================================================================
-->

# ado-git-repo-insights Constitution

This constitution codifies the non-negotiable governance principles for ado-git-repo-insights.
All implementation choices, code changes, and architectural decisions MUST preserve these properties.
If a principle cannot be satisfied, the change MUST be escalated as a design break.

## Core Principles (Immutable)

The following 25 principles are immutable. Any modification requires a MAJOR version bump
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
| QG-05 | Golden fixture compatibility | `tests/integration/test_golden_outputs.py` |

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

## Verification Requirements

A phase is not complete until every verification step passes without manual intervention.
These requirements derive from Victory Gates and define the final "are we done?" check.

### Local Developer Verification

| Checkpoint | Command | Pass Criteria |
|------------|---------|---------------|
| VR-01 | Environment setup | `pip install -e .[dev]` succeeds |
| VR-02 | Lint/format | `ruff check . && ruff format --check .` passes |
| VR-03 | Type checking | `mypy src/` passes (if enabled) |
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

**Version**: 1.0.0 | **Ratified**: 2026-01-26 | **Last Amended**: 2026-01-26
