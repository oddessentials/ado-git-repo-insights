# Feature Specification: Dashboard UX Polish

**Feature Branch**: `036-dashboard-ux-polish`
**Created**: 2026-03-22
**Status**: Draft
**Input**: User description: "Dashboard UX polish for professional presentation across all 12 identified items (P0/P1/P2): throughput chart scrolling, author filter styling, comments banner, filter bar mobile, reviewer notice, chart overflow, error states, touch targets, button states, responsive typography, print stylesheet, tab animations"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Dense Data Readability at Enterprise Scale (Priority: P1)

An engineering manager selects a 2-year date range on the PR Insights dashboard. The throughput chart currently renders up to 104 weekly bars with overlapping labels and an unintuitive horizontal scrollbar. The manager needs to quickly assess PR throughput trends without scrolling or squinting at unreadable axis labels. When data exceeds the visible viewport, clear visual cues must communicate that additional data exists and how to access it. Truncation indicators must be prominent enough that analysts never unknowingly base decisions on partial data.

**Why this priority**: The throughput chart is the primary visualization on the Metrics tab. Unreadable labels, hidden scrolling, and invisible truncation directly undermine user trust in the dashboard for enterprise-scale datasets (156+ weeks, 200+ users). This is the most visible UX gap.

**Independent Test**: Can be fully tested by loading the enterprise demo dataset (260 weeks), verifying label thinning renders legibly at 104 bars, confirming scroll affordance is visible, and verifying the truncation indicator is prominent. Delivers immediate value for any user with >52 weeks of data.

**Acceptance Scenarios**:

1. **Given** a dataset with 156+ weeks of data, **When** the throughput chart renders with 104 bars (after truncation), **Then** week labels are thinned deterministically: `labelStep = Math.ceil(104 / 16) = 7`, rendering labels at indices 0, 7, 14, ..., 98 (15 labels). Suppressed positions render no label text. This output is identical across all surfaces.
2. **Given** a dataset exceeding the chart viewport width, **When** the bar chart overflows, **Then** a visible scroll affordance (gradient fade, scroll hint, or subtle indicator) communicates that the chart is horizontally scrollable.
3. **Given** data is truncated to the last 104 weeks, **When** the truncation indicator renders, **Then** it uses a prominent style (non-tertiary color, adequate font size, positioned at the top of the chart) so users cannot miss it.
4. **Given** a predictions chart or sparkline that silently truncates data, **When** truncation is active, **Then** a subtle badge or icon communicates that the visualization is based on partial history.

---

### User Story 2 - Cross-Browser Author Filter and Filter Hints (Priority: P1)

A team lead uses the author filter to find a specific contributor across 200 users. The search input with browser-native datalist renders inconsistently across Chrome, Firefox, and Edge. The comments coverage banner and reviewer constrained-mode notice lack visual styling (the `.filter-hint` CSS class is referenced in HTML but has no CSS rules). Users must see consistent, professional filter controls and clearly styled status banners regardless of browser.

**Why this priority**: The author filter is a new feature (spec 034) and currently the least polished interactive control. The missing `.filter-hint` class means coverage banners and constraint notices are invisible or unstyled. These are data-quality signals that users rely on to understand filter limitations.

**Independent Test**: Can be fully tested by rendering the dashboard in Chrome, Firefox, and Edge, verifying the author search input has consistent appearance, and confirming that the comments coverage banner and reviewer notice display with a visible, styled banner when active.

**Acceptance Scenarios**:

1. **Given** the author filter is visible, **When** rendered in Chrome, Firefox, and Edge, **Then** the search input box has consistent height (within 2px), border, placeholder color, and focus ring across all three browsers. The datalist dropdown appearance is browser-native and is NOT required to match — only the input box itself is normalized.
2. **Given** the comments pipeline ran with partial coverage, **When** the comments coverage banner activates, **Then** it displays with a visible background color, left border accent, icon, and adequate padding — clearly distinguishable from surrounding filter controls.
3. **Given** a reviewer filter is selected alongside a repository filter, **When** constrained mode activates, **Then** the reviewer notice banner displays with a colored background (amber/warning) and clear "Constrained Mode" label.
4. **Given** the author filter notice activates ("Author + team uses author-only metrics"), **When** it renders, **Then** it displays with the same `.filter-hint` styling as other banners — consistently styled.

---

### User Story 3 - Touch-Friendly Interactive Elements (Priority: P1)

A developer reviews PR Insights on a tablet during a stand-up meeting. Filter chip remove buttons (currently ~14x14px), small action buttons (~22px height), and form dropdowns (~28px height) are too small for reliable finger taps. The developer needs all interactive elements to meet minimum touch target guidelines so the dashboard is usable on touch devices without frustration.

**Why this priority**: Multiple interactive elements fail WCAG 2.5.5 touch target sizing. Filter chip remove buttons at ~14x14px are 30px below the 44px minimum. This is a fundamental accessibility issue that affects all touch-device users and undermines the dashboard's enterprise-grade presentation.

**Independent Test**: Can be fully tested by measuring the rendered dimensions of all interactive elements and verifying they meet minimum touch target sizes. Delivers immediate value for tablet and touch-screen users.

**Acceptance Scenarios**:

1. **Given** an active filter chip with a remove button, **When** rendered on any device, **Then** the remove button's effective touch target is at least 44x44px (via padding, minimum dimensions, or hit area expansion).
2. **Given** small action buttons (apply dates, clear filters, export, compare), **When** rendered, **Then** each button has a minimum effective height of 36px with adequate padding for comfortable touch interaction.
3. **Given** filter dropdowns and date inputs, **When** rendered, **Then** each has a minimum effective height of 36px for comfortable selection on touch devices.
4. **Given** export menu items, **When** the export dropdown opens, **Then** each menu option has a minimum effective height of 40px for reliable touch selection.
5. **Given** chart data points with tooltips (currently hover-only), **When** a user taps a data point on a touch device, **Then** the tooltip appears anchored near the tapped element; tapping elsewhere or a different point dismisses it; and if the touch gesture becomes a scroll (>10px movement), the tap is cancelled and no tooltip appears.

---

### User Story 4 - Mobile-Responsive Layout (Priority: P2)

A developer checks PR Insights on their phone (375px viewport). Currently, only one breakpoint exists at 768px. Summary cards render as a 2-column grid that overflows on small phones. Font sizes are hardcoded at desktop values (h1: 20px, metric values: 32px). The developer needs the dashboard to adapt gracefully to small screens with appropriate typography scaling, single-column layouts, and properly positioned elements.

**Why this priority**: Mobile responsiveness is increasingly expected for enterprise dashboards. The current single breakpoint covers tablets but leaves phones with overflowing layouts, oversized text, and unusable chart displays.

**Independent Test**: Can be fully tested by rendering the dashboard at 375px and 480px viewport widths and verifying layouts don't overflow, typography scales appropriately, and all content remains readable and accessible.

**Acceptance Scenarios**:

1. **Given** a viewport width below 480px, **When** summary cards render, **Then** they display in a single-column layout (1 card per row) without horizontal overflow.
2. **Given** a viewport width below 480px, **When** headings and metric values render, **Then** font sizes scale down proportionally (headings <=16px, metric values <=24px) while remaining legible.
3. **Given** a viewport width below 480px, **When** the filter bar renders in column layout, **Then** adequate spacing and padding exist between stacked controls for comfortable interaction.
4. **Given** a viewport width below 480px, **When** toast notifications appear, **Then** they span near-full width and avoid being clipped by device edges or notches.
5. **Given** a viewport width below 480px, **When** the comparison banner renders, **Then** it stacks vertically with reduced gap and appropriately sized text.

---

### User Story 5 - Complete Button and Input States (Priority: P2)

A user interacts with dashboard controls and expects consistent visual feedback for all interaction states. Currently, buttons lack `:active` (pressed) and `:disabled` states (except one specific button). Inputs lack hover states. Tab buttons have no disabled state. The user needs clear, consistent feedback for every interaction state across all controls.

**Why this priority**: Missing interaction states make the dashboard feel unfinished. Users cannot tell when a button is disabled or when they've successfully clicked/pressed a control. This is a professional polish issue that affects perceived quality.

**Independent Test**: Can be fully tested by tabbing through all interactive elements and verifying each shows appropriate visual states for hover, focus, active, and disabled conditions.

**Acceptance Scenarios**:

1. **Given** any primary or secondary button, **When** the user presses it, **Then** a visible `:active` state provides pressed/click feedback (e.g., slight darkening or inset effect).
2. **Given** a button that is contextually disabled (e.g., export with no data), **When** it renders in disabled state, **Then** it shows reduced opacity, `not-allowed` cursor, and does not respond to interaction.
3. **Given** any form input (select, date, search), **When** the user hovers over it, **Then** a subtle border color change provides hover feedback.
4. **Given** a tab that is unavailable (e.g., Predictions when ML is disabled), **When** it renders, **Then** it shows a visually muted disabled state distinct from the inactive state.

---

### User Story 6 - Actionable Error and Empty States (Priority: P2)

An analyst applies a narrow filter combination that returns no data. The current message "No data for selected range" provides no guidance on why data is missing or what to try next. Loading and error states use a 400px minimum height that consumes the entire screen on mobile. The analyst needs contextual, helpful messages that explain the situation and suggest next steps.

**Why this priority**: Generic error messages erode user confidence and create support burden. Enterprise users analyzing filtered data need to understand whether the issue is their filter selection, data availability, or a feature limitation.

**Independent Test**: Can be fully tested by triggering each empty/error state with specific filter combinations and verifying messages include contextual guidance.

**Acceptance Scenarios**:

1. **Given** a filter combination that returns no data, **When** the empty state renders, **Then** the message includes contextual hints (e.g., "No PRs found for the selected filters. Try widening the date range or adjusting team/repository filters.").
2. **Given** a mobile viewport below 480px, **When** loading or error states render, **Then** the minimum height is reduced (no more than 250-300px) to avoid consuming the entire screen.
3. **Given** a feature that requires additional configuration (e.g., predictions without ML setup), **When** the unavailable state renders, **Then** it includes a clear description and actionable guidance for enabling the feature.

---

### User Story 7 - Print-Friendly Dashboard View (Priority: P3)

An engineering manager wants to print or PDF the dashboard for inclusion in a quarterly review presentation. Currently, no print styles exist — the dashboard prints with filter bars, buttons, and interactive elements visible, resulting in a cluttered, unprofessional printout. The manager needs a clean, print-optimized view that shows only the data visualizations and metrics.

**Why this priority**: Print/PDF export is a common enterprise workflow for sharing dashboard snapshots in reports. While lower priority than interactive UX, it rounds out the professional presentation of the dashboard.

**Independent Test**: Can be fully tested by printing (or generating PDF from) the dashboard and verifying that interactive chrome is hidden, charts remain intact, and the output is clean and professional.

**Acceptance Scenarios**:

1. **Given** the user prints the dashboard, **When** the print rendering activates, **Then** interactive chrome is hidden (filter bar controls, action buttons, toasts, export dropdown, tab navigation, chip remove buttons, scroll affordances) while analytical context is preserved (active filter summary text, comparison period labels, filter hint banners, truncation indicators, chart legends and axis labels).
2. **Given** a chart spans a page boundary, **When** the print layout calculates, **Then** charts avoid breaking across pages (page-break-inside: avoid).
3. **Given** the dashboard background has colors and shadows, **When** the print rendering activates, **Then** the background is white, shadows are removed, and charts render at full container width for clean printing.

---

### User Story 8 - Refined Tab and Animation Transitions (Priority: P3)

A user switches between the Metrics, Predictions, and AI Insights tabs. The current 0.2s fade-in is functional but abrupt. There is no exit animation — content simply disappears. The user needs smooth, polished transitions that feel professional without being distracting.

**Why this priority**: Animations are a polish detail that contributes to perceived quality. The current implementation works but lacks the refinement expected in an enterprise product.

**Independent Test**: Can be fully tested by switching between tabs and verifying the transition feels smooth and professional, with no jarring content jumps.

**Acceptance Scenarios**:

1. **Given** the user switches tabs, **When** the new tab content appears, **Then** the fade-in animation duration is smooth enough to avoid jarring transitions (0.25-0.3s recommended).
2. **Given** the current tab content, **When** the user clicks a different tab, **Then** the transition feels cohesive and polished without being sluggish.

---

### Edge Cases

- What happens when a single throughput bar represents 0 PRs in a week? The bar should render at 0 height with the label still visible (current behavior — verify no regression).
- What happens when the author filter has 0 matching authors for a search term? The datalist should show an empty state gracefully, and the dashboard should not error.
- What happens when all filter chips are removed via the clear-all button? The active-filters container should animate out or hide smoothly.
- What happens when the dashboard renders in an iframe (ADO Extension context) at constrained widths? All responsive rules must work within iframe constraints, not just standalone viewports.
- What happens when the throughput chart renders exactly at the MAX_THROUGHPUT_POINTS boundary (104 weeks)? The truncation indicator should NOT appear when data fits exactly.
- What happens when the `.filter-hint` banner text is very long (e.g., "Comments coverage: partial (capped during extraction at 100 batches)")? The banner should wrap gracefully without overflowing the filter bar.
- What happens when a touch user attempts to interact with chart tooltip areas while scrolling? Touch interactions should not interfere with scroll gestures.
- What happens when print styles activate but the dashboard is in comparison mode? Both current and previous period data should print cleanly.

## Requirements *(mandatory)*

### Functional Requirements

#### Dense Data Readability (P1)

- **FR-001**: Dashboard MUST thin throughput chart week labels using a deterministic step algorithm: `labelStep = Math.ceil(barCount / maxVisibleLabels)` where `maxVisibleLabels` is a fixed constant (default: 16). Labels are rendered only at indices divisible by `labelStep`, counting from index 0 (the oldest visible week). When `barCount <= maxVisibleLabels`, all labels render. This produces identical output for the same bar count on every surface and run — no viewport-width dependency, no floating-point tie-breaks.
- **FR-002**: Dashboard MUST display a visible scroll affordance when the throughput bar chart overflows its container horizontally.
- **FR-003**: Dashboard MUST render truncation indicators in a prominent style (non-tertiary color, minimum 12px font, positioned above or at the top of the chart area) for throughput and cycle-time charts.
- **FR-004**: Dashboard MUST display a truncation badge or indicator on predictions charts and sparklines when `MAX_CHART_POINTS` or `MAX_SPARKLINE_POINTS` truncation is active.

#### Cross-Browser Filter Controls (P1)

- **FR-005**: Dashboard MUST define explicit CSS rules for the `.filter-hint` class with background color, padding, border accent, and adequate contrast — applied consistently to the comments coverage banner, reviewer constrained-mode notice, and author filter notice.
- **FR-006**: Dashboard MUST normalize the author filter `input[type="search"]` within safe limits of the native control — not replace it with a custom combobox. Normalization means: explicit height, border, border-radius, placeholder color, and focus ring via CSS; suppression of browser-specific chrome via `-webkit-appearance: none` and `::-webkit-search-cancel-button` styling where possible. The acceptance bar is visual consistency of the input field itself (height within 2px, border and focus ring identical). The datalist dropdown appearance is browser-native and NOT required to match across engines — only the input box is normalized.
- **FR-007**: Dashboard MUST style the reviewer constrained-mode notice with a warning-level visual treatment (amber/colored background, icon, clear label) to differentiate it from informational hints.

#### Touch Target Compliance (P1)

Touch targets are split into two tiers so implementation and CI enforce the same standard:

- **FR-008a**: **Critical controls** — filter chip remove buttons (×) MUST achieve a minimum 44x44px effective touch target (per WCAG 2.5.5 AAA). These are the smallest and most frequently mis-tapped elements on the dashboard.
- **FR-008b**: **Secondary controls** — small action buttons (apply dates, clear filters, export, compare), form selects, date inputs, export menu items, and tab buttons MUST achieve a minimum 36px effective height with proportional width. This is a pragmatic enterprise baseline that balances density with usability.
- **FR-009**: Chart tooltips MUST be accessible via tap/click interaction as a fallback for hover, following this interaction contract:
  - **Tap**: A single tap on a data point (bar, dot, or hover region) shows the tooltip anchored near the tapped element.
  - **Dismiss**: Tapping anywhere outside the tooltip, or tapping a different data point, dismisses the current tooltip.
  - **Scroll cancellation**: If a touch begins on a data point but the gesture becomes a scroll (movement exceeds 10px from origin), the tap is cancelled and no tooltip appears. The chart scrolls normally.
  - **No long-press**: Long-press is not used for tooltips; it is reserved for the browser's native context menu behavior.
- **FR-010**: Tab buttons MUST include proper ARIA attributes (`role="tab"`, `aria-selected`, `aria-controls`) for accessibility compliance.

#### Mobile Responsiveness (P2)

- **FR-011**: Dashboard MUST include a small-phone breakpoint (at or below 480px) with single-column summary card layout, reduced typography sizes, adjusted padding, and properly positioned overlay elements (toasts, export menus).
- **FR-012**: Font sizes for headings, metric values, labels, and chart text MUST scale down at the small-phone breakpoint to maintain visual hierarchy without overflow.
- **FR-013**: The comparison banner MUST stack vertically on viewports below 768px with reduced gap and appropriately sized period text.

#### Button and Input States (P2)

- **FR-014**: All buttons (primary, secondary, small variants) MUST define `:active` (pressed) and `:disabled` states with appropriate visual feedback.
- **FR-015**: Form inputs (select, date, search) MUST define a `:hover` state with subtle border feedback.
- **FR-016**: Tab buttons MUST support a disabled/unavailable visual state distinct from the inactive state.

#### Error and Empty States (P2)

- **FR-017**: Empty state messages MUST include contextual hints that help users understand why data is missing and what action to take (e.g., "Try widening the date range or adjusting filters").
- **FR-018**: Loading and error state containers MUST reduce their minimum height on mobile viewports (<=480px) to avoid consuming the entire screen.

#### Print Styles (P3)

- **FR-019**: Dashboard MUST include a `@media print` stylesheet with a clear scope boundary:
  - **Hidden (interactive chrome)**: filter bar controls, action buttons, toasts, export dropdown, tab navigation bar, filter chip remove buttons, scroll affordances.
  - **Preserved (analytical context)**: active filter summary text (e.g., "Filtering by: Team A, Repo X"), comparison period labels (e.g., "Current: Jan–Mar vs Previous: Oct–Dec"), filter hint banners (comments coverage, constrained mode notices), truncation indicators (so readers know data is partial), all chart containers with their legends and axis labels.
  - **Styling**: white background, no box-shadows, charts at full container width.
- **FR-020**: Charts MUST use `page-break-inside: avoid` to prevent splitting across printed pages.

#### Tab Animations (P3)

- **FR-021**: Tab content transitions MUST use a smooth fade duration (0.25-0.3s) with appropriate easing to feel polished without being sluggish.

### Key Entities

- **Truncation Indicator**: A UI element that communicates when a chart is displaying a subset of available data. Attributes: visibility state, data range shown, total data available.
- **Filter Hint Banner**: A styled notification element that communicates filter state information (coverage status, constrained mode, cross-dimensional limitations). Attributes: message text, severity level (info, warning), visibility state.
- **Touch Target**: The effective interactive area of a UI element, which may exceed its visual bounds via padding or hit-area expansion. Attributes: minimum dimensions, element type, current vs. required size.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Throughput chart label thinning is deterministic: for 104 bars with `maxVisibleLabels=16`, exactly `labelStep=7` is computed, labels render at indices 0, 7, 14, ..., 98 (15 labels total), and this output is identical across CLI, GitHub Pages, and ADO Extension surfaces — verified by automated DOM assertion counting rendered label elements.
- **SC-002**: All truncation indicators are rendered in a style that passes a prominence test — foreground color is not tertiary, font size is at least 12px, verified deterministically via DOM class and computed-style assertions.
- **SC-003**: The `.filter-hint` class renders with a visible background, border accent, and padding on the comments coverage banner, reviewer notice, and author notice — verified by automated DOM assertions across all three elements.
- **SC-004**: The author filter search input box renders with consistent height (within 2px tolerance) and identical border/focus-ring styling across Chrome, Firefox, and Edge. The datalist dropdown is explicitly excluded from cross-browser consistency requirements — verified by the existing cross-browser CI matrix and DOM dimension assertions on the input element itself.
- **SC-005**: Touch targets are verified in two tiers: (a) **critical controls** — filter chip remove buttons meet 44x44px minimum effective touch target; (b) **secondary controls** — small action buttons, form selects, date inputs, export menu items, and tab buttons meet 36px minimum effective height. Both tiers are verified by automated DOM dimension assertions that CI enforces on every run.
- **SC-006**: The dashboard renders without horizontal overflow at 375px viewport width — verified by automated DOM assertion that no element exceeds the viewport boundary.
- **SC-007**: All buttons define `:active` and `:disabled` CSS rules — verified by automated stylesheet parsing that confirms rule existence.
- **SC-008**: Empty state messages contain contextual guidance text (not just "No data") — verified by automated content assertion against known empty-state trigger conditions.
- **SC-009**: A `@media print` rule exists in the stylesheet that: (a) hides interactive chrome (filter controls, action buttons, toasts, export dropdown, tab bar); (b) preserves analytical context (active filter summary text, comparison labels, filter hint banners, truncation indicators); (c) sets white background and removes shadows — verified by automated stylesheet parsing and DOM visibility assertions under simulated print media.
- **SC-010**: All new and modified CSS rules, DOM structures, and interaction behaviors are covered by deterministic automated tests that run in CI without flakiness — zero tolerance for non-deterministic test assertions.
- **SC-011**: All changes maintain byte-identical demo data regeneration — verified by the existing determinism pipeline.
- **SC-012**: Dashboard parity between CLI, GitHub Pages, and ADO Extension is maintained — verified by the existing parity test suite passing with no regressions.

## Assumptions

- The enterprise demo dataset (260 weeks, 200 users, 23 repos) remains the canonical test fixture for all visual and scalability assertions.
- The existing JSDOM-based test harness (`dom-harness.ts`) and DOM assertion patterns (`innerHTML.toContain`, `querySelectorAll`, class assertions) are the established patterns for new tests. No visual regression testing framework (e.g., Percy, Playwright screenshots) is in scope.
- Chart tooltip tap/click fallback is implemented at the chart rendering level (TypeScript) with explicit scroll-cancellation logic (10px movement threshold). No long-press gestures are introduced — long-press remains reserved for the browser's native context menu.
- The label-thinning algorithm uses a fixed `maxVisibleLabels` constant (default: 16) and a pure integer formula (`Math.ceil(barCount / maxVisibleLabels)`). It has no viewport-width dependency — the same bar count always produces the same label set. This is a rendering-time calculation; the underlying data remains unmodified.
- The author filter remains a browser-native `input[type="search"]` with `datalist`. It is normalized (consistent height, border, focus ring) but NOT replaced with a custom combobox. The datalist dropdown is explicitly excluded from cross-browser visual consistency requirements.
- Touch targets are split into two CI-enforced tiers: **critical controls** (filter chip remove: 44x44px minimum) and **secondary controls** (small buttons, selects, menu items, tabs: 36px minimum height). These thresholds are enforced as separate test assertions.
- Print styles are CSS-only additions with no JavaScript print-detection logic. The scope boundary explicitly preserves analytical context (filter summaries, comparison labels, truncation indicators, hint banners) while hiding interactive chrome.
- All changes are purely presentational (CSS + minor rendering logic) and do not affect the data extraction pipeline, aggregation logic, or dataset schemas.
