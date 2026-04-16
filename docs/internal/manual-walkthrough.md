# Manual Testing Walkthrough

Manual tests for the full product surface. CLI subcommands (sections 1-4, 6) were
validated against the current argument parser. Script and pnpm entrypoints (section 5)
were verified against their package definitions.

> **Flag asymmetry warning:** `extract` uses `--organization` / `--projects` (plural).
> `stage-artifacts` uses `--org` / `--project` (singular). Do not mix them.

---

## Prerequisites

- Python 3.12+
- Node.js 22+ and pnpm 9.15.0
- Azure DevOps PAT (scope depends on section -- see inline notes)
- `pip install -e ".[dev]"` or `uv tool install -e .`

---

## 1. Synthetic Demo Dashboard

Proves the dashboard renders from the canonical enterprise demo dataset.
No PAT or network access needed.

```powershell
ado-insights dashboard --dataset ./docs/data --open
```

Verify: Dashboard loads with review time data, filters work, all tabs render.

---

## 2. CLI End-to-End Pipeline (Real ADO)

> **PAT scope:** Code (Read)

Proves extract -> build-aggregates -> dashboard works against a real org.

```powershell
$env:PAT="<your-pat>"

# Step 1: Extract (single project, with comments)
ado-insights extract `
  --organization oddessentials `
  --projects oddessentials `
  --include-comments `
  --pat $env:PAT

# Step 2: Build aggregates from the extracted database
ado-insights build-aggregates `
  --db ado-insights.sqlite `
  --out ./run_artifacts

# Step 3: View dashboard
ado-insights dashboard --dataset ./run_artifacts --open
```

Verify: SQLite created, aggregates generated, dashboard shows real data.

---

## 3. Multi-Project Extraction with Comments

> **PAT scope:** Code (Read)

Proves multi-project extraction and comment caps work correctly.

```powershell
# Bounded extraction (50 PRs with comments)
python -m ado_git_repo_insights extract `
  --pat $env:PAT `
  --organization oddessentials `
  --projects hospitality,marketing,engineering,oddessentials `
  --include-comments `
  --comments-max-prs-per-run 50 `
  --comments-max-threads-per-pr 0

# Full extraction (all PRs with comments, no cap)
python -m ado_git_repo_insights extract `
  --pat $env:PAT `
  --organization oddessentials `
  --projects hospitality,marketing,engineering,oddessentials `
  --include-comments `
  --comments-max-prs-per-run 999999 `
  --comments-max-threads-per-pr 0

# Build and view
python -m ado_git_repo_insights build-aggregates `
  --db ado-insights.sqlite `
  --out ./run_artifacts

python -m ado_git_repo_insights dashboard `
  --dataset ./run_artifacts --open
```

Verify: Multiple projects appear in filters, comments coverage shown in
dashboard run info.

---

## 4. Stage Artifacts from Production Pipeline

> **PAT scope:** Build (Read)

Proves the stage-artifacts -> dashboard flow works against a real ADO pipeline.

```powershell
ado-insights stage-artifacts `
  --org oddessentials `
  --project oddessentials `
  --pipeline-id 15 `
  --pat $env:PAT `
  --out ./run_artifacts `
  --serve --open
```

Verify: Artifacts downloaded, dashboard auto-opens, data matches pipeline run.

---

## 5. Extension Manual Tests

### 5a. Pre-check (local PR preflight)

```powershell
python scripts/run_pr_preflight.py
```

Verify: All gates pass (mypy, tests, lint, parity, extension checks).

### 5b. Build Dev VSIX

```powershell
cd extension
pnpm run package:vsix:dev
```

Verify: `.vsix` file produced in `extension/` directory.

### 5c. Performance Baseline Update

```powershell
cd extension
pnpm run perf:update-baseline
```

Verify: Baselines updated in `extension/tests/fixtures/perf-baselines.json`.

---

## 6. CLI Package Install Test

Proves the package installs and runs from a tool environment.

```powershell
uv tool install -e .
ado-insights --version
ado-insights doctor
```

Verify: Version prints, doctor shows no conflicts.

---

## CLI Flag Quick Reference

| Subcommand | Org flag | Project flag | Notes |
|------------|----------|--------------|-------|
| `extract` | `--organization` | `--projects` (plural, comma-sep) | `--database` defaults to `./ado-insights.sqlite` |
| `stage-artifacts` | `--org` | `--project` (singular) | `--out` defaults to `./run_artifacts` |
| `build-aggregates` | N/A | N/A | `--db` is required, `--out` defaults to `./dataset` |
| `dashboard` | N/A | N/A | `--dataset` defaults to `./run_artifacts` |

---

## See Also

- [Testing Guide](../development/testing.md) -- Automated test organization and patterns
- [Enable ML Features](enable-ml-features.md) -- Detailed ML pipeline setup
- [CLI Command Reference](../reference/cli-reference.md) -- All commands and options
