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

  it("panel renders By-author breakdown rows from rollup.by_author (sorted desc)", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    const authorSection = document.querySelectorAll(
      ".detail-panel-section--breakdown-table",
    )[0]!;
    expect(authorSection.querySelector("h3")!.textContent).toBe("By author");
    const rowLabels = Array.from(
      authorSection.querySelectorAll("tbody th[scope='row']"),
    ).map((th) => th.textContent);
    expect(rowLabels).toEqual(["bob", "alice"]);
    const rowValues = Array.from(
      authorSection.querySelectorAll("tbody tr td"),
    ).map((td) => td.textContent);
    expect(rowValues).toEqual(["35", "12"]);
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
});
