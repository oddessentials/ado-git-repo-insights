```md
# agents/definition-of-done.md — ado-git-repo-insights

This document defines the Definition of Done (DoD) for ado-git-repo-insights.
Work is not “done” until the checks below are implemented, automated where possible, and passing.

---

## 1) Output Contract (PowerBI CSV) — DoD

### 1.1 Schema Contract Tests (CI Required)

- ✅ For each CSV (`organizations`, `projects`, `repositories`, `pull_requests`, `users`, `reviewers`):
  - column names match exactly
  - column order matches exactly
  - CSV headers contain no extras and no missing columns
- ✅ Failing any schema test fails CI.

**Evidence:** `tests/unit/test_csv_contract.py` (or equivalent) runs in CI.

### 1.2 Deterministic Output Tests (CI Required)

- ✅ Given the same SQLite DB contents, generating CSVs twice produces identical outputs.
  - byte-for-byte equality preferred (or stable hashing comparison)
- ✅ Deterministic row ordering is validated (stable primary + secondary sort keys).

**Evidence:** `tests/unit/test_csv_determinism.py` + artifact hash comparison.

### 1.3 “Golden Fixture” Compatibility (Manual Once + Automated Thereafter)

- ✅ Maintain a small golden SQLite fixture and the exact expected CSV outputs.
- ✅ CI verifies that generating CSVs from the fixture matches expected outputs.

**Evidence:** `tests/fixtures/golden_db.sqlite` + expected CSV files + `tests/integration/test_golden_outputs.py`.

---

## 2) Persistence (SQLite Artifact) — DoD

### 2.1 Publish-on-Success Only (Pipeline Required)

- ✅ Pipeline must not publish:
  - a mutated SQLite file
  - partial CSV outputs
    when extraction or CSV generation fails.
- ✅ Pipeline uses a “working copy” approach:
  - download prior DB
  - copy to a temp path
  - write/mutate temp path
  - only publish temp path as the new artifact if all steps succeed

**Evidence:** `sample-pipeline.yml` demonstrates this pattern and is validated by a pipeline runbook test.

### 2.2 Corruption/Invalid DB Handling (Automated)

- ✅ If SQLite cannot be opened or schema is invalid:
  - fail fast with clear error, OR
  - explicitly rebuild from configured start date (documented mode)
- ✅ The behavior is documented and test-covered.

**Evidence:** `tests/integration/test_db_open_failure.py`.

---

## 3) Extraction Correctness — DoD

### 3.1 Pagination Completeness (CI Required)

- ✅ ADO extractor must fetch all pages using continuation tokens.
- ✅ A test simulates >1 page results and confirms completeness.

**Evidence:** `tests/unit/test_ado_client_pagination.py`.

### 3.2 Bounded Retry + Backoff (CI Required)

- ✅ Retries are bounded and configurable.
- ✅ Backoff is applied and does not loop indefinitely.
- ✅ Failures propagate as failed runs (no silent success).

**Evidence:** `tests/unit/test_retry_policy.py`.

### 3.3 Incremental Mode Works (Integration Required)

- ✅ Starting with an existing DB and metadata, a daily run:
  - extracts only the incremental range
  - UPSERTs without duplication
  - advances metadata correctly

**Evidence:** `tests/integration/test_incremental_run.py`.

### 3.4 Backfill Window Convergence (Integration Required)

- ✅ Backfill mode (`--backfill-days N`) re-fetches a bounded window and corrects drift.
- ✅ A test demonstrates a “late change” scenario:
  - initial extraction stores reviewer votes/state
  - mocked API returns updated vote/state later
  - backfill run updates SQLite and CSV output accordingly

**Evidence:** `tests/integration/test_backfill_convergence.py`.

---

## 4) Identity & Key Stability — DoD

### 4.1 Stable Keys Enforced (CI Required)

- ✅ PR identity uses a stable key (e.g., `{repository_id}-{pull_request_id}`) consistently.
- ✅ Users/repositories are keyed by stable IDs, names treated as mutable labels.
- ✅ Tests ensure repeated ingest does not create duplicate logical rows.

**Evidence:** `tests/unit/test_upsert_keys.py`.

### 4.2 Org/Project Scoping Verified (CI Required)

- ✅ All relevant rows include `organization_name` and `project_name` where required.
- ✅ A test ensures multi-project extraction does not collide.

**Evidence:** `tests/integration/test_multi_project_scoping.py`.

---

## 5) Runtime & Extension Packaging — DoD

### 5.1 Task Executes Reliably on Hosted Agents (Manual + Repeatable)

- ✅ ADO Pipeline Task runs successfully on `ubuntu-latest` using documented setup.
- ✅ Logs are actionable and show:
  - configuration summary (non-secret)
  - projects processed
  - counts extracted
  - artifact paths used

**Evidence:** documented pipeline run steps + screenshot/log excerpt in `docs/runbook.md`.

### 5.2 Secrets Never Logged (CI Required)

- ✅ PAT is never printed, even in debug logs.
- ✅ A unit test validates log scrubber / redaction (if implemented).

**Evidence:** `tests/unit/test_secret_redaction.py`.

---

## 6) Release & Quality Gates — DoD

### 6.1 CI Must Gate Merge

- ✅ Lint + format checks pass.
- ✅ Type checking passes (if enabled).
- ✅ Unit + integration tests pass.
- ✅ Coverage threshold is enforced per project standards.

**Evidence:** `.github/workflows/ci.yml`.

### 6.2 Versioning & Packaging

- ✅ Python package builds successfully (sdist + wheel).
- ✅ VSIX extension builds successfully.
- ✅ Release workflow outputs artifacts and is reproducible from tags.

**Evidence:** `.github/workflows/release.yml` + documented `tfx extension create` steps.

---

## 7) Documentation — DoD

### 7.1 Runbook (Required)

- ✅ `docs/runbook.md` includes:
  - first-run behavior
  - missing/expired artifact behavior
  - how to run daily vs backfill
  - how to recover from failures
  - how to validate CSV contract

### 7.2 Configuration Reference (Required)

- ✅ `config.example.yaml` matches actual parser behavior.
- ✅ A config doc defines:
  - organization/projects format
  - backfill-days usage
  - API tuning options
  - storage backend selection (artifact vs Azure storage)

---

## Minimum “Ready for Alpha” Checklist

- ✅ End-to-end extraction → SQLite → CSV works locally
- ✅ Pipeline publishes SQLite + CSVs on success
- ✅ Schema + determinism tests passing in CI
- ✅ Pagination + backfill convergence tests in place
- ✅ Runbook exists and matches real behavior
```
