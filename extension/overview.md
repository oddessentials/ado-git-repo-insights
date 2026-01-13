# Git Repo Insights

Extract Azure DevOps Pull Request metrics and generate PowerBI-compatible CSVs.

## Features

- **Incremental Extraction**: Daily runs fetch only new PRs, minimizing API calls
- **Periodic Backfill**: Weekly mode re-extracts recent data to catch late changes
- **PowerBI Compatible**: CSV schemas match exactly for seamless dashboard integration
- **Deterministic Output**: Stable row ordering for diff-friendly validation
- **SQLite Persistence**: Artifact-based state management with pipeline integration

## Quick Start

1. **Add the task to your pipeline**:
   ```yaml
   - task: ExtractPullRequests@1
     inputs:
       organization: MyOrg
       projects: |
         ProjectA
         ProjectB
       pat: $(PAT_SECRET)
   ```

2. **Publish artifacts**:
   ```yaml
   - publish: $(Pipeline.Workspace)/data
     artifact: ado-insights-db
     condition: succeeded()

   - publish: $(Pipeline.Workspace)/csv_output
     artifact: csv-reports
     condition: succeeded()
   ```

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `organization` | Yes | Azure DevOps organization name |
| `projects` | Yes | Project names (one per line or comma-separated) |
| `pat` | Yes | PAT with Code (Read) scope |
| `database` | No | SQLite database path (default: `$(Pipeline.Workspace)/data/ado-insights.sqlite`) |
| `outputDir` | No | CSV output directory (default: `$(Pipeline.Workspace)/csv_output`) |
| `startDate` | No | Override start date (YYYY-MM-DD) |
| `endDate` | No | Override end date (YYYY-MM-DD) |
| `backfillDays` | No | Days to backfill for convergence |

## CSV Outputs

Generated files in the output directory:

| File | Description |
|------|-------------|
| `organizations.csv` | Organization records |
| `projects.csv` | Project records |
| `repositories.csv` | Repository records |
| `pull_requests.csv` | Pull request details with cycle time |
| `users.csv` | User records |
| `reviewers.csv` | PR reviewer votes |

## Requirements

- **Python 3.10+** on the agent
- **PAT Scope**: Code (Read)

## Support

For issues and feature requests, visit the [GitHub repository](https://github.com/your-org/ado-git-repo-insights).
