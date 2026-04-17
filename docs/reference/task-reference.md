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
| `pat` | Personal Access Token with Code (Read) scope |
| `projects` | Project names (one per line or comma-separated). **Required in `extract` mode; optional in `backfill-comments` mode** (empty = all projects eligible). |

---

## Mode

| Input | Default | Description |
|-------|---------|-------------|
| `mode` | `extract` | Which CLI subcommand to run. `extract` pulls PR metadata for the configured date range (with optional comment extraction for recent PRs). `backfill-comments` drains comment coverage for historical PRs whose `comments_extracted_at` is NULL. |

See [Backfilling Historical PR Comments](../user-guide/extension.md#backfilling-historical-pr-comments) for the end-to-end walkthrough.

---

## Optional Inputs (Extract Mode)

These inputs are valid only when `mode: extract` (the default). Using any of
them with `mode: backfill-comments` causes the task to fail fast.

| Input | Default | Description |
|-------|---------|-------------|
| `database` | `$(Pipeline.Workspace)/data/ado-insights.sqlite` | SQLite database path |
| `outputDir` | `$(Pipeline.Workspace)/csv_output` | CSV output directory |
| `startDate` | Auto-detected | Override start date (YYYY-MM-DD) |
| `endDate` | Yesterday | Override end date (YYYY-MM-DD) |
| `backfillDays` | None | Days to re-extract for PR-metadata convergence |
| `includeComments` | `false` | Extract PR discussion threads inline while extracting PR metadata |
| `commentsMaxPrsPerRun` | `100` | Cap on how many PRs have comments fetched in a single extract run (rate-limit protection) |
| `commentsMaxThreadsPerPr` | `50` | Cap on how many threads are fetched per PR; `0` = unlimited |
| `generateAggregates` | `true` | Generate JSON aggregates for dashboard |
| `aggregatesDir` | `$(Pipeline.Workspace)/aggregates` | Aggregates output directory |
| `enablePredictions` | `false` | Prophet-based trend forecasting in `generateAggregates` |
| `enableInsights` | `false` | OpenAI-powered insights in `generateAggregates` |
| `openaiApiKey` | None | `$(OPENAI_API_KEY)` from a variable group; required when `enableInsights: true` |

---

## Optional Inputs (Backfill-Comments Mode)

These inputs are valid only when `mode: backfill-comments`. Using any of them
with `mode: extract` causes the task to fail fast.

| Input | Default | Description |
|-------|---------|-------------|
| `backfillSince` | None | Only backfill PRs closed on or after this date (YYYY-MM-DD) |
| `backfillUntil` | None | Only backfill PRs closed strictly before this date (YYYY-MM-DD, exclusive) |
| `backfillLimit` | `0` (no limit) | Maximum PRs processed per run. Sized against your pipeline's job timeout at ~1 PR/sec throughput; see the [extension user guide](../user-guide/extension.md#sizing-backfilllimit). |
| `commentsMaxThreadsPerPr` | `50` | Cap on how many threads are fetched per PR; `0` = unlimited (shared with extract mode) |
| `database` | `$(Pipeline.Workspace)/data/ado-insights.sqlite` | SQLite database path (shared with extract mode) |
| `generateAggregates` | `true` | Run aggregates after backfill so `review_time` metrics refresh |
| `aggregatesDir` | `$(Pipeline.Workspace)/aggregates` | Aggregates output directory (shared) |
| `enablePredictions` | `false` | Prophet-based trend forecasting in `generateAggregates` (shared) |
| `enableInsights` | `false` | OpenAI-powered insights in `generateAggregates` (shared) |
| `openaiApiKey` | None | Required when `enableInsights: true` (shared) |

---

## Cross-Mode Input Rejection

The task rejects mixed-intent input combinations before any API call so a
pipeline misconfiguration fails within the first few seconds of the run.
The full rejection rule set:

| Mode | Rejected inputs | Reason |
|------|-----------------|--------|
| `extract`           | `backfillSince`, `backfillUntil`, `backfillLimit` | Backfill-only knobs. |
| `extract`           | Missing/empty `projects`                          | Required in extract mode. |
| `backfill-comments` | `startDate`, `endDate`, `backfillDays`            | Use `backfillSince` / `backfillUntil` instead; `backfillDays` has no backfill analogue. |
| `backfill-comments` | `includeComments: true`                            | Backfill always fetches comments; enabling this is mixed intent. |
| `backfill-comments` | `commentsMaxPrsPerRun`                             | Use `backfillLimit` instead. |

Empty-string inputs (`startDate: ""`, etc.) that the Azure platform auto-populates are treated as *not set* and do not trigger the guard — only a non-empty meaningfully-set value fails the run.

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
              version: '22.x'

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
| **Self-hosted** | Node.js 22+ |
| **PAT scope** | Code (Read) |

---

## Error Handling

On failure:
- Task returns non-zero exit code
- Pipeline is marked failed
- No artifacts are published (No publish-on-failure; see `agents/INVARIANTS.md`)
- `##vso[task.logissue type=error]` is emitted

---

## See Also

- [Extension User Guide](../user-guide/extension.md) — Getting started
- [CSV Schema](csv-schema.md) — Output file format
- [Troubleshooting](../user-guide/troubleshooting.md) — Common issues
