# Default Dashboard Enhancement Plan

This document outlines a multi-phase implementation plan to enhance the default dashboard, making it more useful and impressive based on existing data and our initial vision.

## Executive Summary

The current default dashboard provides a solid foundation but leaves significant value untapped. Two essential gaps prevent us from delivering on our original vision:

1. **Filters** - Dimension-based filtering (repo, team, author) exists in the data contract but not in the UI
2. **Comparative Trend Analysis** - No period-over-period comparison, trend indicators, or delta context

This plan addresses both gaps through four implementation phases, progressively transforming the dashboard from a static snapshot view into an interactive, insight-rich analytics experience.

---

## Gap Analysis

### What We Have (Current State)

| Component | Status | Notes |
|-----------|--------|-------|
| Summary Cards | 4 metrics | Total PRs, Cycle P50/P90, Contributors |
| Charts | 2 visualizations | Throughput bars, Distribution stacked bar |
| Date Range Filter | Implemented | Presets + custom picker |
| Dimension Filters | **Not implemented** | Schema ready in `dimensions.json` |
| Trend Indicators | **Not implemented** | No delta/direction context |
| Reviewer Metrics | **Data loaded, not displayed** | `reviewers_count` in weekly rollups |
| Period Comparison | **Not implemented** | No side-by-side analysis |

### Data Already Available (Untapped)

From `weekly_rollups/YYYY-Www.json`:
- `reviewers_count` - Loaded but never displayed
- Historical data - Available for trend calculation
- Week-over-week deltas - Computable from existing data

From `distributions/YYYY.json`:
- `prs_by_month` - Could power monthly trend view
- Multi-year distributions - Available for year-over-year comparison

From `dimensions.json`:
- Organization, Project, Repository, Team names - Ready for filter dropdowns

---

## Implementation Phases

### Phase A: Trend Indicators & Metric Expansion

**Goal**: Transform summary cards from static numbers to dynamic trend-aware metrics.

#### A.1 - Add Trend Deltas to Summary Cards

Add delta indicators showing change from previous period:

```
┌─────────────────────┐  ┌─────────────────────┐
│  Total PRs          │  │  Cycle Time P50     │
│      247            │  │      4.2 hrs        │
│   ▲ +12% vs prev    │  │   ▼ -8% vs prev     │
└─────────────────────┘  └─────────────────────┘
```

**Implementation Details**:
- Compare current period to previous equivalent period
- For 30-day view: compare to previous 30 days
- For 90-day view: compare to previous 90 days
- Show percentage change with directional arrow
- Color coding: green (improvement), red (regression), gray (neutral)
- Neutral threshold: ±2% to avoid noise

**Files to modify**:
- `extension/ui/dashboard.js`: Add `calculateTrendDelta()` function
- `extension/ui/styles.css`: Add `.metric-delta`, `.delta-positive`, `.delta-negative` classes

#### A.2 - Add Reviewers Card (5th Summary Card)

Display the `reviewers_count` data that's already being loaded:

```
┌─────────────────────┐
│  Reviewers          │
│      18             │
│   ▲ +3 vs prev      │
└─────────────────────┘
```

**Implementation Details**:
- Calculate average reviewers per week across selected range
- Show delta vs previous period
- Position in summary card row (may need responsive layout adjustment)

#### A.3 - Add Sparkline Mini-Charts to Cards

Add small inline trend visualizations to each summary card:

```
┌─────────────────────┐
│  Total PRs          │
│      247   ╱╲_╱─    │  ← 8-week sparkline
│   ▲ +12% vs prev    │
└─────────────────────┘
```

**Implementation Details**:
- Render last 8 data points as SVG sparkline
- No axis labels (space-constrained)
- Single-color line matching metric theme
- Optional: Add hover tooltip with value

**Files to modify**:
- `extension/ui/dashboard.js`: Add `renderSparkline()` function
- `extension/ui/styles.css`: Add `.sparkline-container` styles

---

### Phase B: Dimension Filters

**Goal**: Enable users to slice data by repository, team, and other dimensions.

#### B.1 - Filter Bar UI Component

Add a horizontal filter bar below the date range selector:

```
┌─────────────────────────────────────────────────────────────┐
│ Date Range: [Last 90 days ▼]                                │
├─────────────────────────────────────────────────────────────┤
│ Repository: [All ▼]  Team: [All ▼]  Author: [All ▼]  [Clear]│
└─────────────────────────────────────────────────────────────┘
```

**Implementation Details**:
- Multi-select dropdowns with search/filter capability
- "All" as default selection
- Clear button to reset all filters
- Filters persist in URL query params (shareable)
- Load dimensions from `dimensions.json`

**Files to modify**:
- `extension/ui/index.html`: Add filter bar HTML structure
- `extension/ui/dashboard.js`: Add filter state management, `applyFilters()`
- `extension/ui/dataset-loader.js`: Add dimension loading
- `extension/ui/styles.css`: Add `.filter-bar`, `.filter-dropdown` styles

#### B.2 - Backend Filter Support

Extend the aggregates generator to support dimension-filtered data:

**Option A - Pre-computed dimension slices** (recommended for MVP):
- Generate separate rollup files per dimension combination
- Structure: `weekly_rollups/YYYY-Www/repo-{repoId}.json`
- Pro: Fast UI, no runtime computation
- Con: More files, storage growth

**Option B - Client-side filtering**:
- Load full data, filter in JavaScript
- Pro: Simple backend, fewer files
- Con: Slower for large datasets

**Recommendation**: Start with Option B for MVP, migrate to Option A if performance degrades.

#### B.3 - Filter Chip Display

Show active filters as removable chips:

```
│ Filtering by: [repo:backend ✕] [team:platform ✕]            │
```

**Implementation Details**:
- Chips appear when non-default filter selected
- Click ✕ to remove individual filter
- Compact display that doesn't crowd the UI

---

### Phase C: Enhanced Visualizations

**Goal**: Add richer chart types that surface deeper insights from existing data.

#### C.1 - Trend Line Overlay on Throughput Chart

Add a trend line (moving average) to the existing bar chart:

```
     PR Throughput Over Time
  40│    ▂▄    ═══════════════  ← 4-week moving average
  30│  ▄▆██▆▄▂▄▆█▆▄▂
  20│▄▆████████████▆▄
  10│██████████████████
    └────────────────────────
     W1 W2 W3 W4 W5 W6 W7 W8
```

**Implementation Details**:
- Calculate 4-week simple moving average
- Overlay as line on existing bar chart
- Different color (e.g., orange) to distinguish from bars
- Optional: Toggle to show/hide trend line

#### C.2 - Reviewer Activity Chart (New)

Add a new chart showing reviewer engagement:

```
     Review Activity
  ┌─────────────────────┐
  │ ████████████ 18 rev │  Week 1
  │ ██████████   15 rev │  Week 2
  │ ████████████████ 22 │  Week 3
  └─────────────────────┘
```

**Implementation Details**:
- Horizontal bar chart showing reviewers_count per week
- Complements the throughput chart (authors produce, reviewers consume)
- Helps identify review bottlenecks

#### C.3 - Cycle Time Trend Chart (New)

Replace or complement the distribution chart with a time-series view:

```
     Cycle Time Trend (P50 vs P90)
  hrs
  24│         ╱╲
  16│    ╱╲__╱  ╲____  P90
   8│___╱              P50
    └────────────────────────
     W1 W2 W3 W4 W5 W6 W7 W8
```

**Implementation Details**:
- Dual-line chart showing P50 and P90 over time
- Helps identify if cycle time is improving/degrading
- Legend with current values

#### C.4 - Chart Interactivity

Add hover tooltips and click interactions:

**Hover**: Show exact values
```
   ┌──────────────────┐
   │ Week 23, 2024    │
   │ PRs: 34          │
   │ Cycle P50: 3.2h  │
   └──────────────────┘
```

**Click**: Drill-down potential (sets date filter to that week)

---

### Phase D: Comparison Mode & Advanced Features

**Goal**: Enable powerful side-by-side analysis and polish the experience.

#### D.1 - Period Comparison Mode

Add a toggle to enable comparison view:

```
[Comparison Mode: ON]
Compare: [This month ▼] vs [Previous month ▼]

┌─────────────────────────────────────────────────────────────┐
│         This Month          │       Previous Month         │
├─────────────────────────────┼──────────────────────────────┤
│  Total PRs: 247             │  Total PRs: 221              │
│  Cycle P50: 4.2 hrs         │  Cycle P50: 4.6 hrs          │
│  Contributors: 12           │  Contributors: 11            │
├─────────────────────────────┴──────────────────────────────┤
│            Side-by-side charts here                        │
└─────────────────────────────────────────────────────────────┘
```

**Implementation Details**:
- Toggle button to enter/exit comparison mode
- Two date range pickers in comparison mode
- Side-by-side summary cards
- Overlaid or side-by-side charts
- Delta summary at bottom

#### D.2 - Export Functionality

Add ability to export current view:

```
[Export ▼]
├── Export as CSV
├── Export as PNG (screenshot)
└── Copy shareable link
```

**Implementation Details**:
- CSV: Export filtered data as downloadable CSV
- PNG: Use html2canvas or similar for chart screenshots
- Link: Copy current URL with all filters encoded

#### D.3 - Dashboard Presets / Saved Views

Allow users to save filter combinations:

```
[Saved Views ▼]
├── + Save current view
├── ─────────────
├── Backend Team - Last 30 days
└── Platform Monthly Review
```

**Implementation Details**:
- Save to user's extension settings
- Store: filter values, date range, comparison mode state
- Quick switch between saved configurations

#### D.4 - Responsive Layout Improvements

Ensure dashboard works well on various screen sizes:

- Tablet: Stack charts vertically, compress filter bar
- Large monitor: Expand to show more weeks, larger charts
- Print: Clean layout for PDF export

---

## Implementation Priority Matrix

| Feature | User Value | Effort | Data Ready | Priority |
|---------|------------|--------|------------|----------|
| Trend deltas on cards | High | Low | Yes | **P0** |
| Reviewers card | Medium | Low | Yes | **P0** |
| Repository filter | High | Medium | Yes | **P1** |
| Team filter | High | Medium | Yes | **P1** |
| Sparklines on cards | Medium | Medium | Yes | **P1** |
| Trend line overlay | Medium | Low | Yes | **P1** |
| Cycle time trend chart | High | Medium | Yes | **P2** |
| Reviewer activity chart | Medium | Medium | Yes | **P2** |
| Chart hover tooltips | Medium | Low | Yes | **P2** |
| Comparison mode | High | High | Yes | **P3** |
| Export functionality | Medium | Medium | Yes | **P3** |
| Saved views | Low | Medium | Yes | **P4** |

---

## Recommended Implementation Order

### Sprint 1: Quick Wins (Phase A.1 + A.2)
- Add trend deltas to existing 4 summary cards
- Add 5th card for reviewers
- Estimated scope: ~2-3 days development

### Sprint 2: Filters Foundation (Phase B.1 + B.2)
- Add filter bar UI component
- Implement client-side filtering
- Add filter chips display
- Estimated scope: ~3-4 days development

### Sprint 3: Visual Polish (Phase A.3 + C.1)
- Add sparklines to summary cards
- Add trend line overlay to throughput chart
- Estimated scope: ~2-3 days development

### Sprint 4: Chart Expansion (Phase C.2 + C.3 + C.4)
- Add reviewer activity chart
- Add cycle time trend chart
- Add hover tooltips to all charts
- Estimated scope: ~3-4 days development

### Sprint 5: Advanced Features (Phase D.1 + D.2)
- Implement comparison mode
- Add export functionality
- Estimated scope: ~4-5 days development

---

## Success Metrics

After full implementation, the dashboard should enable users to answer:

1. **Trend Questions**
   - "Is our cycle time improving or getting worse?"
   - "How does this month compare to last month?"
   - "Are we merging more or fewer PRs than before?"

2. **Filter Questions**
   - "How is the backend team performing vs frontend?"
   - "Which repository has the longest cycle times?"
   - "How do my PRs compare to the team average?"

3. **Capacity Questions**
   - "Do we have enough reviewers for our PR volume?"
   - "Is reviewer participation increasing or declining?"
   - "Are certain teams bottlenecked on reviews?"

---

## Technical Considerations

### No Schema Changes Required
All features in this plan use existing data from:
- `weekly_rollups/YYYY-Www.json` - Already has all needed fields
- `distributions/YYYY.json` - Already has time buckets and monthly data
- `dimensions.json` - Already has filter dimensions

### Backward Compatibility
- All enhancements are additive to the UI
- No changes to data contracts or schemas
- Existing datasets work without regeneration

### Performance
- Sparklines: Lightweight SVG, minimal overhead
- Filters: Client-side for MVP, can optimize later
- Comparison mode: Loads two date ranges, may need loading indicator

---

## Appendix: Mockups

### Summary Cards with Trends (Phase A Complete)

```
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ Total PRs   │ │ Cycle P50   │ │ Cycle P90   │ │ Contributors│ │ Reviewers   │
│    247      │ │   4.2 hrs   │ │  12.8 hrs   │ │     12      │ │     18      │
│  ╱╲_╱─╲     │ │  _╱╲__╱─    │ │  ─╲_╱╲_     │ │  ╱─╲_╱─     │ │  ─╱╲_╱─     │
│ ▲ +12%      │ │ ▼ -8%       │ │ ▼ -15%      │ │ ▲ +2        │ │ ▲ +3        │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
```

### Filter Bar (Phase B Complete)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Date Range: [Last 90 days ▼]  [Jun 1 - Aug 31, 2024]                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ Repository: [backend, api ▼]  Team: [All ▼]  Author: [All ▼]  [Clear All]  │
│ Active: [backend ✕] [api ✕]                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Enhanced Charts (Phase C Complete)

```
     PR Throughput Over Time                    Cycle Time Trend
  40│    ▂▄══════════════════             24│         ╱╲
  30│  ▄▆██▆▄▂▄▆█▆▄▂                      16│    ╱╲__╱  ╲____ P90
  20│▄▆████████████▆▄                      8│___╱              P50
  10│██████████████████                     └────────────────────
    └────────────────────                    W1 W2 W3 W4 W5 W6
     W1 W2 W3 W4 W5 W6 W7 W8
                                           Review Activity
     Cycle Time Distribution               ┌───────────────────┐
  ┌──────────────────────────┐            │████████████ 18    │ W1
  │ 0-1h  ████████ 28%       │            │██████████   15    │ W2
  │ 1-4h  ██████████████ 35% │            │████████████████ 22│ W3
  │ 4-24h ████████ 22%       │            └───────────────────┘
  │ 1-3d  ████ 10%           │
  │ 3-7d  ██ 4%              │
  │ 7d+   █ 1%               │
  └──────────────────────────┘
```

---

## Conclusion

This plan transforms the default dashboard from a basic metrics display into an interactive, insight-rich analytics tool. By leveraging data we already collect and following a phased approach, we can deliver incremental value while building toward the comprehensive experience users expect.

The key insight: **the data is ready; we just need to surface it effectively.**
