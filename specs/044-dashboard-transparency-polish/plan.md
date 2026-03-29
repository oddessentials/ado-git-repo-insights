# Implementation Plan: Dashboard Data Transparency, Visual Polish & Component Extraction

**Branch**: `044-dashboard-transparency-polish` | **Date**: 2026-03-29 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/044-dashboard-transparency-polish/spec.md`

## Summary

Implement the remaining 8 acceptance criteria from issue #204: surface review time P50/P90 and approval rate metrics, add sample size indicators and sparkline time labels for data transparency, color-code distribution buckets and improve visual polish (legend opacity, truncation indicators), and extract shared chart components. All data fields already exist in the rollup schema — this is a rendering, UX, and refactoring task. No backend or data pipeline changes required.

## Technical Context

**Language/Version**: TypeScript 5.x (extension UI), Python 3.10+ (backend — read-only for this feature)
**Primary Dependencies**: esbuild (IIFE bundler), vanilla DOM (no framework), renderTrustedHtml + escapeHtml (safe HTML pipeline)
**Storage**: N/A (reads JSON aggregates from dataset-loader/artifact-client, no writes)
**Testing**: Jest 30 + ts-jest + jsdom (extension), pytest (backend — existing tests only)
**Target Platform**: Azure DevOps managed hub extension (webview panel, no CSP restrictions)
**Project Type**: VS Code / ADO extension with dashboard UI
**Performance Goals**: Dashboard renders 156 weeks in < 1000ms (QG-28). No new full-data passes (FR-027).
**Constraints**: All 3 data paths (extension hub, CLI local, /docs demo) must produce identical output (FR-022). 2,024+ existing tests must pass (FR-023).
**Scale/Scope**: 8 acceptance criteria across 3 themes, ~30 files touched, ~100+ new tests

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Relevant? | Status | Notes |
|------|-----------|--------|-------|
| QG-17 | Yes | WILL SATISFY | Lint + format via pre-commit hooks (ESLint 9.x flat config) |
| QG-18 | Yes | WILL SATISFY | tsc type checking in pre-commit |
| QG-19 | Yes | WILL SATISFY | Jest + pytest in test:ci |
| QG-20 | Yes | WILL SATISFY | Coverage thresholds in jest.config.ts |
| QG-22 | Yes | WILL SATISFY | VSIX builds via esbuild |
| QG-28 | Yes | WILL SATISFY | No new data passes; extending existing aggregation functions only |
| QG-29 | Yes | WILL SATISFY | Existing MAX_THROUGHPUT_POINTS (104), MAX_REVIEWER_WEEKS (8) unchanged |
| QG-30 | Yes | WILL SATISFY | Shared UI bundle — chart functions are mode-agnostic |
| QG-35 | Yes | WILL SATISFY | Every CI check has local hook equivalent |
| QG-36 | Yes | WILL SATISFY | No weaker local modes |
| QG-38 | Yes | WILL SATISFY | No --no-verify usage |

**No violations. All gates satisfied or will be satisfied by implementation.**

## Project Structure

### Documentation (this feature)

```text
specs/044-dashboard-transparency-polish/
├── plan.md              # This file
├── spec.md              # Feature specification (30 FRs, 10 SCs)
├── research.md          # Phase 0 research (9 findings)
├── data-model.md        # Phase 1 data model
├── quickstart.md        # Developer quickstart
├── checklists/
│   └── requirements.md  # Spec quality checklist (v4)
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
extension/ui/
├── modules/
│   ├── metrics.ts                    # MODIFY: Add reviewTimeP50/P90 to CalculatedMetrics + extractSparklineData
│   ├── charts.ts                     # MODIFY: Add SPARKLINE_LOOKBACK_WEEKS, getLookbackWeekCount()
│   ├── charts/
│   │   ├── summary-cards.ts          # MODIFY: Sample size, sparkline labels, review time metrics
│   │   ├── cycle-time.ts             # MODIFY: BUCKET_COLOR_MAP, color classes
│   │   ├── reviewer-activity.ts      # MODIFY: Approval rate rendering
│   │   └── throughput.ts             # MODIFY: .truncation-badge class
│   └── shared/
│       ├── constants.ts              # NEW: MOBILE_BREAKPOINT, shared constants
│       ├── horizontal-bar.ts         # NEW: Extracted bar rendering (Phase 3)
│       ├── svg-path.ts               # NEW: Extracted SVG path (Phase 3)
│       ├── label-decimator.ts        # NEW: Extracted label thinning (Phase 3)
│       ├── render.ts                 # UNCHANGED
│       ├── format.ts                 # UNCHANGED
│       └── security.ts              # UNCHANGED
├── styles.css                        # MODIFY: Bucket colors, opacity, truncation badge, responsive
├── index.html                        # MODIFY: Review time card containers (if needed)
└── dashboard.ts                      # MINOR: Pass review time / approval rate data

extension/tests/
├── modules/
│   ├── metrics.test.ts               # EXTEND: reviewTimeP50/P90 tests
│   ├── charts.test.ts                # EXTEND: getLookbackWeekCount tests
│   ├── charts/
│   │   ├── summary-cards.test.ts     # EXTEND: Sample size, sparkline labels, review time
│   │   ├── reviewer-activity.test.ts # EXTEND: Approval rate conditional tests
│   │   └── cycle-time.test.ts        # EXTEND: Bucket color class tests
│   └── shared/
│       ├── horizontal-bar.test.ts    # NEW (Phase 3)
│       ├── svg-path.test.ts          # NEW (Phase 3)
│       └── label-decimator.test.ts   # NEW (Phase 3)
├── parity/
│   └── render-equivalence.test.ts    # EXTEND: New component parity, normalized DOM comparison
├── unit/
│   ├── ux-polish-rendering.test.ts   # EXTEND: Truncation badge, opacity, color classes
│   └── filter-consistency.test.ts    # NEW: FR-028 filter interaction invariant
└── invariants/
    ├── no-data-parity.test.ts        # NEW: FR-029 all-null renderNoData parity
    └── mobile-layout.test.ts         # NEW: FR-030 mobile breakpoint layout
```

**Structure Decision**: Extends existing extension/ui/ modules. New files only for shared component extraction (Phase 3) and new test invariants. No new directories beyond shared/ additions.

## Implementation Phases

### Phase 1: Data Transparency (FR-001 through FR-011)

**Dependency order**: metrics.ts → charts.ts → summary-cards.ts → reviewer-activity.ts

1. **Extend CalculatedMetrics** (metrics.ts)
   - Add `reviewTimeP50: number | null` and `reviewTimeP90: number | null`
   - Extract in existing `calculateMetrics()` pass using same median pattern
   - Extend `extractSparklineData()` with `reviewTimeP50s` and `reviewTimeP90s`
   - Tests: metrics.test.ts (null handling, partial data, all-null)

2. **Add sparkline lookback infrastructure** (charts.ts)
   - Export `SPARKLINE_LOOKBACK_WEEKS = 8`
   - Export `getLookbackWeekCount(rollups)` function
   - Replace hardcoded `slice(-8)` with `slice(-SPARKLINE_LOOKBACK_WEEKS)`
   - Tests: charts.test.ts (lookback with various data sizes)

3. **Enhance summary cards** (summary-cards.ts)
   - Add review time P50/P90 metric rendering with info icons + METRIC_EXPLANATIONS entries
   - Add sample size subtitle: `"Based on ${totalPrs} PR${totalPrs === 1 ? '' : 's'}"` using `calculateMetrics().totalPrs`
   - Add `LOW_SAMPLE_THRESHOLD = 10` — apply `.low-sample` class when below
   - Add sparkline time label: `"Last ${getLookbackWeekCount(rollups)} week${n === 1 ? '' : 's'}"`
   - Tests: summary-cards.test.ts (all new elements, consistency assertions)

4. **Add approval rate rendering** (reviewer-activity.ts)
   - When `reviewerFilterActive`, compute approval_rate from raw `by_reviewer` breakdown data
   - Display as "Approval Rate: N%" in chart subtitle or secondary metric
   - Handle null (renderNoData pattern), 0%, 100% edge cases
   - **CHECKPOINT**: Verify approval_rate survives filter path (see memory: project_044_approval_rate_checkpoint)
   - Tests: reviewer-activity.test.ts (conditional display, null, 0%, 100%, filter on/off)

### Phase 2: Visual Polish (FR-012 through FR-017)

**No dependencies on Phase 1. Can proceed in parallel on styles.**

5. **Color-code distribution buckets** (cycle-time.ts + styles.css)
   - Define `BUCKET_COLOR_MAP` constant with 6 entries → "fast"/"moderate"/"slow"
   - Add `bucket-fast`, `bucket-moderate`, `bucket-slow` CSS class to each `dist-row`
   - Add CSS rules: `.bucket-fast .dist-bar { background: var(--success) }` etc.
   - Add responsive stacking at `@media (max-width: 480px)` for distribution rows
   - Tests: cycle-time.test.ts (color class assignment, unknown label fallback)

6. **Update dimmed legend opacity** (styles.css)
   - Change `.dimmed { opacity: 0.3 }` to `.dimmed { opacity: 0.55 }`
   - Single line change
   - Tests: ux-polish-rendering.test.ts (assert .dimmed class present on insufficient-data legends)

7. **Restyle truncation indicators** (styles.css + 3 chart modules)
   - Add `.truncation-badge` class to all truncation indicator `<div>` elements in throughput.ts, reviewer-activity.ts, cycle-time.ts
   - Style: `background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: var(--radius); padding: 6px 12px; font-weight: 600; display: inline-block`
   - Mobile: `@media (max-width: 480px)` → full-width banner with `var(--warning-bg)` background and left accent border
   - Tests: ux-polish-rendering.test.ts (class presence, text content pattern)

### Phase 2.5: Cross-Cutting Invariant Tests (FR-022, FR-028-030)

8. **Parity tests** (render-equivalence.test.ts)
   - Extend Layer A: idempotency tests for new summary card elements
   - Extend Layer B: cross-path normalization for review time fields
   - Add normalized DOM comparison (collapse whitespace, sort attributes)

9. **Filter interaction test** (NEW: filter-consistency.test.ts)
   - Apply filter → assert all metrics reflect filtered data consistently
   - Remove filter → assert all metrics return to unfiltered state

10. **All-null no-data test** (NEW: no-data-parity.test.ts)
    - Render with all-null dataset → assert every card/chart uses renderNoData() with .no-data structure

11. **Mobile layout test** (NEW: mobile-layout.test.ts)
    - Render at < MOBILE_BREAKPOINT → assert distribution row stacking, truncation banner, card grid changes
    - Verify MOBILE_BREAKPOINT JS constant matches CSS media query value

### Phase 3: Component Extraction (FR-018 through FR-021)

**MUST be last — after all Phase 1-2 features stabilize.**

12. **Capture pre-extraction snapshots**
    - Snapshot all chart module HTML output with test datasets
    - Record baseline LOC: `wc -l` on chart modules

13. **Extract shared horizontal bar** (NEW: shared/horizontal-bar.ts)
    - Extract from reviewer-activity.ts (lines 111-128) and cycle-time.ts (lines 89-101)
    - Tests: horizontal-bar.test.ts (pure function tests + DOM integration)
    - Verify: post-extraction snapshots identical to pre-extraction

14. **Extract SVG path generation** (NEW: shared/svg-path.ts)
    - Extract sparkline coordinate scaling + path building from charts.ts
    - Tests: svg-path.test.ts (coordinate math, empty data, single point)
    - Verify: sparkline rendering unchanged

15. **Extract label decimation** (NEW: shared/label-decimator.ts)
    - Extract label thinning logic from throughput.ts and cycle-time.ts
    - Tests: label-decimator.test.ts (step calculation, boundary cases)
    - Verify: label visibility unchanged

16. **Verify LOC delta**
    - Run automated LOC count against post-Phase-2 baseline
    - Assert at least 80 lines net reduction
    - Run full test suite — all 2,024+ existing tests must pass

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| approval_rate dropped in filter path | Implementation checkpoint: verify propagation before wiring UI |
| Extraction introduces regression | Pre/post snapshot parity tests; extract after features stabilize |
| Mobile breakpoint JS/CSS drift | Automated parity test greps CSS, compares to JS constant |
| Sample size inconsistent across cards | Single computation from calculateMetrics().totalPrs, shared across all cards |
| Sparkline label drift per card | Single getLookbackWeekCount() function, test asserts identical N across all labels |

## Complexity Tracking

> No constitution violations. No complexity justification needed.
