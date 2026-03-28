# Contract: Tooltip System

**Feature**: 041-metrics-dashboard-ux
**Date**: 2026-03-27

## Overview

Two tooltip systems coexist on the dashboard: **chart tooltips** (hover/tap on data elements) and **info tooltips** (hover/click on summary card info icons). A shared tooltip manager enforces mutual exclusivity.

## Tooltip Manager Contract

### dismissAllTooltips()

Removes any active tooltip from either system. Single entry point for tooltip cleanup.

**Postconditions**:
- Zero elements with class `.chart-tooltip` exist in DOM
- Zero elements with class `.info-tooltip` exist in DOM

### showChartTooltip(target: HTMLElement, contentFn: (el: HTMLElement) => string)

Displays a chart data tooltip anchored to the target element.

**Preconditions**:
- `target` has `[data-tooltip]` attribute
- `target` is within a chart container

**Postconditions**:
- `dismissAllTooltips()` called first
- Exactly one `.chart-tooltip` element exists in DOM
- Element has `position: fixed`
- Element is within viewport bounds (top >= 0, left >= 0, bottom <= window.innerHeight, right <= window.innerWidth)

### showInfoTooltip(target: HTMLElement, content: string)

Displays a metric explanation tooltip anchored to an info icon.

**Preconditions**:
- `target` has `[data-info-tooltip]` attribute
- `target` is an info icon element within a summary card

**Postconditions**:
- `dismissAllTooltips()` called first
- Exactly one `.info-tooltip` element exists in DOM
- Element has `position: fixed`
- Element is within viewport bounds

## Positioning Contract

### Input
- `rect`: Result of `target.getBoundingClientRect()` (viewport-relative coordinates)
- `tooltipWidth`, `tooltipHeight`: Measured dimensions of tooltip element

### Default Position
- Centered horizontally above the target
- `left = rect.left + rect.width/2 - tooltipWidth/2`
- `top = rect.top - tooltipHeight - 8` (8px gap)

### Boundary Adjustments
- **Top overflow** (top < 0): Flip below target. `top = rect.bottom + 8`
- **Left overflow** (left < 0): Clamp to `left = 4`
- **Right overflow** (left + tooltipWidth > window.innerWidth): Clamp to `left = window.innerWidth - tooltipWidth - 4`
- **Bottom overflow after flip** (top + tooltipHeight > window.innerHeight): Clamp to `top = window.innerHeight - tooltipHeight - 4`

## CSS Namespace Contract

| Class | z-index | System | Purpose |
|-------|---------|--------|---------|
| `.chart-tooltip` | 100 | Chart tooltips | Data element hover/tap tooltips |
| `.info-tooltip` | 150 | Info tooltips | Summary card metric explanations |
| `.toast` | 1000 | Notifications | Toast messages (unchanged) |

## Dismissal Contract

| Trigger | Chart Tooltip | Info Tooltip |
|---------|--------------|--------------|
| Click outside | Dismiss | Dismiss |
| Scroll | Dismiss | Dismiss |
| New chart tooltip | Dismiss (via dismissAll) | Dismiss (via dismissAll) |
| New info tooltip | Dismiss (via dismissAll) | Dismiss (via dismissAll) |
| Tab switch | Dismiss | Dismiss |
| Filter change | Dismiss | Preserve |

## Lifecycle Invariant (Tested)

At any point in time, the DOM contains **at most one** element matching `.chart-tooltip, .info-tooltip`. This is enforced by the dismiss-before-create pattern and verified by a dedicated test:

1. After `dismissAllTooltips()`: zero tooltip elements exist
2. After `showChartTooltip()` or `showInfoTooltip()`: exactly one tooltip element exists
3. The sequence dismiss → create → position → append is atomic (no intermediate states)

## Structural Assertion

At initialization, the tooltip manager MUST verify:
- `document.body` exists
- No intermediate positioned ancestors between `body` and chart containers (that would break `position: fixed`)

If the assertion fails, log a warning with diagnostic information. Do not silently produce mispositioned tooltips.
