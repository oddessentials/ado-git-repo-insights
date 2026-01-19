# Dashboard Hardening & Enhancement Plan

This document outlines the implementation plan for hardening existing dashboard features, fixing bugs, and preparing for future enhancements.

---

## Executive Summary

### Critical Issues Identified

1. **Reviewer Activity Bug (P0)**: `reviewers_count` is hardcoded to `0` in `aggregators.py:501`
   - Data exists in the `reviewers` table but is never counted
   - UI correctly renders the value but always shows "0"

2. **Filters Not Working (P0)**: Dimension filters are populated but never applied
   - Filter dropdowns work (populated from `dimensions.json`)
   - Filter state is tracked (`currentFilters` object)
   - **Missing**: Client-side filtering logic in `refreshMetrics()`
   - **Missing**: Pre-computed dimension slices in weekly rollups

3. **Test Coverage Gaps (P1)**: No tests for filtering or reviewer aggregation

---

## Bug Analysis

### Bug #1: Reviewer Count Always Zero

**Location**: `src/ado_git_repo_insights/transform/aggregators.py:501`

```python
reviewers_count=0,  # TODO: Add reviewer counting
```

**Root Cause**: The weekly rollup generation never joins with the `reviewers` table.

**Fix Required**: Query unique reviewers per PR, then aggregate per week:
```sql
SELECT COUNT(DISTINCT r.user_id) as reviewers_count
FROM reviewers r
JOIN pull_requests pr ON r.pull_request_uid = pr.pull_request_uid
WHERE pr.closed_date >= ? AND pr.closed_date <= ?
```

**Test Data Verification**: The `reviewers` table schema exists and is validated:
- `database.py:117` validates `reviewers` table on connect
- Row counts are tracked in `_get_row_counts()` (line 665)

---

### Bug #2: Filters Not Applied

**Location**: `extension/ui/dashboard.js`

**Current Behavior**:
1. `populateFilterDropdowns()` correctly loads dimensions (line 1522)
2. `handleFilterChange()` updates `currentFilters` state (line 1560)
3. `refreshMetrics()` loads data **ignoring filters** (line 809)

**Missing Logic**:
1. **Client-side filtering**: After loading rollups, filter by selected repos/teams
2. **Dimension-sliced data**: Aggregator should generate `by_repository` and `by_team` slices

**Test Fixture Shows Expected Format** (`2026-W02.json`):
```json
{
  "by_repository": {
    "main-repo": { "pr_count": 22, "cycle_time_p50": 200.0 },
    "secondary-repo": { "pr_count": 8, "cycle_time_p50": 360.0 }
  },
  "by_team": {
    "Backend Team": { "pr_count": 18, "cycle_time_p50": 180.0 },
    "Frontend Team": { "pr_count": 12, "cycle_time_p50": 300.0 }
  }
}
```

---

## Implementation Plan

### Phase 1: Fix Reviewer Count Bug (P0)

**Tasks**:
1. Modify `_generate_weekly_rollups()` in `aggregators.py`
2. Add query to count distinct reviewers per week
3. Add unit test for reviewer aggregation
4. Verify in integration test

**SQL Query**:
```sql
SELECT
    strftime('%G-W%W', pr.closed_date) as week,
    COUNT(DISTINCT r.user_id) as reviewers_count
FROM reviewers r
JOIN pull_requests pr ON r.pull_request_uid = pr.pull_request_uid
WHERE pr.closed_date IS NOT NULL AND pr.status = 'completed'
GROUP BY week
```

**Estimated Effort**: 1-2 hours

---

### Phase 2: Implement Client-Side Filtering (P0)

**Tasks**:
1. Add `filterRollups()` function to `dashboard.js`
2. Modify `refreshMetrics()` to apply filters after loading
3. Add dimension slicing to `aggregators.py` (optional for MVP)
4. Add filter tests

**Implementation Approach** (MVP - Client-Side):
```javascript
function filterRollups(rollups, filters) {
    if (!filters.repos.length && !filters.teams.length) {
        return rollups; // No filters, return all
    }

    // If rollups have by_repository/by_team slices, use those
    // Otherwise, filter at aggregate level (less granular)
    return rollups.map(rollup => {
        let filtered = { ...rollup };
        // Apply repo filter
        if (filters.repos.length && rollup.by_repository) {
            const repoData = filters.repos.map(r => rollup.by_repository[r]).filter(Boolean);
            filtered.pr_count = repoData.reduce((sum, d) => sum + d.pr_count, 0);
            // ... aggregate other metrics
        }
        return filtered;
    });
}
```

**Estimated Effort**: 2-3 hours

---

### Phase 3: Add Dimension-Sliced Data Generation (P1)

**Tasks**:
1. Modify `_generate_weekly_rollups()` to include `by_repository` slices
2. Add `by_team` slices (requires team membership join)
3. Update test fixtures
4. Add contract tests for new fields

**Query for Repository Slices**:
```sql
SELECT
    strftime('%G-W%W', pr.closed_date) as week,
    r.repository_name,
    COUNT(*) as pr_count,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pr.cycle_time_minutes) as cycle_time_p50
FROM pull_requests pr
JOIN repositories r ON pr.repository_id = r.repository_id
WHERE pr.closed_date IS NOT NULL AND pr.status = 'completed'
GROUP BY week, r.repository_name
```

**Estimated Effort**: 3-4 hours

---

### Phase 4: Enhanced Testing (P1)

**New Tests Required**:

1. **Unit Test**: `test_aggregator_reviewer_count.py`
   - Verify reviewers are counted per week
   - Verify unique counting (no duplicates)

2. **Unit Test**: `test_aggregator_dimension_slices.py`
   - Verify `by_repository` slices generated
   - Verify `by_team` slices generated

3. **Integration Test**: `test_dashboard_filtering.js`
   - Verify filter state updates URL
   - Verify metrics change when filters applied
   - Verify filter chips display

4. **Contract Test**: `test_weekly_rollup_schema.py`
   - Add schema validation for new fields
   - Backward compatibility check

**Estimated Effort**: 2-3 hours

---

## Enhancement Ideas for Future Phases

### Visual Enhancements

1. **Interactive Chart Tooltips**: Already partially implemented, extend to all charts
2. **Responsive Sparklines**: Already implemented, ensure consistent rendering
3. **Loading States per Chart**: Show skeleton loaders during filter changes

### Performance Optimizations

1. **Lazy Loading Dimension Slices**: Only load repo/team data when filter selected
2. **Caching Strategy**: Cache filtered results by filter combination
3. **Virtual Scrolling**: For large dimension lists in filter dropdowns

### Future Features (Phase 6+ Integration)

1. **Local Dashboard Testing**:
   - Download aggregates artifact from pipeline
   - Serve locally for rapid iteration
   - Validate compatibility between extension and local versions

2. **Schema Compatibility Layer**:
   ```javascript
   // version-adapter.js
   function adaptRollup(rollup, targetVersion) {
       if (rollup.schema_version < targetVersion) {
           // Add missing fields with defaults
           return { ...rollup, by_repository: {}, by_team: {} };
       }
       return rollup;
   }
   ```

3. **Dashboard Experimentation Framework**:
   - A/B test new visualizations locally
   - Validate with real data before deploying
   - Share test configurations

---

## Success Criteria

After implementation:

- [ ] Reviewer Activity chart shows real data (not 0)
- [ ] Repository filter changes displayed metrics
- [ ] Team filter changes displayed metrics
- [ ] Filter combinations persist in URL
- [ ] All existing tests pass
- [ ] New tests cover filtering and reviewer aggregation
- [ ] No regressions in cycle time or throughput calculations

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing data contract | High | Add backward compat tests, version bump |
| Performance degradation with slices | Medium | Lazy load slices, cache aggressively |
| Filter state sync issues | Low | Use URL as source of truth |

---

## Appendix: Current Data Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────────┐
│ ADO API         │ ──▶ │ SQLite Database  │ ──▶ │ Aggregates     │
│ (PRs, Reviewers)│     │ (pull_requests,  │     │ (weekly_rollups│
│                 │     │  reviewers)      │     │  dimensions)   │
└─────────────────┘     └──────────────────┘     └───────┬────────┘
                                                        │
                        ┌───────────────────────────────▼────────┐
                        │             Dashboard UI               │
                        │  ┌─────────────┐  ┌─────────────────┐  │
                        │  │ Filters     │  │ Metrics Display │  │
                        │  │ (NOT WORKING)│ │ (reviewers=0)   │  │
                        │  └─────────────┘  └─────────────────┘  │
                        └────────────────────────────────────────┘
```

**After Fix**:
```
                        ┌────────────────────────────────────────┐
                        │             Dashboard UI               │
                        │  ┌─────────────┐  ┌─────────────────┐  │
                        │  │ Filters     │──│ Metrics Display │  │
                        │  │ (WORKING)   │  │ (reviewers=N)   │  │
                        │  └─────────────┘  └─────────────────┘  │
                        └────────────────────────────────────────┘
```
