# Research: Dashboard UX Polish

**Branch**: `036-dashboard-ux-polish` | **Date**: 2026-03-22

## R-01: Label Thinning Algorithm Design

**Decision**: Deterministic index-modulo thinning with a fixed `MAX_VISIBLE_LABELS = 16` constant.

**Rationale**: The throughput chart renders labels inside a `.map()` loop at `throughput.ts:48-61`. Each bar gets a `.bar-label` div unconditionally. The simplest deterministic approach is to compute `labelStep = Math.ceil(barCount / MAX_VISIBLE_LABELS)` and only emit label text at indices divisible by `labelStep` (counting from index 0). This is viewport-independent, produces identical output on all surfaces, and requires no CSS-nth-child complexity.

**Implementation point**: `throughput.ts:48-61` — inside the `.map()` callback, wrap the label content in a conditional: render `escapeHtml(weekLabel)` when `index % labelStep === 0`, render empty string otherwise. The `.bar-label` div element is always emitted (preserves flex spacing), but its text content is conditionally empty.

**Alternatives considered**:
- CSS `nth-child` selectors: Rejected — can't express `ceil(N/16)` in pure CSS, and adding a viewport dependency would break cross-surface parity.
- Viewport-width-based calculation: Rejected — introduces non-determinism since CLI, ADO Extension, and GitHub Pages have different viewport contexts.
- Removing `.bar-label` elements entirely: Rejected — removing elements changes flex layout spacing, which would require compensating CSS changes.

---

## R-02: Tooltip Tap/Click Implementation Strategy

**Decision**: Extend existing `addChartTooltips()` in `charts.ts:126-163` with click handler and scroll-cancellation logic. Also add click-based tooltips to throughput bars (currently using native `title` attributes only).

**Rationale**: The shared tooltip utility uses `mouseenter`/`mouseleave` events on elements matching `[data-tooltip]` selectors. The cycle-time chart calls this after rendering dots. The throughput chart uses only HTML `title` attributes with no JavaScript handlers. The tooltip positioning logic (`rect.left + rect.width/2`, `rect.top - 8px`) is already implemented and reusable.

**Implementation approach**:
1. Add `click` event handler alongside existing `mouseenter`/`mouseleave` in `addChartTooltips()`.
2. Track touch state: on `pointerdown`, record `{x, y}` origin. On `pointerup`, if movement < 10px, treat as tap and show tooltip. If movement >= 10px, cancel (scroll gesture).
3. Dismiss: click on document body (outside tooltip) closes active tooltip.
4. For throughput bars: add `data-tooltip` attribute and call `addChartTooltips()` with a content function that reads `title` attribute data. Remove native `title` attributes (they conflict with custom tooltips by showing browser-native tooltip on hover).

**Key finding**: Potential selector bug in `addChartTooltips()` — it queries `[data-tooltip]` but cycle-time dots don't have that attribute. This should be investigated and potentially fixed as part of this work.

**Alternatives considered**:
- Separate touch tooltip module: Rejected — the existing utility already handles positioning and lifecycle; extending it is simpler than a parallel system.
- CSS-only tooltips via `:hover`/`:focus`: Rejected — can't implement scroll-cancellation or dismiss-on-tap-elsewhere in pure CSS.

---

## R-03: Filter Hint Styling Approach

**Decision**: Define a `.filter-hint` CSS class with info and warning severity variants.

**Rationale**: Three elements use `class="filter-hint hidden"` in `index.html` (lines 105, 124, 130) but **no CSS rules exist** for `.filter-hint`. Content is set via `textContent` in `dashboard.ts` and visibility is toggled via `.hidden` class (`.classList.add/remove("hidden")`). All three elements are inline `<div>` elements within the filter bar.

**Implementation**:
- Base `.filter-hint`: `padding: 8px 12px`, `border-radius: var(--radius)`, `font-size: 13px`, `border-left: 3px solid var(--info)`, `background: var(--bg-secondary)`, `color: var(--text-secondary)`, `margin-top: 4px`.
- Warning variant `.filter-hint.filter-hint-warning`: `border-left-color: var(--warning)`, `background: #fff8e1` (light amber). Applied to reviewer constrained-mode notice.
- The reviewer notice in `dashboard.ts:1659-1667` would get an additional `.filter-hint-warning` class toggle when showing constrained mode.

**Alternatives considered**:
- Dedicated banner component: Rejected — over-engineered for 3 text-only elements. CSS class is sufficient.
- Styled via inline styles in dashboard.ts: Rejected — violates separation of concerns and makes testing harder.

---

## R-04: CSS Testing Strategy in JSDOM

**Decision**: Use a three-layer testing approach — DOM structure assertions (JSDOM), stylesheet parsing (string/regex), and CSS contract constants.

**Rationale**: JSDOM does not evaluate media queries, load external stylesheets, or compute layout dimensions. The existing test patterns use `innerHTML.toContain()`, `querySelectorAll()`, `classList.contains()`, and data attribute checks. These are reliable and deterministic.

**Testing layers**:
1. **DOM structure tests** (JSDOM): Verify that rendering functions emit correct CSS classes, data attributes, and inline styles. Example: label thinning test verifies `.bar-label` elements have expected text content (non-empty at thinned indices, empty otherwise).
2. **Stylesheet contract tests** (new): Read `styles.css` as a string and use regex assertions to verify rule existence. Example: verify `.filter-hint` rule exists, verify `@media print` block exists, verify `.btn:disabled` rule exists. This is deterministic and doesn't require JSDOM CSS evaluation.
3. **CSS contract constants**: Export key constants (touch target sizes, label limits) from TypeScript and assert them in tests. Example: `expect(MAX_VISIBLE_LABELS).toBe(16)`, `expect(CHIP_REMOVE_MIN_SIZE).toBe(44)`.

**Alternatives considered**:
- Playwright visual regression: Rejected — not in scope per spec assumptions. Could be added later.
- `getComputedStyle()` assertions: Rejected — JSDOM returns default values, not stylesheet-derived values.
- CSS-in-JS: Rejected — existing architecture uses external CSS file; changing architecture is out of scope.

---

## R-05: Author Filter Normalization Scope

**Decision**: Normalize the native `input[type="search"]` with explicit CSS; accept browser-native datalist dropdown.

**Rationale**: The author filter at `index.html:128` uses `<input type="search" list="author-filter-options">` with a `<datalist>`. Browser-native datalist rendering varies substantially (Chrome shows a dropdown, Firefox shows inline suggestions, Edge varies). Replacing with a custom combobox would require significant JavaScript and accessibility work beyond polish scope.

**Implementation**: Add explicit CSS rules for `input[type="search"]` in the filter-group context: normalize height to match other inputs (padding: 6px 12px → 8px 12px for touch compliance), add `-webkit-appearance: none` to suppress browser chrome, style `::-webkit-search-cancel-button`, set explicit placeholder color. The datalist dropdown remains browser-native.

---

## R-06: Print Scope Boundary

**Decision**: Hide interactive chrome; preserve analytical context elements.

**Rationale**: Enterprise users print dashboards for quarterly reviews. The print output should be self-explanatory without the interactive controls, meaning filter summaries, comparison labels, and data-quality notices must remain visible. Truncation indicators must remain so readers know the printed data is partial.

**Preserved elements**: `#active-filters` (filter summary text), `.comparison-banner` (period labels), `.filter-hint:not(.hidden)` (coverage/constrained notices), `.truncation-indicator`, chart legends, axis labels.
**Hidden elements**: `.filter-bar` controls (dropdowns, inputs, buttons), `.btn`, `.toast`, `.export-menu`, `.tabs` navigation, `.filter-chip-remove` buttons, scroll affordances.

---

## R-07: Touch Target Implementation

**Decision**: Use CSS padding and minimum dimensions; split into critical (44px) and secondary (36px) tiers.

**Rationale**: The touch specialist audit found filter chip remove buttons at ~14x14px, small buttons at ~22px, dropdowns at ~28px. WCAG 2.5.5 AAA requires 44x44px. A pragmatic enterprise baseline uses 44px for the most-tapped small control (chip remove) and 36px for secondary controls that have larger visual footprints.

**Implementation**:
- `.filter-chip-remove`: Add `min-width: 44px`, `min-height: 44px`, `display: inline-flex`, `align-items: center`, `justify-content: center`. Use negative margin or adjusted chip padding to avoid bloating visual chip size.
- `.btn-small`: Increase padding from `4px 12px` to `8px 12px` (height ~32px → ~36px).
- `.filter-group select`, `.filter-group input`: Increase padding from `6px 12px` to `8px 12px` (height ~28px → ~36px).
- `.export-option`: Increase padding from `10px 16px` to `12px 16px` (height ~33px → ~37px).
