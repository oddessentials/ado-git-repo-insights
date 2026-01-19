## Phase 7 — Remaining Gaps & Maintenance

This document consolidates remaining gaps and maintenance requirements from Phase 5 (ML) and Phase 6 (Local Dashboard) development.

---

## Maintenance Notes

### 7.1 UI Bundle Synchronization (CRITICAL)

**Status:** Manual process required
**Priority:** HIGH (operational risk)

**Issue:**
The dashboard UI files exist in two locations that must stay synchronized:

| Location | Purpose |
|----------|---------|
| `extension/ui/` | Source of truth for Azure DevOps extension |
| `src/ado_git_repo_insights/ui_bundle/` | Copy for Python pip package |

**Why duplication exists:**
- Symlinks don't work with setuptools wheel builds
- pip-installed packages need actual files, not symlinks
- The `ado-insights dashboard` command requires bundled UI files

**Current process:**
When modifying UI files, changes must be made in BOTH locations:
```bash
# After modifying extension/ui/*, sync to ui_bundle:
cp -r extension/ui/* src/ado_git_repo_insights/ui_bundle/
```

**Future improvement:**
Add a CI check to verify sync:
```bash
# scripts/check-ui-bundle-sync.sh
diff -rq extension/ui/ src/ado_git_repo_insights/ui_bundle/ || {
    echo "ERROR: UI bundle out of sync with extension/ui/"
    exit 1
}
```

**Definition of Done:**
- [ ] Add sync verification to CI workflow
- [ ] Document in CONTRIBUTING.md

---

## Feature Gaps

### 7.2 Team-Based Filtering (`by_team` Slices)

**Status:** Not implemented
**Priority:** Medium
**Complexity:** Medium

**Problem:**
The team filter dropdown exists in the UI and is populated from `dimensions.json`, but the backend doesn't generate `by_team` slices in weekly rollups. Selecting a team has no effect on displayed metrics.

**Required Changes:**

1. **Aggregators** (`src/ado_git_repo_insights/transform/aggregators.py`):
   - Add `_generate_team_slice()` method
   - Join PR authors to `team_members` table
   - Group by team and compute metrics

2. **Weekly Rollup Schema** — add `by_team` field:
```json
{
  "week": "2026-W02",
  "by_team": {
    "Backend Team": { "pr_count": 18, "cycle_time_p50": 180.0 },
    "Frontend Team": { "pr_count": 12, "cycle_time_p50": 240.0 }
  }
}
```

3. **Client-side filtering** (`extension/ui/dashboard.js`):
   - Modify `applyFiltersToRollups()` to handle team filtering

**Dependencies:**
- `team_members` table must be populated during extraction

**Definition of Done:**
- [ ] Team filter changes affect displayed metrics
- [ ] Multiple team selection aggregates correctly

---

### 7.3 Filter URL Persistence Tests

**Status:** Implemented but untested
**Priority:** Low
**Complexity:** Low

**Problem:**
URL query param persistence (`?repos=repo1,repo2&teams=team1`) exists in code but lacks integration tests.

**Required Tests** (`extension/tests/dashboard.test.js`):
- Verify URL updates when filters change
- Verify filters restore from URL on page load
- Verify invalid filter values handled gracefully

**Definition of Done:**
- [ ] Integration tests verify filter ↔ URL sync

---

## Future Considerations

### 7.4 Version Adapter Pattern

**Priority:** Low

Add a version adapter to normalize rollup data across schema versions, providing sensible defaults for missing fields in older datasets.

### 7.5 Ideas Backlog

Low-priority ideas for future phases:
- Lazy chart rendering (only render visible charts)
- Service Worker caching for offline dashboard
- Author leaderboards
- Repository health scores
- Stale PR detection

---

## Priority Matrix

| Item | Priority | Effort | Impact |
|------|----------|--------|--------|
| 7.1 UI Bundle Sync | **HIGH** | Low | Critical - prevents drift |
| 7.2 by_team slices | Medium | Medium | High - enables team filtering |
| 7.3 URL persistence tests | Low | Low | Low - verification only |
| 7.4 Version adapter | Low | Low | Medium - compatibility |
| 7.5 Ideas backlog | Low | Varies | Nice to have |

---

## References

- Dataset contract: `docs/dataset-contract.md`
- Aggregators: `src/ado_git_repo_insights/transform/aggregators.py`
- Dashboard UI: `extension/ui/dashboard.js`
- UI Bundle: `src/ado_git_repo_insights/ui_bundle/`
