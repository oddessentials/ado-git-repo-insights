# Git Repo Insights

Extract Azure DevOps Pull Request metrics and visualize team performance with the built-in **PR Insights Dashboard**.

## ✨ Features

- **PR Insights Dashboard** — View metrics directly in your Azure DevOps project
- **Incremental Extraction** — Daily runs fetch only new PRs, minimizing API calls
- **Periodic Backfill** — Weekly mode re-extracts recent data to catch late changes
- **PowerBI Compatible** — CSV schemas match exactly for seamless dashboard integration
- **SQLite Persistence** — Artifact-based state management with pipeline integration

---

## 🚀 Quick Start

### 1. Install the Extension

Click **Get it free** above to install in your Azure DevOps organization.

### 2. Create a PAT

Create a Personal Access Token with **Code (Read)** scope:

- Azure DevOps → Profile → Personal access tokens → + New Token
- Scope: Code → Read

### 3. Store PAT Securely

Store your PAT in a Variable Group:

- Pipelines → Library → + Variable group
- Name: `ado-insights-secrets`
- Add variable: `PAT_SECRET` (mark as secret)

### 4. Add the Task to Your Pipeline

```yaml
trigger: none

pool:
    vmImage: "ubuntu-latest"

variables:
    - group: ado-insights-secrets

steps:
    - pwsh: |
          New-Item -ItemType Directory -Force -Path "$(Pipeline.Workspace)/data" | Out-Null
          New-Item -ItemType Directory -Force -Path "$(Pipeline.Workspace)/aggregates" | Out-Null
      displayName: "Create Directories"

    - task: UseNode@1
      inputs:
          version: "20.x"

    - task: ExtractPullRequests@2
      inputs:
          organization: "YOUR_ORG"
          projects: |
              Project1
              Project2
          pat: "$(PAT_SECRET)"
          database: "$(Pipeline.Workspace)/data/ado-insights.sqlite"
          aggregatesDir: "$(Pipeline.Workspace)/aggregates"

    - publish: $(Pipeline.Workspace)/data
      artifact: ado-insights-db
      condition: succeeded()

    - publish: $(Pipeline.Workspace)/aggregates
      artifact: aggregates
      condition: succeeded()
```

### 5. View the Dashboard

After a successful run, navigate to your project and find **PR Insights** in the Repos menu.

---

## 📋 Task Inputs

| Input                | Required | Description                                                                      |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| `organization`       | Yes      | Azure DevOps organization name                                                   |
| `projects`           | Yes      | Project names (one per line or comma-separated)                                  |
| `pat`                | Yes      | PAT with Code (Read) scope                                                       |
| `database`           | No       | SQLite database path (default: `$(Pipeline.Workspace)/data/ado-insights.sqlite`) |
| `outputDir`          | No       | CSV output directory                                                             |
| `startDate`          | No       | Override start date (YYYY-MM-DD)                                                 |
| `endDate`            | No       | Override end date (YYYY-MM-DD)                                                   |
| `backfillDays`       | No       | Days to backfill for convergence                                                 |
| `generateAggregates` | No       | Generate dashboard data (default: `true`)                                        |
| `aggregatesDir`      | No       | Aggregates output directory                                                      |

---

## 📊 CSV Outputs

| File                | Description                          |
| ------------------- | ------------------------------------ |
| `organizations.csv` | Organization records                 |
| `projects.csv`      | Project records                      |
| `repositories.csv`  | Repository records                   |
| `pull_requests.csv` | Pull request details with cycle time |
| `users.csv`         | User records                         |
| `reviewers.csv`     | PR reviewer votes                    |

---

## 📖 Requirements

- **Hosted Agent**: `ubuntu-latest`, `windows-latest`, or self-hosted with Node.js 16+
- **PAT Scope**: Code (Read)

---

## 📚 Documentation

For detailed setup instructions, pipeline templates, and troubleshooting:

📖 [Full Documentation on GitHub](https://github.com/oddessentials/ado-git-repo-insights)

---

## 🆘 Support

For issues and feature requests, visit the [GitHub repository](https://github.com/oddessentials/ado-git-repo-insights).

**Publisher**: OddEssentials
