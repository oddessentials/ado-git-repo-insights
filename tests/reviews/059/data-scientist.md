# Data-scientist review of PR #302 (059 drill-down consumers)

**Reviewer lens:** numeric and aggregate correctness only. Lifecycle / a11y /
DOM concerns left to peer reviews.

**Branch:** `059-us1-throughput` @ `0dd9b47c` (6 commits ahead of `main`).

**Verdict:** aggregates are mostly sound and the weighting policy is internally
consistent with the existing `metrics.ts` precedent. Two real numeric issues
worth flagging plus a handful of grammar / fragility nits.

---

## P1 (must fix before merge)

_None._ The three load-bearing aggregate sites (`computeApprovalRate`,
`buildStatRow`, throughput sort) match the spec and the Python pipeline's
contract once you reason them through. See P2-#1 for the one near-P1 case.

## P2 (should fix)

### P2-1. `computeApprovalRate` silently treats `reviewed_prs === 0` as "no contribution," but the spec semantics for "no qualifying PRs" warrant a comment

(a) `extension/ui/modules/charts/reviewer-activity.ts:57-58` and the reviewer
drill-down stat label at `extension/ui/modules/drilldown/reviewer-drilldown.ts:85-87`.

(b) **Scenario.** A reviewer week looks like:

```
{ reviews_count: 4, reviewed_prs: 0, approval_rate: null }
```

In production this can happen if every review on that week was a
"requested-but-pending" entry (`vote === 0` filtered upstream — see
`aggregators.py:1132-1141`). Today `computeApprovalRate` skips that week (good)
and `buildStatRow` adds `reviews_count = 4` but `reviewed_prs = 0` to the
totals. The panel then shows:

- "Total reviews: 4"
- "PRs reviewed: 0"
- "Approval rate (no data)" / "—"

That's all correct numerically — but the label says "PRs reviewed: 0" while the
test fixture in `reviewer-drilldown.test.ts:215-238` exercises exactly the
same scenario via a single-week null rate and asserts only on the approval
cell. There is no test that locks the **subtitle** for the
`reviewed_prs === 0` case. With the current `buildPanelContent` logic at
`reviewer-drilldown.ts:133`:

```ts
const subtitle = `${stats.totalPrs} ${stats.totalPrs === 1 ? "PR" : "PRs"} reviewed`;
```

…the subtitle will read `"0 PRs reviewed"`, which the existing test at
`reviewer-drilldown.test.ts:643-647` actually expects. So this is internally
consistent — but **upstream Python** never emits a reviewer entry with
`reviewed_prs === 0` (see `aggregators.py:1140-1141`: `if reviewed_prs == 0:
continue`). That means today the only way to land in that branch is if the
extension is fed a hand-edited rollup, a future schema change, or the
"reviewer-not-found" path the existing test covers. Worth a one-line comment
near `buildStatRow` documenting that `reviewed_prs === 0` is an
"upstream-impossible" branch retained as defensive UX rather than a real
production scenario. Without that comment a future maintainer will read the
"0 PRs reviewed" subtitle as a real prod state and start adding fallback
branches.

(c) **Suggested fix.** Add a 1-line comment at `reviewer-drilldown.ts:68-83`:

```ts
// Note: aggregators.py skips per-week reviewer entries with reviewed_prs == 0,
// so totalPrs > 0 is the production-realistic case. We still render the
// 0-subtitle path for the reviewer-not-found scenario and any future schema
// change that retains zero-PR weeks.
```

Severity: **P2** — no behavioral bug, but the subtle invariant deserves to be
documented at the aggregation site since it's the only place where the
upstream-side filter and the UI-side aggregation must stay in lockstep.

---

### P2-2. Multi-week approval rate is per-week-weighted, not "distinct PRs across the period"

(a) `extension/ui/modules/charts/reviewer-activity.ts:34-70` (computation),
`reviewer-drilldown.ts:84-88` (consumer), spec `FR-041` ("the reviewer's
weighted approval rate for the active period").

(b) **Scenario.** A single PR (UID `pr-123`) gets reviewed in W10 (1 vote, no
approval) and again in W11 (1 vote, approval). The Python aggregator emits two
per-week entries because `groupby('reviewer_id')` happens within each week's
`week_group`:

| week | reviews_count | reviewed_prs | approval_rate |
|------|---------------|--------------|---------------|
| W10  | 1             | 1            | 0.0           |
| W11  | 1             | 1            | 1.0           |

Python's per-week formula (`approved_prs / reviewed_prs`) is correct for that
week. The TS-side `computeApprovalRate` then computes:

```
weightedSum = 0.0*1 + 1.0*1 = 1.0
totalPrs    = 1 + 1 = 2
rate        = 0.5
```

…which is interpretable as "50% of per-week PR-reviews resulted in approval."
But **the spec language** ("the reviewer's weighted approval rate for the
active period") and the panel stat label ("Approval rate") would lead most
users to read it as "what fraction of distinct PRs you reviewed did you
approve?" The literal "distinct PR" answer in the example is 50% (1 of 1
approved on the latest vote), so the numerical accident matches here — but it
would NOT match if the same PR were re-reviewed across a partial week boundary
where the Python denominator double-counts. This is a known property of the
per-week aggregation Python emits, not introduced by this PR.

The PR doesn't claim to fix this; it inherits the metric verbatim from
`metrics.ts:354-391`. The reviewer-activity chart already presents the same
number in the "Approval Rate: X%" badge.

The data-scientist concern: the **drill-down panel is the first surface that
puts this metric next to the "PRs reviewed" total in the same stat row**. Two
adjacent stats:

- "PRs reviewed: 22" (sum of `reviewed_prs` across weeks — double-counts PRs
  reviewed in multiple weeks)
- "Approval rate: 73%" (weighted by the same potentially-double-counted
  `reviewed_prs`)

Reading them side by side invites the misinterpretation that the percentage is
"73% of 22 distinct PRs were approved." It isn't — both numbers are
per-week-weighted aggregates that may double-count the same PR.

(c) **Suggested fix (pick one).**

1. **Cheapest:** rename "PRs reviewed" → "PR-week reviews" or "PRs reviewed
   (weekly sum)" and add a `<sup title="…">?</sup>` glossary affordance on
   "Approval rate" explaining the per-week weighting. Single-week views are
   unaffected because the weight equals 1.
2. **More accurate** (deferred to #300): track distinct PR identities at the
   aggregation layer so the drill-down can present a true distinct-PR metric.
   This requires schema work and is out of scope.
3. **Documentation only:** add a code comment at `reviewer-activity.ts:55-58`
   pointing out that `reviewed_prs` is a per-week distinct count, not a
   period-distinct count. (Same site as P2-1's note.)

Severity: **P2.** The metric is mathematically the same one already shown on
the chart, so this PR doesn't introduce regression — but it widens the
exposure and the labels are now adjacent in a way the chart never made them.

---

### P2-3. Throughput per-author / per-repo sort has no defined tie-break, so identical `pr_count` values render in dictionary-iteration order

(a) `extension/ui/modules/drilldown/throughput-drilldown.ts:58-65`:

```ts
const rows: PanelRow[] = Object.entries(entries)
  .sort((a, b) => b[1].pr_count - a[1].pr_count)
  .map(([label, entry]) => ({
    label,
    values: [String(entry.pr_count)],
  }));
```

(b) **Scenario.** Two authors each landed 5 PRs in week W12. `Object.entries`
returns properties in insertion order, which for JSON deserialized rollups is
key order in the source file. JavaScript's `Array.prototype.sort` is
**guaranteed stable** as of ES2019 / V8 7.0, so the rows preserve insertion
order on ties. That's a defensible behavior — but it's not specified in the
spec and is fragile across renderers (the Python pipeline doesn't guarantee
deterministic dict ordering across runs unless `json.dumps(..., sort_keys=True)`
is in use, and the rollup writer in `aggregators.py` uses ordinary `dict`).
The same code path lives in `cycle-time-drilldown.ts:68-76`.

The cycle-time test at `cycle-time-drilldown.test.ts:255-257` carefully
chooses non-equal `pr_count` (22 vs 20) so the tie-break is never exercised.
The throughput test at `throughput-drilldown.test.ts:140-145` uses 35 vs 12,
also non-tied.

(c) **Suggested fix.** Add an explicit secondary sort by label (case-insensitive
ascending) in both throughput and cycle-time per-repo tables, and lock with a
test:

```ts
.sort((a, b) => {
  const c = b[1].pr_count - a[1].pr_count;
  if (c !== 0) return c;
  return a[0].localeCompare(b[0]);
})
```

Severity: **P2** — produces non-deterministic UX across pipeline reruns when
ties exist. Today this is masked because every existing test fixture avoids
ties, but real prod data with two repos at the same throughput is plausible.

---

## P3 (nice-to-have)

### P3-1. `Math.round(rate * 100)` truncates with banker's-style ties on `.5` boundaries

(a) `extension/ui/modules/charts/reviewer-activity.ts:232`,
`extension/ui/modules/drilldown/reviewer-drilldown.ts:88` (stat),
`reviewer-drilldown.ts:111` (per-week table).

(b) **Scenario.** `Math.round` in JS is **away-from-zero for positive halves**
(unlike Python's banker's rounding). A reviewer with weighted approval rate
exactly `0.155` renders as `16%` in JS. Same input fed into a Python report
(`round(0.155 * 100)` → `16` in Py3 because of FP, but `round(0.165 * 100)` →
`16` in Py3 vs `17` in JS due to banker's). Cross-tool comparisons (e.g. an
analyst pasting the chart number into a report computed in Python) would show
a 1pp delta. Not a bug here, just a known consistency boundary.

(c) **Suggested fix.** None required for Phase 1. If exact cross-tool agreement
matters, define a single rounding helper in `shared/format.ts` and document the
JS-vs-Python rounding boundary so future surfaces don't drift.

---

### P3-2. `formatDuration` rounds minutes via `Math.round`; sub-minute durations render as `0m` not `<1m`

(a) `extension/ui/modules/shared/format.ts:11-21`, used by
`cycle-time-drilldown.ts:54-57` for per-repo P50/P90 cells.

(b) **Scenario.** A repo with a P50 of `0.4` minutes (24 seconds) renders as
`"0m"`. The drill-down panel's per-repo table cell becomes `"0m"`, which a
user could misread as "no data" — exactly the same glyph the empty path is
trying to avoid. The em-dash for `null` stays distinct, but `0m` for "less
than 30 seconds" blurs the line.

(c) **Suggested fix.** None required for Phase 1 — this would change behavior
in every other consumer of `formatDuration` and is not introduced by this PR.
Consider a `<1m` floor in a future polish pass.

Severity: **P3.** Pre-existing behavior reused by the new drill-down, not a
regression.

---

### P3-3. Subtitle pluralization uses `=== 1` not `Math.abs(n) === 1`

(a) `throughput-drilldown.ts:69`, `cycle-time-drilldown.ts:88`,
`reviewer-drilldown.ts:133`.

(b) `pr_count` is `number` and `validateNonNegativeNumber` runs on it at the
schema layer, so a negative subtitle is not reachable from valid data. The
nit is purely cosmetic — singular/plural correctness at zero (`"0 PRs"` —
correct) and one (`"1 PR"` — correct, locked by tests
`throughput-drilldown.test.ts:580-590`, `reviewer-drilldown.test.ts:649-667`)
is right.

(c) **Suggested fix.** None — flagged only because the question was on the
review brief.

Severity: **P3.** No action needed.

---

### P3-4. `peakWeek === null` fallback writes `"0"` for a numeric `peakRepos` that's also implicitly 0 — fine, but the test that locks this is brittle

(a) `reviewer-drilldown.ts:89-90`,
`reviewer-drilldown.test.ts:240-260`.

(b) The `peakRepos` accumulator starts at `0`, and on weeks where every
`entry.repositories_count` is `undefined`, the `if (repos > peakRepos)` branch
never fires, leaving `peakWeek = null` and `peakRepos = 0`. The fallback
emits `"0"` (no week label). The locked test passes a single rollup with
`repositoriesCount: undefined` and asserts `values[3]` (the 4th stat) is
`"0"`. Two issues:

1. The test asserts on **value position**, not on label, so a future label
   reorder (e.g., putting "Peak repositories" before "Approval rate") would
   silently break the assertion in a confusing way.
2. The "0 (no qualifying week)" output contains zero context — a user looking
   at "Peak repositories: 0" with no week label cannot tell whether the
   reviewer touched no repos or whether the schema simply doesn't carry that
   field for this dataset. Compare to the explicit "Approval rate (no data) /
   —" that the same module renders on the line above.

(c) **Suggested fix (P3).** Mirror the approval-rate empty-state pattern:

```ts
const peakLabel =
  peakWeek === null ? "Peak repositories (no data)" : "Peak repositories";
const peakValue =
  peakWeek === null ? "—" : `${peakRepos} (${formatWeekLabel(peakWeek)})`;
```

This is a tiny UX fix but it brings the empty-state semantics in line with
the approval-rate row right above it.

Severity: **P3.** Internally consistent today; just a small UX symmetry win.

---

## Things I checked and found correct

- **`computeApprovalRate` weighting matches `aggregateReviewerEntries` in
  `metrics.ts:368-391`** — the same `reviewed_prs`-weighted formula, the
  same skip rule for `prs <= 0`, and the same `null` return on
  `totalPrs === 0`. The shared math is the right design move (the spec
  A-002 explicitly calls out the reuse). PR-301 made the helper exportable
  for exactly this consumer.
- **`buildStatRow` total reviews / PRs match the FR-041 spec exactly:**
  `Σ reviews_count` and `Σ reviewed_prs`. The labels match the spec wording.
- **`buildStatRow` peak repositories** uses `max(repositories_count)` with
  the qualifying week label, matching FR-042. The week label uses
  `formatWeekLabel("YYYY-Www")` → `"Www"` which is consistent with the
  reviewer-activity chart's bar labels.
- **Cycle-time per-repo P50/P90 cells via `formatDuration`** — null becomes
  em-dash via `formatDurationOrDash` (`cycle-time-drilldown.ts:54-57`).
  Matches FR-031 and the existing chart legend semantics.
- **Throughput sort** is correct in direction (desc by `pr_count`); the
  tie-break concern in P2-3 is the only nuance.
- **Subtitle pluralization** ("1 PR" / "0 PRs" / "47 PRs", "1 PR reviewed" /
  "0 PRs reviewed" / "22 PRs reviewed") is correct at the locked count
  values.
- **Prod-shape edge cases** in `tests/parity/prod-shape-edge-cases.test.ts:349-422`
  cover: empty-breakdown throughput (renders 2 EmptyStateSection, 0
  BreakdownTableSection) and all-null cycle-time week (renders em-dash stats
  + 1 EmptyStateSection). Both panels stay open and render the
  null-result UX rather than a silent no-op or a misleading zero.
- **Reviewer "not found in this period" scenario** at
  `reviewer-drilldown.test.ts:623-647` correctly opens the panel with
  `"0 PRs reviewed"` rather than silently no-opping.
- **Per-week table empty-cell semantics for null `approval_rate`** at
  `reviewer-drilldown.ts:108-111` matches FR-043 ("empty cell when not
  computable for that week") — the cell becomes `""` rather than `"—"` to
  distinguish "we have the row but no metric" from a typed dash.

---

## Summary

| Severity | Count |
|----------|-------|
| P1       | 0     |
| P2       | 3     |
| P3       | 4     |

The numeric layer is solid and the design decisions (weighting by
`reviewed_prs`, em-dash on null cells, defensive open-with-empty for the
"not found" path) match the spec and the upstream pipeline contract. The two
sharpest data-quality concerns — sort tie-breaking and the labelling of the
weighted approval rate next to a sum of weekly `reviewed_prs` — are
behavioral nits the team can land before merge or defer to a follow-up.
