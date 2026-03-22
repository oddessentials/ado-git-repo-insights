# Rendering Contract: Dashboard UX Polish

**Branch**: `036-dashboard-ux-polish` | **Date**: 2026-03-22

This contract defines the rendering behaviors that MUST be verified by automated DOM assertions in Jest/JSDOM tests.

## Label Thinning Contract

**Function**: `renderThroughput()` in `throughput.ts`
**Constant**: `MAX_VISIBLE_LABELS = 16`

| Input (barCount) | labelStep | Labels rendered | Label indices |
|-------------------|-----------|----------------|---------------|
| 1-16 | 1 | all | 0, 1, 2, ..., N-1 |
| 17-32 | 2 | every 2nd | 0, 2, 4, ..., |
| 33-48 | 3 | every 3rd | 0, 3, 6, ..., |
| 49-64 | 4 | every 4th | 0, 4, 8, ..., |
| 65-80 | 5 | every 5th | 0, 5, 10, ..., |
| 81-96 | 6 | every 6th | 0, 6, 12, ..., |
| 97-104 | 7 | every 7th | 0, 7, 14, 21, 28, 35, 42, 49, 56, 63, 70, 77, 84, 91, 98 |

**Invariants**:
- `labelStep = Math.ceil(barCount / MAX_VISIBLE_LABELS)`
- Label at index `i` is visible iff `i % labelStep === 0`
- First label (index 0) is ALWAYS visible
- `.bar-label` element is always emitted (preserves flex spacing); text is conditionally empty
- Output is identical for same barCount across CLI, GitHub Pages, and ADO Extension

## Truncation Indicator Contract

| Chart | Condition | Indicator |
|-------|-----------|-----------|
| Throughput | `rollups.length > MAX_THROUGHPUT_POINTS` | `.truncation-indicator` with prominent styling |
| Cycle-time | `rollups.length > MAX_CYCLE_TIME_POINTS` | `.truncation-indicator` with prominent styling |
| Predictions | `data.length > MAX_CHART_POINTS` | `.truncation-badge` element (new) |
| Sparklines | `values.length > MAX_SPARKLINE_POINTS` | `.truncation-badge` element (new) |
| Throughput | `rollups.length <= MAX_THROUGHPUT_POINTS` | NO indicator rendered |

**Indicator style invariant**: `.truncation-indicator` MUST NOT use `var(--text-tertiary)` color. MUST use `var(--text-secondary)` or stronger. Font-size >= 12px.

## Tooltip Tap/Click Contract

**Function**: `addChartTooltips()` in `charts.ts`

| Gesture | Result |
|---------|--------|
| `mouseenter` on data point | Show tooltip (existing behavior) |
| `mouseleave` from data point | Hide tooltip (existing behavior) |
| `click`/tap on data point (movement < 10px) | Show tooltip, dismiss any previous |
| `click`/tap on document body | Dismiss active tooltip |
| `click`/tap on different data point | Dismiss previous, show new |
| Touch gesture becomes scroll (movement >= 10px) | Cancel tap, no tooltip, chart scrolls normally |

**Implementation note**: Use `pointerdown`/`pointerup` with distance calculation for unified mouse+touch handling.

## Filter Hint Rendering Contract

| Element ID | Base class | Severity class | Content source |
|------------|-----------|----------------|----------------|
| `comments-coverage-banner` | `filter-hint` | (none — info default) | `dashboard.ts` updateDatasetInfo |
| `reviewer-filter-notice` | `filter-hint` | `filter-hint-warning` (when constrained) | `dashboard.ts` filter update |
| `author-filter-notice` | `filter-hint` | (none — info default) | Static text in HTML |

## Touch Target Size Contract

| Element | Tier | Min Height | Min Width | Verified By |
|---------|------|-----------|-----------|-------------|
| `.filter-chip-remove` | Critical | 44px | 44px | DOM dimension assertion |
| `.btn-small` | Secondary | 36px | — | DOM dimension assertion |
| `.filter-group select` | Secondary | 36px | — | DOM dimension assertion |
| `.filter-group input` | Secondary | 36px | — | DOM dimension assertion |
| `.export-option` | Secondary | 36px | — | DOM dimension assertion |
| `.tab` | Secondary | 36px | — | DOM dimension assertion |

## Empty State Message Contract

| Trigger | Current message | Required message pattern |
|---------|----------------|--------------------------|
| No data in date range | "No data for selected range" | MUST include guidance hint (e.g., "Try widening...") |
| No reviewer data | "No reviewer data available" | MUST include context (e.g., "Reviewer data requires...") |
| Not enough for trend | "Not enough data for trend" | MUST include minimum requirement (e.g., "At least 2 weeks needed") |
