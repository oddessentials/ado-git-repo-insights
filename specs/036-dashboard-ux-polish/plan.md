# Implementation Plan: Dashboard UX Polish

**Branch**: `036-dashboard-ux-polish` | **Date**: 2026-03-22 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/036-dashboard-ux-polish/spec.md`

## Summary

Polish the PR Insights dashboard to enterprise-grade visual quality across 8 user stories (21 functional requirements). Changes are purely presentational — CSS styling additions, minor TypeScript rendering logic changes, and deterministic automated tests. No data pipeline, schema, or extraction changes. All work goes through the shared UI bundle (`extension/ui/`) and is verified via existing parity and determinism pipelines.

## Technical Context

**Language/Version**: TypeScript 5.x (UI rendering), CSS (styling)
**Primary Dependencies**: Jest + JSDOM (testing), existing dom-harness.ts (test utilities)
**Storage**: N/A — no data layer changes
**Testing**: Jest with JSDOM (DOM assertions), stylesheet contract tests (regex on CSS text), existing parity pipeline (pytest)
**Target Platform**: ADO Extension (iframe), CLI (local HTTP server), GitHub Pages (static)
**Project Type**: Web application (extension + CLI dashboard)
**Performance Goals**: Dashboard renders 156 weeks in <1000ms (existing QG-28, no regression)
**Constraints**: All changes deterministic across surfaces, JSDOM-compatible tests, no visual regression framework
**Scale/Scope**: ~15 files modified, ~5 new test files, 1 CSS file as primary change surface

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Relevance | Status |
|------|-----------|--------|
| QG-28 | Dashboard renders 156 weeks in <1000ms | PASS — label thinning reduces DOM text, no performance regression |
| QG-29 | Chart data caps enforced (MAX_*_POINTS) | PASS — existing caps unchanged; adding MAX_VISIBLE_LABELS alongside |
| QG-30 | CLI and extension use shared UI bundle | PASS — all changes in shared `extension/ui/`; ui_sync propagates |
| QG-31 | Canonical enterprise demo builds | PASS — no data generator changes |
| QG-32 | docs/data/ is clean promoted mirror | PASS — no data changes |
| QG-33 | Enterprise demo capability matrix passes | PASS — no capability changes |
| QG-34 | Normalized startup-state parity passes | PASS — HTML changes are in shared index.html |

**All gates PASS.** No violations to justify.

### Post-Design Re-Check

| Gate | Status |
|------|--------|
| QG-28 | PASS — label thinning computes one `Math.ceil` per render; tooltip adds event listeners per dot (existing pattern) |
| QG-29 | PASS — no cap changes; adding truncation badges to predictions/sparklines is additive |
| QG-30 | PASS — single shared bundle; CSS/TS changes flow through build:ui → ui_sync |
| QG-34 | PASS — ARIA attributes on tabs are in shared index.html; filter-hint styling is in shared styles.css |

## Project Structure

### Documentation (this feature)

```text
specs/036-dashboard-ux-polish/
├── spec.md
├── plan.md                   # This file
├── research.md               # Phase 0 output
├── data-model.md             # Phase 1 output
├── quickstart.md             # Phase 1 output
├── contracts/
│   ├── css-contract.md       # Required CSS rules
│   └── rendering-contract.md # Required rendering behaviors
└── checklists/
    └── requirements.md       # Spec quality checklist
```

### Source Code (repository root)

```text
extension/ui/
├── styles.css                 # PRIMARY: All CSS additions (~200 lines added)
├── index.html                 # MINOR: ARIA attributes on tab buttons
├── modules/
│   ├── charts/
│   │   ├── throughput.ts      # Label thinning (MAX_VISIBLE_LABELS, conditional text)
│   │   └── predictions.ts     # Truncation badge
│   ├── charts.ts              # Tooltip tap/click handler, scroll-cancellation
│   ├── ml.ts                  # Sparkline truncation badge
│   └── shared/
│       └── render.ts          # Contextual empty-state messages
└── dashboard.ts               # Filter hint warning class toggle

extension/tests/
├── unit/
│   ├── css-contract.test.ts           # NEW: stylesheet rule existence
│   ├── touch-target-contract.test.ts  # NEW: touch target constant assertions
│   └── ux-polish-rendering.test.ts    # NEW: filter hints, empty states, truncation
└── modules/
    └── charts/
        ├── throughput.test.ts          # MODIFIED: label thinning assertions
        └── tooltip.test.ts             # NEW: tap/click tooltip behavior
```

**Structure Decision**: All changes fit within the existing `extension/ui/` and `extension/tests/` structure. No new directories needed beyond test files.

## Complexity Tracking

No constitution violations. No complexity justification needed.

## Implementation Phases

### Phase 1: CSS Foundation (P1 requirements)

**Goal**: Establish all new CSS rules — filter hints, touch targets, button states, truncation indicator restyle.

**Files**:
- `extension/ui/styles.css` — Add `.filter-hint`, `.filter-hint-warning`, `.btn:active`, `.btn:disabled`, `.btn-secondary:active`, `.btn-secondary:disabled`, `.tab.disabled`, `.filter-group select:hover`, `.filter-group input:hover`, `input[type="search"]` normalization, touch target padding increases, `.truncation-indicator` restyle.

**Tests**:
- `extension/tests/unit/css-contract.test.ts` — Read `styles.css` as text, assert each required selector exists via regex.

**Verification**: `pnpm test` passes, all CSS contract assertions green.

### Phase 2: Label Thinning (P1 — FR-001)

**Goal**: Implement deterministic label thinning in throughput chart.

**Files**:
- `extension/ui/modules/charts/throughput.ts` — Add `MAX_VISIBLE_LABELS = 16`, compute `labelStep`, conditionally emit label text.

**Tests**:
- `extension/tests/modules/charts/throughput.test.ts` — Add test cases:
  - 16 bars → all labels visible
  - 17 bars → step=2, labels at even indices
  - 104 bars → step=7, labels at 0,7,14,...,98 (15 labels)
  - Verify `.bar-label` count equals barCount (elements always present)
  - Verify non-empty `.bar-label` count equals expected visible labels

**Verification**: `pnpm test` passes, label count assertions match contract table.

### Phase 3: Tooltip Tap/Click (P1 — FR-009)

**Goal**: Extend tooltip utility with tap/click support and scroll-cancellation.

**Files**:
- `extension/ui/modules/charts.ts` — Add `pointerdown`/`pointerup` handlers with distance calculation, document-level click-to-dismiss.
- `extension/ui/modules/charts/throughput.ts` — Add `data-tooltip` attribute to bars, call `addChartTooltips()`.

**Tests**:
- `extension/tests/modules/charts/tooltip.test.ts` — Simulate click events on data points, verify tooltip creation/dismissal.

**Verification**: `pnpm test` passes, tooltip lifecycle assertions match contract.

### Phase 4: Filter Hints & Truncation (P1/P2 — FR-003 through FR-007)

**Goal**: Style filter hint banners, add prominent truncation indicators, add truncation badges to predictions/sparklines.

**Files**:
- `extension/ui/dashboard.ts` — Add `.filter-hint-warning` class toggle for reviewer constrained notice.
- `extension/ui/modules/charts/predictions.ts` — Add truncation badge when data exceeds MAX_CHART_POINTS.
- `extension/ui/modules/ml.ts` — Add truncation badge for sparklines.
- `extension/ui/modules/shared/render.ts` — Update empty-state messages to include contextual hints.

**Tests**:
- `extension/tests/unit/ux-polish-rendering.test.ts` — Assert filter hint class, truncation badge presence, empty-state message content.

**Verification**: `pnpm test` passes, filter hints render with correct classes, truncation badges appear when expected.

### Phase 5: Mobile Responsiveness (P2 — FR-011 through FR-013)

**Goal**: Add 480px breakpoint, responsive typography, comparison banner stacking.

**Files**:
- `extension/ui/styles.css` — Add `@media (max-width: 480px)` block with: single-column summary cards, reduced typography, adjusted padding, toast positioning, comparison banner column layout. Add comparison banner rules to existing 768px breakpoint.

**Tests**:
- `extension/tests/unit/css-contract.test.ts` — Assert `@media (max-width: 480px)` block exists, contains `.summary-cards` rule.

**Verification**: Manual check at 375px width (no horizontal overflow). CSS contract test passes in CI.

### Phase 6: ARIA, Print, Animations (P2/P3 — FR-010, FR-019 through FR-021)

**Goal**: Add tab ARIA attributes, print stylesheet, refined tab animations.

**Files**:
- `extension/ui/index.html` — Add `role="tab"`, `aria-selected`, `aria-controls` to tab buttons.
- `extension/ui/styles.css` — Add `@media print` block (hide chrome, preserve context). Update `@keyframes fadeIn` duration to 0.25s.

**Tests**:
- `extension/tests/unit/css-contract.test.ts` — Assert `@media print` block exists with required hidden/preserved selectors.
- Existing mode-parity tests continue to pass (ARIA changes are in shared HTML).

**Verification**: Print preview shows clean output. `pnpm test` passes. `pytest tests/demo/ -v` passes (parity).

### Phase 7: Integration & Parity Verification

**Goal**: Verify all changes work together, parity is maintained, demo regeneration is byte-identical.

**Steps**:
1. `cd extension && pnpm build:ui` — rebuild shared bundle
2. `python -c "from ado_git_repo_insights.utils.ui_sync import sync_ui_bundle; sync_ui_bundle()"` — sync to CLI
3. `python scripts/build-demo-dataset.py` — verify byte-identical regeneration
4. `pytest tests/demo/ -v` — all parity tests pass
5. `python scripts/run_pr_preflight.py` — full preflight passes

**No new code** — this phase is verification only.

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| JSDOM can't test media queries | CSS contract tests read stylesheet as text; manual browser verification for layout |
| Touch target padding changes affect chart layout | Targeted padding increases with negative-margin compensation where needed |
| Tooltip scroll-cancellation is flaky on real devices | 10px threshold is generous; tested via simulated pointer events in JSDOM |
| Print styles accidentally hide analytical context | Explicit preserved-element list in contract; CSS contract test verifies both hidden and preserved selectors |
| Label thinning produces different results across surfaces | Algorithm is viewport-independent (fixed constant); parity tests verify identical HTML output |

## Dependencies

- **Existing**: `extension/ui/styles.css`, `extension/ui/modules/charts/throughput.ts`, `extension/ui/modules/charts.ts`
- **Build tools**: `pnpm build:ui` (esbuild IIFE bundler), `ui_sync.py` (content-addressed sync)
- **Test tools**: Jest + JSDOM (existing), dom-harness.ts (existing)
- **Parity tools**: `build-demo-dataset.py`, `tests/demo/test_demo_parity_pipeline.py` (existing)
- **No new dependencies** introduced.
