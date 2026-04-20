# Contract: PrListSection UI Component

**Scope**: new `PanelSection` variant in `extension/ui/modules/shared/detail-panel.ts` plus its rendering path in `throughput-drilldown.ts`. Governs the stable PR-detail container and the four content states defined by FR-020.

**Authoritative spec refs**: FR-004, FR-007, FR-007a, FR-009, FR-010, FR-011, FR-017, FR-020, FR-026. Data-model: `data-model.md` §5. Inherits Phase 1 `specs/059-chart-drill-down/contracts/detail-panel-api.md`.

## Variant contract

### Addition to the sealed `PanelSection` union

```typescript
// Appended to the existing sealed union:
export interface PrListSection {
  readonly type: "pr-list";
  readonly contentState: "pr-list" | "supported-empty" | "team-inline" | "reviewer-inline";
  readonly rows?: readonly PrListRow[];                 // Present iff contentState === "pr-list"
  readonly renderedCount?: number;                      // Present iff contentState === "pr-list"
  readonly actualFilteredCount?: number;                // Present iff contentState === "pr-list"
  readonly capValue?: number;                           // Present iff contentState === "pr-list"; mirrors _prs_cap
}

export interface PrListRow {
  readonly id: number;
  readonly title: string;
  readonly cycleTimeMinutes: number;
  readonly url: string;            // Pre-derived by resolvePrUrl at build time
}
```

### Construction helper

Follows the existing pattern (`makeBreakdownTable`, `makeStatRow`, `makeEmptyState`):

```typescript
export function makePrListSection(input: {
  readonly contentState: "pr-list" | "supported-empty" | "team-inline" | "reviewer-inline";
  readonly rows?: readonly PrListRow[];
  readonly renderedCount?: number;
  readonly actualFilteredCount?: number;
  readonly capValue?: number;
}): PrListSection
```

### Switch extension in `renderSection`

```typescript
function renderSection(section: PanelSection): HTMLElement {
  switch (section.type) {
    case "breakdown-table":
      return renderBreakdownTable(section);
    case "stat-row":
      return renderStatRow(section);
    case "empty-state":
      return renderEmptyState(section);
    case "pr-list":                                    // NEW
      return renderPrListSection(section);
  }
}
```

## Stable-container invariants

`renderPrListSection(section)` MUST:

1. ALWAYS return a `<section>` element with:
   - `class="detail-panel-section detail-panel-section--pr-detail"`
   - `id="pr-detail"`
   - ARIA identity consistent across all four content states (`role="region"`, `aria-labelledby="pr-detail-heading"`)
   - Heading `<h3 id="pr-detail-heading">` with text that remains constant across content states (suggested: "Pull requests"). The heading text is display-stable; sub-content below the heading varies.
2. Render child content selected by `section.contentState` — never by inspecting anything else (no consultation of filter state, no `isDrilldownDisabledByComparison()` calls).
3. NEVER omit the section. The sealed union makes omission a type error; runtime FR-020 makes it a test failure.
4. NEVER introduce additional sibling sections for the four states. All four states live within the same `<section>` container.

### Content-state renderers (summary)

| `contentState` | Rendered inside `<section id="pr-detail">` |
|---|---|
| `"pr-list"` | `<h3>` + truncation indicator iff `renderedCount < actualFilteredCount` + `<ol>` (or `<ul>`) of PR rows. Each row: `<li><a href="{row.url}" target="_blank" rel="noopener noreferrer">#{row.id} — {escapeHtml(row.title)}</a> <span class="cycle-time">{formatDuration(row.cycleTimeMinutes)}</span></li>`. |
| `"supported-empty"` | `<h3>` + `<p class="detail-panel-empty-detail">No PRs match the active filter in this week.</p>`. Same empty-pattern class as Phase 1 EmptyStateSection. |
| `"team-inline"` | `<h3>` + `<p class="pr-detail-gated">Clear the team filter to view PR-level detail.</p>` announced to screen readers as a status change (container has `aria-live="polite"` on the message block only; heading is unchanged). |
| `"reviewer-inline"` | `<h3>` + `<p class="pr-detail-gated">Clear the reviewer filter to view PR-level detail.</p>`. Same `aria-live` treatment as team-inline. |

### Truncation indicator

Rendered INSIDE the `"pr-list"` content state when `renderedCount < actualFilteredCount`. Reuses the shared `renderTruncationIndicator(truncated, maxPoints, noun)` helper (`extension/ui/modules/shared/chart-layout.ts:16`) with `noun="PRs"`, `maxPoints=capValue`, and a caller-side wrapper that surfaces both counts per FR-008. Copy pattern: "Showing {renderedCount} of {actualFilteredCount} matching PRs (top {capValue} by cycle time)."

## Integration contract with `throughput-drilldown.ts:buildPanelContent`

```typescript
function buildPanelContent(rollup: Rollup, filterClassification: FilterClassification): PanelContent {
  // ... existing byAuthor / byRepository sections unchanged ...

  const prListSection: PrListSection = (() => {
    switch (filterClassification.classification) {
      case "supported": {
        const rows = (rollup.prs ?? []).map(pr => ({
          id: pr.id,
          title: pr.title,
          cycleTimeMinutes: pr.cycle_time,
          url: resolvePrUrl(pr, repositoriesDimension, webContext),
        }));
        const renderedCount = rows.length;
        const actualFilteredCount = rollup.pr_count;
        const capValue = rollup._prs_cap ?? 500;
        return makePrListSection({
          contentState: rows.length === 0 ? "supported-empty" : "pr-list",
          rows: rows.length > 0 ? rows : undefined,
          renderedCount: rows.length > 0 ? renderedCount : undefined,
          actualFilteredCount: rows.length > 0 ? actualFilteredCount : undefined,
          capValue: rows.length > 0 ? capValue : undefined,
        });
      }
      case "team":     return makePrListSection({ contentState: "team-inline" });
      case "reviewer": return makePrListSection({ contentState: "reviewer-inline" });
      // "comparison" classification never reaches here — panel does not open; Phase 1 toast-denial preserved.
    }
  })();

  return makePanelContent(formatWeekTitle(rollup), subtitle, [byAuthor, byRepository, prListSection]);
}
```

The switch is the ONLY place `filterClassification` is consumed inside the render path. Exhaustiveness check (TypeScript `never` on the default case if added) guards against future classification additions.

## Accessibility invariants

- Container `<section>` has `role="region"` + `aria-labelledby` (Phase 1 pattern).
- Content transitions between states are NOT announced as interruptions (`role="alert"` / `aria-live="assertive"` are reserved for the comparison-advisory toast per FR-010).
- The team/reviewer inline messages use `aria-live="polite"` on the `<p>` message element so screen readers announce the state change as status, not as an alert.
- Keyboard navigation: each PR link is a standard `<a>` element; Tab lands on each link in render order. No `tabindex` manipulation.

## Tests that assert this contract

- `extension/tests/modules/shared/detail-panel.test.ts` (extended) — all four content states produce identical `<section>` identity (tag, id, class, ARIA attributes).
- `extension/tests/modules/drilldown/throughput-drilldown.test.ts` (extended) — `buildPanelContent` always emits a `PrListSection`; classification → contentState mapping.
- `extension/tests/modules/drilldown/pr-list-count-parity.test.ts` (new) — rendered count equals filtered pr_count (or truncates to cap); truncation indicator visibility matches FR-008.
- Manual / Playwright smoke (optional) — user can Tab through PR links; screen-reader dry-run for the polite/alert split.
