# UX Specialist Review — PR #302 (Feature 059 Phase 1)

**Reviewer lens**: Usability + transparency. First-time-user journeys
across throughput, cycle-time, reviewer activity, sparklines.
**PR**: #302 — branch `059-us1-throughput`, six commits ahead of `main`.

Each finding includes a concrete user-journey narrative and the
recommended remedy. Severity scale: **P1** must fix before merge,
**P2** should fix, **P3** nice-to-have.

---

## P1 — Must fix before merge

### P1-1. Throughput bars and reviewer rows have no clickability affordance

**Path that exposes it**

A user opens the dashboard for the first time. Their cursor moves over a
throughput bar — the cursor stays as an arrow, the bar does not change
appearance, no underline / glow / pointer cue appears. Even though
`data-tooltip` already triggers a tooltip showing `{week: count}`, the
tooltip does not say "click for details", so the user reads the value,
moves on, and never learns drill-down exists. Same story for the
reviewer activity rows: cursor stays as the default arrow even when the
filtered-reviewer condition is true and rows are clickable.

**Evidence** (`extension/ui/styles.css`):

- `.bar-container` (line 1044) has no `cursor: pointer` and no `:hover`
  rule.
- `.h-bar-row` (line 1230) has no `cursor: pointer` and no `:hover`
  rule.
- `.line-chart-dot` (line 1208) is the only drill-down target with
  `cursor: pointer` — bars and reviewer rows are silent.

The sparkline trigger gets `cursor: pointer`, `:hover` opacity, and
`:focus-visible` outline (line 919–946), so the contrast with the
P1-priority chart is jarring.

**Recommendation**

Add hover and cursor cues that match the sparkline trigger pattern:

```css
.bar-container[data-drilldown-week] {
    cursor: pointer;
}
.bar-container[data-drilldown-week]:hover .bar {
    filter: brightness(1.08);
}
.h-bar-row[data-drilldown-reviewer-id] {
    cursor: pointer;
}
.h-bar-row[data-drilldown-reviewer-id]:hover .h-bar {
    filter: brightness(1.08);
}
```

Attribute-scoped so the cue only appears when the row/bar is genuinely
clickable, which neatly handles P1-2 below (reviewer rows without a
filter remain non-interactive and non-pointer-cued).

---

### P1-2. Reviewer drill-down without a filter is silently inert (T037 narrowing is not communicated)

**Path that exposes it**

A user lands on the dashboard with no reviewer filter applied. They
scan the Reviewer Activity chart, see week-by-week reviewer-count bars,
notice the "Top reviewer this week" tooltip, and try clicking a row.
Nothing happens. They try a few other rows — also nothing. The user
concludes drill-down is broken.

The narrowed-scope decision documented in
`memory/project_059_us1_us4_ship.md` (load-bearing decision #4) is the
right call data-wise — aggregate counts have no single drill subject —
but the user has no way to learn the rule. The tooltip still appears
(via `data-tooltip="true"` on the wrapper), so the row *looks*
interactive in the same way the others do once a filter is applied;
both states present identically until the user clicks.

**Evidence** (`extension/ui/modules/charts/reviewer-activity.ts:178-181`):

```ts
const filterReviewerId = options.filters?.reviewers?.[0] ?? null;
const drilldownAttrs = filterReviewerId
  ? ` data-drilldown-reviewer-id="${escapeHtml(filterReviewerId)}" tabindex="0" role="button"`
  : "";
```

When `filterReviewerId` is null, no attribute → no role → no tabindex
→ no listener target. Click is a no-op.

**Recommendation (pick one)**

1. **Cheap**: when `filterReviewerId` is null, render a one-line note
   under the chart heading: "Filter to a single reviewer to drill into
   their week-by-week activity." This makes the gating discoverable
   without any code-path branching.
2. **Medium**: keep the current click no-op but still attach a click
   handler that surfaces the same one-line message as a transient
   advisory (modeled on the comparison-mode toast). Same UX pattern,
   no new mechanisms.

The CSS fix in P1-1 (attribute-scoped cursor) means the P1-2 fix
doesn't need to suppress affordance separately — the bare row already
shows no pointer cue.

---

### P1-3. Reviewer empty-week table renders as a header-only table, not an EmptyStateSection

**Path that exposes it**

A user filters to a reviewer who happens to have zero activity in the
currently-displayed period (or whose only weeks were trimmed by a
narrow date range). They click the row. Panel opens. Stats section
shows "Total reviews 0 / PRs reviewed 0 / Approval rate (no data) — /
Peak repositories 0" — that part is correct. Then the **Weekly
activity** section renders with the four column headers (Week /
Reviews / PRs reviewed / Approval rate) and an empty `<tbody>`. The
user sees a labeled empty grid and is left wondering whether the table
failed to load or whether there really is no data.

**Evidence** (`extension/ui/modules/drilldown/reviewer-drilldown.ts:102-126`):

```ts
function buildWeeklyTable(rollups: readonly Rollup[], reviewerId: string) {
  const rows: PanelRow[] = [];
  for (const rollup of rollups) {
    const entry = reviewerEntry(rollup, reviewerId);
    if (!entry) continue;
    // …
  }
  return makeBreakdownTable(
    "Weekly activity",
    ["Week", "Reviews", "PRs reviewed", "Approval rate"] as const,
    rows,        // ← may be []
  );
}
```

This unconditionally returns a `BreakdownTableSection`, even when
`rows.length === 0`. The DetailPanel render path (`detail-panel.ts:288-298`)
emits the `<thead>` then a bare `<tbody>` — a header-only table.

This violates the spec's empty-state contract directly:

- **FR-071**: "When a requested breakdown exists in the model but is
  empty after filtering, the panel MUST show a clearly labeled empty
  state for that section rather than rendering an empty table."
- **FR-041 acceptance scenario 2**: "approval-rate section MUST show a
  clearly labeled empty state rather than a misleading '0%'."
- The throughput consumer (`throughput-drilldown.ts:55-65`) and the
  cycle-time consumer (`cycle-time-drilldown.ts:62-67`) both honor this
  contract by returning `makeEmptyState(...)`. The reviewer consumer is
  the lone offender.

**Recommendation**

```ts
function buildWeeklyTable(...): PanelSection {
  const rows: PanelRow[] = [];
  // … same loop …
  if (rows.length === 0) {
    return makeEmptyState(
      "Weekly activity",
      "No weekly review activity for this reviewer in the active period.",
    );
  }
  return makeBreakdownTable(...);
}
```

Add a Jest case under `extension/tests/modules/drilldown/reviewer-drilldown.test.ts`
that locks the empty path. Bump the test floor in the same commit per
A-008.

---

## P2 — Should fix

### P2-1. Three sparklines look identical to clickable ones but do nothing on tap

**Path that exposes it**

A user reads the seven summary cards, sees the small line chart on each,
and notices the "Reviewers" sparkline (clickable) takes them to the
reviewer chart on tap. Encouraged, they try the **Review Time (P50)**
sparkline next to it. Cursor stays as the default arrow on hover — but
they don't notice; they tap. Nothing happens. No advisory. No scroll.
No focus change. They conclude the feature is broken or the network is
slow.

**Evidence** (`extension/ui/modules/charts/summary-cards.ts:158-161`,
documented design-decision #5 in `project_059_us1_us4_ship.md`):

```ts
wrapSparklineTrigger(containers.totalPrsSparkline, "throughput");
wrapSparklineTrigger(containers.cycleP50Sparkline, "cycle-time");
wrapSparklineTrigger(containers.cycleP90Sparkline, "cycle-time");
wrapSparklineTrigger(containers.reviewersSparkline, "reviewer");
// reviewTimeP50 / reviewTimeP90 / authorsCount are NOT wrapped.
```

The three unwrapped sparklines visually equal the four wrapped ones —
same dimensions, same stroke, same card layout — but produce no UX
when clicked. This is not literally an FR-052 violation (the per-spec
"data-availability gap" advisory is for runtime gaps, not for the
permanent absence of a target chart), but the user-visible outcome is
the same: silent no-op on a UI element that visually looks
interactive.

**Recommendation (pick one)**

1. Wrap the three unwrapped sparklines with a `<span class="sparkline-noninteractive">`
   that renders identically to a `.sparkline` div but explicitly
   excludes `cursor: pointer` and any future hover state. This is
   purely a "make it visually obvious that these aren't buttons" fix.
2. Wrap them in a `sparkline-trigger` button whose only action is to
   render a one-time advisory near the card: "No full chart for
   review-time / contributors yet — see the underlying numeric value
   above."

Both options unblock the user's mental model. Option 2 is closer to
the FR-052 pattern already in `sparkline-navigator.ts:120-123` and
gives the four-of-seven decision a coherent surface.

---

### P2-2. Empty-state copy uses "this week" / "the active period" — readable but does not name the week / reviewer

**Path that exposes it**

A user opens the throughput drill-down for a quiet week. Panel title:
"Week of Mar 17 – 23, 2025". Subtitle: "0 PRs". Author section: "No
author-level activity for this week." Repository section: "No
repository-level activity for this week."

The copy is correct but doesn't anchor the reader: "this week" makes
the user re-glance at the title to confirm which week. Same in the
cycle-time consumer ("No repository-level cycle-time data for this
week.") and the reviewer consumer would inherit this tone if it
adopts the empty-state fix from P1-3.

This is not strictly a bug but violates the "transparency" half of the
review brief — the user should know *why* the section is empty without
re-reading the title.

**Recommendation**

Tighten copy to name the period:

- Throughput: `"No author activity recorded for the week of ${rangeStr}."`
- Cycle-time: `"No repository-level cycle-time data for the week of ${rangeStr}."`
- Reviewer: `"No weekly review activity for this reviewer between ${start} and ${end}."`

The `formatWeekTitle` helper already gives back the range string —
plumb it through the empty-state factories. (Or accept the trade-off
and keep "this week" — the title is right above and not far off.)

---

### P2-3. Three-cue comparison messaging works but the toast is unreachable by screen readers and pointer-events: none risks click-through

**Path that exposes it**

A user enters comparison mode. The persistent banner note appears
("Drill-down is unavailable during comparison. Exit comparison to
use it."). Charts visibly subdue (cursor: default, opacity 0.75). The
user clicks a bar anyway — toast appears above the bar with the same
message. Good.

But:

- The toast carries `pointer-events: none` (`styles.css:3208`), so a
  rapid double-tap could land the second tap on whatever is *under*
  the toast — including another drill-down target. The user gets a
  second toast immediately. Not broken, but jarring; in production
  with finger gestures it becomes "tap-tap-toast-toast" instead of a
  single calm message.
- `aria-live="polite"` is set, which is good. But the banner note has
  `role="note"` (`comparison-advisory.ts:145`); `role="note"` is a
  static landmark, not an announcement region. A screen reader user
  who enters comparison mode hears nothing.

**Recommendation**

1. Banner note: change `role="note"` to a `<div role="status" aria-live="polite">`
   wrapper around the text so the message is announced when comparison
   mode toggles on/off.
2. Toast: keep `pointer-events: none` (intentional so it doesn't trap
   clicks) but throttle re-emission — `showComparisonAdvisoryToast`
   already replaces in-flight toasts, but consider a `>200ms` cooldown
   so rapid clicks don't trigger visible flicker.
3. Optional: when the toast appears for the *second* attempt within
   3 seconds, swap the message to add a hint: "Drill-down is
   unavailable during comparison. Press the Exit Comparison button to
   restore." (References the actual button label users see.)

---

### P2-4. Cycle-time title format "Week of Mar 17 – 23, 2025 — P50" reads ambiguously

**Path that exposes it**

A user clicks the P50 dot for a week. Panel title:
`"Week of Mar 17 – 23, 2025 — P50"`.
The em dash is doing two jobs in this string — it's already used inside
`formatWeekRangeTitle` to separate the start/end days
("Mar 17 – 23"), and it's reused as a metric separator
("…, 2025 — P50"). Readers familiar with em dashes can parse it, but
first-time users see three em-dashes-or-similar in one title and have
to re-parse.

The current format does match `data-model.md:19` per design-decision
#3, but the canonical example there does not include the metric
suffix.

**Recommendation**

One of:

1. Drop the em dash in favor of a parenthetical metric:
   `"Week of Mar 17 – 23, 2025 (P50)"`.
2. Use a colon: `"P50 — Week of Mar 17 – 23, 2025"`.

Option 1 keeps the week-range as the dominant phrase (matches title
hierarchy in throughput / reviewer panels). Option 2 leads with the
metric, which arguably is what the click was about. Either reduces
ambiguity over the current form.

---

### P2-5. Tap-on-bar produces tooltip + panel simultaneously — calm desktop, busy mobile

**Path that exposes it**

A touch user taps a throughput bar. The chart-tooltip appears (week +
PR count) AND the side panel slides in. The tooltip lingers by design
(it doesn't `preventDefault` per design-decision #1), so for a moment
both UIs are visible. The MutationObserver-driven `clearActive()` and
`dismissAllTooltips()` calls run inside `activate()`, but that order
is: `dismissAllTooltips()` first, then `openDetailPanel`. Since the
tooltip render happened on the prior `pointerup`, the dismiss inside
`activate` runs *after* the tooltip is already on screen.

In practice on jsdom you see no flicker. On a real touch device the
sequence is:

1. `touchstart → pointerdown` (no tooltip).
2. `touchend → pointerup` (tooltip rendered).
3. Synthesized `click` (tooltip dismissed by `activate()` → panel opens).

That's a ~50–150 ms tooltip flash. Not harmful but reads as "two
overlays fighting" if the panel animation is slow.

**Recommendation**

Inside `addChartTooltips` (`extension/ui/modules/charts.ts:247-269`),
when the host element is a drill-down target (`closest('[data-drilldown-week],
[data-drilldown-reviewer-id], [data-drilldown-metric]')`), suppress
the tooltip on touch but keep it on hover:

```ts
const isDrilldownTarget = el.closest(
  "[data-drilldown-week], [data-drilldown-reviewer-id], [data-drilldown-metric]",
);
if (isDrilldownTarget && e.pointerType === "touch") return;
showTooltip(el);
```

This preserves desktop hover-tooltip discoverability and removes the
"two overlays" flash on touch. Add a Jest test asserting
`pointerType: 'touch'` on a drill-down target produces no tooltip.

---

## P3 — Nice to have

### P3-1. Sparkline highlight is invisible when reduced-motion + `box-shadow` 0px

**Path that exposes it**

A reduced-motion user clicks a sparkline. `scrollIntoView({behavior: 'auto'})`
jumps the page. The chart container gains `is-sparkline-highlight`. CSS
overrides the animation (`@media (prefers-reduced-motion: reduce)`) to
just hold the static outline + shadow. Per `styles.css:984-989`, the
override sets `outline: 2px solid var(--primary)` but does not set the
`box-shadow` — only the keyframes do. After `setTimeout(1500)` the
class is removed. So reduced-motion users see a 1.5 s static outline,
no glow, no fade — that's correct, but the static outline is the same
weight as the `:focus-visible` outline, which might confuse them about
whether the chart now has keyboard focus.

**Recommendation**

Differentiate the highlight outline from the focus outline (e.g.
`outline-style: double` or a different shade) so a reduced-motion user
can tell highlight ≠ focus.

### P3-2. Toast position can collide with the comparison banner at narrow viewports

**Path that exposes it**

User in comparison mode at ~600 px width clicks a sparkline. The toast
positions above the trigger by default; at narrow viewports the
sparklines are near the top of the page just below the comparison
banner. The toast's `top = rect.top - height - 8` may land it on top of
the banner — visually busy.

**Recommendation**

Detect overlap with the banner (cheap: read the banner element's
`getBoundingClientRect` once and clamp `top >= banner.bottom + 8`).

### P3-3. "Approval rate (no data)" label is good; "Peak repositories — 0" is misleading

**Path that exposes it**

User clicks a reviewer with zero activity. Stats row shows "Peak
repositories — 0" (`reviewer-drilldown.ts:90`). A literal-zero is
indistinguishable from "this reviewer touched zero distinct repos in
their highest-activity week". For a no-data reviewer, both are
technically true but the second is misleading framing.

**Recommendation**

```ts
const peakValue =
  peakWeek !== null
    ? `${peakRepos} (${formatWeekLabel(peakWeek)})`
    : "—";
```

Mirror the approval-rate `"—"` convention. The label can swap to
`"Peak repositories (no data)"` in the same branch.

### P3-4. The empty-state title in `EmptyStateSection` uses the section *title*, not the focused subject

**Path that exposes it**

Throughput panel for an empty week shows two empty-state sections in a
row:

```
By author
No author-level activity for this week.

By repository
No repository-level activity for this week.
```

That's two `<h3>` headings sandwiching almost-identical copy. Reads
fine for one section but feels boilerplate when both fire.

**Recommendation**

Merge into a single empty-state when *both* breakdowns are empty:

```
No breakdown data
This week recorded 0 PRs under the active filters; there is nothing
to break down by author or repository.
```

The simpler wording is one-touch-friendly and matches the title
("Week of …, 0 PRs") which already communicates the emptiness.

---

## Summary

| Severity | Count |
|----------|-------|
| P1       | 3     |
| P2       | 5     |
| P3       | 4     |

**Theme**: spec compliance is high (every FR has a code path) but
discoverability and empty-state polish lag the rest of the work.
The two P1 affordance fixes (cursor + reviewer-row gating message)
are small CSS+copy changes; the P1 reviewer empty-state fix is one
factory swap. P2-1 (silent sparklines) is the largest user-visible
mismatch with the otherwise-strong sparkline-navigator UX.
