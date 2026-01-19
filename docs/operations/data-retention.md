# Data Retention & Storage Model

How data is stored, who can access it, and how long it persists.

---

## Overview

- Data is stored in a **single SQLite database file**
- The database is the **authoritative system of record**
- CSV outputs are **derived artifacts** (regenerable)
- **No source code, secrets, or credentials** are stored at rest

How long data persists depends on **how the system is run**.

---

## Local CLI Mode

### Where Data Lives

- SQLite database on the local machine
- Location is configurable (default: working directory)

### Who Can Access

- Only users with file-system access to that machine
- No automatic sharing or replication
- Organization access only if file is manually copied

### Retention Behavior

- Data persists as long as the database file exists
- Deleting the file permanently deletes all history
- Incremental runs update the same file

### Security Posture

- Relies on OS-level controls (disk encryption, file permissions)
- PAT is supplied at runtime and **never stored** in the database
- Best suited for personal analysis or exploratory use

---

## Azure DevOps Pipeline Mode

### Where Data Lives

- SQLite database stored as an **Azure DevOps Pipeline Artifact**
- Each run: downloads previous → updates → publishes new artifact

### Who Can Access

- Anyone with:
  - Access to the Azure DevOps project
  - Permission to view pipeline artifacts (Build Read)
- Database becomes an **organization-level shared asset**

### Retention Behavior

- Governed by **Azure DevOps artifact retention policies**
- If artifact expires or is deleted, historical data is lost
- **Recommended:** Extend retention to 90+ days

### Security Posture

- PAT stored as **secure pipeline secret** (masked in logs)
- Database contains **no secrets or credentials**
- Access controlled via Azure DevOps RBAC
- Suitable for enterprise dashboards and shared analytics

---

## Data Contents

### What Is Stored

| Data | Stored | Notes |
|------|--------|-------|
| PR metadata | Yes | Title, dates, cycle time |
| User info | Yes | Display name, email, user ID |
| Reviewer votes | Yes | Vote value per reviewer |
| PR descriptions | Yes | May be empty |
| Source code | No | Never extracted |
| Secrets/credentials | No | Never stored |
| PAT | No | Runtime only |

### What Is NOT Stored

- Source code or file contents
- Commit history or diffs
- Comments or discussions
- Work item links
- Authentication tokens

---

## Logging Model

### What Is Logged

- Execution steps, counts, timings
- Warnings and errors
- **Never:** PATs, bearer tokens, auth headers

### Local CLI Logging

| Output | Location |
|--------|----------|
| Console | Default (INFO level) |
| JSONL files | `run_artifacts/logs.jsonl` (if enabled) |
| Run summary | `run_artifacts/run_summary.json` (always) |

### Pipeline Logging

| Output | Location |
|--------|----------|
| Console | Azure DevOps pipeline logs |
| JSONL files | Pipeline artifacts (optional) |
| Run summary | Pipeline artifacts |

### Secret Redaction

- PATs and tokens redacted at log formatter level
- Summary output masks sensitive fields
- Extension prints config with `PAT: ********`

---

## Failure Signaling

### CLI Mode

- Non-zero exit code
- ERROR log entry
- `run_summary.json` records failure reason

### Pipeline Mode

- Non-zero exit propagates to task failure
- `##vso[task.logissue type=error]` emitted
- Pipeline run marked **Failed**
- No artifact published on failure

---

## Governance Takeaways

| Property | Status |
|----------|--------|
| No secrets at rest | Guaranteed |
| Deterministic retention | Data exists only while file/artifact exists |
| Local mode | Private, ephemeral, user-managed |
| Pipeline mode | Shared, governed, auditable |
| Failures visible | Via summaries and pipeline status |
| Outputs reproducible | From retained state |

---

## Recommendations

### For Personal Use

- Use local CLI mode
- Manage your own backup/retention
- Keep database in an encrypted location

### For Team/Enterprise Use

- Use pipeline mode with artifact retention
- Configure Build Read permissions appropriately
- Set artifact retention to 90+ days
- Document data access in your organization

---

## Test Evidence

Key claims are verified by automated tests:

| Claim | Test File |
|-------|-----------|
| No secrets stored at rest | `test_secret_redaction.py` |
| PAT never in database | `test_secret_redaction.py` |
| PAT masked in logs | `test_logging_config.py` |
| run_summary.json always written | `test_run_summary.py` |
| Non-zero exit on failure | `test_cli_exit_code.py` |
| Outputs reproducible | `test_golden_outputs.py` |

---

## See Also

- [Runbook](runbook.md) — Operational procedures
- [Invariants](../../agents/INVARIANTS.md) — System guarantees
