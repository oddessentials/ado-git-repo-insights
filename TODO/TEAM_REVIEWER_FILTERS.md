# Team & Reviewer Filter Implementation Status

> Last reviewed: 2026-02-05

## Summary

| Filter Type | Status | Effort to Complete |
|-------------|--------|-------------------|
| **Team** | ✅ 95% Complete | Ready to use |
| **Reviewer** | ❌ 0% Complete | ~7-9 days |

---

## Team Filters ✅ READY

Team filtering is fully implemented and functional when team data is available.

### Implementation Status

| Layer | Status | Location |
|-------|--------|----------|
| Database Schema | ✅ Complete | `src/ado_git_repo_insights/persistence/models.py:98-125` |
| Data Extraction | ✅ Complete | Teams extracted with member counts |
| Backend Aggregation | ✅ Complete | `src/ado_git_repo_insights/transform/aggregators.py:624-690` |
| Dimensions Output | ✅ Complete | `aggregates/dimensions.json` contains teams array |
| Weekly Rollup Slices | ✅ Complete | `by_team` dict in each weekly rollup |
| UI Dropdown | ✅ Complete | `extension/ui/index.html:112-117` |
| Filter State | ✅ Complete | `extension/ui/modules/filters.ts:13-16` |
| Filter Logic | ✅ Complete | `extension/ui/modules/metrics.ts:196-237` |
| Feature Gating | ✅ Complete | Hidden when no teams available |
| Tests | ✅ Complete | `tests/unit/test_aggregators.py:1009-1209` |

### How It Works

1. Teams are extracted from ADO during data extraction
2. `dimensions.json` includes list of teams with member counts
3. Weekly rollups include `by_team` breakdown with per-team metrics:
   - pr_count, cycle_time_p50, cycle_time_p90, authors_count, reviewers_count
4. UI shows team multi-select when teams are available
5. `applyFiltersToRollups()` aggregates metrics from selected teams

### Minor Gap
- Per-team cycle times use global values (acceptable - PRs aren't team-exclusive)
- Comment at `metrics.ts:229-235`: "cycle_time/authors/reviewers preserved from unfiltered rollup"

---

## Reviewer Filters ❌ NOT IMPLEMENTED

Reviewer filtering requires full implementation across the stack.

### Current State

| Layer | Status | Gap |
|-------|--------|-----|
| Database Schema | ✅ Exists | `reviewers` table has user_id for each review |
| Dimensions | ❌ Missing | No reviewer list in `dimensions.json` |
| Backend Slices | ❌ Missing | No `by_reviewer` in weekly rollups |
| Rollup Schema | ❌ Missing | No `by_reviewer` field defined |
| UI Dropdown | ❌ Missing | No HTML element for reviewer filter |
| Filter State | ❌ Missing | No `reviewers` in FilterState interface |
| Filter Logic | ❌ Missing | No case in `applyFiltersToRollups()` |
| Feature Flag | ❌ Missing | No `reviewers` feature flag |
| Tests | ❌ Missing | No reviewer filter tests |

### What Reviewer Data Exists Today

- `reviewers` table: `pull_request_uid`, `user_id`, `vote`, `repository_id`
- Aggregate metric: `reviewers_count` per week (count only, not breakdown)
- Reviewer activity chart shows weekly reviewer counts (not individual reviewers)

---

## Implementation Plan for Reviewer Filters

### Phase 1: Backend Infrastructure (~3-4 days)

#### 1.1 Add Reviewer Dimension Extraction
**File:** `src/ado_git_repo_insights/transform/aggregators.py`

Add to `_generate_dimensions()` method (around line 420):
```python
def _get_reviewers_dimension(self) -> list[dict]:
    """Extract distinct reviewers for filter dropdown."""
    query = """
        SELECT DISTINCT u.user_id, u.display_name, u.unique_name
        FROM reviewers rv
        JOIN users u ON rv.user_id = u.user_id
        ORDER BY u.display_name
    """
    # Return list of {user_id, display_name, unique_name}
```

#### 1.2 Generate by_reviewer Slices
**File:** `src/ado_git_repo_insights/transform/aggregators.py`

Add new method similar to `_generate_team_slice()`:
```python
def _generate_reviewer_slice(
    self,
    week_prs: pd.DataFrame,
    week_reviewers: pd.DataFrame,
) -> dict[str, BreakdownEntry]:
    """Generate per-reviewer metrics for a single week."""
    # For each reviewer:
    # - pr_count: PRs they reviewed
    # - reviews_count: Total reviews (including re-reviews)
    # - avg_time_to_review: (if calculable)
```

#### 1.3 Update Weekly Rollup Generation
**File:** `src/ado_git_repo_insights/transform/aggregators.py`

In `generate_weekly_rollup()`, add:
```python
rollup["by_reviewer"] = self._generate_reviewer_slice(week_prs, week_reviewers)
```

#### 1.4 Add Tests
**File:** `tests/unit/test_aggregators.py`

Add test class similar to `TestTeamSlicing`:
- test_generates_by_reviewer_slices
- test_reviewer_slice_includes_all_metrics
- test_no_reviewer_data_returns_empty

---

### Phase 2: Frontend Implementation (~2-3 days)

#### 2.1 Update Rollup Schema
**File:** `extension/ui/schemas/rollup.schema.ts`

```typescript
interface WeeklyRollup {
  // ... existing fields
  by_reviewer?: Record<string, BreakdownEntry>;
}

// Add to KNOWN_ROOT_FIELDS
const KNOWN_ROOT_FIELDS = [..., "by_reviewer"];
```

#### 2.2 Update Filter State
**File:** `extension/ui/modules/filters.ts`

```typescript
interface FilterState {
  dateRange: DateRange;
  repos: string[];
  teams: string[];
  reviewers: string[];  // ADD THIS
}
```

Update URL serialization to include reviewers.

#### 2.3 Add UI Component
**File:** `extension/ui/index.html`

Add after team filter (around line 117):
```html
<div id="reviewer-filter-group" class="filter-group" style="display: none;">
  <label for="reviewer-filter">Reviewer</label>
  <select id="reviewer-filter" multiple class="filter-select">
    <!-- Populated dynamically -->
  </select>
</div>
```

#### 2.4 Implement Filter Logic
**File:** `extension/ui/modules/metrics.ts`

Add to `applyFiltersToRollups()`:
```typescript
if (filters.reviewers.length > 0 && rollup.by_reviewer) {
  // Aggregate metrics from selected reviewers
  const selectedReviewerData = filters.reviewers
    .map(r => rollup.by_reviewer[r])
    .filter(Boolean);
  // Sum pr_count, reviews_count from selected reviewers
}
```

#### 2.5 Wire Up Dashboard
**File:** `extension/ui/dashboard.ts`

- Populate reviewer dropdown from `dimensions.reviewers`
- Add change handler similar to team filter
- Conditionally show/hide based on reviewer availability

---

### Phase 3: Integration & Testing (~2 days)

- [ ] Integration tests for reviewer filtering end-to-end
- [ ] E2E tests on dashboard with reviewer filter
- [ ] Performance testing with 100+ reviewers
- [ ] Update documentation

---

## Design Considerations

### What Metrics Make Sense for Reviewer Filtering?

| Metric | Feasibility | Notes |
|--------|-------------|-------|
| PRs Reviewed | ✅ Easy | Count of PRs where user was reviewer |
| Reviews Count | ✅ Easy | Total reviews (including re-reviews) |
| Avg Time to Review | ⚠️ Medium | Requires review timestamp data |
| Cycle Time | ❌ N/A | PR-level metric, not reviewer-level |
| Approval Rate | ⚠️ Medium | Requires vote breakdown |

### Scalability Concern

With 100+ reviewers, the filter dropdown could become unwieldy. Consider:
- Search/autocomplete instead of multi-select
- "Top 20 most active" default view
- Grouping by team

---

## Key Files Reference

### Backend
| Purpose | File |
|---------|------|
| Database Schema | `src/ado_git_repo_insights/persistence/models.py` |
| Aggregators | `src/ado_git_repo_insights/transform/aggregators.py` |
| Aggregator Tests | `tests/unit/test_aggregators.py` |

### Frontend
| Purpose | File |
|---------|------|
| Dashboard HTML | `extension/ui/index.html` |
| Dashboard Logic | `extension/ui/dashboard.ts` |
| Filter State | `extension/ui/modules/filters.ts` |
| Filter Logic | `extension/ui/modules/metrics.ts` |
| Rollup Schema | `extension/ui/schemas/rollup.schema.ts` |

### Documentation
| Purpose | File |
|---------|------|
| Enhancement Plan | `docs/internal/dashboard-enhancement-plan.md` |
