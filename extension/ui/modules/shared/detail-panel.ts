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
 */
export interface PrListRow {
  readonly id: number;
  readonly title: string;
  readonly cycleTimeMinutes: number;
  readonly url: string;
}

/**
 * Feature 060: stable PR-detail container on the throughput drill-down panel.
 *
 * The single section MUST render across four content states without being
 * omitted or replaced by sibling sections (FR-020). The rendered `<section>`
 * shell (tag, id, class, ARIA identity) is byte-identical across states; only
 * the inner content below the stable heading varies.
 *
 * Payload fields are present only when `contentState === "pr-list"`:
 *
 *   - `rows` — the PR rows to render (each carries a pre-derived ADO URL);
 *   - `renderedCount` — number of PR rows actually rendered;
 *   - `actualFilteredCount` — the chart's filtered PR count for this week
 *     (used to drive the truncation indicator via FR-008);
 *   - `capValue` — aggregator-side truncation cap, mirrors `_prs_cap`.
 *
 * The non-pr-list content states (supported-empty, team-inline,
 * reviewer-inline) carry only the discriminant.
 */
export interface PrListSection {
  readonly type: "pr-list";
  readonly contentState:
    | "pr-list"
    | "supported-empty"
    | "team-inline"
    | "reviewer-inline";
  readonly rows?: readonly PrListRow[];
  readonly renderedCount?: number;
  readonly actualFilteredCount?: number;
  readonly capValue?: number;
}

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
 * Construct a PrListSection (feature 060). Enforces at build time that the
 * payload shape matches the content state: the `pr-list` state requires
 * rows + counts + cap; every other state forbids them.
 */
export function makePrListSection(input: {
  readonly contentState:
    | "pr-list"
    | "supported-empty"
    | "team-inline"
    | "reviewer-inline";
  readonly rows?: readonly PrListRow[];
  readonly renderedCount?: number;
  readonly actualFilteredCount?: number;
  readonly capValue?: number;
}): PrListSection {
  if (input.contentState === "pr-list") {
    if (
      input.rows === undefined ||
      input.renderedCount === undefined ||
      input.actualFilteredCount === undefined ||
      input.capValue === undefined
    ) {
      throw new TypeError(
        "PrListSection with contentState='pr-list' MUST include rows, renderedCount, actualFilteredCount, and capValue",
      );
    }
  } else if (
    input.rows !== undefined ||
    input.renderedCount !== undefined ||
    input.actualFilteredCount !== undefined ||
    input.capValue !== undefined
  ) {
    throw new TypeError(
      `PrListSection with contentState='${input.contentState}' MUST NOT include rows, renderedCount, actualFilteredCount, or capValue`,
    );
  }
  return {
    type: "pr-list",
    contentState: input.contentState,
    ...(input.rows !== undefined ? { rows: input.rows } : {}),
    ...(input.renderedCount !== undefined
      ? { renderedCount: input.renderedCount }
      : {}),
    ...(input.actualFilteredCount !== undefined
      ? { actualFilteredCount: input.actualFilteredCount }
      : {}),
    ...(input.capValue !== undefined ? { capValue: input.capValue } : {}),
  };
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
      // Invariants on pr-list payload are enforced by makePrListSection —
      // these fields are always present here. Fallbacks are defensive.
      const rows = section.rows ?? [];
      const renderedCount = section.renderedCount ?? rows.length;
      const actualFilteredCount = section.actualFilteredCount ?? renderedCount;
      const capValue = section.capValue ?? 500;

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
