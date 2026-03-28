# Quickstart: Metrics Dashboard UX Improvements

**Feature**: 041-metrics-dashboard-ux
**Date**: 2026-03-27

## Prerequisites

- Node.js 18+ and pnpm 9+
- The extension builds and tests pass: `cd extension && pnpm install && pnpm run test:ci`
- Demo dataset available: `python scripts/build-demo-dataset.py` (generates test data)

## Development Setup

```bash
# Switch to feature branch
git checkout 041-metrics-dashboard-ux

# Install extension dependencies
cd extension
pnpm install

# Run tests (should all pass before starting)
pnpm run test:ci

# Build the UI bundle (watch mode for development)
node scripts/bundle-ui.mjs --watch
```

## Key Files to Modify

### Tooltip Fix (US1)
1. `extension/ui/modules/charts.ts` — Change `position: absolute` to `position: fixed` in `showTooltip()`, add viewport boundary detection
2. `extension/ui/styles.css` — Update `.chart-tooltip` CSS to use `position: fixed`
3. `extension/tests/modules/charts/tooltip.test.ts` — Update tests for fixed positioning, add lifecycle invariant test

### Unified Filter (US2)
1. **NEW** `extension/ui/modules/typeahead-dropdown.ts` — The unified component
2. **NEW** `extension/ui/modules/filter-constraint-resolver.ts` — Extracted from dashboard.ts
3. `extension/ui/modules/filters.ts` — Update serialization to canonical format (sorted, encoded)
4. `extension/ui/dashboard.ts` — Replace filter initialization, use constraint resolver
5. `extension/ui/modules/metrics.ts` — Remove duplicate constraint warnings, call resolver
6. `extension/ui/index.html` — Update filter markup (replace `<select>` with component mount points)

### Empty States (US3)
1. **NEW** `extension/ui/modules/empty-state-classifier.ts` — Centralized classification logic
2. `extension/ui/modules/shared/render.ts` — Update `NO_DATA_HINTS` constants, `renderNoData` signature
3. `extension/ui/modules/charts/throughput.ts` — Use classifier instead of inline checks
4. `extension/ui/modules/charts/cycle-time.ts` — Use classifier instead of inline checks
5. `extension/ui/modules/charts/reviewer-activity.ts` — Use classifier instead of inline checks

### Info Icons (US4)
1. **NEW** `extension/ui/modules/tooltip-manager.ts` — Cross-system tooltip coordinator
2. `extension/ui/modules/charts/summary-cards.ts` — Add info icon rendering
3. `extension/ui/styles.css` — Add `.info-tooltip` styles with z-index 150

## Testing Strategy

### Run All Tests
```bash
cd extension && pnpm run test:ci
```

### Run Specific Test Suites
```bash
# Tooltip tests
pnpm run test -- --testPathPattern="tooltip"

# Parity tests
pnpm run test -- --testPathPattern="parity"

# Filter tests (after creating)
pnpm run test -- --testPathPattern="typeahead|filter-constraint|filter-url"
```

### Manual Verification
1. Build: `node scripts/bundle-ui.mjs`
2. Start dashboard: `ado-insights dashboard --dataset ./artifacts/demo-enterprise/data --open`
3. Verify: scroll charts, hover bars/dots, check tooltip positioning
4. Verify: type in all four filters, check typeahead behavior
5. Verify: apply filters that produce empty charts, check messages
6. Verify: hover info icons on summary cards, check explanations

## Implementation Order

1. **Tooltip fix** (FR-001 to FR-004) — Smallest scope, unblocks info icon tooltips
2. **Tooltip manager** (FR-019) — Shared dismiss infrastructure needed by both chart tooltips and info icons
3. **Info icons** (FR-017, FR-018) — Depends on tooltip manager
4. **Constraint resolver** (FR-010) — Must exist before filter refactor
5. **Filter URL canonical format** (FR-009) — Independent, can be done in parallel with resolver
6. **Empty state classifier** (FR-014, FR-015, FR-016) — Independent of filter refactor
7. **Unified typeahead component** (FR-005 to FR-008, FR-011, FR-012) — Largest scope, depends on constraint resolver
8. **Parity tests for new components** (FR-020) — After all components exist

## Contracts Reference

- [Tooltip System](contracts/tooltip-system.md) — Positioning, lifecycle, z-index layering
- [Filter Component](contracts/filter-component.md) — Typeahead interface, URL serialization, constraint resolver
- [Empty State Classifier](contracts/empty-state-classifier.md) — Evaluation hierarchy, data availability signals
