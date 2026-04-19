/**
 * Cycle-time drill-down unit tests (US2).
 *
 * Covers `extension/ui/modules/drilldown/cycle-time-drilldown.ts` per
 * `specs/059-chart-drill-down/contracts/drilldown-integration.md`:
 * delegated click activation on `.line-chart-dot` targets, keyboard
 * activation (Enter/Space), retarget-in-place between P50 and P90,
 * duration formatting via shared/format.formatDuration, per-repository
 * breakdown and empty-state fallback, comparison-mode advisory
 * routing, dispose semantics, and MutationObserver-backed
 * `is-drilldown-active` lifecycle.
 */

import { renderCycleTimeTrend } from "../../../ui/modules/charts/cycle-time";
import { installCycleTimeDrilldown } from "../../../ui/modules/drilldown/cycle-time-drilldown";
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
    start_date: "2025-03-17",
    end_date: "2025-03-23",
    pr_count: 42,
    cycle_time_p50: 60 * 4, // 4h
    cycle_time_p90: 60 * 18, // 18h
    authors_count: 5,
    reviewers_count: 3,
    by_repository: {
      "backend-api": {
        pr_count: 20,
        cycle_time_p50: 60 * 3,
        cycle_time_p90: 60 * 15,
      },
      frontend: {
        pr_count: 22,
        cycle_time_p50: 60 * 5,
        cycle_time_p90: 60 * 21,
      },
    },
    by_team: null,
    ...overrides,
  };
}

function makeRollupSeries(count: number, startWeek = 10): Rollup[] {
  return Array.from({ length: count }, (_, i) =>
    makeRollup({
      week: `2025-W${String(startWeek + i).padStart(2, "0")}`,
      pr_count: 30 + i,
      cycle_time_p50: 60 * (3 + i),
      cycle_time_p90: 60 * (12 + i * 2),
    }),
  );
}

function mountChart(rollups: Rollup[]): HTMLElement {
  const container = document.createElement("div");
  container.id = "cycle-time-trend";
  document.body.appendChild(container);
  renderCycleTimeTrend(container, rollups);
  return container;
}

function dotFor(
  container: HTMLElement,
  week: string,
  metric: "p50" | "p90",
): HTMLElement {
  // Drill-down attrs live on the <g> wrapper (PR #302 P1.D); the
  // visible <circle> keeps `.line-chart-dot` for tooltip/visual purposes.
  const dot = container.querySelector<HTMLElement>(
    `g[data-drilldown-week="${week}"][data-drilldown-metric="${metric}"]`,
  );
  if (!dot) throw new Error(`g[data-drilldown-week=${week}/${metric}] not rendered`);
  return dot;
}

/**
 * Stamp a synthetic drilldown trigger into the container. cycle-time's
 * line chart requires ≥2 P50/P90 points to render dots, so panel-
 * content assertions that want a specific single-rollup shape bypass
 * the chart and dispatch directly on a minimal `<button>` carrying
 * the contract's `data-drilldown-*` attributes. A11y / attribute-
 * surface tests still use real `.line-chart-dot` elements.
 */
function stampTrigger(
  container: HTMLElement,
  week: string,
  metric: "p50" | "p90",
): HTMLElement {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.setAttribute("data-drilldown-week", week);
  trigger.setAttribute("data-drilldown-metric", metric);
  container.appendChild(trigger);
  return trigger;
}

function click(target: HTMLElement): void {
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("cycle-time-drilldown", () => {
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
  // Activation
  // -------------------------------------------------------------------------

  it("click on a P50 dot opens the panel with a P50-focused title and stat row", () => {
    const rollups = makeRollupSeries(4);
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);

    click(dotFor(container, "2025-W10", "p50"));

    expect(isDetailPanelOpen()).toBe(true);
    const title = document.querySelector("#detail-panel-title")!.textContent;
    expect(title).toMatch(/^Week of /);
    expect(title).toMatch(/— P50$/);
    const stats = Array.from(document.querySelectorAll("dl dt")).map(
      (dt) => dt.textContent,
    );
    expect(stats).toEqual(["P50", "P90"]);
  });

  it("click on a P90 dot opens the panel with a P90-focused title", () => {
    const rollups = makeRollupSeries(4);
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);

    click(dotFor(container, "2025-W10", "p90"));

    const title = document.querySelector("#detail-panel-title")!.textContent;
    expect(title).toMatch(/— P90$/);
  });

  it("clicking P90 on the same week retargets the panel in place (stays open)", () => {
    const rollups = makeRollupSeries(4);
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);

    click(dotFor(container, "2025-W10", "p50"));
    expect(document.querySelectorAll("aside.detail-panel.is-open").length).toBe(
      1,
    );
    const titleAfterP50 = document.querySelector(
      "#detail-panel-title",
    )!.textContent;

    click(dotFor(container, "2025-W10", "p90"));

    expect(document.querySelectorAll("aside.detail-panel.is-open").length).toBe(
      1,
    );
    expect(document.querySelector("#detail-panel-title")!.textContent).not.toBe(
      titleAfterP50,
    );
  });

  // -------------------------------------------------------------------------
  // Panel content shape
  // -------------------------------------------------------------------------

  it("stat row renders P50/P90 via formatDuration", () => {
    const rollups = [
      makeRollup({
        cycle_time_p50: 240, // 4h
        cycle_time_p90: 60 * 48, // 48h -> 2.0d
      }),
    ];
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);

    click(stampTrigger(container, "2025-W12", "p50"));

    const values = Array.from(document.querySelectorAll("dl dd")).map(
      (dd) => dd.textContent,
    );
    // formatDuration: 240m -> "4.0h", 2880m -> "2.0d"
    expect(values).toEqual(["4.0h", "2.0d"]);
  });

  it("null P50/P90 render as em-dash", () => {
    const rollups = [
      makeRollup({ cycle_time_p50: null, cycle_time_p90: null }),
    ];
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);

    click(stampTrigger(container, "2025-W12", "p50"));

    const values = Array.from(document.querySelectorAll("dl dd")).map(
      (dd) => dd.textContent,
    );
    expect(values).toEqual(["—", "—"]);
  });

  it("per-repository BreakdownTable renders P50/P90 from by_repository", () => {
    const rollups = makeRollupSeries(4);
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);

    click(dotFor(container, "2025-W10", "p50"));

    const breakdownSection = document.querySelector(
      ".detail-panel-section--breakdown-table",
    );
    expect(breakdownSection).not.toBeNull();
    const headers = Array.from(
      breakdownSection!.querySelectorAll("thead th"),
    ).map((th) => th.textContent);
    expect(headers).toEqual(["Repository", "P50", "P90"]);
    const rows = Array.from(breakdownSection!.querySelectorAll("tbody tr")).map(
      (tr) =>
        Array.from(tr.querySelectorAll("th, td")).map((c) => c.textContent),
    );
    // Sorted desc by pr_count: frontend (22), backend-api (20).
    expect(rows[0]![0]).toBe("frontend");
    expect(rows[1]![0]).toBe("backend-api");
  });

  it("empty by_repository renders an EmptyStateSection (not an empty table)", () => {
    const rollups = [makeRollup({ by_repository: {} })];
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);

    click(stampTrigger(container, "2025-W12", "p50"));

    expect(
      document.querySelectorAll(".detail-panel-section--empty-state").length,
    ).toBe(1);
    expect(
      document.querySelectorAll(".detail-panel-section--breakdown-table")
        .length,
    ).toBe(0);
  });

  it("null by_repository renders an EmptyStateSection", () => {
    const rollups = [makeRollup({ by_repository: null })];
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);

    click(stampTrigger(container, "2025-W12", "p50"));

    expect(
      document.querySelectorAll(".detail-panel-section--empty-state").length,
    ).toBe(1);
  });

  it("per-repository rows with null cycle times render em-dash cells", () => {
    const rollups = [
      makeRollup({
        by_repository: {
          partial: {
            pr_count: 5,
            cycle_time_p50: null,
            cycle_time_p90: null,
          },
        },
      }),
    ];
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);

    click(stampTrigger(container, "2025-W12", "p50"));

    const cells = Array.from(document.querySelectorAll("tbody tr td")).map(
      (td) => td.textContent,
    );
    expect(cells).toEqual(["—", "—"]);
  });

  // -------------------------------------------------------------------------
  // Class lifecycle / MutationObserver
  // -------------------------------------------------------------------------

  it("adds is-drilldown-active to the clicked dot and clears it on dismiss", async () => {
    const rollups = makeRollupSeries(4);
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);
    const dot = dotFor(container, "2025-W10", "p50");

    click(dot);
    expect(dot.classList.contains("is-drilldown-active")).toBe(true);

    dismissDetailPanel("explicit-close-button");
    await Promise.resolve();

    expect(dot.classList.contains("is-drilldown-active")).toBe(false);
  });

  it("retarget moves is-drilldown-active from the previous dot to the new one", () => {
    const rollups = makeRollupSeries(4);
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);
    const p50Dot = dotFor(container, "2025-W10", "p50");
    const p90Dot = dotFor(container, "2025-W10", "p90");

    click(p50Dot);
    expect(p50Dot.classList.contains("is-drilldown-active")).toBe(true);

    click(p90Dot);

    expect(p50Dot.classList.contains("is-drilldown-active")).toBe(false);
    expect(p90Dot.classList.contains("is-drilldown-active")).toBe(true);
  });

  it("dispose() mid-open clears is-drilldown-active and disconnects the observer", async () => {
    const rollups = makeRollupSeries(4);
    const container = mountChart(rollups);
    const handle = installCycleTimeDrilldown(container, rollups);
    const dot = dotFor(container, "2025-W10", "p50");

    click(dot);
    expect(dot.classList.contains("is-drilldown-active")).toBe(true);

    handle.dispose();

    expect(dot.classList.contains("is-drilldown-active")).toBe(false);
    dismissDetailPanel("explicit-close-button");
    await Promise.resolve();
    expect(dot.classList.contains("is-drilldown-active")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  it("dispose() detaches listeners — subsequent click does not open panel", () => {
    const rollups = makeRollupSeries(4);
    const container = mountChart(rollups);
    const handle = installCycleTimeDrilldown(container, rollups);

    handle.dispose();
    click(dotFor(container, "2025-W10", "p50"));

    expect(isDetailPanelOpen()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Comparison advisory routing + tooltip dismissal
  // -------------------------------------------------------------------------

  it("routes to comparison advisory toast when comparison mode is active", () => {
    const rollups = makeRollupSeries(4);
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);

    publishComparisonToggled({ enabled: true });
    click(dotFor(container, "2025-W10", "p50"));

    expect(isDetailPanelOpen()).toBe(false);
    expect(document.querySelector(".comparison-advisory-toast")).not.toBeNull();
  });

  it("dismisses any active chart tooltip when the drill-down opens", () => {
    const rollups = makeRollupSeries(4);
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);
    const dot = dotFor(container, "2025-W10", "p50");
    // Tooltip listener targets [data-tooltip], which lives on the inner
    // <circle> (PR #302 P1.D — drill-down attrs moved to <g>, tooltip
    // attrs stayed on <circle> so the tooltip anchor still matches the
    // visible dot rather than the invisible 24x24 hit-rect bounding box).
    const visibleCircle = dot.querySelector<SVGCircleElement>(
      "circle.line-chart-dot",
    )!;

    visibleCircle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    visibleCircle.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    expect(document.querySelector(".chart-tooltip")).not.toBeNull();

    click(dot);

    expect(isDetailPanelOpen()).toBe(true);
    expect(document.querySelector(".chart-tooltip")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Keyboard activation (independent of pointer path)
  // -------------------------------------------------------------------------

  it("keyboard Enter on a focused dot opens the panel", () => {
    const rollups = makeRollupSeries(4);
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);

    dotFor(container, "2025-W10", "p50").dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }),
    );

    expect(isDetailPanelOpen()).toBe(true);
  });

  it("keyboard Space opens the panel and calls preventDefault on the event", () => {
    const rollups = makeRollupSeries(4);
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);

    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: " ",
    });
    dotFor(container, "2025-W10", "p50").dispatchEvent(event);

    expect(isDetailPanelOpen()).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  // -------------------------------------------------------------------------
  // A11y attribute surface
  // -------------------------------------------------------------------------

  it("dot triggers expose a button-role focusable <g> and orthogonal visual <circle>", () => {
    const rollups = makeRollupSeries(4);
    const container = mountChart(rollups);
    const dot = dotFor(container, "2025-W10", "p50");

    // Activation surface lives on the <g> wrapper (PR #302 P1.D).
    expect(dot.tagName.toLowerCase()).toBe("g");
    expect(dot.getAttribute("tabindex")).toBe("0");
    expect(dot.getAttribute("role")).toBe("button");
    expect(dot.getAttribute("data-drilldown-metric")).toBe("p50");
    expect(dot.getAttribute("aria-expanded")).toBe("false");

    // Visual surface stays on the inner <circle>; the legacy uppercase
    // data-metric attribute is read by the tooltip layer and remains on
    // the circle so the tooltip's bounding-rect anchor matches the dot
    // and not the larger 24x24 hit-rect.
    const visibleCircle = dot.querySelector<SVGCircleElement>(
      "circle.line-chart-dot",
    );
    expect(visibleCircle).not.toBeNull();
    expect(visibleCircle!.getAttribute("data-metric")).toBe("P50");
    expect(visibleCircle!.getAttribute("data-tooltip")).toBe("true");
  });

  // -------------------------------------------------------------------------
  // Rerender sequence (mirror dashboard.ts flow)
  // -------------------------------------------------------------------------

  it("after dispose→reinstall across a rerender only the newly-clicked dot is active", async () => {
    const rollups = makeRollupSeries(4);
    const container = mountChart(rollups);
    let handle = installCycleTimeDrilldown(container, rollups);

    click(dotFor(container, "2025-W10", "p50"));
    expect(
      dotFor(container, "2025-W10", "p50").classList.contains(
        "is-drilldown-active",
      ),
    ).toBe(true);

    publishFiltersChanged({ reason: "user-change" });
    await Promise.resolve();
    handle.dispose();

    handle = installCycleTimeDrilldown(container, rollups);
    click(dotFor(container, "2025-W11", "p90"));

    expect(document.querySelectorAll("aside.detail-panel.is-open").length).toBe(
      1,
    );
    const active = Array.from(
      document.querySelectorAll<HTMLElement>(".is-drilldown-active"),
    );
    expect(active.length).toBe(1);
    expect(active[0]).toBe(dotFor(container, "2025-W11", "p90"));

    handle.dispose();
  });

  // -------------------------------------------------------------------------
  // Coverage hardening — early-return branches
  // -------------------------------------------------------------------------

  it("click on the container outside any dot is ignored", () => {
    const rollups = makeRollupSeries(4);
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);

    click(container);

    expect(isDetailPanelOpen()).toBe(false);
  });

  it("keydown outside any dot (on the container) is ignored", () => {
    const rollups = makeRollupSeries(4);
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);

    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }),
    );

    expect(isDetailPanelOpen()).toBe(false);
  });

  it("keydown with an unrelated key on a dot is ignored", () => {
    const rollups = makeRollupSeries(4);
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);

    dotFor(container, "2025-W10", "p50").dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      }),
    );

    expect(isDetailPanelOpen()).toBe(false);
  });

  it("trigger with an unrecognized metric attribute is a no-op", () => {
    const rollups = makeRollupSeries(4);
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);

    const synthetic = document.createElement("button");
    synthetic.setAttribute("data-drilldown-week", "2025-W10");
    synthetic.setAttribute("data-drilldown-metric", "p99"); // not p50/p90
    container.appendChild(synthetic);

    click(synthetic);

    expect(isDetailPanelOpen()).toBe(false);
  });

  it("empty data-drilldown-week attribute is a no-op", () => {
    const rollups = makeRollupSeries(4);
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);
    const dot = dotFor(container, "2025-W10", "p50");
    dot.setAttribute("data-drilldown-week", "");

    click(dot);

    expect(isDetailPanelOpen()).toBe(false);
  });

  it("subtitle uses singular 'PR' when pr_count is 1", () => {
    const rollups = [makeRollup({ pr_count: 1 })];
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);

    click(stampTrigger(container, "2025-W12", "p50"));

    expect(document.querySelector(".detail-panel-subtitle")!.textContent).toBe(
      "1 PR",
    );
  });

  it("panel class mutation that keeps is-open leaves is-drilldown-active intact", async () => {
    const rollups = makeRollupSeries(4);
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);
    const dot = dotFor(container, "2025-W10", "p50");

    click(dot);
    const panel = document.querySelector<HTMLElement>("aside.detail-panel")!;
    panel.classList.add("a-non-open-class");
    await Promise.resolve();

    expect(dot.classList.contains("is-drilldown-active")).toBe(true);
  });

  it("dot whose week is not in the rollups slice is a no-op", () => {
    const rollups = makeRollupSeries(4);
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);
    const dot = dotFor(container, "2025-W10", "p50");
    dot.setAttribute("data-drilldown-week", "2099-W42");

    click(dot);

    expect(isDetailPanelOpen()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Comparison-mode keyboard guard (PR #302 P1.E checklist)
  // -------------------------------------------------------------------------

  it("keyboard Enter in comparison mode opens the advisory toast, NOT the panel", () => {
    const rollups = makeRollupSeries(4);
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups);

    publishComparisonToggled({ enabled: true });
    dotFor(container, "2025-W10", "p50").dispatchEvent(
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
    it("renders aria-expanded='false' on every <g> dot trigger at install time", () => {
      const rollups = makeRollupSeries(4);
      const container = mountChart(rollups);
      installCycleTimeDrilldown(container, rollups);

      const triggers = container.querySelectorAll<HTMLElement>(
        "g[data-drilldown-week][data-drilldown-metric]",
      );
      expect(triggers.length).toBeGreaterThan(0);
      for (const trigger of Array.from(triggers)) {
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
      }
    });

    it("flips aria-expanded='true' on the activated <g> when the panel opens", () => {
      const rollups = makeRollupSeries(4);
      const container = mountChart(rollups);
      installCycleTimeDrilldown(container, rollups);
      const dot = dotFor(container, "2025-W10", "p50");

      click(dot);

      expect(isDetailPanelOpen()).toBe(true);
      expect(dot.getAttribute("aria-expanded")).toBe("true");
    });

    it("retargeting from p50 to p90 updates aria-expanded on both dots", () => {
      const rollups = makeRollupSeries(4);
      const container = mountChart(rollups);
      installCycleTimeDrilldown(container, rollups);
      const p50 = dotFor(container, "2025-W10", "p50");
      const p90 = dotFor(container, "2025-W10", "p90");

      click(p50);
      expect(p50.getAttribute("aria-expanded")).toBe("true");
      expect(p90.getAttribute("aria-expanded")).toBe("false");

      // Retargeting goes through clearActive() synchronously inside
      // activate() (no observer needed for the swap), so both attrs
      // settle in the same tick.
      click(p90);
      expect(p50.getAttribute("aria-expanded")).toBe("false");
      expect(p90.getAttribute("aria-expanded")).toBe("true");
    });

    it("resets aria-expanded='false' on the trigger via every dismiss path through clearActive", async () => {
      const rollups = makeRollupSeries(4);
      const container = mountChart(rollups);
      installCycleTimeDrilldown(container, rollups);
      const dot = dotFor(container, "2025-W10", "p50");

      click(dot);
      expect(dot.getAttribute("aria-expanded")).toBe("true");

      dismissDetailPanel("explicit-close-button");
      // MutationObserver on panel.is-open is async — let the microtask
      // run so clearActive fires and resets aria-expanded.
      await Promise.resolve();
      expect(dot.getAttribute("aria-expanded")).toBe("false");
    });
  });
});
