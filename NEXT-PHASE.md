# NEXT-PHASE.md: Remaining Work for ado-git-repo-insights

**Last Updated**: 2026-01-12
**Session Status**: Phase 11 - VG 2.1-2.3, VG 4.1 verified; VG 3.x, 4.2, 5.x, 6.x pending

---

## Current State

### Tests: 72 Passing
- Unit: 46 | Integration: 26
- All lint (ruff) and type checks (mypy) pass
- Run: `.venv\Scripts\python -m pytest tests/ --no-cov`

### Commits Made (7)
```
fc0dd3b fix: Add explicit generic type parameters for mypy strict mode
4ac18bf feat: Phase 11 - Extension metadata, icon, and Node20 upgrade
c1f6b17 docs: Add NEXT-PHASE.md for session handoff
d22e548 feat: Phase 7 CI/CD and Phase 10 rollout
a13b5f0 feat: Close all implementation gaps
7ba49af feat: Integration tests for Victory Gates 1.3-1.5
0ed0cce feat: Phase 5 - CLI integration and secret redaction
```

---

## Remaining Victory Gates (Live Verification Required)

### VG 2.1-2.3: CLI Victory Gate

**Status**: ✅ PASSED (2026-01-12)

**Commands to run**:
```bash
# Activate venv
.venv\Scripts\activate

# First-run test (creates new database)
ado-insights extract \
  --organization YOUR_ORG \
  --projects "Project1,Project2" \
  --pat YOUR_PAT \
  --database ./tmp/ado-insights.sqlite

# CSV generation test
ado-insights generate-csv \
  --database ./tmp/ado-insights.sqlite \
  --output ./tmp/csv_output

# Repeatability test (should produce identical output)
ado-insights generate-csv \
  --database ./tmp/ado-insights.sqlite \
  --output ./tmp/csv_output_2

# Validate outputs are identical
python scripts/csv_diff.py ./tmp/csv_output ./tmp/csv_output_2
```

**Expected Results**:
- SQLite database created at `./tmp/ado-insights.sqlite`
- Tables: organizations, projects, repositories, pull_requests, users, reviewers
- CSVs with exact column order per `CSV_SCHEMAS` in `persistence/models.py`
- Hash match between csv_output and csv_output_2

---

### VG 3.1-3.3: Pipeline Victory Gate

**Status**: NOT TESTED (requires ADO pipeline deployment)

**Steps**:
1. Create new ADO pipeline using `sample-pipeline.yml`
2. Configure variables:
   - `ADO_ORGANIZATION`: Your org name
   - `ADO_PROJECTS`: Comma-separated project list
   - `PAT_SECRET`: Secret variable with PAT
3. Run pipeline (first run - no artifacts)
4. Verify: SQLite + CSV artifacts published
5. Run pipeline again (incremental)
6. Verify: No data duplication, artifacts updated
7. Break PAT intentionally
8. Verify: Pipeline fails, previous artifacts intact

**Key file**: `sample-pipeline.yml` (already created, 4275 bytes)

**Important invariants to check**:
- Invariant 7: `condition: succeeded()` on publish steps
- Invariant 9: First-run creates fresh DB from configured date

---

### VG 4.1-4.2: Extension Victory Gate

**Status**: ✅ VG 4.1 PASSED (2026-01-12) | VG 4.2 pending (install in ADO org)

**Steps**:
1. Package extension:
   ```bash
   cd extension/tasks/extract-prs
   npm install
   cd ../..
   tfx extension create --manifest-globs vss-extension.json
   ```
2. Output: `.vsix` file in extension directory
3. Install in test ADO organization
4. Create pipeline using the task
5. Verify logs show:
   - Organization name
   - Project list
   - PR counts extracted
   - Artifact paths
   - PAT is NEVER logged (Invariant 19)

**Key files**:
- `extension/vss-extension.json` (manifest)
- `extension/tasks/extract-prs/task.json` (task definition)
- `extension/tasks/extract-prs/index.js` (Node.js wrapper)
- `extension/tasks/extract-prs/package.json` (dependencies)

**Note**: Update `publisher` in vss-extension.json before publishing.

---

### VG 5.1-5.2: PowerBI Compatibility Victory Gate

**Status**: NOT TESTED (requires PowerBI Desktop/Service)

**Steps**:
1. Generate CSVs from a populated database
2. Open existing PowerBI model (if available) or create new
3. Import CSVs as data sources
4. Verify:
   - No schema errors on import
   - No manual column fixes required
   - Existing measures compute correctly

**CSV Schema Contract** (must match exactly):
```
organizations.csv: organization_name
projects.csv: organization_name, project_name
repositories.csv: repository_id, repository_name, project_name, organization_name
pull_requests.csv: pull_request_uid, pull_request_id, organization_name, project_name, repository_id, user_id, title, status, description, creation_date, closed_date, cycle_time_minutes
users.csv: user_id, display_name, email
reviewers.csv: pull_request_uid, user_id, vote, repository_id
```

---

### VG 6.1-6.2: Final Release Gate

**Status**: READY (pending prior gates)

**Pre-requisites**:
- All prior Victory Gates passed
- CI green on main branch

**Steps**:
1. Push to main (if not already):
   ```bash
   git push origin master:main
   ```
2. Tag release:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
3. Verify GitHub Actions `release.yml` triggers:
   - Python package builds (sdist + wheel)
   - VSIX builds
   - GitHub Release created with artifacts

**Note**: PyPI publishing requires trusted publishing setup at:
https://pypi.org/manage/project/ado-git-repo-insights/settings/publishing/

---

## Optional/Deferred Items

| Item | Location | Notes |
|------|----------|-------|
| PyPI trusted publishing | pypi.org settings | One-time setup |
| Extension icon | `extension/images/icon.png` | Placeholder exists |
| Monitoring/alerting | Operational | Pipeline-specific |
| Azure Storage backend | Invariants 21-22 | Optional fallback |

---

## Key Reference Files

| Purpose | Path |
|---------|------|
| Invariants | `agents/INVARIANTS.md` |
| Definition of Done | `agents/definition-of-done.md` |
| Victory Gates | `agents/victory-gates.md` |
| Runbook | `docs/runbook.md` |
| Rollout Plan | `docs/rollout-plan.md` |
| CSV Validator | `scripts/csv_diff.py` |
| Sample Pipeline | `sample-pipeline.yml` |

---

## Commands Quick Reference

```bash
# Activate environment
.venv\Scripts\activate

# Run tests
pytest tests/ --no-cov

# Lint
ruff check . --fix
ruff format .

# Type check
mypy src/

# Build Python package
python -m build

# Build extension (from extension dir)
cd extension/tasks/extract-prs && npm install && cd ../..
tfx extension create --manifest-globs vss-extension.json
```
