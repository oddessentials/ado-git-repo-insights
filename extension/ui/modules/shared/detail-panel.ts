/**
 * Shared DetailPanel component.
 *
 * A single right-side dialog/dismissable overlay consumed by the Phase 1
 * drill-down cohort (throughput, cycle-time, reviewer). Per
 * `specs/059-chart-drill-down/contracts/detail-panel-api.md`:
 *
 *   - One DOM root appended lazily to document.body; opens toggle
 *     `is-open` class, content is replaced in place (idempotent).
 *   - Content shape is a sealed discriminated union (`PanelSection`)
 *     with three variants today (`breakdown-table`, `stat-row`,
 *     `empty-state`) — Phase 2 extends by adding new variants.
 *   - Dismissal reasons: escape-key / outside-click / filters-changed
 *     / tab-changed / comparison-toggled / explicit-close-button.
 *     Filters-changed is hard: no content revalidation between event
 *     and CLOSING (FR-005).
 *   - Keyboard focus is trapped within the panel via
 *     `shared/focus-trap.ts`; focus is returned to the trigger element
 *     on dismiss (FR-007 / FR-008).
 *
 * The panel tracks comparison-mode state via a lifetime subscription to
 * COMPARISON_TOGGLED_EVENT — when active, openDetailPanel warns and
 * no-ops. The comparison-advisory module (Commit D of this feature)
 * provides the user-visible cue for that path.
 */

import { createElement, appendText, clearElement } from "./render";
import { formatDuration } from "./format";
import { trapFocus, restoreFocus } from "./focus-trap";
import {
  COMPARISON_TOGGLED_EVENT,
  FILTERS_CHANGED_EVENT,
  TAB_CHANGED_EVENT,
  type ComparisonToggledEvent,
  type TabChangedEvent,
} from "../drilldown/lifecycle-signals";
import { showInfoTooltip, dismissAllTooltips } from "../tooltip-manager";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PanelRow {
  readonly label: string;
  readonly values: readonly string[];
}

export interface PanelStat {
  readonly label: string;
  readonly value: string;
  readonly tone?: "neutral" | "positive" | "negative";
}

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

/**
 * Pre-derived PR row shown inside the PrListSection "pr-list" content state.
 * Feature 060 contract — the URL is pre-composed at build time (by
 * `resolvePrUrl`) so the renderer has no I/O or resolution work.
 *
 * Feature 310 extends the row with three optional comments-metrics fields
 * (`threadCount` / `commentCount` / `activeThreadCount`).  They carry data
 * per row but are only RENDERED when the enclosing section's
 * `commentsMetricsAvailable` flag is `true` (section-level capability
 * gate — absent entirely on the capability-off path, preserving SC-03
 * byte-identity).  Per-row semantics mirror the producer's wire shape:
 *   - `undefined` / absent: capability-off row (the section flag is
 *     `false`; downstream code MUST NOT read these fields in that case).
 *   - `null`: covered PR whose `comments_extracted_at` is NULL (partial
 *     sentinel per INV-10 / FR-3-05; renders visibly distinct from a
 *     numeric 0).
 *   - number: covered PR with known counts.  `0` is a true zero.
 * All three field values arrive together or not at all (INV-08 mirrored
 * on the consumer side).
 */
export interface PrListRow {
  readonly id: number;
  readonly title: string;
  readonly cycleTimeMinutes: number;
  readonly url: string;
  readonly threadCount?: number | null;
  readonly commentCount?: number | null;
  readonly activeThreadCount?: number | null;
}

/**
 * Coverage-partial discriminator for a {@link PrListRow}.
 *
 * Returns ``true`` when the row carries no comments-metrics data — either:
 *
 *   - ``null``: covered PR with ``comments_extracted_at IS NULL`` (INV-10
 *     coverage-partial sentinel — the documented producer state).
 *   - ``undefined``: capability-off-passthrough leak.  Per the producer
 *     comment in throughput-drilldown.ts (``installThroughputDrilldown``,
 *     "supported" branch) the consumer is the contract enforcer for
 *     partial detection — the producer hands ``pr.thread_count`` straight
 *     through without normalising ``undefined`` to ``null``.  Every
 *     consumer site (renderer + stat-row aggregate) MUST honour both
 *     shapes identically or partial-state UI surfaces drift apart (issue
 *     #342 review finding: ``buildCommentsStatRow`` previously counted
 *     only ``=== null`` and rendered ``0`` on slices where the per-row
 *     panel showed ``———`` and the coverage notice said "none of these
 *     PRs have comment data yet").
 *
 * Per INV-08 (triplet atomicity — all three values arrive together or
 * not at all) ``threadCount`` alone is a sufficient discriminator; no
 * cross-field check is required.
 */
export function isPartialPrRow(row: PrListRow): boolean {
  return row.threadCount === null || row.threadCount === undefined;
}

/**
 * Feature 060: stable PR-detail container on the throughput drill-down panel.
 *
 * The single section MUST render across four content states without being
 * omitted or replaced by sibling sections (FR-020). The rendered `<section>`
 * shell (tag, id, class, ARIA identity) is byte-identical across states; only
 * the inner content below the stable heading varies.
 *
 * The type is a discriminated union on `contentState`: the `"pr-list"` variant
 * carries the PR rows + count + cap fields; the message variants
 * (`"supported-empty"` / `"team-inline"` / `"reviewer-inline"`) carry only the
 * discriminant. This keeps TypeScript from seeing the payload fields as
 * optional on the render path, which previously drove over-defensive `??`
 * fallbacks that the partial-branch ratchet flagged as unreachable.
 */
export interface PrListSectionWithRows {
  readonly type: "pr-list";
  readonly contentState: "pr-list";
  readonly rows: readonly PrListRow[];
  readonly renderedCount: number;
  readonly actualFilteredCount: number;
  readonly capValue: number;
  // Feature 310 — section-level capability gate for the three
  // comments-metrics columns.  When `true` the renderer emits one
  // additional header + three `<span>`s per row; when `false` the
  // DOM stays byte-identical to the pre-310 shape (SC-03 / FR-3-06).
  readonly commentsMetricsAvailable: boolean;
}

export interface PrListSectionMessage {
  readonly type: "pr-list";
  readonly contentState: "supported-empty" | "team-inline" | "reviewer-inline";
}

export type PrListSection = PrListSectionWithRows | PrListSectionMessage;

export type PanelSection =
  | BreakdownTableSection
  | StatRowSection
  | EmptyStateSection
  | PrListSection;

export interface PanelContent {
  readonly title: string;
  readonly subtitle: string | null;
  readonly sections: readonly PanelSection[];
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
    | {
        readonly kind: "cycle-time";
        readonly weekIso: string;
        readonly metric: "p50" | "p90";
      }
    | { readonly kind: "reviewer"; readonly reviewerId: string };
  readonly triggerElement: HTMLElement;
  readonly content: PanelContent;
}

// ---------------------------------------------------------------------------
// Construction helpers — enforce content invariants at build time.
// ---------------------------------------------------------------------------

export function makePanelContent(
  title: string,
  subtitle: string | null,
  sections: readonly PanelSection[],
): PanelContent {
  if (title.length === 0) {
    throw new TypeError("PanelContent.title MUST be non-empty");
  }
  if (sections.length === 0) {
    throw new TypeError(
      "PanelContent.sections MUST contain at least one section",
    );
  }
  return { title, subtitle, sections };
}

export function makeBreakdownTable(
  title: string,
  columns: readonly [string, string, ...string[]],
  rows: readonly PanelRow[],
): BreakdownTableSection {
  const expectedValues = columns.length - 1;
  for (const row of rows) {
    if (row.values.length !== expectedValues) {
      throw new TypeError(
        `BreakdownTableSection row has ${row.values.length} values but expected ${expectedValues} (columns.length - 1)`,
      );
    }
  }
  return { type: "breakdown-table", title, columns, rows };
}

export function makeStatRow(stats: readonly PanelStat[]): StatRowSection {
  return { type: "stat-row", stats };
}

export function makeEmptyState(
  title: string,
  detail: string,
): EmptyStateSection {
  return { type: "empty-state", title, detail };
}

/**
 * Construct a PrListSection (feature 060). The input is a discriminated
 * union on `contentState`, so the payload shape is validated at compile
 * time — the runtime throws from the previous API are not needed.
 */
export type PrListSectionInput =
  | {
      readonly contentState: "pr-list";
      readonly rows: readonly PrListRow[];
      readonly renderedCount: number;
      readonly actualFilteredCount: number;
      readonly capValue: number;
      // Feature 310 — required on the pr-list variant only.  Message
      // variants never render rows so the flag does not apply there.
      readonly commentsMetricsAvailable: boolean;
    }
  | {
      readonly contentState:
        | "supported-empty"
        | "team-inline"
        | "reviewer-inline";
    };

export function makePrListSection(input: PrListSectionInput): PrListSection {
  if (input.contentState === "pr-list") {
    return {
      type: "pr-list",
      contentState: "pr-list",
      rows: input.rows,
      renderedCount: input.renderedCount,
      actualFilteredCount: input.actualFilteredCount,
      capValue: input.capValue,
      commentsMetricsAvailable: input.commentsMetricsAvailable,
    };
  }
  return { type: "pr-list", contentState: input.contentState };
}

// ---------------------------------------------------------------------------
// Panel state and lifetime-scoped comparison tracker
// ---------------------------------------------------------------------------

type PanelState = "closed" | "opening" | "open" | "closing";

interface ActivePanel {
  readonly root: HTMLElement; // <aside> — no specialized DOM interface exists
  readonly sectionsRoot: HTMLElement;
  readonly titleEl: HTMLElement;
  readonly subtitleEl: HTMLElement;
  readonly closeBtn: HTMLButtonElement;
}

let panelEls: ActivePanel | null = null;
let panelState: PanelState = "closed";
let activeContext: DrillDownContext | null = null;
let focusTrapController: AbortController | null = null;
let openScopedController: AbortController | null = null;

// Lifetime tracker for comparison mode — set on every
// COMPARISON_TOGGLED_EVENT so openDetailPanel can refuse cleanly.
let comparisonActive = false;
{
  const lifetimeComparisonListener: EventListener = (evt) => {
    const e = evt as ComparisonToggledEvent;
    comparisonActive = e.detail.enabled;
  };
  window.addEventListener(COMPARISON_TOGGLED_EVENT, lifetimeComparisonListener);
}

// Issue #332 / B2 (Codex PR #343 P2 follow-up): module-scope trackers
// for the deferred outside-click dismiss the C1 info-icon arms when
// the user clicks (touch / keyboard show path).  Two pieces of state
// because the listener is armed across two phases — a pending rAF and
// (after the rAF fires) an attached document-level click listener —
// and an alternate dismiss path (pointerleave, second icon click,
// ``dismissDetailPanel``) can interrupt EITHER phase.  Without
// cancelling BOTH:
//
//   - Pre-rAF interrupt with abort-only cleanup: nothing to abort
//     yet; the rAF still fires later and attaches the stale listener.
//   - Post-rAF interrupt with frame-cancel-only cleanup: nothing
//     pending to cancel; the already-attached listener leaks.
//
// ``clearOutsideClickListener`` collapses both phases.
let outsideClickAbort: AbortController | null = null;
let outsideClickFrame: number | null = null;

function clearOutsideClickListener(): void {
  outsideClickAbort?.abort();
  outsideClickAbort = null;
  if (outsideClickFrame !== null) {
    cancelAnimationFrame(outsideClickFrame);
    outsideClickFrame = null;
  }
}

// ---------------------------------------------------------------------------
// DOM construction
// ---------------------------------------------------------------------------

function ensurePanelEls(): ActivePanel {
  // Bust the cache if the DOM was cleared (tests do this) or the root was
  // otherwise removed from the document.
  if (panelEls && !panelEls.root.isConnected) {
    panelEls = null;
    panelState = "closed";
    activeContext = null;
    openScopedController?.abort();
    openScopedController = null;
    focusTrapController?.abort();
    focusTrapController = null;
  }
  if (panelEls) return panelEls;

  const root = document.createElement("aside");
  root.className = "detail-panel";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "detail-panel-title");

  const header = createElement("div", { class: "detail-panel-header" });

  const titleEl = createElement("h2", { id: "detail-panel-title" });
  header.appendChild(titleEl);

  const subtitleEl = createElement("p", { class: "detail-panel-subtitle" });
  header.appendChild(subtitleEl);

  const closeBtn = createElement(
    "button",
    {
      type: "button",
      class: "detail-panel-close",
      "aria-label": "Close detail panel",
    },
    "×",
  );
  closeBtn.addEventListener("click", () => {
    dismissDetailPanel("explicit-close-button");
  });
  header.appendChild(closeBtn);

  root.appendChild(header);

  const sectionsRoot = createElement("div", {
    class: "detail-panel-sections",
  });
  root.appendChild(sectionsRoot);

  document.body.appendChild(root);

  panelEls = { root, sectionsRoot, titleEl, subtitleEl, closeBtn };
  return panelEls;
}

function renderContent(els: ActivePanel, content: PanelContent): void {
  // Title + subtitle
  clearElement(els.titleEl);
  appendText(els.titleEl, content.title);

  clearElement(els.subtitleEl);
  if (content.subtitle !== null) {
    appendText(els.subtitleEl, content.subtitle);
    els.subtitleEl.style.display = "";
  } else {
    els.subtitleEl.style.display = "none";
  }

  // Sections
  clearElement(els.sectionsRoot);
  for (const section of content.sections) {
    els.sectionsRoot.appendChild(renderSection(section));
  }
}

function renderSection(section: PanelSection): HTMLElement {
  switch (section.type) {
    case "breakdown-table":
      return renderBreakdownTable(section);
    case "stat-row":
      return renderStatRow(section);
    case "empty-state":
      return renderEmptyState(section);
    case "pr-list":
      return renderPrListSection(section);
  }
}

function renderBreakdownTable(section: BreakdownTableSection): HTMLElement {
  const wrapper = createElement("section", {
    class: "detail-panel-section detail-panel-section--breakdown-table",
  });
  const heading = createElement("h3", {}, section.title);
  wrapper.appendChild(heading);

  const table = createElement("table", { class: "detail-panel-table" });
  const thead = createElement("thead");
  const headerRow = createElement("tr");
  for (const col of section.columns) {
    const th = createElement("th", { scope: "col" }, col);
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = createElement("tbody");
  for (const row of section.rows) {
    const tr = createElement("tr");
    const firstCell = createElement("th", { scope: "row" }, row.label);
    tr.appendChild(firstCell);
    for (const value of row.values) {
      tr.appendChild(createElement("td", {}, value));
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrapper.appendChild(table);

  return wrapper;
}

function renderStatRow(section: StatRowSection): HTMLElement {
  const wrapper = createElement("section", {
    class: "detail-panel-section detail-panel-section--stat-row",
  });
  const list = createElement("dl", { class: "detail-panel-stats" });
  for (const stat of section.stats) {
    const dt = createElement("dt", {}, stat.label);
    const ddAttrs: Record<string, string> = {};
    if (stat.tone !== undefined) {
      ddAttrs["data-tone"] = stat.tone;
    }
    const dd = createElement("dd", ddAttrs, stat.value);
    list.appendChild(dt);
    list.appendChild(dd);
  }
  wrapper.appendChild(list);
  return wrapper;
}

function renderEmptyState(section: EmptyStateSection): HTMLElement {
  const wrapper = createElement("section", {
    class: "detail-panel-section detail-panel-section--empty-state",
  });
  wrapper.appendChild(createElement("h3", {}, section.title));
  wrapper.appendChild(
    createElement("p", { class: "detail-panel-empty-detail" }, section.detail),
  );
  return wrapper;
}

// ---------------------------------------------------------------------------
// Feature 310 — comments-metrics column header (sort) + threshold filter.
// ---------------------------------------------------------------------------

/** One of the three comments-metrics sort + filter axes. */
type CommentsMetricsKey = "threads" | "comments" | "unresolved";

/** Tri-state column sort direction; mirrors the ``aria-sort`` enum. */
type SortDirection = "none" | "descending" | "ascending";

const COMMENTS_METRICS_AXES: readonly {
  readonly key: CommentsMetricsKey;
  /**
   * Full disambiguated label.  Used in places that have horizontal
   * room: filter row's visible label, filter input's ``aria-label``,
   * column-header button's ``title`` (hover tooltip), column-header
   * button's ``aria-label`` (screen-reader label), and the stat-row
   * label literals (which are short enough to spell out in full).
   */
  readonly label: string;
  /**
   * Short label used as the column-header button's visible
   * ``textContent``.  Identical to ``label`` for axes whose full name
   * already fits the narrow numeric column width; differs only for
   * ``"unresolved"``, where ``"Unresolved threads"`` would overflow
   * the data column reserved for 1–3-digit counts.  The full form
   * is still surfaced to mouse + assistive-tech users via the
   * ``title`` and ``aria-label`` attributes set in
   * ``buildPrListHeader`` — sighted users lose nothing
   * meaningful; screen readers hear the disambiguated phrase the
   * F8 rename was meant to convey.
   */
  readonly headerLabel: string;
  readonly dataAttr: string;
}[] = [
  {
    key: "threads",
    label: "Threads",
    headerLabel: "Threads",
    dataAttr: "data-threads",
  },
  {
    key: "comments",
    label: "Comments",
    headerLabel: "Comments",
    dataAttr: "data-comments",
  },
  {
    key: "unresolved",
    label: "Unresolved threads",
    headerLabel: "Unresolved",
    dataAttr: "data-unresolved",
  },
];

function readMetricValue(li: HTMLLIElement, dataAttr: string): number | null {
  const raw = li.getAttribute(dataAttr);
  if (raw === null) return null;
  // Writers in ``renderPrListSection`` always stringify a numeric count
  // via ``String(value)`` where ``value`` is ``number``, so the attribute
  // text is always a well-formed decimal integer.  Callers only read
  // attributes they themselves wrote — no external mutation path exists
  // — so a ``Number.isFinite`` fallback here would be unreachable
  // defensive code (partial-branch debt).
  return Number.parseInt(raw, 10);
}

/**
 * Build the PR-list column header row.
 *
 * Always emits a grid row with two non-interactive ``role="columnheader"``
 * cells (``PR``, ``Cycle``) — used by every state of the drill-down list,
 * including capability-off, where it labels the cycle-time number that
 * was previously a context-less duration beside the PR link (issue #342
 * review finding; the SC-03 byte-identical pre-310 baseline preserved
 * the missing label as an accidental shape, not a positive invariant).
 *
 * When ``options.sortRowElements`` is non-null, the header gets the
 * ``--with-comments`` modifier class and three additional sort-triggering
 * columnheader cells carrying a ``<button data-sort-key>`` each
 * (``Threads``, ``Comments``, ``Unresolved threads``) — FR-3-02 / FR-4-02
 * / F1 / F4.  Clicking a sort button cycles ``aria-sort``
 * ``none → descending → ascending → none`` on the enclosing cell;
 * clicking a different axis resets the previously-active cell to
 * ``none`` (single active sort axis at a time).
 *
 * ``options.sortRowElements`` is the snapshot of ``<li>`` elements in
 * the aggregator-default sequence — captured by ``renderPrListSection``
 * before the rows are appended to ``list``.  The unsorted state (third
 * click on the active header) restores this sequence verbatim via
 * ``list.appendChild(item)`` on each element in order; ``appendChild``
 * moves rather than duplicates DOM nodes, so the restored DOM is
 * byte-stable across any sequence of interactions.  ``null`` here means
 * "skip sort cells" — capability-off, single-row capability-on (issue
 * #330 / C5), or all-partial capability-on (issue #331 / C2).
 *
 * Partial-sentinel rows (``data-<key>`` absent) sort to the END
 * regardless of direction — matches FR-3-05's "partials are not
 * comparable" rule in the sort context as well as the filter context.
 */
function buildPrListHeader(
  list: HTMLOListElement,
  options: {
    readonly commentsMetricsAvailable: boolean;
    readonly sortRowElements: readonly HTMLLIElement[] | null;
  },
): HTMLElement {
  // Issue #342: capability-off used to render a bare <a> + <span
  // class="cycle-time"> per row with NO header at all (the previous
  // SC-03 "byte-identical to pre-310" baseline).  That preserved an
  // unlabeled floating duration number beside every PR title.
  // Feature 310 added a labeled header on the capability-on path,
  // which made the capability-off gap obvious by contrast.
  //
  // Two-axis matrix, both flags resolved at the caller in
  // ``renderPrListSection`` and threaded through this function:
  //
  //   commentsMetricsAvailable  | sortRowElements | shape rendered
  //   --------------------------|-----------------|----------------
  //   false                     | null            | 2-cell PR | Cycle
  //   true                      | null            | 5-cell PR | Cycle |
  //                             |                 |   Threads | Comments |
  //                             |                 |   Unresolved (no
  //                             |                 |   buttons, no
  //                             |                 |   aria-sort)
  //   true                      | non-null        | 5-cell with sort
  //                             |                 |   buttons + aria-
  //                             |                 |   sort wired up
  //
  // Codex stop-time review on commit 406263f6 caught the missing
  // middle row: the prior implementation gated BOTH the comments-
  // metrics columnheader cells AND the ``--with-comments`` modifier
  // on ``sortRowElements`` non-null.  In the suppressed-sort capability-
  // on states (single-row — issue #330 / C5; all-partial — issue
  // #331 / C2) the rows still render three metric spans (5 grid
  // tracks via ``.detail-panel-pr-list--with-comments .detail-panel-
  // pr-row``), so a 2-cell header left the Threads / Comments /
  // Unresolved columns visible but unlabeled.  The capability gate
  // is now decoupled: ``commentsMetricsAvailable`` decides whether
  // the THREE columns + modifier emit; ``sortRowElements`` decides
  // whether those columns carry interactive sort buttons.
  const { commentsMetricsAvailable, sortRowElements } = options;
  const withSortButtons = sortRowElements !== null;
  const header = createElement("div", {
    class: commentsMetricsAvailable
      ? "detail-panel-pr-list-header detail-panel-pr-list-header--with-comments"
      : "detail-panel-pr-list-header",
    role: "row",
  });

  header.appendChild(
    createElement(
      "div",
      {
        class:
          "detail-panel-pr-list-header-cell detail-panel-pr-list-header-cell--pr",
        role: "columnheader",
      },
      "PR",
    ),
  );
  header.appendChild(
    createElement(
      "div",
      {
        class:
          "detail-panel-pr-list-header-cell detail-panel-pr-list-header-cell--cycle",
        role: "columnheader",
      },
      "Cycle",
    ),
  );

  if (!commentsMetricsAvailable) return header;

  // Comments-metrics columnheader cells.  When ``withSortButtons`` is
  // true, each cell carries an interactive ``<button data-sort-key>``
  // and ``aria-sort="none"``; otherwise the cell renders the plain
  // ``headerLabel`` text (with ``title`` for disambiguated axes) and
  // omits ``aria-sort`` entirely so screen readers don't announce a
  // sortable column that can't be sorted.  Either way, the cell is
  // present so the row's metric spans line up under labeled columns.

  // Collect per-axis cell + state into records (only used when sort
  // buttons are wired).  Iterating records in the click handler
  // (instead of going through Maps keyed by axis key) keeps every
  // cell/state access statically known to be defined — no ``Map.get()``
  // fallback arms are needed, which keeps the function free of
  // partial-branch debt.
  const records: SortHeaderRecord[] = [];

  // Issue #332 / B1: SR-live announcer for sort direction changes.
  // Created up front so the per-axis click closure (built only in the
  // ``withSortButtons`` branch below) captures it as a non-nullable
  // local — appended only when sort buttons are wired so suppressed-
  // controls states (capability-on single-row #330/C5; capability-on
  // all-partial #331/C2) don't carry an empty live region.
  const sortAnnouncer = createElement("div", {
    role: "status",
    "aria-live": "polite",
    class: "visually-hidden detail-panel-pr-list-sort-announcer",
  });

  for (const axis of COMMENTS_METRICS_AXES) {
    const cellAttrs: Record<string, string> = {
      class: `detail-panel-pr-list-header-cell detail-panel-pr-list-header-cell--${axis.key}`,
      role: "columnheader",
    };
    if (withSortButtons) {
      cellAttrs["aria-sort"] = "none";
    }
    const cell = createElement("div", cellAttrs);

    if (!withSortButtons) {
      // Plain text cell — preserve the F8 three-surface disambiguation
      // contract that the sort-button path applies (Codex stop-time
      // review caught the regression on the prior pass).  When
      // ``headerLabel`` differs from ``label`` (today: only the
      // unresolved column, "Unresolved" visible vs. "Unresolved
      // threads" disambiguated), the cell carries:
      //   - ``headerLabel`` as visible textContent (fits the narrow
      //     numeric track)
      //   - ``title`` = ``label`` (hover surfaces the long form for
      //     mouse users)
      //   - ``aria-label`` = ``label`` (overrides the columnheader's
      //     accessible name so SR users hear the unambiguous phrase
      //     instead of the truncated visible text — matches what the
      //     button path achieves via its own ``aria-label``)
      // When ``headerLabel === label`` (Threads, Comments) the visible
      // text already serves as accessible name; no extra attributes
      // are added.  No "Sort by " prefix on aria-label here since
      // this cell carries no sort action.
      if (axis.headerLabel !== axis.label) {
        cell.setAttribute("title", axis.label);
        cell.setAttribute("aria-label", axis.label);
      }
      appendText(cell, axis.headerLabel);
      header.appendChild(cell);
      continue;
    }

    // Interactive sort cell.  Visible textContent is the SHORT
    // ``headerLabel`` so the button fits inside the narrow numeric
    // column.  ``title`` exposes the full disambiguated label on
    // hover; ``aria-label`` overrides the visible text for screen
    // readers so they always announce the disambiguating phrase
    // regardless of which axis is rendered.  ``title`` is only set
    // when ``headerLabel`` actually differs from ``label`` so axes
    // with already-fitting labels (Threads, Comments) don't get a
    // noise tooltip identical to their visible text.
    const button = createElement("button", {
      type: "button",
      class: "detail-panel-pr-list-header-sort",
      "data-sort-key": axis.key,
      "aria-label": `Sort by ${axis.label.toLowerCase()}`,
    });
    if (axis.headerLabel !== axis.label) {
      button.setAttribute("title", axis.label);
    }
    appendText(button, axis.headerLabel);
    cell.appendChild(button);
    header.appendChild(cell);
    const record: SortHeaderRecord = { axis, cell, state: "none" };
    records.push(record);

    // ``sortRowElements`` is non-null inside this branch — narrow it
    // to a local ``readonly HTMLLIElement[]`` for use inside the
    // closure below.
    const originalOrder = sortRowElements;
    button.addEventListener("click", () => {
      const nextDirection = advanceSortDirection(record.state);
      // Clear every other record's aria-sort to "none" so only one axis
      // is sort-active at a time (single-active-sort invariant — matches
      // typical table-sort semantics).
      for (const peer of records) {
        if (peer === record) continue;
        peer.state = "none";
        peer.cell.setAttribute("aria-sort", "none");
      }
      record.state = nextDirection;
      record.cell.setAttribute("aria-sort", nextDirection);
      applySort(list, axis.dataAttr, nextDirection, originalOrder);

      // Issue #332 / B1: announce the new sort state to assistive
      // tech.  Two-step ``"" → message`` so the polite live region
      // sees a real mutation even on back-to-back identical
      // announcements (matches the loading-state.ts dashboard-banner
      // pattern).  ``axis.label`` is the full disambiguated phrase
      // ("Threads" / "Comments" / "Unresolved threads") so SR users
      // hear the same form the column-header ``aria-label`` already
      // uses.
      sortAnnouncer.textContent = "";
      sortAnnouncer.textContent =
        nextDirection === "none"
          ? "Sort cleared."
          : `Sorted by ${axis.label.toLowerCase()}, ${nextDirection}.`;
    });
  }

  // Issue #332 / B1: append the SR-live announcer only when sort
  // buttons are wired.  The capability-on suppressed-controls states
  // reach this function but never wire a click closure, so an empty
  // live region in those states would be DOM noise without an
  // announcement source.  Both arms of this gate are exercised by the
  // existing capability-on tests (multi-row → true; single-row /
  // all-partial → false).
  if (withSortButtons) {
    header.appendChild(sortAnnouncer);
  }

  return header;
}

/** One column-header's mutable sort state, kept inside a closure record. */
interface SortHeaderRecord {
  readonly axis: (typeof COMMENTS_METRICS_AXES)[number];
  readonly cell: HTMLElement;
  state: SortDirection;
}

/** Cycle ``none → descending → ascending → none``. */
function advanceSortDirection(current: SortDirection): SortDirection {
  if (current === "none") return "descending";
  if (current === "descending") return "ascending";
  return "none";
}

/**
 * Issue #332 / B2: condensed C1 inclusion-rule disclosure surfaced via
 * a single info tooltip on the controls bar.  Authoritative source is
 * ``specs/310-comments-visualization/spec.md`` "Shared inclusion-rule
 * contract (C1)" — this string distills those rules per axis without
 * re-declaring them.  One icon (not three per-axis) so the disclosure
 * adds zero pixels to the columnheader tracks (Linux DejaVu header-fit
 * contract from #341 / #330 stays intact).
 */
const COMMENTS_METRICS_C1_TOOLTIP =
  "Counts apply Feature 310's inclusion rules. Threads include " +
  "unknown-status threads but exclude deleted ones. Comments include " +
  "system events; deleted comments are excluded. Unresolved counts " +
  "only threads still in active status. Comments by users missing " +
  "from the user table are still counted.";

/**
 * Slice-level metadata the filter feedback summary (#332 / B3) needs
 * to derive its copy.  All three counts are pre-computed by
 * ``renderPrListSection`` from the ``rows`` array and the existing
 * ``partialRowCount`` it already tracks for the coverage notice; this
 * struct just wires them through to ``applyFilters`` without giving
 * the filter logic a dependency on the full row list.
 */
interface FilterSummaryContext {
  /** Total rows in the slice (numeric + partial). */
  readonly totalRows: number;
  /** Numeric rows in the slice (denominator for "X of Y"). */
  readonly numericTotal: number;
  /** Partial-sentinel rows in the slice — hidden whenever any
   *  threshold is active per FR-3-05. */
  readonly partialRowCount: number;
}

/**
 * Issue #332 / B3: the threshold filter's slice-level feedback
 * summary.  ``filterGroup`` and ``summary`` are returned together so
 * the caller can mount them as siblings between the header and the
 * ``<ol>`` (summary AFTER the filter row).  The summary is its own
 * polite live region — distinct from the sort announcer (#332 / B1)
 * because the two surface different events (sort direction vs filter
 * visibility); SR engines queue back-to-back polite announcements so
 * mutual exclusivity isn't required.
 */
interface FilterControls {
  readonly filterGroup: HTMLElement;
  readonly summary: HTMLElement;
}

/**
 * Format the filter-feedback summary copy (#332 / B3).
 *
 * Three branches, all signed off:
 *   - No threshold active → ``Showing all {totalRows} PRs.``
 *   - Threshold active, no partials in slice → ``Showing {visibleNumeric} of {numericTotal} PRs.``
 *   - Threshold active, partials in slice → adds
 *     ``{partialRowCount} partial row(s) hidden by filter.`` on the
 *     same line (singular when ``partialRowCount === 1``).
 */
function formatFilterSummary(
  context: FilterSummaryContext,
  hasActiveThreshold: boolean,
  visibleNumeric: number,
): string {
  if (!hasActiveThreshold) {
    return `Showing all ${context.totalRows} PRs.`;
  }
  if (context.partialRowCount === 0) {
    return `Showing ${visibleNumeric} of ${context.numericTotal} PRs.`;
  }
  const noun = context.partialRowCount === 1 ? "row" : "rows";
  return (
    `Showing ${visibleNumeric} of ${context.numericTotal} PRs. ` +
    `${context.partialRowCount} partial ${noun} hidden by filter.`
  );
}

/**
 * Build the comments-metrics threshold filter bar (FR-3-03 / FR-4-02).
 *
 * Three numeric inputs that compose with AND semantics via
 * ``applyFilters``; partial-sentinel rows are hidden whenever ANY axis
 * has an active threshold (FR-3-05).  Copy is driven by
 * ``COMMENTS_METRICS_AXES.label`` so the F8 rename ("Unresolved" →
 * "Unresolved threads") propagates consistently to the visible label
 * text and the input's ``aria-label``.
 *
 * Issue #332 / B2: a single info-icon adjacent to the "Min:" label
 * surfaces the C1 inclusion-rule contract via the shared
 * ``showInfoTooltip`` primitive (same pattern as ``summary-cards``).
 *
 * Issue #332 / B3: returns a ``summary`` element alongside the filter
 * group — a polite live region whose copy reflects how many PRs are
 * shown, how many are hidden by the threshold, and how many partial
 * rows were swept by FR-3-05's any-threshold-hides-partials rule.
 */
function buildCommentsMetricsFilter(
  list: HTMLOListElement,
  context: FilterSummaryContext,
): FilterControls {
  const filterGroup = createElement("div", {
    class: "detail-panel-pr-list-filter",
    role: "group",
    "aria-label": "Filter by minimum comments metric",
  });
  filterGroup.appendChild(
    createElement(
      "span",
      { class: "detail-panel-pr-list-controls-label" },
      "Min:",
    ),
  );
  // Issue #332 / B2: info icon for the C1 inclusion-rule disclosure.
  // Hover (pointerenter / pointerleave) drives the desktop path; click
  // shows + arms a one-shot document-level dismiss for touch / keyboard
  // activation, mirroring ``attachInfoIcons`` in summary-cards.ts:690.
  // Without the document-level listener a click-shown tooltip persists
  // on outside-click (Codex stop-time review on the initial #332 / B2
  // pass caught this).  ``event.stopPropagation()`` keeps the icon's
  // own click from triggering the same listener it just armed; the
  // ``requestAnimationFrame`` defer keeps the listener inert for the
  // exact click that opened the tooltip; ``dismissOnce`` removes
  // itself after firing so no listener leaks across opens.
  const infoIcon = createElement("button", {
    type: "button",
    class: "info-icon-btn",
    "data-info-tooltip": "comments-metrics-c1",
    "aria-label": "About these counts",
  });
  appendText(infoIcon, "ℹ");
  infoIcon.addEventListener("pointerenter", () => {
    showInfoTooltip(infoIcon, COMMENTS_METRICS_C1_TOOLTIP);
  });
  infoIcon.addEventListener("pointerleave", () => {
    dismissAllTooltips();
    clearOutsideClickListener();
  });
  infoIcon.addEventListener("click", (event) => {
    event.stopPropagation();
    if (document.querySelector(".info-tooltip") !== null) {
      dismissAllTooltips();
      clearOutsideClickListener();
      return;
    }
    showInfoTooltip(infoIcon, COMMENTS_METRICS_C1_TOOLTIP);
    // Win-last semantics: if a prior click already armed a frame or
    // listener that hasn't been cleaned up by an alternate path, drop
    // it before scheduling the new one so we never have two armed
    // dismiss paths racing each other.
    clearOutsideClickListener();
    outsideClickFrame = requestAnimationFrame(() => {
      outsideClickFrame = null;
      outsideClickAbort = new AbortController();
      document.addEventListener(
        "click",
        () => {
          dismissAllTooltips();
          clearOutsideClickListener();
        },
        { signal: outsideClickAbort.signal, once: true },
      );
    });
  });
  filterGroup.appendChild(infoIcon);
  // Issue #332 / B3: feedback summary mounted as a sibling of the
  // filter group; built here so it shares a closure with
  // ``filterDescriptors`` and the per-input ``applyFilters`` call.
  const summary = createElement("p", {
    class: "detail-panel-pr-list-filter-summary",
    role: "status",
    "aria-live": "polite",
  });
  appendText(summary, formatFilterSummary(context, false, 0));
  const filterDescriptors: FilterDescriptor[] = [];
  for (const axis of COMMENTS_METRICS_AXES) {
    const label = createElement("label", {
      class: "detail-panel-pr-list-filter-label",
    });
    appendText(label, `${axis.label} ≥ `);
    const input = createElement("input", {
      type: "number",
      min: "0",
      class: "detail-panel-pr-list-filter-input",
      "data-filter-key": axis.key,
      "aria-label": `Minimum ${axis.label.toLowerCase()}`,
    });
    const descriptor: FilterDescriptor = { input, dataAttr: axis.dataAttr };
    input.addEventListener("input", () =>
      applyFilters(list, filterDescriptors, summary, context),
    );
    label.appendChild(input);
    filterGroup.appendChild(label);
    filterDescriptors.push(descriptor);
  }
  return { filterGroup, summary };
}

/** One filter input + its data attribute, paired at build time. */
interface FilterDescriptor {
  readonly input: HTMLInputElement;
  readonly dataAttr: string;
}

/**
 * Apply a tri-state sort to ``list``:
 *
 *   - ``"none"``: restore the aggregator-default order captured in
 *     ``originalOrder`` at header-build time.  Re-appending each node
 *     via ``list.appendChild(item)`` moves (not duplicates) the node,
 *     yielding a byte-stable restoration across any interaction
 *     sequence.
 *   - ``"descending"``: highest numeric first; partials to end.
 *   - ``"ascending"``: lowest numeric first; partials still to end
 *     (partials are never comparable to numerics — FR-3-05).
 */
function applySort(
  list: HTMLOListElement,
  dataAttr: string,
  direction: SortDirection,
  originalOrder: readonly HTMLLIElement[],
): void {
  if (direction === "none") {
    for (const item of originalOrder) list.appendChild(item);
    return;
  }
  // ``querySelectorAll("li")`` narrows to HTMLLIElement by selector, so no
  // instanceof check is needed on each child — the list is built by this
  // module and only contains ``<li>`` children.
  const items = Array.from(list.querySelectorAll<HTMLLIElement>("li"));
  items.sort((a, b) => {
    const aValue = readMetricValue(a, dataAttr);
    const bValue = readMetricValue(b, dataAttr);
    // Partial-sentinel rows (value === null) sort AFTER numeric rows
    // regardless of direction.  Two nulls compare equal (stable per
    // Array.sort contract for equal comparator results); one-null
    // cases push the null to the end; two-numeric rows sort in the
    // requested direction.  Each case is its own return statement so
    // each branch is independently coverable.
    if (aValue === null) {
      if (bValue === null) return 0;
      return 1;
    }
    if (bValue === null) return -1;
    return direction === "descending" ? bValue - aValue : aValue - bValue;
  });
  for (const item of items) list.appendChild(item);
}

function applyFilters(
  list: HTMLOListElement,
  descriptors: readonly FilterDescriptor[],
  summary: HTMLElement,
  context: FilterSummaryContext,
): void {
  const thresholds: Array<readonly [string, number]> = [];
  for (const desc of descriptors) {
    const raw = desc.input.value.trim();
    if (raw === "") continue;
    const parsed = Number.parseInt(raw, 10);
    // ``input[type=number][min=0]`` prevents UI entry below zero, but
    // the test harness drives values programmatically; reject negatives
    // explicitly here so any test (or future caller) that sets a
    // negative threshold is ignored rather than inverted.  ``NaN`` is
    // impossible because ``raw === ""`` was rejected above and the
    // input is ``type="number"``.
    if (parsed < 0) continue;
    thresholds.push([desc.dataAttr, parsed]);
  }
  const hasActiveThreshold = thresholds.length > 0;
  let visibleNumeric = 0;
  for (const child of list.querySelectorAll<HTMLLIElement>("li")) {
    let hidden = false;
    for (const [dataAttr, threshold] of thresholds) {
      const value = readMetricValue(child, dataAttr);
      if (value === null) {
        // Partial-sentinel rows are excluded from numeric comparisons
        // whenever ANY axis has an active threshold (per FR-3-05).
        hidden = true;
        break;
      }
      if (value < threshold) {
        hidden = true;
        break;
      }
    }
    if (hidden) {
      child.setAttribute("hidden", "");
    } else {
      child.removeAttribute("hidden");
      // Issue #332 / B3: count visible NUMERIC rows (partial rows
      // are excluded under FR-3-05 the moment any threshold is active,
      // so they cannot reach this branch when ``hasActiveThreshold``;
      // when no threshold is active they ARE visible but we suppress
      // the "X of Y" copy in that path so visibleNumeric is unused).
      if (!child.hasAttribute("data-partial")) {
        visibleNumeric++;
      }
    }
  }
  // Issue #332 / B3: refresh the live summary.  Two-step "" → text so
  // the polite region announces every transition (matches the sort
  // announcer #332/B1 + loading-state.ts dashboard-banner pattern).
  const nextText = formatFilterSummary(
    context,
    hasActiveThreshold,
    visibleNumeric,
  );
  summary.textContent = "";
  summary.textContent = nextText;
}

/**
 * Feature 060: render the stable PR-detail container (FR-020).
 *
 * Invariants asserted by the section-identity tests and enforced here:
 *
 *   1. Always returns a `<section id="pr-detail">` with the stable class and
 *      ARIA identity — never a different tag, id, or role.
 *   2. Heading text (`Pull requests`) is constant across every content state.
 *   3. The section is never omitted. The sealed union prevents omission at
 *      build time; this function guarantees runtime parity.
 *   4. The `data-content-state` attribute mirrors `section.contentState` so
 *      tests can observe the rendered state without coupling to copy.
 *
 * Content below the heading varies by `contentState`:
 *
 *   - `pr-list`: truncation indicator (when `renderedCount < actualFilteredCount`)
 *     plus an `<ol>` of PR rows — each a clickable `<a>` to ADO (target=_blank,
 *     rel=noopener noreferrer) and a formatted cycle time.
 *   - `supported-empty`: empty-state message ("No PRs match the active filter
 *     in this week.").
 *   - `team-inline` / `reviewer-inline`: a single gated message (aria-live=polite)
 *     naming the filter the user must clear.
 */
function renderPrListSection(section: PrListSection): HTMLElement {
  const wrapper = createElement("section", {
    id: "pr-detail",
    class: "detail-panel-section detail-panel-section--pr-detail",
    role: "region",
    "aria-labelledby": "pr-detail-heading",
    "data-content-state": section.contentState,
  });
  wrapper.appendChild(
    createElement("h3", { id: "pr-detail-heading" }, "Pull requests"),
  );

  switch (section.contentState) {
    case "pr-list": {
      // Discriminated union: rows + counts + capValue are type-guaranteed
      // non-null when contentState === "pr-list" — no ?? fallbacks needed.
      const {
        rows,
        renderedCount,
        actualFilteredCount,
        capValue,
        commentsMetricsAvailable,
      } = section;

      // Issue #331 / C2 + C3: pre-compute the slice-level partial
      // state up front so the truncation-badge disclosure (below),
      // the coverage notice (further below), and the header/filter
      // emit gate all read from the same single source of truth.
      // ``isPartialPrRow`` (defined above) is the shared discriminator
      // used by every consumer — including ``buildCommentsStatRow``
      // in throughput-drilldown.ts — so all surfaces stay aligned on
      // both ``null`` (INV-10 coverage-partial sentinel) and
      // ``undefined`` (capability-off-passthrough leak) shapes
      // (issue #342 review finding).
      const partialRowCount = commentsMetricsAvailable
        ? rows.filter(isPartialPrRow).length
        : 0;
      const allRowsPartial =
        partialRowCount > 0 && partialRowCount === rows.length;

      if (renderedCount < actualFilteredCount) {
        const indicator = createElement("div", {
          class: "truncation-indicator truncation-badge",
        });
        // Issue #330 / C1: when capability-on, disclose that the
        // comments-metrics sort + filter operate within the cycle-
        // time-ordered slice — otherwise SC-01 ("identify the most-
        // discussed PR in two interactions") quietly breaks on
        // truncated weeks where the top discussion volume lives
        // outside the top-500-by-cycle-time window.  Capability-off
        // has no such sort/filter surface, so the pre-310 literal is
        // preserved byte-for-byte to keep SC-03 / INV-01 intact.
        //
        // Issue #331 / C2: drop the slice-scope sentence on all-
        // partial slices — the sort/filter controls are suppressed
        // there (see emit gate below), so the disclosure would
        // promise an interaction that never lands.
        const base = `Showing ${renderedCount} of ${actualFilteredCount} matching PRs (top ${capValue} by cycle time)`;
        appendText(
          indicator,
          commentsMetricsAvailable && !allRowsPartial
            ? `${base}. Sort and filter operate within this slice.`
            : base,
        );
        wrapper.appendChild(indicator);
      }

      // Capability-on path tags the <ol> with the
      // ``detail-panel-pr-list--with-comments`` modifier class so all
      // scoped grid + typography rules attach only to the capability-on
      // DOM.  Capability-off <ol> carries only ``detail-panel-pr-list`` —
      // byte-identical to the pre-310 fixture (SC-03 / INV-01; lock #1
      // "no shared class mutation").
      const list = createElement("ol", {
        class: commentsMetricsAvailable
          ? "detail-panel-pr-list detail-panel-pr-list--with-comments"
          : "detail-panel-pr-list",
      });
      // Feature 310: build row `<li>` elements into an array BEFORE
      // appending to ``list``.  The array doubles as the original-order
      // snapshot passed to ``buildPrListHeader`` (via
      // ``options.sortRowElements``) for unsorted-state restoration
      // (third click on the active column header).  Capturing here
      // (rather than sampling ``list.children`` later) locks the
      // snapshot to the aggregator-default sequence.
      const rowElements: HTMLLIElement[] = [];
      for (const row of rows) {
        const li = createElement("li", { class: "detail-panel-pr-row" });
        const link = createElement("a", {
          href: row.url,
          target: "_blank",
          rel: "noopener noreferrer",
          class: "detail-panel-pr-link",
        });
        appendText(link, `#${row.id} — ${row.title}`);
        li.appendChild(link);
        const cycle = createElement("span", { class: "cycle-time" });
        appendText(cycle, formatDuration(row.cycleTimeMinutes));
        li.appendChild(cycle);
        if (commentsMetricsAvailable) {
          // Feature 310: three additional `<span>` children per row,
          // emitted together (INV-08 consumer-side mirror).  Partial
          // sentinel (``null``) renders as ``—`` with BOTH
          // ``data-partial="true"`` (machine-distinguishable, lock #4)
          // AND ``aria-label="Coverage pending"`` (human- and SR-
          // distinguishable, lock #4) — distinguishable from a numeric 0
          // per FR-3-05 / INV-10.  The `<li>`'s own `data-*` attributes
          // carry machine-readable counts for sort + filter logic.
          const triplet: readonly (readonly [
            "threads" | "comments" | "unresolved",
            string,
            number | null | undefined,
          ])[] = [
            ["threads", "threads", row.threadCount],
            ["comments", "comments", row.commentCount],
            ["unresolved", "unresolved", row.activeThreadCount],
          ];
          // A partial row carries no comments-metrics data — either the
          // ``null`` coverage-partial sentinel (INV-10) or ``undefined``
          // capability-off-passthrough leak.  ``isPartialPrRow`` is the
          // shared discriminator (see definition above); per INV-08
          // triplet atomicity, ``threadCount`` alone is sufficient and
          // a non-partial row is guaranteed to have numeric spans on
          // every axis.  The row-level ``data-partial`` attribute lets
          // tests assert the row-scoped partial state in one check.
          const allPartial = isPartialPrRow(row);
          if (allPartial) {
            li.setAttribute("data-partial", "true");
          }
          for (const [key, cls, value] of triplet) {
            const span = createElement("span", {
              class: `comments-metric comments-metric--${cls}`,
            });
            if (value === null || value === undefined) {
              span.setAttribute("data-partial", "true");
              // Issue #331 / A2: span is removed from the a11y tree
              // — the visually-hidden sibling appended below
              // (when ``allPartial``) carries the SR announcement
              // exactly once per row.  The visual ``—`` glyph +
              // ``data-partial="true"`` keep the muted / italic CSS
              // hooks intact for sighted users.
              span.setAttribute("aria-hidden", "true");
              appendText(span, "—");
            } else {
              span.setAttribute("data-partial", "false");
              li.setAttribute(`data-${key}`, String(value));
              appendText(span, String(value));
            }
            li.appendChild(span);
          }
          if (allPartial) {
            // Issue #331 / A2 (Codex 2026-04-25 review remediation):
            // emit the "Coverage pending" announcement via a
            // visually-hidden child rather than ``aria-label`` on
            // the <li>.  An aria-label on the listitem would
            // OVERRIDE the accessible name computed from the row's
            // contents — collapsing "PR #42 — fix: title, 1d 4h"
            // navigation announcements down to just "Coverage
            // pending" and dropping PR identity entirely.  The
            // visually-hidden span is announced inline by SR
            // during sequential row reading, additive to the link
            // + cycle context rather than replacing them.  The
            // ``.visually-hidden`` class (existing project
            // primitive) absolute-positions the span so it does
            // not consume a grid track in the row's 5-column grid
            // layout.
            const srNote = createElement("span", {
              class: "visually-hidden",
            });
            appendText(srNote, "Coverage pending");
            li.appendChild(srNote);
          }
        }
        rowElements.push(li);
      }
      // Issue #331 / C2 + C3: in-panel coverage notice.  When the
      // dashboard banner says "Comments coverage: partial" the user
      // loses that signal once a drill-down panel opens; this notice
      // restores it and adds slice-level resolution ("N of M PRs"
      // for mixed; "none of these PRs" for all-partial).  Emitted
      // before the header so it sits as the first piece of slice-
      // level chrome above the controls / list, and gated strictly
      // on capability-on — no DOM emission when capability-off (lock
      // #9 / SC-03 / INV-01).  ``role="status"`` + ``aria-live="polite"``
      // matches the dashboard banner pattern so SR users hear the
      // signal without being interrupted mid-task.
      if (commentsMetricsAvailable && partialRowCount > 0) {
        const notice = createElement("p", {
          class: allRowsPartial
            ? "detail-panel-pr-list-coverage-notice detail-panel-pr-list-coverage-notice--all-partial"
            : "detail-panel-pr-list-coverage-notice",
          role: "status",
          "aria-live": "polite",
        });
        appendText(
          notice,
          allRowsPartial
            ? "Comments coverage: pending — none of these PRs have comment data yet."
            : `Comments coverage: partial — ${partialRowCount} of ${rows.length} PRs are missing comment data.`,
        );
        wrapper.appendChild(notice);
      }

      // Issue #342: the PR-list header always emits when the slice
      // has at least one row.  Two independent flags govern the
      // header's shape (see the matrix in ``buildPrListHeader``):
      //
      //   - ``commentsMetricsAvailable`` decides whether the THREE
      //     comments-metric columnheader cells (Threads / Comments /
      //     Unresolved) and the ``--with-comments`` modifier emit on
      //     the header.  Capability-off → 2-cell PR | Cycle.
      //     Capability-on → 5-cell, modifier present, regardless of
      //     sort suppression below.  This keeps the header columns
      //     in lockstep with the row's grid tracks: the row's three
      //     metric spans always render when capability-on (the
      //     ``commentsMetricsAvailable`` block in the row loop above),
      //     so the header MUST have matching columnheader cells or
      //     visible metric values would render unlabeled (Codex stop-
      //     time review on commit 406263f6 caught this regression).
      //   - ``sortRowElements`` decides whether those three cells
      //     carry interactive sort buttons + ``aria-sort``.  The
      //     suppression conditions are unchanged from prior commits:
      //
      //       * ``commentsMetricsAvailable``: capability-on only (lock
      //         #9 / SC-03 / INV-01).
      //       * ``rowElements.length > 1`` (issue #330 / C5): sort
      //         is a no-op on a single-row list; the cell renders
      //         the plain label.
      //       * ``!allRowsPartial`` (issue #331 / C2): on a slice
      //         where every row's three numeric fields are coverage-
      //         pending, sort has nothing comparable to act on; the
      //         coverage notice above explains the state.
      //
      // The threshold filter shares the sort-button gate (it has the
      // same suppression rationale as the sort buttons).
      const sortRowElements: readonly HTMLLIElement[] | null =
        commentsMetricsAvailable && rowElements.length > 1 && !allRowsPartial
          ? rowElements
          : null;
      // Header always emits in the ``pr-list`` content state — the
      // producer (``installThroughputDrilldown``'s "supported" branch)
      // short-circuits to ``contentState: "supported-empty"`` whenever
      // ``rawPrs.length === 0`` (throughput-drilldown.ts:142), so by
      // the time we reach this branch ``rowElements.length`` is
      // structurally > 0.  No defensive ``length > 0`` guard — the
      // false arm would be dead code and trip the partial-branch
      // ratchet (PR #342 caught this on push).
      wrapper.appendChild(
        buildPrListHeader(list, {
          commentsMetricsAvailable,
          sortRowElements,
        }),
      );
      if (sortRowElements !== null) {
        // Issue #332 / B3: filter group + feedback summary mount as
        // siblings of the wrapper, summary AFTER the filter row so
        // the natural reading / SR-walk order is filter → summary →
        // list.  Slice metadata derived from the same
        // ``partialRowCount`` already used by the coverage notice
        // (#331 / C2 + C3) above.
        const filterControls = buildCommentsMetricsFilter(list, {
          totalRows: rows.length,
          numericTotal: rows.length - partialRowCount,
          partialRowCount,
        });
        wrapper.appendChild(filterControls.filterGroup);
        wrapper.appendChild(filterControls.summary);
      }
      for (const li of rowElements) {
        list.appendChild(li);
      }
      wrapper.appendChild(list);
      break;
    }
    case "supported-empty": {
      wrapper.appendChild(
        createElement(
          "p",
          { class: "detail-panel-empty-detail" },
          "No PRs match the active filter in this week.",
        ),
      );
      break;
    }
    case "team-inline": {
      wrapper.appendChild(
        createElement(
          "p",
          {
            class: "pr-detail-gated",
            "aria-live": "polite",
          },
          "Clear the team filter to view PR-level detail.",
        ),
      );
      break;
    }
    case "reviewer-inline": {
      wrapper.appendChild(
        createElement(
          "p",
          {
            class: "pr-detail-gated",
            "aria-live": "polite",
          },
          "Clear the reviewer filter to view PR-level detail.",
        ),
      );
      break;
    }
  }
  return wrapper;
}

// ---------------------------------------------------------------------------
// Top-offset geometry (issue #303)
//
// On desktop layouts the panel is positioned below the filter-bar so it does
// not geometrically cover the right-side filter controls. On narrow viewports
// the panel remains a full-height overlay. The measured offset is written to
// a CSS custom property on the panel root and refreshed while open whenever
// the filter-bar's box changes.
// ---------------------------------------------------------------------------

const TOP_OFFSET_MOBILE_MEDIA_QUERY = "(max-width: 768px)";
const TOP_OFFSET_FILTER_BAR_SELECTOR = ".filter-bar";
const TOP_OFFSET_GAP_PX = 12;
const TOP_OFFSET_CSS_VAR = "--detail-panel-top";

function applyTopOffset(rootEl: HTMLElement, signal: AbortSignal): void {
  // Always clear any stale value first so mode transitions (desktop open →
  // rotate to mobile → reopen) cannot carry the previous offset.
  rootEl.style.removeProperty(TOP_OFFSET_CSS_VAR);

  if (window.matchMedia?.(TOP_OFFSET_MOBILE_MEDIA_QUERY).matches === true) {
    return;
  }

  const filterBar = document.querySelector<HTMLElement>(
    TOP_OFFSET_FILTER_BAR_SELECTOR,
  );
  if (filterBar === null) return;

  const writeOffset = (): void => {
    const bottom = filterBar.getBoundingClientRect().bottom;
    if (bottom <= 0) {
      rootEl.style.removeProperty(TOP_OFFSET_CSS_VAR);
      return;
    }
    rootEl.style.setProperty(
      TOP_OFFSET_CSS_VAR,
      `${Math.round(bottom + TOP_OFFSET_GAP_PX)}px`,
    );
  };

  writeOffset();

  const observer = new ResizeObserver(() => {
    writeOffset();
  });
  observer.observe(filterBar);
  signal.addEventListener("abort", () => observer.disconnect(), { once: true });
}

// ---------------------------------------------------------------------------
// Subscriptions for open-scoped dismissal
// ---------------------------------------------------------------------------

function installOpenScopedListeners(els: ActivePanel): AbortController {
  const controller = new AbortController();
  const { signal } = controller;

  // Escape key — capture on document so we catch it regardless of focus.
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && panelState === "open") {
        event.preventDefault();
        dismissDetailPanel("escape-key");
      }
    },
    { signal },
  );

  // Outside click
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (panelState !== "open") return;
      const target = event.target;
      if (target instanceof Node && !els.root.contains(target)) {
        dismissDetailPanel("outside-click");
      }
    },
    { signal },
  );

  // Filters changed — HARD dismiss. Do NOT do any content work here.
  window.addEventListener(
    FILTERS_CHANGED_EVENT,
    () => {
      if (panelState === "open" || panelState === "opening") {
        dismissDetailPanel("filters-changed");
      }
    },
    { signal },
  );

  // Tab changed — dismiss only when leaving the Metrics tab.
  window.addEventListener(
    TAB_CHANGED_EVENT,
    (evt) => {
      const e = evt as TabChangedEvent;
      if (e.detail.activeTabId !== "metrics" && panelState === "open") {
        dismissDetailPanel("tab-changed");
      }
    },
    { signal },
  );

  // Comparison toggled — dismiss only when entering comparison.
  window.addEventListener(
    COMPARISON_TOGGLED_EVENT,
    (evt) => {
      const e = evt as ComparisonToggledEvent;
      if (e.detail.enabled && panelState === "open") {
        dismissDetailPanel("comparison-toggled");
      }
    },
    { signal },
  );

  return controller;
}

// ---------------------------------------------------------------------------
// Public lifecycle API
// ---------------------------------------------------------------------------

export function isDetailPanelOpen(): boolean {
  return panelState === "opening" || panelState === "open";
}

export function openDetailPanel(context: DrillDownContext): void {
  // Re-validate content at the boundary (construction helpers do this, but a
  // caller might have hand-rolled a PanelContent).
  if (context.content.title.length === 0) {
    throw new TypeError("PanelContent.title MUST be non-empty");
  }
  if (context.content.sections.length === 0) {
    throw new TypeError(
      "PanelContent.sections MUST contain at least one section",
    );
  }

  if (comparisonActive) {
    console.warn(
      "[detail-panel] openDetailPanel called while comparison mode is active; no-op. " +
        "Callers should route to comparison-advisory.showComparisonAdvisoryToast in that case.",
    );
    return;
  }

  // Refuse to re-enter while mid-close animation — dismiss first.
  if (panelState === "closing") {
    finalizeClose();
  }

  const els = ensurePanelEls();

  const wasOpen = isDetailPanelOpen();
  activeContext = context;

  if (!wasOpen) {
    // Install the open-scoped controller BEFORE render + is-open so
    // applyTopOffset's ResizeObserver teardown can piggyback on the
    // controller's signal, and so the drill-down MutationObservers that
    // react to `is-open` see the correct geometry on their first fire
    // (issue #303 / FE-arch F7).
    openScopedController = installOpenScopedListeners(els);
    applyTopOffset(els.root, openScopedController.signal);
  }

  renderContent(els, context.content);

  if (!wasOpen) {
    els.root.classList.add("is-open");
    panelState = "opening";
    // Treat opening as complete synchronously for test determinism;
    // CSS transition runs in parallel but does not gate state.
    panelState = "open";

    focusTrapController = trapFocus(els.root);
  }
}

export function dismissDetailPanel(reason: DismissReason): void {
  if (!isDetailPanelOpen()) return;

  panelState = "closing";

  // Tear down subscriptions BEFORE any other work. This is what makes the
  // filters-changed dismiss "hard": by aborting listeners first we cannot
  // accidentally re-enter the render path via a later signal. Tests spy on
  // renderContent / sectionsRoot children to verify the FR-005 invariant.
  openScopedController?.abort();
  openScopedController = null;

  // Issue #332 / B2: any open info tooltip needs to dismiss when the
  // panel closes — ``showInfoTooltip`` mounts the tooltip on
  // ``document.body`` (so it can position-fixed against the viewport),
  // not as a panel descendant, so the tooltip would otherwise persist
  // as an orphan after the panel detaches.  Codex stop-time review
  // caught this on the initial #332 / B2 pass.  Also covers any chart
  // tooltip that happens to be open against another surface; both are
  // managed by the same ``dismissAllTooltips`` primitive (mutual
  // exclusivity contract in ``tooltip-manager.ts``).
  //
  // Codex PR #343 P2 follow-up: the deferred outside-click listener
  // armed by the C1 info-icon click handler must be cancelled here
  // too — the dismissAllTooltips above only removes tooltip DOM, not
  // the document-level dismiss listener.  Without this, a panel
  // closed before the user clicks anywhere leaves a stale listener
  // that fires on the next dashboard click and clobbers any chart
  // tooltip the user just opened.
  dismissAllTooltips();
  clearOutsideClickListener();

  // Focus restoration — target is the context.triggerElement captured on open
  // (FR-008). Fall back to focus-trap's recorded return if somehow unavailable.
  const trigger = activeContext?.triggerElement ?? null;
  if (focusTrapController) {
    if (trigger && trigger.isConnected) {
      restoreFocus(focusTrapController);
      trigger.focus();
    } else {
      restoreFocus(focusTrapController);
    }
    focusTrapController = null;
  }

  finalizeClose();
  // Reason is consumed by subscribers who already observed the triggering
  // event; it is surfaced here primarily for future telemetry / debugging
  // hooks. Reference the parameter to satisfy noUnusedParameters.
  void reason;
}

function finalizeClose(): void {
  if (panelEls) {
    panelEls.root.classList.remove("is-open");
  }
  activeContext = null;
  panelState = "closed";
}
