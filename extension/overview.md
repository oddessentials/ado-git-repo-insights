# Git Repo Insights

Pull request analytics for Azure DevOps — built-in dashboard with cycle time, throughput, and reviewer metrics.

Previously available via private share to select organizations; now in public preview.

## What You Get

### Core (works immediately after install)

- **PR Insights Dashboard** — Interactive dashboard embedded directly in your Azure DevOps project with cycle time trends, throughput charts, reviewer activity heatmaps, and distribution analysis
- **PR Insights Settings** — Project-level settings page for administrators to configure dashboard behavior, accessible from Project Settings
- **Automated PR Extraction** — Pipeline task extracts pull request data incrementally, minimizing API calls with smart date windowing and backfill convergence

![PR Insights Dashboard showing cycle time trends, throughput charts, and reviewer activity](screenshots/dashboard-overview.png)

### Optional Add-Ons (requires additional pipeline configuration)

- **ML Predictions** — Time-to-merge forecasting using Prophet models. Requires setting `enablePredictions: true` in the pipeline task and installing Python Prophet dependencies.
- **AI-Powered Insights** — Natural language summaries of PR trends and anomalies. Requires providing an OpenAI API key via pipeline variable.

![ML Predictions panel showing cycle time forecasts and confidence intervals](screenshots/ml-predictions.png)

![AI Insights panel with automated bottleneck analysis and recommendations](screenshots/ai-insights.png)

## Dashboard

The PR Insights Dashboard displays:

- **Total PRs** — Count of pull requests in the selected time window
- **Cycle Time P50 / P90** — Median and 90th percentile time from PR creation to completion
- **Active Contributors** — Unique PR authors in the period
- **Active Reviewers** — Unique reviewers who voted on PRs
- **Weekly Throughput** — PRs completed per week over time
- **Cycle Time Trend** — P50/P90 cycle time plotted weekly
- **Reviewer Activity** — Breakdown of review votes by team member
- **Distribution Buckets** — PRs grouped by cycle time ranges (< 1 day, 1-3 days, 3-7 days, > 7 days)

![Dashboard with compare mode active, showing filtered PR metrics](screenshots/filtering-comparison.png)

## Live Demo

Explore a working dashboard with sample data:

[View Live Demo](https://oddessentials.github.io/ado-git-repo-insights/)

> **Important**: After installing, a project administrator must enable the dashboard via **Project Settings > Preview Features > [GRI] PR Insights Dashboard**. The dashboard is not visible until this feature flag is turned on.

![PR Insights settings page in Azure DevOps Project Settings](screenshots/settings-page.png)

## Getting Started

1. **Install** — Click "Get it free" to install Git Repo Insights in your Azure DevOps organization.
2. **Enable the Dashboard** — A project or organization administrator must go to **Project Settings > Preview Features** and turn on **[GRI] PR Insights Dashboard**.
3. **Create a PAT** — Generate a Personal Access Token with **Code (Read)** scope in Azure DevOps.
4. **Store the PAT** — Add the PAT to a pipeline Variable Group named `ado-insights-secrets` as a secret variable `PAT_SECRET`.
5. **Add the Pipeline Task** — Add `ExtractPullRequests@2` to a pipeline definition (see Pipeline Task Reference below).
6. **View the Dashboard** — After a successful pipeline run, navigate to your project's Repos menu and select **PR Insights**.

![ExtractPullRequests pipeline task configuration in Azure DevOps](screenshots/pipeline-task.png)

## Pipeline Task Reference

| Input | Required | Description |
|-------|----------|-------------|
| `organization` | Yes | Azure DevOps organization name |
| `projects` | Yes | Project names (one per line or comma-separated) |
| `pat` | Yes | PAT with Code (Read) scope |
| `database` | No | SQLite database path (default: `$(Pipeline.Workspace)/data/ado-insights.sqlite`) |
| `outputDir` | No | CSV output directory |
| `startDate` | No | Override start date (YYYY-MM-DD) |
| `endDate` | No | Override end date (YYYY-MM-DD) |
| `backfillDays` | No | Days to backfill for convergence |
| `generateAggregates` | No | Generate dashboard data (default: `true`) |
| `aggregatesDir` | No | Aggregates output directory |

## CSV Output Schema

| File | Description |
|------|-------------|
| `organizations.csv` | Organization records |
| `projects.csv` | Project records |
| `repositories.csv` | Repository records |
| `pull_requests.csv` | Pull request details with cycle time |
| `users.csv` | User records |
| `reviewers.csv` | PR reviewer votes |

## Requirements

- **Azure DevOps Services** (cloud) or **Azure DevOps Server 2020+** (on-premises)
- **Node.js 20+** on the build agent (use `UseNode@1` with `version: "20.x"`)
- **PAT** with **Code (Read)** scope
- Git Repo Insights is open source ([MIT License](https://github.com/oddessentials/ado-git-repo-insights/blob/main/LICENSE)) with full source code on GitHub.

## Documentation

[Full documentation on GitHub](https://github.com/oddessentials/ado-git-repo-insights)

## Support

For issues and feature requests: [GitHub Issues](https://github.com/oddessentials/ado-git-repo-insights/issues)
