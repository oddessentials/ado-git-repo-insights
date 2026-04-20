# ado-extension-ui-specialist review — PR #302 (feature 059 Phase 1)

**Reviewer**: ado-extension-ui-specialist
**Branch**: `059-us1-throughput` (6 commits ahead of `main`)
**Scope**: Azure DevOps platform-nuance audit of feature 059 Phase 1 drill-down consumers — webview/iframe behavior, theme variables, a11y inside the ADO host, lifecycle interactions with the ADO SDK.
**Conclusion**: Implementation reuses established ADO-extension patterns (single-theme CSS variables, `position: fixed` + `getBoundingClientRect()`, host-resize via `SDK.resize`). Most platform-nuance risks are inherited (and pre-existing) rather than newly introduced. Two findings are net-new and tied to the iframe boundary.

Findings are keyed to the seven focus areas in the brief.

---

## P1 (must fix before merge)

### P1-1 — `scrollIntoView({block: "center"})` is a no-op inside the height-synced ADO iframe; sparkline navigation will silently fail in ADO (FR-050 SC-001 violation)

**Location**: `extension/ui/modules/drilldown/sparkline-navigator.ts:127`

```ts
targetEl.scrollIntoView({ behavior, block: "center" });
```

**ADO platform behavior**: The dashboard runs inside an ADO extension iframe whose height is continuously synchronized to `document.body.scrollHeight` via `SDK.resize()` (`extension/ui/modules/sdk.ts:376` calls `SDK.resize`, and `extension/ui/modules/shared/host-resize.ts:23-29` wires this to the iframe content height). In production this means **the iframe itself never grows a vertical scrollbar** — the host page scrolls, not the iframe.

`Element.scrollIntoView()` walks up the **scrollable ancestor chain inside the same document** until it finds a scrolling container. Inside the iframe document none of the ancestors of `#throughput-chart` / `#cycle-time-trend` / `#reviewer-activity` ever overflow (because `body` is sized to fit), so the algorithm bottoms out at `documentElement` and finds nothing to scroll. `scrollIntoView` does **not** cross the iframe boundary into the parent (`document.parentWindow`) by spec — that requires explicit `parent.scrollTo` or a `postMessage` to the host (which the ADO SDK does not expose for arbitrary scroll positions).

**Symptom in ADO**: User clicks a sparkline near the top of the dashboard while the host page has scrolled them well past the full chart. The `is-sparkline-highlight` class fires correctly and animates, but the user's viewport does not move — they hear nothing, see nothing in their visible area, and the highlight self-dismisses 1500ms later having flashed off-screen. SC-001 ("contextual response within 1 second") is violated because the contextual response is invisible.

**Why local Jest tests pass**: jsdom stubs `scrollIntoView` to a no-op (the test in `sparkline-navigator.test.ts:91` even spies on it as `jest.fn()`); demo at `/docs` runs at the top of a normal HTML document where `documentElement` IS the scroll root, so `block: "center"` works there. This is the canonical "demo-green / ADO-broken" trap called out in the focus-area-7 brief.

**Counter-evidence (must investigate before fixing)**: `extension/ui/modules/typeahead-dropdown.ts:447` already calls `scrollIntoView({ block: "nearest" })` and works inside the dropdown listbox — but that case is a **scrollable `<ul>` with overflow-y: auto inside the iframe document**, which is exactly the kind of internal scrolling container the algorithm is designed for. The chart containers in feature 059 are page-level blocks with no ancestor that scrolls.

**Resolution path** (do NOT implement; flagging for owner judgment):

1. Verify the symptom by deploying to a real ADO project or by adding a Playwright test that loads `dist/ui/index.html` inside an `<iframe height="3000">` and asserts `window.scrollY` (of the parent) changes after sparkline activation. The smoke test at `extension/tests/smoke-render.test.ts` and the playwright config already exist and can host this.
2. If confirmed, the conventional ADO-extension fix is: compute `targetEl.getBoundingClientRect().top + window.scrollY` (window of the iframe), then because scrolling the iframe window is itself a no-op, **post a message to the host or call `window.parent.scrollBy(0, delta)`** — but `window.parent` access from an extension iframe is blocked cross-origin in ADO. The realistic fix is to ensure the iframe is resized so the target is already in view (which it is, by definition of host-resize), then **scroll the host page** via `window.scrollTo(0, targetEl.offsetTop)` on the iframe `window` won't help, leaving only `SDK.resize()` resetting the page height to force the host to re-layout. None of these are clean.
3. Alternative: convert the sparkline to navigate via the URL-fragment approach (`location.hash = "#throughput-chart"`) — the host honors fragment changes by scrolling the iframe into view at the new fragment position. This is documented behavior in the ADO extension SDK and is what the dashboard currently lacks but should adopt.

This is a P1 because (a) the entire user-story-4 user value depends on it, (b) the symptom is silent (no error in console — `scrollIntoView` returns void), and (c) there is no Jest assertion that can detect this — only an in-browser test inside an iframe.

### P1-2 — Comparison-advisory toast and DetailPanel can be visually obscured by the existing top-right `.toast` (z-index 1000) in production

**Locations**:
- `extension/ui/styles.css:3024` — `.detail-panel { z-index: 100 }`
- `extension/ui/styles.css:3207` — `.comparison-advisory-toast { z-index: 110 }`
- `extension/ui/styles.css:648` — pre-existing `.toast { z-index: 1000 }` (used by `showToast` for export / copy-link / download confirmations)

**ADO platform behavior**: When a user clicks "Export CSV" / "Copy link" / "Preparing download…" the dashboard mounts a top-right `.toast` at z-index 1000. Several of these (e.g. `dashboard.ts:2132 "Preparing download..."`) live for the duration of an artifact-client RPC, which on a slow corp network is multiple seconds. If the user opens a drill-down panel during that window — or if the comparison-advisory toast appears on a chart click while the export toast is still up — the new drill-down surfaces will render **underneath** the export toast.

**Symptom in ADO**: Comparison-advisory toast (which is z-index 110 and `position: fixed` to the bottom-right area near the clicked chart) gets clipped behind the bottom-right export `.toast`. Detail panel's right-aligned 420px column likewise gets a 24px top-right slice covered by the existing toast. Users see "stuck" toasts overlapping the new panel header.

**Why this is new**: Pre-feature-059 the dashboard had no overlay at all besides tooltips and the export toast. The export toast living at z-index 1000 was sized for "I'm above tooltips and chrome" — drill-down adds two new overlay families that share the same screen real estate.

**Why this is new but a pre-existing-style issue**: The dashboard's `.toast` and tooltip layering was already inconsistent (tooltip z-index 100, info-tooltip 150, toast 1000). Feature 059 inherits the inconsistency rather than creates it — but it makes it user-visible for the first time because the new overlays compete for screen geometry near the same regions.

**Resolution path** (owner judgment): Either bump `.detail-panel` and `.comparison-advisory-toast` above 1000, OR add a `dismissAllToasts()` step at panel-open time analogous to the existing `dismissAllTooltips()` step in `throughput-drilldown.ts:136`. The latter is more conservative — the user asked for the panel; the export toast can be re-shown if needed. Either way, this is P1 because the visual collision is unambiguous and unavoidable (anyone who clicks export and then a chart bar within ~3 seconds will see it).

---

## P2 (should fix before merge)

### P2-1 — `position: fixed` modal dialog inside iframe: no `<dialog>`-element fallback for the host's "click away from extension" gesture

**Location**: `extension/ui/modules/shared/detail-panel.ts:413-454` (`openDetailPanel`); CSS at `extension/ui/styles.css:3010-3030`

**ADO platform behavior**: The detail panel uses `position: fixed; right: 0; top: 0; bottom: 0` inside the iframe. `position: fixed` inside an iframe is fixed relative to the **iframe viewport**, not the host page viewport. Because the iframe's height is dynamically synchronized to body height via `SDK.resize()` (host-resize.ts:23-29 sends `targetHeight = max(bodyHeight, docHeight)`), the iframe is typically *taller* than the host visible area at any given moment.

**Symptom in ADO**: When the user opens a drill-down panel on the throughput chart (top of iframe), the panel `<aside>` is `top: 0; bottom: 0` inside the iframe — it spans the entire iframe height, which is e.g. 4000px. The host scrolls; the panel scrolls with the host because it is fixed *inside the iframe*. The user can scroll past the panel and lose visual access to the close button at top. The bottom of the panel is also chained to the bottom of the iframe at 4000px, well below the user's visible viewport.

**Counter-evidence**: This is the same constraint the existing `.toast` at `bottom: 24px; right: 24px` already lives under in production; the existing tooltip-manager uses `position: fixed` with viewport bounds + a scroll-dismiss listener (`tooltip-manager.ts:131-142`). So the iframe constraint is not novel — but those overlays are short-lived (a tooltip lives until the next pointer event; a toast self-dismisses in ~3s) whereas the detail panel is **persistent until explicit dismiss**. The persistence is what makes the position-fixed-in-iframe constraint user-visible.

**Resolution path**: The cleanest fix is to render the panel using the native `<dialog>` element (`HTMLDialogElement`) with `showModal()`, which the browser correctly anchors to the *top layer* and renders independently of the iframe's scroll position. `<dialog>` is supported in all browsers ADO supports (Edge 124+, Chromium 120+, Safari 15.4+). This also gives focus trap and escape-key handling for free, removing dependency on `extension/ui/modules/shared/focus-trap.ts`.

If `<dialog>` is out of scope for Phase 1, an interim fix is to compute `panel.style.top = window.scrollY + "px"` on every iframe scroll event (the iframe window does receive scroll events even when host-resize prevents an iframe scrollbar). This matches the pattern the existing tooltip manager uses (`tooltip-manager.ts:99` re-positions on scroll via `ensureScrollDismissListener`).

P2 (not P1) because the panel does close on outside-click, so a scrolled-past panel is still escapable — but the user-experience friction of "close button is off-screen" is real.

### P2-2 — Comparison-advisory banner mounts inside `#comparison-banner` which is `display: none` (`.hidden` class) when comparison is OFF; banner is invisible at the very moment the advisory is needed

**Location**: `extension/ui/modules/drilldown/comparison-advisory.ts:139-149` (`mountBanner`); `extension/ui/index.html:148` (banner has `class="comparison-banner hidden"`)

**ADO platform behavior**: The comparison-advisory module mounts its banner note inside `#comparison-banner` whenever `COMPARISON_TOGGLED_EVENT` fires with `enabled: true`. The mount is correct — but the lifecycle is subtly fragile inside ADO: `dashboard.ts:1971` calls `elements.get("comparison-banner")?.classList.remove("hidden")` only inside the comparison-on flow. The advisory module subscribes to the comparison toggle independently and mounts its note inside the same `#comparison-banner`. Race-free in test, but in ADO production:

- `COMPARISON_TOGGLED_EVENT` fires inside `toggleComparisonMode()` (dashboard.ts:1911 per lifecycle-signals contract).
- The dashboard's own DOM-update path *also* runs `updateComparisonBanner()` after the same toggle.
- Both mutate `#comparison-banner` in the same synchronous tick — but the order is **publishComparisonToggled → comparison-advisory listener fires → banner-note appended → updateComparisonBanner runs → comparison-banner classList.remove("hidden")**.

The order is correct in this PR, but is enforced by the dashboard.ts code-site sequencing only. There is no test that locks the order. If a future edit moves `publishComparisonToggled` after `updateComparisonBanner`, the advisory banner will appear **inside a still-hidden parent** and be invisible to the user — exactly the SC-003 failure ("100% of drill-down attempts produce a visible cue") that the spec calls out as a hard requirement.

**Resolution path**: Add a lifecycle-signals.test.ts assertion that `#comparison-banner` does NOT carry the `hidden` class at the moment `comparison-advisory.mountBanner` is invoked. (This needs the test to install a MutationObserver inside a beforeEach.) Alternatively, comparison-advisory could `classList.remove("hidden")` on the banner itself before appending — making it self-defending against ordering changes elsewhere.

### P2-3 — `aria-modal="true"` on `<aside class="detail-panel">` does not create a real modal in ADO's outer host page; screen-reader users behind the iframe boundary still hear ADO chrome

**Location**: `extension/ui/modules/shared/detail-panel.ts:202`

**ADO platform behavior**: `aria-modal="true"` is a hint to the assistive technology that the dialog is *application-modal* — i.e., the AT should treat content outside the dialog as inert. NVDA + Edge respect this within a single document. **However, when the dialog is inside a webview iframe**, NVDA still presents the parent ADO host (left nav, breadcrumbs, header) as part of the document tree because the `aria-modal` attribute does not propagate across the iframe boundary. The ADO host has no way to know our iframe wants modal semantics in the host's a11y tree.

**Practical impact for NVDA + Edge**: Tab key respects the focus trap in our `focus-trap.ts` (it's keyboard-only and stays inside the iframe), so keyboard navigation IS correctly modal. **Reading-cursor navigation** (NVDA's `Down` arrow, JAWS's virtual cursor) is NOT modal-bound — a screen-reader user reading by line will read past the panel into the rest of the iframe content, and via the host's content into ADO chrome.

**Why this matters**: SC-006 ("a keyboard-only user can open a drill-down panel … without requiring pointer input") is satisfied; but the *implicit* claim of `aria-modal="true"` (modal reading semantics) is not satisfiable inside a webview iframe.

**Resolution path**: Either drop `aria-modal="true"` (since the contract cannot be honored and overclaiming is misleading per the [no overclaim feedback](C:\Users\petep\.claude\projects\E--projects-ado-git-repo-insights\memory\feedback_closure_language_no_overclaim.md)) and re-document as a `role="region"`-style overlay; or set `aria-modal="true"` plus `inert` (HTMLElement.inert API) on every sibling of the panel root *within the iframe document* — at least we'd be modal within the iframe. The current state is "claimed-modal but not structurally modal."

P2 because: (a) the focus trap delivers the keyboard-modal experience that real users mostly need, (b) reading-cursor leakage is a legitimate but minority screen-reader concern, (c) this is a lens that the dedicated accessibility specialist will weigh in on more authoritatively — but ADO platform-specifically, it's worth noting because "aria-modal in a webview" is a real platform constraint, not just an a11y nicety.

### P2-4 — CSS uses fixed light-theme color values (`--primary: #0078d4` hardcoded); ADO Dark Theme users see white-bg panel against dark host chrome

**Location**: `extension/ui/styles.css:6-25` (`:root` block defines hardcoded light-theme colors)

**ADO platform behavior**: Azure DevOps supports a Dark Theme that the user can enable via account preferences. Modern hub extensions are expected to honor the host theme by reading from ADO's documented theme variables (`--communication-foreground`, `--text-primary-color`, `--background-color`, `--neutral-2`, `--neutral-30`, etc., exposed by `DevOps.UI` styles when extensions opt in). Some extensions also subscribe to `prefers-color-scheme` as a coarse fallback.

The drill-down code introduces no new theme dependence — but the entire feature inherits the dashboard's existing light-theme-only design system (line 7-25 of styles.css hardcodes #ffffff backgrounds, dark-grey text). This is **a pre-existing limitation**, not a feature-059 regression — but feature 059 makes the limitation **more visible to dark-theme users** because:

- `.detail-panel` covers a larger visual area than any prior overlay (420px column).
- `.comparison-advisory-toast` uses `background: var(--text-primary)` (`#323130`) and `color: var(--bg-primary)` (`#fff`) — this happens to be readable in both themes by accident. The detail panel itself uses `background: var(--bg-primary)` (white) — which against a dark ADO host will look like a stark white slab pasted over the dashboard.

**Why this is P2 not P1**: The constraint is pre-existing and applies to the entire dashboard already (charts, summary cards, headers). A user on Dark Theme already sees a light slab where the dashboard is. Phase 1 amplifies that surface area but does not cross any new boundary. **However**: I did not find any test or spec note acknowledging "feature 059 deliberately preserves the dashboard's light-theme-only stance" — this should be documented somewhere if intentional, so a future reviewer doesn't introduce a token-styled overlay in a follow-up PR thinking the dashboard is theme-aware.

**Resolution path**: Document the light-theme-only stance in `data-model.md` or in a CSS-leading comment on the `:root` block. No code change required.

---

## P3 (nice-to-have)

### P3-1 — `data-drilldown-target-chart` map is duplicated as a `const` and as if/else branches (`sparkline-navigator.ts:39-43` and `sparkline-navigator.ts:50-53`)

**Location**: `extension/ui/modules/drilldown/sparkline-navigator.ts:39-53`

```ts
const TARGET_ID_BY_CHART = {
  throughput: "throughput-chart",
  "cycle-time": "cycle-time-trend",
  reviewer: "reviewer-activity",
} as const;

function targetIdFor(chart: TargetChart): string {
  if (chart === "throughput") return TARGET_ID_BY_CHART.throughput;
  if (chart === "cycle-time") return TARGET_ID_BY_CHART["cycle-time"];
  return TARGET_ID_BY_CHART.reviewer;
}
```

The `if/else` chain only exists to satisfy ESLint's `security/detect-object-injection` rule (per the existing pattern at `reviewer-drilldown.ts:64-66` which uses `new Map(Object.entries(map))` for the same reason). Both forms are correct; both are well-commented. But the if/else duplication risks falling out of sync if a fourth chart is added in Phase 2 (the const adds a key; if/else needs a new branch — and adding to one without the other compiles cleanly under TypeScript because `targetIdFor` returns a fallback, but silently misroutes the new chart). Consider unifying with a `Map` lookup as the reviewer-drilldown does, or with a `switch` statement that an exhaustiveness check can lock at the type level.

P3 because Phase 1 only has three charts and the branches are exhaustive today.

### P3-2 — `MutationObserver` on `aside.detail-panel` class is created per-install per-chart (3 of them) — not freed across `dispose()` if the panel is mid-close-animation

**Location**: `extension/ui/modules/drilldown/throughput-drilldown.ts:114-126` (and parallel sites in cycle-time / reviewer drill-downs)

Each per-chart drill-down installs its own `MutationObserver` on the **shared** `<aside class="detail-panel">` root inside `registerPanelObserver()`. When `refreshMetrics()` re-installs all three drill-downs on every cycle, the previous cycle's observers are disconnected via `dispose()` (`throughput-drilldown.ts:185-189`). Observers in the current cycle disconnect themselves the moment the panel loses `is-open` (line 119).

This is correct, but ADO's `refreshMetrics()` cycles are common (every filter change, every comparison toggle, every dataset refresh, every URL deep-link restore — the [`feedback_deeplink_emits_for_event_guards.md`](C:\Users\petep\.claude\projects\E--projects-ado-git-repo-insights\memory\feedback_deeplink_emits_for_event_guards.md) memory notes deep-link restore emits filter events). A single user session can rack up dozens of `MutationObserver` create-then-dispose pairs. jsdom doesn't catch leaks; Chromium handles them cleanly; but in older Edge (Chromium 100-110, which ADO Server users may still hit) MutationObservers held by a closed-over abort signal historically have been GC-resistant for ~10s after `disconnect()`. Watch for memory growth in long ADO Server dashboard sessions.

P3 because (a) modern Edge doesn't have this, and (b) the observers DO disconnect — this is a defensive note, not a bug.

### P3-3 — Detail panel adds `<aside>` to `document.body` once and never removes it — incompatible with ADO's hub-page reload behavior

**Location**: `extension/ui/modules/shared/detail-panel.ts:185-238` (`ensurePanelEls`)

The panel root is appended to `document.body` lazily and **never removed** (the `is-open` class is toggled instead). ADO hubs are SPAs — when the user navigates away from the dashboard hub to another hub, the ADO host *may* re-render the hub container without unloading the iframe (depends on the host's caching). Re-entering the dashboard hub then runs `dashboard.ts` → re-installs drill-downs → calls `ensurePanelEls()` → finds the cached `panelEls` → `panelEls.root.isConnected` may be `true` (the body was preserved) or `false` (body cleared on hub-exit).

The `ensurePanelEls()` function at `detail-panel.ts:188` correctly handles the `!isConnected` case by busting cache and re-creating. But it does NOT handle the case where the body is preserved AND a new `installXxxDrilldown` call re-installs delegated listeners on a new chart container. The per-chart `dispose()` correctly removes its listeners; the panel root persists; everything works.

Net: this code is correct as written, but its correctness depends on ADO never preserving `panelEls.root` while disposing the chart containers. If ADO ever changes that behavior (e.g. SPA-like hub-exit that clears charts but not body-level overlays), the panel will be a zombie attached to the body but disconnected from the React lifecycle that owns dispose. Worth a comment in `ensurePanelEls` explicitly noting "this assumes document.body is replaced together with the chart containers."

P3 because the assumption holds today; it's a documentation hygiene note.

### P3-4 — `prefers-reduced-motion` is consulted only for the sparkline highlight (1500ms `animation: none`) and DetailPanel transition; not for the comparison-advisory-toast slide-in

**Location**: `extension/ui/styles.css:3223-3226`

```css
@media (prefers-reduced-motion: reduce) {
    .comparison-advisory-toast {
        animation: none;
    }
}
```

This IS correct — the toast slide-in animation is suppressed under reduced-motion. False alarm; striking this finding to verify I read the diff correctly.

[Verified — the reduced-motion block is present at styles.css:3223. P3 issue closed.]

### P3-5 — DetailPanel `escapeHtml` claim in DOM contract (line 138 of `detail-panel-api.md`) is achieved via `textContent`, not via the function `escapeHtml`

**Location**: `specs/059-chart-drill-down/contracts/detail-panel-api.md:138` says:

> Title element: `<h2 id="detail-panel-title">{PanelContent.title}</h2>` — `escapeHtml` applied via `textContent`.

The contract phrasing reads as if `escapeHtml` is being called inside the panel. In reality, `detail-panel.ts:243` calls `appendText(els.titleEl, content.title)`, and `appendText` uses `textContent` (which natively escapes), so no explicit `escapeHtml` is invoked. This is **correct and safer** (textContent doesn't have the entity-edge-case bugs that hand-rolled escape can have), but a reader auditing for XSS protection by grepping for `escapeHtml` in `detail-panel.ts` will find no calls and may incorrectly conclude the title is unescaped. Update the contract to read "`textContent`-escaped" or "no innerHTML / no template-string interpolation of user data."

P3 doc-clarity issue.

---

## Verification gap (non-finding, but worth flagging)

The PR has zero **in-iframe** end-to-end coverage. Every drill-down test mounts DOM to a jsdom-stubbed `document.body`. Three platform-nuance risks above (P1-1, P1-2, P2-1) cannot be caught without either:

- A Playwright test that loads `dist/ui/index.html` inside an `<iframe height="3000">` and exercises the click flows; OR
- A real ADO sandbox project with the extension uploaded and the user clicking through.

The repo has Playwright wired up (`extension/playwright.config.ts` exists), but the drill-down tests are Jest+jsdom only. This is sufficient for the contract-equivalence parity tests but **insufficient for the iframe-specific failure modes** that ADO production exhibits and the demo at `/docs` hides.

I would not block merge on adding Playwright iframe coverage now (the Phase 1 scope is large already), but it is the single most impactful test investment for catching the next class of platform-nuance bugs.

---

## Summary

- **P1**: 2 — sparkline `scrollIntoView` is silently broken inside the height-synced iframe (P1-1); existing top-right toast (z-index 1000) covers the new overlays in obvious flows (P1-2).
- **P2**: 4 — persistent panel position-fixed-in-iframe scrolls past viewport (P2-1); comparison advisory mounts inside hidden parent (lifecycle race risk, P2-2); aria-modal cannot honor its contract across iframe boundary (P2-3); pre-existing light-theme-only design system enlarged by feature 059 (P2-4).
- **P3**: 4 — duplicated chart-id map (P3-1); MutationObserver lifecycle hygiene (P3-2); document-body persistence assumption (P3-3); detail-panel-api.md doc inaccuracy (P3-5).

Phase 1 reuses ADO-extension patterns competently and inherits most of the dashboard's pre-existing platform-nuance characteristics. The two P1s are net-new and tied to the iframe boundary that synthetic tests cannot exercise.
