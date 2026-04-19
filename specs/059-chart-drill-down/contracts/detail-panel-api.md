# Contract — DetailPanel public API

**Module**: `extension/ui/modules/shared/detail-panel.ts`
**Consumers**: `extension/ui/modules/drilldown/{throughput,cycle-time,reviewer}-drilldown.ts`, `extension/tests/parity/render-equivalence.test.ts`, `extension/tests/modules/shared/detail-panel.test.ts`
**Contract stability**: Sealed for Phase 1. Extension seam is the `PanelSection` discriminated union (see `../data-model.md`).

---

## Public surface

All types live in `extension/ui/modules/shared/detail-panel.ts` unless noted.

```ts
// ── Types ───────────────────────────────────────────────────────────────

export type PanelSection =
  | BreakdownTableSection
  | StatRowSection
  | EmptyStateSection;

export interface BreakdownTableSection {
  readonly type: "breakdown-table";
  readonly title: string;
  readonly columns: readonly [string, string, ...string[]];
  readonly rows: readonly PanelRow[];
}

export interface StatRowSection {
  readonly type: "stat-row";
  readonly stats: readonly PanelStat[];
}

export interface EmptyStateSection {
  readonly type: "empty-state";
  readonly title: string;
  readonly detail: string;
}

export interface PanelRow {
  readonly label: string;
  readonly values: readonly string[];
}

export interface PanelStat {
  readonly label: string;
  readonly value: string;
  readonly tone?: "neutral" | "positive" | "negative";
}

export interface PanelContent {
  readonly title: string;           // non-empty (validated)
  readonly subtitle: string | null;
  readonly sections: readonly PanelSection[]; // length >= 1
}

export type DismissReason =
  | "escape-key"
  | "outside-click"
  | "filters-changed"
  | "tab-changed"
  | "comparison-toggled"
  | "explicit-close-button";

export interface DrillDownContext {
  readonly sourceChart: "throughput" | "cycle-time" | "reviewer";
  readonly focusedData:
    | { readonly kind: "throughput"; readonly weekIso: string }
    | { readonly kind: "cycle-time"; readonly weekIso: string; readonly metric: "p50" | "p90" }
    | { readonly kind: "reviewer"; readonly reviewerId: string };
  readonly triggerElement: HTMLElement;
  readonly content: PanelContent;
}

// ── Functions ───────────────────────────────────────────────────────────

/**
 * Open (or retarget) the detail panel with the supplied context.
 *
 * Idempotent for identical input: calling twice with identical context
 * produces identical DOM (verified by render-equivalence.test.ts).
 *
 * Guards:
 *  - Throws if PanelContent.title is empty.
 *  - Throws if PanelContent.sections is empty.
 *  - Returns without opening if comparison mode is currently active
 *    (caller is expected to dispatch to comparison-advisory instead).
 */
export function openDetailPanel(context: DrillDownContext): void;

/**
 * Dismiss the panel with the given reason.
 *
 * Behavior per reason:
 *  - escape-key / outside-click / explicit-close-button: animated close, focus returns to trigger.
 *  - filters-changed: hard dismiss — transitions to CLOSING immediately; NO content revalidation.
 *  - tab-changed: dismiss only if new tab !== "metrics".
 *  - comparison-toggled: dismiss immediately; the advisory UX takes over.
 *
 * No-op if no panel is open.
 */
export function dismissDetailPanel(reason: DismissReason): void;

/**
 * Query whether the panel is currently open (state is OPENING or OPEN).
 */
export function isDetailPanelOpen(): boolean;
```

### Construction helpers (also exported from the same module)

```ts
/** Build a PanelContent with runtime validation. Throws TypeError on invariant breach. */
export function makePanelContent(
  title: string,
  subtitle: string | null,
  sections: readonly PanelSection[],
): PanelContent;

/** Build a BreakdownTableSection; enforces row-length == columns-length - 1. */
export function makeBreakdownTable(
  title: string,
  columns: readonly [string, string, ...string[]],
  rows: readonly PanelRow[],
): BreakdownTableSection;

/** Build a StatRowSection. */
export function makeStatRow(stats: readonly PanelStat[]): StatRowSection;

/** Build an EmptyStateSection. Use whenever aggregate data is empty under current filters. */
export function makeEmptyState(title: string, detail: string): EmptyStateSection;
```

---

## DOM contract

- **Root element**: exactly one `<aside class="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-panel-title">` appended to `document.body` lazily on first `openDetailPanel` call. Never removed; closed state toggles `is-open` class off.
- **Title element**: `<h2 id="detail-panel-title">{PanelContent.title}</h2>` — `escapeHtml` applied via `textContent`.
- **Close control**: `<button type="button" class="detail-panel-close" aria-label="Close detail panel">...</button>`. First focusable element inside the panel.
- **Sections root**: `<div class="detail-panel-sections">…</div>`. Each `PanelSection` renders as a `<section>` with a class matching its discriminant (`detail-panel-section detail-panel-section--breakdown-table` etc.).
- **CSS-only animation** via `transform: translateX(...)` on the `is-open` class toggle; respects `prefers-reduced-motion`. No JS animation frames.

## Parity guarantee

```ts
// render-equivalence.test.ts MUST pass this style of assertion for drill-down:
const a = document.createElement("div"); document.body.appendChild(a);
const b = document.createElement("div"); document.body.appendChild(b);
openDetailPanel(ctx); // host A — assume setup targets A
const aHtml = document.querySelector("aside.detail-panel")!.innerHTML;
dismissDetailPanel("explicit-close-button");
openDetailPanel(ctx); // host B — same ctx
const bHtml = document.querySelector("aside.detail-panel")!.innerHTML;
expect(aHtml).toBe(bHtml);
```

Identical input → identical DOM is mandatory (SC-005, FR-010).

---

## Error handling

- Empty title / empty sections → `TypeError` at `makePanelContent` or `openDetailPanel` entry. No partial render, no silent fallback.
- Calling `openDetailPanel` while comparison mode is active → warn in dev (`console.warn`) and no-op; the comparison advisory module is the intended caller path in that case.
- `dismissDetailPanel` when closed → silent no-op.

---

## Non-goals (out of scope for this contract)

- Section types beyond `breakdown-table`, `stat-row`, `empty-state` (Phase 2).
- Navigational behavior (back/forward history) — panel state is ephemeral, not URL-bound (FR-009).
- Toast / banner / advisory rendering — owned by `comparison-advisory.ts`, not this module.
