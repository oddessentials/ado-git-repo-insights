## Phase 7 — Future Enhancements (Backlog)

This document consolidates remaining gaps and future work items identified during Phase 5 (ML) and Phase 6 (Local Dashboard) development.

---

### 7.1 Team-Based Filtering (`by_team` Slices)

**Status:** Not implemented
**Priority:** Medium
**Complexity:** Medium

**Problem:**
The team filter dropdown exists in the UI (`dashboard.js`) and is populated from `dimensions.json`, but the backend doesn't generate `by_team` slices in weekly rollups. Selecting a team in the filter has no effect on displayed metrics.

**Required Changes:**

1. **Aggregators** (`src/ado_git_repo_insights/transform/aggregators.py`):
```python
def _generate_team_slice(self, week_prs: pd.DataFrame, team_members_df: pd.DataFrame) -> dict:
    """Generate per-team metrics slice for a week.

    Join PR authors to team_members table to associate PRs with teams.
    Group by team and compute metrics.

    Returns:
        dict: {"Team Name": {"pr_count": N, "cycle_time_p50": X, ...}}
    """
    # 1. Query team_members table: SELECT user_id, team_id, team_name FROM team_members
    # 2. Join week_prs.author_id to team_members.user_id
    # 3. Group by team_name and compute:
    #    - pr_count
    #    - cycle_time_p50, cycle_time_p90
    #    - authors_count, reviewers_count
    pass
```

2. **Weekly Rollup Schema** (add `by_team` field):
```json
{
  "week": "2026-W02",
  "pr_count": 30,
  "by_repository": { ... },
  "by_team": {
    "Backend Team": {
      "pr_count": 18,
      "cycle_time_p50": 180.0,
      "cycle_time_p90": 420.0,
      "authors_count": 5,
      "reviewers_count": 8
    },
    "Frontend Team": {
      "pr_count": 12,
      "cycle_time_p50": 240.0,
      "cycle_time_p90": 600.0,
      "authors_count": 4,
      "reviewers_count": 6
    }
  }
}
```

3. **Client-side filtering** (`extension/ui/dashboard.js`):
   - Modify `applyFiltersToRollups()` to handle team filtering
   - Aggregate metrics from selected teams (similar to repository filtering)

**Dependencies:**
- `team_members` table must be populated during extraction
- Team membership data must be available from Azure DevOps API

**Definition of Done:**
- Team filter changes affect displayed metrics
- Empty team selection shows all data
- Multiple team selection aggregates correctly

---

### 7.2 Filter URL Persistence Verification

**Status:** Implemented but untested
**Priority:** Low
**Complexity:** Low

**Problem:**
URL query param persistence (`?repos=repo1,repo2&teams=team1`) exists in code but lacks integration tests to verify it works correctly across page refreshes.

**Required Tests:**

```javascript
// extension/tests/dashboard.test.js

describe('Filter URL Persistence', () => {
    it('should update URL when filters change', async () => {
        // 1. Set repo filter to ['main-repo']
        // 2. Verify URL contains ?repos=main-repo
    });

    it('should restore filters from URL on page load', async () => {
        // 1. Navigate to ?repos=main-repo&teams=backend
        // 2. Verify filter dropdowns show correct selections
        // 3. Verify metrics are filtered
    });

    it('should handle invalid filter values gracefully', async () => {
        // 1. Navigate to ?repos=nonexistent-repo
        // 2. Verify no crash, shows empty or all data
    });
});
```

**Definition of Done:**
- Integration tests verify filter ↔ URL sync
- Invalid filter values handled gracefully

---

### 7.3 Version Adapter Pattern

**Status:** Not implemented
**Priority:** Low
**Complexity:** Low

**Problem:**
When testing new aggregate features locally before deployment, older datasets may lack new fields. A version adapter would provide sensible defaults.

**Proposed Implementation:**

```javascript
// extension/ui/version-adapter.js

/**
 * Normalize rollup data across schema versions.
 * Adds default values for fields that may be missing in older datasets.
 */
export function adaptRollup(rollup, targetVersion = 1) {
    const adapted = { ...rollup };

    // v1 additions: by_repository slices
    if (!adapted.by_repository) {
        adapted.by_repository = {};
    }

    // v1 additions: reviewers_count
    if (adapted.reviewers_count === undefined) {
        adapted.reviewers_count = 0;
    }

    // Future: by_team slices
    if (!adapted.by_team) {
        adapted.by_team = {};
    }

    return adapted;
}

/**
 * Check if dataset supports a specific feature.
 */
export function supportsFeature(manifest, feature) {
    const featureVersions = {
        'by_repository': 1,
        'by_team': 2,  // Future
        'predictions': 1,
        'ai_insights': 1,
    };

    return manifest.aggregates_schema_version >= (featureVersions[feature] || 999);
}
```

**Definition of Done:**
- Adapter normalizes data transparently
- UI doesn't crash on legacy datasets
- Feature detection via manifest

---

### 7.4 Performance Optimizations (If Needed)

**Status:** Not started
**Priority:** Low

**Potential improvements:**
1. **Lazy chart rendering** - Only render visible charts, defer off-screen
2. **Virtual scrolling** - For large dimension lists in filters
3. **Service Worker caching** - Cache aggregates for offline dashboard
4. **Delta updates** - Only fetch changed weeks on refresh

---

### 7.5 Extended Analytics (Future)

**Status:** Backlog
**Priority:** Low

**Ideas for future phases:**
1. **Author leaderboards** - Top contributors by PR count, review count
2. **Repository health scores** - Composite metric combining cycle time, review coverage
3. **Stale PR detection** - Highlight PRs open > N days
4. **Review load balancing** - Identify over/under-utilized reviewers
5. **Custom date comparisons** - Compare arbitrary date ranges

---

### Implementation Priority

| Item | Priority | Effort | Impact |
|------|----------|--------|--------|
| 7.1 by_team slices | Medium | Medium | High - enables team filtering |
| 7.2 URL persistence tests | Low | Low | Low - verification only |
| 7.3 Version adapter | Low | Low | Medium - improves compatibility |
| 7.4 Performance | Low | Varies | Low - only if needed |
| 7.5 Extended analytics | Low | High | Medium - nice to have |

---

### References

- Dataset contract: `docs/dataset-contract.md`
- Aggregators implementation: `src/ado_git_repo_insights/transform/aggregators.py`
- Dashboard UI: `extension/ui/dashboard.js`
- Filter implementation: `extension/ui/dashboard.js:applyFiltersToRollups()`
