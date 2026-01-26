# Troubleshooting

Common issues and solutions for both CLI and Extension users.

---

## Installation Issues

### "ado-insights: command not found"

**Run the doctor command** to diagnose:

```bash
python -m ado_git_repo_insights.cli doctor
```

**Cause:** Scripts directory is not on PATH.

**Solutions by installation method:**

| Method | Fix |
|--------|-----|
| pipx | Run: `pipx ensurepath` then restart terminal |
| uv | Run: `uv tool update-shell` then restart terminal |
| pip | Run: `ado-insights setup-path` then restart terminal |

**Manual fix:** Add the scripts directory to your PATH. Use `ado-insights setup-path --print-only` to see the command.

### Multiple installations conflict

**Symptoms:** Wrong version runs, or commands behave unexpectedly.

**Diagnose:**

```bash
ado-insights doctor
```

If doctor shows "Multiple installations found":

1. **Keep pipx/uv, remove pip:**
   ```bash
   pip uninstall ado-git-repo-insights
   ```

2. **Keep uv, remove pipx:**
   ```bash
   pipx uninstall ado-git-repo-insights
   ```

3. **Start fresh:**
   ```bash
   pip uninstall ado-git-repo-insights
   pipx uninstall ado-git-repo-insights
   uv tool uninstall ado-git-repo-insights
   # Then reinstall with your preferred method
   pipx install ado-git-repo-insights
   ```

### Upgrade issues

**Upgrade commands by installation method:**

```bash
# pipx
pipx upgrade ado-git-repo-insights

# uv
uv tool upgrade ado-git-repo-insights

# pip
pip install --upgrade ado-git-repo-insights
```

### Uninstallation

**If you used setup-path, remove it first:**

```bash
ado-insights setup-path --remove
```

**Then uninstall:**

```bash
# pipx
pipx uninstall ado-git-repo-insights

# uv
uv tool uninstall ado-git-repo-insights

# pip
pip uninstall ado-git-repo-insights
```

---

## Authentication Issues

### "401 Unauthorized"

**Cause:** PAT is invalid, expired, or lacks permissions.

**Solution:**
1. Create a new PAT with **Code (Read)** scope
2. Ensure PAT has access to all target projects
3. For multi-org setups, enable "All accessible organizations"
4. Update the PAT in your variable group or environment variable

### "403 Forbidden"

**Cause:** PAT lacks access to specific projects.

**Solution:**
1. Verify the PAT organization matches your target
2. Check project-level permissions
3. Try creating a PAT with "All accessible organizations" scope

---

## Extraction Issues

### "No PRs extracted" but PRs exist

**Causes:**

1. **End date defaults to yesterday**
   - PRs closed today are excluded to ensure complete data
   - Use `--end-date` or `endDate` to include today:
     ```bash
     # CLI
     ado-insights extract --end-date $(date +%Y-%m-%d) ...

     # Extension task
     endDate: '2026-01-19'
     ```

2. **Only completed PRs are extracted**
   - Active, draft, and abandoned PRs are not extracted
   - The tool captures only successfully merged PRs

3. **Timezone differences**
   - Tool uses local dates; ADO API uses UTC
   - A PR closed late in your timezone may appear as closed "tomorrow" in UTC

4. **Project names are case-sensitive**
   - Verify exact project names in Azure DevOps

5. **Start date is too recent**
   - First run defaults to Jan 1 of current year
   - Use `--start-date` for historical data

### Extraction hangs or is slow

**Causes:**

1. **Rate limiting**
   - Check logs for retry messages
   - Increase `rate_limit_sleep_seconds` in config

2. **Large date range**
   - Break into smaller ranges
   - Try extracting one date at a time with debug logging

3. **Network issues**
   - Verify connectivity to `dev.azure.com`
   - Check firewall/proxy settings

**Debug:**
```bash
export PYTHONLOGLEVEL=DEBUG
ado-insights extract ...
```

### "Connection timeout"

**Solution:**
1. Increase `retry_delay_seconds` in config
2. Check network connectivity
3. Verify proxy settings if applicable

---

## Pipeline Issues (Extension)

### "Task not found" error

**Cause:** Extension not installed or not visible to the pipeline.

**Solution:**
1. Verify extension is installed: Organization Settings → Extensions
2. Check task name is exactly `ExtractPullRequests@2`
3. Ensure pipeline agent can reach the marketplace
4. Try creating a new pipeline

### "Python not found" error

**Cause:** Self-hosted agent missing Python.

**Solution:**
1. The extension auto-installs Python dependencies
2. Ensure agent has internet access
3. Verify pip is available on the agent
4. Use `UsePythonVersion@0` task if needed

### First run downloads nothing

**This is expected.** The "Download Previous Database" step will show a warning on the first run because there's no prior artifact. Subsequent runs will download the previous database for incremental updates.

### Pipeline succeeds but no data

**Check:**
1. Verify the pipeline published an `aggregates` artifact
2. Ensure `run_summary.json` shows success
3. Check that projects in the task inputs are correct

---

## Dashboard Issues

### Dashboard not showing / "PR Insights" menu missing

**Causes:**

1. **No aggregates artifact**
   - Verify the pipeline published an `aggregates` artifact
   - Check that the artifact contains `dataset-manifest.json`

2. **Permissions**
   - You need **Build (Read)** permission on the pipeline
   - The dashboard reads data from pipeline artifacts

3. **Artifact retention**
   - Artifacts may have expired
   - Configure extended retention in pipeline settings

**Debug:** Add `?pipelineId=<id>` to the dashboard URL to force a specific pipeline.

### "No access to analytics pipeline artifacts"

**Solution:** Ask an admin to grant Build Read permission on the analytics pipeline.

### Dashboard shows wrong pipeline

**Solution:**
1. Go to **Project Settings** → **PR Insights Settings**
2. Select the correct default pipeline
3. Or use `?pipelineId=<id>` query parameter

---

## Data Issues

### Duplicate PRs in database

**This should not happen** — the system uses UPSERT semantics.

**Debug:**
```sql
SELECT pull_request_uid, COUNT(*)
FROM pull_requests
GROUP BY pull_request_uid
HAVING COUNT(*) > 1
```

If duplicates exist, check if `pull_request_uid` generation is consistent. File an issue if this occurs.

### CSV has wrong columns

**This is a contract violation.** The CSV schema is guaranteed stable.

**Expected headers:**
```
pull_requests.csv: pull_request_uid,pull_request_id,organization_name,project_name,repository_id,user_id,title,status,description,creation_date,closed_date,cycle_time_minutes
```

File an issue if column order or names differ.

### Missing historical data

**Solution:**
1. Run with explicit date range:
   ```bash
   ado-insights extract --start-date 2024-01-01 --end-date 2024-12-31 ...
   ```
2. For Extension, add `startDate` and `endDate` task inputs

---

## Recovery Procedures

### Database corruption

**Option A:** Delete and re-extract
```bash
rm ado-insights.sqlite
ado-insights extract --start-date 2024-01-01 ...
```

**Option B:** Restore from prior artifact
1. Go to Pipelines → Runs → [last successful run] → Artifacts
2. Download `ado-insights-db` artifact

### Missing/expired pipeline artifact

**Behavior:** System treats it as first-run and creates a fresh database.

**Prevention:** Configure extended artifact retention (90+ days) in pipeline settings.

**Recovery:** Use `--start-date` to re-extract historical data.

---

## Logging and Debugging

### Enable debug logging

**CLI:**
```bash
export PYTHONLOGLEVEL=DEBUG
ado-insights extract ...
```

**JSONL logging:**
```bash
ado-insights extract --log-format jsonl ...
# Check run_artifacts/logs.jsonl
```

### Run summary location

Always written to `run_artifacts/run_summary.json`, even on failure.

Contains:
- Status (success/failure)
- Per-project results
- First fatal error
- Timing and counts

---

## Getting Help

1. Check the [GitHub Issues](https://github.com/oddessentials/ado-git-repo-insights/issues) for known issues
2. Open a new issue with:
   - Command/task configuration (with PAT redacted)
   - Error message
   - `run_summary.json` contents
   - Debug logs if available
