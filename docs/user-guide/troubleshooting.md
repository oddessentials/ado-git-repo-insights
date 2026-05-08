# Troubleshooting

Common issues and fixes for both CLI and Extension users.

---

## Installation

### "ado-insights: command not found"

Diagnose: `python -m ado_git_repo_insights.cli doctor`. Cause is typically that the install method's scripts directory isn't on PATH.

| Method | Fix |
|---|---|
| pipx | `pipx ensurepath`, restart terminal |
| uv | `uv tool update-shell`, restart terminal |
| pip | `ado-insights setup-path` (or `ado-insights setup-path --print-only` to preview) |

### Multiple installations conflict

Symptoms: wrong version runs, or commands behave unexpectedly. `ado-insights doctor` flags this.

```bash
# Pick one and remove the others:
pipx uninstall ado-git-repo-insights
uv tool uninstall ado-git-repo-insights
pip uninstall ado-git-repo-insights
# Then reinstall via the method you want to keep.
```

### Upgrade / uninstall

Use whichever installer you originally used: `pipx upgrade`, `uv tool upgrade`, or `pip install --upgrade`. Same shape for `uninstall`. If you ran `ado-insights setup-path`, undo with `ado-insights setup-path --remove` before the uninstall.

---

## Authentication

| Error | Cause | Fix |
|---|---|---|
| `401 Unauthorized` | PAT invalid, expired, or wrong scope | Regenerate with **Code (Read)** scope. For multi-org setups, enable "All accessible organizations." |
| `403 Forbidden` | PAT lacks access to the targeted project(s) | Verify the PAT's organization matches; check project-level permissions. |

PAT setup canonical reference: [extension guide § Step 2](extension.md#step-2--create-a-personal-access-token-pat).

---

## Extraction

### "No PRs extracted" but PRs exist

| Cause | Fix |
|---|---|
| End date defaults to yesterday (excludes today's PRs to ensure complete data) | Pass `--end-date $(date +%Y-%m-%d)` (CLI) or `endDate: '<today>'` (task input) |
| Only completed (merged) PRs are extracted; active/draft/abandoned are not | By design |
| Timezone — tool uses local dates, ADO API uses UTC | Late-day local times may roll into "tomorrow" UTC |
| Project names are case-sensitive | Match the exact ADO project name |
| Start date too recent (default: Jan 1 of current year) | `--start-date YYYY-MM-DD` for older data |

### Extraction hangs or is slow

Check logs for retry messages (rate limiting). Increase `rate_limit_sleep_seconds` and `retry_delay_seconds` in `config.yaml`. Break a large date range into smaller chunks. Verify connectivity to `dev.azure.com`. Debug verbosely with `PYTHONLOGLEVEL=DEBUG`.

---

## Comment extraction & backfill

### "Backfill exited 0 but no PRs were processed"

The DB schema predates the thread storage tables. The subcommand logs `backfill-comments: skipped (legacy schema; no thread storage tables)` and exits 0 with zero work done. Run the extract pipeline once under the current CLI/task version (schema migrations add the tables automatically), then re-run backfill.

### Per-PR failures reported but the run exited 0

By design. A per-PR error leaves that PR's coverage marker NULL so the next invocation reselects it; the loop continues with the next PR. Inspect `run_summary.json`'s `warnings` list for the normalized error message of the failing PR.

### Backfill hits pipeline timeout

Size `--limit` (CLI) / `backfillLimit` (task) to fit your job timeout. Sizing table: [extension guide § Sizing backfillLimit](extension.md#sizing-backfilllimit). Interrupted runs are resumable: PRs already committed stay covered, the next run picks up where the previous stopped.

### "How do I know backfill is done?"

See [extension guide § How to tell it's working](extension.md#how-to-tell-its-working). A drained backlog is a run whose opening line reports an empty selection, with no per-PR progress lines and a zero-count closing line.

---

## Pipeline (Extension)

| Symptom | Likely cause | Fix |
|---|---|---|
| `Task not found` | Extension not installed, or pipeline can't see it | Verify install (Org Settings → Extensions); confirm task name `ExtractPullRequests@3`; ensure agent can reach the marketplace |
| `Python not found` | Self-hosted agent missing Python | Add a `UsePythonVersion@0` step before the task |
| First run "downloads nothing" warning | No prior artifact yet | Expected on first run; subsequent runs download the previous DB |
| Pipeline succeeds but no data | Missing `aggregates` artifact, or wrong projects | Verify the publish step ran; cross-check `run_summary.json`; confirm project names |

---

## Dashboard

### "PR Insights" menu missing / dashboard not showing

| Cause | Fix |
|---|---|
| No `aggregates` artifact | Confirm pipeline published it; the artifact must contain `dataset-manifest.json` |
| Missing **Build (Read)** permission | The dashboard reads pipeline artifacts; ask an admin to grant access |
| Artifact retention expired | Configure extended retention (90+ days) in pipeline settings |

Force a specific pipeline with `?pipelineId=<id>` in the dashboard URL.

### Dashboard shows wrong pipeline

**Project Settings** → **PR Insights Settings** → select the correct default pipeline. Or use the `?pipelineId=<id>` URL parameter.

---

## Data

### Duplicate PRs in database

Should not happen — UPSERT semantics. If they do, file an issue. Diagnose:

```sql
SELECT pull_request_uid, COUNT(*) FROM pull_requests
GROUP BY pull_request_uid HAVING COUNT(*) > 1;
```

### CSV has wrong columns

The CSV schema is a stable contract. If column order or names differ, file an issue. Reference: [CSV Schema](../reference/csv-schema.md).

### Missing historical data

Re-extract the historical range explicitly:

```bash
ado-insights extract --start-date 2024-01-01 --end-date 2024-12-31 ...
```

Extension equivalent: pass `startDate` and `endDate` task inputs.

---

## Recovery

### Database corruption

```bash
rm ado-insights.sqlite
ado-insights extract --start-date YYYY-MM-DD ...
```

Or restore from a prior pipeline artifact: **Pipelines** → **Runs** → last successful run → Artifacts → download `ado-insights-db`.

### Missing/expired pipeline artifact

The system treats it as first-run and creates a fresh database. Prevention: extended artifact retention (90+ days) in pipeline settings.

---

## Logging

```bash
PYTHONLOGLEVEL=DEBUG ado-insights extract ...           # verbose console
ado-insights --log-format jsonl extract ...             # JSONL → run_artifacts/logs.jsonl
```

`--log-format` is a global flag and must precede the subcommand — see [CLI Reference § Global Options](../reference/cli-reference.md#global-options).

`run_artifacts/run_summary.json` is always written, even on failure (status, per-project results, first fatal error, timing).

---

## Getting help

Check [existing GitHub issues](https://github.com/oddessentials/ado-git-repo-insights/issues) first. When opening a new one, include:

- Command or task configuration (PAT redacted)
- Error message
- `run_summary.json` contents
- Debug logs if available
</content>
