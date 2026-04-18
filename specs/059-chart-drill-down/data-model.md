# Data Model — Chart drill-down Phase 1

**Branch**: `059-chart-drill-down`
**Date**: 2026-04-18
**Scope**: TypeScript-only, front-end ephemeral state. No persisted schema. No rollup/schema extension.

This document captures the entities, their fields, relationships, validation rules, and state transitions that `/speckit.tasks` will generate tasks against. All types are sealed in Phase 1 — Phase 2 extension points are marked.

---

## Entities

### 1. `PanelContent`

Represents everything the DetailPanel displays for a single open instance.

| Field      | Type                              | Required | Source of truth                             | Notes |
|------------|-----------------------------------|----------|---------------------------------------------|-------|
| `title`    | `string` (non-empty)              | Yes      | Computed from `DrillDownContext`            | Human-readable, e.g. "Week of Mar 18 – 24, 2025" |
| `subtitle` | `string \| null`                  | No       | Computed from `DrillDownContext`            | e.g. "47 PRs" (FR-021); `null` allowed |
| `sections` | `readonly PanelSection[]`         | Yes      | Per-chart derivation from weekly rollups    | Ordered; MUST be non-empty (FR-003) |

**Validation rules**:

- `title.length > 0` — enforced at construction; zero-length title is a programming error (test-asserted).
- `sections.length >= 1` — an "empty detail" case MUST still produce a single `empty-state` section rather than an empty array (FR-023, FR-041, FR-071).

---

### 2. `PanelSection` (discriminated union)

**Phase 1 variants** (sealed):

```ts
type PanelSection =
  | BreakdownTableSection
  | StatRowSection
  | EmptyStateSection;
```

#### 2a. `BreakdownTableSection`

| Field     | Type                                         | Required | Notes |
|-----------|----------------------------------------------|----------|-------|
| `type`    | `"breakdown-table"`                          | Yes      | Discriminant |
| `title`   | `string`                                     | Yes      | Section header, e.g. "By author" |
| `columns` | `readonly [string, string, ...string[]]`     | Yes      | At least 2 columns; first column is the row label |
| `rows`    | `readonly PanelRow[]`                        | Yes      | Order determined by caller (caller sorts) |

#### 2b. `StatRowSection`

| Field   | Type                        | Required | Notes |
|---------|-----------------------------|----------|-------|
| `type`  | `"stat-row"`                | Yes      | Discriminant |
| `stats` | `readonly PanelStat[]`      | Yes      | Each renders as `{label, value}` |

#### 2c. `EmptyStateSection`

| Field    | Type              | Required | Notes |
|----------|-------------------|----------|-------|
| `type`   | `"empty-state"`   | Yes      | Discriminant |
| `title`  | `string`          | Yes      | Short heading e.g. "No PRs for this week" |
| `detail` | `string`          | Yes      | One-sentence explanation |

**Phase 2 extension point** (documented, not implemented): when PR-level or mini-chart sections land, the discriminated union extends by adding new `type` values. All existing Phase 1 consumers continue to work because discriminant checks force the compiler to flag exhaustiveness gaps.

---

### 3. `PanelRow` and `PanelStat`

```ts
interface PanelRow {
  readonly label: string;          // displayed in the first column
  readonly values: readonly string[]; // values for subsequent columns, index-aligned to columns[1..]
}

interface PanelStat {
  readonly label: string;
  readonly value: string;          // already formatted (e.g. "47", "4.2 h", "65%")
  readonly tone?: "neutral" | "positive" | "negative"; // optional visual treatment
}
```

**Validation**: `PanelRow.values.length === PanelContent.sections[i].columns.length - 1`. Tests enforce.

---

### 4. `DrillDownContext`

What the drill-down glue passes to `openDetailPanel`.

| Field            | Type                                         | Required | Notes |
|------------------|----------------------------------------------|----------|-------|
| `sourceChart`    | `"throughput" \| "cycle-time" \| "reviewer"` | Yes      | Sparklines do NOT open the panel (they navigate); they never produce a `DrillDownContext`. |
| `focusedData`    | `ThroughputFocus \| CycleTimeFocus \| ReviewerFocus` | Yes | Discriminated by `sourceChart` |
| `triggerElement` | `HTMLElement`                                | Yes      | The clicked data-point element; panel records it for focus-return on dismiss |

```ts
interface ThroughputFocus {
  readonly weekIso: string;        // ISO week key matching rollup.week
}
interface CycleTimeFocus {
  readonly weekIso: string;
  readonly metric: "p50" | "p90";
}
interface ReviewerFocus {
  readonly reviewerId: string;     // matches by_reviewer entry key
  // No per-repository field — Phase 1 uses aggregate ReviewerBreakdownEntry counts only.
  // A cross-dim reviewer × repo aggregate is deferred to issue #300.
}
```

---

### 5. `ComparisonModeAdvisoryState`

| Field          | Type                               | Required | Notes |
|----------------|------------------------------------|----------|-------|
| `isActive`     | `boolean`                          | Yes      | Mirrors `comparisonMode` in `dashboard.ts` |
| `bannerMounted`| `boolean`                          | Yes      | Whether the persistent banner note is in the DOM |
| `toastVisible` | `boolean`                          | Yes      | Whether an on-click toast is currently visible |

---

## Relationships

```text
DrillDownContext   ─────► openDetailPanel() ─────►  PanelContent
                                                     │
                                                     ├─ title
                                                     ├─ subtitle?
                                                     └─ sections: PanelSection[]
                                                                  │
                                                                  ├─ BreakdownTableSection
                                                                  ├─ StatRowSection
                                                                  └─ EmptyStateSection
```

- One `DrillDownContext` produces exactly one `PanelContent`.
- The panel holds at most one `PanelContent` at a time; opening a new context replaces the previous.
- `ComparisonModeAdvisoryState` is independent of the panel; panels never open while `isActive === true`.

---

## State transitions

### 5a. DetailPanel lifecycle

```text
CLOSED
  │  openDetailPanel(ctx) — only if comparisonMode === false
  ▼
OPENING (animating in)
  │  transitionend
  ▼
OPEN  ◄───┐  openDetailPanel(newCtx) retargets in place (no close-reopen flicker)
  │       │
  │       └────── panel stays open, content swaps
  │
  │  any dismiss reason
  ▼
CLOSING (animating out)
  │  transitionend
  ▼
CLOSED  (focus returned to DrillDownContext.triggerElement)
```

**Dismiss reasons** (all transition OPEN / OPENING → CLOSING):

| Reason                  | Source                                                                 |
|-------------------------|------------------------------------------------------------------------|
| `escape-key`            | `keydown` with `event.key === "Escape"` anywhere while panel is open   |
| `outside-click`         | `pointerdown` with `event.target` not inside the panel root             |
| `filters-changed`       | `drilldown:filters-changed` CustomEvent (R-01)                          |
| `tab-changed`           | `drilldown:tab-changed` with new tab !== `"metrics"` (R-01)             |
| `comparison-toggled`    | `drilldown:comparison-toggled` with new state `true`                    |
| `explicit-close-button` | panel's close control clicked or Enter-activated                        |

**Hard-dismiss invariant** (FR-005): `filters-changed` does NOT revalidate content; it transitions OPEN → CLOSING immediately. Tests enforce that no post-filter fetch or DOM mutation happens on the panel during that transition.

### 5b. Comparison-mode advisory

```text
OFF
  │  drilldown:comparison-toggled { enabled: true }
  ▼
ADVISORY-MOUNTED   (banner note visible; chart data-drilldown-disabled attributes set; any open panel dismissed)
  │  drilldown:comparison-toggled { enabled: false }
  ▼
OFF                 (banner note unmounted; chart attributes cleared; drill-down restored)
```

The transient on-click toast is an independent, time-bounded overlay with its own lifecycle — mount-on-click → auto-dismiss after a fixed duration — and does not participate in this state machine.

---

## Uniqueness and cardinality

- **Exactly one panel DOM root** exists per dashboard session (R-04).
- **At most one `PanelContent`** is bound to it at a time.
- **At most one comparison advisory banner** at a time.
- **At most one toast** at a time — a new click while a toast is visible replaces the toast in place.

---

## Validation summary (for test coverage)

| Invariant                                                                  | Verified by                                       |
|----------------------------------------------------------------------------|---------------------------------------------------|
| `title.length > 0`                                                         | `detail-panel.test.ts`                            |
| `sections.length >= 1` (always; empty state uses EmptyStateSection)        | `detail-panel.test.ts`                            |
| `row.values.length === columns.length - 1` per breakdown table             | `detail-panel.test.ts`                            |
| Discriminated union exhaustiveness                                          | TypeScript `never` check in switch; type-level test in `type-tests` if warranted |
| DetailPanel DOM is idempotent for same input                               | `render-equivalence.test.ts`                      |
| Hard-dismiss on filter change emits no post-dismiss DOM work on the panel   | `drilldown/lifecycle-signals.test.ts`             |
| Comparison toggle dismisses any open panel                                  | `drilldown/comparison-advisory.test.ts`           |
| Focus returns to `DrillDownContext.triggerElement` on every dismiss reason | `focus-trap.test.ts` + per-dismiss cases          |

---

## Phase 2 extension readiness

Non-breaking extensions available to Phase 2 within this model:

- Add `"pr-list"` and `"mini-chart"` variants to `PanelSection` (discriminated union forces consumers to handle them; Phase 1 consumers never construct them).
- Add a `"comparison"` source mode to `DrillDownContext.sourceChart`.
- Add a `bookmark` field to `PanelContent` for URL-bookmarkable drill-down state without altering Phase 1 behavior.
- Add a `BreakdownTableSection` titled "By repository" to the reviewer-drilldown output once a cross-dimensional `reviewer × repository` aggregate lands (tracked in #300). Phase 1 leaves only the peak-breadth stat; Phase 2 layers the table in alongside it without renaming or reshaping any existing Phase 1 section.

**Breaking changes intentionally avoided** in Phase 1: no sibling flags, no string-typed properties, no optional-without-default-null section fields. Discriminated types are the extension seam.

**Data-availability note (Pass 3/4 correction)**: `ReviewerBreakdownEntry` in the current rollup schema exposes only aggregate counts (`reviewed_prs`, `reviews_count`, `approval_rate`, `authors_count`, `repositories_count`) — NOT a per-repository listing for an individual reviewer. Phase 1 therefore derives the reviewer `PanelContent` entirely from: (a) sums of `reviewed_prs` / `reviews_count` over the active period, (b) the weighted `approval_rate` computed by `computeApprovalRate` in `reviewer-activity.ts` (made exportable in the same edit that wires the reviewer drill-down), (c) the max `repositories_count` across the active period (peak breadth stat with qualifying week label), and (d) a `BreakdownTableSection` with columns `week` / `reviews_count` / `reviewed_prs` / `approval_rate` populated from the same `by_reviewer[reviewerId]` entries iterated across rollups. No cross-dimensional data is required.
