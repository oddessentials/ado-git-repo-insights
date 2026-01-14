# ado-git-repo-insights

![CI](https://github.com/oddessentials/ado-git-repo-insights/actions/workflows/ci.yml/badge.svg)
[![codecov](https://codecov.io/gh/oddessentials/ado-git-repo-insights/graph/badge.svg)](https://codecov.io/gh/oddessentials/ado-git-repo-insights)
![Python](https://img.shields.io/badge/python-3.10%20%7C%203.11%20%7C%203.12-blue)
![License](https://img.shields.io/badge/license-MIT-green)

Extract Azure DevOps Pull Request metrics to SQLite and generate PowerBI-compatible CSVs.

## Overview

This tool replaces the MongoDB-based `ado-pull-request-metrics` with a lightweight, file-based solution that:

- **Stores data in SQLite** - No external database required
- **Runs as an Azure DevOps Pipeline Task** - Scheduled daily extraction
- **Preserves the PowerBI CSV contract** - Same filenames, columns, and ordering
- **Supports incremental + backfill extraction** - Efficient daily updates with periodic convergence

## Quick Start

### Installation

```bash
pip install ado-git-repo-insights
```

## Usage Options

This tool provides **two ways** to extract Azure DevOps Pull Request metrics:

| Aspect | CLI (Option 1) | Extension (Option 2) |
|--------|----------------|----------------------|
| **Requires Python** | Yes | No (bundled) |
| **Installation** | `pip install` | Upload VSIX to ADO |
| **Pipeline syntax** | Script steps | Task step |
| **Works outside ADO** | Yes | No (ADO only) |
| **Flexibility** | Higher | Standard |

### Option 1: Python CLI

Best for users comfortable with Python/pip, custom scripts, and non-ADO CI/CD systems.


#### First Run (Extract Data)

```bash
ado-insights extract \
  --organization MyOrg \
  --projects "ProjectOne,ProjectTwo" \
  --pat $ADO_PAT \
  --database ./ado-insights.sqlite
```

> **Note**: End date defaults to yesterday (to avoid incomplete data).
> Include today: `--end-date $(date +%Y-%m-%d)` (Bash) or `--end-date (Get-Date -Format yyyy-MM-dd)` (PowerShell)

#### Generate CSVs

```bash
ado-insights generate-csv \
  --database ./ado-insights.sqlite \
  --output ./csv_output
```

#### Backfill Mode (Weekly Convergence)

```bash
ado-insights extract \
  --organization MyOrg \
  --projects "ProjectOne,ProjectTwo" \
  --pat $ADO_PAT \
  --database ./ado-insights.sqlite \
  --backfill-days 60
```

### Option 2: Azure DevOps Extension

Best for teams that prefer the ADO pipeline editor UI or want a self-contained task without managing Python dependencies.

```yaml
steps:
  - task: ExtractPullRequests@1
    inputs:
      organization: 'MyOrg'
      projects: 'Project1,Project2'
      pat: '$(PAT_SECRET)'
      database: '$(Pipeline.Workspace)/data/ado-insights.sqlite'
      outputDir: '$(Pipeline.Workspace)/csv_output'
```

**Installation:**
1. Download the `.vsix` from [GitHub Releases](https://github.com/oddessentials/ado-git-repo-insights/releases)
2. Install in your ADO organization: Organization Settings → Extensions → Browse local extensions

## Configuration

Create a `config.yaml` file:

```yaml
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

Then run:

```bash
ado-insights extract --config config.yaml --pat $ADO_PAT
```

## Azure DevOps Pipeline Integration

See [sample-pipeline.yml](sample-pipeline.yml) for a complete example.

### Scheduled Daily Extraction

```yaml
schedules:
  - cron: "0 6 * * *"  # Daily at 6 AM UTC
    displayName: "Daily PR Extraction"
    branches:
      include: [main]
    always: true
```

### Weekly Backfill

```yaml
schedules:
  - cron: "0 6 * * 0"  # Weekly on Sunday
    displayName: "Weekly Backfill"
    branches:
      include: [main]
    always: true
```

## CSV Output Contract

The following CSVs are generated with **exact schema and column order** for PowerBI compatibility:

| File | Columns |
|------|---------|
| `organizations.csv` | `organization_name` |
| `projects.csv` | `organization_name`, `project_name` |
| `repositories.csv` | `repository_id`, `repository_name`, `project_name`, `organization_name` |
| `pull_requests.csv` | `pull_request_uid`, `pull_request_id`, `organization_name`, `project_name`, `repository_id`, `user_id`, `title`, `status`, `description`, `creation_date`, `closed_date`, `cycle_time_minutes` |
| `users.csv` | `user_id`, `display_name`, `email` |
| `reviewers.csv` | `pull_request_uid`, `user_id`, `vote`, `repository_id` |

## Security & Permissions

### PR Insights Dashboard (Phase 3)

The PR Insights dashboard reads data from pipeline-produced artifacts. **Users must have Build Read permission** on the analytics pipeline to view dashboard data.

| Requirement | Details |
|-------------|---------|
| **Permission scope** | Build → Read on the pipeline that produces artifacts |
| **No special redaction** | Data is not filtered per-user; access is all-or-nothing |
| **Artifact retention** | Operators must configure retention for their desired analytics window |

If a user lacks permissions, the dashboard displays: *"No access to analytics pipeline artifacts. Ask an admin for Build Read on pipeline X."*

## Governance

This project is governed by authoritative documents in `agents/`:

- [INVARIANTS.md](agents/INVARIANTS.md) - 25 non-negotiable invariants
- [definition-of-done.md](agents/definition-of-done.md) - Completion criteria
- [victory-gates.md](agents/victory-gates.md) - Verification gates

## Development

```bash
# Setup
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -e .[dev]

# Lint + Format
ruff check .
ruff format .

# Type Check
mypy src/

# Test
pytest
```

## License

MIT
