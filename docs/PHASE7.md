## Phase 7 — Remaining Gaps & Maintenance

This document consolidates remaining gaps and maintenance requirements from Phase 5 (ML) and Phase 6 (Local Dashboard) development.

---

## Maintenance Notes

### 7.1 UI Bundle Synchronization (CRITICAL)

**Status:** ✅ COMPLETE
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

**CI Enforcement:**
The `ui-bundle-sync` job in `.github/workflows/ci.yml` automatically verifies synchronization on every PR using `scripts/check-ui-bundle-sync.sh`. Features:
- Patch-format diff output for easy review
- Ignored patterns: `*.map`, `.DS_Store`, `*.swp`, `*~`, `*.bak`
- Clear "how to fix" instructions on failure

**Definition of Done:**
- [x] Add sync verification to CI workflow (`ui-bundle-sync` job)
- [x] Document in CONTRIBUTING.md

---

## Feature Gaps

### 7.2 Team-Based Filtering (`by_team` Slices)

**Status:** ✅ COMPLETE
**Priority:** Medium
**Complexity:** Medium

**Implementation:**

1. **Backend** (`src/ado_git_repo_insights/transform/aggregators.py`):
   - Added `_generate_team_slice()` method at lines 589-655
   - Queries `team_members` table to join PR authors to teams
   - Groups by team and computes metrics (pr_count, cycle_time_p50/p90, authors_count, reviewers_count)

2. **Weekly Rollup Schema** — now includes `by_team` field:
```json
{
  "week": "2026-W02",
  "by_team": {
    "Backend Team": { "pr_count": 18, "cycle_time_p50": 180.0, ... },
    "Frontend Team": { "pr_count": 12, "cycle_time_p50": 240.0, ... }
  }
}
```

3. **Client-side filtering** (`extension/ui/dashboard.js`):
   - Already implemented at lines 912-914: `applyFiltersToRollups()` handles `by_team`

**Multi-Team Membership Behavior:**
- Authors in multiple teams have their PRs counted in ALL team slices (intentional)
- "Show me PRs for team X" = any PR authored by someone who is a member of team X
- Global totals are computed from base rollup, NOT summed team slices (avoids double-counting)

**Test Coverage** (`tests/unit/test_aggregators.py`):
- `TestTeamAggregation` class with 8 comprehensive tests
- Tests single-membership, multi-membership, no-team authors, empty teams

**Definition of Done:**
- [x] Team filter changes affect displayed metrics
- [x] Multiple team selection aggregates correctly
- [x] Multi-team membership documented and tested

---

### 7.3 Filter URL Persistence Tests

**Status:** ✅ COMPLETE
**Priority:** Low
**Complexity:** Low

**Implementation:**

Added comprehensive test coverage in `extension/tests/dashboard.test.js`:

1. **Edge case tests in `restoreFiltersFromUrl`**:
   - `handles invalid filter values gracefully` - repos not in dimensions
   - `ignores unknown URL query keys` - e.g., `?foo=bar&repos=r1`
   - `handles malformed URL params gracefully` - empty values, trailing commas

2. **New `URL State Round-Trip` describe block**:
   - `round-trip preserves filter state` - serialize → parse → verify identical
   - `stable ordering in serialization` - same repos in different order → same URL
   - `round-trip with date range` - verifies date serialization
   - `empty state produces empty URL` - no params when nothing selected

**Determinism Note:**
Serialization now sorts repos/teams alphabetically to ensure stable URLs.
This prevents snapshot churn and makes URL comparisons reliable.

**Definition of Done:**
- [x] Integration tests verify filter ↔ URL sync
- [x] Invalid filter values handled gracefully
- [x] Unknown URL keys ignored
- [x] Stable ordering ensures deterministic URLs

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
