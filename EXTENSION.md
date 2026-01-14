# Azure DevOps Extension Setup Guide

This guide explains how to install and use the **Git Repo Insights** extension in Azure DevOps.

## Overview

The extension provides a pipeline task that extracts Pull Request metrics from Azure DevOps and generates PowerBI-compatible CSV files.

**Publisher**: OddEssentials
**Task Name**: `ExtractPullRequests`
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
              allowPartiallySucceededBuilds: false
              allowFailedBuilds: false
              artifactName: 'ado-insights-db'
              targetPath: '$(Pipeline.Workspace)/data'

          # Step 3: Run the extension task
          - task: ExtractPullRequests@1
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

          # Step 4: Publish Golden DB (only on success)
          - task: PublishPipelineArtifact@1
            displayName: 'Publish Database'
            condition: succeeded()
            inputs:
              targetPath: '$(Pipeline.Workspace)/data'
              artifact: 'ado-insights-db'

          # Step 5: Publish CSVs
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

---

## Testing the Extension

### Run 1: Fresh Extraction

1. Create a new pipeline using the YAML above
2. Run the pipeline manually
3. Verify:
   - Log shows "No existing database - first run"
   - Artifacts published: `ado-insights-db`, `csv-output`
   - `run_summary.json` shows success

### Run 2: Convergence Test

1. Run the pipeline again immediately
2. Verify:
   - Log shows "Found existing database"
   - Previous database is downloaded and updated
   - Row counts are non-decreasing

---

## Troubleshooting

### "No PRs extracted"

1. **End date defaults to yesterday** — Use `endDate` input for today's date
2. **Only completed PRs are extracted** — Active/draft PRs are skipped
3. **Check PAT permissions** — Must have Code (Read) scope

### "Task not found"

1. Verify extension is installed in your organization
2. Check task name: `ExtractPullRequests@1`
3. Ensure pipeline agent can reach marketplace

### "Python not found"

The extension auto-installs Python dependencies. If this fails:
1. Check agent has internet access
2. Verify pip is available on the agent

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01 | Initial release |
