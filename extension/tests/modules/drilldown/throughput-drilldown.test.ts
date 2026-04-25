/**
 * Throughput drill-down unit tests (US1).
 *
 * Covers `extension/ui/modules/drilldown/throughput-drilldown.ts` per
 * `specs/059-chart-drill-down/contracts/drilldown-integration.md`:
 * delegated click activation, keyboard activation (Enter/Space),
 * panel content shape, `is-drilldown-active` lifecycle (MutationObserver
 * tied to panel root + install-scope AbortController), comparison-mode
 * advisory routing, dispose semantics, rerender sequence, and
 * coexistence with the existing chart-tooltip handler.
 */

import { renderThroughputChart } from "../../../ui/modules/charts/throughput";
import { installThroughputDrilldown } from "../../../ui/modules/drilldown/throughput-drilldown";
import {
  publishComparisonToggled,
  publishFiltersChanged,
} from "../../../ui/modules/drilldown/lifecycle-signals";
import { __resetComparisonAdvisoryForTests } from "../../../ui/modules/drilldown/comparison-advisory";
import {
  dismissDetailPanel,
  isDetailPanelOpen,
} from "../../../ui/modules/shared/detail-panel";
import type { Rollup } from "../../../ui/dataset-loader";

// jsdom lacks PointerEvent — mirror the polyfill used by other tests
// (e.g. detail-panel.test.ts, tooltip.test.ts). Only needed for the
// tooltip-coexistence tests that simulate the tap pointer sequence.
if (typeof PointerEvent === "undefined") {
  (globalThis as Record<string, unknown>).PointerEvent =
    class PointerEvent extends MouseEvent {
      constructor(type: string, init?: PointerEventInit) {
        super(type, init);
      }
    };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRollup(overrides: Partial<Rollup> = {}): Rollup {
  return {
    week: "2025-W12",
    pr_count: 47,
    cycle_time_p50: null,
    cycle_time_p90: null,
    authors_count: 3,
    reviewers_count: 2,
    by_repository: {
      "backend-api": { pr_count: 20 },
      frontend: { pr_count: 27 },
    },
    by_author: {
      alice: { pr_count: 12 },
      bob: { pr_count: 35 },
    },
    by_team: null,
    ...overrides,
  };
}

function mountChart(rollups: Rollup[]): HTMLElement {
  const container = document.createElement("div");
  container.id = "throughput-chart";
  document.body.appendChild(container);
  renderThroughputChart(container, rollups);
  return container;
}

function firstBar(container: HTMLElement): HTMLElement {
  const bar = container.querySelector<HTMLElement>(".bar-container");
  if (!bar) throw new Error("bar-container not rendered");
  return bar;
}

function click(target: HTMLElement): void {
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("throughput-drilldown", () => {
  beforeEach(() => {
    publishComparisonToggled({ enabled: false });
    __resetComparisonAdvisoryForTests();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    if (isDetailPanelOpen()) dismissDetailPanel("explicit-close-button");
    publishComparisonToggled({ enabled: false });
    __resetComparisonAdvisoryForTests();
    document.body.innerHTML = "";
  });

  // -------------------------------------------------------------------------
  // Activation paths
  // -------------------------------------------------------------------------

  it("pointer tap opens the panel with week-range title and PR-count subtitle", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    expect(isDetailPanelOpen()).toBe(true);
    const panel = document.querySelector<HTMLElement>("aside.detail-panel");
    expect(panel).not.toBeNull();
    // ISO 2025-W12 runs Mon Mar 17 – Sun Mar 23. The title must show
    // those calendar dates regardless of the user's local timezone;
    // a UTC-constructed date plus a local-tz formatter would shift
    // the display one day earlier for timezones west of UTC.
    const title = panel!.querySelector("#detail-panel-title")!.textContent;
    expect(title).toBe("Week of Mar 17 – 23, 2025");
    expect(
      panel!.querySelector(".detail-panel-subtitle")!.textContent,
    ).toContain("47 PRs");
  });

  it("panel renders By-author breakdown rows with friendly names from authorsDimension (sorted desc)", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups, {
      authorsDimension: [
        { author_id: "alice", author_name: "Alice Smith" },
        { author_id: "bob", author_name: "Bob Jones" },
      ],
    });

    click(firstBar(container));

    const authorSection = document.querySelectorAll(
      ".detail-panel-section--breakdown-table",
    )[0]!;
    expect(authorSection.querySelector("h3")!.textContent).toBe("By author");
    const rowLabels = Array.from(
      authorSection.querySelectorAll("tbody th[scope='row']"),
    ).map((th) => th.textContent);
    // #308: raw `user_id` keys ("alice", "bob") are resolved to friendly
    // names; no GUID-shaped text surfaces to the user.
    expect(rowLabels).toEqual(["Bob Jones", "Alice Smith"]);
    const rowValues = Array.from(
      authorSection.querySelectorAll("tbody tr td"),
    ).map((td) => td.textContent);
    expect(rowValues).toEqual(["35", "12"]);
  });

  it("By-author non-UUID keys render verbatim when authorsDimension is missing", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    // Dimension not yet loaded (early-render race). Panel must not
    // crash; non-UUID keys ("alice", "bob") surface verbatim.
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    const authorSection = document.querySelectorAll(
      ".detail-panel-section--breakdown-table",
    )[0]!;
    const rowLabels = Array.from(
      authorSection.querySelectorAll("tbody th[scope='row']"),
    ).map((th) => th.textContent);
    expect(rowLabels).toEqual(["bob", "alice"]);
    const rowValues = Array.from(
      authorSection.querySelectorAll("tbody tr td"),
    ).map((td) => td.textContent);
    expect(rowValues).toEqual(["35", "12"]);
  });

  it("By-author UUID keys render verbatim when authorsDimension is missing (rare-exception path)", () => {
    // Reshape: GUIDs surface as a cosmetic leak in partial-dimension
    // cases rather than collapsing every row into an indistinguishable
    // "Unknown user" list. Panel renders, rows stay distinguishable.
    const uuidA = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    const uuidB = "12345678-1234-1234-1234-123456789abc";
    const rollups = [
      makeRollup({
        by_author: {
          [uuidA]: { pr_count: 35 },
          [uuidB]: { pr_count: 12 },
        },
      }),
    ];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    const authorSection = document.querySelectorAll(
      ".detail-panel-section--breakdown-table",
    )[0]!;
    const rowLabels = Array.from(
      authorSection.querySelectorAll("tbody th[scope='row']"),
    ).map((th) => th.textContent);
    expect(rowLabels).toEqual([uuidA, uuidB]);
    // Rows remain distinguishable despite the leak.
    expect(new Set(rowLabels).size).toBe(rowLabels.length);
  });

  it("By-author mixed keys: resolved keys get friendly names, unresolved keys render verbatim", () => {
    const uuid = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    const rollups = [
      makeRollup({
        by_author: {
          alice: { pr_count: 35 },
          [uuid]: { pr_count: 20 },
          "legacy-user-42": { pr_count: 8 },
        },
      }),
    ];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups, {
      authorsDimension: [{ author_id: "alice", author_name: "Alice Smith" }],
    });

    click(firstBar(container));

    const authorSection = document.querySelectorAll(
      ".detail-panel-section--breakdown-table",
    )[0]!;
    const rowLabels = Array.from(
      authorSection.querySelectorAll("tbody th[scope='row']"),
    ).map((th) => th.textContent);
    // Sorted by pr_count desc: alice (35) → resolved name;
    // UUID (20) → raw id (unresolved); legacy-user-42 (8) → raw id.
    expect(rowLabels).toEqual(["Alice Smith", uuid, "legacy-user-42"]);
  });

  it("panel renders By-repository breakdown rows from rollup.by_repository", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    const repoSection = document.querySelectorAll(
      ".detail-panel-section--breakdown-table",
    )[1]!;
    expect(repoSection.querySelector("h3")!.textContent).toBe("By repository");
    const rowLabels = Array.from(
      repoSection.querySelectorAll("tbody th[scope='row']"),
    ).map((th) => th.textContent);
    expect(rowLabels).toEqual(["frontend", "backend-api"]);
  });

  it("By-repository labels are UNAFFECTED by authorsDimension (name resolution is column-scoped)", () => {
    // Regression guard: authorsDimension must only reach the By-author
    // column; By-repository keys are repository_names, not GUIDs, and
    // must render verbatim regardless of what authors are supplied.
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups, {
      authorsDimension: [
        { author_id: "alice", author_name: "Alice Smith" },
        { author_id: "frontend", author_name: "SHOULD NOT APPEAR" },
      ],
    });

    click(firstBar(container));

    const repoSection = document.querySelectorAll(
      ".detail-panel-section--breakdown-table",
    )[1]!;
    const rowLabels = Array.from(
      repoSection.querySelectorAll("tbody th[scope='row']"),
    ).map((th) => th.textContent);
    expect(rowLabels).toEqual(["frontend", "backend-api"]);
  });

  // -------------------------------------------------------------------------
  // Class lifecycle / MutationObserver
  // -------------------------------------------------------------------------

  it("adds is-drilldown-active to the clicked bar and clears it on dismiss", async () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);
    const bar = firstBar(container);

    click(bar);
    expect(bar.classList.contains("is-drilldown-active")).toBe(true);

    dismissDetailPanel("explicit-close-button");
    // MutationObserver callbacks are microtasks; await a microtask turn.
    await Promise.resolve();

    expect(bar.classList.contains("is-drilldown-active")).toBe(false);
  });

  it("dispose() mid-open clears is-drilldown-active and disconnects the panel observer", async () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    const handle = installThroughputDrilldown(container, rollups);
    const bar = firstBar(container);

    click(bar);
    expect(bar.classList.contains("is-drilldown-active")).toBe(true);

    handle.dispose();

    expect(bar.classList.contains("is-drilldown-active")).toBe(false);
    // Even if the panel is dismissed after dispose, the observer must not
    // touch the trigger class again — disconnected observers don't fire.
    dismissDetailPanel("explicit-close-button");
    await Promise.resolve();
    expect(bar.classList.contains("is-drilldown-active")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Empty-state paths
  // -------------------------------------------------------------------------

  it("by_author null renders an EmptyStateSection (not an empty table)", () => {
    const rollups = [makeRollup({ by_author: null })];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    const emptyStates = document.querySelectorAll(
      ".detail-panel-section--empty-state",
    );
    expect(emptyStates.length).toBe(1);
    expect(emptyStates[0]!.querySelector("h3")!.textContent).toBe("By author");
  });

  it("by_repository empty object renders an EmptyStateSection (not an empty table)", () => {
    const rollups = [makeRollup({ by_repository: {} })];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    const emptyStates = document.querySelectorAll(
      ".detail-panel-section--empty-state",
    );
    expect(emptyStates.length).toBe(1);
    expect(emptyStates[0]!.querySelector("h3")!.textContent).toBe(
      "By repository",
    );
  });

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  it("dispose() detaches listeners — subsequent pointer tap does not open panel", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    const handle = installThroughputDrilldown(container, rollups);

    handle.dispose();
    click(firstBar(container));

    expect(isDetailPanelOpen()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Comparison advisory routing
  // -------------------------------------------------------------------------

  it("routes to comparison advisory toast when comparison mode is active", () => {
    const rollups = [makeRollup()];
    // Comparison-advisory requires chart containers present to annotate;
    // #throughput-chart is already created by mountChart.
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    publishComparisonToggled({ enabled: true });
    click(firstBar(container));

    expect(isDetailPanelOpen()).toBe(false);
    expect(document.querySelector(".comparison-advisory-toast")).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Keyboard activation (independent of pointer path)
  // -------------------------------------------------------------------------

  it("keyboard Enter on a focused bar opens the panel", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);
    const bar = firstBar(container);

    bar.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }),
    );

    expect(isDetailPanelOpen()).toBe(true);
  });

  it("keyboard Space opens the panel and calls preventDefault on the event", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);
    const bar = firstBar(container);

    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: " ",
    });
    bar.dispatchEvent(event);

    expect(isDetailPanelOpen()).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Tooltip coexistence (narrow: panel opens, tooltip path unbroken)
  // -------------------------------------------------------------------------

  it("dismisses any active chart tooltip when the drill-down opens", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);
    const bar = firstBar(container);

    // Simulate the pointer sequence the browser runs on a tap: tooltip
    // pointerup fires first and shows the .chart-tooltip, then the
    // synthesized click reaches our delegated drill-down listener.
    bar.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    bar.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    expect(document.querySelector(".chart-tooltip")).not.toBeNull();

    click(bar);

    expect(isDetailPanelOpen()).toBe(true);
    expect(document.querySelector(".chart-tooltip")).toBeNull();
  });

  it("dismisses any active chart tooltip when comparison advisory toast fires", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);
    const bar = firstBar(container);

    publishComparisonToggled({ enabled: true });

    bar.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    bar.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    expect(document.querySelector(".chart-tooltip")).not.toBeNull();

    click(bar);

    expect(isDetailPanelOpen()).toBe(false);
    expect(document.querySelector(".chart-tooltip")).toBeNull();
    expect(document.querySelector(".comparison-advisory-toast")).not.toBeNull();
  });

  it("coexists with the chart-tooltip — click opens panel; tooltip attribute preserved", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    // Our panel opened.
    expect(document.querySelectorAll("aside.detail-panel.is-open").length).toBe(
      1,
    );
    // The tooltip's per-bar listener still had a chance to run (it wasn't
    // torn down by our install); the specific tooltip DOM is owned by
    // tooltip-manager, so we don't pin its structure here beyond
    // "the tooltip system did not crash and the bar is still tooltip-wired".
    expect(firstBar(container).getAttribute("data-tooltip")).toBe("true");
  });

  // -------------------------------------------------------------------------
  // Rerender sequence (dashboard.ts flow on filter change)
  // -------------------------------------------------------------------------

  it("after dispose→reinstall across a rerender only the newly-clicked bar is active", async () => {
    const rollups = [
      makeRollup({ week: "2025-W12" }),
      makeRollup({ week: "2025-W13", pr_count: 50 }),
    ];
    const container = mountChart(rollups);
    let handle = installThroughputDrilldown(container, rollups);

    const [barA, barB] = Array.from(
      container.querySelectorAll<HTMLElement>(".bar-container"),
    );
    if (!barA || !barB) throw new Error("expected two bars");

    click(barA);
    expect(barA.classList.contains("is-drilldown-active")).toBe(true);

    // Simulate dashboard.ts refreshMetrics: publishFiltersChanged closes
    // the panel via DetailPanel's open-scoped listener, then dispose runs.
    publishFiltersChanged({ reason: "user-change" });
    await Promise.resolve();
    handle.dispose();

    // Re-install (new cycle's render already wired the DOM — in this test
    // the DOM persists, which is stricter than production).
    handle = installThroughputDrilldown(container, rollups);
    click(barB);

    expect(document.querySelectorAll("aside.detail-panel.is-open").length).toBe(
      1,
    );
    const active = Array.from(
      document.querySelectorAll<HTMLElement>(".is-drilldown-active"),
    );
    expect(active.length).toBe(1);
    expect(active[0]).toBe(barB);

    handle.dispose();
  });

  // -------------------------------------------------------------------------
  // A11y surface: focusable + button role
  // -------------------------------------------------------------------------

  it("bars expose a button-role focusable surface (tabindex=0, role=button, focus() works)", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    const bar = firstBar(container);

    expect(bar.tabIndex).toBe(0);
    expect(bar.getAttribute("role")).toBe("button");
    bar.focus();
    expect(document.activeElement).toBe(bar);
  });

  // -------------------------------------------------------------------------
  // Coverage hardening — exercise every reachable early-return branch
  // -------------------------------------------------------------------------

  it("malformed week key falls back to 'Week {raw}' title", () => {
    const rollups = [makeRollup({ week: "not-iso" })];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    const title = document.querySelector("#detail-panel-title")!.textContent;
    expect(title).toBe("Week not-iso");
  });

  it("falls back to the ISO-week computation when start_date/end_date are unparseable", () => {
    const rollups = [
      makeRollup({
        week: "2025-W12",
        start_date: "not-a-date",
        end_date: "also-not-a-date",
      }),
    ];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    expect(document.querySelector("#detail-panel-title")!.textContent).toBe(
      "Week of Mar 17 – 23, 2025",
    );
  });

  it("falls back when start_date is syntactically valid but an impossible calendar date", () => {
    // "2025-02-31" would silently roll over to March 3 in
    // `new Date(y, m, d)`; the parser must reject it so the ISO-week
    // fallback renders the correct title instead.
    const rollups = [
      makeRollup({
        week: "2025-W12",
        start_date: "2025-02-31",
        end_date: "2025-02-31",
      }),
    ];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    expect(document.querySelector("#detail-panel-title")!.textContent).toBe(
      "Week of Mar 17 – 23, 2025",
    );
  });

  it("formats a cross-month week range with both month names", () => {
    // Example: ISO 2025-W14 runs Mon Mar 31 – Sun Apr 6; the formatter
    // must keep both month abbreviations when the range spans months.
    const rollups = [
      makeRollup({
        week: "2025-W14",
        start_date: "2025-03-31",
        end_date: "2025-04-06",
      }),
    ];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    expect(document.querySelector("#detail-panel-title")!.textContent).toBe(
      "Week of Mar 31 – Apr 6, 2025",
    );
  });

  it("formats a cross-year week range with both years", () => {
    // Example: ISO 2025-W01 runs Mon Dec 30 2024 – Sun Jan 5 2025.
    const rollups = [
      makeRollup({
        week: "2025-W01",
        start_date: "2024-12-30",
        end_date: "2025-01-05",
      }),
    ];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    expect(document.querySelector("#detail-panel-title")!.textContent).toBe(
      "Week of Dec 30, 2024 – Jan 5, 2025",
    );
  });

  it("prefers the rollup's authoritative start_date/end_date over the ISO-week computation", () => {
    // rollup.week would compute "Mar 17 – Mar 23" via isoWeekRange, but
    // the pipeline is the source of truth — if it writes a different
    // start_date/end_date pair (e.g., because of an off-by-one edge or
    // a non-standard calendar boundary), we must honor the pipeline.
    const rollups = [
      makeRollup({
        week: "2025-W12",
        start_date: "2025-04-07",
        end_date: "2025-04-13",
      }),
    ];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    expect(document.querySelector("#detail-panel-title")!.textContent).toBe(
      "Week of Apr 7 – 13, 2025",
    );
  });

  it("week-number outside ISO range (00–99) falls back to 'Week {raw}' title", () => {
    const rollups = [makeRollup({ week: "2025-W99" })];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    const title = document.querySelector("#detail-panel-title")!.textContent;
    expect(title).toBe("Week 2025-W99");
  });

  it("subtitle uses singular 'PR' when pr_count is 1", () => {
    const rollups = [makeRollup({ pr_count: 1 })];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    expect(document.querySelector(".detail-panel-subtitle")!.textContent).toBe(
      "1 PR",
    );
  });

  it("panel class mutation that keeps is-open leaves is-drilldown-active intact", async () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);
    const bar = firstBar(container);

    click(bar);
    const panel = document.querySelector<HTMLElement>("aside.detail-panel")!;
    panel.classList.add("a-non-open-class");
    await Promise.resolve();

    expect(bar.classList.contains("is-drilldown-active")).toBe(true);
  });

  it("empty data-drilldown-week attribute is a no-op (no panel opens)", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);
    const bar = firstBar(container);
    bar.setAttribute("data-drilldown-week", "");

    click(bar);

    expect(isDetailPanelOpen()).toBe(false);
  });

  it("bar whose week is not in the rollups slice is a no-op (no panel opens)", () => {
    const rollups = [makeRollup({ week: "2025-W12" })];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);
    const bar = firstBar(container);
    bar.setAttribute("data-drilldown-week", "2099-W42");

    click(bar);

    expect(isDetailPanelOpen()).toBe(false);
  });

  it("click on the container outside any bar is ignored", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    // Dispatching on the container itself: closest('[data-drilldown-week]')
    // finds nothing above container, so resolveTrigger returns null.
    click(container);

    expect(isDetailPanelOpen()).toBe(false);
  });

  it("keydown with an unrelated key (e.g. Escape) on a bar is ignored", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    firstBar(container).dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      }),
    );

    expect(isDetailPanelOpen()).toBe(false);
  });

  it("keydown outside any bar (on the container) is ignored", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }),
    );

    expect(isDetailPanelOpen()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Comparison-mode keyboard guard (PR #302 P1.E checklist)
  // -------------------------------------------------------------------------

  it("keyboard Enter in comparison mode opens the advisory toast, NOT the panel", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    publishComparisonToggled({ enabled: true });
    firstBar(container).dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }),
    );

    expect(isDetailPanelOpen()).toBe(false);
    expect(document.querySelector(".comparison-advisory-toast")).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // aria-expanded toggle (PR #302 P1.E sentinel)
  // -------------------------------------------------------------------------

  describe("aria-expanded toggle", () => {
    it("renders aria-expanded='false' on every bar at install time", () => {
      const rollups = [makeRollup({ week: "2025-W11" }), makeRollup()];
      const container = mountChart(rollups);
      installThroughputDrilldown(container, rollups);

      const bars = container.querySelectorAll<HTMLElement>(".bar-container");
      expect(bars.length).toBe(2);
      for (const bar of Array.from(bars)) {
        expect(bar.getAttribute("aria-expanded")).toBe("false");
      }
    });

    it("flips aria-expanded='true' on the activated bar when the panel opens", () => {
      const rollups = [makeRollup()];
      const container = mountChart(rollups);
      installThroughputDrilldown(container, rollups);
      const bar = firstBar(container);

      click(bar);

      expect(isDetailPanelOpen()).toBe(true);
      expect(bar.getAttribute("aria-expanded")).toBe("true");
    });

    it("resets aria-expanded='false' on the trigger via every dismiss path through clearActive", async () => {
      const rollups = [makeRollup()];
      const container = mountChart(rollups);
      installThroughputDrilldown(container, rollups);
      const bar = firstBar(container);

      click(bar);
      expect(bar.getAttribute("aria-expanded")).toBe("true");

      dismissDetailPanel("explicit-close-button");
      // MutationObserver on panel.is-open is async — let the microtask
      // run so clearActive fires and resets aria-expanded.
      await Promise.resolve();
      expect(bar.getAttribute("aria-expanded")).toBe("false");
    });
  });

  // -------------------------------------------------------------------------
  // Feature 060: PR-detail section rendering (T020)
  // -------------------------------------------------------------------------
  describe("PR-detail section (feature 060)", () => {
    const BASE_WEB_CTX = {
      collectionUri: "https://dev.azure.com/acme/",
    };
    const BASE_REPOS = [
      {
        repository_id: "repo-1",
        repository_name: "web-app",
        project_name: "Frontend",
        organization_name: "acme",
      },
    ];

    function makeRollupWithPrs(
      prs: ReadonlyArray<{
        id: number;
        title: string;
        author_id: string;
        repository_id: string;
        cycle_time: number;
      }>,
      overrides: Partial<Rollup> = {},
    ): Rollup {
      return makeRollup({
        pr_count: prs.length,
        prs,
        _prs_truncated: false,
        _prs_cap: 500,
        ...overrides,
      });
    }

    it("unfiltered week with PRs renders PrListSection contentState='pr-list' with row title, cycle time, and URL", () => {
      const rollups = [
        makeRollupWithPrs([
          {
            id: 101,
            title: "feat: oauth",
            author_id: "alice",
            repository_id: "repo-1",
            cycle_time: 125.0,
          },
          {
            id: 102,
            title: "fix: null guard",
            author_id: "bob",
            repository_id: "repo-1",
            cycle_time: 45.0,
          },
        ]),
      ];
      const container = mountChart(rollups);
      installThroughputDrilldown(container, rollups, {
        filters: { repos: [], teams: [], reviewers: [], authors: [] },
        repositoriesDimension: BASE_REPOS,
        webContext: BASE_WEB_CTX,
      });

      const bar = firstBar(container);
      // T026 affordance check — bar MUST remain keyboard-/screen-reader-
      // activatable even after the new PR section is appended.
      expect(bar.getAttribute("tabindex")).not.toBeNull();
      expect(bar.getAttribute("role")).not.toBeNull();
      expect(bar.getAttribute("aria-label")).not.toBeNull();

      click(bar);

      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      expect(prSection!.getAttribute("data-content-state")).toBe("pr-list");
      expect(prSection!.querySelector("h3")!.textContent).toBe("Pull requests");

      const rowLinks = prSection!.querySelectorAll<HTMLAnchorElement>(
        "ol li .detail-panel-pr-link",
      );
      expect(rowLinks.length).toBe(2);
      expect(rowLinks[0]!.getAttribute("href")).toBe(
        "https://dev.azure.com/acme/Frontend/_git/web-app/pullrequest/101",
      );
      expect(rowLinks[0]!.textContent).toContain("#101");
      expect(rowLinks[0]!.textContent).toContain("feat: oauth");
      expect(rowLinks[0]!.getAttribute("target")).toBe("_blank");
      expect(rowLinks[0]!.getAttribute("rel")).toContain("noopener");

      const cycleTexts = Array.from(
        prSection!.querySelectorAll("ol li .cycle-time"),
      ).map((el) => el.textContent);
      // 125 min = 2.1h ; 45 min = 45m (formatDuration output shape).
      expect(cycleTexts[0]).toBe("2.1h");
      expect(cycleTexts[1]).toBe("45m");

      // No truncation indicator when rendered === actualFiltered.
      expect(prSection!.querySelector(".truncation-indicator")).toBeNull();
    });

    it("truncated week (rendered < actualFiltered) shows truncation indicator with both counts", () => {
      // Aggregator-side the prs array is already capped at 500; we simulate
      // that by providing 2 rendered rows against a chart pr_count of 47
      // with _prs_truncated=true.
      const rollups = [
        makeRollupWithPrs(
          [
            {
              id: 201,
              title: "big refactor",
              author_id: "carol",
              repository_id: "repo-1",
              cycle_time: 1200.0,
            },
            {
              id: 202,
              title: "tiny tweak",
              author_id: "dave",
              repository_id: "repo-1",
              cycle_time: 800.0,
            },
          ],
          { pr_count: 47, _prs_truncated: true, _prs_cap: 500 },
        ),
      ];
      const container = mountChart(rollups);
      installThroughputDrilldown(container, rollups, {
        filters: { repos: [], teams: [], reviewers: [], authors: [] },
        repositoriesDimension: BASE_REPOS,
        webContext: BASE_WEB_CTX,
      });

      click(firstBar(container));

      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      const indicator = prSection!.querySelector(".truncation-indicator");
      expect(indicator).not.toBeNull();
      const indicatorText = indicator!.textContent ?? "";
      // FR-008: both counts surfaced.
      expect(indicatorText).toContain("2");
      expect(indicatorText).toContain("47");
      expect(indicatorText).toContain("500");
    });

    it("supported filter with no PRs in rollup renders contentState='supported-empty' (never omits the section)", () => {
      // Feature 060 FR-020: the section is never omitted — even on an old
      // rollup that predates `prs`, the section renders a supported-empty
      // placeholder so users see a consistent surface.
      const rollups = [makeRollup()]; // no prs field
      const container = mountChart(rollups);
      installThroughputDrilldown(container, rollups, {
        filters: { repos: [], teams: [], reviewers: [], authors: [] },
        repositoriesDimension: BASE_REPOS,
        webContext: BASE_WEB_CTX,
      });

      click(firstBar(container));

      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      expect(prSection!.getAttribute("data-content-state")).toBe(
        "supported-empty",
      );
      // No rows rendered in supported-empty.
      expect(prSection!.querySelector("ol")).toBeNull();
    });

    // T034 (feature 060 Phase 5)
    it("team filter active → PrListSection contentState='team-inline', inline message names team filter", () => {
      const rollups = [
        makeRollupWithPrs([
          {
            id: 301,
            title: "blocked by team gate",
            author_id: "alice",
            repository_id: "repo-1",
            cycle_time: 600,
          },
        ]),
      ];
      const container = mountChart(rollups);
      installThroughputDrilldown(container, rollups, {
        filters: {
          repos: [],
          teams: ["platform-core"],
          reviewers: [],
          authors: [],
        },
        repositoriesDimension: BASE_REPOS,
        webContext: BASE_WEB_CTX,
      });

      click(firstBar(container));

      // Panel opens (Phase 1 behavior preserved under team filter).
      expect(isDetailPanelOpen()).toBe(true);

      // Phase 1 aggregate sections render unchanged.
      expect(
        document.querySelectorAll(".detail-panel-section--breakdown-table")
          .length,
      ).toBeGreaterThanOrEqual(1);

      // PR-detail container flips to team-inline content state.
      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      expect(prSection!.getAttribute("data-content-state")).toBe("team-inline");
      const gated = prSection!.querySelector(".pr-detail-gated");
      expect(gated).not.toBeNull();
      expect(gated!.textContent ?? "").toMatch(/team/i);
      // Inline message is a status announcement, not an alert.
      expect(gated!.getAttribute("aria-live")).toBe("polite");
      // No PR rows rendered under team filter.
      expect(prSection!.querySelector("ol")).toBeNull();
    });

    // T035 (feature 060 Phase 5)
    it("reviewer filter active → PrListSection contentState='reviewer-inline', inline message names reviewer filter", () => {
      const rollups = [
        makeRollupWithPrs([
          {
            id: 401,
            title: "not rendered",
            author_id: "alice",
            repository_id: "repo-1",
            cycle_time: 300,
          },
        ]),
      ];
      const container = mountChart(rollups);
      installThroughputDrilldown(container, rollups, {
        filters: {
          repos: [],
          teams: [],
          reviewers: ["reviewer-007"],
          authors: [],
        },
        repositoriesDimension: BASE_REPOS,
        webContext: BASE_WEB_CTX,
      });

      click(firstBar(container));

      expect(isDetailPanelOpen()).toBe(true);
      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      expect(prSection!.getAttribute("data-content-state")).toBe(
        "reviewer-inline",
      );
      const gated = prSection!.querySelector(".pr-detail-gated");
      expect(gated).not.toBeNull();
      expect(gated!.textContent ?? "").toMatch(/reviewer/i);
      expect(gated!.getAttribute("aria-live")).toBe("polite");
      expect(prSection!.querySelector("ol")).toBeNull();
    });

    // T036 (feature 060 Phase 5)
    it("comparison-mode active → panel stays closed, PR-detail container is not constructed (Phase 1 toast-denial preserved)", () => {
      const rollups = [
        makeRollupWithPrs([
          {
            id: 501,
            title: "should not appear",
            author_id: "alice",
            repository_id: "repo-1",
            cycle_time: 900,
          },
        ]),
      ];
      const container = mountChart(rollups);
      installThroughputDrilldown(container, rollups, {
        filters: { repos: [], teams: [], reviewers: [], authors: [] },
        repositoriesDimension: BASE_REPOS,
        webContext: BASE_WEB_CTX,
      });

      publishComparisonToggled({ enabled: true });
      click(firstBar(container));

      // FR-007a: panel DOES NOT open, comparison advisory toast fires.
      expect(isDetailPanelOpen()).toBe(false);
      expect(
        document.querySelector(".comparison-advisory-toast"),
      ).not.toBeNull();
      // PR-detail container must not be constructed when activate() early-
      // returns — no leaked <section id="pr-detail"> anywhere in the DOM.
      expect(document.getElementById("pr-detail")).toBeNull();
    });

    // T056 (feature 060 Phase 8, SC-008 / FR-016)
    it("keyboard activation (Enter / Space) produces the same PR-detail outcomes as mouse click across every gated state", () => {
      // Single test covers the four-state matrix from FR-016 / SC-008. Each
      // sub-case reinstalls the drill-down so options + filter state are
      // distinct across sub-cases — matches the production re-install-
      // per-refresh pattern.
      type Sub = {
        readonly label: string;
        readonly key: "Enter" | " ";
        readonly options: Parameters<typeof installThroughputDrilldown>[2];
        readonly rollup: () => Rollup;
        readonly comparisonActive?: boolean;
        readonly expectPanelOpen: boolean;
        readonly expectContentState?:
          | "pr-list"
          | "supported-empty"
          | "team-inline"
          | "reviewer-inline";
      };

      const subs: readonly Sub[] = [
        {
          label: "supported + Enter",
          key: "Enter",
          options: {
            filters: { repos: [], teams: [], reviewers: [], authors: [] },
            repositoriesDimension: BASE_REPOS,
            webContext: BASE_WEB_CTX,
          },
          rollup: () =>
            makeRollupWithPrs([
              {
                id: 9001,
                title: "kbd-open",
                author_id: "alice",
                repository_id: "repo-1",
                cycle_time: 60,
              },
            ]),
          expectPanelOpen: true,
          expectContentState: "pr-list",
        },
        {
          label: "team-inline + Space",
          key: " ",
          options: {
            filters: {
              repos: [],
              teams: ["platform"],
              reviewers: [],
              authors: [],
            },
            repositoriesDimension: BASE_REPOS,
            webContext: BASE_WEB_CTX,
          },
          rollup: () =>
            makeRollupWithPrs([
              {
                id: 9002,
                title: "kbd-team",
                author_id: "alice",
                repository_id: "repo-1",
                cycle_time: 120,
              },
            ]),
          expectPanelOpen: true,
          expectContentState: "team-inline",
        },
        {
          label: "reviewer-inline + Enter",
          key: "Enter",
          options: {
            filters: {
              repos: [],
              teams: [],
              reviewers: ["bob"],
              authors: [],
            },
            repositoriesDimension: BASE_REPOS,
            webContext: BASE_WEB_CTX,
          },
          rollup: () =>
            makeRollupWithPrs([
              {
                id: 9003,
                title: "kbd-reviewer",
                author_id: "alice",
                repository_id: "repo-1",
                cycle_time: 180,
              },
            ]),
          expectPanelOpen: true,
          expectContentState: "reviewer-inline",
        },
        {
          label: "comparison + Space",
          key: " ",
          options: {
            filters: { repos: [], teams: [], reviewers: [], authors: [] },
            repositoriesDimension: BASE_REPOS,
            webContext: BASE_WEB_CTX,
          },
          rollup: () =>
            makeRollupWithPrs([
              {
                id: 9004,
                title: "kbd-cmp",
                author_id: "alice",
                repository_id: "repo-1",
                cycle_time: 240,
              },
            ]),
          comparisonActive: true,
          expectPanelOpen: false,
        },
        {
          label: "supported-empty + Enter",
          key: "Enter",
          options: {
            filters: { repos: [], teams: [], reviewers: [], authors: [] },
            repositoriesDimension: BASE_REPOS,
            webContext: BASE_WEB_CTX,
          },
          rollup: () => makeRollupWithPrs([], { pr_count: 0 }),
          expectPanelOpen: true,
          expectContentState: "supported-empty",
        },
      ];

      for (const sub of subs) {
        // Reset per sub-case.
        if (isDetailPanelOpen()) dismissDetailPanel("explicit-close-button");
        publishComparisonToggled({ enabled: false });
        __resetComparisonAdvisoryForTests();
        document.body.innerHTML = "";

        const rollups = [sub.rollup()];
        const container = mountChart(rollups);
        const handle = installThroughputDrilldown(
          container,
          rollups,
          sub.options,
        );
        if (sub.comparisonActive) {
          publishComparisonToggled({ enabled: true });
        }

        const bar = firstBar(container);
        const event = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: sub.key,
        });
        bar.dispatchEvent(event);

        expect(isDetailPanelOpen()).toBe(sub.expectPanelOpen);
        if (sub.expectPanelOpen && sub.expectContentState) {
          const prSection = document.getElementById("pr-detail");
          expect(prSection).not.toBeNull();
          expect(prSection!.getAttribute("data-content-state")).toBe(
            sub.expectContentState,
          );
        } else {
          expect(document.getElementById("pr-detail")).toBeNull();
        }

        handle.dispose();
      }
    });

    // Feature 309 (#315): demo-mode webContext stub lets the PR list render
    // against synthetic `prs` data published by slice 2d. Regression: prior
    // to slice 2d's fix in dashboard.ts, `currentCollectionUri` stayed null
    // in local/demo mode, so `webContext` was undefined and
    // buildPrListSection short-circuited to "supported-empty" regardless of
    // the populated `prs` array.
    it("demo-mode webContext stub + non-empty prs renders contentState='pr-list' with deterministic oddessentials URLs", () => {
      const DEMO_WEB_CTX = {
        collectionUri: "https://dev.azure.com/oddessentials/",
      };
      const rollups = [
        makeRollupWithPrs([
          {
            id: 202510042,
            title: "feature-deployment-verified",
            author_id: "user-alpha",
            repository_id: "repo-1",
            cycle_time: 90.0,
          },
          {
            id: 202510043,
            title: "refactor-hooks-baseline",
            author_id: "user-bravo",
            repository_id: "repo-1",
            cycle_time: 42.5,
          },
        ]),
      ];
      const container = mountChart(rollups);
      installThroughputDrilldown(container, rollups, {
        filters: { repos: [], teams: [], reviewers: [], authors: [] },
        repositoriesDimension: BASE_REPOS,
        webContext: DEMO_WEB_CTX,
      });

      click(firstBar(container));

      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      expect(prSection!.getAttribute("data-content-state")).toBe("pr-list");

      const rowLinks = prSection!.querySelectorAll<HTMLAnchorElement>(
        "ol li .detail-panel-pr-link",
      );
      expect(rowLinks.length).toBe(2);
      expect(rowLinks[0]!.getAttribute("href")).toBe(
        "https://dev.azure.com/oddessentials/Frontend/_git/web-app/pullrequest/202510042",
      );
      expect(rowLinks[1]!.getAttribute("href")).toBe(
        "https://dev.azure.com/oddessentials/Frontend/_git/web-app/pullrequest/202510043",
      );
    });

    // T043 (feature 060 Phase 6)
    it("supported filter yielding zero matches → contentState='supported-empty' with copy DISTINCT from team/reviewer messages", () => {
      // Simulate the post-applyFiltersToRollups state: an author filter has
      // matched zero PRs upstream, so rollup.prs arrives empty. The PR-
      // detail section MUST flip to supported-empty — distinct from team/
      // reviewer inline copy — so the user reads "zero matches" rather
      // than "dimension unsupported."
      const rollups = [makeRollupWithPrs([], { pr_count: 0 })];
      const container = mountChart(rollups);
      installThroughputDrilldown(container, rollups, {
        filters: { repos: [], teams: [], reviewers: [], authors: ["ghost"] },
        repositoriesDimension: BASE_REPOS,
        webContext: BASE_WEB_CTX,
      });

      click(firstBar(container));

      expect(isDetailPanelOpen()).toBe(true);
      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      expect(prSection!.getAttribute("data-content-state")).toBe(
        "supported-empty",
      );
      const emptyMsg = prSection!.querySelector(".detail-panel-empty-detail");
      expect(emptyMsg).not.toBeNull();
      const emptyText = emptyMsg!.textContent ?? "";
      // FR-009 / FR-018: copy is distinct from unsupported-filter wording.
      expect(emptyText).toMatch(/match/i);
      expect(emptyText).not.toMatch(/clear the team/i);
      expect(emptyText).not.toMatch(/clear the reviewer/i);
    });

    it("capability-on install path wires commentsMetricsAvailable through buildPrListSection to the renderer (feature 310)", () => {
      // Covers throughput-drilldown.ts buildPrListSection's
      // ``!commentsMetricsAvailable`` false branch: when the install
      // passes the flag, PR rows are mapped with the three comments-
      // metrics fields (thread_count / comment_count /
      // active_thread_count) from the rollup's PrRecord shape.
      // End-to-end verification: the rendered panel carries one
      // .comments-metric span per axis per row + the sort / filter
      // controls added by detail-panel's capability-on branch.
      const rollups = [
        makeRollupWithPrs([
          {
            id: 201,
            title: "feat: oauth",
            author_id: "alice",
            repository_id: "repo-1",
            cycle_time: 125.0,
            thread_count: 7,
            comment_count: 22,
            active_thread_count: 3,
          },
          {
            id: 202,
            title: "fix: partial-coverage",
            author_id: "bob",
            repository_id: "repo-1",
            cycle_time: 55.0,
            thread_count: null,
            comment_count: null,
            active_thread_count: null,
          },
        ] as ReadonlyArray<{
          readonly id: number;
          readonly title: string;
          readonly author_id: string;
          readonly repository_id: string;
          readonly cycle_time: number;
          readonly thread_count?: number | null;
          readonly comment_count?: number | null;
          readonly active_thread_count?: number | null;
        }>),
      ];
      const container = mountChart(rollups);
      installThroughputDrilldown(container, rollups, {
        filters: { repos: [], teams: [], reviewers: [], authors: [] },
        repositoriesDimension: BASE_REPOS,
        webContext: BASE_WEB_CTX,
        commentsMetricsAvailable: true,
      });
      click(firstBar(container));

      expect(isDetailPanelOpen()).toBe(true);
      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      // Feature 310 capability-on DOM: the column-header row (F1 / F4)
      // and the separate filter row are both present.  The pre-310
      // ``.detail-panel-pr-list-controls`` container was removed as part
      // of the header-driven sort swap (lock #3); asserting its absence
      // here is a regression guard against any accidental reintroduction.
      // Issue #342: when sort cells emit, the header carries the
      // ``--with-comments`` modifier so CSS swaps to the 5-col grid.
      const drilldownHeader = prSection!.querySelector<HTMLElement>(
        ".detail-panel-pr-list-header",
      );
      expect(drilldownHeader).not.toBeNull();
      expect(
        drilldownHeader!.classList.contains(
          "detail-panel-pr-list-header--with-comments",
        ),
      ).toBe(true);
      expect(
        prSection!.querySelector(".detail-panel-pr-list-filter"),
      ).not.toBeNull();
      expect(
        prSection!.querySelector(".detail-panel-pr-list-controls"),
      ).toBeNull();
      const list = prSection!.querySelector<HTMLOListElement>(
        "ol.detail-panel-pr-list",
      );
      expect(list).not.toBeNull();
      expect(
        list!.classList.contains("detail-panel-pr-list--with-comments"),
      ).toBe(true);
      const rows = prSection!.querySelectorAll<HTMLLIElement>(
        ".detail-panel-pr-row",
      );
      expect(rows).toHaveLength(2);
      // Covered row — numeric spans.
      const covered = rows[0]!;
      expect(
        covered.querySelector(".comments-metric--threads")?.textContent,
      ).toBe("7");
      expect(
        covered.querySelector(".comments-metric--comments")?.textContent,
      ).toBe("22");
      expect(
        covered.querySelector(".comments-metric--unresolved")?.textContent,
      ).toBe("3");
      // Partial row — three "—" spans, row-level data-partial, and
      // (post-#331 / A2 + Codex review) a visually-hidden
      // "Coverage pending" child span that announces the partial
      // state to SR ONCE per row WITHOUT overriding the listitem's
      // accessible name (which would drop PR identity).  Per-span
      // aria-hidden suppresses triple "dash" announcements.
      const partial = rows[1]!;
      expect(partial.getAttribute("data-partial")).toBe("true");
      expect(partial.getAttribute("aria-label")).toBeNull();
      const srNotes = partial.querySelectorAll<HTMLSpanElement>(
        "span.visually-hidden",
      );
      expect(srNotes).toHaveLength(1);
      expect(srNotes[0]!.textContent).toBe("Coverage pending");
      const partialSpans =
        partial.querySelectorAll<HTMLSpanElement>(".comments-metric");
      for (const span of partialSpans) {
        expect(span.getAttribute("data-partial")).toBe("true");
        expect(span.getAttribute("aria-hidden")).toBe("true");
        expect(span.getAttribute("aria-label")).toBeNull();
        expect(span.textContent).toBe("—");
      }
    });

    // -----------------------------------------------------------------------
    // Feature 310 (Commit 2 / F6) — week-level stat row.
    // -----------------------------------------------------------------------
    describe("week stat row (feature 310, F6)", () => {
      function buildPrsWithComments(
        prs: ReadonlyArray<{
          id: number;
          title: string;
          author_id: string;
          repository_id: string;
          cycle_time: number;
          thread_count?: number | null;
          comment_count?: number | null;
          active_thread_count?: number | null;
        }>,
      ): Rollup {
        return makeRollupWithPrs(
          prs as ReadonlyArray<{
            id: number;
            title: string;
            author_id: string;
            repository_id: string;
            cycle_time: number;
          }>,
        );
      }

      function statRowSection(): HTMLElement | null {
        return document.querySelector<HTMLElement>(
          ".detail-panel-sections > .detail-panel-section--stat-row",
        );
      }

      function statValues(): string[] {
        return Array.from(
          document.querySelectorAll<HTMLElement>(
            ".detail-panel-section--stat-row .detail-panel-stats dd",
          ),
        ).map((dd) => dd.textContent ?? "");
      }

      it("appears as the first section when capability-on and the slice is non-empty", () => {
        const rollups = [
          buildPrsWithComments([
            {
              id: 1,
              title: "a",
              author_id: "alice",
              repository_id: "repo-1",
              cycle_time: 10,
              thread_count: 3,
              comment_count: 7,
              active_thread_count: 1,
            },
          ]),
        ];
        const container = mountChart(rollups);
        installThroughputDrilldown(container, rollups, {
          filters: { repos: [], teams: [], reviewers: [], authors: [] },
          repositoriesDimension: BASE_REPOS,
          webContext: BASE_WEB_CTX,
          commentsMetricsAvailable: true,
        });
        click(firstBar(container));

        const sections = document.querySelectorAll<HTMLElement>(
          ".detail-panel-sections > .detail-panel-section",
        );
        expect(sections.length).toBeGreaterThanOrEqual(4);
        // Lock #2 — strict prepend: stat-row sits at index 0 ahead of
        // every existing section.
        expect(
          sections[0]!.classList.contains("detail-panel-section--stat-row"),
        ).toBe(true);
      });

      it("strictly prepends the stat row without reordering byAuthor / byRepository / pr-detail (lock #2)", () => {
        const rollups = [
          buildPrsWithComments([
            {
              id: 1,
              title: "a",
              author_id: "alice",
              repository_id: "repo-1",
              cycle_time: 10,
              thread_count: 3,
              comment_count: 7,
              active_thread_count: 1,
            },
          ]),
        ];
        const container = mountChart(rollups);
        installThroughputDrilldown(container, rollups, {
          filters: { repos: [], teams: [], reviewers: [], authors: [] },
          repositoriesDimension: BASE_REPOS,
          webContext: BASE_WEB_CTX,
          commentsMetricsAvailable: true,
        });
        click(firstBar(container));

        const sections = document.querySelectorAll<HTMLElement>(
          ".detail-panel-sections > .detail-panel-section",
        );
        // Section sequence: [stat-row, by-author breakdown, by-repo
        // breakdown, pr-detail].  Asserts that the existing trio's
        // RELATIVE order is byte-stable (lock #2 — only a new
        // prepend, no mutation or reordering).
        expect(
          sections[0]!.classList.contains("detail-panel-section--stat-row"),
        ).toBe(true);
        expect(sections[1]!.querySelector("h3")?.textContent).toBe("By author");
        expect(sections[2]!.querySelector("h3")?.textContent).toBe(
          "By repository",
        );
        expect(sections[3]!.id).toBe("pr-detail");
      });

      it("is absent when capability-off (lock #3 / lock #9 — zero emission, not hidden)", () => {
        const rollups = [
          buildPrsWithComments([
            {
              id: 1,
              title: "a",
              author_id: "alice",
              repository_id: "repo-1",
              cycle_time: 10,
              thread_count: 3,
              comment_count: 7,
              active_thread_count: 1,
            },
          ]),
        ];
        const container = mountChart(rollups);
        installThroughputDrilldown(container, rollups, {
          filters: { repos: [], teams: [], reviewers: [], authors: [] },
          repositoriesDimension: BASE_REPOS,
          webContext: BASE_WEB_CTX,
          commentsMetricsAvailable: false,
        });
        click(firstBar(container));

        expect(statRowSection()).toBeNull();
        const sections = document.querySelectorAll<HTMLElement>(
          ".detail-panel-sections > .detail-panel-section",
        );
        // First visible section is the by-author breakdown, NOT a
        // stat row — capability-off render path is unchanged.
        expect(sections[0]!.querySelector("h3")?.textContent).toBe("By author");
      });

      it("is absent when the slice is empty even on capability-on (lock #3)", () => {
        // No PRs in the rollup → buildPrListSection resolves to
        // ``supported-empty`` and the stat-row gate
        // (``rawPrs.length > 0``) keeps the section out entirely.
        const rollups = [
          makeRollup({
            pr_count: 0,
            prs: [],
            _prs_truncated: false,
            _prs_cap: 500,
          }),
        ];
        const container = mountChart(rollups);
        installThroughputDrilldown(container, rollups, {
          filters: { repos: [], teams: [], reviewers: [], authors: [] },
          repositoriesDimension: BASE_REPOS,
          webContext: BASE_WEB_CTX,
          commentsMetricsAvailable: true,
        });
        click(firstBar(container));

        expect(statRowSection()).toBeNull();
      });

      it("sums Threads / Comments / Unresolved threads correctly with all-numeric rows (no partial suffix)", () => {
        const rollups = [
          buildPrsWithComments([
            {
              id: 1,
              title: "a",
              author_id: "alice",
              repository_id: "repo-1",
              cycle_time: 10,
              thread_count: 5,
              comment_count: 17,
              active_thread_count: 2,
            },
            {
              id: 2,
              title: "b",
              author_id: "bob",
              repository_id: "repo-1",
              cycle_time: 20,
              thread_count: 3,
              comment_count: 8,
              active_thread_count: 1,
            },
            {
              id: 3,
              title: "c",
              author_id: "alice",
              repository_id: "repo-1",
              cycle_time: 30,
              thread_count: 0,
              comment_count: 0,
              active_thread_count: 0,
            },
          ]),
        ];
        const container = mountChart(rollups);
        installThroughputDrilldown(container, rollups, {
          filters: { repos: [], teams: [], reviewers: [], authors: [] },
          repositoriesDimension: BASE_REPOS,
          webContext: BASE_WEB_CTX,
          commentsMetricsAvailable: true,
        });
        click(firstBar(container));

        // Sums: 5+3+0 / 17+8+0 / 2+1+0.  No partial rows ⇒ no suffix
        // (lock #5 — partial annotation appears iff partialCount > 0).
        expect(statValues()).toEqual(["8", "25", "3"]);
      });

      it("appends '(+N partial)' on every stat when at least one row is partial; partials contribute 0 to numeric sums (lock #5)", () => {
        const rollups = [
          buildPrsWithComments([
            {
              id: 1,
              title: "a",
              author_id: "alice",
              repository_id: "repo-1",
              cycle_time: 10,
              thread_count: 5,
              comment_count: 17,
              active_thread_count: 2,
            },
            {
              id: 2,
              title: "b",
              author_id: "bob",
              repository_id: "repo-1",
              cycle_time: 20,
              thread_count: null,
              comment_count: null,
              active_thread_count: null,
            },
            {
              id: 3,
              title: "c",
              author_id: "alice",
              repository_id: "repo-1",
              cycle_time: 30,
              thread_count: 1,
              comment_count: 4,
              active_thread_count: 0,
            },
          ]),
        ];
        const container = mountChart(rollups);
        installThroughputDrilldown(container, rollups, {
          filters: { repos: [], teams: [], reviewers: [], authors: [] },
          repositoriesDimension: BASE_REPOS,
          webContext: BASE_WEB_CTX,
          commentsMetricsAvailable: true,
        });
        click(firstBar(container));

        // Numeric sums (partial row contributes 0): 5+0+1 / 17+0+4 / 2+0+0.
        // Partial counter: 1 (the null-triplet row was iterated, not
        // excluded from count logic — lock #4).
        expect(statValues()).toEqual([
          "6 (+1 partial)",
          "21 (+1 partial)",
          "2 (+1 partial)",
        ]);
      });

      it("issue #331 / A1: renders 'Pending (N)' (NOT '0 (+N partial)') when EVERY row in the slice is partial", () => {
        // Locks the A1 contract: an all-partial week MUST be visibly
        // distinct from a true-zero week on the stat row.  Under the
        // prior implementation both states rendered with the SAME
        // headline "0" plus the SAME "(+N partial)" annotation —
        // collapsing two materially different states into one
        // visual signature.  Per INV-08 / INV-10 (all-or-nothing
        // per row) "all rows partial on any one axis" collapses to
        // "all rows partial on every axis," so the literal
        // ``Pending (N)`` is correct on every axis simultaneously.
        const rollups = [
          buildPrsWithComments([
            {
              id: 1,
              title: "a",
              author_id: "alice",
              repository_id: "repo-1",
              cycle_time: 10,
              thread_count: null,
              comment_count: null,
              active_thread_count: null,
            },
            {
              id: 2,
              title: "b",
              author_id: "bob",
              repository_id: "repo-1",
              cycle_time: 20,
              thread_count: null,
              comment_count: null,
              active_thread_count: null,
            },
            {
              id: 3,
              title: "c",
              author_id: "alice",
              repository_id: "repo-1",
              cycle_time: 30,
              thread_count: null,
              comment_count: null,
              active_thread_count: null,
            },
          ]),
        ];
        const container = mountChart(rollups);
        installThroughputDrilldown(container, rollups, {
          filters: { repos: [], teams: [], reviewers: [], authors: [] },
          repositoriesDimension: BASE_REPOS,
          webContext: BASE_WEB_CTX,
          commentsMetricsAvailable: true,
        });
        click(firstBar(container));

        // All three axes carry the same literal — the headline IS
        // the partial signal; no numeric ``0`` because the underlying
        // data is absent, not zero.
        expect(statValues()).toEqual([
          "Pending (3)",
          "Pending (3)",
          "Pending (3)",
        ]);
      });

      it("issue #342 review finding: undefined comment metrics are counted as partial in the stat row (matches renderer + coverage notice)", () => {
        // Codex P2 review finding (2026-04-25): the producer at
        // installThroughputDrilldown's "supported" branch passes
        // ``pr.thread_count`` / ``comment_count`` /
        // ``active_thread_count`` straight through without normalising
        // ``undefined`` to ``null``, on the explicit promise that
        // every consumer (renderer + stat row) handles both shapes
        // identically.  The renderer ``renderPrListSection`` honours
        // that promise; ``buildCommentsStatRow`` previously did not
        // — it tested ``=== null`` only, so a slice of all-
        // ``undefined`` rows rendered coverage-pending dashes per
        // row AND an all-partial coverage notice ("none of these
        // PRs have comment data yet") AND ``Threads: 0 | Comments:
        // 0 | Unresolved: 0`` on the stat row.  That's the same
        // visual signature as a true-zero week — exactly the A1
        // contradiction the partial-state honesty fix was meant to
        // eliminate.
        //
        // Locks the corrected contract: an all-``undefined`` slice
        // renders the same ``Pending (N)`` literal on the stat row
        // as an all-``null`` slice, since both shapes are partial.
        const rollups = [
          buildPrsWithComments([
            {
              id: 1,
              title: "a",
              author_id: "alice",
              repository_id: "repo-1",
              cycle_time: 10,
              // Fields intentionally OMITTED — produces row.threadCount
              // === undefined, the capability-off-passthrough leak shape
              // the producer comment expects every consumer to honour.
            },
            {
              id: 2,
              title: "b",
              author_id: "bob",
              repository_id: "repo-1",
              cycle_time: 20,
            },
          ]),
        ];
        const container = mountChart(rollups);
        installThroughputDrilldown(container, rollups, {
          filters: { repos: [], teams: [], reviewers: [], authors: [] },
          repositoriesDimension: BASE_REPOS,
          webContext: BASE_WEB_CTX,
          commentsMetricsAvailable: true,
        });
        click(firstBar(container));

        expect(statValues()).toEqual([
          "Pending (2)",
          "Pending (2)",
          "Pending (2)",
        ]);
      });

      it("derives sums ONLY from rollup.prs even when rollup.pr_count / by_author / by_repository disagree (lock #4 slice-only guard)", () => {
        // Setup a rollup whose chart-level aggregate fields are
        // intentionally inconsistent with the per-row sums.  Any
        // implementation that reads a rollup aggregate field would
        // produce 999; the only correct value is the per-row sum from
        // rollup.prs.  This is the explicit slice-only guard test.
        const rollups = [
          buildPrsWithComments([
            {
              id: 1,
              title: "a",
              author_id: "alice",
              repository_id: "repo-1",
              cycle_time: 10,
              thread_count: 9,
              comment_count: 100,
              active_thread_count: 4,
            },
          ]),
        ];
        const rollup = rollups[0]!;
        (rollup as { pr_count: number }).pr_count = 999;
        (
          rollup as { by_author: Record<string, { pr_count: number }> }
        ).by_author = { alice: { pr_count: 999 } };
        (
          rollup as { by_repository: Record<string, { pr_count: number }> }
        ).by_repository = { "repo-1": { pr_count: 999 } };

        const container = mountChart(rollups);
        installThroughputDrilldown(container, rollups, {
          filters: { repos: [], teams: [], reviewers: [], authors: [] },
          repositoriesDimension: BASE_REPOS,
          webContext: BASE_WEB_CTX,
          commentsMetricsAvailable: true,
        });
        click(firstBar(container));

        // Per-row sums from the single PR: 9 / 100 / 4.  Aggregate-
        // confused values (999) MUST NOT appear in any stat — that
        // would prove a slice-only-rule violation.
        expect(statValues()).toEqual(["9", "100", "4"]);
      });

      // ---------------------------------------------------------------
      // Commit 3 / Codex review follow-up — the stat row must gate on
      // the resolved ``PrListSection.contentState``, not on
      // ``rawPrs.length`` alone.  Without this gate, non-list
      // content-states (team-inline / reviewer-inline / supported-
      // empty) would still receive a week-totals header whose values
      // do not correspond to any visible row list.
      // ---------------------------------------------------------------

      it("is absent when a team filter is active (pr-list resolves to team-inline)", () => {
        const rollups = [
          buildPrsWithComments([
            {
              id: 1,
              title: "a",
              author_id: "alice",
              repository_id: "repo-1",
              cycle_time: 10,
              thread_count: 3,
              comment_count: 7,
              active_thread_count: 1,
            },
          ]),
        ];
        const container = mountChart(rollups);
        installThroughputDrilldown(container, rollups, {
          filters: { repos: [], teams: ["team-a"], reviewers: [], authors: [] },
          repositoriesDimension: BASE_REPOS,
          webContext: BASE_WEB_CTX,
          commentsMetricsAvailable: true,
        });
        click(firstBar(container));

        expect(statRowSection()).toBeNull();
        // PR-detail renders the team-inline gated message, not a list.
        // The stat row CANNOT appear above "Clear the team filter".
        const prSection = document.getElementById("pr-detail");
        expect(prSection!.getAttribute("data-content-state")).toBe(
          "team-inline",
        );
      });

      it("is absent when a reviewer filter is active (pr-list resolves to reviewer-inline)", () => {
        const rollups = [
          buildPrsWithComments([
            {
              id: 1,
              title: "a",
              author_id: "alice",
              repository_id: "repo-1",
              cycle_time: 10,
              thread_count: 3,
              comment_count: 7,
              active_thread_count: 1,
            },
          ]),
        ];
        const container = mountChart(rollups);
        installThroughputDrilldown(container, rollups, {
          filters: { repos: [], teams: [], reviewers: ["rev-a"], authors: [] },
          repositoriesDimension: BASE_REPOS,
          webContext: BASE_WEB_CTX,
          commentsMetricsAvailable: true,
        });
        click(firstBar(container));

        expect(statRowSection()).toBeNull();
        const prSection = document.getElementById("pr-detail");
        expect(prSection!.getAttribute("data-content-state")).toBe(
          "reviewer-inline",
        );
      });

      it("is absent when webContext is missing (pr-list resolves to supported-empty despite non-empty prs)", () => {
        // rawPrs.length > 0 but buildPrListSection falls to
        // ``supported-empty`` because the install did not pass a
        // webContext.  The pre-fix gate (``rawPrs.length > 0``) would
        // have emitted the stat row here; the post-fix gate
        // (``contentState === "pr-list"``) suppresses it.
        const rollups = [
          buildPrsWithComments([
            {
              id: 1,
              title: "a",
              author_id: "alice",
              repository_id: "repo-1",
              cycle_time: 10,
              thread_count: 3,
              comment_count: 7,
              active_thread_count: 1,
            },
          ]),
        ];
        const container = mountChart(rollups);
        installThroughputDrilldown(container, rollups, {
          filters: { repos: [], teams: [], reviewers: [], authors: [] },
          repositoriesDimension: BASE_REPOS,
          commentsMetricsAvailable: true,
        });
        click(firstBar(container));

        expect(statRowSection()).toBeNull();
        const prSection = document.getElementById("pr-detail");
        expect(prSection!.getAttribute("data-content-state")).toBe(
          "supported-empty",
        );
      });
    });
  });
});
