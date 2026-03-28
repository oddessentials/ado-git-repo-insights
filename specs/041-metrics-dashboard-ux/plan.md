# Implementation Plan: Metrics Dashboard UX Improvements

**Branch**: `041-metrics-dashboard-ux` | **Date**: 2026-03-27 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/041-metrics-dashboard-ux/spec.md`

## Summary

Fix four UX deficiencies in the metrics dashboard tab of the Azure DevOps extension: (1) tooltip positioning bug where tooltips float off-screen when charts are scrolled, (2) inconsistent filter UX across four dimensions (only Author has typeahead), (3) generic empty state messaging that doesn't distinguish filtered-out data from missing data, and (4) missing explanatory info icons on summary cards.

The approach is to fix tooltip positioning via `position: fixed`, build a unified typeahead dropdown component replacing all four filter implementations, add context-aware empty state classification with a strict evaluation hierarchy, and add info icons using a distinct tooltip namespace. All changes enforce a single filter constraint resolver, maintain URL backward compatibility, and pass existing parity tests plus new component-specific parity tests.

## Technical Context

**Language/Version**: TypeScript 5.x (extension UI), esbuild (IIFE bundler)
**Primary Dependencies**: Vanilla DOM (no framework), existing shared modules (`renderTrustedHtml`, `escapeHtml`, `clearElement`)
**Storage**: N/A (reads JSON aggregates from artifact client / dataset loader, no writes)
**Testing**: Jest (extension tests, 642+ tests in CI, min threshold 632), existing parity suite (`render-equivalence.test.ts`, `schema/parity.test.ts`, `smoke-render.test.ts`, `e2e/dashboard-render.test.ts`)
**Target Platform**: Azure DevOps extension webview (iframe), VS Code-like panel widths 300px–full screen
**Project Type**: Browser extension (Azure DevOps hub)
**Performance Goals**: Tooltip repositioning < 16ms (single frame), typeahead dropdown update < 100ms (200 items) / < 200ms (1000 items), no dropped frames during continuous typing
**Constraints**: Must pass existing 642+ tests, parity across 2 entry points (Dashboard hub, Settings panel), URL backward compatibility, no framework introduction
**Scale/Scope**: 260 weekly rollups loaded in memory, up to 1,000 filter options per dimension, 5 summary cards, 4 chart types

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Relevant? | Status | Notes |
|-----------|-----------|--------|-------|
| I-IV (CSV Schema) | No | N/A | Feature is UI-only, no CSV changes |
| V (SQLite as Source of Truth) | No | N/A | Feature reads JSON aggregates, doesn't touch SQLite |
| VI-IX (Pipeline/Persistence) | No | N/A | No pipeline changes |
| X-XI (Extraction Modes) | No | N/A | No extraction changes |
| XII-XIII (Pagination/Rate Limiting) | No | N/A | No API client changes |
| XIV-XVI (Identity/Scoping) | No | N/A | No data model changes |
| XVII-XX (Runtime/Security) | No | N/A | No PAT handling, no agent changes |
| XXI-XXII (Storage Backend) | No | N/A | No storage changes |
| XXIII (CSV Contract Validation) | No | N/A | No CSV changes |
| XXIV-XXV (E2E/Backfill Testing) | No | N/A | No extraction pipeline changes |
| QG-28 (Dashboard renders 156 weeks < 1000ms) | **Yes** | Pass | New typeahead component adds no chart rendering overhead. Performance thresholds in FR-012 (100ms/200ms) are within budget. |
| QG-29 (Chart data caps enforced) | **Yes** | Pass | No changes to MAX_*_POINTS constants or chart truncation logic. |
| QG-30 (CLI and extension shared UI bundle) | **Yes** | Pass | All changes in shared modules (`extension/ui/modules/`). FR-020 requires parity tests for new components. |
| QG-31-33 (Demo dataset/parity) | **Yes** | Pass | UI changes don't affect data generation. Demo dataset renders through same chart modules — changes are backward compatible (same data shape, no new required fields). |
| QG-34 (Startup-state parity) | **Yes** | Pass | Empty state messages change but are deterministic given same data + filter state. Parity tests will verify. |

**Result: All applicable gates PASS. No violations. No complexity justification needed.**

## Project Structure

### Documentation (this feature)

```text
specs/041-metrics-dashboard-ux/
├── plan.md              # This file
├── spec.md              # Feature specification (complete)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── tooltip-system.md
│   ├── filter-component.md
│   └── empty-state-classifier.md
├── checklists/
│   └── requirements.md  # Spec quality checklist (complete)
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
extension/
├── ui/
│   ├── index.html                          # Dashboard HTML (filter markup changes)
│   ├── styles.css                          # New CSS classes for info tooltips, typeahead
│   ├── dashboard.ts                        # Filter initialization, constraint resolver extraction
│   ├── modules/
│   │   ├── index.ts                        # Barrel exports (add new modules)
│   │   ├── filters.ts                      # URL serialization (canonical format update)
│   │   ├── metrics.ts                      # Remove duplicate constraint warnings
│   │   ├── filter-constraint-resolver.ts   # NEW: Single-authority constraint resolver
│   │   ├── typeahead-dropdown.ts           # NEW: Unified typeahead component
│   │   ├── tooltip-manager.ts              # NEW: Cross-system tooltip dismiss coordinator
│   │   ├── empty-state-classifier.ts       # NEW: Strict evaluation hierarchy
│   │   ├── data-availability.ts            # NEW: deriveAvailabilitySignal() function
│   │   ├── shared/
│   │   │   └── render.ts                   # Updated NO_DATA_HINTS, renderNoData signature
│   │   └── charts/
│   │       ├── charts.ts                   # Tooltip positioning fix (position: fixed)
│   │       ├── summary-cards.ts            # Info icon rendering
│   │       ├── throughput.ts               # Empty state classifier integration
│   │       ├── cycle-time.ts               # Empty state classifier integration
│   │       └── reviewer-activity.ts        # Empty state classifier integration
│   ├── dataset-loader.ts                   # Type guard enhancement in normalizeRollup()
│   └── types.ts                            # DataAvailabilitySignal interface (alongside DatasetCapabilityState)
├── tests/
│   ├── modules/
│   │   ├── charts/
│   │   │   └── tooltip.test.ts             # Updated: position: fixed, boundary detection, lifecycle invariant
│   │   ├── typeahead-dropdown.test.ts      # NEW: Component unit tests
│   │   ├── filter-constraint-resolver.test.ts  # NEW: All 16 combo states
│   │   ├── empty-state-classifier.test.ts  # NEW: Hierarchy evaluation tests
│   │   └── tooltip-manager.test.ts         # NEW: Cross-system dismiss tests
│   ├── parity/
│   │   └── render-equivalence.test.ts      # Extended: filter, empty state, info icon parity
│   ├── performance/
│   │   └── typeahead-performance.test.ts   # NEW: Latency threshold tests
│   └── integration/
│       └── filter-url-roundtrip.test.ts    # NEW: Serialize/deserialize round-trip
└── scripts/
    └── bundle-ui.mjs                       # Entry point additions if needed
```

**Structure Decision**: All changes are within the existing `extension/` directory structure. New modules are added to `extension/ui/modules/` following existing patterns. New test files follow existing directory conventions. No new top-level directories needed.

## Complexity Tracking

No constitution violations. No complexity justification needed.

## Post-Design Constitution Re-Check

| Gate | Status | Notes |
|------|--------|-------|
| QG-28 | Pass | Typeahead adds no chart rendering overhead; perf-tested separately |
| QG-29 | Pass | No MAX_*_POINTS changes |
| QG-30 | Pass | Shared modules used by both entry points; parity tests extended |
| QG-34 | Pass | Empty states deterministic given same inputs; parity tests verify |

**Result: All gates still PASS after design phase.**
