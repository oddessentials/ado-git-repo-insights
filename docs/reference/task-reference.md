# Task Input Reference

Complete reference for the `ExtractPullRequests@2` Azure DevOps pipeline task.

---

## Task Identification

| Property | Value |
|----------|-------|
| **Task name** | `ExtractPullRequests@2` |
| **Friendly name** | Extract Pull Request Metrics |
| **Publisher** | OddEssentials |

---

## Required Inputs

| Input | Description |
|-------|-------------|
| `organization` | Azure DevOps organization name |
| `projects` | Project names (one per line or comma-separated) |
| `pat` | Personal Access Token with Code (Read) scope |

---

## Optional Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `database` | `$(Pipeline.Workspace)/data/ado-insights.sqlite` | SQLite database path |
| `outputDir` | `$(Pipeline.Workspace)/csv_output` | CSV output directory |
| `startDate` | Auto-detected | Override start date (YYYY-MM-DD) |
| `endDate` | Yesterday | Override end date (YYYY-MM-DD) |
| `backfillDays` | None | Days to backfill for convergence |
| `generateAggregates` | `true` | Generate JSON aggregates for dashboard |
| `aggregatesDir` | `$(Pipeline.Workspace)/aggregates` | Aggregates output directory |

---

## Date Handling

### Default Behavior

| Scenario | Start Date | End Date |
|----------|------------|----------|
| First run | January 1 of current year | Yesterday |
| Incremental (prior DB exists) | Last extraction date + 1 | Yesterday |
| Backfill mode | Today - backfillDays | Yesterday |

### Why Yesterday?

End date defaults to yesterday to avoid incomplete data — PRs closed today may still receive reviewer votes or comments.

### Override Examples

**Include today's data:**
```yaml
- task: ExtractPullRequests@2
  inputs:
    organization: 'MyOrg'
    projects: 'Project1'
    pat: '$(PAT_SECRET)'
    endDate: '2026-01-19'  # Today's date
```

**Historical extraction:**
```yaml
- task: ExtractPullRequests@2
  inputs:
    organization: 'MyOrg'
    projects: 'Project1'
    pat: '$(PAT_SECRET)'
    startDate: '2024-01-01'
    endDate: '2024-12-31'
```

---

## Backfill Mode

Re-extracts recent data to catch late changes (reviewer votes, status updates):

```yaml
- task: ExtractPullRequests@2
  inputs:
    organization: 'MyOrg'
    projects: 'Project1'
    pat: '$(PAT_SECRET)'
    backfillDays: 60  # Re-extract last 60 days
```

**Recommended:** Run backfill weekly (Sundays) for data convergence.

---

## Multi-Project Configuration

Projects can be specified multiple ways:

**One per line:**
```yaml
- task: ExtractPullRequests@2
  inputs:
    projects: |
      Project1
      Project2
      Project3
```

**Comma-separated:**
```yaml
- task: ExtractPullRequests@2
  inputs:
    projects: 'Project1,Project2,Project3'
```

**URL-encoded names:**
```yaml
- task: ExtractPullRequests@2
  inputs:
    projects: |
      Project%20With%20Spaces
      Another%20Project
```

---

## Complete Example

```yaml
trigger: none

pool:
  vmImage: 'ubuntu-latest'

variables:
  - group: ado-insights-secrets

stages:
  - stage: Extract
    jobs:
      - job: ExtractPRs
        steps:
          # Create directories
          - pwsh: |
              New-Item -ItemType Directory -Force -Path "$(Pipeline.Workspace)/data" | Out-Null
              New-Item -ItemType Directory -Force -Path "$(Pipeline.Workspace)/csv_output" | Out-Null
              New-Item -ItemType Directory -Force -Path "$(Pipeline.Workspace)/aggregates" | Out-Null
            displayName: 'Create Directories'

          # Node.js (required)
          - task: UseNode@1
            inputs:
              version: '20.x'

          # Download prior database
          - task: DownloadPipelineArtifact@2
            continueOnError: true
            inputs:
              buildType: 'specific'
              project: '$(System.TeamProjectId)'
              definition: '$(System.DefinitionId)'
              runVersion: 'latestFromBranch'
              runBranch: '$(Build.SourceBranch)'
              allowPartiallySucceededBuilds: true
              artifactName: 'ado-insights-db'
              targetPath: '$(Pipeline.Workspace)/data'

          # Extract
          - task: ExtractPullRequests@2
            inputs:
              organization: 'MyOrg'
              projects: |
                Project1
                Project2
              pat: '$(PAT_SECRET)'
              database: '$(Pipeline.Workspace)/data/ado-insights.sqlite'
              outputDir: '$(Pipeline.Workspace)/csv_output'
              aggregatesDir: '$(Pipeline.Workspace)/aggregates'

          # Publish artifacts
          - task: PublishPipelineArtifact@1
            condition: succeeded()
            inputs:
              targetPath: '$(Pipeline.Workspace)/data'
              artifact: 'ado-insights-db'

          - task: PublishPipelineArtifact@1
            condition: succeeded()
            inputs:
              targetPath: '$(Pipeline.Workspace)/aggregates'
              artifact: 'aggregates'

          - task: PublishPipelineArtifact@1
            condition: succeeded()
            inputs:
              targetPath: '$(Pipeline.Workspace)/csv_output'
              artifact: 'csv-output'
```

---

## Published Artifacts

| Artifact | Purpose | Required For |
|----------|---------|--------------|
| `ado-insights-db` | SQLite database | Incremental extraction |
| `aggregates` | Dashboard data | PR Insights hub |
| `csv-output` | PowerBI CSVs | Data export |

---

## Agent Requirements

| Requirement | Details |
|-------------|---------|
| **Hosted agents** | `ubuntu-latest`, `windows-latest` |
| **Self-hosted** | Node.js 16+ |
| **PAT scope** | Code (Read) |

---

## Error Handling

On failure:
- Task returns non-zero exit code
- Pipeline is marked failed
- No artifacts are published (Invariant 7)
- `##vso[task.logissue type=error]` is emitted

---

## See Also

- [Extension User Guide](../user-guide/extension.md) — Getting started
- [CSV Schema](csv-schema.md) — Output file format
- [Troubleshooting](../user-guide/troubleshooting.md) — Common issues
