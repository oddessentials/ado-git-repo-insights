# Extension User Guide

How to install and use the **Git Repo Insights** Azure DevOps extension.

---

## What you get

- **PR Insights Dashboard** — visual analytics in your ADO project
- **PowerBI-compatible CSVs** — exported per pipeline run for custom reporting
- **SQLite Database** — persistent PR history via pipeline artifacts
- **Incremental Updates** — efficient daily extraction with optional backfill

---

## Prerequisites

| Requirement | Details |
|---|---|
| Azure DevOps Organization | Any cloud-hosted ADO organization |
| Permission | Organization admin OR "Manage extensions" |
| Project access | Access to project(s) you want to analyze |

---

## Step 1 — Install the extension

**From Marketplace (recommended)**: visit [Git Repo Insights on the Marketplace](https://marketplace.visualstudio.com/items?itemName=OddEssentials.ado-git-repo-insights), click **Get it free**, select your organization, click **Install**.

**From VSIX (private/testing)**: download the `.vsix` from [GitHub Releases](https://github.com/oddessentials/ado-git-repo-insights/releases). In ADO go to `https://dev.azure.com/{your-org}/_settings/extensions` → **Browse local extensions** → **Manage extensions** → **Upload extension**.

---

## Step 2 — Create a Personal Access Token (PAT)

The extension reads PR data via the Azure DevOps REST API; it needs a PAT with **Code (Read)** scope.

1. ADO → profile picture (top right) → **Personal access tokens** → **+ New Token**.
2. Configure:
   | Field | Value |
   |---|---|
   | Name | `pr-insights-extraction` |
   | Organization | Your target org |
   | Expiration | 90+ days recommended |
   | Scopes | "Show all scopes" → check **Code → Read** |
3. **Copy the token immediately** — you can't see it again.

This is the canonical PAT setup; the [CLI guide](local-cli.md) and [troubleshooting](troubleshooting.md) link back here.

---

## Step 3 — Store PAT in a Variable Group

Never put secrets in pipeline YAML.

1. **Pipelines** → **Library** → **+ Variable group**.
2. Name it `ado-insights-secrets`.
3. Add a variable `PAT_SECRET` with your PAT value; click the **lock** icon to mark it secret.
4. **Save**.

---

## Step 4 — Create the pipeline

The pipeline YAML can live in any repo you can access. Create a new file (e.g. `pr-insights-pipeline.yml`):

```yaml
trigger: none

pool:
  vmImage: 'ubuntu-latest'

variables:
  - group: ado-insights-secrets

stages:
  - stage: Extract
    displayName: 'Extract PR Metrics'
    jobs:
      - job: ExtractPRs
        steps:
          - pwsh: |
              New-Item -ItemType Directory -Force -Path "$(Pipeline.Workspace)/data" | Out-Null
              New-Item -ItemType Directory -Force -Path "$(Pipeline.Workspace)/csv_output" | Out-Null
              New-Item -ItemType Directory -Force -Path "$(Pipeline.Workspace)/aggregates" | Out-Null
            displayName: 'Create directories'

          - task: UseNode@1
            displayName: 'Install Node.js 22'
            inputs:
              version: '22.x'

          - task: DownloadPipelineArtifact@2
            displayName: 'Download previous database'
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

          - task: ExtractPullRequests@3
            displayName: 'Extract PR metrics'
            inputs:
              organization: 'YOUR_ORG_NAME'
              projects: |
                YOUR_PROJECT_1
                YOUR_PROJECT_2
              pat: '$(PAT_SECRET)'
              database: '$(Pipeline.Workspace)/data/ado-insights.sqlite'
              outputDir: '$(Pipeline.Workspace)/csv_output'
              aggregatesDir: '$(Pipeline.Workspace)/aggregates'

          - task: PublishPipelineArtifact@1
            displayName: 'Publish database'
            condition: succeeded()
            inputs:
              targetPath: '$(Pipeline.Workspace)/data'
              artifact: 'ado-insights-db'

          - task: PublishPipelineArtifact@1
            displayName: 'Publish aggregates'
            condition: succeeded()
            inputs:
              targetPath: '$(Pipeline.Workspace)/aggregates'
              artifact: 'aggregates'

          - task: PublishPipelineArtifact@1
            displayName: 'Publish CSVs'
            condition: succeeded()
            inputs:
              targetPath: '$(Pipeline.Workspace)/csv_output'
              artifact: 'csv-output'
```

Replace `YOUR_ORG_NAME` and project names. Then in ADO: **Pipelines** → **New pipeline** → select your repo → **Existing Azure Pipelines YAML file** → choose the file → **Save and run**.

The full reference template lives at [`pr-insights-pipeline.yml`](../../pr-insights-pipeline.yml) at repo root.

---

## Step 5 — Verify the run

After the pipeline completes, check the **Artifacts** section:

| Artifact | Purpose |
|---|---|
| `ado-insights-db` | SQLite database (enables incremental runs) |
| `aggregates` | Dashboard data (enables PR Insights hub) |
| `csv-output` | PowerBI-compatible CSVs |

---

## Step 6 — View the dashboard

After a successful run that publishes the `aggregates` artifact:

1. Navigate to your ADO project.
2. Find **PR Insights** in the left navigation under **Repos**.
3. The dashboard auto-discovers pipelines that publish aggregates.

If you have multiple pipelines publishing aggregates, set a default in **Project Settings** → **PR Insights Settings**.

The dashboard also accepts `?dataset=<url>` (dev/testing) or `?pipelineId=<id>` (override) URL parameters.

For details on filter behavior — author/team/repository constraints, comments-coverage indicator (`full` vs `partial`) — see [`docs/reference/dataset-contract.md`](../reference/dataset-contract.md).

---

## Schedule the pipeline

For continuous metrics:

```yaml
schedules:
  - cron: "0 6 * * *"        # daily at 6 AM UTC
    displayName: "Daily PR Extraction"
    branches:
      include: [main]
    always: true
```

### Weekly backfill (recommended)

Add a weekly task that re-extracts the recent window to converge late changes:

```yaml
- task: ExtractPullRequests@3
  inputs:
    # ... other inputs ...
    backfillDays: 60
```

A production-ready template with both daily and weekly stages lives at [`pr-insights-pipeline.yml`](../../pr-insights-pipeline.yml).

---

## Extracting historical data

By default, the first extraction covers PRs from January 1st of the current year through yesterday. To extend further back, add date overrides on your first run only:

```yaml
- task: ExtractPullRequests@3
  inputs:
    # ... other inputs ...
    startDate: '2025-01-01'
    endDate: '2026-01-19'
```

After the first run, remove `startDate`/`endDate` — subsequent runs do incremental daily extraction automatically.

---

## Backfilling historical PR comments

When you enable `includeComments: true` on your extract pipeline, incremental runs start fetching comment threads for newly-closed PRs — but historical PRs already in the database (`comments_extracted_at IS NULL`) are not retroactively covered. For organizations with large histories, run a **one-time backfill pipeline** to catch up. After the backlog is drained, the regular extract pipeline maintains coverage going forward.

> **Precondition.** The DB artifact must already contain `pr_threads` / `pr_comments` tables (added by schema migrations on any modern extract run). Backfill against an older DB logs `backfill-comments: skipped (legacy schema; no thread storage tables)` and exits 0 with zero work done — run your extract pipeline once under the current task version first, then start the backfill.

### One-line YAML change

A separate pipeline (or stage) flips the `ExtractPullRequests@3` task into backfill mode:

```yaml
- task: ExtractPullRequests@3
  inputs:
    organization: 'YOUR_ORG'
    pat: '$(PAT_SECRET)'
    database: '$(Pipeline.Workspace)/data/ado-insights.sqlite'
    mode: backfill-comments          # the only line that changes
    backfillLimit: 2500              # sized to fit a 60-min job timeout
```

The task downloads the existing DB, drains up to `backfillLimit` uncovered PRs (oldest by `closed_date` first), and republishes. Runs that find nothing uncovered exit without API calls, so daily scheduling is safe even after the backlog is drained.

### Sizing `backfillLimit`

> **Empirical guidance, not a guarantee.** Backfill throughput measured on hosted Ubuntu agents against the Azure DevOps cloud REST API is approximately **one PR per second steady-state**. Actual throughput depends on thread volume per PR and upstream rate limiting; treat every estimate derived from this rate as order-of-magnitude.

| Pipeline job timeout | Suggested `backfillLimit` (~1 PR/sec) |
|---|---|
| 60 min (default hosted) | `2500` |
| 120 min | `6000` |
| 360 min (hosted max / self-hosted) | `18000` |

Resumability is automatic: the selection query filters on `comments_extracted_at IS NULL`, so re-runs only see PRs that haven't been covered yet. Interrupted runs (timeout, SIGINT, transient failure) leave already-committed PRs stamped and roll back the in-progress PR untouched — the next run resumes from where the previous stopped.

### Optional scope filters

```yaml
- task: ExtractPullRequests@3
  inputs:
    organization: 'YOUR_ORG'
    projects: 'ProjectA'             # single project
    pat: '$(PAT_SECRET)'
    database: '$(Pipeline.Workspace)/data/ado-insights.sqlite'
    mode: backfill-comments
    backfillSince: '2024-01-01'      # closed on or after
    backfillUntil: '2025-01-01'      # closed strictly before
    backfillLimit: 1000
```

`backfillSince`/`backfillUntil` are strict `YYYY-MM-DD`. Leaving all three empty drains every uncovered PR across every project.

### Inputs rejected in this mode (fail fast)

In `mode: backfill-comments`, these extract-only inputs cause an immediate task failure:

| Input | Backfill equivalent or reason |
|---|---|
| `startDate` / `endDate` | Use `backfillSince` / `backfillUntil`. |
| `backfillDays` | N/A — backfill does not re-fetch PR metadata. |
| `includeComments: true` | Backfill always fetches comments; this is the mode. |
| `commentsMaxPrsPerRun` | Use `backfillLimit`. |

Symmetrically, `backfillSince` / `backfillUntil` / `backfillLimit` in `mode: extract` also fail fast. Keep backfill and extract as separate pipelines (or stages) with clean input surfaces.

### How to tell it's working

Console logs are prefixed `backfill-comments:`.

| Signal | What it means |
|---|---|
| `backfill run over N pull request(s)` | Opening line. `N` is the size of the selection. |
| `covered PR <uid> (ordinal of total) [Processed]` or `[Failed]` | Per-PR progress. `Processed` = coverage marker stamped; `Failed` = marker left NULL so the PR is reselected next run. |
| `processed N pull requests (K failures)` | Closing line — same on empty-selection runs (`processed 0 pull requests (0 failures)`). |

The backlog is drained when a run's opening line reports `over 0 pull request(s)` and no per-PR lines appear before the closing line. After that, the regular extract pipeline (with `includeComments: true`) maintains coverage going forward.

The published `run_summary.json` artifact carries a matching `backfill-comments: loop-complete: processed=X failed=Y` entry in its `warnings` list for programmatic consumers; console-log readers grep for `processed N pull requests (K failures)`.

After the loop, the task re-runs `generate-csv` and `generate-aggregates` exactly like extract, so dashboard percentiles (`review_time_p50`/`review_time_p90`) and the PowerBI `auxiliary/comments/` CSVs refresh in the next published artifact. The dashboard's comments-coverage indicator (`full`/`partial`) updates on the next load.

---

## Next steps

- [Task Input Reference](../reference/task-reference.md) — all task inputs
- [Troubleshooting](troubleshooting.md)
- [Runbook](../operations/runbook.md) — operational procedures
- [CSV Schema](../reference/csv-schema.md)

For issues and feature requests: [GitHub repository](https://github.com/oddessentials/ado-git-repo-insights). Publisher: OddEssentials.
</content>
