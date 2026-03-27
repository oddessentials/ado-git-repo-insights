# Research: Metrics Dashboard UX Improvements

**Feature**: 041-metrics-dashboard-ux
**Date**: 2026-03-27
**Status**: Complete (all unknowns resolved)

## Research Summary

All technical unknowns were resolved through codebase investigation using four parallel research agents. No NEEDS CLARIFICATION markers remain.

---

## R-01: Tooltip Coordinate System and Positioning

**Decision**: Use `position: fixed` with `getBoundingClientRect()` coordinates, add viewport boundary detection.

**Rationale**: `getBoundingClientRect()` returns viewport-relative coordinates within the webview iframe. The current bug uses `position: absolute` which positions relative to the nearest positioned ancestor (document root), causing misalignment when scrolled. `position: fixed` uses the same viewport coordinate space as `getBoundingClientRect()`, making them compatible at any scroll position.

**Alternatives considered**:
- `position: absolute` with `window.scrollX/Y` offset: Works but fragile if DOM structure changes. Mixes coordinate systems.
- Append tooltip to chart container instead of `document.body`: Would fix scroll issue but introduces clipping within chart bounds and requires per-chart overflow handling.

**Evidence**: `extension/ui/modules/charts.ts` lines 211-225 (showTooltip), `extension/ui/styles.css` lines 996-1007 (.chart-tooltip). No nested scroll containers exist (confirmed: only `document.body` scrolls, `.bar-chart` has horizontal overflow only).

---

## R-02: Tooltip Lifecycle and Race Conditions

**Decision**: Maintain existing synchronous dismiss-before-create pattern. Enforce as tested invariant. No debounce needed.

**Rationale**: The single-threaded JS event loop serializes all hover events. `showTooltip()` synchronously calls `dismissActiveTooltip()` (DOM removal) before creating the new tooltip. Only one `.chart-tooltip` element can exist at any time. Per-container `AbortController` prevents listener accumulation on re-render.

**Alternatives considered**:
- Add debounce on mouseenter: Unnecessary since events are serialized. Would add latency to tooltip display (bad UX).
- Formal state machine class: Over-engineering for synchronous code. Tested invariant provides equivalent protection.

**Evidence**: `charts.ts` lines 126-264. `dismissActiveTooltip()` at line 140. `AbortController` per container at lines 126-135. No async operations in tooltip lifecycle.

---

## R-03: Filter URL Serialization Contract

**Decision**: Lock to canonical format: comma delimiter, `encodeURIComponent()` encoding, sorted multi-select values, empty selection deletes parameter. Require round-trip tests.

**Rationale**: The existing contract uses comma-separated values with no ordering guarantee. Adding sorted serialization ensures deterministic URLs for bookmarking while remaining backward-compatible (deserialization accepts any order). `encodeURIComponent()` is the standard for URL-safe encoding.

**Alternatives considered**:
- Pipe (`|`) delimiter: Non-standard, breaks existing bookmarked URLs.
- JSON-encoded arrays: Over-complex for URL parameters, poor readability.
- No ordering change: Leaves non-deterministic URLs which can cause confusion in bookmarks and sharing.

**Evidence**: `extension/ui/modules/filters.ts` lines 44-104. Parameter names: `repos`, `teams`, `reviewers`, `author`. Deserialization at `dashboard.ts` lines 1742-1846 validates against current dimensions.

---

## R-04: Multi-Select "All Selected = No Filter" Normalization

**Decision**: Normalize at state layer, immediately after UI read, before any downstream consumer. Compare selected set against available options; if equal, emit empty array.

**Rationale**: Currently, selecting all individual options still applies filtering logic (different from selecting "All"). This creates a semantic gap. Normalizing at the state layer (single trigger point) before constraint resolution, data queries, and URL serialization ensures all consumers see consistent state.

**Alternatives considered**:
- Normalize in each consumer: Fragile, risk of divergence.
- Normalize in URL serialization only: Leaves data queries seeing different state than URLs.
- Don't normalize (keep existing behavior): Creates user confusion — "why does selecting everything not show everything?"

**Evidence**: `dashboard.ts` lines 1462-1466 (selectedOptions extraction). `metrics.ts` line 380-387 (empty array = unfiltered fast path). No existing normalization for all-selected case.

---

## R-05: Filter Constraint Logic Centralization

**Decision**: Extract a single `resolveFilterConstraints()` function as the sole authority. All consumers (UI, metrics, URL) must call it exclusively.

**Rationale**: Constraints are currently split: UI layer (`dashboard.ts` `applyAuthorFilterCompatibility()` / `applyReviewerFilterCompatibility()`) actively enforces, data layer (`metrics.ts` `applyFiltersToRollups()`) only warns. The Reviewer+Repo constraint is asymmetric (UI allows it, data silently ignores repo). Consolidation eliminates divergence risk.

**Alternatives considered**:
- Keep split logic with shared constants: Still allows behavioral divergence.
- Enforce only at data layer: UI state would lag, showing invalid filter combinations.
- Enforce only at UI layer: Data layer could process invalid combinations if called without UI.

**Evidence**: `dashboard.ts` lines 1383-1449 (UI constraints). `metrics.ts` lines 461-466, 529-532, 577-579, 598-602 (data warnings). Constraint rules: Author+Team → author-only; Reviewer+Team → clear team; Reviewer+Repo → reviewer-only (repo retained in UI but ignored in data).

---

## R-06: Typeahead Performance Bounds

**Decision**: Custom component replacing HTML5 `<datalist>`. Require 150-300ms debounce on input, virtualized rendering above 200 items. Testable thresholds: 100ms/200 items, 200ms/1000 items.

**Rationale**: Current Author filter uses native `<datalist>` which handles filtering efficiently but is inconsistent across browsers and doesn't support multi-select chips. A custom component must replicate the performance characteristics. Browser-native datalist handles ~1000-5000 options; custom implementation needs explicit optimizations.

**Alternatives considered**:
- Use `<datalist>` for all filters: Doesn't support multi-select chips, inconsistent browser rendering.
- Use a third-party library (e.g., Choices.js, Tom Select): Adds dependency, increases bundle size, may conflict with extension sandbox.
- No debounce (immediate filter): Works for small sets but locks UI with large sets.

**Evidence**: `index.html` line 128 (Author datalist). `dashboard.ts` lines 1286-1307 (Author population). No debouncing, no virtualization, no pagination in current implementation.

---

## R-07: Empty State Evaluation Hierarchy

**Decision**: Strict short-circuit evaluation: (a) not-extracted → (b) filter-caused → (c) minimum-data → (d) date-range-empty. First match terminates.

**Rationale**: Current logic checks: null container → empty rollups → threshold → zero aggregate — with no filter awareness. The hierarchy prioritizes the most actionable information: if data wasn't extracted, telling users to "adjust filters" is misleading. Filter-caused empty is more actionable than minimum-data, which is more actionable than generic "no data."

**Alternatives considered**:
- Show all applicable conditions: Clutters the message, confuses users.
- Filter-first evaluation: Misleads when data genuinely wasn't extracted (user would remove filters fruitlessly).
- Chart-specific custom logic per module: Current approach, leads to inconsistent messaging.

**Evidence**: Chart empty state calls: `throughput.ts` lines 42-49, `cycle-time.ts` lines 38-45/102-109/124-131, `reviewer-activity.ts` lines 58-67/76-85. `render.ts` lines 17-24 (NO_DATA_HINTS). `reviewer-activity.ts` lines 22-31 (getReviewerNoDataHint — partial filter awareness, only chart with it).

---

## R-08: Data Availability Signals

**Decision**: Use null-vs-empty distinction on breakdown fields plus manifest capability flags. Enforce via type guard at data loading boundary.

**Rationale**: The data model already distinguishes `null` (not extracted) from `{}` (extracted but empty) via `ROLLUP_FIELD_DEFAULTS`. Manifest provides `capabilities.reviewer_repository_mode` and `comments.status`. These signals exist but are unused in empty state logic. A type guard at `normalizeRollup()` prevents upstream changes from breaking the distinction.

**Alternatives considered**:
- Add explicit `data_available: boolean` flags to rollups: Redundant with existing null semantics. Requires schema change.
- Infer from result set only: Can't distinguish "filtered to zero" from "never extracted."
- Trust upstream unconditionally: Fragile — a library update could change `null` to `undefined`.

**Evidence**: `dataset-loader.ts` lines 136-156 (ROLLUP_FIELD_DEFAULTS, null defaults). `types.ts` lines 104-199 (ManifestSchema with capabilities). `types.ts` lines 368-376 (DatasetCapabilityState).

---

## R-09: Info Icon vs Chart Tooltip Isolation

**Decision**: Separate CSS namespace (`.info-tooltip`), shared dismiss-all function, explicit z-index layering (info > chart < toast). Info takes priority.

**Rationale**: Current info icons in `predictions.ts` are static HTML (no dynamic tooltip). Adding dynamic info tooltips creates a potential collision with chart tooltip dismissal listeners (which target `[data-tooltip]` and `.chart-tooltip`). Distinct namespaces ensure dismissal logic doesn't cross-contaminate. A shared dismiss function enforces mutual exclusivity.

**Alternatives considered**:
- Reuse chart tooltip system with a mode flag: Couples the systems, making independent changes risky.
- Use browser-native `title` attribute: No styling control, inconsistent across browsers, can't contain rich content.
- Use a third-party tooltip library: Adds dependency, increases bundle.

**Evidence**: `charts.ts` lines 149-162 (dismiss listener targeting `[data-tooltip]`, `.chart-tooltip`). `styles.css` lines 996-1007 (`.chart-tooltip` z-index: 100). `styles.css` line 487 (`.toast` z-index: 1000). `predictions.ts` lines 546-551 (static `.metric-unavailable` info icon).

---

## R-10: Parity Enforcement for New Components

**Decision**: Extend existing `render-equivalence.test.ts` with new test cases for filters, empty states, info icons, and tooltip positioning. Use same `innerHTML` comparison pattern.

**Rationale**: The project already has comprehensive parity enforcement using exact `innerHTML` comparison. The same pattern works for new components: render into two containers with identical data, assert `innerHTML` equality. This catches any non-determinism or entry-point-specific code paths.

**Alternatives considered**:
- Visual regression testing (screenshot comparison): Heavy infrastructure, flaky with font rendering, overkill for deterministic DOM output.
- Custom DOM diff library: Over-engineering when exact string comparison already works.
- Manual testing checklist: Non-automatable, prone to human error.

**Evidence**: `extension/tests/parity/render-equivalence.test.ts` lines 96-229. CI enforcement at `.github/workflows/ci.yml` line 836. 642+ tests, min threshold 632.
