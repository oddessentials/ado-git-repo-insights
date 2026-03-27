# Feature Specification: Metrics Dashboard UX Improvements

**Feature Branch**: `041-metrics-dashboard-ux`
**Created**: 2026-03-27
**Status**: Draft
**Input**: User description: "Three related metrics dashboard improvements: fix tooltip positioning when charts are scrolled, unified typeahead filter component, context-aware empty states, and info icons on summary cards."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Readable Tooltips at Any Scroll Position (Priority: P1)

A team lead scrolls down the metrics dashboard to review the PR Throughput chart. They hover over a bar to see weekly detail. The tooltip appears anchored near the bar they hovered, regardless of how far they have scrolled. If the tooltip would be cut off by the top edge of the viewport, it appears below the bar instead.

**Why this priority**: This is a functional bug that prevents users from reading data. Tooltips floating off-screen make the chart hover feature effectively broken when charts are below the fold.

**Independent Test**: Can be fully tested by scrolling the dashboard to various positions and hovering chart elements. Delivers immediate value by making existing hover data readable.

**Acceptance Scenarios**:

1. **Given** the dashboard is scrolled so a chart is near the bottom of the viewport, **When** the user hovers a data element (bar, dot), **Then** the tooltip appears anchored near that element within the visible viewport.
2. **Given** a data element is near the top edge of the viewport, **When** the user hovers it, **Then** the tooltip repositions below the element instead of being clipped above the viewport.
3. **Given** a data element is near the left or right edge of the viewport, **When** the user hovers it, **Then** the tooltip shifts horizontally to remain fully visible.
4. **Given** the user is on a touch device, **When** they tap a data element without scrolling, **Then** the tooltip appears anchored near the element at any scroll position.
5. **Given** a tooltip is visible, **When** the user scrolls the page, **Then** the tooltip is dismissed (existing behavior preserved).
6. **Given** a chart tooltip is visible and the user hovers an info icon on a summary card, **When** the info icon tooltip appears, **Then** the chart tooltip is dismissed first (no two tooltips coexist from different systems).

---

### User Story 2 - Consistent Searchable Filters Across All Dimensions (Priority: P1)

An engineering manager opens the metrics dashboard and wants to filter by a specific repository. They start typing the repository name and see matching options appear in a searchable dropdown, the same way the Author filter works today. They can also filter by team, reviewer, or author using the same interaction pattern. For Repository and Team, they can select multiple items. For Reviewer and Author, they select one at a time.

**Why this priority**: The current inconsistency (Author has typeahead, Repository/Team use raw multi-select, Reviewer uses single-select dropdown) confuses users and makes multi-select discovery poor. Ctrl+click for multi-select is a hidden affordance most users never discover.

**Independent Test**: Can be fully tested by interacting with each of the four filter dropdowns, verifying typeahead search works, and confirming selection behavior (single vs multi) matches expected mode. Delivers standalone value by making all filters consistently usable.

**Acceptance Scenarios**:

1. **Given** the dashboard has loaded with available dimensions, **When** the user clicks or focuses any filter (Repository, Team, Reviewer, Author), **Then** a searchable dropdown appears with a text input for filtering options.
2. **Given** the Repository filter is focused, **When** the user types partial text, **Then** the dropdown narrows to show only matching repository names.
3. **Given** the Team filter is focused, **When** the user types partial text, **Then** the dropdown narrows to show only matching team names.
4. **Given** the Repository filter is in multi-select mode, **When** the user selects multiple repositories, **Then** each selection appears as a removable chip/tag in or near the filter, and all selected values are applied to the data.
5. **Given** the Reviewer filter is in single-select mode, **When** the user selects a reviewer, **Then** the previous selection is replaced (not accumulated).
6. **Given** the Author filter is in single-select mode, **When** the user selects an author, **Then** the previous selection is replaced (matching current behavior).
7. **Given** the user has selected filters via the new component, **When** they copy the URL, **Then** the URL contains the same serialized filter state as today (backward-compatible URLs).
8. **Given** the user loads a bookmarked URL with filter parameters, **When** the dashboard renders, **Then** the unified filters reflect the saved state correctly.
9. **Given** an Author filter and a Team filter are both active (a known constraint combination), **When** the data is rendered, **Then** the existing constraint behavior is preserved (author-only metrics with team UI state retained) and no regression occurs.
10. **Given** a dimension has no available options (e.g., no teams in the dataset), **When** the dashboard loads, **Then** that filter is hidden (existing behavior preserved).
11. **Given** the user selects all available options in a multi-select filter (e.g., all repositories), **Then** the behavior is identical to having no filter active for that dimension (show all data).
12. **Given** a bookmarked URL contains multi-select values in a different order than the current UI would produce (e.g., `repos=b,a` vs `repos=a,b`), **When** the URL is loaded, **Then** both orders produce the same filter state and identical chart output.

---

### User Story 3 - Context-Aware Empty State Messaging (Priority: P2)

A developer filters the dashboard by a specific reviewer who had no activity in the selected date range. Instead of seeing a generic "No data for selected range" message, they see a clear explanation: "No data matches your current filters. Try removing some filters or widening the date range." When no filters are active and the date range simply has no data, they see "No data in this period. Try widening the date range." When a chart needs minimum data (e.g., 2 weeks for trends), the message explains the specific requirement.

**Why this priority**: Generic empty states cause confusion and erode trust. Users cannot tell whether they misconfigured a filter, whether data was never collected, or whether the chart has a minimum data requirement. This is a high-value polish fix with low regression risk.

**Independent Test**: Can be tested by applying various filter combinations and date ranges to produce empty charts, then verifying the message accurately reflects the reason. Delivers standalone value by reducing user confusion.

**Acceptance Scenarios**:

1. **Given** the user has active filters that exclude all data, **When** a chart renders with no matching data, **Then** the message indicates filters are the cause (e.g., "No data matches your current filters") and suggests adjusting filters.
2. **Given** no filters are active but the date range contains no data, **When** a chart renders empty, **Then** the message indicates the date range is the cause (e.g., "No data in this period") and suggests widening the date range.
3. **Given** a chart requires a minimum number of data points (e.g., trend charts need at least 2 weeks), **When** the filtered data has fewer points than required, **Then** the message explains the specific minimum requirement.
4. **Given** reviewer data was not captured by the extraction pipeline (detectable via null breakdown fields or manifest capability flags), **When** the reviewer chart is empty, **Then** the message explains this in user-friendly terms (e.g., "Reviewer details are not yet available. Ensure the data pipeline includes reviewer information.").
5. **Given** the user sees an empty-state message, **When** they read the suggestion, **Then** the suggestion is actionable and specific to their situation (not a generic catch-all hint).
6. **Given** multiple empty-state conditions are simultaneously true (e.g., filters are active AND the date range is narrow AND the chart has a minimum data requirement), **When** the chart renders empty, **Then** the most specific and actionable condition is displayed, following a strict evaluation order: data-not-extracted → filters-caused-empty → minimum-data-requirement → date-range-empty.

---

### User Story 4 - Explanatory Info Icons on Summary Cards (Priority: P2)

A product manager unfamiliar with statistical terminology opens the dashboard and sees "Cycle Time (P50)" with a number. They click or hover a small info icon next to the title and see a plain-English explanation: "Median time from PR creation to merge. Half of all PRs completed faster than this." Each of the five summary cards has an info icon with a relevant explanation.

**Why this priority**: Summary cards are the first thing users see, and P50/P90 are not self-explanatory to non-technical audiences. Info icons are low-effort, high-clarity improvements that make the dashboard accessible to a broader audience.

**Independent Test**: Can be tested by hovering or clicking each info icon on all five summary cards and verifying the explanation is present, accurate, and readable. Delivers standalone value by making metrics self-documenting.

**Acceptance Scenarios**:

1. **Given** the dashboard is loaded with data, **When** the user views the summary cards area, **Then** each of the five cards (Total PRs, Cycle Time P50, Cycle Time P90, Contributors, Reviewers) has a visible info icon.
2. **Given** a summary card has an info icon, **When** the user hovers or clicks the icon, **Then** a tooltip or popover appears with a plain-English explanation of the metric.
3. **Given** the info tooltip is displayed, **When** the user moves the mouse away or clicks elsewhere, **Then** the tooltip dismisses cleanly without affecting any chart tooltip state.
4. **Given** the explanation for "Cycle Time (P50)", **Then** it conveys that this is the median turnaround time and that half of PRs completed faster.
5. **Given** the explanation for "Cycle Time (P90)", **Then** it conveys that 90% of PRs completed faster and that high values indicate bottlenecks.
6. **Given** the explanation for "Total PRs", **Then** it conveys that this counts merged pull requests in the selected period and filters.
7. **Given** the explanation for "Contributors" and "Reviewers", **Then** each conveys that it represents the average number of unique authors or reviewers per week.

---

### Edge Cases

- What happens when the viewport is extremely narrow (e.g., VS Code side panel at 300px) and a tooltip would overflow both sides? The tooltip must be clamped to fit within the available width.
- What happens when a filter dimension has hundreds of options (e.g., 500 repositories)? The typeahead dropdown must remain responsive and usable with large option sets.
- What happens when the user types a filter search term that matches zero options? The dropdown must show a "No matching options" message rather than appearing empty or collapsing.
- What happens when filter URL parameters reference a value that no longer exists in the dataset (e.g., a deleted repository)? The filter must gracefully ignore invalid values without errors, matching current behavior.
- What happens when all five summary cards have null data (e.g., no cycle time data extracted)? Info icons must still render, and the explanation should still describe what the metric represents.
- What happens when the user rapidly hovers across multiple chart elements? Only one tooltip must be visible at a time, and transitions must be clean without flickering.
- What happens when a multi-select filter has all options selected? The behavior must be equivalent to having no filter active (show all data).
- What happens when a chart tooltip and an info icon tooltip could both be triggered in quick succession? Only one tooltip of any kind must be visible at a time.
- What happens when the reviewer breakdown field is null (not extracted) vs an empty object (extracted but no data)? The empty state message must distinguish between these cases using the appropriate data availability signal.

## Requirements *(mandatory)*

### Functional Requirements

**Tooltip Positioning & Lifecycle:**

- **FR-001**: Tooltips MUST be positioned using the webview iframe's viewport coordinate system. Positioning MUST use `position: fixed` with coordinates from `getBoundingClientRect()`, which are viewport-relative within the webview iframe. This ensures consistent anchoring regardless of scroll position across all entry points. The implementation MUST assert the expected DOM structure at initialization (tooltip parent is `document.body`, no intermediate positioned ancestors between `body` and charts) and fail visibly if the assumption is violated, to guard against future layout changes that would break positioning.
- **FR-002**: Tooltips MUST reposition (flip from above to below, shift left or right) when they would otherwise be clipped by viewport edges. Boundary detection MUST check against `window.innerWidth` and `window.innerHeight` after the tooltip is measured.
- **FR-003**: Tooltip dismissal behavior MUST be preserved: dismissed on click outside, on `mouseleave` (which also handles desktop scroll-dismiss indirectly, as scrolling moves the element away from the cursor), and when a new tooltip is triggered. Note: on touch devices, tap-triggered tooltips persist until the next tap or click-outside; there is no explicit scroll event listener, and adding one is out of scope for this feature.
- **FR-004**: Only one tooltip MUST be visible at any time across the entire dashboard. The tooltip lifecycle MUST enforce a strict **dismiss → create → position → append** sequence as a tested invariant. Each step MUST complete before the next begins. This invariant MUST be preserved even if future changes introduce async behavior (animations, transitions, framework updates). The sequence MUST be covered by a dedicated test that verifies: (a) no tooltip exists in the DOM after dismiss, (b) exactly one exists after create, (c) the tooltip is positioned within viewport bounds after position.

**Filter System:**

- **FR-005**: All four filter dimensions (Repository, Team, Reviewer, Author) MUST provide a searchable typeahead dropdown interaction.
- **FR-006**: Repository and Team filters MUST support multi-select (selecting more than one value simultaneously).
- **FR-007**: Reviewer and Author filters MUST support single-select only (selecting one value replaces any previous selection).
- **FR-008**: Selected multi-select values MUST be displayed as removable chips or tags visible without opening the dropdown.
- **FR-009**: Filter URL serialization MUST use the existing parameter contract: `repos` (comma-separated), `teams` (comma-separated), `reviewers` (single value), `author` (single value). The canonical serialization format MUST be: delimiter is `,` (comma, no spaces), values are URI-encoded per `encodeURIComponent()` before joining, multi-select values are sorted lexicographically (ascending, case-sensitive) before joining, and an empty selection MUST delete the parameter entirely (not serialize as `repos=`). Deserialization MUST: split on `,`, apply `decodeURIComponent()` to each value, strip empty/whitespace-only values, and produce the same filter state regardless of parameter value order. This contract MUST be covered by round-trip tests (serialize → deserialize → serialize produces identical output).
- **FR-010**: Existing filter constraint behavior MUST be preserved exactly: Author+Team degrades to author-only metrics; Reviewer+Repo/Team uses reviewer-only metrics. These constraints MUST be enforced by a single deterministic constraint resolver function that is the **sole authority** for resolving filter conflicts. ALL consumers — UI rendering, metrics/data computation, URL serialization, and URL deserialization — MUST exclusively call this resolver before acting on filter state. No consumer may implement its own constraint logic. The current split between UI-layer enforcement and data-layer warnings MUST be consolidated into this single function.
- **FR-011**: When all available options in a multi-select filter are selected, the system MUST normalize this to an empty selection at the state layer (not the UI layer), producing behavior identical to "no filter active" for that dimension. This normalization MUST occur at a single defined trigger point: immediately after raw selections are read from the UI and before the normalized state is passed to ANY downstream consumer (constraint resolver, data queries, URL serialization, or chart rendering). This ensures the UI, URL, and data layers never see divergent filter states.
- **FR-012**: The typeahead input MUST debounce user keystrokes (150-300ms recommended) before filtering the option list. For option sets exceeding 200 items, the dropdown MUST use windowed/virtualized rendering to prevent UI lockups. Performance MUST meet these testable acceptance criteria: (a) time from keystroke to visible dropdown update MUST be under 100ms for option sets up to 200 items, (b) time from keystroke to visible dropdown update MUST be under 200ms for option sets up to 1,000 items, (c) no dropped frames (jank) during continuous typing in a 1,000-item option set. These thresholds MUST be verified by automated performance tests, not subjective assessment.
- **FR-013**: Filters with no available options MUST remain hidden, matching current behavior.

**Empty State Messaging:**

- **FR-014**: Empty state messages MUST distinguish between at least four scenarios, evaluated in strict short-circuit order where the **first matching condition terminates evaluation**: (a) data was not extracted for this metric (detectable via null breakdown fields or manifest capability flags), (b) active filters produced no results (filters are non-empty AND unfiltered rollups exist but filtered rollups are empty), (c) chart has a minimum data requirement not met (filtered data exists but count is below threshold), (d) date range contains no data (no rollups at all, regardless of filters). Each condition MUST be evaluated using explicit boolean checks, not fall-through logic. When condition (a) is true, conditions (b)-(d) MUST NOT be evaluated, even if they would also be true. This prevents inconsistent messaging when multiple conditions overlap (e.g., filters active + data also not extracted).
- **FR-015**: Empty state classification MUST use explicit upstream data availability signals: null breakdown fields (e.g., `by_reviewer === null` means not extracted vs `by_reviewer === {}` means extracted but empty) and manifest capability flags (e.g., `reviewer_repository_mode`, `comments.status`). The system MUST NOT rely solely on empty result sets to infer whether data was never extracted. The null-vs-empty distinction MUST be enforced by a validated type guard or schema check at the data loading boundary (when rollups are normalized from raw JSON). If an upstream change causes a previously-null field to arrive as `undefined` or is omitted entirely, the type guard MUST normalize it to `null` (not-extracted) and log a warning. This prevents accidental misclassification due to upstream schema drift.
- **FR-016**: Empty state suggestions MUST be actionable and specific to the scenario, not a single generic hint for all cases.

**Info Icons:**

- **FR-017**: Each of the five summary cards MUST display an info icon that reveals a plain-English explanation of the metric on hover or click.
- **FR-018**: Info icon explanations MUST accurately describe what each metric represents and how to interpret it.
- **FR-019**: Info icon tooltips MUST use a distinct CSS class namespace (e.g., `.info-tooltip`, not `.chart-tooltip`) and a separate dismiss/lifecycle mechanism so they do not collide with chart tooltip positioning, dismissal listeners, or z-index stacking. The z-index stacking order MUST be explicitly defined: info tooltips MUST render at a z-index higher than chart tooltips (which are at z-index 100) but lower than toast notifications (z-index 1000). Chart tooltip dismissal (which targets `[data-tooltip]` and `.chart-tooltip` selectors) MUST NOT interfere with info icon tooltips, and vice versa. Only one tooltip of any kind (chart or info) may be visible at a time; showing either type MUST dismiss the other via a shared "dismiss all tooltips" function that is the single entry point for tooltip cleanup across both systems. Info icon interactions MUST take priority: if a user hovers an info icon while a chart tooltip is visible, the chart tooltip MUST dismiss and the info tooltip MUST appear.

**Parity:**

- **FR-020**: All changes MUST render identically across both dashboard entry points (Dashboard hub and Settings panel). Parity MUST be verified by the existing render-equivalence test suite, which uses exact `innerHTML` comparison on chart output given identical input data. In addition to existing chart parity tests, the following new components MUST have explicit parity test coverage: (a) unified typeahead filter — given identical dimension data, the rendered filter DOM must be identical across entry points, (b) empty state messages — given identical rollup data, filter state, and manifest capability flags, the rendered empty state must be identical, (c) info icon tooltips — given identical card data, the rendered info icon and tooltip content must be identical, (d) tooltip positioning — given identical element coordinates, the computed tooltip position must be identical. These tests MUST use the same exact `innerHTML`/position comparison pattern as existing parity tests.
- **FR-021**: Existing touch interaction behavior (scroll-cancellation for tooltips) MUST be preserved.

### Key Entities

- **Filter Dimension**: A filterable attribute of the dataset (Repository, Team, Reviewer, Author) with a set of available options, a selection mode (single or multi), and a current selection state.
- **Filter Constraint Resolver**: A single deterministic function that takes raw filter selections and returns the effective filter state after applying all constraint rules (Author+Team, Reviewer+Repo/Team). This is the sole authority for resolving conflicts between filter dimensions.
- **Tooltip**: A transient overlay displaying contextual detail for a chart data element, positioned using viewport-fixed coordinates and constrained within the viewport. Exactly one tooltip may exist in the DOM at any time.
- **Info Tooltip**: A transient overlay displaying a metric explanation, triggered by info icons on summary cards. Uses a distinct CSS namespace and lifecycle from chart tooltips. Mutually exclusive with chart tooltips (only one of either kind visible at a time).
- **Empty State**: A message displayed in place of a chart when no data is available, consisting of a primary message and an actionable suggestion. Classified by a strict evaluation hierarchy: data-not-extracted → filter-caused → minimum-data → date-range-empty.
- **Data Availability Signal**: An explicit indicator of whether a data dimension was extracted (null field = not extracted, empty object = extracted but no data, manifest capability flags for feature-level availability).
- **Metric Explanation**: A static, human-readable description of a summary card metric, displayed via an info icon interaction.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Tooltips are fully visible and readable when interacting with chart elements at any scroll position, including when charts are at the bottom of the viewport.
- **SC-002**: Users can search and select filter values by typing partial text in all four filter dimensions, reducing time to locate and apply a specific filter.
- **SC-003**: Multi-select filter state is visible at a glance (via chips) without opening the dropdown, reducing the number of clicks needed to verify active filters.
- **SC-004**: Empty state messages correctly identify the cause of missing data in 100% of testable scenarios, following the strict evaluation order: data-not-extracted → filter-caused → minimum-data → date-range-empty.
- **SC-005**: All five summary cards provide self-service metric explanations, eliminating the need for external documentation to understand what P50, P90, Contributors, and Reviewers mean.
- **SC-006**: Zero functional regressions in existing chart rendering, filter constraint logic, URL serialization, and touch interaction behavior.
- **SC-007**: Dashboard renders identically across both entry points after changes, verified by the existing render-equivalence test suite using exact `innerHTML` comparison plus any new parity tests added for new rendering logic.
- **SC-008**: Filter constraint resolution uses a single function as the sole authority, with no duplicate constraint logic in other layers.
- **SC-009**: Typeahead dropdown updates within 100ms of keystroke for up to 200 options and within 200ms for up to 1,000 options, with no dropped frames during continuous typing, as verified by automated performance tests.
- **SC-010**: Filter URL serialization passes round-trip tests: serialize → deserialize → serialize produces identical output for all filter states including empty, single, multi-select, and edge cases.
- **SC-011**: Tooltip lifecycle invariant test verifies the dismiss → create → position → append sequence produces exactly zero or one tooltip in the DOM at all times, with no intermediate states where two tooltips coexist.

## Technical Constraints *(investigated and verified)*

This section documents findings from codebase investigation that constrain implementation choices.

### TC-1: Tooltip Coordinate System

The dashboard runs inside a VS Code Azure DevOps extension webview, which is an iframe. `getBoundingClientRect()` returns coordinates relative to the iframe's own viewport. The current bug appends a `position: absolute` tooltip to `document.body` using these viewport-relative coordinates — which only works when scroll offset is zero.

**Verified facts:**
- No scroll containers wrap the charts; only `document.body` scrolls (plus horizontal overflow on `.bar-chart`)
- The tooltip is appended to `document.body`, not to a chart-local container
- CSS sets `.chart-tooltip { position: absolute; z-index: 100 }`
- `position: fixed` with `getBoundingClientRect()` values is the correct fix because both use the same viewport coordinate space

**Nested scroll container guard:** No nested scroll containers exist today, and none are planned in this feature. Rather than adding behavioral requirements for a nonexistent layout, FR-001 requires a structural assertion at initialization that fails visibly if the DOM structure changes (e.g., an intermediate positioned ancestor is introduced between `body` and charts). This guards against future layout changes without over-engineering for hypotheticals.

### TC-2: Tooltip Lifecycle Is Currently Race-Free

The existing tooltip lifecycle is synchronous and race-free today:
- `showTooltip()` always calls `dismissActiveTooltip()` first (dismiss-before-create)
- `dismissActiveTooltip()` uses `document.querySelector(".chart-tooltip")` — only one can exist
- `mouseenter` → show, `mouseleave` → dismiss, `pointerdown/pointerup` → tap with scroll-cancellation (10px threshold)
- Per-container `AbortController` prevents listener accumulation on re-render
- No debounce is needed for chart tooltips because the single-threaded event loop serializes all hover events

**Future-proofing:** While the current single-threaded synchronous design prevents races, FR-004 mandates that the dismiss → create → position → append sequence is enforced as a tested invariant, not merely an implicit consequence of synchronous execution. This protects against regressions if async behavior (CSS transitions, animation callbacks, or framework adoption) is introduced in the future.

### TC-3: Filter URL Serialization Contract

The existing URL contract is:
- `repos=name1,name2` (comma-separated, multi-select)
- `teams=name1,name2` (comma-separated, multi-select)
- `reviewers=id` (single value; additional comma-separated values silently dropped)
- `author=name` (single value)
- Empty values and whitespace-only values are stripped on deserialization
- Invalid values (not matching current dimensions) are silently dropped during URL restoration
- **No ordering guarantee exists today** — `repos=a,b` and `repos=b,a` produce equivalent state but different URL strings

### TC-4: Multi-Select "All Selected" Has No Normalization

Currently, selecting all options is NOT equivalent to no filter. The UI relies on an "All" option with an empty value to produce an empty filter array (meaning unfiltered). If a user selects every individual option instead, the data layer still applies filtering logic. There is no normalization that detects "all selected" and converts it to "no filter."

### TC-5: Filter Constraints Are Split Across Two Layers

Filter constraint logic currently exists in two places:
- **UI layer** (`dashboard.ts`): `applyAuthorFilterCompatibility()` and `applyReviewerFilterCompatibility()` — actively enforce constraints by clearing conflicting selections
- **Data layer** (`metrics.ts`): `applyFiltersToRollups()` — logs console warnings about the same constraints but doesn't enforce them (assumes UI already did)

The Reviewer+Repo constraint is asymmetric: the UI allows the combination but the data layer silently ignores the repo filter. This is a divergence risk.

### TC-6: Current Typeahead Is Browser-Native

The Author filter uses HTML5 `<input type="search" list="...">` with `<datalist>`. Browser-native datalist filtering handles search without JavaScript debouncing. Replacing this with a custom component means the implementation MUST add its own debounce and performant rendering for large option sets.

### TC-7: Empty State Evaluation Has No Filter Awareness

Current empty state logic in each chart module follows: null container → empty rollups → minimum threshold → zero aggregate. None of these checks inspect whether filters are active. The `NO_DATA_HINTS` constants provide generic suggestions. The reviewer activity chart has a `getReviewerNoDataHint()` helper that partially differentiates based on `reviewerFilterActive` and `hasRollups`, but other charts do not.

### TC-8: Data Availability Is Explicitly Signaled

Upstream data availability is detectable via:
- **Breakdown field nullability**: `by_reviewer === null` means not extracted; `by_reviewer === {}` means extracted but empty
- **Manifest capability flags**: `capabilities.reviewer_repository_mode` ("exact" | "constrained" | "disallowed"), `comments.status` ("disabled" | "full" | "partial")
- **Default values**: Missing fields default to null via `ROLLUP_FIELD_DEFAULTS`

These signals are available but not currently used for empty state classification beyond the reviewer chart's partial `hasRollups` check.

### TC-9: Info Icons and Chart Tooltips Are Separate Systems

The existing info icon pattern (used in predictions.ts) renders static inline HTML using `.metric-unavailable` + `.info-icon` CSS classes. Chart tooltips use `.chart-tooltip` class, are dynamically created/destroyed on `document.body`, and have their own dismissal listeners targeting `[data-tooltip]` and `.chart-tooltip` selectors. These two systems currently do not interact. However, if info icon tooltips become dynamic (hover/click triggered), a cross-system dismiss mechanism is needed to prevent two tooltips from coexisting.

### TC-10: Parity Is Already Enforced in CI

The project has comprehensive parity enforcement:
- `render-equivalence.test.ts`: Exact `innerHTML` comparison proving chart idempotency and cross-entry-point wiring parity (CLI, docs, extension paths produce identical output)
- `schema/parity.test.ts`: Validates normalized data shapes match across sources
- `smoke-render.test.ts`: Validates rendering produces non-empty DOM without errors
- `e2e/dashboard-render.test.ts`: Full integration rendering with fixture data
- CI runs 642+ tests on every push with a minimum threshold of 632

Rendering is 100% deterministic for the metrics tab — no `Date()`, `Math.random()`, or viewport-dependent calculations in chart output. New rendering logic must be covered by equivalent parity tests.

## Assumptions

- Users access the dashboard primarily via Azure DevOps extension webview panels (iframes), with viewport widths ranging from approximately 300px (narrow side panel) to full-screen width.
- The existing filter constraint logic (Author+Team, Reviewer+Repo combinations) is intentional behavior, not a bug, and must be preserved exactly — but consolidated into a single resolver.
- The existing Author typeahead implementation (HTML5 `<datalist>`) will be replaced entirely by the new unified component; backward compatibility of the internal component API is not required, only behavioral and URL compatibility.
- Summary card metric explanations are static text that does not need to be configurable or localizable in this iteration.
- Touch device support for tooltips must be maintained, specifically the scroll-cancellation pattern (10px Euclidean distance threshold) that prevents accidental tooltip display during scroll gestures.
- The number of options per filter dimension is expected to stay under 1,000 items in typical usage; the component should remain responsive with several hundred options but must handle up to 1,000 without visible lag.
- The existing parity test infrastructure (render-equivalence, schema parity, smoke render, e2e) is sufficient for verifying new changes. New rendering code must be covered by additional parity test cases using the same exact `innerHTML` comparison pattern.
