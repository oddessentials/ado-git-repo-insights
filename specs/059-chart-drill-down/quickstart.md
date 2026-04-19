# Quickstart — Chart drill-down Phase 1 implementation walkthrough

**Branch**: `059-chart-drill-down`
**Audience**: future `/speckit.tasks` consumer; engineer picking up the work after planning
**Purpose**: translate `plan.md` + `contracts/*` into an ordered implementation walk so tasks can be generated cleanly.

This is an implementation-ordering document, not a replacement for the contracts. Contracts are authoritative for API shape and behavior.

---

## Prerequisites

- `git checkout 059-chart-drill-down`
- `cd extension && pnpm install`
- Familiarity with:
  - `extension/ui/modules/tooltip-manager.ts` (overlay lifecycle reference)
  - `extension/ui/modules/typeahead-dropdown.ts` (AbortController + a11y reference)
  - `extension/tests/parity/render-equivalence.test.ts` (parity-test shape)

Read once before starting:

- `spec.md` — FRs and SCs you'll be coding against.
- `research.md` — five design decisions that close every "why this way?" question.
- `data-model.md` — `PanelContent`, `PanelSection`, `DrillDownContext` shapes.
- `contracts/detail-panel-api.md` — the public TS contract.
- `contracts/drilldown-integration.md` — per-chart wiring rules.
- `contracts/lifecycle-signals.md` — event publish/subscribe rules.

---

## Implementation order

Each step below is scoped to a single focused commit. Same-commit `.test-floor-contract.json` bump is mandatory for any step that adds Jest cases (QG-43).

### Step 1 — Lifecycle signals

1. Create `extension/ui/modules/drilldown/lifecycle-signals.ts` per `contracts/lifecycle-signals.md`:
   - Three event-name constants, three detail interfaces, three `publish*` helpers, three `subscribe*` helpers.
   - Zero runtime dependencies.
2. Add emit sites in `extension/ui/dashboard.ts`:
   - Top of `refreshMetrics()` → `publishFiltersChanged`.
   - Inside `switchTab(tabId)` (after state mutation, before DOM work) → `publishTabChanged`.
   - Inside `toggleComparisonMode()` and `exitComparisonMode()` → `publishComparisonToggled`.
3. Create `extension/tests/modules/drilldown/lifecycle-signals.test.ts`:
   - Emit / subscribe / abort round-trips.
   - Static grep-style test asserting `publish*` is called only from `dashboard.ts`.
4. Bump `.test-floor-contract.json` `extension.min_collected` by the exact number of cases added.

Deliverable: dashboard now emits three typed signals; nothing consumes them yet.

---

### Step 2 — Shared focus trap

1. Create `extension/ui/modules/shared/focus-trap.ts` per `research.md` R-03:
   - `trapFocus(root: HTMLElement): AbortController`.
   - Records previously-focused element; cycles Tab/Shift-Tab within `root`.
   - Standard focusable-element selector.
2. Export from `extension/ui/modules/shared/index.ts`.
3. Create `extension/tests/modules/shared/focus-trap.test.ts`:
   - Cycles forward / backward correctly with three mock focusable elements.
   - `abort()` restores original `document.activeElement`.
   - Non-focusable elements inside root are skipped.
4. Bump floor.

Deliverable: a reusable focus-trap primitive, unrelated to any specific overlay.

---

### Step 3 — DetailPanel core

1. Add `SPARKLINE_HIGHLIGHT_MS = 1500` and `COMPARISON_ADVISORY_TOAST_MS = 4000` to `extension/ui/modules/shared/constants.ts` (both are short, intentional numbers — no magic values).
2. Create `extension/ui/modules/shared/detail-panel.ts` per `contracts/detail-panel-api.md`:
   - All exported types (`PanelContent`, `PanelSection` union, `PanelRow`, `PanelStat`, `DrillDownContext`, `DismissReason`).
   - Construction helpers (`makePanelContent`, `makeBreakdownTable`, `makeStatRow`, `makeEmptyState`) with runtime validation.
   - Lifecycle functions (`openDetailPanel`, `dismissDetailPanel`, `isDetailPanelOpen`).
   - Internal state machine per `data-model.md` §5a.
   - Subscribes to lifecycle signals on open; unsubscribes on dismiss.
   - Uses `focus-trap.ts` on open; restores focus on dismiss.
   - Idempotent DOM construction — re-opening with identical `DrillDownContext` produces identical DOM.
3. Add CSS to `extension/ui/styles.css`:
   - `.detail-panel` + `.detail-panel.is-open` (transform transition).
   - Section-type classes (`detail-panel-section--breakdown-table`, `--stat-row`, `--empty-state`).
   - `prefers-reduced-motion` override.
4. Export from `extension/ui/modules/shared/index.ts`.
5. Create `extension/tests/modules/shared/detail-panel.test.ts`:
   - Construction helpers validate invariants.
   - Open / dismiss for each `DismissReason`.
   - Filter-changed hard-dismiss: no DOM work on panel between event and CLOSING.
   - Retarget in place when opening with a new context while already open (no close→reopen flicker).
   - Throws when comparison mode is active.
6. Extend `extension/tests/parity/render-equivalence.test.ts` (Layer A starts line 104):
   - For each of `throughput`, `cycle-time`, `reviewer` sample contexts, assert two hosts rendering the same context produce identical panel `innerHTML`.
7. Bump floor.

Deliverable: DetailPanel works in isolation; parity test confirms idempotency.

---

### Step 4 — Comparison-mode advisory

1. Create `extension/ui/modules/drilldown/comparison-advisory.ts` per `research.md` R-05:
   - Subscribes to `COMPARISON_TOGGLED_EVENT` at module load.
   - On enabled=true: mounts banner note, sets `data-drilldown-disabled="comparison"` on `#throughput-chart`, `#cycle-time-trend`, `#reviewer-activity`, and `.summary-cards`, dismisses any open panel with reason `comparison-toggled`.
   - On enabled=false: unmounts banner note, clears attributes.
   - Exports `isDrilldownDisabledByComparison(): boolean` and `showComparisonAdvisoryToast(target: HTMLElement): void`. Toast auto-dismisses after `COMPARISON_ADVISORY_TOAST_MS` (imported from `shared/constants.ts`).
2. Add CSS rules for:
   - `[data-drilldown-disabled="comparison"]` subdued affordance on chart click targets.
   - `.comparison-advisory-banner` in the existing comparison banner region.
   - `.comparison-advisory-toast` ephemeral element with auto-dismiss animation.
3. Import + initialize the module from `extension/ui/dashboard.ts` at dashboard boot.
4. Create `extension/tests/modules/drilldown/comparison-advisory.test.ts`:
   - Enable event mounts banner, disables targets, dismisses open panel.
   - Disable event reverses all three.
   - Toast auto-dismisses; a new click replaces an in-flight toast.
5. Bump floor.

Deliverable: comparison-mode state now fully observable via drill-down surface; panel automatically dismissed on enable.

---

### Step 5 — Sparkline navigator (simplest consumer)

1. Modify `extension/ui/modules/charts/summary-cards.ts`:
   - Wrap each sparkline SVG in a `<button type="button" class="sparkline-trigger" data-drilldown-target-chart="…" aria-label="…">`.
   - No behavior change beyond markup.
2. Create `extension/ui/modules/drilldown/sparkline-navigator.ts`:
   - `installSparklineNavigator(container)` per `contracts/drilldown-integration.md`.
   - Click / keyboard-activation handler resolves `data-drilldown-target-chart`, scrolls the target chart into view, applies short-lived highlight class, removes class via `setTimeout`.
   - Missing target → inline advisory via `renderNoData` helper; no scroll.
3. Add highlight CSS (`.is-sparkline-highlight`) + `prefers-reduced-motion` override.
4. Wire `installSparklineNavigator` into `dashboard.ts` `refreshMetrics()` lifecycle (install after charts render, dispose before re-render).
5. Create `extension/tests/modules/drilldown/sparkline-navigator.test.ts` per contract.
6. Bump floor.

Deliverable: Story 4 (P4) shipped. Proof of wiring on the cheapest consumer.

---

### Step 6 — Throughput drill-down (P1 user story)

1. Modify `extension/ui/modules/charts/throughput.ts`:
   - Publish `data-drilldown-week` on each `.bar-container` element.
   - Add `tabindex="0"` and `role="button"` for keyboard focus.
2. Create `extension/ui/modules/drilldown/throughput-drilldown.ts`:
   - `installThroughputDrilldown(container, rollups)` per contract.
   - Builds `DrillDownContext` with `sourceChart: "throughput"`.
   - Title: human-readable date range. Subtitle: PR count.
   - Sections: one `BreakdownTableSection` for `by_author`, one for `by_repository`; empty-state substitution when aggregates empty.
3. Wire into `dashboard.ts` `refreshMetrics()` lifecycle immediately after the render block at dashboard.ts:970-974 (dispose any prior handle at the start of the cycle, install after renders complete).
4. Create `extension/tests/modules/drilldown/throughput-drilldown.test.ts` per contract.
5. Extend `extension/tests/parity/prod-shape-edge-cases.test.ts` with an empty-breakdown throughput week.
6. Bump floor.

Deliverable: Story 1 (P1) shipped — "explain a throughput spike" works.

---

### Step 7 — Cycle-time trend drill-down (P2)

1. Modify `extension/ui/modules/charts/cycle-time.ts`:
   - Publish `data-drilldown-week` and `data-drilldown-metric` on `.line-chart-dot` elements.
   - `tabindex="0"` + `role="button"`.
2. Create `extension/ui/modules/drilldown/cycle-time-drilldown.ts`:
   - Per contract; distinguishes P50 vs P90 via `data-drilldown-metric` (lowercase on the drilldown attribute, orthogonal to existing `data-metric` with uppercase `P50`/`P90`).
   - Human-readable duration formatting via `formatDuration(minutes)` from `extension/ui/modules/shared/format.ts` (verified available at lines 11-21; no fallback needed).
   - Per-repository breakdown via `by_repository`.
3. Wire + test.
4. Bump floor.

Deliverable: Story 2 (P2) shipped.

---

### Step 8 — Reviewer drill-down (P3)

1. Modify `extension/ui/modules/charts/reviewer-activity.ts`:
   - Publish `data-drilldown-reviewer-id` on `.h-bar-row`.
   - `tabindex="0"` + `role="button"`.
2. Same-edit addition in `extension/ui/modules/charts/reviewer-activity.ts`: change the function declaration at line 34 from `function computeApprovalRate(` to `export function computeApprovalRate(` — this makes the existing internal helper reusable by `reviewer-drilldown.ts` without duplication.
3. Create `extension/ui/modules/drilldown/reviewer-drilldown.ts`:
   - Per contract; imports newly-exported `computeApprovalRate` from `charts/reviewer-activity.ts`.
   - Sections: a `StatRowSection` (total reviews_count sum, total reviewed_prs sum, weighted approval_rate from `computeApprovalRate` with empty-state when not computable, peak `repositories_count` with qualifying week label); a `BreakdownTableSection` with columns `Week` / `Reviews` / `PRs reviewed` / `Approval rate` populated from iterating `by_reviewer[reviewerId]` across rollups in the active period.
   - No per-repository breakdown — deferred to #300 per the Pass-3/4 data-availability resolution captured in `data-model.md`.
4. Wire into `dashboard.ts` `refreshMetrics()` after the render block at dashboard.ts:970-974.
5. Create `extension/tests/modules/drilldown/reviewer-drilldown.test.ts` per contract.
6. Bump floor.

Deliverable: Story 3 (P3) shipped.

---

### Step 9 — Cross-cutting cleanup + full gate run

1. Review `extension/tests/parity/render-equivalence.test.ts` and `extension/tests/parity/prod-shape-edge-cases.test.ts` — confirm all new surfaces have parity + edge coverage.
2. Audit `.coverage-partial-branches-baseline.json` — if partial-branch counts shifted on any `extension/ui/**/*.ts` file, co-change the baseline in this commit. Respect `LOCKED_ZERO_FILES`.
3. Run `pnpm --dir extension run test:ci` locally until green.
4. Run `python scripts/run_repo_hook.py pre-push` locally until green (DO NOT `git push` until user authorizes).
5. Self-review the full diff end-to-end against the spec FRs and SCs before requesting review.

Deliverable: feature complete and ready for PR once push is authorized.

---

## Gate discipline summary

- Every commit that adds Jest cases MUST bump `.test-floor-contract.json` `extension.min_collected` by the exact new-case count in the same commit (QG-43).
- Every commit that shifts partial-branch counts MUST co-change `.coverage-partial-branches-baseline.json` in the same commit.
- No `--no-verify`, no `[version-override-acknowledged]` marker (nothing in Phase 1 bumps supported-version constants).
- Cross-OS: all code uses browser DOM only; no `os.*` / path handling.
- No `// eslint-disable`, no `// @ts-ignore`, no `any` types anywhere in new code.

## Exit criteria

All spec SCs met, all FRs implemented, `pnpm --dir extension run test:ci` green, `python scripts/run_repo_hook.py pre-push` green, no drift in any quality-floor artifact that isn't accompanied by its baseline bump in the same commit.
