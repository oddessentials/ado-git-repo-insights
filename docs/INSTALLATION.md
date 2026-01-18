# Installation Guide: Git Repo Insights for Azure DevOps

This guide walks you through installing and setting up the **Git Repo Insights** extension in your Azure DevOps organization.

---

## What This Extension Does

**Git Repo Insights** extracts Pull Request metrics from Azure DevOps and provides:

- 📊 **PR Insights Dashboard** — Visual analytics directly in your ADO project
- 📁 **PowerBI-compatible CSVs** — Export data for custom reporting
- 🗄️ **SQLite Database** — Persistent storage of PR history
- 🔄 **Daily Incremental Updates** — Efficient extraction with weekly backfill

---

## Prerequisites

Before you begin, ensure you have:

| Requirement | Details |
|-------------|---------|
| **Azure DevOps Organization** | Any ADO organization (cloud) |
| **Extension Install Permission** | Organization admin OR "Manage extensions" permission |
| **Project Access** | Access to project(s) you want to analyze |

---

## Step 1: Install from Azure DevOps Marketplace

1. **Open the Marketplace Listing**

   Go to: [Git Repo Insights on Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=OddEssentials.ado-git-repo-insights)

2. **Click "Get it free"**

   This button appears on the extension's marketplace page.

3. **Select Your Organization**

   From the dropdown, choose the Azure DevOps organization where you want to install the extension.

4. **Click "Install"**

   The extension will be installed in your organization. You'll see a confirmation message.

5. **Click "Proceed to organization"**

   This takes you back to your Azure DevOps organization.

> **Note**: If you don't see your organization in the dropdown, ensure you're signed in with an account that has permission to manage extensions.

---

## Step 2: Create a Personal Access Token (PAT)

The extension needs a PAT to read Pull Request data from your repositories.

1. **Open User Settings**

   In Azure DevOps, click your profile picture (top right) → **Personal access tokens**

2. **Click "+ New Token"**

3. **Configure the Token**

   | Field | Value |
   |-------|-------|
   | **Name** | `pr-insights-extraction` (or any descriptive name) |
   | **Organization** | Select the organization you installed the extension in |
   | **Expiration** | Choose your preference (recommend 90+ days) |
   | **Scopes** | Click "Show all scopes", then check **Code → Read** |

4. **Click "Create"**

5. **Copy the Token**

   > ⚠️ **Important**: Copy the token now — you won't be able to see it again!

   Save it temporarily in a secure location (you'll store it properly in the next step).

---

## Step 3: Store PAT in a Variable Group

Secrets should never be stored in pipeline YAML files. Use a Variable Group instead.

1. **Navigate to Library**

   In your Azure DevOps project: **Pipelines** → **Library**

2. **Click "+ Variable group"**

3. **Configure the Variable Group**

   | Field | Value |
   |-------|-------|
   | **Variable group name** | `ado-insights-secrets` |

4. **Add the PAT Variable**

   Click **+ Add** and enter:

   | Name | Value |
   |------|-------|
   | `PAT_SECRET` | Paste your PAT from Step 2 |

5. **Mark as Secret**

   Click the 🔒 lock icon next to the value to mark it as a secret.

6. **Click "Save"**

---

## Step 4: Create a Repository for Your Pipeline

Azure DevOps pipelines require a git repository to store the pipeline YAML file. If you already have a repository, skip to Step 5.

### Option A: Create an Azure Repos Repository

1. **Navigate to Repos**

   In your project: **Repos** → **Files**

2. **Initialize a Repository**

   If this is a new project with no repos:
   - Click **Initialize** to create the default repository
   - Or click **+ New repository** to create one with a custom name

3. **Name Your Repository** (if creating new)

   | Field | Suggested Value |
   |-------|-----------------|
   | **Repository name** | `pr-insights-pipeline` or use an existing repo |
   | **Add a README** | Optional |

4. **Click "Create"**

### Option B: Use an Existing Repository

You can store the pipeline YAML in any repository you have access to — it doesn't need to be in the project you're analyzing. Common choices:
- A dedicated "pipelines" or "infrastructure" repository
- The main repository of the project being analyzed
- A new repository specifically for PR Insights

---

## Step 5: Create Your First Pipeline

Now create a pipeline that uses the extension to extract PR metrics.

1. **Navigate to Pipelines**

   In your project: **Pipelines** → **Pipelines** → **New pipeline**

2. **Choose Repository Location**

   Select **Azure Repos Git** (or GitHub if using an external repo), then select the repository you created/chose in Step 4.

3. **Select "Starter pipeline"** (or paste the YAML below into an existing repo)

4. **Replace the content with this YAML**:

```yaml
trigger: none  # Manual runs only (configure schedule later)

pool:
  vmImage: 'ubuntu-latest'

variables:
  - group: ado-insights-secrets  # References your variable group

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

          # Download previous database (if exists)
          - task: DownloadPipelineArtifact@2
            displayName: 'Download Previous Database'
            continueOnError: true  # First run will have no artifact - that's OK
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
              organization: 'YOUR_ORG_NAME'      # ⚠️ CHANGE THIS
              projects: |
                YOUR_PROJECT_1                    # ⚠️ CHANGE THIS
                YOUR_PROJECT_2                    # Add more projects as needed
              pat: '$(PAT_SECRET)'
              database: '$(Pipeline.Workspace)/data/ado-insights.sqlite'
              outputDir: '$(Pipeline.Workspace)/csv_output'
              aggregatesDir: '$(Pipeline.Workspace)/aggregates'

          # Publish database artifact (enables incremental runs)
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

5. **Customize the YAML**

   Replace the placeholder values:

   | Placeholder | Replace With |
   |-------------|--------------|
   | `YOUR_ORG_NAME` | Your Azure DevOps organization name |
   | `YOUR_PROJECT_1` | Name of a project to analyze |
   | `YOUR_PROJECT_2` | Additional projects (or remove this line) |

6. **Save and Run**

   Click **Save and run** → **Save and run** (confirm)

---

## Step 6: Verify the Pipeline Run

After the pipeline completes:

1. **Check the Run Status**

   Navigate to **Pipelines** → Click on your pipeline → View the latest run

   ✅ All steps should show green checkmarks

2. **View Published Artifacts**

   On the run summary page, look for the **Artifacts** section. You should see:

   | Artifact | Purpose |
   |----------|---------|
   | `ado-insights-db` | SQLite database (enables incremental runs) |
   | `aggregates` | Dashboard data (enables PR Insights hub) |
   | `csv-output` | PowerBI-compatible CSVs |

3. **Download CSVs (Optional)**

   Click on `csv-output` → Download to get the generated CSV files.

---

## Step 7: View the PR Insights Dashboard

After a successful pipeline run with the `aggregates` artifact:

1. **Navigate to Your Project**

   Go to your Azure DevOps project homepage.

2. **Find "PR Insights" in the Menu**

   In the left navigation under **Repos**, you'll see a new hub called **PR Insights**.

3. **View Your Metrics**

   The dashboard automatically discovers pipelines that publish aggregates and displays:
   - PR volume trends
   - Cycle time analytics
   - Reviewer activity
   - And more!

4. **Configure Default Pipeline (Optional)**

   If you have multiple pipelines publishing aggregates:
   - Go to **Project Settings** → **PR Insights Settings**
   - Select your preferred default pipeline

---

## Next Steps

### Extract Historical Data (Recommended for First Run)

By default, the first extraction covers PRs from **January 1st of the current year through yesterday**. To include older historical data, add date overrides to your first pipeline run.

**To extract the past year of PR history**, add these inputs to your `ExtractPullRequests@2` task:

```yaml
# Add to your ExtractPullRequests@2 task for the FIRST run only
- task: ExtractPullRequests@2
  displayName: 'Extract PR Metrics'
  inputs:
    organization: 'YOUR_ORG_NAME'
    projects: |
      YOUR_PROJECT_1
    pat: '$(PAT_SECRET)'
    database: '$(Pipeline.Workspace)/data/ado-insights.sqlite'
    outputDir: '$(Pipeline.Workspace)/csv_output'
    aggregatesDir: '$(Pipeline.Workspace)/aggregates'
    # ↓ Add these for historical extraction (remove after first run)
    startDate: '2025-01-01'  # One year back from today
    endDate: '2026-01-17'    # Today's date
```

> **Note**: After the first run extracts historical data, you can remove `startDate` and `endDate` — subsequent runs will automatically do incremental daily extraction.

> **Tip**: Adjust `startDate` to go back further if needed. Very large date ranges (2+ years) may take longer to process.

### Set Up a Schedule

For continuous metrics, add a schedule trigger to your pipeline:

```yaml
trigger: none

schedules:
  - cron: "0 6 * * *"  # Daily at 6 AM UTC
    displayName: "Daily PR Extraction"
    branches:
      include: [main]
    always: true
```

### Weekly Backfill

Add a backfill run on Sundays to catch late PR changes (reviewers voting after merge, etc.):

```yaml
# Add to your ExtractPullRequests@2 task for weekly backfill
backfillDays: 60
```

See [pr-insights-pipeline.yml](../pr-insights-pipeline.yml) for a production-ready template that includes both scheduled extraction and weekly backfill.

---

## Troubleshooting

### "Task not found" Error

**Cause**: Extension not installed or not visible to the pipeline.

**Solution**:
1. Verify the extension is installed: Organization Settings → Extensions
2. Ensure the correct organization is selected
3. Try creating a new pipeline

### "401 Unauthorized" Error

**Cause**: PAT is invalid, expired, or lacks permissions.

**Solution**:
1. Create a new PAT with **Code (Read)** scope
2. Update the variable group with the new PAT
3. Ensure the PAT has access to all projects in your pipeline

### "No PRs Extracted"

**Cause**: Date range doesn't include completed PRs.

**Solution**:
- The extraction defaults to PRs completed **before today**
- Newly completed PRs may appear in tomorrow's run
- Use `endDate` input to include today: `endDate: $(date +'%Y-%m-%d')`

### Dashboard Not Showing

**Cause**: Missing aggregates artifact or permissions.

**Solution**:
1. Verify the pipeline published an `aggregates` artifact
2. Check that `dataset-manifest.json` exists in the artifact
3. Ensure you have **Build (Read)** permission on the pipeline

### First Run Downloads Nothing

**Cause**: Expected behavior for the first run.

The "Download Previous Database" step will show a warning on first run because there's no previous artifact — this is normal! Subsequent runs will download the prior database for incremental updates.

---

## More Resources

- [Extension Setup Guide](EXTENSION.md) — Detailed task input reference
- [Runbook](runbook.md) — Operational procedures and recovery
- [Pipeline Template](../pr-insights-pipeline.yml) — Production-ready YAML

---

## Support

For issues and feature requests, visit the [GitHub repository](https://github.com/oddessentials/ado-git-repo-insights).

**Publisher**: OddEssentials
