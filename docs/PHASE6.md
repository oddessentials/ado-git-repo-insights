## Phase 6 — Local HTML Dashboard Experience (Optimized Plan)

**Goal:** iterate fast on the dashboard by running the _same_ HTML dashboard locally against the _same_ dataset format the extension uses—offline, minimal moving parts.

---

### 6.1 One command to run the dashboard locally

**CLI**

- `ado-insights dashboard --dataset ./dataset/dataset-manifest.json --port 8080 --open`
- Optional convenience: `ado-insights dashboard --dataset ./dataset/dataset-manifest.json --open` (defaults port)

**Behavior**

- Starts a tiny local HTTP server (static file hosting).
- Serves the **existing extension UI bundle** (no forked UI).
- Loads `dataset-manifest.json`, then loads aggregates **chunked** (dimensions + default date range first).
- Preserves the same tabs: **Metrics / Predictions / AI Insights**.
- Keeps the same filter model + URL persistence.

**Definition of Done**

- Works fully offline on a laptop using only local files.
- Fast first paint (dimensions + default date window only).
- Identical aggregate schemas to the extension (no format divergence).

---

### 6.2 Build a dataset locally (so dashboard always has fresh data)

**CLI**

- `ado-insights build-aggregates --db ./ado-insights.sqlite --out ./dataset/`

**Output contract**

- Produces the same folder structure as pipeline artifacts:
    - `dataset-manifest.json`
    - `aggregates/` (weekly_rollups, distributions, dimensions, etc.)
    - (optional) copy sqlite into dataset folder if useful

**Definition of Done**

- Deterministic outputs (same DB → same files).
- Easy to zip/share `./dataset/` for debugging and review.

---

### 6.3 “Happy path” developer workflow (2 commands → iterate UI fast)

1. Extract / refresh DB (existing flow)
2. `ado-insights build-aggregates ...`
3. `ado-insights dashboard ...` (with `--open`)

**Definition of Done**

- A new engineer can go from “have DB” → “dashboard open” in <2 minutes with copy/paste.

---

### 6.4 Tight testing requirements (keep velocity high)

**Python (producer contract)**

- Manifest + aggregate schema validation tests
- Chunk indexing / discovery correctness
- Regression tests for known issues (reviewer count, by_repository slices)

**UI (minimal but meaningful)**

- Loads dataset folder successfully
- Changing date range fetches additional chunks (and doesn’t reload everything)
- Renders empty/error states cleanly (missing slices, legacy datasets)

**Definition of Done**

- Tests prevent schema drift between producers and UI consumers.

---

### 6.5 Priority follow-ups to unlock better filtering (only if needed)

1. **`by_team` slices** in aggregates (since team filter exists in UI but backend doesn’t emit slices yet)
2. **Filter URL persistence verification** (`?repos=...&teams=...`) with a small UI test

**Definition of Done**

- Team filter changes actually affect metrics (not just UI state).

---

### Phase 6 success criteria (what “done” looks like)

- Local dashboard is the default way to iterate on visuals/insights.
- Extension and local dashboard consume the _exact same_ dataset outputs.
- Regenerating data + opening dashboard becomes a routine dev loop (fast + reliable).

## Session Findings (Jan 2026) — Pre-Phase 6 Status

This section documents findings from the dashboard hardening session to enable efficient pickup.

### Bugs Fixed in This PR

| Issue                       | Root Cause                                                             | Fix Applied                                                                             |
| --------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Reviewer count always 0** | `aggregators.py:501` had `reviewers_count=0` with TODO comment         | Now queries `reviewers` table, counts unique reviewers per week                         |
| **Filters not working**     | Filter dropdowns populated but `refreshMetrics()` ignored filter state | Added `applyFiltersToRollups()` with client-side filtering using `by_repository` slices |

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

| Feature                    | Status                            | Location                                  |
| -------------------------- | --------------------------------- | ----------------------------------------- |
| 5th Reviewers summary card | ✅ HTML + JS exists               | `index.html:202-209`, `dashboard.js:1126` |
| Reviewer Activity chart    | ✅ Exists                         | `index.html:228-230`, `dashboard.js:1406` |
| Trend deltas on cards      | ✅ Implemented                    | `dashboard.js:1139-1144`                  |
| Sparklines on cards        | ✅ Implemented                    | `dashboard.js:1131-1137`                  |
| Filter dropdowns           | ✅ Populated from dimensions.json | `dashboard.js:1522`                       |

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
