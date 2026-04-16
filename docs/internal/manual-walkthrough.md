# Manual Testing Walkthrough

Manual tests for the full product surface. CLI subcommand sections were
validated against the current argument parser; the extension-manual-tests
section was verified against its package definitions. Neither set was
executed end-to-end against a live ADO instance in this audit — treat the
"Verify:" lines below as expected outcomes, not proof.

> **Flag asymmetry warning:** `extract` uses `--organization` / `--projects` (plural).
> `stage-artifacts` uses `--org` / `--project` (singular). Do not mix them.

---

## Prerequisites

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) package manager
- `uv sync --extra dev` (installs all dev dependencies into the project venv)
- Azure DevOps PAT (scope depends on section -- see inline notes)

Sections 1-4 and 6 need only the Python setup above. Sections 5 and 7
also require Node tooling:

- Node.js 22+ and pnpm 9.15.0
- `pnpm install` (repo root -- activates Husky git hooks)
- `cd extension && pnpm install && cd ..` (extension dependencies)

See [Development Setup](../development/setup.md) for the full environment guide.

---

## 1. Synthetic Demo Dashboard

Intended scenario: dashboard renders from the canonical enterprise demo dataset.
No PAT or network access needed.

```powershell
uv run ado-insights dashboard --dataset ./docs/data --open
```

Verify: Dashboard loads with review time data, filters work, all tabs render.

---

## 2. CLI End-to-End Pipeline (Real ADO)

> **PAT scope:** Code (Read)

Intended scenario: extract -> build-aggregates -> dashboard against a real org.
The `oddessentials` org/project values below are maintainer examples — substitute your own.

```powershell
$env:PAT="<your-pat>"

# Step 1: Extract (single project, with comments)
uv run ado-insights extract `
  --organization oddessentials `
  --projects oddessentials `
  --include-comments `
  --pat $env:PAT

# Step 2: Build aggregates from the extracted database
uv run ado-insights build-aggregates `
  --db ado-insights.sqlite `
  --out ./run_artifacts

# Step 3: View dashboard
uv run ado-insights dashboard --dataset ./run_artifacts --open
```

Verify: SQLite created, aggregates generated, dashboard shows real data.

---

## 3. Multi-Project Extraction with Comments

> **PAT scope:** Code (Read)

Intended scenario: multi-project extraction with comment caps. The project list below is org-specific — substitute your own.

```powershell
# Bounded extraction (50 PRs with comments)
uv run ado-insights extract `
  --pat $env:PAT `
  --organization oddessentials `
  --projects hospitality,marketing,engineering,oddessentials `
  --include-comments `
  --comments-max-prs-per-run 50 `
  --comments-max-threads-per-pr 0  # 0 = unlimited threads per PR

# Full extraction (all PRs with comments, no cap)
uv run ado-insights extract `
  --pat $env:PAT `
  --organization oddessentials `
  --projects hospitality,marketing,engineering,oddessentials `
  --include-comments `
  --comments-max-prs-per-run 999999 `
  --comments-max-threads-per-pr 0  # 0 = unlimited threads per PR

# Build and view
uv run ado-insights build-aggregates `
  --db ado-insights.sqlite `
  --out ./run_artifacts

uv run ado-insights dashboard `
  --dataset ./run_artifacts --open
```

Verify: Multiple projects appear in filters, comments coverage shown in
dashboard run info.

---

## 4. Stage Artifacts from Production Pipeline

> **PAT scope:** Build (Read)

Intended scenario: stage-artifacts -> dashboard against a real ADO pipeline. `--pipeline-id 15` below is a maintainer example — substitute your pipeline ID.

```powershell
uv run ado-insights stage-artifacts `
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
uv run python scripts/run_pr_preflight.py
```

Verify: All gates pass (mypy, tests, lint, parity, extension checks).

### 5b. Build Dev VSIX

```powershell
cd extension
pnpm run package:vsix:dev
```

Verify: `.vsix` file produced in `extension/` directory.

---

## 6. Standalone CLI Install Test

Intended scenario: the package installs and runs as a standalone tool (outside the repo venv).
This is a separate context from the `uv sync` development environment used above.

```powershell
uv tool install -e .
ado-insights --version
ado-insights doctor
```

Verify: Version prints, doctor shows no conflicts.

---

## Troubleshooting

If any scenario above fails, see:
- [Troubleshooting Guide](../user-guide/troubleshooting.md) — installation,
  auth, extraction, dashboard, and data issues
- [Testing Guide](../development/testing.md#local-pr-preflight) —
  preflight degraded mode diagnostics

---

## 7. Maintenance Tasks (main branch only)

> These tasks are for **main-branch stewardship after merge**, not part of the
> normal contributor verification flow. Do not run them on feature branches.

### 7a. Performance Baseline Update

Update performance baselines after confirming all perf tests pass on main.
See `extension/scripts/update-perf-baseline.ts` for details.

```powershell
cd extension
pnpm run perf:update-baseline
```

Verify: Baselines updated in `extension/tests/fixtures/perf-baselines.json`.
Commit the updated file.

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
