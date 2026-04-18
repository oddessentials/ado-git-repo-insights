/**
 * Comparison-advisory unit tests.
 *
 * Covers
 * `extension/ui/modules/drilldown/comparison-advisory.ts` per
 * `specs/059-chart-drill-down/contracts/lifecycle-signals.md` and
 * research.md R-05 — the three-layer disabled-drill-down UX (chart
 * attribute, persistent banner, transient on-attempt toast).
 */

import {
  isDrilldownDisabledByComparison,
  showComparisonAdvisoryToast,
  __resetComparisonAdvisoryForTests,
} from "../../../ui/modules/drilldown/comparison-advisory";
import { COMPARISON_ADVISORY_TOAST_MS } from "../../../ui/modules/shared/constants";
import { publishComparisonToggled } from "../../../ui/modules/drilldown/lifecycle-signals";
import {
  openDetailPanel,
  dismissDetailPanel,
  isDetailPanelOpen,
  makePanelContent,
  makeStatRow,
  type DrillDownContext,
} from "../../../ui/modules/shared/detail-panel";

function scaffoldChartContainers(): {
  throughput: HTMLElement;
  cycleTime: HTMLElement;
  reviewer: HTMLElement;
  summaryCards: HTMLElement;
  comparisonBanner: HTMLElement;
} {
  const make = (id: string, className?: string): HTMLElement => {
    const el = document.createElement("div");
    if (id) el.id = id;
    if (className) el.className = className;
    document.body.appendChild(el);
    return el;
  };

  return {
    throughput: make("throughput-chart"),
    cycleTime: make("cycle-time-trend"),
    reviewer: make("reviewer-activity"),
    summaryCards: make("", "summary-cards"),
    comparisonBanner: make("comparison-banner", "comparison-banner"),
  };
}

function makeTrigger(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  document.body.appendChild(btn);
  return btn;
}

function makeContext(): DrillDownContext {
  return {
    sourceChart: "cycle-time",
    focusedData: { kind: "cycle-time", weekIso: "2025-W12", metric: "p50" },
    triggerElement: makeTrigger(),
    content: makePanelContent("t", null, [
      makeStatRow([{ label: "L", value: "V" }]),
    ]),
  };
}

describe("comparison-advisory — banner + attribute lifecycle", () => {
  beforeEach(() => {
    publishComparisonToggled({ enabled: false });
    __resetComparisonAdvisoryForTests();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    publishComparisonToggled({ enabled: false });
    __resetComparisonAdvisoryForTests();
    if (isDetailPanelOpen()) dismissDetailPanel("explicit-close-button");
    document.body.innerHTML = "";
  });

  it("mounts banner note and sets disabled attr on all four chart containers when comparison enables", () => {
    const { throughput, cycleTime, reviewer, summaryCards, comparisonBanner } =
      scaffoldChartContainers();

    publishComparisonToggled({ enabled: true });

    expect(isDrilldownDisabledByComparison()).toBe(true);
    expect(throughput.getAttribute("data-drilldown-disabled")).toBe(
      "comparison",
    );
    expect(cycleTime.getAttribute("data-drilldown-disabled")).toBe(
      "comparison",
    );
    expect(reviewer.getAttribute("data-drilldown-disabled")).toBe("comparison");
    expect(summaryCards.getAttribute("data-drilldown-disabled")).toBe(
      "comparison",
    );
    expect(
      comparisonBanner.querySelector(".comparison-advisory-banner"),
    ).not.toBeNull();
  });

  it("unmounts banner and clears attributes when comparison disables", () => {
    const containers = scaffoldChartContainers();
    publishComparisonToggled({ enabled: true });
    publishComparisonToggled({ enabled: false });

    expect(isDrilldownDisabledByComparison()).toBe(false);
    for (const el of [
      containers.throughput,
      containers.cycleTime,
      containers.reviewer,
      containers.summaryCards,
    ]) {
      expect(el.hasAttribute("data-drilldown-disabled")).toBe(false);
    }
    expect(
      containers.comparisonBanner.querySelector(".comparison-advisory-banner"),
    ).toBeNull();
  });

  it("dismisses any currently-open DetailPanel when comparison activates", () => {
    scaffoldChartContainers();
    openDetailPanel(makeContext());
    expect(isDetailPanelOpen()).toBe(true);

    publishComparisonToggled({ enabled: true });

    expect(isDetailPanelOpen()).toBe(false);
  });

  it("banner mount is idempotent on repeat enable events", () => {
    const { comparisonBanner } = scaffoldChartContainers();

    publishComparisonToggled({ enabled: true });
    publishComparisonToggled({ enabled: true });

    const banners = comparisonBanner.querySelectorAll(
      ".comparison-advisory-banner",
    );
    expect(banners.length).toBe(1);
  });
});

describe("comparison-advisory — transient toast", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    publishComparisonToggled({ enabled: false });
    __resetComparisonAdvisoryForTests();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    jest.useRealTimers();
    publishComparisonToggled({ enabled: false });
    __resetComparisonAdvisoryForTests();
    document.body.innerHTML = "";
  });

  it("mounts toast near target and auto-dismisses after COMPARISON_ADVISORY_TOAST_MS", () => {
    const target = makeTrigger();

    showComparisonAdvisoryToast(target);
    const toast = document.querySelector(".comparison-advisory-toast");
    expect(toast).not.toBeNull();

    jest.advanceTimersByTime(COMPARISON_ADVISORY_TOAST_MS - 1);
    expect(document.querySelector(".comparison-advisory-toast")).not.toBeNull();

    jest.advanceTimersByTime(1);
    expect(document.querySelector(".comparison-advisory-toast")).toBeNull();
  });

  it("second showComparisonAdvisoryToast replaces an in-flight toast (no stacking)", () => {
    const a = makeTrigger();
    const b = makeTrigger();

    showComparisonAdvisoryToast(a);
    showComparisonAdvisoryToast(b);

    expect(document.querySelectorAll(".comparison-advisory-toast").length).toBe(
      1,
    );
  });

  it("toast clears when comparison mode disables", () => {
    scaffoldChartContainers();
    publishComparisonToggled({ enabled: true });
    showComparisonAdvisoryToast(makeTrigger());
    expect(document.querySelector(".comparison-advisory-toast")).not.toBeNull();

    publishComparisonToggled({ enabled: false });
    expect(document.querySelector(".comparison-advisory-toast")).toBeNull();
  });
});
