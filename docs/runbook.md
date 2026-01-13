# Runbook: ado-git-repo-insights

This operational runbook documents how to run, monitor, and recover from failures in the ado-git-repo-insights system.

---

## Quick Start

### First-Time Setup

1. **Install the package**:
   ```bash
   pip install ado-git-repo-insights
   ```

2. **Create a configuration file** (or use CLI arguments):
   ```bash
   cp config.example.yaml config.yaml
   # Edit config.yaml with your organization and projects
   ```

3. **Set up your PAT**:
   - Create a PAT in Azure DevOps with **Code (Read)** scope
   - For multi-org setups, enable **All accessible organizations**
   - Store securely (never commit to git)

---

## Running Extraction

### Daily Incremental Run (Default)

```bash
ado-insights extract \
  --organization MyOrg \
  --projects "ProjectA,ProjectB" \
  --pat $ADO_PAT \
  --database ./ado-insights.sqlite
```

**What happens**:
1. Downloads prior SQLite database (if exists)
2. Determines last extraction date from metadata
3. Extracts PRs from `last_date + 1` to yesterday
4. UPSERTs data into SQLite
5. Updates extraction metadata

### Backfill Run (Weekly Recommended)

```bash
ado-insights extract \
  --organization MyOrg \
  --projects "ProjectA,ProjectB" \
  --pat $ADO_PAT \
  --database ./ado-insights.sqlite \
  --backfill-days 60
```

**What happens**:
1. Re-extracts last 60 days of data
2. Updates any changed PR data (late votes, status changes)
3. Ensures data convergence via UPSERT

**Recommended schedule**: Weekly (Sundays) to catch late changes.

### Full Historical Run (Override)

```bash
ado-insights extract \
  --organization MyOrg \
  --projects "ProjectA" \
  --pat $ADO_PAT \
  --database ./ado-insights.sqlite \
  --start-date 2024-01-01 \
  --end-date 2024-12-31
```

---

## Generating CSVs

```bash
ado-insights generate-csv \
  --database ./ado-insights.sqlite \
  --output ./csv_output
```

**Output files**:
- `organizations.csv`
- `projects.csv`
- `repositories.csv`
- `pull_requests.csv`
- `users.csv`
- `reviewers.csv`

### CSV Contract Validation

CSVs are guaranteed to:
- Have exact column names and order (PowerBI compatible)
- Be deterministically sorted for diff-friendly comparison
- Use UTF-8 encoding with Unix line endings

---

## Pipeline Integration

### Sample Azure DevOps Pipeline

See [sample-pipeline.yml](../sample-pipeline.yml) for a complete example.

**Key patterns**:

1. **Download prior artifact** (if exists):
   ```yaml
   - task: DownloadPipelineArtifact@2
     inputs:
       artifact: ado-insights-db
       path: $(System.DefaultWorkingDirectory)
     continueOnError: true  # First run has no artifact
   ```

2. **Run extraction**:
   ```yaml
   - script: |
       ado-insights extract ...
     displayName: 'Extract PRs'
   ```

3. **Publish only on success**:
   ```yaml
   - task: PublishPipelineArtifact@1
     inputs:
       targetPath: '$(System.DefaultWorkingDirectory)/ado-insights.sqlite'
       artifact: ado-insights-db
     condition: succeeded()  # CRITICAL: Only publish on success
   ```

### Schedule Recommendations

| Schedule | Mode | Purpose |
|----------|------|---------|
| Daily 6 AM | Incremental | Capture new PRs |
| Sunday 3 AM | Backfill 60 days | Convergence for late changes |

---

## First-Run Behavior

When no prior database exists:

1. **CLI**: Creates fresh SQLite database
2. **Extraction**: Starts from configured date or default (Jan 1 of current year)
3. **Artifacts**: Normal publish on success

**Log message**: `Creating new database: ado-insights.sqlite`

---

## Missing/Expired Artifact Recovery

When the pipeline artifact has expired or is missing:

1. **Behavior**: System treats it as first-run
2. **Log message**: `Prior database not found, initializing fresh`
3. **Data**: Historical data will be re-extracted based on:
   - `--start-date` if specified
   - Default: Jan 1 of current year

**Prevention**: Configure extended artifact retention (90+ days) in pipeline:
```yaml
- task: PublishPipelineArtifact@1
  inputs:
    targetPath: '$(System.DefaultWorkingDirectory)/ado-insights.sqlite'
    artifact: ado-insights-db
    publishLocation: 'pipeline'
    # Note: Set retention via pipeline settings, not here
```

---

## Failure Recovery

### Extraction Failures

| Symptom | Cause | Resolution |
|---------|-------|------------|
| `401 Unauthorized` | Invalid/expired PAT | Regenerate PAT with Code (Read) scope |
| `403 Forbidden` | PAT lacks access | Ensure PAT has access to all target projects |
| `Rate limited` | Too many requests | Increase `rate_limit_sleep_seconds` in config |
| `Connection timeout` | Network issue | Increase `retry_delay_seconds`, verify connectivity |

**Key invariant**: If extraction fails, no artifact is published. Prior database remains intact.

### Database Corruption

If `ado-insights.sqlite` is corrupted:

1. **Option A**: Delete and re-extract from desired start date
   ```bash
   rm ado-insights.sqlite
   ado-insights extract --start-date 2024-01-01 ...
   ```

2. **Option B**: Restore from prior pipeline artifact
   - Go to Pipelines > Runs > [last successful run] > Artifacts
   - Download `ado-insights-db` artifact

### CSV Validation

To validate CSV contract:

```bash
# Compare against expected schema
ado-insights generate-csv --database ./ado-insights.sqlite --output ./csv_test
# Check column order matches exactly
head -1 csv_test/pull_requests.csv
```

Expected header for `pull_requests.csv`:
```
pull_request_uid,pull_request_id,organization_name,project_name,repository_id,user_id,title,status,description,creation_date,closed_date,cycle_time_minutes
```

---

## Monitoring

### Key Metrics to Track

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| PRs extracted | Count per run | < 0 for active repos |
| Extraction duration | Time per project | > 30 minutes |
| Artifact size | SQLite file size | Sudden large changes |

### Log Levels

- **INFO**: Normal operation (default)
- **DEBUG**: Detailed API calls, pagination, retries

Enable debug logging:
```bash
export PYTHONLOGLEVEL=DEBUG
ado-insights extract ...
```

---

## Secrets Management

### Invariant 19: PAT is Never Logged

The system guarantees:
- PAT is never printed to stdout/stderr
- PAT is not in exception messages
- PAT is masked in repr/str output

### Recommended PAT Storage

| Environment | Method |
|-------------|--------|
| CI/CD | Variable groups with secret type |
| Local | Environment variable |
| Pipeline | `$(PAT_SECRET)` reference |

---

## Troubleshooting

### Common Issues

**Q: "No PRs extracted" but I know there are PRs**

1. **PRs closed today are excluded** — End date defaults to yesterday
   ```powershell
   # Include today explicitly
   ado-insights extract --end-date (Get-Date -Format yyyy-MM-dd) ...
   ```

2. **Only completed PRs are extracted** — Active/draft PRs are skipped
   - The tool queries by **closed date**, not creation date
   - This is by design for cycle time metrics

3. **Timezone differences** — Tool uses local dates; ADO API uses UTC
   - A PR's closed date may appear as a different local date depending on your timezone

4. **Project names are case-sensitive**
5. **PAT lacks Code (Read) access to the project**

**Q: CSV has different columns than expected**
- This is a contract violation. File an issue.
- Compare against `CSV_SCHEMAS` in `models.py`

**Q: Duplicate PRs in database**
- Should not happen (UPSERT semantics)
- Check if `pull_request_uid` generation is consistent
- Run `SELECT pull_request_uid, COUNT(*) FROM pull_requests GROUP BY pull_request_uid HAVING COUNT(*) > 1`

**Q: Extraction hangs on specific date**
- Could be rate limiting or large volume
- Check logs for retry messages
- Try extracting that date alone with debug logging

### Debugging

- **Enable JSONL logging**: `--log-format jsonl`
- **Log location**: `run_artifacts/*.jsonl`
- **Run summary**: `run_artifacts/run_summary.json` (always written, even on failure)

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01 | Initial release |
