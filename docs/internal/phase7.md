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
Synchronization is automated via `scripts/sync_ui_bundle.py`, which mirrors `extension/ui/` into `ui_bundle/`. The pre-commit hook runs this sync when UI files are staged, and CI enforces that the synchronized files are committed.

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

### 7.4 Version Adapter Pattern

**Status:** ✅ COMPLETE
**Priority:** Low
**Complexity:** Low

**Implementation:**

Added version adapter functions in `extension/ui/dataset-loader.js` to normalize rollup data across schema versions:

```javascript
// Provides sensible defaults for missing fields in older datasets
const ROLLUP_FIELD_DEFAULTS = {
    pr_count: 0,
    cycle_time_p50: null,
    cycle_time_p90: null,
    authors_count: 0,
    reviewers_count: 0,
    by_repository: null,
    by_team: null,
};

// normalizeRollup(rollup) - Normalizes a single rollup object
// normalizeRollups(rollups) - Normalizes an array of rollups
```

**Benefits:**
- Older datasets (v1.0 - v1.2) automatically get missing fields with sensible defaults
- No breaking changes when loading historical data
- Dashboard handles mixed-version data gracefully

**Test Coverage** (`extension/tests/dashboard.test.js`):
- `Version Adapter Pattern` describe block with comprehensive tests
- Tests for null/undefined handling, field preservation, backward compatibility
- Scenario tests for v1.0, v1.1, v1.2, and current schema versions

**Definition of Done:**
- [x] Version adapter normalizes rollup data on load
- [x] Old datasets render without errors
- [x] Comprehensive test coverage for backward compatibility

---

### 7.5 Local Mode Improvements

**Status:** ✅ COMPLETE
**Priority:** Medium
**Complexity:** Low

**Improvements Made:**

1. **Robust local-config.js injection** (`src/ado_git_repo_insights/cli.py`):
   - Added guarded placeholder `<!-- LOCAL_CONFIG_PLACEHOLDER -->` in index.html
   - CLI detects placeholder for reliable injection
   - Fallback to legacy method for older UI bundles

2. **Local mode test coverage** (`extension/tests/dashboard.test.js`):
   - `Local Mode Detection` describe block with comprehensive tests
   - Tests for `isLocalMode()` - various boolean/truthy values
   - Tests for `getLocalDatasetPath()` - default and custom paths
   - Tests for local mode initialization path

3. **Download Raw Data button hidden in local mode** (`extension/ui/dashboard.js`):
   - Button is hidden when running locally (no pipeline artifacts available)
   - Avoids confusing error toast for users

4. **User-facing documentation** (`README.md`):
   - Added `ado-insights dashboard` command documentation
   - Added `ado-insights build-aggregates` documentation
   - Documented command options and limitations

5. **Windows sync compatibility**:
   - Added `scripts/check-ui-bundle-sync.ps1` PowerShell script
   - Updated README with cross-platform sync commands

**Definition of Done:**
- [x] Local-config injection is robust against HTML changes
- [x] Local mode paths have unit test coverage
- [x] Non-functional button hidden in local mode
- [x] Dashboard command is documented for users
- [x] Windows developers have sync documentation and scripts

---

## Future Considerations

### 7.6 Ideas Backlog

Low-priority ideas for future phases:
- Lazy chart rendering (only render visible charts)
- Service Worker caching for offline dashboard
- Author leaderboards
- Repository health scores
- Stale PR detection

---

## Priority Matrix

| Item | Priority | Effort | Status |
|------|----------|--------|--------|
| 7.1 UI Bundle Sync | **HIGH** | Low | ✅ COMPLETE |
| 7.2 by_team slices | Medium | Medium | ✅ COMPLETE |
| 7.3 URL persistence tests | Low | Low | ✅ COMPLETE |
| 7.4 Version adapter | Low | Low | ✅ COMPLETE |
| 7.5 Local mode improvements | Medium | Low | ✅ COMPLETE |
| 7.6 Ideas backlog | Low | Varies | Future work |

---

## References

- Dataset contract: `docs/dataset-contract.md`
- Aggregators: `src/ado_git_repo_insights/transform/aggregators.py`
- Dashboard UI: `extension/ui/dashboard.js`
- UI Bundle: `src/ado_git_repo_insights/ui_bundle/`
