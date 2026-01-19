# Extension User Guide

This guide walks you through installing and using the **Git Repo Insights** extension in Azure DevOps.

---

## What You Get

- **PR Insights Dashboard** — Visual analytics directly in your ADO project
- **PowerBI-compatible CSVs** — Export data for custom reporting
- **SQLite Database** — Persistent storage of PR history via pipeline artifacts
- **Incremental Updates** — Efficient daily extraction with optional backfill

---

## Prerequisites

| Requirement | Details |
|-------------|---------|
| Azure DevOps Organization | Any ADO organization (cloud) |
| Extension Install Permission | Organization admin OR "Manage extensions" permission |
| Project Access | Access to project(s) you want to analyze |

---

## Step 1: Install the Extension

### Option A: Install from Marketplace (Recommended)

1. Go to: [Git Repo Insights on Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=OddEssentials.ado-git-repo-insights)
2. Click **Get it free**
3. Select your organization from the dropdown
4. Click **Install**
5. Click **Proceed to organization**

### Option B: Install from VSIX (Private/Testing)

1. Download the `.vsix` from [GitHub Releases](https://github.com/oddessentials/ado-git-repo-insights/releases)
2. Go to: `https://dev.azure.com/{your-org}/_settings/extensions`
3. Click **Browse local extensions** → **Manage extensions** → **Upload extension**
4. Select the `.vsix` file and upload
5. Click **Get it free** → Select your organization → **Install**

---

## Step 2: Create a Personal Access Token (PAT)

The extension needs a PAT to read Pull Request data from your repositories.

1. In Azure DevOps, click your profile picture (top right) → **Personal access tokens**
2. Click **+ New Token**
3. Configure:
   | Field | Value |
   |-------|-------|
   | Name | `pr-insights-extraction` |
   | Organization | Your target organization |
   | Expiration | 90+ days recommended |
   | Scopes | Click "Show all scopes" → check **Code → Read** |
4. Click **Create**
5. **Copy the token immediately** — you won't see it again

---

## Step 3: Store PAT in a Variable Group

Secrets should never be stored in pipeline YAML files. Use a Variable Group instead.

1. Navigate to: **Pipelines** → **Library**
2. Click **+ Variable group**
3. Configure:
   | Field | Value |
   |-------|-------|
   | Variable group name | `ado-insights-secrets` |
4. Click **+ Add** and enter:
   | Name | Value |
   |------|-------|
   | `PAT_SECRET` | Your PAT from Step 2 |
5. Click the lock icon to mark as secret
6. Click **Save**

---

## Step 4: Create the Pipeline

### Using an Existing Repository

You can store the pipeline YAML in any repository you have access to. Common choices:
- A dedicated "pipelines" or "infrastructure" repository
- The main repository of the project being analyzed

### Pipeline YAML

Create a new file (e.g., `pr-insights-pipeline.yml`) with:

```yaml
trigger: none  # Configure schedule below or run manually

pool:
  vmImage: 'ubuntu-latest'

variables:
  - group: ado-insights-secrets

stages:
  - stage: Extract
    displayName: 'Extract PR Metrics'
    jobs:
      - job: ExtractPRs
        displayName: 'Extract and Publish'
        steps:
          # Create required directories
          - pwsh: |
              New-Item -ItemType Directory -Force -Path "$(Pipeline.Workspace)/data" | Out-Null
              New-Item -ItemType Directory -Force -Path "$(Pipeline.Workspace)/csv_output" | Out-Null
              New-Item -ItemType Directory -Force -Path "$(Pipeline.Workspace)/aggregates" | Out-Null
            displayName: 'Create Directories'

          # Ensure Node.js is available
          - task: UseNode@1
            displayName: 'Install Node.js 20'
            inputs:
              version: '20.x'

          # Download previous database (enables incremental extraction)
          - task: DownloadPipelineArtifact@2
            displayName: 'Download Previous Database'
            continueOnError: true  # First run will have no artifact
            inputs:
              buildType: 'specific'
              project: '$(System.TeamProjectId)'
              definition: '$(System.DefinitionId)'
              runVersion: 'latestFromBranch'
              runBranch: '$(Build.SourceBranch)'
              allowPartiallySucceededBuilds: true
              artifactName: 'ado-insights-db'
              targetPath: '$(Pipeline.Workspace)/data'

          # Run the extraction task
          - task: ExtractPullRequests@2
            displayName: 'Extract PR Metrics'
            inputs:
              organization: 'YOUR_ORG_NAME'      # CHANGE THIS
              projects: |
                YOUR_PROJECT_1                    # CHANGE THIS
                YOUR_PROJECT_2                    # Add more as needed
              pat: '$(PAT_SECRET)'
              database: '$(Pipeline.Workspace)/data/ado-insights.sqlite'
              outputDir: '$(Pipeline.Workspace)/csv_output'
              aggregatesDir: '$(Pipeline.Workspace)/aggregates'

          # Publish database (enables incremental runs)
          - task: PublishPipelineArtifact@1
            displayName: 'Publish Database'
            condition: succeeded()
            inputs:
              targetPath: '$(Pipeline.Workspace)/data'
              artifact: 'ado-insights-db'

          # Publish aggregates (enables dashboard)
          - task: PublishPipelineArtifact@1
            displayName: 'Publish Aggregates'
            condition: succeeded()
            inputs:
              targetPath: '$(Pipeline.Workspace)/aggregates'
              artifact: 'aggregates'

          # Publish CSVs for download
          - task: PublishPipelineArtifact@1
            displayName: 'Publish CSVs'
            condition: succeeded()
            inputs:
              targetPath: '$(Pipeline.Workspace)/csv_output'
              artifact: 'csv-output'
```

**Customize the placeholders:**

| Placeholder | Replace With |
|-------------|--------------|
| `YOUR_ORG_NAME` | Your Azure DevOps organization name |
| `YOUR_PROJECT_1` | Name of a project to analyze |
| `YOUR_PROJECT_2` | Additional projects (or remove) |

### Create the Pipeline in Azure DevOps

1. Navigate to **Pipelines** → **Pipelines** → **New pipeline**
2. Select **Azure Repos Git** (or GitHub)
3. Select your repository
4. Select **Existing Azure Pipelines YAML file** and choose your YAML file
5. Click **Save and run**

---

## Step 5: Verify the Pipeline Run

After the pipeline completes:

1. Navigate to **Pipelines** → Click your pipeline → View the latest run
2. All steps should show green checkmarks
3. View the **Artifacts** section:

| Artifact | Purpose |
|----------|---------|
| `ado-insights-db` | SQLite database (enables incremental runs) |
| `aggregates` | Dashboard data (enables PR Insights hub) |
| `csv-output` | PowerBI-compatible CSVs |

---

## Step 6: View the PR Insights Dashboard

After a successful pipeline run with the `aggregates` artifact:

1. Navigate to your Azure DevOps project
2. Find **PR Insights** in the left navigation under **Repos**
3. The dashboard automatically discovers pipelines that publish aggregates

### Dashboard Configuration

If you have multiple pipelines publishing aggregates, configure a default:

1. Go to **Project Settings** → **PR Insights Settings**
2. Select your preferred default pipeline

**Configuration precedence:**
1. `?dataset=<url>` — Direct URL (dev/testing only)
2. `?pipelineId=<id>` — Query parameter override
3. Extension settings — User-scoped saved preference
4. Auto-discovery — Find pipelines with 'aggregates' artifact

---

## Setting Up a Schedule

For continuous metrics, add a schedule trigger:

```yaml
trigger: none

schedules:
  - cron: "0 6 * * *"  # Daily at 6 AM UTC
    displayName: "Daily PR Extraction"
    branches:
      include: [main]
    always: true
```

### Weekly Backfill (Recommended)

Add backfill on Sundays to catch late PR changes:

```yaml
- task: ExtractPullRequests@2
  inputs:
    # ... other inputs ...
    backfillDays: 60  # Re-extract last 60 days
```

Or use the production-ready template: [pr-insights-pipeline.yml](../../pr-insights-pipeline.yml)

---

## Extracting Historical Data

By default, the first extraction covers PRs from January 1st of the current year through yesterday.

**To extract the past year of PR history**, add date overrides to your first run:

```yaml
- task: ExtractPullRequests@2
  inputs:
    organization: 'YOUR_ORG_NAME'
    projects: 'YOUR_PROJECT_1'
    pat: '$(PAT_SECRET)'
    database: '$(Pipeline.Workspace)/data/ado-insights.sqlite'
    # Add for historical extraction (remove after first run)
    startDate: '2025-01-01'
    endDate: '2026-01-19'
```

After the first run, remove `startDate` and `endDate` — subsequent runs automatically do incremental daily extraction.

---

## Next Steps

- [Task Input Reference](../reference/task-reference.md) — All configuration options
- [Troubleshooting](troubleshooting.md) — Common issues and solutions
- [Runbook](../operations/runbook.md) — Operational procedures
- [CSV Schema](../reference/csv-schema.md) — Output file specifications

---

## Support

For issues and feature requests, visit the [GitHub repository](https://github.com/oddessentials/ado-git-repo-insights).

**Publisher**: OddEssentials
