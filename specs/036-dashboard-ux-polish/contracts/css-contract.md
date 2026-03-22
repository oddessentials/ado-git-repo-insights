# CSS Contract: Dashboard UX Polish

**Branch**: `036-dashboard-ux-polish` | **Date**: 2026-03-22

This contract defines the CSS rules that MUST exist in `extension/ui/styles.css` after implementation. Automated stylesheet contract tests will verify rule existence.

## Required New Rules

### Filter Hint Styling

```
.filter-hint                     — Base banner styling (background, padding, border-left, border-radius)
.filter-hint-warning             — Warning severity variant (amber border-left, light amber background)
```

### Button and Input States

```
.btn:active                      — Pressed state feedback
.btn:disabled                    — Disabled state (opacity, cursor)
.btn-secondary:active            — Secondary pressed state
.btn-secondary:disabled          — Secondary disabled state
.filter-group select:hover       — Select hover state
.filter-group input:hover        — Input hover state
.tab.disabled                    — Tab unavailable state
```

### Author Filter Normalization

```
input[type="search"]             — Explicit normalization (height, border, appearance)
input[type="search"]::placeholder — Placeholder color normalization
```

### Mobile Breakpoint

```
@media (max-width: 480px)        — Small phone breakpoint (MUST contain rules for:)
  .summary-cards                 — Single-column grid
  .dashboard-header h1           — Reduced font size
  .metric-value                  — Reduced font size
  .loading-state, .error-state   — Reduced min-height
  .toast                         — Near-full-width positioning
  .filter-bar                    — Adjusted gap/padding
```

### Print Styles

```
@media print                     — Print stylesheet (MUST hide:)
  .filter-bar                    — Hidden
  .btn                           — Hidden
  .toast                         — Hidden
  .export-menu                   — Hidden
  .tabs                          — Hidden
  .filter-chip-remove            — Hidden
  (MUST preserve:)
  .active-filters                — Visible (filter summary)
  .comparison-banner             — Visible (period labels)
  .filter-hint:not(.hidden)      — Visible (notices)
  .truncation-indicator          — Visible (data completeness)
```

### Truncation Indicator Restyle

```
.truncation-indicator            — Restyled (non-tertiary color, min 12px font)
```

### Tab Animation

```
@keyframes fadeIn                — Duration updated to 0.25-0.3s
```

## Required Rule Modifications

### Touch Target Sizing

```
.filter-chip-remove              — min-width: 44px, min-height: 44px (or equivalent)
.btn-small                       — Increased padding for 36px effective height
.filter-group select             — Increased padding for 36px effective height
.filter-group input              — Increased padding for 36px effective height
.export-option                   — Increased padding for 36px+ effective height
```

### Comparison Banner Responsive

```
@media (max-width: 768px)        — Add rules for .comparison-banner (column layout, reduced gap)
```

## Verification Method

Each rule is verified by a stylesheet contract test that reads `styles.css` as text and asserts rule/selector presence via regex matching. This is deterministic, JSDOM-independent, and runs in CI.
