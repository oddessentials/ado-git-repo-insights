# agents/victory-gate.md — ado-git-repo-insights

This document defines the **Victory Gate** for ado-git-repo-insights.
A phase is not complete until **every step below passes without manual intervention**.
This is the final “are we actually done?” check before advancing phases.

---

## 🎯 Victory Gate Principle

> If the system cannot be verified end-to-end using only documented commands and CI,
> it is not production-ready and the phase is not complete.

---

## 1) Local Developer Victory Gate

These steps must pass on a clean machine with only Python, Node, and Docker (optional).

### 1.1 Environment Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
```

````

### 1.2 Unit & Contract Tests

```bash
# Lint + format
ruff check .
ruff format --check .

# Type checking (if enabled)
mypy src/

# Unit tests
pytest tests/unit
```

**Gate:** All unit tests pass, no warnings, no skipped contract tests.

---

### 1.3 Integration: SQLite → CSV Determinism

```bash
pytest tests/integration/test_golden_outputs.py
```

**Gate:**

- CSV schemas match exactly
- Output hashes are stable across runs

---

### 1.4 Integration: Incremental Extraction

```bash
pytest tests/integration/test_incremental_run.py
```

**Gate:**

- No duplicate logical rows
- Extraction metadata advances correctly
- UPSERT behavior converges

---

### 1.5 Integration: Backfill Convergence

```bash
pytest tests/integration/test_backfill_convergence.py
```

**Gate:**

- Late PR changes are corrected
- SQLite and CSV outputs reflect updated state

---

## 2) CLI Victory Gate (Local, Realistic Usage)

### 2.1 First-Run (No Existing SQLite)

```bash
ado-insights extract \
  --organization ExampleOrg \
  --projects ProjectA,ProjectB \
  --pat REDACTED \
  --database ./tmp/ado-insights.sqlite
```

**Gate:**

- SQLite database created
- Tables populated
- Extraction summary printed

---

### 2.2 CSV Generation

```bash
ado-insights generate-csv \
  --database ./tmp/ado-insights.sqlite \
  --output ./tmp/csv_output
```

**Gate:**

- All CSVs generated
- Column order matches contract
- No runtime errors

---

### 2.3 Repeatability Check

```bash
ado-insights generate-csv \
  --database ./tmp/ado-insights.sqlite \
  --output ./tmp/csv_output_2
```

**Gate:**

- CSV contents identical to previous output (hash match)

---

## 3) Pipeline Victory Gate (Hosted Agent)

### 3.1 Clean Pipeline Run

- Run the sample pipeline on `ubuntu-latest`
- No pre-existing artifacts

**Gate:**

- Pipeline succeeds
- SQLite + CSV artifacts published

---

### 3.2 Incremental Pipeline Run

- Run the pipeline again without deleting artifacts

**Gate:**

- Artifact SQLite downloaded
- Incremental extraction performed
- Artifacts re-published
- No data duplication

---

### 3.3 Failure Safety Check

- Force a failure (e.g., invalid PAT)

**Gate:**

- Pipeline fails
- Previous SQLite artifact remains intact
- No partial CSVs published

---

## 4) Extension Victory Gate

### 4.1 Extension Packaging

```bash
cd extension
tfx extension create --manifest-globs vss-extension.json
```

**Gate:**

- `.vsix` produced successfully

---

### 4.2 Extension Task Execution

- Install extension in test ADO organization
- Create a pipeline using the task

**Gate:**

- Task executes without agent-specific hacks
- Logs show:

  - organization
  - project list
  - counts extracted
  - artifact paths used

- PAT is never logged

---

## 5) PowerBI Compatibility Victory Gate

### 5.1 Import Test

- Import generated CSVs into the existing PowerBI model

**Gate:**

- No schema errors
- No manual column fixes
- Measures and visuals still compute

---

### 5.2 Regression Confidence

- Compare row counts and sample rows with legacy system (if still available)

**Gate:**

- Differences are explainable and intentional
- No unexplained missing data

---

## 6) Final Release Gate

### 6.1 CI Green

- All CI checks passing on `main`
- Coverage thresholds met

### 6.2 Versioned Release

```bash
git tag v1.0.0
git push origin v1.0.0
```

**Gate:**

- Python package builds
- VSIX builds
- Release artifacts published

---

## 🟢 Exit Criteria

A phase is complete only when:

- All gates above pass
- Invariants are preserved
- No undocumented manual steps were required

If a gate fails:

> **Stop. Fix. Re-run from the top.**

---

## Ownership

- **Invariants:** agents/INVARIANTS.md
- **Completion Criteria:** agents/definition-of-done.md
- **Final Verification:** this document
````
