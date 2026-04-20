# Accessibility Specialist Review — PR #302 (feature 059 Phase 1 drill-downs)

Branch: `059-us1-throughput` (6 commits ahead of `main`).
Scope: shared `DetailPanel` + four consumers (throughput / cycle-time / reviewer / sparkline) + comparison-mode advisory.
Reviewer: a11y + inclusive-design lens.
Standards cited: WCAG 2.1 (current relevant SCs), WAI-ARIA 1.2 / ARIA Authoring Practices.

---

## TL;DR

The DetailPanel surface gets the *structural* a11y right (dialog + aria-modal, aria-labelledby, accessible close button, focus trap with controller-cleanup). The trap itself, however, is functionally a "boundary trap" that does not advance focus mid-cycle, the synthetic chart triggers (`<div role=button>` bars and `<circle role=button>` dots) are not actually keyboard-reachable in production browsers without additional work, and the comparison-advisory toast has the wrong role/aria-live pairing for an interruption that ALSO must coexist with the persistent banner. Several FR-007/FR-008 paths look right in the unit tests but fail in the live-browser model.

**Counts**: P1 × 4, P2 × 6, P3 × 4. None are spec deviations from the consumer's intent — they are gaps between what the code asserts and what assistive tech actually observes.

---

## P1 — Must fix before merge

### P1-1. SVG `<circle>` cycle-time dots are not keyboard-focusable in any browser (WCAG 2.1.1 Keyboard, FR-007 / SC-006 violation)

`extension/ui/modules/charts/cycle-time.ts:285-286` renders the cycle-time data points as:

```html
<circle class="line-chart-dot" ... data-drilldown-week="..." data-drilldown-metric="p50" tabindex="0" role="button"/>
```

`tabindex` on an SVG element is **not honored** by any major browser without an explicit `focusable="true"` attribute, and even with that the support is uneven (Chromium and Firefox respect tabindex on inline SVG nodes only when the SVG itself participates in the focus order — which `extension/ui/modules/charts/cycle-time.ts` does, but only in recent Chromium / Firefox versions; Edge/IE11/Safari pre-13 historically did not). The only universally portable approach is to wrap each dot in a focusable host (an `<a>` with no `href` is *not* focusable; a `<g>` with `tabindex` has the same issue; the safe options are `<foreignObject><button>` or a sibling `<button>` that delegates a click to a programmatic shape).

Combined with the focus-trap empty-root tolerance below (P1-3), this means a *keyboard-only* user **cannot reach a P50/P90 dot** — drill-down on cycle-time is pointer-only. That violates SC-006 ("A keyboard-only user can open a drill-down panel … on every in-scope chart … without requiring pointer input.") and the FR-007 keyboard-operable contract for cycle-time drill-down.

The Jest test in `extension/tests/modules/drilldown/cycle-time-drilldown.test.ts` *appears* to pass keyboard-activation assertions but only because jsdom synthesizes a `keydown` event directly onto the circle and the delegated handler runs — jsdom doesn't model the platform focus-order rejection. This is an **uncovered cell** of the WCAG 2.1.1 / spec SC-006 test surface.

**Fix shape (do not act, recommend only)**: render each dot as a `<g role="button" tabindex="0">` containing the visible `<circle>` *and* an invisible `<rect>` for hit area; or move drill-down activation entirely off the `<circle>` and onto an overlaid `<button>` per data point inside a `<foreignObject>`. Either choice needs an explicit Playwright keyboard-tab smoke verifying `document.activeElement` reaches a dot.

### P1-2. Throughput `<div class="bar-container" role="button" tabindex="0">` is announced but lacks the keyboard-activation handler the role implies (WCAG 4.1.2 Name/Role/Value)

`extension/ui/modules/charts/throughput.ts:97` declares `role="button"` `tabindex="0"` on a `<div>`. The consumer drill-down module **does** wire delegated `keydown` for Enter/Space (`extension/ui/modules/drilldown/throughput-drilldown.ts:171-181`), so functionally activation works, but two SR-relevant gaps remain:

1. **No `aria-label`** — the `<div>` has only inner text from `bar-label` (a week label like "12") plus a hidden tooltip title. NVDA / JAWS will announce the role as "button" with the bare label "12", which is meaningless without context. WCAG 4.1.2 requires an accessible name that conveys the control's purpose.
2. **No `aria-pressed` / `aria-expanded` reflection of the `is-drilldown-active` state.** When a user opens the panel from a bar, the bar gains the `is-drilldown-active` outline (visible to sighted users). A SR user receives no equivalent signal. This is a violation of WCAG 4.1.3 Status Messages — the active-state change is communicated only visually.

Same diagnosis applies to `extension/ui/modules/charts/reviewer-activity.ts:180-181` (`.h-bar-row` carries `tabindex="0" role="button"` but no accessible name beyond the title attribute, and no aria-pressed reflecting the open panel) and to the cycle-time dots from P1-1.

**Recommended remediation**: add `aria-label="Drill down into week of {date-range} ({n} PRs)"` to bar containers; add `aria-pressed="false"` and toggle to `"true"` while `is-drilldown-active` is set. Same pattern for `.h-bar-row` and (after P1-1 fix) cycle-time dots.

### P1-3. Focus trap permits focus escape via "first" only — fails FR-007 in panels with multiple focusables under a real browser

`extension/ui/modules/shared/focus-trap.ts:62-85` handles only the **boundary** cases (active === first on Shift+Tab, active === last on Tab, or focus outside the root). When focus is on a *middle* focusable inside the root, the handler returns and the browser advances focus normally. In jsdom that's invisible because jsdom doesn't advance focus on Tab — the focus-trap tests at `extension/tests/modules/shared/focus-trap.test.ts:232-269` even *codify* this jsdom gap by asserting `defaultPrevented === false` and `activeElement === middle`.

In a real browser, this implementation is correct **only** when the panel happens to never contain external focusable elements. The DetailPanel currently appends `<aside>` to `document.body` *outside* the dashboard subtree but **siblings exist** — header buttons, tab buttons, filter chips, etc. Without `aria-hidden="true"` on the underlying `<main>` while the panel is open (or inert / `inert` attribute on it), focus can land on those siblings via Shift+Tab from the close button, since the trap only intercepts when the close-button-alone scenario triggers boundary detection.

**Test gap**: there is no test asserting that Shift+Tab from the *only* focusable element (the close button — typical state for an empty-state-only panel) wraps. Trap with one element: `first === last === closeBtn`, so the boundary check `active === first` *and* `active === last` both fire — Shift+Tab calls `last.focus()` (no movement), Tab calls `first.focus()` (no movement). That works. **But** if the panel contains a breakdown table (every Phase-1 panel does — title is a focusable region only via the heading), the table itself contains no focusable controls, so the only focusable IS still the close button. Functionally correct *for Phase 1* but fragile for Phase 2 when "per-PR row lists" enter the contract.

**Stronger fix**: also set `aria-hidden="true"` (or `inert`) on the rest of the document while the panel is open. WAI-ARIA Authoring Practices for Modal Dialog explicitly recommend this — `aria-modal="true"` alone is insufficient on the affected SR + browser combos (NVDA + Chromium especially). Today an SR user can keyboard-arrow into the underlying chart while the dialog is open.

### P1-4. Comparison-advisory toast has `role="status"` + `aria-live="polite"` but is also `pointer-events: none` and lives on `document.body` — won't survive `aria-hidden` cleanup, and "polite" is wrong for an interruption (WCAG 4.1.3, FR-061)

`extension/ui/modules/drilldown/comparison-advisory.ts:63-85` mounts:

```html
<div class="comparison-advisory-toast" role="status" aria-live="polite">
  Drill-down is unavailable during comparison. Exit comparison to use it.
</div>
```

Three issues here:

1. **`role="status"` is the implicit `aria-live="polite"` role**. The combination is redundant — and worse, *both* settings are mismatched with the UX contract in spec.md FR-061: "*A subsequent drill-down interaction attempt … MUST additionally surface an acknowledgement … reiterating why the action did not open a panel*". This is an *interruption* in response to a user action, not background status. The right ARIA pattern is `role="alert"` (which implies `aria-live="assertive"` + `aria-atomic="true"`) so the user immediately hears why their click did nothing.
2. **`pointer-events: none`** in `styles.css:3208` means a SR user using touch pointer cannot tap-focus or interact with the toast. That's fine *if* the announcement covers the message, but combined with the polite-live mismatch, on AT/browser combos that don't queue polite announcements until after the next focus change (NVDA in browse mode), the message is effectively lost.
3. **Banner + toast double-announce**: the persistent banner mounted by `mountBanner()` at `comparison-advisory.ts:139-149` uses `role="note"` (not announced). The toast's polite live re-announces the same text. With `role="alert"` change recommended in (1), if the banner already contains the same text the screen reader will read it twice if the user re-focuses the area. Recommend differentiating the banner's text from the toast's reactive text (banner: "Drill-down disabled during comparison."; toast: "Click ignored — exit comparison to drill down.")

### P1 summary

| ID    | Surface                       | Standard          |
| ----- | ----------------------------- | ----------------- |
| P1-1  | cycle-time `<circle>` dots    | WCAG 2.1.1, SC-006 |
| P1-2  | bar / row / dot accessible name + state | WCAG 4.1.2, 4.1.3 |
| P1-3  | focus-trap mid-cycle + outside-focus | WCAG 2.4.3, FR-007 |
| P1-4  | comparison-advisory-toast role / live | WCAG 4.1.3, FR-061 |

---

## P2 — Should fix

### P2-1. Reviewer-activity rows silently lose interactivity when the reviewer filter is dropped (WCAG 3.2.4 Consistent Identification, FR-040 ambiguity)

`extension/ui/modules/charts/reviewer-activity.ts:178-181` makes `data-drilldown-reviewer-id` / `tabindex="0"` / `role="button"` attributes **conditional** on `filterReviewerId` being set. That matches the design decision in `project_059_us1_us4_ship.md` ("aggregate-count rows have no single drill subject"). But the SR experience now is:

- With a filter set: rows are announced as "button, …".
- Without a filter set: rows are announced as plain text (no role).

A SR user toggling the filter has no aria-live notification that "rows are now interactive" or "rows are no longer interactive." This is the same root cause as the `is-drilldown-active` invisibility from P1-2: visible-only state.

**Recommendation**: add an `aria-live="polite"` status announcement in the reviewer chart subtitle area when the filter applies/lifts ("Click any week row to drill down" / "Filter a reviewer to enable drill-down").

### P2-2. Sparkline navigator advisory rendered via `renderNoData` lacks live-region semantics (WCAG 4.1.3, FR-052)

`extension/ui/modules/drilldown/sparkline-navigator.ts:78-90` renders:

```ts
const slot = document.createElement("div");
slot.className = ADVISORY_CLASS;
parent.appendChild(slot);
renderNoData(slot, "No full ${label} chart available on this page.", "...");
```

The advisory is visible but **not announced** — it has no `role="status"` and no `aria-live`. A keyboard / SR user activating a sparkline whose target is missing receives no feedback.

`renderNoData` itself (`extension/ui/modules/shared/render.ts:83-96`) creates a static `<p class="no-data">` with no live-region attributes — appropriate as a generic helper, but here it needs to wrap or be replaced with a live region. Simplest fix: set `slot.setAttribute("role", "status")` and `slot.setAttribute("aria-live", "polite")` before the `renderNoData` call.

### P2-3. Focus restoration silently fails when the trigger element was re-rendered between open and dismiss (FR-008)

`extension/ui/modules/shared/detail-panel.ts:469-479`:

```ts
const trigger = activeContext?.triggerElement ?? null;
if (focusTrapController) {
  if (trigger && trigger.isConnected) {
    restoreFocus(focusTrapController);
    trigger.focus();
  } else {
    restoreFocus(focusTrapController);
  }
  ...
```

When `trigger.isConnected` is `false` (panel was open, then a `FILTERS_CHANGED_EVENT` re-rendered the chart and replaced the bar nodes), `restoreFocus` falls back to the focus-trap's recorded return target. But the focus-trap's `returnTarget` was *also* the same trigger element — recorded at trapFocus time on `extension/ui/modules/shared/focus-trap.ts:49-52`. So both branches lose focus. Focus lands on `<body>`, which AT will read as nothing.

This is a real production scenario because `FILTERS_CHANGED_EVENT` triggers the dismiss (`detail-panel.ts:368-376`) but the dashboard re-render runs in the same tick *before* the dismiss handler can capture focus restoration. Tested only in `detail-panel.test.ts:294-310` which asserts dismissal but not subsequent focus location.

**Fix shape**: track a stable selector (chart container id + week-iso / metric / reviewer-id) on `DrillDownContext`, and on dismiss attempt to re-resolve the new equivalent trigger element via `document.querySelector` and focus *that* instead. Falls back to a known-safe element (the chart container's heading) if no match.

### P2-4. Sparkline navigator's `is-sparkline-highlight` reduced-motion fallback uses an *outline* — but on `<div id="cycle-time-trend">` that already gets focused/announced via Tab → loud double-affordance (WCAG 2.3.3 Animation from Interactions partial)

`styles.css:984-988`:

```css
@media (prefers-reduced-motion: reduce) {
    .is-sparkline-highlight {
        animation: none;
        outline: 2px solid var(--primary);
        outline-offset: 2px;
    }
}
```

The outline persists for `SPARKLINE_HIGHLIGHT_MS` (1500ms) then vanishes when the JS removes the class — but during that window if the user happens to Tab into the chart, the focus outline (also `var(--primary)`) is *invisible* against the highlight outline. The reduced-motion fallback should remove itself in <2s without changing focus indication. Recommend swapping the fallback to a brief background-color tint (`background-color: var(--primary-alpha-15)` etc.) to keep focus distinction intact.

Same critique applies to `is-drilldown-active` on the source bar (`styles.css:3157-3160`): it's a static `outline: 2px solid var(--primary)` that outlives focus changes. If a user Tabs within the panel and then Tabs into another chart while the panel is still open, the active bar's outline is indistinguishable from the focus ring. Suggest changing `is-drilldown-active` to use `box-shadow` or a `::after` indicator so focus ring stays unique.

### P2-5. Comparison-advisory banner uses `role="note"` — not announced when injected (WCAG 4.1.3)

`extension/ui/modules/drilldown/comparison-advisory.ts:144-149`:

```ts
const note = createElement(
  "div",
  { class: BANNER_NOTE_CLASS, role: "note" },
  ADVISORY_MESSAGE,
);
```

`role="note"` is for *static* annotations alongside primary content; it has no implicit live-region behavior. When comparison mode toggles on, the banner-note appears with no AT announcement. Given that `setChartDisabled(true)` simultaneously degrades the visual affordance on every chart, a SR user encounters non-functional drill-down with no warning.

**Fix**: change `role="note"` to `role="status"` (or wrap the banner region with `aria-live="polite"`) so injection on comparison-on / removal on comparison-off is announced.

### P2-6. Close button label uses "×" (multiplication sign) as text content — invisible to AT but `aria-label` overrides it correctly. **However** the mathematical-x glyph at 20px font-size is harder to perceive at low vision than a bona fide close icon.

`detail-panel.ts:213-221` — `aria-label="Close detail panel"` is correct (the AT name overrides the text content per accessible-name calculation), but the visual glyph is a low-contrast Unicode multiplication sign sized at 20px. WCAG 1.4.11 Non-text Contrast requires graphical UI controls to meet 3:1 against adjacent colors. With `color: var(--text-secondary)` it likely just passes in the default theme, but in the high-contrast variants (`styles.css` themes) it has not been spot-checked.

**Recommendation**: replace `×` with a CSS-drawn cross (two pseudo-elements) or an SVG icon, both of which can target `currentColor` and respect Windows High Contrast Mode (forced-colors). The text glyph today does **not** survive forced-colors mode — the button silhouette disappears.

---

## P3 — Nice-to-have

### P3-1. Sparkline button `aria-label="Open full {label} chart"` — works, but doesn't tell SR users *what will happen*

The wording suggests opening a panel/dialog. Actual behavior is "scroll to the existing chart on the same page and briefly highlight it." A better label: `aria-label="Scroll to ${label} chart"`. Cheap edit, big clarity win on screen-reader walk-through.

### P3-2. Detail panel sections use `<section>` but no `aria-labelledby` to its `<h3>` — sections are unnamed regions in landmark navigation

`detail-panel.ts:271-302`. AT users navigating by region (e.g., NVDA's `D` key) hit "section" with no name. Add `aria-labelledby={uniqueId}` and assign the same id to the `<h3>` inside. Pure polish but low-cost.

### P3-3. `is-drilldown-active` outline color is `var(--primary)` — same as focus ring; partial-color-blindness users may struggle to distinguish active source from focused element in the chart row containing both

Mitigated by P2-4 (using box-shadow for active-state). Filing here separately for visibility under WCAG 1.4.1 Use of Color.

### P3-4. The sparkline trigger `<button>` wraps an `<svg>`, but the SVG is `pointer-events: none` — fine for interaction, but it also means the SR user navigating *inside* the button (jaws virtual cursor) hears nothing useful from the SVG. Add `<title>` inside the SVG describing the trend, or `<desc>` summarizing what the sparkline shows. Currently the only descriptor is the button's `aria-label`, which is metric-name-only.

---

## Reduced-motion audit summary

| Surface                              | Honors `prefers-reduced-motion`?        | Notes                                                    |
| ------------------------------------ | --------------------------------------- | -------------------------------------------------------- |
| `.detail-panel.is-open` transition   | Yes (`styles.css:3162-3166`)            | OK                                                       |
| `.is-sparkline-highlight` animation  | Yes — but outline fallback collides w/ focus ring | See P2-4                                                 |
| `.comparison-advisory-toast` slide-in | Yes (`styles.css:3223-3227`)            | OK                                                       |
| Sparkline `scrollIntoView`           | Yes (`sparkline-navigator.ts:126`)      | Honored — uses `auto` instead of `smooth`                |
| Other drill-down state changes       | N/A (no animations)                     | OK                                                       |

The three required surfaces from the assignment brief (panel open, sparkline highlight, comparison toast) are all individually honored. The defect surfaces only when fallbacks **interact** with focus indication (P2-4) or with one another.

---

## Focus-management audit summary

| Dismiss path                | FR-008 focus restored to trigger?                   | Verified by                        |
| --------------------------- | --------------------------------------------------- | ---------------------------------- |
| Escape                      | Yes (jsdom)                                         | `detail-panel.test.ts:247-261`     |
| Outside click               | Yes (jsdom)                                         | `detail-panel.test.ts:263-272`     |
| Filters changed             | **Likely no** in production — see P2-3              | not tested                         |
| Tab changed                 | Likely no in production — same root cause as filters; chart re-renders may detach trigger | not tested |
| Comparison toggled          | Same as tab-changed — chart container repaints      | not tested                         |
| Explicit close button       | Yes (jsdom)                                         | `detail-panel.test.ts:283-292`     |

The three "passes in jsdom" cells are a substitute for actual focus-restoration testing — Playwright would catch the production failures. SC-006 requires the keyboard-only journey to work end-to-end *on every dismissal path*; today only three of six are demonstrably correct.

---

## Notes on non-issues (to short-circuit follow-up review)

- DetailPanel's `role="dialog" aria-modal="true" aria-labelledby="detail-panel-title"` triple is correct.
- `escapeHtml` usage on every interpolated drill-down attribute prevents XSS — orthogonal to a11y but worth noting.
- The empty-trap defensive case (`focus-trap.ts:67-71`) is correct: it preventDefaults Tab so focus does not escape, even when no focusables exist.
- The lifecycle-signals event surface is well-isolated; SR-state derivation from those events is feasible if recommended P2-1 / P2-5 are taken.
- `closeBtn.focus()` is the implicit first focus when panel opens — confirmed via `detail-panel.test.ts:182-199` (the only focusable in an empty-state-only panel). Matches WAI-ARIA Modal Dialog Pattern.

---

## What I did not review (out-of-scope per assignment)

- Color contrast ratios in the dark-mode theme.
- VS Code webview iframe CSP impact on SR-detection of injected nodes.
- Translation / i18n — all advisory strings are hard-coded English.
- Touch-target size (WCAG 2.5.5) on the sparkline-trigger and bar-container — visually plausible but not measured.

These are flagged for completeness; none are P1 to my read, but a later a11y QA pass should cover them before the Phase-2 work in #300.
