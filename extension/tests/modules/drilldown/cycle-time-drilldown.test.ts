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

import * as path from "node:path";

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
import type { PrRecord } from "../../../ui/schemas/rollup.schema";
import { readJsonFile } from "../../helpers/fs-test-utils";

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
  if (!dot)
    throw new Error(`g[data-drilldown-week=${week}/${metric}] not rendered`);
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

  // -------------------------------------------------------------------------
  // Feature 361 — PR-detail section rendering
  // -------------------------------------------------------------------------
  describe("PR list section (feature 361)", () => {
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

    function makePr(
      id: number,
      cycleMinutes: number,
      title?: string,
    ): PrRecord {
      return {
        id,
        title: title ?? `PR ${id}`,
        author_id: "alice",
        repository_id: "repo-1",
        cycle_time: cycleMinutes,
      };
    }

    function makeRollupWithPrs(
      week: string,
      prs: ReadonlyArray<PrRecord>,
      overrides: Partial<Rollup> = {},
    ): Rollup {
      return makeRollup({
        week,
        pr_count: prs.length,
        prs,
        _prs_truncated: false,
        _prs_cap: 500,
        ...overrides,
      });
    }

    function supportedOptions(): {
      filters: {
        repos: string[];
        teams: string[];
        reviewers: string[];
        authors: string[];
      };
      repositoriesDimension: typeof BASE_REPOS;
      webContext: typeof BASE_WEB_CTX;
      authorsDimension: never[];
    } {
      // Intentionally omits `commentsMetricsAvailable` so the helper
      // exercises the default-fallback branch in `buildPrListSection`
      // (`options.commentsMetricsAvailable ?? false`). Tests that need
      // to assert the capability-on or explicit-false path pass the
      // flag inline instead of using this helper.
      return {
        filters: { repos: [], teams: [], reviewers: [], authors: [] },
        repositoriesDimension: BASE_REPOS,
        webContext: BASE_WEB_CTX,
        authorsDimension: [],
      };
    }

    // T009 — supported state renders the pr-list content state.
    it("renders a PR list section under the supported filter classification (FR-001)", () => {
      const rollups = [
        makeRollup({ week: "2025-W10" }),
        makeRollupWithPrs("2025-W11", [
          makePr(101, 600, "feat: oauth"),
          makePr(102, 200, "fix: null guard"),
        ]),
      ];
      const container = mountChart(rollups);
      installCycleTimeDrilldown(container, rollups, supportedOptions());

      click(dotFor(container, "2025-W11", "p90"));

      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      expect(prSection!.getAttribute("data-content-state")).toBe("pr-list");
      expect(prSection!.querySelector("h3")!.textContent).toBe("Pull requests");
      const rowLinks = prSection!.querySelectorAll<HTMLAnchorElement>(
        "ol li .detail-panel-pr-link",
      );
      expect(rowLinks.length).toBe(2);
      expect(rowLinks[0]!.textContent).toContain("#101");
      expect(rowLinks[0]!.textContent).toContain("feat: oauth");
    });

    // T010 — section ordering: stat-row → per-repo breakdown → PR list.
    it("renders panel sections in stat-row → per-repo-breakdown → pr-list order (FR-002)", () => {
      const rollups = [
        makeRollup({ week: "2025-W10" }),
        makeRollupWithPrs("2025-W11", [makePr(1, 100)]),
      ];
      const container = mountChart(rollups);
      installCycleTimeDrilldown(container, rollups, supportedOptions());

      click(dotFor(container, "2025-W11", "p50"));

      const sections = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".detail-panel-sections > section",
        ),
      );
      expect(sections.length).toBe(3);
      expect(
        sections[0]!.classList.contains("detail-panel-section--stat-row"),
      ).toBe(true);
      expect(
        sections[1]!.classList.contains(
          "detail-panel-section--breakdown-table",
        ),
      ).toBe(true);
      expect(sections[2]!.id).toBe("pr-detail");
      expect(sections[2]!.getAttribute("data-content-state")).toBe("pr-list");
    });

    // T012 — PR row click opens URL in new tab and leaves panel state intact.
    it("PR row exposes target=_blank + composed URL and clicking does not dismiss the panel (FR-004)", () => {
      const rollups = [
        makeRollup({ week: "2025-W10" }),
        makeRollupWithPrs("2025-W11", [makePr(101, 600, "feat: oauth")]),
      ];
      const container = mountChart(rollups);
      installCycleTimeDrilldown(container, rollups, supportedOptions());

      click(dotFor(container, "2025-W11", "p90"));
      expect(isDetailPanelOpen()).toBe(true);

      const link = document.querySelector<HTMLAnchorElement>(
        "#pr-detail ol li .detail-panel-pr-link",
      );
      expect(link).not.toBeNull();
      expect(link!.getAttribute("target")).toBe("_blank");
      expect(link!.getAttribute("rel")).toContain("noopener");
      expect(link!.getAttribute("href")).toBe(
        "https://dev.azure.com/acme/Frontend/_git/web-app/pullrequest/101",
      );

      // Click the row link. target=_blank delegates navigation to a new
      // browser tab; jsdom does not actually open one but the click event
      // MUST NOT dismiss the panel (no internal close path is wired to
      // PR-row clicks).
      click(link!);
      expect(isDetailPanelOpen()).toBe(true);
    });

    // T015b — capability-on path: rows carry thread / comment / active
    // counts AND the PrRecord triplet is threaded through unchanged
    // (FR-015). Covers the capability-on branch of buildPrListSection's
    // row construction, which is the symmetric counterpart to T024's
    // capability-off byte-identity baseline.
    it("commentsMetricsAvailable=true threads thread/comment/active counts onto each PR row (FR-015)", () => {
      const prs: PrRecord[] = [
        {
          id: 101,
          title: "feat: oauth",
          author_id: "alice",
          repository_id: "repo-1",
          cycle_time: 800,
          thread_count: 5,
          comment_count: 17,
          active_thread_count: 2,
        },
        {
          id: 102,
          title: "fix: null guard",
          author_id: "bob",
          repository_id: "repo-1",
          cycle_time: 200,
          thread_count: 1,
          comment_count: 3,
          active_thread_count: 0,
        },
      ];
      const rollups = [
        makeRollup({ week: "2025-W10" }),
        makeRollupWithPrs("2025-W11", prs),
      ];
      const container = mountChart(rollups);
      installCycleTimeDrilldown(container, rollups, {
        ...supportedOptions(),
        commentsMetricsAvailable: true,
      });

      click(dotFor(container, "2025-W11", "p90"));

      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      expect(prSection!.getAttribute("data-content-state")).toBe("pr-list");
      // Capability-on `<ol>` carries the modifier class (the shared
      // renderer attaches it; cycle-time consumer just opts in).
      const list = prSection!.querySelector<HTMLOListElement>(
        "ol.detail-panel-pr-list",
      );
      expect(list).not.toBeNull();
      expect(
        list!.classList.contains("detail-panel-pr-list--with-comments"),
      ).toBe(true);

      // Per-row data attributes carry the triplet — read by the
      // renderer's sort/filter controls.
      const rows = list!.querySelectorAll<HTMLLIElement>("li");
      expect(rows.length).toBe(2);
      expect(rows[0]!.getAttribute("data-threads")).toBe("5");
      expect(rows[0]!.getAttribute("data-comments")).toBe("17");
      expect(rows[0]!.getAttribute("data-unresolved")).toBe("2");
      expect(rows[1]!.getAttribute("data-threads")).toBe("1");
      expect(rows[1]!.getAttribute("data-comments")).toBe("3");
      expect(rows[1]!.getAttribute("data-unresolved")).toBe("0");
    });

    // T013 — same week P50/P90 share the PR list set; only the headline swaps.
    it("P50 and P90 on the same week share the same PR list set; only the metric headline swaps (FR-005, FR-014)", () => {
      const rollups = [
        makeRollup({ week: "2025-W10" }),
        makeRollupWithPrs("2025-W11", [
          makePr(101, 800, "slowest"),
          makePr(102, 200, "fast"),
        ]),
      ];
      const container = mountChart(rollups);
      installCycleTimeDrilldown(container, rollups, supportedOptions());

      // Open the panel via the P90 dot.
      click(dotFor(container, "2025-W11", "p90"));
      const titleAfterP90 = document.querySelector(
        "#detail-panel-title",
      )!.textContent;
      expect(titleAfterP90).toMatch(/— P90$/);
      const rowsAfterP90 = Array.from(
        document.querySelectorAll<HTMLAnchorElement>(
          "#pr-detail ol li .detail-panel-pr-link",
        ),
      ).map((a) => a.getAttribute("href"));
      expect(rowsAfterP90.length).toBe(2);

      // Retarget to P50 on the same week without dismissing.
      click(dotFor(container, "2025-W11", "p50"));
      const titleAfterP50 = document.querySelector(
        "#detail-panel-title",
      )!.textContent;
      expect(titleAfterP50).toMatch(/— P50$/);
      expect(titleAfterP50).not.toBe(titleAfterP90);

      const rowsAfterP50 = Array.from(
        document.querySelectorAll<HTMLAnchorElement>(
          "#pr-detail ol li .detail-panel-pr-link",
        ),
      ).map((a) => a.getAttribute("href"));
      // Same set in the same order — retarget preserves the underlying PR list.
      expect(rowsAfterP50).toEqual(rowsAfterP90);
      // Panel stayed open across the retarget (no close-then-reopen flicker).
      expect(
        document.querySelectorAll("aside.detail-panel.is-open").length,
      ).toBe(1);
    });

    // -----------------------------------------------------------------------
    // US2 — Filter classification regression locks (T015-T018)
    // -----------------------------------------------------------------------

    // T015 — team-only filter renders the team-inline content state.
    it("team-only filter renders the team-inline message and not the PR list (FR-006)", () => {
      const rollups = [
        makeRollup({ week: "2025-W10" }),
        makeRollupWithPrs("2025-W11", [makePr(101, 600)]),
      ];
      const container = mountChart(rollups);
      installCycleTimeDrilldown(container, rollups, {
        ...supportedOptions(),
        filters: {
          repos: [],
          teams: ["platform-core"],
          reviewers: [],
          authors: [],
        },
      });

      click(dotFor(container, "2025-W11", "p90"));

      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      expect(prSection!.getAttribute("data-content-state")).toBe("team-inline");
      const gated = prSection!.querySelector(".pr-detail-gated");
      expect(gated).not.toBeNull();
      expect(gated!.textContent ?? "").toMatch(/team/i);
      expect(prSection!.querySelector("ol")).toBeNull();
    });

    // T016 — reviewer-only filter renders the reviewer-inline content state.
    it("reviewer-only filter renders the reviewer-inline message and not the PR list (FR-007)", () => {
      const rollups = [
        makeRollup({ week: "2025-W10" }),
        makeRollupWithPrs("2025-W11", [makePr(101, 600)]),
      ];
      const container = mountChart(rollups);
      installCycleTimeDrilldown(container, rollups, {
        ...supportedOptions(),
        filters: {
          repos: [],
          teams: [],
          reviewers: ["reviewer-007"],
          authors: [],
        },
      });

      click(dotFor(container, "2025-W11", "p90"));

      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      expect(prSection!.getAttribute("data-content-state")).toBe(
        "reviewer-inline",
      );
      const gated = prSection!.querySelector(".pr-detail-gated");
      expect(gated).not.toBeNull();
      expect(gated!.textContent ?? "").toMatch(/reviewer/i);
      expect(prSection!.querySelector("ol")).toBeNull();
    });

    // T017 — author / repo / author+repo combinations all render the PR list.
    it("author-only / repo-only / author+repo filter combinations all render the PR list (FR-008)", () => {
      const subs: Array<{
        readonly label: string;
        readonly filters: {
          repos: string[];
          teams: string[];
          reviewers: string[];
          authors: string[];
        };
      }> = [
        {
          label: "author-only",
          filters: { repos: [], teams: [], reviewers: [], authors: ["alice"] },
        },
        {
          label: "repo-only",
          filters: { repos: ["repo-1"], teams: [], reviewers: [], authors: [] },
        },
        {
          label: "author+repo",
          filters: {
            repos: ["repo-1"],
            teams: [],
            reviewers: [],
            authors: ["alice"],
          },
        },
      ];

      for (const sub of subs) {
        // Reset between sub-cases — same install/dismiss/install pattern as
        // the dashboard's refresh cycle.
        if (isDetailPanelOpen()) dismissDetailPanel("explicit-close-button");
        document.body.innerHTML = "";

        const rollups = [
          makeRollup({ week: "2025-W10" }),
          makeRollupWithPrs("2025-W11", [makePr(101, 600), makePr(102, 200)]),
        ];
        const container = mountChart(rollups);
        installCycleTimeDrilldown(container, rollups, {
          ...supportedOptions(),
          filters: sub.filters,
        });

        click(dotFor(container, "2025-W11", "p90"));

        const prSection = document.getElementById("pr-detail");
        expect(prSection).not.toBeNull();
        // Each filter combination keeps the section in pr-list state and
        // renders both fixture rows.
        expect(prSection!.getAttribute("data-content-state")).toBe("pr-list");
        expect(prSection!.querySelectorAll("ol li").length).toBe(2);
      }
    });

    // T018 — comparison mode active denies the panel and fires the toast.
    it("comparison mode active denies the panel and fires the comparison-advisory toast (FR-009)", () => {
      const rollups = [
        makeRollup({ week: "2025-W10" }),
        makeRollupWithPrs("2025-W11", [makePr(101, 600)]),
      ];
      const container = mountChart(rollups);
      installCycleTimeDrilldown(container, rollups, supportedOptions());

      publishComparisonToggled({ enabled: true });
      click(dotFor(container, "2025-W11", "p90"));

      expect(isDetailPanelOpen()).toBe(false);
      expect(
        document.querySelector(".comparison-advisory-toast"),
      ).not.toBeNull();
      // PR-detail section is not constructed when activate() short-circuits
      // on comparison mode.
      expect(document.getElementById("pr-detail")).toBeNull();
    });

    // -----------------------------------------------------------------------
    // US3 — Honest signaling under truncation and unavailable-data states
    // (T019-T023)
    // -----------------------------------------------------------------------

    // T019 — truncation cue renders when _prs_truncated is true.
    it("truncation cue renders when _prs_truncated is true (FR-010)", () => {
      const prs = [makePr(101, 1500), makePr(102, 1200), makePr(103, 900)];
      const rollups = [
        makeRollup({ week: "2025-W10" }),
        makeRollupWithPrs("2025-W11", prs, {
          pr_count: 47,
          _prs_truncated: true,
          _prs_cap: 3,
        }),
      ];
      const container = mountChart(rollups);
      installCycleTimeDrilldown(container, rollups, supportedOptions());

      click(dotFor(container, "2025-W11", "p90"));

      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      expect(prSection!.getAttribute("data-content-state")).toBe("pr-list");

      const indicator = prSection!.querySelector(".truncation-indicator");
      expect(indicator).not.toBeNull();
      const indicatorText = indicator!.textContent ?? "";
      expect(indicatorText).toContain("3");
      expect(indicatorText).toContain("47");
    });

    // T020 — supported-empty when the week has zero qualified PRs.
    it("supported-empty renders when the week has zero qualified PRs (FR-011)", () => {
      // No `prs` field at all (rollup predates feature 060) — same as throughput.
      const rollups = [
        makeRollup({ week: "2025-W10" }),
        makeRollup({ week: "2025-W11", pr_count: 0 }),
      ];
      const container = mountChart(rollups);
      installCycleTimeDrilldown(container, rollups, supportedOptions());

      click(dotFor(container, "2025-W11", "p90"));

      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      expect(prSection!.getAttribute("data-content-state")).toBe(
        "supported-empty",
      );
      // No row list rendered in supported-empty.
      expect(prSection!.querySelector("ol")).toBeNull();
    });

    // T021 — supported-empty when webContext is absent (no URL composer).
    it("supported-empty renders when webContext is absent (FR-011)", () => {
      const rollups = [
        makeRollup({ week: "2025-W10" }),
        makeRollupWithPrs("2025-W11", [makePr(101, 600)]),
      ];
      const container = mountChart(rollups);
      installCycleTimeDrilldown(container, rollups, {
        ...supportedOptions(),
        webContext: undefined,
      });

      click(dotFor(container, "2025-W11", "p90"));

      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      expect(prSection!.getAttribute("data-content-state")).toBe(
        "supported-empty",
      );
      expect(prSection!.querySelector("ol")).toBeNull();
    });

    // T022 — supported-empty when _prs_cap is missing (malformed rollup).
    it("supported-empty renders when _prs_cap is missing from the rollup (FR-011)", () => {
      const rollups = [
        makeRollup({ week: "2025-W10" }),
        makeRollupWithPrs("2025-W11", [makePr(101, 600)], {
          _prs_cap: undefined,
        }),
      ];
      const container = mountChart(rollups);
      installCycleTimeDrilldown(container, rollups, supportedOptions());

      click(dotFor(container, "2025-W11", "p90"));

      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      expect(prSection!.getAttribute("data-content-state")).toBe(
        "supported-empty",
      );
    });

    // -----------------------------------------------------------------------
    // Accessibility & keyboard (T025-T027)
    // -----------------------------------------------------------------------

    describe("accessible name stability across content states (FR-012)", () => {
      function accessibleName(prSection: HTMLElement): string {
        const labelledByAttr = prSection.getAttribute("aria-labelledby");
        if (labelledByAttr === null || labelledByAttr.length === 0) {
          throw new Error(
            "pr-detail section missing aria-labelledby — accessible name cannot be resolved",
          );
        }
        const labelEl = document.getElementById(labelledByAttr);
        if (labelEl === null) {
          throw new Error(
            `aria-labelledby points at "${labelledByAttr}" but element is missing`,
          );
        }
        return (labelEl.textContent ?? "").trim();
      }

      // T025 — accessible name MUST be identical across the four content states.
      it("section accessible name is identical across pr-list, supported-empty, team-inline, reviewer-inline", () => {
        const cases: Array<{
          readonly label: string;
          readonly options: Parameters<typeof installCycleTimeDrilldown>[2];
          readonly rollupOverride: Partial<Rollup>;
          readonly expectedState:
            | "pr-list"
            | "supported-empty"
            | "team-inline"
            | "reviewer-inline";
        }> = [
          {
            label: "pr-list",
            options: supportedOptions(),
            rollupOverride: {
              prs: [makePr(101, 600), makePr(102, 200)],
              pr_count: 2,
              _prs_truncated: false,
              _prs_cap: 500,
            },
            expectedState: "pr-list",
          },
          {
            label: "supported-empty",
            options: supportedOptions(),
            rollupOverride: { pr_count: 0 },
            expectedState: "supported-empty",
          },
          {
            label: "team-inline",
            options: {
              ...supportedOptions(),
              filters: {
                repos: [],
                teams: ["platform-core"],
                reviewers: [],
                authors: [],
              },
            },
            rollupOverride: {
              prs: [makePr(101, 600)],
              pr_count: 1,
              _prs_truncated: false,
              _prs_cap: 500,
            },
            expectedState: "team-inline",
          },
          {
            label: "reviewer-inline",
            options: {
              ...supportedOptions(),
              filters: {
                repos: [],
                teams: [],
                reviewers: ["reviewer-007"],
                authors: [],
              },
            },
            rollupOverride: {
              prs: [makePr(101, 600)],
              pr_count: 1,
              _prs_truncated: false,
              _prs_cap: 500,
            },
            expectedState: "reviewer-inline",
          },
        ];

        const collected: string[] = [];
        for (const c of cases) {
          if (isDetailPanelOpen()) dismissDetailPanel("explicit-close-button");
          document.body.innerHTML = "";

          const rollups = [
            makeRollup({ week: "2025-W10" }),
            makeRollup({ week: "2025-W11", ...c.rollupOverride }),
          ];
          const container = mountChart(rollups);
          installCycleTimeDrilldown(container, rollups, c.options);

          click(dotFor(container, "2025-W11", "p90"));

          const prSection = document.getElementById("pr-detail");
          expect(prSection).not.toBeNull();
          expect(prSection!.getAttribute("data-content-state")).toBe(
            c.expectedState,
          );
          collected.push(accessibleName(prSection!));
        }

        // All four content states resolve to the same accessible name —
        // the section identity is content-state-stable.
        expect(new Set(collected).size).toBe(1);
        expect(collected[0]!.length).toBeGreaterThan(0);
      });
    });

    describe("keyboard activation + Tab reachability (FR-013)", () => {
      // T026 — Enter on a focused cycle-time dot opens the panel with the PR list.
      it("keyboard Enter on a focused cycle-time dot opens the panel with the PR list rendered", () => {
        const rollups = [
          makeRollup({ week: "2025-W10" }),
          makeRollupWithPrs("2025-W11", [makePr(101, 600), makePr(102, 200)]),
        ];
        const container = mountChart(rollups);
        installCycleTimeDrilldown(container, rollups, supportedOptions());

        dotFor(container, "2025-W11", "p90").dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Enter",
          }),
        );

        expect(isDetailPanelOpen()).toBe(true);
        const prSection = document.getElementById("pr-detail");
        expect(prSection).not.toBeNull();
        expect(prSection!.getAttribute("data-content-state")).toBe("pr-list");
        expect(prSection!.querySelectorAll("ol li").length).toBe(2);
      });

      // T026 sentinel — Space additionally calls preventDefault to suppress
      // page scroll (mirrors the throughput equivalent + the existing
      // bare-Space test for the chart).
      it("keyboard Space on a focused cycle-time dot opens the panel with the PR list AND calls preventDefault", () => {
        const rollups = [
          makeRollup({ week: "2025-W10" }),
          makeRollupWithPrs("2025-W11", [makePr(101, 600)]),
        ];
        const container = mountChart(rollups);
        installCycleTimeDrilldown(container, rollups, supportedOptions());

        const event = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: " ",
        });
        dotFor(container, "2025-W11", "p90").dispatchEvent(event);

        expect(isDetailPanelOpen()).toBe(true);
        expect(event.defaultPrevented).toBe(true);
        const prSection = document.getElementById("pr-detail");
        expect(prSection).not.toBeNull();
        expect(prSection!.getAttribute("data-content-state")).toBe("pr-list");
      });

      // T027 — PR list rows reachable via Tab in DOM order.
      it("PR list rows are focusable anchors reachable via Tab in DOM order", () => {
        const rollups = [
          makeRollup({ week: "2025-W10" }),
          makeRollupWithPrs("2025-W11", [
            makePr(101, 800),
            makePr(102, 500),
            makePr(103, 200),
          ]),
        ];
        const container = mountChart(rollups);
        installCycleTimeDrilldown(container, rollups, supportedOptions());

        click(dotFor(container, "2025-W11", "p90"));

        const links = Array.from(
          document.querySelectorAll<HTMLAnchorElement>(
            "#pr-detail ol li .detail-panel-pr-link",
          ),
        );
        expect(links.length).toBe(3);

        // Every PR-row anchor is an `<a href=...>` — natively focusable
        // without an explicit tabindex (tabindex="0" or absent both
        // satisfy keyboard reachability for anchors with href).
        for (const link of links) {
          expect(link.tagName.toLowerCase()).toBe("a");
          expect(link.hasAttribute("href")).toBe(true);
          // Negative tabindex would remove from the tab order — must NOT
          // be present.
          const ti = link.getAttribute("tabindex");
          expect(ti === null || Number.parseInt(ti, 10) >= 0).toBe(true);
        }

        // Focus traversal in DOM order: focus each anchor sequentially,
        // confirm the active element advances row-by-row.
        let lastFocused: HTMLAnchorElement | null = null;
        for (const link of links) {
          link.focus();
          expect(document.activeElement).toBe(link);
          lastFocused = link;
        }
        // Final focus is on the last row (DOM-order traversal).
        expect(lastFocused).not.toBeNull();
        expect(document.activeElement).toBe(lastFocused);
      });
    });

    // T023 — published demo dataset renders the PR list normally.
    it("current published demo dataset renders the PR list with 151 rows (FR-001, US3 acceptance scenario 4)", () => {
      // Read the published demo rollup for 2025-W28 (verified at HEAD:
      // 151 PRs, _prs_cap=500, _prs_truncated=false). This pins the
      // spec's iteration-2 verification — if the demo strip work (#315)
      // ever lands and changes 2025-W28's shape, this test fires
      // immediately and forces a deliberate update.
      const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
      const ROLLUP_PATH = path.join(
        REPO_ROOT,
        "docs",
        "data",
        "aggregates",
        "weekly_rollups",
        "2025-W28.json",
      );
      const rollup = readJsonFile<Rollup>(ROLLUP_PATH);
      expect(rollup.prs?.length).toBe(151);

      const container = document.createElement("div");
      container.id = "cycle-time-trend";
      document.body.appendChild(container);
      installCycleTimeDrilldown(container, [rollup], {
        ...supportedOptions(),
        webContext: { collectionUri: "https://dev.azure.com/oddessentials/" },
      });

      // Use stampTrigger to bypass chart rendering (which requires ≥2
      // P50/P90 points). The drill-down's delegated click listener
      // resolves [data-drilldown-metric] regardless of the trigger's
      // tag, so the synthetic button exercises the same activate() path
      // a real chart dot would.
      click(stampTrigger(container, rollup.week, "p50"));

      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      expect(prSection!.getAttribute("data-content-state")).toBe("pr-list");
      expect(prSection!.querySelectorAll("ol li").length).toBe(151);
    });
  });
});
