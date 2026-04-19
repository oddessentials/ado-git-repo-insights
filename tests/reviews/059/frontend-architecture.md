# Frontend Architecture Review — PR #302 (`059-us1-throughput`)

**Reviewer lens:** 4-entry-point parity, module shape, lifecycle correctness, observer hygiene, import topology.
**Scope:** 6 commits ahead of `main` (b432255c, 82b92a89, 5c2eaf4f, 007ac77f, 33c44b23, 0dd9b47c).
**Verdict:** **Approve with one P1 + two P2 fixes.** Architecture is solid. Module boundaries are clean. Parity is intact and CI-enforced. The one P1 is a real-world rendering hazard (stale-cycle bail leaves drill-down dead until next successful refresh).

---

## TL;DR

| Severity | Count |
| -------- | ----: |
| P1       | 1     |
| P2       | 2     |
| P3       | 3     |

---

## 4-Way UI-Bundle Sync — VERIFIED CLEAN

I confirmed parity across all four byte-identical surfaces:

| Pair                                                          | Status |
| ------------------------------------------------------------- | ------ |
| `extension/ui/styles.css` ↔ `extension/dist/ui/styles.css`    | MATCH  |
| `extension/dist/ui/dashboard.js` ↔ `docs/dashboard.js`        | MATCH  |
| `extension/dist/ui/dashboard.js` ↔ `src/.../ui_bundle/...`    | MATCH  |
| `extension/dist/ui/styles.css` ↔ `docs/styles.css`            | MATCH  |
| `extension/dist/ui/styles.css` ↔ `src/.../ui_bundle/...`      | MATCH  |

`extension/dist/ui/` is gitignored; the Husky `pre-commit` chain calls `scripts/run_repo_hook.py` → `scripts/manage_generated_artifacts.py` → `scripts/sync_ui_bundle.py`, which writes the three tracked surfaces (`docs/`, `src/.../ui_bundle/`, `extension/tests/fixtures/broken-docs/`) from `extension/dist/ui/`. **Per-commit `git show --stat` confirms every commit synced docs + ui_bundle + broken-docs together** — including `b432255c` (US1 +509 lines × 3 files), `5c2eaf4f` (US2 +145 × 3), `007ac77f` (US3 +167 × 3), `33c44b23` (US4 +128 × 3 plus +77 styles × 3), and the title-format fix `82b92a89` (+36 × 3).

**No parity drift.** The hook chain is doing its job.

---

## PARITY_CONSTRAINTS Re-Verification

Re-read `C:\Users\petep\.claude\projects\E--projects-ado-git-repo-insights\memory\PARITY_CONSTRAINTS.md`. The "4 entry points" listed there (`dashboard.ts` / `settings.ts` / `dataset-loader.ts` / `artifact-client.ts`) refers to load/render entry points, with `render-equivalence.test.ts` enforcing **same data → same DOM** across containers. Drill-down is dashboard-only — settings, dataset-loader, and artifact-client are not chart-rendering surfaces:

- `extension/ui/settings.ts` — settings panel; no chart renderers imported.
- `extension/ui/dataset-loader.ts` — pure data layer; only updated to widen `Rollup` interface with optional `start_date?` / `end_date?` (consumers ignore unrecognized fields harmlessly).
- `extension/ui/artifact-client.ts` — SDK adapter; unchanged in this PR.

**Implication for parity:** because the Rollup interface widened on the loader side, ANY consumer that loads rollups now sees the new fields populate when present. `render-equivalence.test.ts` was extended in this PR (`prod-shape-edge-cases.test.ts` — drill-down prod-shape edges section, lines 327–423) to lock the panel rendering against degraded rollups. **Parity remains hard-enforced. No regression observed.**

---

## P1 — Stale-cycle bail leaves drill-down dead until next refresh

**Severity:** P1 (must fix before merge — silent UX regression)
**Location:** `extension/ui/dashboard.ts:929-930` (dispose) vs `971-973` / `998-1000` (stale-cycle bails)

`refreshMetrics` disposes ALL active drill-down handles unconditionally at line 929-930, immediately after `publishFiltersChanged` (line 922):

```ts
for (const handle of activeDrilldownHandles) handle.dispose();
activeDrilldownHandles = [];
```

Then proceeds to load data. If the stale-cycle bails at line 971-973 OR line 998-1000 fire (a newer refresh superseded this one), the function returns early **without re-installing handles, and without rendering**. The previous chart DOM is still on screen — but its drill-down listeners have already been torn down via `controller.abort()`.

**User-visible effect:** charts render correctly (from the prior cycle), but clicking on bars/dots/rows is silently dead until a successful refresh completes. In the typical "user clicks too fast" case, the new winning cycle re-installs handles, so the dead window is short. But if the winning cycle then errors (e.g. network blip during `getWeeklyRollups`), the catch block on line 1054-1057 calls `failRefresh` — and again no re-install happens. **The dashboard now displays interactive-looking charts that don't respond.**

This contradicts the comment on line 924-928 ("DetailPanel's own filters-changed subscriber dismisses any open panel in the same synchronous tick, so the panel is closed before we tear down the listeners") — which is true for the panel state, but says nothing about the charts losing interactivity.

**Recommended fix (one of):**

1. **Defer dispose until just before the render block.** Move the dispose loop from line 929-930 to immediately before the render block at line 1002 (after the second `isStale` guard at line 998-1000). Either both happen or neither does. The trade-off: filters-changed triggers DetailPanel hard-dismiss before the chart DOM is replaced — and in the deferred-dispose model, the panel would still be open while we're still loading. But DetailPanel's `dismissDetailPanel("filters-changed")` runs from the `publishFiltersChanged` window-event subscriber, not from the dispose loop, so the panel close is independent of when chart listeners get torn down.
2. **Re-install handles in the stale/error paths.** Less elegant — duplicates the install block. Not recommended.

I'd take option 1.

A regression test should drive this: queue one refresh that resolves slowly, fire a second that resolves quickly, await the second; the first should bail; then attempt to click a bar/dot — the click should still open the panel.

---

## P2 — `comparison-advisory.ts` sets `data-drilldown-disabled` on stale chart containers

**Severity:** P2 (functional but inconsistent with comment)
**Location:** `extension/ui/modules/drilldown/comparison-advisory.ts:128-137, 160-167`

`getChartContainers()` does `document.getElementById(...)` and `document.querySelector(...)` at the moment a `comparison-toggled` event fires. Since these container elements live in `index.html` and aren't recreated between renders, the calls work — but the design relies on a non-obvious invariant ("chart containers are dashboard-lifetime, not refresh-lifetime"). This is correct today, but a future refactor that moves chart rendering into a tab-switch destroy/recreate pattern would silently break the comparison-mode disable affordance.

**Recommended fix:** Add a comment in `comparison-advisory.ts:128` explaining the lifetime assumption ("CHART_CONTAINER_IDS are stable index.html elements; they survive across `refreshMetrics` cycles. If chart rendering ever moves to dynamic mount/unmount, this lookup needs to re-run on every render or move into the install handle").

---

## P2 — `wrapSparklineTrigger` correctness depends on undocumented `clearElement` invariant

**Severity:** P2 (correctness depends on invariant in another module — needs an enforceable guard)
**Location:** `extension/ui/modules/charts/summary-cards.ts:454-471`, `extension/ui/modules/charts.ts:76-134` (`renderSparkline`)

The comment on `wrapSparklineTrigger` (lines 453-457) says: "Re-renders are safe: `renderSparkline` above calls `clearElement` before writing a new SVG, so every call reaches a fresh container with no pre-existing button wrapper."

Two issues:

1. The actual mechanism is more subtle than the comment suggests. `renderSparkline` calls `renderTrustedHtml` (`extension/ui/modules/shared/render.ts:121`), which sets `container.innerHTML = trustedHtml`. **`innerHTML` re-assignment wipes children including the wrapping `<button class="sparkline-trigger">`.** The svg inside the button is also wiped. So on each render: the button + svg disappear, `renderSparklines` re-creates the svg, then `wrapSparklineTrigger` wraps it again.
2. There is no test asserting the invariant. If a future change makes `renderSparkline` skip the `innerHTML` assignment in some branch (e.g. early-return on identical data), `wrapSparklineTrigger` would double-wrap, putting the button inside the previous render's button.

**Recommended fix:** Add a Jest assertion in `extension/tests/modules/charts/summary-cards.test.ts` (or an existing summary-cards test) that calls `renderSummaryCards` twice in a row with the same containers and asserts `container.querySelectorAll('button.sparkline-trigger').length === 1` after each call.

---

## P3 — `week-range.ts` lives in `drilldown/` but only does pure date math

**Severity:** P3 (placement nit, doesn't ship as wrong)
**Location:** `extension/ui/modules/drilldown/week-range.ts`

The module is pure date math (`parseIsoLocalDate`, `isoWeekRange`, `formatWeekRangeTitle`, `formatWeekTitle`). Only the last function takes a `Rollup`; the first three operate on primitives. There's a strong case for moving the date primitives to `shared/format.ts` (alongside `formatWeekLabel`, `formatDate`, `formatDateRange`) and leaving only `formatWeekTitle(rollup: Rollup)` in `drilldown/`. Today only the two drill-down consumers import it (`throughput-drilldown.ts:45`, `cycle-time-drilldown.ts:48`), so the placement is defensible. But: the moment `summary-cards.ts` or any chart wants the same condensed range string in a tooltip / sparkline label, the import will cross the abstraction backwards (charts → drilldown). **No fix required for this PR — flag as future cleanup.**

---

## P3 — Five distinct `MutationObserver` install-and-dispose patterns

**Severity:** P3 (DRY nit)
**Location:** `throughput-drilldown.ts:114-126`, `cycle-time-drilldown.ts:121-133`, `reviewer-drilldown.ts:162-174`

All three drill-down installs duplicate the same `registerPanelObserver()` body. A shared helper would shrink each module by ~13 lines and lock the `attributeFilter: ["class"]` invariant in one place. **Defer to a follow-up.** Not worth blocking this PR.

---

## P3 — `comparison-advisory.ts` listener leaks across dashboard re-init

**Severity:** P3 (production has one dashboard per page — not exercised; tests acknowledge it via `__resetComparisonAdvisoryForTests`)
**Location:** `extension/ui/modules/drilldown/comparison-advisory.ts:191`

The module-load `window.addEventListener(COMPARISON_TOGGLED_EVENT, comparisonListener)` has no controller and no `dispose()`. The comment on lines 18-21 acknowledges this ("This module lives for the dashboard lifetime and must not leak listeners across dashboard re-inits"). Production is a single-dashboard-per-page model so this is fine. Tests reset internal state via `__resetComparisonAdvisoryForTests()`. The hazard is that any future hot-module-replacement or in-page dashboard remount would multiply listeners. **Acceptable as-is. Document the constraint somewhere a future refactor can find it (e.g. a brief CONTRIBUTING note for dashboard module lifetime).**

---

## Lifecycle / Observer Hygiene — Detailed Findings

### `dispose()` correctness

Each per-chart install returns `{ dispose() }` that:

- aborts the `AbortController` (kills delegated listeners + lifecycle subscribers via `signal`),
- iterates `observers` set and disconnects each `MutationObserver`,
- clears the active-trigger highlight class,
- (sparkline only) clears highlight timers via `clearTimeout`.

This is symmetric and correct. **No leaks across `refreshMetrics` cycles** (modulo the P1 above, which is about WHEN dispose runs vs when re-install runs — not about leaking).

### MutationObserver registration in panel-open path

`registerPanelObserver()` is called inside `activate(trigger)`, AFTER `openDetailPanel()`. Each open creates a new observer; the observer self-disconnects when the panel loses `is-open`. The observer is also registered into `observers` Set and disconnected on `dispose()`. **Correct — no leak path.**

One subtle concern: if a user activates a trigger, the panel opens, then activates a SECOND trigger before the first observer fires (i.e. `openDetailPanel` is called twice while `is-open` is set), `registerPanelObserver()` runs again — adding a second observer to the Set. Both will fire on close, but each is a no-op for the second invocation (observer is already disconnected by the first; `clearActive()` on the second is also idempotent). No bug, but slightly wasteful. Could be optimized by checking `observers.size > 0` before registering. **P3, not worth blocking.**

### `activeDrilldownHandles[]` ordering relative to lifecycle signals

The dispose-then-publish-then-install ordering matches the comment block on dashboard.ts:918-922 (publish first so DetailPanel hard-dismisses synchronously before chart DOM gets replaced). This is correct. The P1 above is purely about the bail paths in between.

---

## Module Boundaries

- `drilldown/` correctly imports from `shared/`, `charts/` (one-way: drilldown → charts via `computeApprovalRate`), `tooltip-manager`. **No cycles.** I grepped `charts/` and `charts.ts` for any drilldown imports — none exist.
- `drilldown/index.ts` is a clean barrel re-export, consumed by `modules/index.ts:66` (`export * from "./drilldown"`).
- `dashboard.ts` is the **sole publisher** of `publishFiltersChanged` / `publishTabChanged` / `publishComparisonToggled`. Confirmed by grep against `settings.ts`, `dataset-loader.ts`, `artifact-client.ts` — zero matches. The lifecycle-signals contract is not bypassed.

---

## Smaller Notes

- **`renderReviewerActivity` filters threading:** confirmed `dashboard.ts:1303` passes `filters: currentFilters` to the module, and the module conditionally adds drill-down attributes only when `filters?.reviewers?.[0]` is set (`reviewer-activity.ts:172-174`). Reviewer drill-down attributes are correctly conditional on a reviewer filter being active — matches load-bearing decision #4 in the project memory.
- **`computeApprovalRate` was widened from private to exported** (`reviewer-activity.ts:34`) so `reviewer-drilldown.ts:37` can compute the same value the chart shows. Single source of truth — good.
- **`pointerup` `preventDefault` removal** (`charts.ts:254-264`) is contract-correct per memory load-bearing decision #1; the new test in `tooltip.test.ts` (per the diff stat: +29 lines) locks `pointerUp.defaultPrevented === false`. This unblocks touch-tap drill-down activation and the existing document-level dismiss listener already short-circuits inside `[data-tooltip]`.
- **No new third-party dependencies** introduced.
- **Test floor bumped 2423 → 2528** (+105) per `.test-floor-contract.json`. The 105 figure aligns with the four new test files (`throughput-drilldown.test.ts` 673 lines, `cycle-time-drilldown.test.ts` 623, `reviewer-drilldown.test.ts` 668, `sparkline-navigator.test.ts` 436, plus 29 in `tooltip.test.ts` and 96 in `prod-shape-edge-cases.test.ts`). I did not re-execute the suite — assume this is enforced.
- **Partial-branches baseline 318 = 318 (32 files)** per memory. Each new drill-down module baselined at 2 defensive residuals (target-not-Element + panel-null after openDetailPanel). Both are unreachable from jsdom — the documented justification holds.

---

## Architecture Verdict

- **Module shape:** clean. Per-chart consumers are self-contained, share via `shared/detail-panel.ts` + `shared/format.ts` + new `drilldown/week-range.ts`. No god-modules, no circular dependencies.
- **DetailPanel is the sole drawer.** Confirmed — all three of throughput/cycle-time/reviewer call `openDetailPanel`. Sparkline is the deliberate exception (it scrolls + highlights; explicitly NOT drawer-based).
- **Lifecycle signals:** publishing topology is single-publisher (dashboard) / many-subscriber. Subscriber teardown is via `AbortController`. Standard pattern, well-applied.
- **Parity:** all 4 surfaces sync via hooks; render-equivalence + prod-shape-edge-cases tests extended to lock new behavior.

**Recommendation:** Block on P1. The two P2s are quick fixes (a comment + a regression test). Once the P1 is addressed and verified with a regression test, this is mergeable.
