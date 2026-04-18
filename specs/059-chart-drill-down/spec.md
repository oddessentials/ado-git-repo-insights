# Feature Specification: Chart drill-down — Phase 1

**Feature Branch**: `059-chart-drill-down`
**Created**: 2026-04-18
**Status**: Draft
**Input**: Phase 1 cohort of issue #205. Shared right-side detail panel plus four primary-chart consumers (throughput bar, cycle-time trend point, reviewer activity row, summary-card sparklines). Deferred items (bucket exploration, drag-zoom, PR-level data, comparison-mode drill-down, URL-bookmarkable state, advanced a11y) tracked in issue #300.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Explain a throughput spike (Priority: P1)

A user studying weekly pull-request throughput notices an unusual bar — either a spike or a trough — and wants to understand what produced it: which teammates contributed, which repositories dominated, whether it was a small group's push or a broad event.

**Why this priority**: Owner-confirmed highest user value. *"Why did this happen?"* is the single most-asked question of any throughput dashboard; answering it turns read-only metrics into a decision tool. This story delivers both the shared side-panel mechanism and the throughput-specific consumer on top of it — making it the foundation every other drill-down story extends.

**Independent Test**: Load a dataset with visible week-to-week variance, click the most extreme throughput bar, confirm a side panel opens with that week's date range, PR count, and per-author and per-repository breakdown tables. Confirm the panel closes cleanly on every supported dismissal path.

**Acceptance Scenarios**:

1. **Given** the throughput chart is rendered with multiple weeks of data, **When** the user clicks a throughput bar, **Then** a side panel slides in from the right showing the clicked week's date range, PR count, and per-author + per-repository breakdown tables; the clicked bar displays a highlight state.
2. **Given** the side panel is open, **When** the user presses Escape, **Then** the panel closes and the clicked bar's highlight state clears.
3. **Given** the side panel is open, **When** the user clicks anywhere in the dashboard outside the panel, **Then** the panel closes.
4. **Given** the side panel is open, **When** any active dashboard filter changes, **Then** the panel hard-dismisses (no partial revalidation of its content against the new filter set).
5. **Given** the side panel is open, **When** the user switches away from the Metrics tab, **Then** the panel closes.
6. **Given** the side panel is open, **When** the user presses Tab, **Then** keyboard focus advances through panel controls in a logical order and does not escape the panel; pressing Escape returns focus to the originally clicked chart element.

---

### User Story 2 — Explain a cycle-time week (Priority: P2)

A user studying cycle time notices a week where P50 or P90 moved sharply, and wants to see which repositories drove it and how many PRs the week's statistics were based on.

**Why this priority**: Second most common "why?" question after throughput. Reuses the side-panel mechanism delivered in Story 1, so delivery cost is small once Story 1 is in place, but the user value stands on its own.

**Independent Test**: Click a P50 or P90 data point; confirm the side panel shows the week's P50 and P90 as human-readable durations, the PR count that produced those percentiles, and a per-repository breakdown.

**Acceptance Scenarios**:

1. **Given** the cycle-time trend chart is rendered, **When** the user clicks a P50 or P90 point, **Then** the side panel opens with the clicked week's P50 and P90 expressed in human-readable units (hours, days) and a per-repository breakdown for that week.
2. **Given** the side panel is open from a cycle-time point, **When** any dismissal action occurs (Escape, click-outside, filter change, tab switch, close control), **Then** the panel closes with the same behavior as in Story 1.

---

### User Story 3 — Understand a specific reviewer (Priority: P3)

A user looking at the reviewer activity chart sees a particular reviewer and wants to know what that reviewer actually reviewed — which repositories, how often they approved, how their activity trended week by week.

**Why this priority**: High value for code-review coaching and load-balancing discussions; surfaces already-computed information (approval rate) in a context the current chart does not expose. Reuses the side-panel pattern.

**Independent Test**: Click a reviewer row; confirm the panel shows total reviews in the active period, distinct PRs reviewed, the reviewer's weighted approval rate, the reviewer's peak repository breadth, and a per-week activity table.

**Acceptance Scenarios**:

1. **Given** the reviewer activity chart is rendered, **When** the user clicks a reviewer row, **Then** the side panel opens with total reviews in period, distinct PRs reviewed, the reviewer's approval rate, the reviewer's peak repository breadth (highest number of distinct repositories touched in any single week of the period), and a per-week activity table.
2. **Given** the selected reviewer's approval rate is not computable for the current period (no qualifying PRs), **When** the panel opens, **Then** the approval-rate section shows a clearly labeled empty state rather than a misleading "0%".

---

### User Story 4 — Connect a sparkline to its full chart (Priority: P4)

A user scanning summary cards sees a sparkline that looks interesting and wants the full-sized chart below for a closer look without hunting for it.

**Why this priority**: Low cost, independent of the side-panel mechanism, and restores a coherent "overview → detail" flow across the dashboard. Lowest user-journey impact, highest polish-to-effort ratio.

**Independent Test**: Click a sparkline; confirm the page scrolls to the corresponding full chart and the chart receives a brief, self-dismissing highlight.

**Acceptance Scenarios**:

1. **Given** the summary cards and their corresponding full charts are rendered on the same page, **When** the user clicks or keyboard-activates a sparkline, **Then** the viewport scrolls so the corresponding full chart is visible and the chart receives a short-lived highlight that dismisses on its own.
2. **Given** a sparkline has no corresponding full chart in the current data-availability state, **When** the user activates the sparkline, **Then** a brief in-place advisory explains why no navigation occurred instead of navigating silently.

---

### Edge Cases

- **Comparison mode active**: drill-down interactions (click on a bar, dot, or row on an in-scope chart) must not open a panel. Instead the user must see a clear, visible cue — not a silent no-op — explaining that drill-down is intentionally disabled while comparison is active and how to restore it by exiting comparison. This applies uniformly to throughput, cycle-time trend, reviewer activity, and sparklines in scope.
- **Empty breakdown**: a week or reviewer with zero matching PRs under the current filters must produce a panel with a clearly labeled empty state, not an empty table or a hidden panel.
- **Rapid successive clicks**: only one panel is open at a time; clicking a new data point retargets the existing panel to the new context without producing stacked or flickering panels.
- **Filter change mid-animation**: a panel that is partway through opening when a filter change occurs must complete its state transition cleanly (no stuck half-open state) and then dismiss.
- **Wide breakdown tables**: panels whose tables contain many rows or columns must scroll within the panel; the dashboard page must not gain a horizontal scrollbar.
- **Narrow viewport**: at the minimum supported dashboard width, the panel must remain usable and must not so completely obscure the chart that the user loses the context that justified the drill-down.
- **Keyboard focus trap**: while a panel is open, Tab must cycle within the panel; focus must not leak to elements behind the panel.
- **Sparkline with no target chart**: activation produces an inline advisory, not a silent failure.
- **Repeated activation of the same sparkline**: activation is idempotent; repeated activation re-triggers the scroll-and-highlight behavior.

---

## Requirements *(mandatory)*

### Functional Requirements

**Shared side-panel behavior (applies to throughput, cycle-time trend, and reviewer drill-downs)**

- **FR-001**: The dashboard MUST present a single shared side panel for drill-down. Every drill-down interaction that opens a panel MUST use this one component; per-chart drawer duplicates are forbidden.
- **FR-002**: The side panel MUST render along the right edge of the dashboard viewport as a vertically scrollable region while the source chart remains visible.
- **FR-003**: The side panel MUST render a title, an optional subtitle, and one or more content sections. The section-type model MUST support breakdown tables and stat rows in Phase 1 and MUST be extensible so additional section types (including per-PR row lists) can be added later without changing the panel's existing behavior.
- **FR-004**: The side panel MUST dismiss in response to any of: the Escape key, a pointer click outside the panel boundary, a change to any dashboard filter, a switch away from the Metrics tab, or an explicit close control inside the panel.
- **FR-005**: Dismissal caused by a filter change MUST be a hard dismiss — the panel closes fully and does not attempt to refresh its content against the new filter set.
- **FR-006**: While the panel is open, the source chart element that triggered the panel MUST display a visible highlight state; on dismiss, that highlight MUST clear.
- **FR-007**: The panel MUST be operable from a keyboard alone: Tab advances focus through panel controls in a consistent order, Enter activates the focused control, Escape dismisses, and focus MUST remain trapped within the panel until dismissal.
- **FR-008**: On dismiss, focus MUST return to the chart element that triggered the panel, so the user can continue keyboard navigation from where they were.
- **FR-009**: Drill-down state (which data point is expanded, the panel's content) MUST NOT persist across reloads, URL changes, or explicit route changes. It is ephemeral per session view.
- **FR-010**: Every dashboard surface that renders charts MUST display the side panel with byte-identical behavior and output for identical data inputs.
- **FR-011**: Opening, dismissing, or being active with the panel MUST NOT regress any pre-existing dashboard interaction — chart hover tooltips, filter chips, summary card interactions, keyboard navigation, tab switching, and existing aria-attributes MUST all continue to function as before.
- **FR-012**: The side panel MUST remain within the dashboard viewport at all supported widths; it MUST NOT push page content into a horizontal scroll and MUST NOT cover the triggering chart so completely that the user loses the context that motivated the drill-down.

**Throughput drill-down**

- **FR-020**: Clicking any bar in the weekly throughput chart MUST open the shared side panel with that week as the focused period.
- **FR-021**: The panel title MUST be the clicked week's human-readable date range; the subtitle MUST be the week's total PR count.
- **FR-022**: The panel MUST display a breakdown table by author and a breakdown table by repository, each populated from the week's existing aggregate breakdowns.
- **FR-023**: When a week's aggregate breakdowns are empty under current filters, the panel MUST display a clearly labeled empty state for each affected section instead of an empty table.

**Cycle-time trend drill-down**

- **FR-030**: Clicking a P50 or P90 data point in the cycle-time trend chart MUST open the shared side panel with that week as the focused period.
- **FR-031**: The panel MUST display the week's P50 and P90 as human-readable durations via the existing `formatDuration` helper (which emits minutes / hours / days tiers automatically) and the PR count that contributed to those percentiles.
- **FR-032**: The panel MUST display a per-repository breakdown for the focused week.

**Reviewer detail drill-down**

- **FR-040**: Clicking a reviewer row in the reviewer activity chart MUST open the shared side panel with that reviewer as the focused subject.
- **FR-041**: The panel MUST display total reviews in the active period (sum of `reviews_count`), distinct PRs reviewed (sum of `reviewed_prs`), and the reviewer's weighted approval rate for the active period; when approval rate is not computable, the approval-rate entry MUST show a clearly labeled empty state instead of a misleading numeric value.
- **FR-042**: The panel MUST display the selected reviewer's **peak repository breadth** — the highest per-week `repositories_count` observed across any single week in the active period — as a stat with the qualifying week label. Phase 1 aggregates do not include a per-reviewer-per-repository listing; a proper per-repository breakdown of reviewer activity is explicitly deferred to issue #300.
- **FR-043**: The panel MUST display a per-week activity table for the selected reviewer with one row per week in the active period in which the reviewer had activity, and columns: week, reviews_count, reviewed_prs, approval_rate (rendered via the weighted computation, empty cell when not computable for that week).

**Sparkline navigation**

- **FR-050**: Each summary-card sparkline MUST, on pointer click or equivalent keyboard activation, navigate the viewport to the corresponding full chart on the same page.
- **FR-051**: On navigation, the target full chart MUST receive a visual highlight lasting no more than 2 seconds and self-dismissing; the user MUST NOT be required to take any action to clear it.
- **FR-052**: When no corresponding full chart is available because of a data-availability gap, activating the sparkline MUST surface an inline advisory explaining why no navigation occurred, instead of navigating silently or doing nothing.

**Comparison-mode behavior**

- **FR-060**: While comparison mode is active, drill-down MUST be disabled on all charts covered by this specification (throughput, cycle-time trend, reviewer activity, sparklines).
- **FR-061**: The moment comparison mode activates, a visible, persistent cue MUST appear communicating that drill-down is disabled and how to restore it. A subsequent drill-down interaction attempt on any in-scope chart MUST additionally surface an acknowledgement (a short inline toast) reiterating why the action did not open a panel and how to restore it. The experience MUST NOT feel broken or silently ignored.
- **FR-062**: Exiting comparison mode MUST restore drill-down behavior without requiring a page reload.

**Data sources**

- **FR-070**: All drill-down content MUST be derived from aggregate data already present in the current dataset summaries. Phase 1 MUST NOT require new aggregate fields, per-PR records, or new cross-dimensional breakdowns.
- **FR-071**: When a requested breakdown exists in the model but is empty after filtering, the panel MUST show a clearly labeled empty state for that section rather than rendering an empty table or hiding the section silently.

### Key Entities

- **Side Panel**: A single shared, dismissible, right-aligned overlay holding contextual detail about one selected chart data point. Exactly one can be open at a time. Has a title, optional subtitle, and an ordered list of content sections. State is ephemeral (does not survive reloads or route changes).
- **Panel Section**: A typed block of content inside the side panel. Phase 1 types are **breakdown table** (labelled rows with categorical and numeric columns) and **stat row** (a set of labelled values). The section-type model is the stable contract extensible future work will build on.
- **Focused Data Point**: The in-chart element (bar, dot, or row) that triggered the currently-open panel. Displays a visible highlight state until the panel dismisses.
- **Comparison-Mode Advisory**: The user-visible explanation shown (before and on attempt) that drill-down is intentionally unavailable while comparison mode is active, and that explains how to restore it.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every in-scope chart (throughput, cycle-time trend, reviewer activity, summary-card sparklines), a user clicking a data point sees the contextual response (panel for the first three, navigation + highlight for sparklines) within 1 second on a typical desktop browser.
- **SC-002**: Every supported dismissal path (Escape, click-outside, filter change, tab switch, explicit close control) closes an open panel on 100% of attempts; no dismissal path leaves the panel in a stuck or partially open state.
- **SC-003**: While comparison mode is active, 100% of drill-down interaction attempts on in-scope charts produce a visible, self-explanatory cue telling the user drill-down is unavailable and how to restore it; zero attempts produce a silent no-op.
- **SC-004**: Zero pre-existing dashboard interactions regress as a result of this feature, measured by the pre-existing behavioral test suite continuing to pass without modification of its assertions.
- **SC-005**: Every surface that renders the dashboard produces byte-identical panel output for identical data inputs, measured by cross-surface equivalence testing.
- **SC-006**: A keyboard-only user can open a drill-down panel, navigate within it, activate its interactive elements, and dismiss it — on every in-scope chart — without requiring pointer input.
- **SC-007**: The feature introduces zero drift in any existing quality floor (test count, coverage threshold, partial branches) at merge time; any new test cases are accompanied by a same-commit raise of the relevant floor, and any shifted partial-branch counts are reconciled in the same commit.
- **SC-008**: Phase 1 ships without any change to the data aggregation pipeline, dataset schema, or per-PR data model; all user-visible outcomes are achievable from front-end code consuming existing aggregate fields.

---

## Assumptions

- **A-001**: Weekly rollup data (including per-author, per-repository, and per-reviewer breakdowns) is already present across every dashboard surface and can be consumed without pipeline or schema changes.
- **A-002**: A weighted approval rate is already computed per reviewer in the reviewer activity chart (`computeApprovalRate` function); Phase 1 exposes it in the drill-down without changing its computation. The function is currently module-internal and will be made exported by the same edit that wires the reviewer drill-down.
- **A-003**: Comparison-mode state is already observable at the moment a drill-down interaction occurs; Phase 1 consumes the existing signal rather than introducing a new one.
- **A-004**: Filter changes and Metrics-tab switches already emit observable signals that Phase 1 can subscribe to for hard-dismissal.
- **A-005**: Keyboard-focus idioms (Tab traversal order, focus-return on overlay dismiss) already exist in at least one pre-Phase-1 dashboard component and serve as the reference pattern.
- **A-006**: Every entry point that renders the dashboard consumes the same shared front-end module tree; a single shared side-panel implementation can therefore serve all of them without per-surface divergence.
- **A-007**: Deferred items — PR-level detail, bucket exploration, drag-zoom, cross-dimensional breakdowns, comparison-mode drill-down, URL-bookmarkable drill-down state, advanced screen-reader narration — are tracked in issue #300 and are explicitly not within the scope of this specification. The section model in FR-003 is extensible so Phase 2 can add new section types without rewriting Phase 1 consumers.
- **A-008**: Every test case added to support Phase 1 will be paired with a same-commit raise of the repository's test-count floor for the extension suite; no marker-based drift relief is available for the extension floor.
- **A-009**: Partial-branch coverage shifts caused by Phase 1 will be reconciled with a same-commit baseline co-change; files locked at zero partial branches remain at zero.
- **A-010**: Cross-platform support covers Windows, macOS, and Linux; nothing in Phase 1 relies on OS-specific capabilities.
- **A-011**: Byte-identical panel output for identical data inputs is already the enforcement standard for the dashboard's rendering surfaces; Phase 1 maintains that standard without relaxing it.

---

## Out of Scope

The following items were explicitly considered during Phase 1 planning (2026-04-18) and deferred to follow-up work tracked in issue #300:

- Per-PR detail rows inside drill-down panels (title, author, URL, per-PR cycle time).
- Cycle-time distribution bucket exploration.
- Cycle-time trend drag-zoom range selection.
- Cross-dimensional aggregates (reviewer × repository — required for a proper per-repository breakdown of a single reviewer's activity — plus per-week distribution per bucket, per-repository per bucket).
- Comparison-mode drill-down with side-by-side panels.
- URL-bookmarkable drill-down state surviving reloads.
- Advanced screen-reader narration of panel content beyond the Tab/Enter/Escape keyboard-accessibility requirements captured in FR-007 and FR-008.

---

## References

- Parent issue: #205 (Chart drill-down & interactive exploration)
- Deferred-items follow-up: #300 (Chart drill-down Phase 2 and deferred items)
- Planning scope-lock comment: #205 comment dated 2026-04-18
