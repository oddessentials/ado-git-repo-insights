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
// Feature 310 — comments-metrics sort + filter controls.
// ---------------------------------------------------------------------------

/** One of the three comments-metrics sort + filter axes. */
type CommentsMetricsKey = "threads" | "comments" | "unresolved";

const COMMENTS_METRICS_AXES: readonly {
  readonly key: CommentsMetricsKey;
  readonly label: string;
  readonly dataAttr: string;
}[] = [
  { key: "threads", label: "Threads", dataAttr: "data-threads" },
  { key: "comments", label: "Comments", dataAttr: "data-comments" },
  { key: "unresolved", label: "Unresolved", dataAttr: "data-unresolved" },
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
 * Build the sort + threshold-filter control block for the comments-metrics
 * columns (FR-3-02 / FR-3-03 / FR-4-02).  Operates directly on the `<li>`
 * children of ``list``:
 *
 *   - Sort buttons re-order the rows DESCENDING by the selected axis;
 *     partial-sentinel rows (``data-<key>`` absent) sort to the END so
 *     the sort view's top entries are always meaningful numerics, never
 *     ``—`` placeholders.  Click handlers set ``aria-pressed`` on the
 *     active button (others toggle off).
 *   - Threshold inputs set `hidden` on rows whose numeric count falls
 *     below the entered minimum.  Partial-sentinel rows (no
 *     ``data-<key>``) are hidden when a threshold is set on that axis,
 *     per FR-3-05's rule that partial rows are excluded from numeric
 *     comparisons.  Filters compose with AND semantics across axes.
 */
function buildCommentsMetricsControls(list: HTMLOListElement): HTMLElement {
  const controls = createElement("div", {
    class: "detail-panel-pr-list-controls",
    role: "group",
    "aria-label": "Comments metrics controls",
  });

  const sortGroup = createElement("div", {
    class: "detail-panel-pr-list-sort",
    role: "group",
    "aria-label": "Sort by comments metric",
  });
  sortGroup.appendChild(
    createElement(
      "span",
      { class: "detail-panel-pr-list-controls-label" },
      "Sort:",
    ),
  );
  const sortButtons: HTMLButtonElement[] = [];
  for (const axis of COMMENTS_METRICS_AXES) {
    const button = createElement("button", {
      type: "button",
      class: "detail-panel-pr-list-sort-button",
      "aria-pressed": "false",
      "data-sort-key": axis.key,
    });
    appendText(button, axis.label);
    button.addEventListener("click", () => {
      for (const other of sortButtons) {
        other.setAttribute("aria-pressed", other === button ? "true" : "false");
      }
      applySort(list, axis.dataAttr);
    });
    sortGroup.appendChild(button);
    sortButtons.push(button);
  }
  controls.appendChild(sortGroup);

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
      applyFilters(list, filterDescriptors),
    );
    label.appendChild(input);
    filterGroup.appendChild(label);
    filterDescriptors.push(descriptor);
  }
  controls.appendChild(filterGroup);

  return controls;
}

/** One filter input + its data attribute, paired at build time. */
interface FilterDescriptor {
  readonly input: HTMLInputElement;
  readonly dataAttr: string;
}

function applySort(list: HTMLOListElement, dataAttr: string): void {
  // ``querySelectorAll("li")`` narrows to HTMLLIElement by selector, so no
  // instanceof check is needed on each child — the list is built by this
  // module and only contains ``<li>`` children.
  const items = Array.from(list.querySelectorAll<HTMLLIElement>("li"));
  items.sort((a, b) => {
    const aValue = readMetricValue(a, dataAttr);
    const bValue = readMetricValue(b, dataAttr);
    // Partial-sentinel rows (value === null) sort AFTER numeric rows so
    // the top of a descending sort always carries meaningful counts.
    // Two nulls compare equal (stable per Array.sort contract for equal
    // comparator results); one-null cases push the null to the end;
    // two-numeric descend.  Each case is its own return statement so
    // each branch is independently coverable.
    if (aValue === null) {
      if (bValue === null) return 0;
      return 1;
    }
    if (bValue === null) return -1;
    return bValue - aValue;
  });
  for (const item of items) list.appendChild(item);
}

function applyFilters(
  list: HTMLOListElement,
  descriptors: readonly FilterDescriptor[],
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
    }
  }
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

      if (renderedCount < actualFilteredCount) {
        const indicator = createElement("div", {
          class: "truncation-indicator truncation-badge",
        });
        appendText(
          indicator,
          `Showing ${renderedCount} of ${actualFilteredCount} matching PRs (top ${capValue} by cycle time)`,
        );
        wrapper.appendChild(indicator);
      }

      const list = createElement("ol", { class: "detail-panel-pr-list" });
      // Feature 310: interactive sort + threshold filter controls over the
      // three comments-metrics columns.  Controls live above the list and
      // operate directly on `<li>` DOM (re-order for sort, toggle `hidden`
      // for filter).  They are appended BEFORE the list so the rendered
      // order is controls → list, and they are appended only when
      // capability is on so SC-03 byte-identity on the capability-off
      // path is preserved.
      if (commentsMetricsAvailable) {
        wrapper.appendChild(buildCommentsMetricsControls(list));
      }
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
          // sentinel (``null``) renders as ``—`` with
          // ``data-partial="true"``, distinguishable from a numeric 0 per
          // FR-3-05 / INV-10.  The `<li>`'s own `data-*` attributes carry
          // machine-readable counts for sort + filter logic in
          // ``buildCommentsMetricsControls``; `data-partial="true"` at
          // the row level marks all three metrics partial together.
          const triplet: readonly (readonly [
            "threads" | "comments" | "unresolved",
            string,
            number | null | undefined,
          ])[] = [
            ["threads", "threads", row.threadCount],
            ["comments", "comments", row.commentCount],
            ["unresolved", "unresolved", row.activeThreadCount],
          ];
          // A row is partial when EVERY field is absent (undefined —
          // capability-off-passthrough row that leaked through) or
          // coverage-partial (``null`` — covered PR with
          // ``comments_extracted_at IS NULL``).  Both shapes render as
          // ``—`` per-span; the row-level ``data-partial`` attribute lets
          // tests assert the row-scoped partial state in one check.
          // The producer guarantees all-three or none-three (INV-08), so
          // a non-``allPartial`` row will always have numeric spans.
          const allPartial = triplet.every(
            ([, , value]) => value === null || value === undefined,
          );
          if (allPartial) li.setAttribute("data-partial", "true");
          for (const [key, cls, value] of triplet) {
            const span = createElement("span", {
              class: `comments-metric comments-metric--${cls}`,
            });
            if (value === null || value === undefined) {
              span.setAttribute("data-partial", "true");
              appendText(span, "—");
            } else {
              span.setAttribute("data-partial", "false");
              li.setAttribute(`data-${key}`, String(value));
              appendText(span, String(value));
            }
            li.appendChild(span);
          }
        }
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
