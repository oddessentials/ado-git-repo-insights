# CLI User Guide

This guide covers using the Python CLI for local PR analysis and custom CI/CD integration.

---

## What You Get

- **Command-line tool** for extraction and CSV generation
- **Local dashboard server** for viewing metrics
- **Configuration file support** for complex setups
- **Works anywhere Python runs** — local machines, GitHub Actions, Jenkins, etc.

---

## Prerequisites

| Requirement | Details |
|-------------|---------|
| Python | 3.10, 3.11, or 3.12 |
| Azure DevOps PAT | Code (Read) scope |

---

## Installation

### Recommended: pipx (Frictionless)

pipx handles PATH configuration automatically and isolates dependencies:

```bash
# Install pipx if needed
python -m pip install --user pipx
pipx ensurepath

# Install ado-insights
pipx install ado-git-repo-insights

# Verify
ado-insights --version
```

### Alternative: uv (Frictionless)

uv is a fast, modern alternative with similar frictionless installation:

```bash
# Install uv if needed (see https://astral.sh/uv)
# Then install ado-insights
uv tool install ado-git-repo-insights

# Verify
ado-insights --version
```

### Advanced: pip (Manual PATH Setup)

For developers who prefer pip directly:

```bash
pip install ado-git-repo-insights
```

If `ado-insights` is not found after installation, run:

```bash
# Option 1: Automatic PATH setup
ado-insights setup-path

# Option 2: See the command without modifying files
ado-insights setup-path --print-only
```

Then restart your terminal.

### Verify Installation

```bash
ado-insights --version
```

### Diagnose Issues

If you encounter problems:

```bash
ado-insights doctor
```

This shows installation location, PATH status, and detects conflicts.

### Optional: ML Features

For Prophet forecasting and AI insights:

```bash
# pipx
pipx inject ado-git-repo-insights prophet openai

# pip
pip install ado-git-repo-insights[ml]
```

---

## Quick Start

### 1. Set Up Your PAT

Create a PAT in Azure DevOps with **Code (Read)** scope:
1. Azure DevOps → Profile → Personal access tokens → + New Token
2. Scope: Code → Read
3. For multi-org setups, enable "All accessible organizations"

Store it as an environment variable:

```bash
# Linux/macOS
export ADO_PAT="your-pat-here"

# Windows PowerShell
$env:ADO_PAT = "your-pat-here"
```

### 2. Extract PR Data

```bash
ado-insights extract \
  --organization MyOrg \
  --projects "ProjectOne,ProjectTwo" \
  --pat $ADO_PAT \
  --database ./ado-insights.sqlite
```

**What happens:**
1. Creates a SQLite database (or updates existing)
2. Fetches completed PRs from the Azure DevOps API
3. Stores data with UPSERT semantics

### 3. Generate CSVs

```bash
ado-insights generate-csv \
  --database ./ado-insights.sqlite \
  --output ./csv_output
```

**Output files:**
- `organizations.csv`
- `projects.csv`
- `repositories.csv`
- `pull_requests.csv`
- `users.csv`
- `reviewers.csv`

### 4. View the Dashboard

**Option A: Production Artifacts (Recommended)**

Download artifacts from your Azure DevOps pipeline:

```bash
ado-insights stage-artifacts \
  --org MyOrg \
  --project MyProject \
  --pipeline-id 123 \
  --pat $ADO_PAT \
  --out ./run_artifacts

# Start the dashboard server
ado-insights dashboard --dataset ./run_artifacts --open
```

> **Build Selection:** The command selects the most recent completed build with
> result `succeeded` or `partiallySucceeded`. Artifacts from partially succeeded
> builds are valid and usable — only non-critical pipeline stages failed.

> **Layout Normalization:** If the artifact has a nested `aggregates/aggregates`
> structure (legacy layout), it is automatically flattened during extraction.
> The normalized layout has `dataset-manifest.json` at the root.



**Option B: Local Database (Dev Mode)**

Generate from a local SQLite database:

```bash
# Generate aggregates first
ado-insights build-aggregates \
  --db ./ado-insights.sqlite \
  --out ./run_artifacts

# Start the dashboard server
ado-insights dashboard --dataset ./run_artifacts --open
```

> ⚠️ **Note:** `build-aggregates` is intended for local development. For production use, prefer `stage-artifacts` to download validated pipeline artifacts.

**Option C: Synthetic Testing**

Generate synthetic data for UI testing:

```bash
# Generate test data
python scripts/generate-synthetic-dataset.py \
  --pr-count 100 \
  --output ./run_artifacts \
  --seed 42

# Start the dashboard server
ado-insights dashboard --dataset ./run_artifacts --open
```

Dashboard options:
- `--port 8080` — HTTP server port (default: 8080)
- `--open` — Automatically open browser

---

## Date Range Behavior

### Default Behavior

| Mode | Start Date | End Date |
|------|------------|----------|
| First run | January 1 of current year | Yesterday |
| Incremental | Last extraction date + 1 day | Yesterday |
| Backfill | Today minus backfill days | Yesterday |

**Why yesterday?** PRs closed today may still receive updates (reviewer votes, comments). Extracting yesterday ensures complete data.

### Override Dates

```bash
# Include today's data
ado-insights extract \
  --organization MyOrg \
  --projects "Project1" \
  --pat $ADO_PAT \
  --database ./ado-insights.sqlite \
  --end-date $(date +%Y-%m-%d)

# Extract specific range
ado-insights extract \
  --organization MyOrg \
  --projects "Project1" \
  --pat $ADO_PAT \
  --database ./ado-insights.sqlite \
  --start-date 2024-01-01 \
  --end-date 2024-12-31
```

---

## Incremental vs Backfill Mode

### Daily Incremental (Default)

Extracts only new PRs since last run:

```bash
ado-insights extract \
  --organization MyOrg \
  --projects "Project1" \
  --pat $ADO_PAT \
  --database ./ado-insights.sqlite
```

### Backfill Mode

Re-extracts recent data to catch late changes (reviewer votes, status updates):

```bash
ado-insights extract \
  --organization MyOrg \
  --projects "Project1" \
  --pat $ADO_PAT \
  --database ./ado-insights.sqlite \
  --backfill-days 60
```

**Recommended schedule:**
| Schedule | Mode | Purpose |
|----------|------|---------|
| Daily | Incremental | Capture new PRs |
| Weekly (Sundays) | Backfill 60 days | Convergence for late changes |

---

## Configuration File

For complex setups, use a YAML configuration file:

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

Use with:

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
    - cron: '0 6 * * *'  # Daily at 6 AM UTC
  workflow_dispatch:

jobs:
  extract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install
        run: pip install ado-git-repo-insights

      - name: Download previous database
        uses: actions/download-artifact@v4
        with:
          name: ado-insights-db
          path: ./data
        continue-on-error: true

      - name: Extract
        run: |
          ado-insights extract \
            --organization ${{ vars.ADO_ORG }} \
            --projects "${{ vars.ADO_PROJECTS }}" \
            --pat ${{ secrets.ADO_PAT }} \
            --database ./data/ado-insights.sqlite

      - name: Generate CSVs
        run: |
          ado-insights generate-csv \
            --database ./data/ado-insights.sqlite \
            --output ./csv_output

      - name: Upload database
        uses: actions/upload-artifact@v4
        with:
          name: ado-insights-db
          path: ./data/ado-insights.sqlite

      - name: Upload CSVs
        uses: actions/upload-artifact@v4
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
      versionSpec: '3.11'

  - script: pip install ado-git-repo-insights
    displayName: 'Install'

  - task: DownloadPipelineArtifact@2
    displayName: 'Download Previous DB'
    continueOnError: true
    inputs:
      artifact: ado-insights-db
      path: $(System.DefaultWorkingDirectory)/data

  - script: |
      ado-insights extract \
        --organization $(ADO_ORG) \
        --projects "$(ADO_PROJECTS)" \
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

---

## Enterprise & Scripted Deployment

All installation commands are **non-interactive** and suitable for automated deployments.

### Non-Interactive Installation

```bash
# All methods work without user prompts:
pipx install ado-git-repo-insights       # No prompts
uv tool install ado-git-repo-insights    # No prompts
pip install ado-git-repo-insights        # No prompts
```

### Scripted PATH Configuration

For automated deployments where PATH setup needs to be scripted:

**Option 1: Capture and Execute**

```bash
# Bash/Linux
PATH_CMD=$(python -m ado_git_repo_insights.cli setup-path --print-only)
echo "$PATH_CMD" >> ~/.bashrc
source ~/.bashrc
```

```powershell
# PowerShell/Windows
$pathCmd = python -m ado_git_repo_insights.cli setup-path --print-only
Add-Content $PROFILE $pathCmd
. $PROFILE
```

**Option 2: Direct Execution**

```bash
# Bash - append to profile automatically
ado-insights setup-path

# Verify (in new shell)
ado-insights --version
```

### Ansible Playbook Example

```yaml
- name: Install ado-insights
  hosts: analytics_servers
  tasks:
    - name: Install via pipx
      community.general.pipx:
        name: ado-git-repo-insights
        state: present

    - name: Verify installation
      command: ado-insights --version
      changed_when: false
```

### Docker Deployment

```dockerfile
FROM python:3.11-slim

RUN pip install --no-cache-dir pipx && \
    pipx install ado-git-repo-insights && \
    pipx ensurepath

# pipx installs to /root/.local/bin
ENV PATH="/root/.local/bin:$PATH"

ENTRYPOINT ["ado-insights"]
```

### Validation in CI/CD

```bash
# Validate installation succeeded
ado-insights doctor

# Check exit code: 0 = OK, 1 = issues detected
if [ $? -ne 0 ]; then
    echo "Installation issues detected"
    exit 1
fi
```

---

## Output Artifacts

### Run Summary

Every extraction writes `run_artifacts/run_summary.json`:

```json
{
  "status": "success",
  "start_time": "2026-01-19T06:00:00Z",
  "end_time": "2026-01-19T06:05:23Z",
  "projects": [
    {"name": "Project1", "prs_extracted": 42, "status": "success"}
  ],
  "total_prs": 42,
  "first_error": null
}
```

Written even on failure for debugging.

### Logging

- **Default:** Console output (INFO level)
- **JSONL logging:** `--log-format jsonl` → `run_artifacts/logs.jsonl`
- **Debug mode:** `export PYTHONLOGLEVEL=DEBUG`

---

## Data Storage

### Where Data Lives

| File | Purpose |
|------|---------|
| `ado-insights.sqlite` | Authoritative PR data store |
| `csv_output/*.csv` | Derived PowerBI-compatible exports |
| `dataset/` | Dashboard aggregates |
| `run_artifacts/` | Logs and run summary |

### Retention

- Data persists as long as the database file exists
- Deleting the file deletes all retained history
- Incremental runs update the same file over time

### Recovery

If the database is corrupted or missing:
1. Delete the file
2. Re-run extraction with `--start-date` to specify historical range

---

## Next Steps

- [CLI Command Reference](../reference/cli-reference.md) — All commands and options
- [Troubleshooting](troubleshooting.md) — Common issues and solutions
- [CSV Schema](../reference/csv-schema.md) — Output file specifications
- [Architecture](../reference/architecture.md) — System design diagrams

---

## Support

For issues and feature requests, visit the [GitHub repository](https://github.com/oddessentials/ado-git-repo-insights).
