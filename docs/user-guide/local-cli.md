# CLI User Guide

How to use the Python CLI for local PR analysis and custom CI/CD integration.

---

## Prerequisites

| Requirement | Details |
|---|---|
| Python | 3.12, 3.13, or 3.14 |
| Azure DevOps PAT | Code (Read) scope — see [PAT setup in the extension guide](extension.md#step-2--create-a-personal-access-token-pat) (canonical) |

---

## Install

```bash
pipx install ado-git-repo-insights        # recommended — isolated, PATH handled
uv tool install ado-git-repo-insights     # alternative — same frictionless shape
pip install ado-git-repo-insights         # advanced — may need `ado-insights setup-path`
```

Verify with `ado-insights --version`. Diagnose install issues with `ado-insights doctor` (prints install location, PATH status, conflicts) — see [troubleshooting](troubleshooting.md) for installer-specific recipes (Ansible, Docker, scripted PATH setup, validation in CI/CD).

### ML extras

```bash
pipx inject ado-git-repo-insights prophet openai
# or:
pip install ado-git-repo-insights[ml]
```

Setup details and AI-insights configuration: [Enable ML Features](enable-ml-features.md).

---

## Quick Start

Set your PAT (one-time):

```bash
# Linux/macOS
export ADO_PAT="your-pat-here"
# Windows PowerShell
$env:ADO_PAT = "your-pat-here"
```

### 1. Extract PRs

```bash
ado-insights extract \
  --organization MyOrg \
  --projects "ProjectOne,ProjectTwo" \
  --pat $ADO_PAT \
  --database ./ado-insights.sqlite
```

Creates or updates a SQLite database with PR data using UPSERT semantics.

### 2. Generate CSVs

```bash
ado-insights generate-csv \
  --database ./ado-insights.sqlite \
  --output ./csv_output
```

Output files (one per dimension): `organizations.csv`, `projects.csv`, `repositories.csv`, `pull_requests.csv`, `users.csv`, `reviewers.csv`. Schema: [CSV Schema](../reference/csv-schema.md).

### 3. View the dashboard

**From production pipeline artifacts (recommended)**:

```bash
ado-insights stage-artifacts \
  --org MyOrg --project MyProject --pipeline-id 123 \
  --pat $ADO_PAT --out ./run_artifacts
ado-insights dashboard --dataset ./run_artifacts --open
```

`stage-artifacts` selects the most recent completed build (status `succeeded` or `partiallySucceeded`); legacy nested `aggregates/aggregates` layouts are auto-flattened.

**From a local database (dev)**:

```bash
ado-insights build-aggregates --db ./ado-insights.sqlite --out ./run_artifacts
ado-insights dashboard --dataset ./run_artifacts --open
```

Use `stage-artifacts` for production analysis; `build-aggregates` is for local iteration.

**Synthetic / demo data**:

```bash
python scripts/build-demo-dataset.py --commit-canonical
ado-insights dashboard --dataset ./artifacts/demo-enterprise/data --open
```

The same canonical dataset backs the [public demo](https://oddessentials.github.io/ado-git-repo-insights/) (mirrored in `docs/data/`). Promotion policy: [DEMO-DATA-VERSIONING.md](../DEMO-DATA-VERSIONING.md).

Dashboard flags: `--port 8080` (default), `--open` (auto-launch browser).

---

## Date range behavior

| Mode | Start date | End date |
|---|---|---|
| First run | Jan 1 of current year | Yesterday |
| Incremental | Last extraction + 1 day | Yesterday |
| Backfill | Today − backfill days | Yesterday |

**Why yesterday?** PRs closed today may still receive updates (reviewer votes, comments). Override with `--start-date YYYY-MM-DD` and/or `--end-date YYYY-MM-DD` for historical extraction or to include today's data.

---

## Incremental vs backfill mode

Daily incremental (default): `ado-insights extract ...` — only new PRs since last run.

Recent-window backfill (catches late changes like reviewer votes):

```bash
ado-insights extract ... --backfill-days 60
```

Recommended schedule: daily incremental + weekly Sunday backfill of last 60 days.

### Backfill historical PR comments

`--backfill-days` does not backfill comment thread data — for comments coverage on historical PRs (after enabling `--include-comments` on extract), use the dedicated subcommand:

```bash
ado-insights backfill-comments \
  --organization MyOrg --pat $ADO_PAT \
  --database ./ado-insights.sqlite \
  --limit 2500
```

The behavior, sizing guidance, observable signals, and inputs-rejected-in-this-mode constraints are identical to the ADO task. See the canonical narrative: [Backfilling Historical PR Comments](extension.md#backfilling-historical-pr-comments). CLI-specific flag reference: [cli-reference.md § backfill-comments](../reference/cli-reference.md#backfill-comments).

---

## Configuration file

For complex setups:

```yaml
# config.yaml
organization: MyOrg
projects:
  - ProjectOne
  - ProjectTwo
  - Project%20Three  # URL-encoded names supported

api:
  base_url: https://dev.azure.com
  version: 7.1-preview.1
  rate_limit_sleep_seconds: 0.5
  max_retries: 3
  retry_delay_seconds: 5
  retry_backoff_multiplier: 2.0

backfill:
  enabled: true
  window_days: 60
```

```bash
ado-insights extract --config config.yaml --pat $ADO_PAT
```

---

## CI/CD Integration

### GitHub Actions

```yaml
name: PR Metrics
on:
  schedule:
    - cron: '0 6 * * *'
  workflow_dispatch:

jobs:
  extract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install ado-git-repo-insights
      - uses: actions/download-artifact@v4
        with:
          name: ado-insights-db
          path: ./data
        continue-on-error: true
      - run: |
          ado-insights extract \
            --organization ${{ vars.ADO_ORG }} \
            --projects "${{ vars.ADO_PROJECTS }}" \
            --pat ${{ secrets.ADO_PAT }} \
            --database ./data/ado-insights.sqlite
      - run: |
          ado-insights generate-csv \
            --database ./data/ado-insights.sqlite \
            --output ./csv_output
      - uses: actions/upload-artifact@v4
        with:
          name: ado-insights-db
          path: ./data/ado-insights.sqlite
      - uses: actions/upload-artifact@v4
        with:
          name: csv-output
          path: ./csv_output/
```

### Azure DevOps Pipeline (CLI)

```yaml
trigger: none
pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: UsePythonVersion@0
    inputs:
      versionSpec: '3.12'
  - script: pip install ado-git-repo-insights
    displayName: 'Install'
  - task: DownloadPipelineArtifact@2
    continueOnError: true
    inputs:
      artifact: ado-insights-db
      path: $(System.DefaultWorkingDirectory)/data
  - script: |
      ado-insights extract \
        --organization $(ADO_ORG) --projects "$(ADO_PROJECTS)" \
        --pat $(PAT_SECRET) \
        --database $(System.DefaultWorkingDirectory)/data/ado-insights.sqlite
    displayName: 'Extract PRs'
  - script: |
      ado-insights generate-csv \
        --database $(System.DefaultWorkingDirectory)/data/ado-insights.sqlite \
        --output $(System.DefaultWorkingDirectory)/csv_output
    displayName: 'Generate CSVs'
  - task: PublishPipelineArtifact@1
    condition: succeeded()
    inputs:
      targetPath: $(System.DefaultWorkingDirectory)/data/ado-insights.sqlite
      artifact: ado-insights-db
  - task: PublishPipelineArtifact@1
    condition: succeeded()
    inputs:
      targetPath: $(System.DefaultWorkingDirectory)/csv_output
      artifact: csv-output
```

For ADO with the bundled task UI rather than scripted CLI, use the Marketplace [extension](extension.md) instead.

---

## Output

| Path | Purpose |
|---|---|
| `./ado-insights.sqlite` | Authoritative PR data store |
| `./csv_output/*.csv` | PowerBI-compatible exports |
| `./run_artifacts/` | Logs (`logs.jsonl` with `--log-format jsonl`) and `run_summary.json` |
| `./run_artifacts/run_summary.json` | Always written, even on failure — useful for debugging |

`run_summary.json` shape:

```json
{
  "status": "success",
  "start_time": "2026-01-19T06:00:00Z",
  "end_time": "2026-01-19T06:05:23Z",
  "projects": [{"name": "Project1", "prs_extracted": 42, "status": "success"}],
  "total_prs": 42,
  "first_error": null
}
```

Set `PYTHONLOGLEVEL=DEBUG` for verbose console logging.

---

## Recovery

The SQLite database is the source of truth; deleting it deletes all retained history. To recover:

```bash
rm ./ado-insights.sqlite
ado-insights extract ... --start-date YYYY-MM-DD       # bootstrap from a historical date
```

---

## Next steps

- [CLI Command Reference](../reference/cli-reference.md) — full command and flag inventory
- [Troubleshooting](troubleshooting.md)
- [CSV Schema](../reference/csv-schema.md) — output file specifications
- [Architecture](../reference/architecture.md) — system design diagrams
</content>
