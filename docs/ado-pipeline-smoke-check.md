# ADO Pipeline Smoke Check

This document describes end-to-end validation of Azure DevOps Pipeline behavior that cannot be verified via unit tests.

## Why This Exists

Unit tests verify code behavior. However, claims about Azure DevOps platform features (artifact retention, RBAC, pipeline behavior) require end-to-end validation in a real pipeline environment.

## Smoke Check Scenarios

### 1. Artifact Download → Update → Publish

**What to verify:**
- Pipeline downloads previous `ado-insights.sqlite` artifact
- Extraction adds new PRs to existing database
- Updated database is published as new artifact

**How to verify:**
1. Run pipeline with initial extraction
2. Wait for second scheduled run
3. Verify database row count increased (not reset)

### 2. Failure Does Not Overwrite Database

**What to verify:**
- If extraction fails mid-run, the previous artifact is NOT overwritten
- Database integrity is preserved

**How to verify:**
1. Trigger pipeline with invalid PAT or unreachable org
2. Verify previous artifact is still downloadable
3. Verify row counts match pre-failure state

### 3. VSO Error Emission

**What to verify:**
- `##vso[task.logissue type=error]` appears in pipeline logs on failure
- Pipeline status is marked as Failed (red)

**How to verify:**
1. Trigger pipeline with intentional failure (invalid config)
2. Verify error indicator visible in ADO UI
3. Verify `##vso[task.complete result=Failed]` in raw logs

## Automated vs Manual

| Scenario | Can Automate? | Notes |
|----------|---------------|-------|
| Artifact flow | ⚠️ Partial | Requires ADO API to inspect artifacts |
| Failure safety | ❌ Manual | Requires intentional failure injection |
| VSO emission | ✅ Yes | Covered by `test_run_summary.py` |

## Recommended Cadence

- Run smoke check manually after each release
- Or integrate with ADO API for automated artifact inspection
