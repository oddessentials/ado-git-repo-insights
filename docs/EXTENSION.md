# Azure DevOps Extension Setup Guide

This guide explains how to install and use the **Git Repo Insights** extension in Azure DevOps.

## Overview

The extension provides:
- A pipeline task that extracts Pull Request metrics from Azure DevOps
- A project-level **PR Insights** dashboard hub
- PowerBI-compatible CSV output

**Publisher**: OddEssentials
**Task Name**: `ExtractPullRequests@2`
**Friendly Name**: Extract Pull Request Metrics

---

## Prerequisites

1. **Azure DevOps Organization** with admin access to install extensions
2. **Personal Access Token (PAT)** with **Code (Read)** scope
3. **Node.js 16+** for packaging (if building from source)

---

## Installation

### Option A: Install from Marketplace (Recommended)

1. Go to the [Visual Studio Marketplace](https://marketplace.visualstudio.com/)
2. Search for "Git Repo Insights" by OddEssentials
3. Click **Get it free** → Select your organization → **Install**

### Option B: Install from VSIX (Private/Testing)

1. **Package the extension**:
   ```bash
   cd extension
   npm install
   npx tfx-cli extension create --manifest-globs vss-extension.json
   ```
   This creates `OddEssentials.ado-git-repo-insights-1.0.0.vsix`

2. **Upload to Azure DevOps**:
   - Go to: `https://dev.azure.com/{your-org}/_settings/extensions`
   - Click **Browse local extensions** → **Manage extensions**
   - Click **Upload extension** → Select the `.vsix` file
   - Click **Upload**

3. **Install to organization**:
   - After upload, click on the extension
   - Click **Get it free** → Select your organization → **Install**

---

## Setup Variable Group

The extension requires a PAT stored securely in a variable group.

1. Go to: `Pipelines` → `Library` → `+ Variable group`
2. Name: `ado-insights-secrets`
3. Add variable:
   - **Name**: `PAT_SECRET`
   - **Value**: Your PAT with Code (Read) scope
   - **Lock** icon: Click to mark as secret
4. Click **Save**

---

## Pipeline Configuration

For a production-ready pipeline, copy [pr-insights-pipeline.yml](../pr-insights-pipeline.yml) from the repository.

### Using the Extension Task

```yaml
trigger: none

pool:
  vmImage: 'ubuntu-latest'  # Or 'windows-latest' or 'name: Default' for self-hosted

variables:
  - group: ado-insights-secrets

stages:
  - stage: Extract
    jobs:
      - job: ExtractPRs
        steps:
          # Step 1: Create directories FIRST
          - pwsh: |
              New-Item -ItemType Directory -Force -Path "$(Pipeline.Workspace)/data" | Out-Null
              New-Item -ItemType Directory -Force -Path "$(Pipeline.Workspace)/csv_output" | Out-Null
              New-Item -ItemType Directory -Force -Path "$(Pipeline.Workspace)/aggregates" | Out-Null
            displayName: 'Create Directories'

          # Step 1.5: Ensure Node.js is available (for self-hosted agents)
          - task: UseNode@1
            displayName: 'Install Node.js 20'
            inputs:
              version: '20.x'

          # Step 2: Download previous DB (branch-isolated)
          - task: DownloadPipelineArtifact@2
            displayName: 'Download Previous Database'
            continueOnError: true  # First run will fail - OK
            inputs:
              buildType: 'specific'
              project: '$(System.TeamProjectId)'
              definition: '$(System.DefinitionId)'
              runVersion: 'latestFromBranch'
              runBranch: '$(Build.SourceBranch)'
              allowPartiallySucceededBuilds: true
              allowFailedBuilds: false
              artifactName: 'ado-insights-db'
              targetPath: '$(Pipeline.Workspace)/data'

          # Step 3: Run the extension task
          # generateAggregates defaults to true in v2.7.0+
          - task: ExtractPullRequests@2
            displayName: 'Extract PR Metrics'
            inputs:
              organization: 'oddessentials'
              projects: |
                marketing
                engineering
                hospitality
              pat: '$(PAT_SECRET)'
              database: '$(Pipeline.Workspace)/data/ado-insights.sqlite'
              outputDir: '$(Pipeline.Workspace)/csv_output'
              aggregatesDir: '$(Pipeline.Workspace)/aggregates'

          # Step 4: Publish Golden DB (only on success)
          - task: PublishPipelineArtifact@1
            displayName: 'Publish Database'
            condition: succeeded()
            inputs:
              targetPath: '$(Pipeline.Workspace)/data'
              artifact: 'ado-insights-db'

          # Step 5: Publish Aggregates (enables dashboard discovery)
          - task: PublishPipelineArtifact@1
            displayName: 'Publish Aggregates'
            condition: succeeded()
            inputs:
              targetPath: '$(Pipeline.Workspace)/aggregates'
              artifact: 'aggregates'

          # Step 6: Publish CSVs
          - task: PublishPipelineArtifact@1
            displayName: 'Publish CSVs'
            condition: always()
            inputs:
              targetPath: '$(Pipeline.Workspace)/csv_output'
              artifact: 'csv-output'
```

---

## Task Inputs Reference

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `organization` | Yes | - | Azure DevOps organization name |
| `projects` | Yes | - | Project names (one per line or comma-separated) |
| `pat` | Yes | - | PAT with Code (Read) scope |
| `database` | No | `$(Pipeline.Workspace)/data/ado-insights.sqlite` | SQLite database path |
| `outputDir` | No | `$(Pipeline.Workspace)/csv_output` | CSV output directory |
| `startDate` | No | - | Override start date (YYYY-MM-DD) |
| `endDate` | No | Yesterday | Override end date (YYYY-MM-DD) |
| `backfillDays` | No | - | Days to backfill for convergence |
| `generateAggregates` | No | `true` | Generate JSON aggregates for dashboard |
| `aggregatesDir` | No | `$(Pipeline.Workspace)/aggregates` | Aggregates output directory |

---

## Testing the Extension

### Run 1: Fresh Extraction

1. Create a new pipeline using the YAML above
2. Run the pipeline manually
3. Verify:
   - Log shows "No existing database - first run"
   - Artifacts published: `ado-insights-db`, `aggregates`, `csv-output`
   - `run_summary.json` shows success

### Run 2: Convergence Test

1. Run the pipeline again immediately
2. Verify:
   - Log shows "Found existing database"
   - Previous database is downloaded and updated
   - Row counts are non-decreasing

### Verify Dashboard

After a successful pipeline run:
1. Navigate to your project in Azure DevOps
2. Look for **PR Insights** in the project menu
3. The dashboard should auto-discover the pipeline and display metrics

---

## Troubleshooting

### "No PRs extracted"

1. **End date defaults to yesterday** — Use `endDate` input for today's date
2. **Only completed PRs are extracted** — Active/draft PRs are skipped
3. **Check PAT permissions** — Must have Code (Read) scope

### "Task not found"

1. Verify extension is installed in your organization
2. Check task name: `ExtractPullRequests@2`
3. Ensure pipeline agent can reach marketplace

### "Dashboard not showing"

1. Verify the pipeline published an `aggregates` artifact
2. Check that the artifact contains `dataset-manifest.json`
3. Ensure you have Build (Read) permission on the pipeline
4. Try adding `?pipelineId=<id>` to the dashboard URL

### "Python not found"

The extension auto-installs Python dependencies. If this fails:
1. Check agent has internet access
2. Verify pip is available on the agent

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.7.0 | 2026-01 | Project-level dashboard hub, generateAggregates enabled by default, settings page |
| 2.6.0 | 2026-01 | Task version 2.6.0 |
| 1.0.0 | 2026-01 | Initial release |

---

## PR Insights Dashboard

The **PR Insights** hub appears in the project navigation after installing the extension. It displays metrics from pipeline-produced aggregates.

### Configuration Precedence

The dashboard resolves configuration in this order:

1. **`?dataset=<url>`** — Direct URL (dev/testing only, HTTPS required)
2. **`?pipelineId=<id>`** — Query parameter override
3. **Extension settings** — User-scoped saved preference (Project Settings → PR Insights Settings)
4. **Auto-discovery** — Find pipelines with 'aggregates' artifact containing `dataset-manifest.json`

### Settings Page

Configure a default pipeline via: Project Settings → PR Insights Settings

Settings are **user-scoped** — each team member can configure their own preference.
