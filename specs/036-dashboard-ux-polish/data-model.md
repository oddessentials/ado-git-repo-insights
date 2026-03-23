# Data Model: Dashboard UX Polish

**Branch**: `036-dashboard-ux-polish` | **Date**: 2026-03-22

This feature is purely presentational — it does not introduce new data entities, storage, or schema changes. The data model below documents the **UI rendering constants and CSS contract entities** that drive the implementation.

## Rendering Constants

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `MAX_THROUGHPUT_POINTS` | 104 | `throughput.ts:15` | Existing — max bars rendered |
| `MAX_CYCLE_TIME_POINTS` | 104 | `cycle-time.ts:17` | Existing — max line points |
| `MAX_CHART_POINTS` | 200 | `predictions.ts:44` | Existing — max prediction points |
| `MAX_REVIEWER_WEEKS` | 8 | `reviewer-activity.ts:15` | Existing — max reviewer weeks |
| `MAX_VISIBLE_LABELS` | 16 | `throughput.ts` (new) | **New** — max throughput labels before thinning |
| `TOUCH_TARGET_CRITICAL` | 44 | `constants.ts` (new) | **New** — min px for critical touch targets |
| `TOUCH_TARGET_SECONDARY` | 36 | `constants.ts` (new) | **New** — min px for secondary touch targets |
| `SCROLL_CANCEL_THRESHOLD` | 10 | `charts.ts` (new) | **New** — px movement to cancel tap-to-tooltip |

## CSS Contract Entities

### Filter Hint Banner

A styled notification element used in three locations:

| Instance | Element ID | Severity | Content Source |
|----------|-----------|----------|----------------|
| Comments coverage | `comments-coverage-banner` | info (default) | `dashboard.ts:2041-2082` |
| Reviewer constrained | `reviewer-filter-notice` | warning | `dashboard.ts:1659-1667` |
| Author + team notice | `author-filter-notice` | info (default) | `dashboard.ts:1658` |

**CSS classes**: `.filter-hint` (base), `.filter-hint-warning` (amber variant)
**Visibility**: Controlled via `.hidden` class toggle

### Truncation Indicator

Communicates partial data display on charts:

| Chart | Existing | Needs Change |
|-------|----------|--------------|
| Throughput | Yes (muted) | Restyle to prominent |
| Cycle-time | Yes (muted) | Restyle to prominent |
| Predictions | No | Add indicator |
| Sparklines | No | Add indicator |

**CSS class**: `.truncation-indicator` (restyled)

### Touch Target Tiers

| Tier | Min Size | Elements |
|------|----------|----------|
| Critical | 44x44px | `.filter-chip-remove` |
| Secondary | 36px height | `.btn-small`, `.filter-group select`, `.filter-group input`, `.export-option`, `.tab` |

## State Transitions

### Tooltip Lifecycle (Extended)

```
idle → [mouseenter OR tap] → showing → [mouseleave OR tap-elsewhere OR tap-other-point] → idle
                                     → [scroll-gesture (>10px)] → cancelled → idle
```

### Filter Hint Visibility

```
hidden → [filter condition met] → visible(info|warning) → [condition cleared] → hidden
```

No new database entities, API contracts, or schema changes are introduced.
