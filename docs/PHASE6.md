**Recommendation**

* **Phase 6A (fast win): local HTML dashboard** (static site + tiny local server)
* **Phase 6B (optional): TUI "ops console"** for quick summaries + health checks

---

## Phase 6 — Local Dashboard Experience (Short Plan)

### 6.1 Local "serve dashboard" command (HTML)

* Add a CLI command, e.g.:

  * `ado-insights dashboard --db path/to/ado-insights.sqlite`
  * `ado-insights dashboard --dataset path/to/dataset-manifest.json`
* Command starts a small local server (or opens a static bundle) that:

  * loads `dataset-manifest.json`
  * loads aggregates (chunked) and renders the same 3 tabs:

    * Metrics / Predictions / AI Insights
  * supports the same filter model and URL persistence

**DoD**

* Works offline on a laptop using only local files
* Fast initial render (loads dimensions + default date range chunks only)
* Identical aggregate schemas as extension UI (no forked formats)

### 6.2 "Build dataset locally" convenience

* Add:

  * `ado-insights build-aggregates --db ado-insights.sqlite --out ./dataset/`
* This creates the same folder structure as pipeline artifacts:

  * manifest + aggregates + optional copied sqlite

**DoD**

* Deterministic outputs (same inputs → same files)
* Easy to zip/share a dataset folder

### 6.3 Optional: Local extraction + dashboard in one flow

* `ado-insights run --org X --projects ... --include-comments` (existing)
* followed by:

  * auto-build aggregates
  * launch dashboard automatically if `--open` is passed

### 6.4 Testing requirements (keep it tight)

* Python tests:

  * manifest + aggregate schema validation (producer contract)
  * chunk indexing correctness
* UI tests (minimal):

  * load dataset folder
  * change date range → fetch additional chunks
  * render empty/error states cleanly

---

## Session Findings (Jan 2026) — Pre-Phase 6 Status

This section documents findings from the dashboard hardening session to enable efficient pickup.

### Bugs Fixed in This PR

| Issue | Root Cause | Fix Applied |
|-------|------------|-------------|
| **Reviewer count always 0** | `aggregators.py:501` had `reviewers_count=0` with TODO comment | Now queries `reviewers` table, counts unique reviewers per week |
| **Filters not working** | Filter dropdowns populated but `refreshMetrics()` ignored filter state | Added `applyFiltersToRollups()` with client-side filtering using `by_repository` slices |

### New Features Added

1. **`by_repository` dimension slices** in weekly rollups
   - Each rollup now includes per-repository metrics
   - Structure: `{ "by_repository": { "Repo Name": { pr_count, cycle_time_p50, cycle_time_p90, authors_count, reviewers_count } } }`
   - Enables accurate client-side filtering

2. **Client-side filtering** in `dashboard.js`
   - `applyFiltersToRollups(rollups, filters)` function
   - Aggregates metrics from selected repos/teams
   - Falls back gracefully for older datasets without slices

### What Already Existed (Discovered During Analysis)

The UI was already more complete than expected:

| Feature | Status | Location |
|---------|--------|----------|
| 5th Reviewers summary card | ✅ HTML + JS exists | `index.html:202-209`, `dashboard.js:1126` |
| Reviewer Activity chart | ✅ Exists | `index.html:228-230`, `dashboard.js:1406` |
| Trend deltas on cards | ✅ Implemented | `dashboard.js:1139-1144` |
| Sparklines on cards | ✅ Implemented | `dashboard.js:1131-1137` |
| Filter dropdowns | ✅ Populated from dimensions.json | `dashboard.js:1522` |

### Remaining Gaps for Future Work

#### 1. `by_team` Slices (Not Implemented)

Team filtering dropdown exists but backend doesn't generate `by_team` slices.

**Required changes:**
```python
# In aggregators.py
def _generate_team_slice(self, week_group, week_reviewers, team_members_df):
    """Generate per-team metrics slice for a week.

    Requires joining team_members table to associate PRs with teams
    via author's team membership.
    """
    # Join PR authors to team_members to get team associations
    # Group by team and compute metrics
    pass
```

**Complexity**: Medium - requires team_members table join

#### 2. Regenerate Data Required

Existing pipeline artifacts still have `reviewers_count: 0`. Options:
- Re-run extraction pipeline with updated code
- Use local dashboard (Phase 6) to test with fresh data

#### 3. Filter State Persistence

URL query params for filters exist in code but may need testing:
- `?repos=repo1,repo2&teams=team1`
- Should persist across page refreshes

### Architecture Notes for Phase 6

#### Schema Compatibility

The extension and local dashboard must use identical schemas:

```
aggregates/
├── dimensions.json          # Filter options
├── weekly_rollups/
│   └── YYYY-Www.json       # Now includes by_repository slices
├── distributions/
│   └── YYYY.json
└── dataset-manifest.json   # Discovery + feature flags
```

**New fields added (backward compatible):**
- `weekly_rollups/*.json`: `by_repository` object (optional, absent in old data)
- Client code handles missing slices gracefully

#### Local Dashboard Implementation Approach

```python
# Proposed: src/ado_git_repo_insights/cli.py

@click.command()
@click.option('--dataset', type=click.Path(exists=True), help='Path to dataset-manifest.json')
@click.option('--port', default=8080, help='Local server port')
@click.option('--open', is_flag=True, help='Open browser automatically')
def dashboard(dataset, port, open):
    """Serve the PR Insights dashboard locally."""
    import http.server
    import webbrowser

    # Copy extension/ui/* to temp dir
    # Inject dataset path configuration
    # Start simple HTTP server
    # Optionally open browser
```

#### Version Adapter Pattern (Future)

For testing new features locally before deploying:

```javascript
// extension/ui/version-adapter.js
function adaptRollup(rollup, targetVersion) {
    // Add missing fields with sensible defaults
    if (!rollup.by_repository) {
        rollup.by_repository = {}; // Empty = no filtering available
    }
    if (rollup.reviewers_count === undefined) {
        rollup.reviewers_count = 0; // Legacy data
    }
    return rollup;
}
```

### Test Coverage Added

| Test File | Tests Added | Purpose |
|-----------|-------------|---------|
| `tests/unit/test_aggregators.py` | 4 new tests | Reviewer aggregation, by_repository slices |
| `extension/tests/dashboard.test.js` | 12 new tests | `applyFiltersToRollups()` function |

**All tests pass:** 22 Python + 324 JavaScript = 346 total

### Files Modified in This PR

```
docs/DASHBOARD-HARDENING-PLAN.md  (new)     - Detailed implementation plan
docs/PHASE6.md                    (updated) - This file
extension/ui/dashboard.js         (modified) - Client-side filtering
extension/tests/dashboard.test.js (modified) - Filter tests
src/.../transform/aggregators.py  (modified) - Reviewer count + by_repository
tests/unit/test_aggregators.py    (modified) - Reviewer aggregation tests
```

### Quick Start for Next Session

1. **Merge this PR** to get reviewer fix + filtering into main
2. **Re-run pipeline** to generate data with actual reviewer counts
3. **Start Phase 6** with local dashboard command
4. **(Optional)** Add `by_team` slices if team filtering is priority

### References

- `docs/DEFAULT-DASHBOARD-ENHANCEMENT-PLAN.md` - Original enhancement vision (Phases A-D)
- `docs/DASHBOARD-HARDENING-PLAN.md` - Bug analysis and fix documentation
- `agents/INVARIANTS.md` - Schema compatibility rules
