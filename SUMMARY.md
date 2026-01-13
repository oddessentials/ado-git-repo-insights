# Executive Summary — Data Retention & Logging Model

## System Overview (At a Glance)

* The system extracts **Azure DevOps pull-request metadata** and stores it in a **single SQLite database file**.
* That database is the **authoritative system of record**.
* Reporting outputs (CSV files for PowerBI) are **derived artifacts** and can always be regenerated.
* **No source code, secrets, or credentials** are stored at rest.

How long data and logs persist—and who can access them—depends entirely on **how the system is run**.

---

## 1. Data Retention & Storage Model

### Local / Individual Use

**Where data lives**

* SQLite database file lives **on the local machine** of the user running the tool.
* Location is configurable but defaults to the working directory.

**Who can access it**

* Only users with **file-system access** to that machine.
* No automatic sharing or replication.
* Organizational access only occurs if the file is manually copied elsewhere.

**Retention behavior**

* Data persists **as long as the database file exists**.
* Deleting the file permanently deletes all retained history.
* Incremental runs update the same file over time.

**Security posture**

* Relies on OS-level controls (disk encryption, file permissions).
* Azure DevOps PAT is supplied at runtime and **never stored** in the database.
* Best suited for **personal analysis or exploratory use**, not enterprise reporting.

---

### Azure DevOps Pipeline / Extension (Organizational Use)

**Where data lives**

* SQLite database is stored as an **Azure DevOps Pipeline Artifact**.
* Each scheduled run:

  1. Downloads the previous database
  2. Applies incremental updates
  3. Publishes the updated database back as the new artifact.

**Who can access it**

* Anyone with:

  * Access to the Azure DevOps project, and
  * Permission to view pipeline artifacts.
* Database becomes an **organization-level shared asset**.

**Retention behavior**

* Governed by **Azure DevOps artifact retention policies**.
* If the artifact expires or is deleted, historical data is lost unless backed up.
* Recommended practice: extend retention (e.g. 90–365 days) and treat the artifact as operational state.

**Security posture**

* PAT is stored as a **secure pipeline secret** and masked in logs.
* Database contains **no secrets or credentials**.
* Access is controlled via Azure DevOps RBAC (project, pipeline, artifact permissions).
* Suitable for **enterprise dashboards, audits, and shared analytics**.

---

## 2. Logging & Debugging Model

### What is logged

* Execution steps, counts, timings, warnings, and errors.
* **Never logs secrets** (PATs, bearer tokens, auth headers).

### Local / CLI Logging

**Log location**

* Logs written to:

  * Console (default), or
  * Structured JSONL files under `run_artifacts/` if enabled.

**Run summary**

* Every execution writes a `run_summary.json`.
* Written **even on failure** and includes:

  * Final status (success/failure)
  * Per-project results
  * First fatal error
  * Timing and counts.

**Failure signaling**

* Non-zero exit code.
* Clear ERROR log entry.
* Summary file records failure reason.

**Security**

* PATs and tokens are redacted at log formatter level.
* Summary output masks sensitive fields.

---

### Azure DevOps Pipeline / Extension Logging

**Log location**

* All logs streamed directly to **Azure DevOps pipeline logs**.
* Optional JSON logs and `run_summary.json` are published as pipeline artifacts.

**Failure signaling**

* Python process exit propagates to pipeline task failure.
* Emits `##vso[task.logissue type=error]` commands so failures are clearly marked in ADO UI.
* Pipeline run is marked **Failed** automatically.

**Operational visibility**

* Operators can see:

  * Red error indicators in pipeline UI
  * Error messages inline
  * Downloadable artifacts containing structured summaries and logs

**Security**

* Extension prints configuration with **explicit secret masking** (e.g. `PAT: ********`).
* Redaction logic applies consistently across console, JSON logs, and summaries.

---

## 3. Governance & Risk Takeaways

* ✅ **No secrets at rest** (database or logs).
* ✅ **Deterministic retention**: data exists only while its SQLite file/artifact exists.
* ⚠️ **Local mode is not shared or durable**—data is siloed and user-managed.
* ✅ **Pipeline mode creates an organizational system of record** with RBAC controls.
* ✅ **Failures are visible and auditable** via summaries and pipeline status.
* 🔄 **All outputs are reproducible** from retained state.

---

### Bottom Line

* **Local execution** → private, ephemeral, operator-managed.
* **Pipeline / extension execution** → shared, governed, auditable.
* Data and logs are intentionally simple, file-based, and transparent—making retention, access, and security **explicit and controllable by IT**, not hidden in infrastructure.

---

## Appendix: Test Evidence

All claims in this document are backed by automated tests. The tables below map each claim to the tests that verify it.

### Data & Storage Claims

| Claim | Test Evidence |
|-------|---------------|
| SQLite is authoritative system of record | `test_golden_outputs.py`, `test_db_open_failure.py` |
| CSV files are derived/regenerable | `test_golden_outputs.py::test_all_csvs_generated_from_golden` |
| No secrets stored at rest | `test_secret_redaction.py` (5 tests) |
| Database location configurable | `test_cli_args.py`, `test_config_validation.py` |
| PAT never stored in database | `test_secret_redaction.py::test_pat_not_in_exception_messages` |
| Incremental runs update same file | `test_incremental_run.py` (5 tests) |

### Logging & Debugging Claims

| Claim | Test Evidence |
|-------|---------------|
| Never logs secrets (PATs, tokens) | `test_secret_redaction.py`, `test_logging_config.py::TestRedactingFormatter`, `test_redaction.py` |
| Logs to console or JSONL | `test_logging_config.py::TestSetupLogging`, `test_logging_config.py::TestJsonlHandler` |
| `run_summary.json` always written | `test_run_summary.py::TestRunSummary.test_write` |
| Summary written even on failure | `test_run_summary.py::test_create_minimal_summary` |
| Summary includes status/errors | `test_run_summary.py::test_to_dict`, `test_run_summary.py::test_normalizes_error_on_init` |
| Emits `##vso` commands in ADO | `test_run_summary.py::test_emit_ado_commands_in_ado_failure`, `test_emit_ado_commands_in_ado_warnings` |
| Config printed with PAT masked | `test_config_validation.py::test_config_repr_masks_pat`, `test_secret_redaction.py::test_config_log_summary_masks_pat` |

### Governance Claims

| Claim | Test Evidence |
|-------|---------------|
| No secrets at rest | `test_secret_redaction.py` (5 tests) |
| Failures visible and auditable | `test_run_summary.py` (ADO commands, summary output) |
| Outputs reproducible | `test_golden_outputs.py::test_golden_output_deterministic` |

### Test Categories

| Category | Files | Purpose |
|----------|-------|---------|
| **Unit** | `tests/unit/` (12 files) | Isolated component testing |
| **Integration** | `tests/integration/` (5 files) | End-to-end workflow validation |
| **Redaction** | `tests/test_redaction.py` | Secret filtering edge cases |

Run all tests: `pytest tests/ -v`
