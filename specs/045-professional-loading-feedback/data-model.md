# Data Model: Professional Dashboard Loading Feedback

## Entities

### RefreshCycle

Represents a single invocation of the data reload pipeline.

| Field | Type | Description |
|-------|------|-------------|
| token | number | Monotonic counter incremented on each refresh. Used to detect stale results. |
| active | boolean | Whether a refresh is currently in-flight. Drives all loading presentation. |

**State Transitions**:
```
idle → active (refresh triggered, token incremented)
active → idle (winning refresh completes or fails)
active → active (superseded: new refresh starts while previous in-flight; token increments, previous results will be discarded on arrival)
```

**Invariants**:
- Only one `active` state exists at a time (the latest token).
- Results from any token other than the current token are discarded without rendering.
- `active = false` is the only state that clears loading presentation.

### EffectiveState

Snapshot of the dashboard state that determines whether a refresh is needed.

| Field | Type | Description |
|-------|------|-------------|
| filters | FilterState | Current dimension filters (repos, teams, reviewers, authors) |
| dateRange | { start: Date; end: Date } | Current date range |
| comparisonMode | boolean | Whether comparison mode is active |

**Used for**: No-op guard comparison. If the new EffectiveState serializes identically to the previous one, no refresh is triggered.

### LoadingPresentation

CSS-driven visual state applied to chart regions. Not a runtime data structure — purely CSS class toggling.

| Region | Selector | Loading Class Applied To |
|--------|----------|------------------------|
| Summary Cards | `.summary-cards` | Parent gets `.metrics-loading` or uses data attribute |
| Throughput Chart | `.chart-container` containing `#throughput-chart` | Same mechanism |
| Cycle Time Trend | `.chart-container` containing `#cycle-time-trend` | Same mechanism |
| Reviewer Activity | `.chart-container` containing `#reviewer-activity` | Same mechanism |
| Cycle Distribution | `.chart-container` containing `#cycle-distribution` | Same mechanism |

**Presentation rules**:
- All regions toggle simultaneously (driven by dashboard-level state, not per-region logic).
- Dimming via CSS `opacity` transition on the content area.
- Optional small spinner element appended/removed by the loading module.
- `aria-busy="true"` set on `#tab-metrics` during loading.

## Relationships

```
User Interaction → EffectiveState comparison (no-op guard)
                 → RefreshCycle.start() (increments token, sets active=true)
                 → LoadingPresentation.show() (CSS class toggle)
                 → async data load
                 → token check (stale? discard)
                 → chart render
                 → RefreshCycle.end() (sets active=false)
                 → LoadingPresentation.hide() (CSS class toggle)
                 → aria-live announcement
```
