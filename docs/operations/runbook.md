# Operations Runbook

Operational procedures for monitoring, maintaining, and recovering the PR Insights system.

---

## Daily Operations

### Verify Daily Run

**Checklist:**
1. Pipeline completed successfully (green status)
2. Artifacts published: `ado-insights-db`, `aggregates`, `csv-output`
3. `run_summary.json` shows success
4. PR counts are non-zero for active repositories

### Key Metrics to Monitor

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| PRs extracted | Count per run | 0 for active repos |
| Extraction duration | Time per project | > 30 minutes |
| Artifact size | SQLite file size | Sudden large changes |

---

## Scheduled Runs

### Recommended Schedule

| Schedule | Mode | Purpose |
|----------|------|---------|
| Daily 6 AM UTC | Incremental | Capture new PRs |
| Sunday 3 AM UTC | Backfill 60 days | Convergence for late changes |

### Pipeline Schedule Configuration

```yaml
schedules:
  - cron: "0 6 * * *"  # Daily at 6 AM UTC
    displayName: "Daily PR Extraction"
    branches:
      include: [main]
    always: true
```

---

## Backfill Operations

### When to Run Backfill

- Weekly (Sunday) — scheduled maintenance
- After extended downtime
- When late PR changes are suspected
- After artifact expiration/recovery

### Manual Backfill (CLI)

```bash
ado-insights extract \
  --organization MyOrg \
  --projects "Project1,Project2" \
  --pat $ADO_PAT \
  --database ./ado-insights.sqlite \
  --backfill-days 60
```

### Manual Backfill (Extension)

Add `backfillDays: 60` to task inputs for a single run.

---

## Failure Recovery

### Extraction Failed

**Invariant:** If extraction fails, no artifact is published. Prior database remains intact.

**Recovery:**
1. Check logs for error details
2. Review `run_summary.json` for first error
3. Fix the issue (PAT expired, network, etc.)
4. Re-run the pipeline

### Common Failure Causes

| Symptom | Cause | Resolution |
|---------|-------|------------|
| `401 Unauthorized` | Invalid/expired PAT | Regenerate PAT |
| `403 Forbidden` | PAT lacks access | Check project permissions |
| Rate limited | Too many requests | Increase `rate_limit_sleep_seconds` |
| Connection timeout | Network issue | Retry, check connectivity |

### Database Corruption

**Option A:** Delete and re-extract
```bash
rm ado-insights.sqlite
ado-insights extract --start-date 2024-01-01 ...
```

**Option B:** Restore from prior artifact
1. Go to Pipelines → Runs → [last successful run] → Artifacts
2. Download `ado-insights-db` artifact
3. Replace the corrupted file

### Missing/Expired Artifact

**Behavior:** System treats it as first-run and creates fresh database.

**Recovery:**
1. Configure longer artifact retention (90+ days)
2. Use `--start-date` to re-extract historical data

---

## Artifact Retention

### Recommended Settings

| Artifact | Retention | Purpose |
|----------|-----------|---------|
| `ado-insights-db` | 90+ days | Incremental extraction |
| `aggregates` | 30+ days | Dashboard access |
| `csv-output` | 30+ days | Data export |

### Configure in Azure DevOps

1. Go to Project Settings → Pipelines → Settings
2. Set "Days to keep artifacts from completed builds"

---

## Dashboard Operations

### Dashboard Not Loading

**Check:**
1. Pipeline published `aggregates` artifact
2. Artifact contains `dataset-manifest.json`
3. User has Build Read permission

### Refresh Dashboard Data

Run the pipeline manually or wait for scheduled run. Dashboard auto-discovers the latest artifact.

### Override Dashboard Pipeline

Add `?pipelineId=<id>` to the URL to force a specific pipeline.

---

## Logging and Debugging

### Enable Debug Logging

**CLI:**
```bash
export PYTHONLOGLEVEL=DEBUG
ado-insights extract ...
```

**Log locations:**
- Console output (default)
- `run_artifacts/logs.jsonl` (with `--log-format jsonl`)
- `run_artifacts/run_summary.json` (always written)

### Run Summary Contents

```json
{
  "status": "success",
  "start_time": "2026-01-19T06:00:00Z",
  "end_time": "2026-01-19T06:05:23Z",
  "projects": [
    {"name": "Project1", "prs_extracted": 42, "status": "success"}
  ],
  "total_prs": 42,
  "first_error": null
}
```

### ADO Pipeline Logging

- Errors emit `##vso[task.logissue type=error]` for visibility
- Red indicators appear in pipeline UI
- Download artifacts for detailed logs

---

## Security Operations

### PAT Rotation

1. Create new PAT with Code (Read) scope
2. Update variable group `ado-insights-secrets`
3. Verify next pipeline run succeeds
4. Revoke old PAT

### PAT Security Guarantees

- PAT is never logged (Invariant 19)
- PAT is not stored in database
- PAT is masked in config output: `PAT: ********`
- Secrets are redacted at log formatter level

---

## Data Validation

### Verify CSV Contract

```bash
# Check column headers
head -1 csv_output/pull_requests.csv

# Expected:
# pull_request_uid,pull_request_id,organization_name,project_name,repository_id,user_id,title,status,description,creation_date,closed_date,cycle_time_minutes
```

### Check for Duplicates

```sql
SELECT pull_request_uid, COUNT(*)
FROM pull_requests
GROUP BY pull_request_uid
HAVING COUNT(*) > 1;
-- Should return 0 rows
```

### Verify Convergence

After backfill, row counts should be non-decreasing. Compare `run_summary.json` across runs.

---

## Emergency Procedures

### Complete Data Loss

1. Delete existing database
2. Run extraction with `--start-date` to specify historical range
3. Verify `run_summary.json` shows expected counts

### Pipeline Broken

1. Check extension is installed in organization
2. Verify task name: `ExtractPullRequests@2`
3. Test with minimal pipeline configuration
4. Check agent connectivity to marketplace

---

## See Also

- [Troubleshooting](../user-guide/troubleshooting.md) — Common issues
- [Data Retention](data-retention.md) — Storage model details
