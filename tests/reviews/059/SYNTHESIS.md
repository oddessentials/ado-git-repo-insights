# PR #302 Specialist-Team Review — Synthesis

**Branch**: `059-us1-throughput` (6 commits ahead of `main`).
**Review files**: `tests/reviews/059/{data-scientist,ux-specialist,ado-extension-ui-specialist,frontend-architecture,accessibility-specialist}.md`
**Synthesised**: 2026-04-19 by team-lead.

---

## Headline

Phase 1 implementation is **architecturally and numerically sound**. Module
boundaries are clean, parity is intact and CI-enforced, the weighting logic
matches the upstream Python contract, and DetailPanel structural a11y is right.

The flaws that surfaced in review are concentrated in three cross-cutting
themes, all of which the existing Jest+jsdom suite **cannot detect by
construction**:

1. **In-browser/iframe failure modes silently bypass synthetic tests.**
2. **State-change communication is visual-only on multiple new surfaces.**
3. **Visual affordance is missing on the new click targets**, while three of
   the seven sparklines look identical to interactive ones and silently
   no-op.

Aggregated severity:

| Severity | data-sci | ux | ado-ui | frontend | a11y | **Total** |
|----------|---------:|---:|-------:|---------:|-----:|----------:|
| P1       | 0        | 3  | 2      | 1        | 4    | **10**    |
| P2       | 3        | 5  | 4      | 2        | 6    | **20**    |
| P3       | 4        | 4  | 3      | 3        | 4    | **18**    |

After de-duplication across lenses, the P1 set collapses to **8 distinct
must-fix items** (UX P1-1 and a11y P1-2 are the same root cause from two
angles; UX P2-3 and a11y P1-4 / P2-5 converge on the comparison-advisory
mechanism).

**Update 2026-04-19:** P1.B was downgraded to P3 after a fail-first
investigation showed the bug does not reproduce in supported Chromium
browsers (same-origin OR cross-origin) and the originating specialist
self-corrected the finding as theoretical, not observed. The remaining
must-fix set is therefore **7 distinct P1 items**. See
`tests/reviews/059/p1b-cross-origin-investigation.md` for full context.

---

## Cross-Cutting Themes

### Theme 1 — jsdom passes mask production failures (the throughline)

Every reviewer except data-scientist independently flagged the same gap:
the test surface is **structurally insufficient** for the failure modes the
new code introduces. Examples:

- ADO P1-1: `scrollIntoView({block:"center"})` is a no-op inside the
  height-synced ADO iframe. Jest stubs `scrollIntoView`; demo at `/docs`
  scrolls the document root (works); ADO production scrolls nothing
  (broken). **The entire US4 user value (FR-050 sparkline navigation)
  is silently dead in production.**
- ADO P1-2: pre-existing top-right `.toast` (z-index 1000) covers the new
  panel (z-index 100) and advisory toast (z-index 110). Trivially
  reproducible: click "Export CSV" → click a chart bar within ~3 s.
- a11y P1-1: SVG `<circle>` `tabindex="0"` is not keyboard-reachable in
  any major browser. Jest passes only because jsdom skips platform
  focus-order rules.
- a11y P1-3: focus trap is boundary-only; mid-cycle Tab is unhandled
  except by the real browser's focus engine, which jsdom does not model.
- a11y P2-3: focus restoration after `FILTERS_CHANGED_EVENT` re-renders
  the trigger element — the restore target's `isConnected` is false in
  prod; in jsdom the test harness keeps the element alive.
- frontend-architecture P1: stale-cycle bail disposes drill-down handles
  before the second `isStale` guard short-circuits the render, leaving
  charts that look interactive but have no listeners. Visible only on a
  fast-double-refresh sequence with one slow load.

**Single most impactful test investment**: a Playwright (or equivalent)
test that loads `dist/ui/index.html` inside an `<iframe height="3000">`
and exercises (a) sparkline → host scroll, (b) keyboard tab through
chart triggers, (c) focus restoration on filters-changed dismiss.
Repo already has Playwright wired (`extension/playwright.config.ts`);
no new dependency.

### Theme 2 — Visual-only state changes; no SR / aria-live equivalents

A pattern across new surfaces: the visible affordance changes but
assistive tech receives nothing.

- a11y P1-2: bars/rows/dots have no `aria-pressed` reflecting
  `is-drilldown-active`.
- a11y P2-1 + UX P1-2: reviewer rows toggle interactivity with the
  reviewer filter; SR users never hear that the rows became (or stopped
  being) interactive.
- a11y P2-2: sparkline-navigator advisory (when target chart missing)
  has no `role="status"` / `aria-live`.
- a11y P2-5 + UX P2-3: comparison-advisory banner uses `role="note"`,
  which is silent for SRs at the exact moment the message is needed.
- a11y P1-4 + UX P2-3: the comparison-advisory toast uses `role="status"`
  + `aria-live="polite"`; spec FR-061 calls for an *interruption* in
  response to a user action, which needs `role="alert"`.

These are independent code sites with one underlying gap: **no convention
for "visible state-change must announce"** during 059's design.

### Theme 3 — Affordance + discoverability asymmetry

Two reviewers reached the same observation from different lenses:

- UX P1-1 + a11y P1-2: throughput bars + reviewer rows have no
  `cursor: pointer` / hover cue *and* no `aria-label`. The line-chart dot
  + sparkline trigger are the only drill-down targets that signal
  interactivity.
- UX P2-1: 3 of 7 summary-card sparklines (review-time-P50,
  review-time-P90, authors-count) look identical to the 4 wrapped
  sparklines but produce no UX on click — silent no-op (per
  load-bearing decision #5, no full charts exist for them).
- UX P1-2: reviewer rows without a filter look identical to filtered
  rows but click is a no-op (per load-bearing decision #4, T037
  narrowing).

The narrowed-scope decisions (#4 and #5 in memory) are correct
data-wise; **the user has no way to learn the rule**.

### Theme 4 — FR-071 / FR-041 empty-state contract is unevenly applied

Throughput + cycle-time consumers correctly emit `EmptyStateSection`
when their breakdown is empty. The reviewer consumer's `buildWeeklyTable`
unconditionally returns `BreakdownTableSection`, rendering a header-only
table — direct FR-071 violation (UX P1-3). Data-scientist also flagged a
related cosmetic asymmetry: `"Peak repositories — 0"` should follow the
em-dash empty-state convention (data-sci P3-4 + UX P3-3).

### Theme 5 — Data labelling near aggregation rows invites misread

Drill-down panel is the **first surface** that places the weighted approval
rate immediately next to a sum of per-week `reviewed_prs` (data-sci P2-2).
The two metrics use the same per-week weighting and may double-count the
same PR; reading them side-by-side as
`"PRs reviewed: 22 / Approval rate: 73%"` invites the misinterpretation
"73% of 22 distinct PRs". The chart never made these adjacent.

---

## P1 — Must Fix Before Merge (8 distinct items)

Listed by impact; reviewer attribution in brackets.

### P1.A — Stale-cycle bail leaves drill-down dead until next refresh
[frontend-architecture P1]
`extension/ui/dashboard.ts:929-930` disposes ALL drill-down handles
unconditionally, then loads data. If the post-publish stale guards
(971-973 / 998-1000) fire, the function returns early without
re-installing — chart DOM stays on screen but listeners are dead. If
the winning cycle then errors, dashboard renders interactive-looking
charts that don't respond.
**Fix**: defer the dispose loop to immediately before the render block
(after the second `isStale` guard). Add a regression test: queue one
slow refresh, fire a fast one, assert post-bail bar-click still opens.

### ~~P1.B — Sparkline navigator silently broken inside ADO iframe~~ DOWNGRADED → P3
[ado-extension-ui-specialist P1-1; downgraded 2026-04-19]
The original finding was theoretical (CSSOM-spec reasoning, never observed
in real ADO). Per the "fail-first proof" discipline, an iframe Playwright
smoke was built BEFORE touching `sparkline-navigator.ts:127`. The bug did
not reproduce in either same-origin OR cross-origin Chromium (parent did
scroll in both topologies). The originating specialist self-corrected the
finding and confirmed the ADO Extension SDK exposes no parent-scroll
primitive that would constitute a "fix" anyway.

**Disposition:** downgraded to P3 with the constraint "do not re-prioritize
without (a) a real-ADO sandbox reproduction, (b) a confirmed Chromium
version regression, or (c) explicit user impact."

The iframe smoke harness landed instead, with three application-contract
sentinels (same-origin scroll-intent + class, cross-origin scroll-intent +
class, filter-change panel-dismiss). Full investigation:
`tests/reviews/059/p1b-cross-origin-investigation.md`.

### P1.C — Existing top-right `.toast` covers new overlays
[ado-extension-ui-specialist P1-2]
The pre-existing `.toast` at z-index 1000 covers the new `.detail-panel`
(z-index 100) and `.comparison-advisory-toast` (z-index 110). Trivially
reproducible: click Export CSV → click a chart bar within ~3 s.
**Fix**: either bump the new overlays above 1000, or call
`dismissAllToasts()` at panel-open time analogously to the existing
`dismissAllTooltips()` step.

### P1.D — Cycle-time `<circle>` dots are not keyboard-focusable in real browsers
[accessibility-specialist P1-1]
`tabindex="0"` on inline SVG nodes works inconsistently across the ADO
browser matrix. Combined with the focus-trap behavior, **a keyboard-only
user cannot reach a P50/P90 dot** in production — pointer-only.
Direct WCAG 2.1.1 + SC-006 violation. Jest passes only because jsdom
synthesises keydown directly on the element.
**Fix shape**: wrap each dot in a `<g role="button" tabindex="0">` with
an invisible hit-area `<rect>`, OR overlay a `<foreignObject><button>`
per data point. Lock with a Playwright keyboard-tab assertion.

### P1.E — Discoverability + accessible-name gap on new triggers (combined finding)
[ux-specialist P1-1 + accessibility-specialist P1-2]
Two angles, same root cause. New click targets miss both visual and AT
affordance:
- No `cursor: pointer` / hover cue on `.bar-container` or `.h-bar-row`
  (only `.line-chart-dot` and sparkline trigger have it).
- No `aria-label` describing the drill-down target ("Drill into week
  of {date-range} ({n} PRs)").
- No `aria-pressed` reflecting the `is-drilldown-active` outline state.

Sighted users learn drill-down exists by accident; SR users learn it
not at all. WCAG 4.1.2 + 4.1.3.
**Fix**: attribute-scoped CSS (`.bar-container[data-drilldown-week]
{cursor:pointer}` etc.) — automatically also handles P1.F's gating.
Add `aria-label` per trigger; toggle `aria-pressed` from the
MutationObserver that already drives `is-drilldown-active`.

### P1.F — Reviewer-row gating without filter is silently inert
[ux-specialist P1-2; accessibility-specialist P2-1 reinforcement]
The narrowed-scope decision (load-bearing #4) is correct data-wise but
invisible to users. With no reviewer filter, rows look identical to
filtered rows but click is a no-op.
**Fix (cheap)**: render a one-line note under the reviewer-activity
chart heading when no filter is active: "Filter to a single reviewer to
drill into their week-by-week activity." If you adopt P1.E's
attribute-scoped cursor, the inert rows already lose the pointer cue.

### P1.G — Reviewer empty-week table violates FR-071 (throughput + cycle-time honour it)
[ux-specialist P1-3]
`reviewer-drilldown.ts:buildWeeklyTable` unconditionally returns a
`BreakdownTableSection` even when `rows.length === 0`, rendering a
header-only `<table>` with bare `<tbody>`. Throughput
(`throughput-drilldown.ts:55-65`) and cycle-time
(`cycle-time-drilldown.ts:62-67`) both correctly switch to
`makeEmptyState`. The reviewer consumer is the lone offender. Direct
FR-071 violation; FR-041 acceptance scenario 2 also implicated.
**Fix**: one factory swap. Lock with a Jest case for the empty path.
Bump the test floor in the same commit per A-008.

### P1.H — Comparison-advisory mechanism a11y mispairings (combined finding)
[accessibility-specialist P1-4 + P2-5; ux-specialist P2-3]
Three convergent findings on the comparison-advisory module:
1. The persistent **banner** uses `role="note"` — silent for SRs at the
   moment the message is needed. Should be `role="status"` or wrapped
   in `aria-live="polite"`.
2. The **toast** uses `role="status"` + `aria-live="polite"` — wrong
   pairing for an *interruption* in response to a user action.
   FR-061 implies `role="alert"` semantics.
3. Banner + toast + chart-disable text overlap — risk of
   double-announcement once role changes are made. Recommend
   differentiating banner copy ("Drill-down disabled during comparison.")
   from toast copy ("Click ignored — exit comparison to drill down.").

**Fix**: coordinated change to `comparison-advisory.ts` lines 63-85
(toast) and 139-149 (banner) plus copy split.

---

## P2 — Should Fix (selected highlights)

Grouped thematically; full text in per-reviewer files.

### Empty-state + labelling polish
- **data-sci P2-1**: document the upstream-impossible `reviewed_prs === 0`
  branch at the aggregation site (UI defensive only; `aggregators.py:1140-1141`
  filters this case).
- **data-sci P2-2**: the labels "PRs reviewed: 22" + "Approval rate: 73%"
  side-by-side invite misread. Cheapest fix: rename to "PR-week reviews"
  with a `<sup>` glossary affordance. Documentation-only acceptable for
  Phase 1 if labelled as inherited from `metrics.ts`.
- **ux P2-2**: empty-state copy uses "this week" / "the active period" —
  doesn't anchor the reader. Tighten to name the period via
  `formatWeekTitle`.

### Sort + ordering determinism
- **data-sci P2-3**: throughput + cycle-time per-repo tables have no
  defined tie-break. Today saved by ES2019 stable sort, but Python dict
  ordering is not guaranteed. Add `localeCompare` secondary sort + a
  ties-test.

### Sparkline ergonomics
- **ux P2-1**: 3 of 7 sparklines look clickable but aren't. Either wrap
  in a `.sparkline-noninteractive` class without `cursor: pointer`, or
  attach a one-line "no full chart yet" advisory.

### Lifecycle + coupling notes
- **frontend P2 (×2)**: document the chart-container-lifetime assumption
  in `comparison-advisory.ts`; add a regression test asserting
  `wrapSparklineTrigger` doesn't double-wrap (today relies on
  `renderTrustedHtml`'s undocumented `innerHTML` reset).
- **ado P2-2**: comparison-advisory mounts inside `#comparison-banner`,
  which carries `.hidden` until comparison-on. Order is correct today,
  but no test locks "banner is not hidden when advisory mounts." Add a
  lifecycle-signals test.

### ADO platform constraints (pre-existing, amplified)
- **ado P2-1**: `position: fixed` panel inside iframe scrolls past
  viewport; close button can land off-screen. Phase-2 fix candidate is
  native `<dialog>` element via `showModal()` (uses browser top layer,
  iframe-safe).
- **ado P2-3**: `aria-modal="true"` cannot honor its contract across
  the iframe boundary. Either drop the claim, or set `inert` on
  iframe-document siblings to approximate it.
- **ado P2-4**: light-theme-only design system enlarged by Phase 1's
  larger overlay surface area. Document the stance in `data-model.md`
  if intentional.

### Touch + reduced-motion polish
- **ux P2-5**: tap-on-bar shows tooltip + panel briefly together. Suppress
  tooltip on `pointerType: 'touch'` for drill-down targets.
- **a11y P2-4**: `is-sparkline-highlight` reduced-motion fallback uses an
  outline that collides with focus ring. Switch to a background tint.
- **a11y P2-6**: close-button `×` glyph fails forced-colors mode. Replace
  with CSS-drawn cross or SVG icon.

### Title format
- **ux P2-4**: cycle-time title `"Week of Mar 17 – 23, 2025 — P50"` reuses
  em dash for two roles. Suggest `"(P50)"` parenthetical or
  `"P50 — Week of …"`.

### Focus restoration on re-render
- **a11y P2-3**: Filters-changed / tab-changed / comparison-toggled
  dismiss paths likely fail to restore focus in production because the
  trigger element is detached between dismiss-tear-down and
  `trigger.focus()`. Use stable selectors (chart-id + week-iso) for
  re-resolution.

---

## P3 — Nice to Have (selected highlights)

Mostly polish, code-side documentation, and DRY observations.

- **data-sci P3-1**: `Math.round` differs from Python rounding at .5
  boundaries — document the JS-vs-Python boundary if cross-tool exact
  agreement matters.
- **data-sci P3-2**: `formatDuration` shows sub-minute durations as
  `"0m"` — consider `"<1m"` floor in a future polish pass.
- **data-sci P3-4**: `peakWeek === null` should mirror approval-rate
  `(no data) / —` semantics rather than `"0"`.
- **ux P3-1**: differentiate reduced-motion sparkline highlight outline
  from focus ring (e.g. `outline-style: double`).
- **ux P3-4**: when both author + repo breakdowns are empty in
  throughput, merge into a single empty-state instead of two near-identical
  `<h3>` sections.
- **frontend P3**: `week-range.ts` placement (move date primitives to
  `shared/format.ts`); `MutationObserver` install pattern duplicated
  across three drill-downs (DRY candidate).
- **ado P3-1**: chart-id map duplicated as const + if/else; consider
  exhaustive `switch` so adding a fourth chart in Phase 2 fails to
  compile if branches don't cover.
- **ado P3-5**: `detail-panel-api.md:138` says "`escapeHtml` applied via
  `textContent`" — implementation uses `textContent` natively (no
  `escapeHtml` call). Update doc.
- **a11y P3-1**: sparkline aria-label could read "Scroll to … chart"
  instead of "Open …" (matches actual behavior).
- **a11y P3-2**: detail-panel `<section>` elements lack
  `aria-labelledby` to their `<h3>` — invisible to landmark navigation.
- **a11y P3-4**: sparkline trigger SVG has no `<title>` / `<desc>`.

---

## What's Already Right (worth recording)

So that we don't undo it on the way through fixes:

- **Architecture**: module boundaries clean, no import cycles, DetailPanel
  is sole drawer, lifecycle signals single-publisher / many-subscriber,
  `dispose()` symmetric and `AbortController`-based.
- **Parity**: 4-way UI-bundle sync verified byte-identical across all 6
  commits via hooks (frontend P3 detail). `render-equivalence` +
  `prod-shape-edge-cases` tests extended to lock new behavior.
- **Numerics**: weighting matches `metrics.ts:368-391` (the spec A-002
  shared-helper precedent); `buildStatRow` totals match FR-041 verbatim;
  cycle-time null → em-dash semantics correct; subtitle pluralisation
  correct at locked count values.
- **DetailPanel structural a11y**: `role="dialog"` + `aria-modal` +
  `aria-labelledby` + accessible close button + focus trap +
  controller cleanup are right.
- **Reduced-motion**: panel transition, sparkline highlight, comparison
  toast slide-in all individually honor `prefers-reduced-motion`. The
  defects surface only when fallbacks **interact** with focus indication
  (a11y P2-4).
- **Tooltip `pointerup` no-preventDefault**: contract-correct per
  load-bearing decision #1; locked by `tooltip.test.ts`.
- **Test floor**: bumped 2423 → 2528 (+105) per `.test-floor-contract.json`,
  aligned with new test files (load-bearing decision in memory).

---

## Recommended Forward Plan (for user judgment, not a decision)

This synthesis surfaces the findings only; the user decides the path.

The shape that would be most efficient given the convergence:

1. **Fix the two "silently broken in production" P1s first** (P1.A
   stale-cycle bail + P1.B sparkline scrollIntoView) because both have
   no test coverage today and either could ship the way they stand.
2. **Address the visual-affordance + AT-name cluster** (P1.E + P1.F +
   parts of P1.D) as one coordinated change — the CSS changes interact.
3. **Re-architect the comparison-advisory a11y triple** (P1.H) as one
   commit with copy + role + aria-live changes coordinated.
4. **The reviewer-empty-state factory swap** (P1.G) is an isolated
   one-line fix + one Jest case + floor bump.
5. **The cycle-time `<circle>` keyboard-reach fix** (P1.D) is the most
   architecturally intrusive P1 — it changes the SVG render output. May
   be worth quoting separately for scope assessment.
6. **The .toast z-index collision** (P1.C) is a one-CSS-line fix or a
   one-call-site addition; trivially co-shippable with anything.

Add a Playwright in-iframe smoke as part of the bundle (theme 1 root
cause) — without it, the next class of in-iframe bugs lands the same
way.

---

*End of synthesis. Per the review brief, no fixes have been started.*
