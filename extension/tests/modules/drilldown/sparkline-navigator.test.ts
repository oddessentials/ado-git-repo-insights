/**
 * Sparkline navigator unit tests (US4).
 *
 * Covers `extension/ui/modules/drilldown/sparkline-navigator.ts` per
 * `specs/059-chart-drill-down/contracts/drilldown-integration.md` and
 * spec.md FR-050 / FR-051 / FR-052: delegated click + keyboard
 * activation on `.sparkline-trigger` buttons, scrollIntoView on the
 * target chart container, short-lived `is-sparkline-highlight` CSS
 * class with self-dismiss after `SPARKLINE_HIGHLIGHT_MS`, missing-
 * target advisory, comparison-mode advisory routing, and dispose
 * semantics.
 */

import { installSparklineNavigator } from "../../../ui/modules/drilldown/sparkline-navigator";
import { publishComparisonToggled } from "../../../ui/modules/drilldown/lifecycle-signals";
import { __resetComparisonAdvisoryForTests } from "../../../ui/modules/drilldown/comparison-advisory";
import {
  dismissDetailPanel,
  isDetailPanelOpen,
} from "../../../ui/modules/shared/detail-panel";
import { SPARKLINE_HIGHLIGHT_MS } from "../../../ui/modules/shared/constants";
import type { Rollup } from "../../../ui/dataset-loader";
import type { PrRecord } from "../../../ui/schemas/rollup.schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type TargetChart = "throughput" | "cycle-time" | "reviewer";
const TARGET_ID_BY_CHART = new Map<TargetChart, string>([
  ["throughput", "throughput-chart"],
  ["cycle-time", "cycle-time-trend"],
  ["reviewer", "reviewer-activity"],
]);

function mountSummaryCards(targets: TargetChart[]): HTMLElement {
  const container = document.createElement("div");
  container.className = "summary-cards";
  for (const target of targets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sparkline-trigger";
    button.setAttribute("data-drilldown-target-chart", target);
    button.setAttribute("aria-label", `Open full ${target} chart`);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    button.appendChild(svg);
    container.appendChild(button);
  }
  document.body.appendChild(container);
  return container;
}

function mountTargetCharts(
  targets: TargetChart[],
): Map<TargetChart, HTMLElement> {
  const out = new Map<TargetChart, HTMLElement>();
  for (const chart of targets) {
    const el = document.createElement("div");
    const id = TARGET_ID_BY_CHART.get(chart);
    if (id === undefined) throw new Error(`unknown chart ${chart}`);
    el.id = id;
    document.body.appendChild(el);
    out.set(chart, el);
  }
  return out;
}

function triggerFor(container: HTMLElement, chart: TargetChart): HTMLElement {
  const el = container.querySelector<HTMLElement>(
    `button.sparkline-trigger[data-drilldown-target-chart="${chart}"]`,
  );
  if (!el) throw new Error(`trigger for ${chart} not rendered`);
  return el;
}

function click(target: HTMLElement): void {
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
}

// ---------------------------------------------------------------------------
// Phase 4 helpers (#363 — period-scoped DetailPanel)
// ---------------------------------------------------------------------------

type SparklineCardSpec =
  | { readonly chart: "throughput" | "reviewer" }
  | { readonly chart: "cycle-time"; readonly metric: "p50" | "p90" };

function mountSummaryCardsRich(
  specs: readonly SparklineCardSpec[],
): HTMLElement {
  const container = document.createElement("div");
  container.className = "summary-cards";
  for (const spec of specs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sparkline-trigger";
    button.setAttribute("data-drilldown-target-chart", spec.chart);
    if (spec.chart === "cycle-time") {
      button.setAttribute("data-drilldown-cycle-metric", spec.metric);
    }
    const label = spec.chart === "cycle-time" ? "cycle time" : spec.chart;
    button.setAttribute("aria-label", `Open full ${label} chart`);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    button.appendChild(svg);
    container.appendChild(button);
  }
  document.body.appendChild(container);
  return container;
}

function triggerForRich(
  container: HTMLElement,
  spec: SparklineCardSpec,
): HTMLElement {
  let selector = `button.sparkline-trigger[data-drilldown-target-chart="${spec.chart}"]`;
  if (spec.chart === "cycle-time") {
    selector += `[data-drilldown-cycle-metric="${spec.metric}"]`;
  }
  const el = container.querySelector<HTMLElement>(selector);
  if (!el) {
    throw new Error(`trigger for ${JSON.stringify(spec)} not rendered`);
  }
  return el;
}

function makePr(id: number, cycleMinutes: number, title: string): PrRecord {
  return {
    id,
    title,
    author_id: "alice",
    repository_id: "repo-1",
    cycle_time: cycleMinutes,
  };
}

function makePeriodRollup(
  week: string,
  start_date: string,
  end_date: string,
  prs: readonly PrRecord[],
  overrides: {
    pr_count?: number;
    truncated?: boolean;
    cap?: number;
  } = {},
): Rollup {
  return {
    week,
    start_date,
    end_date,
    pr_count: overrides.pr_count ?? prs.length,
    cycle_time_p50: 60 * 4,
    cycle_time_p90: 60 * 18,
    authors_count: 1,
    reviewers_count: 0,
    by_repository: null,
    by_team: null,
    prs,
    _prs_truncated: overrides.truncated ?? false,
    _prs_cap: overrides.cap ?? 500,
  };
}

const FIXTURE_REPOS = [
  {
    repository_id: "repo-1",
    repository_name: "web-app",
    project_name: "Frontend",
    organization_name: "acme",
  },
];

const FIXTURE_OPTIONS_BASE = {
  filters: {
    repos: [] as string[],
    teams: [] as string[],
    reviewers: [] as string[],
    authors: [] as string[],
  },
  repositoriesDimension: FIXTURE_REPOS,
  webContext: { collectionUri: "https://dev.azure.com/acme/" },
  authorsDimension: [],
  commentsMetricsAvailable: false,
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("sparkline-navigator", () => {
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  let scrollSpy: jest.Mock;
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    jest.useFakeTimers();
    publishComparisonToggled({ enabled: false });
    __resetComparisonAdvisoryForTests();
    document.body.innerHTML = "";
    scrollSpy = jest.fn();
    HTMLElement.prototype.scrollIntoView = scrollSpy;
    // Default matchMedia: no reduced-motion preference.
    window.matchMedia = ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
  });

  afterEach(() => {
    if (isDetailPanelOpen()) dismissDetailPanel("explicit-close-button");
    jest.useRealTimers();
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    window.matchMedia = originalMatchMedia;
    publishComparisonToggled({ enabled: false });
    __resetComparisonAdvisoryForTests();
    document.body.innerHTML = "";
  });

  // -------------------------------------------------------------------------
  // Reviewer-card preserved scroll-and-highlight (FR-002 / SC-005)
  //
  // #363 LD-2: throughput / cycle-time triggers now open the period-
  // scoped DetailPanel (covered by Phase 4 tests in this file +
  // sparkline-pr-list-* siblings). The reviewer card is the only
  // sparkline that preserves scroll-and-highlight, so the scroll-path
  // tests below pin the reviewer branch.
  // -------------------------------------------------------------------------

  it("reviewer-card click scrolls the target chart into view and applies the highlight class", () => {
    const container = mountSummaryCards(["reviewer"]);
    const targets = mountTargetCharts(["reviewer"]);
    installSparklineNavigator(container, []);

    click(triggerFor(container, "reviewer"));

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    expect(
      targets.get("reviewer")!.classList.contains("is-sparkline-highlight"),
    ).toBe(true);
  });

  it("reviewer-card uses scroll behavior 'auto' when prefers-reduced-motion is active", () => {
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;

    const container = mountSummaryCards(["reviewer"]);
    mountTargetCharts(["reviewer"]);
    installSparklineNavigator(container, []);

    click(triggerFor(container, "reviewer"));

    expect(scrollSpy).toHaveBeenCalledWith({
      behavior: "auto",
      block: "center",
    });
  });

  it("reviewer-card resolves '#reviewer-activity' via its canonical id", () => {
    const container = mountSummaryCards(["reviewer"]);
    const targets = mountTargetCharts(["reviewer"]);
    installSparklineNavigator(container, []);

    click(triggerFor(container, "reviewer"));

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(
      targets.get("reviewer")!.classList.contains("is-sparkline-highlight"),
    ).toBe(true);
  });

  it("reviewer-card highlight class is removed after SPARKLINE_HIGHLIGHT_MS", () => {
    const container = mountSummaryCards(["reviewer"]);
    const targets = mountTargetCharts(["reviewer"]);
    installSparklineNavigator(container, []);

    click(triggerFor(container, "reviewer"));
    expect(
      targets.get("reviewer")!.classList.contains("is-sparkline-highlight"),
    ).toBe(true);

    jest.advanceTimersByTime(SPARKLINE_HIGHLIGHT_MS - 1);
    expect(
      targets.get("reviewer")!.classList.contains("is-sparkline-highlight"),
    ).toBe(true);
    jest.advanceTimersByTime(1);
    expect(
      targets.get("reviewer")!.classList.contains("is-sparkline-highlight"),
    ).toBe(false);
  });

  it("reviewer-card repeat activation re-applies the highlight class (timer resets)", () => {
    const container = mountSummaryCards(["reviewer"]);
    const targets = mountTargetCharts(["reviewer"]);
    installSparklineNavigator(container, []);
    const trigger = triggerFor(container, "reviewer");

    click(trigger);
    expect(
      targets.get("reviewer")!.classList.contains("is-sparkline-highlight"),
    ).toBe(true);

    // Part-way through the first timer.
    jest.advanceTimersByTime(500);
    click(trigger);
    expect(
      targets.get("reviewer")!.classList.contains("is-sparkline-highlight"),
    ).toBe(true);

    // Neither timer has fired yet; the second keeps the class applied
    // until SPARKLINE_HIGHLIGHT_MS elapses from the second click.
    jest.advanceTimersByTime(SPARKLINE_HIGHLIGHT_MS);
    expect(
      targets.get("reviewer")!.classList.contains("is-sparkline-highlight"),
    ).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Missing-target advisory (FR-052)
  // -------------------------------------------------------------------------

  it("renders an inline advisory and does NOT scroll when the target chart is absent", () => {
    const container = mountSummaryCards(["throughput"]);
    // No target chart element rendered — FR-052 scenario.
    installSparklineNavigator(container, []);

    click(triggerFor(container, "throughput"));

    expect(scrollSpy).not.toHaveBeenCalled();
    const advisory = document.querySelector(".sparkline-advisory");
    expect(advisory).not.toBeNull();
    expect(advisory!.textContent).toContain("throughput");
  });

  it("missing cycle-time target renders advisory with 'cycle time' label", () => {
    const container = mountSummaryCards(["cycle-time"]);
    // No #cycle-time-trend element.
    installSparklineNavigator(container, []);

    click(triggerFor(container, "cycle-time"));

    const advisory = document.querySelector(".sparkline-advisory");
    expect(advisory).not.toBeNull();
    expect(advisory!.textContent).toContain("cycle time");
  });

  it("advisory is cleared when a subsequent activation succeeds (reviewer card)", () => {
    // Pivoted from throughput → reviewer post-#363: throughput now
    // opens the panel rather than scrolling, so the scroll-spy
    // assertion shape no longer applies. Reviewer-card preserves the
    // scroll-and-highlight path, where this advisory-clearing
    // semantic still has a clean assertion shape.
    const container = mountSummaryCards(["reviewer"]);
    installSparklineNavigator(container, []);

    click(triggerFor(container, "reviewer"));
    expect(document.querySelector(".sparkline-advisory")).not.toBeNull();

    // Mount the target element and click again.
    const chart = document.createElement("div");
    chart.id = "reviewer-activity";
    document.body.appendChild(chart);

    click(triggerFor(container, "reviewer"));

    expect(document.querySelector(".sparkline-advisory")).toBeNull();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Keyboard activation
  // -------------------------------------------------------------------------

  it("keyboard Enter on a focused reviewer trigger scrolls and highlights", () => {
    const container = mountSummaryCards(["reviewer"]);
    const targets = mountTargetCharts(["reviewer"]);
    installSparklineNavigator(container, []);

    triggerFor(container, "reviewer").dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }),
    );

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(
      targets.get("reviewer")!.classList.contains("is-sparkline-highlight"),
    ).toBe(true);
  });

  it("keyboard Space activates reviewer card and calls preventDefault", () => {
    const container = mountSummaryCards(["reviewer"]);
    mountTargetCharts(["reviewer"]);
    installSparklineNavigator(container, []);

    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: " ",
    });
    triggerFor(container, "reviewer").dispatchEvent(event);

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Comparison routing
  // -------------------------------------------------------------------------

  it("routes to comparison advisory toast when comparison mode is active", () => {
    const container = mountSummaryCards(["throughput"]);
    mountTargetCharts(["throughput"]);
    installSparklineNavigator(container, []);

    publishComparisonToggled({ enabled: true });
    click(triggerFor(container, "throughput"));

    expect(scrollSpy).not.toHaveBeenCalled();
    expect(document.querySelector(".comparison-advisory-toast")).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  it("dispose() detaches listeners — subsequent click does not scroll", () => {
    const container = mountSummaryCards(["throughput"]);
    mountTargetCharts(["throughput"]);
    const handle = installSparklineNavigator(container, []);

    handle.dispose();
    click(triggerFor(container, "throughput"));

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("dispose() cancels pending reviewer highlight timers so the class does not flicker off later", () => {
    const container = mountSummaryCards(["reviewer"]);
    const targets = mountTargetCharts(["reviewer"]);
    const handle = installSparklineNavigator(container, []);

    click(triggerFor(container, "reviewer"));
    expect(
      targets.get("reviewer")!.classList.contains("is-sparkline-highlight"),
    ).toBe(true);

    // Manually wipe the class to mimic a caller controlling highlight
    // state after dispose. The timer must be cancelled by dispose()
    // so it does not run and re-remove the class (would be a no-op
    // but shouldn't fire at all).
    targets.get("reviewer")!.classList.remove("is-sparkline-highlight");
    targets.get("reviewer")!.classList.add("caller-set-class");
    handle.dispose();
    jest.advanceTimersByTime(SPARKLINE_HIGHLIGHT_MS * 2);

    // Caller's class is untouched.
    expect(
      targets.get("reviewer")!.classList.contains("caller-set-class"),
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Coverage hardening — early-return branches
  // -------------------------------------------------------------------------

  it("click on the container outside any trigger is ignored", () => {
    const container = mountSummaryCards(["throughput"]);
    mountTargetCharts(["throughput"]);
    installSparklineNavigator(container, []);

    click(container);

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("keydown with an unrelated key on a trigger is ignored", () => {
    const container = mountSummaryCards(["throughput"]);
    mountTargetCharts(["throughput"]);
    installSparklineNavigator(container, []);

    triggerFor(container, "throughput").dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      }),
    );

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("keydown Enter outside any trigger (on the container) is ignored", () => {
    const container = mountSummaryCards(["throughput"]);
    mountTargetCharts(["throughput"]);
    installSparklineNavigator(container, []);

    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }),
    );

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("unrecognized data-drilldown-target-chart value is a no-op", () => {
    const container = mountSummaryCards(["throughput"]);
    mountTargetCharts(["throughput"]);
    installSparklineNavigator(container, []);
    const trigger = triggerFor(container, "throughput");
    trigger.setAttribute("data-drilldown-target-chart", "unknown");

    click(trigger);

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("matchMedia undefined environment gracefully defaults to smooth scroll on reviewer card", () => {
    (window as unknown as Record<string, unknown>).matchMedia = undefined;
    const container = mountSummaryCards(["reviewer"]);
    mountTargetCharts(["reviewer"]);
    installSparklineNavigator(container, []);

    click(triggerFor(container, "reviewer"));

    expect(scrollSpy).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
  });

  // -------------------------------------------------------------------------
  // Phase 4 — period-scoped DetailPanel (#363)
  //
  // Multi-week fixture: 5 PRs across 3 weeks (Mar 17 – Apr 6, 2025).
  // Throughput and cycle-time triggers open the period-scoped panel;
  // reviewer trigger preserves the scroll-and-highlight path.
  // -------------------------------------------------------------------------

  function periodFixtureRollups(): Rollup[] {
    return [
      makePeriodRollup("2025-W12", "2025-03-17", "2025-03-23", [
        makePr(101, 800, "feat: oauth"),
        makePr(102, 500, "refactor: hooks"),
      ]),
      makePeriodRollup("2025-W13", "2025-03-24", "2025-03-30", [
        makePr(201, 900, "fix: race"),
        makePr(202, 300, "chore: lint"),
      ]),
      makePeriodRollup("2025-W14", "2025-03-31", "2025-04-06", [
        makePr(301, 600, "feat: dropdown"),
      ]),
    ];
  }

  // -------------------------------------------------------------------------
  // US1 — throughput card opens period-scoped PR list
  // -------------------------------------------------------------------------

  it("throughput card sparkline opens DetailPanel with period-scoped PR list", () => {
    const rollups = periodFixtureRollups();
    const container = mountSummaryCardsRich([{ chart: "throughput" }]);
    mountTargetCharts(["throughput"]);
    installSparklineNavigator(container, rollups, FIXTURE_OPTIONS_BASE);

    click(triggerForRich(container, { chart: "throughput" }));

    expect(isDetailPanelOpen()).toBe(true);
    const title = document.querySelector("#detail-panel-title")!.textContent;
    expect(title).toBe("Period of Mar 17 – Apr 6, 2025");
    const subtitle = document.querySelector(
      ".detail-panel-subtitle",
    )!.textContent;
    expect(subtitle).toBe("5 PRs");
    const section = document.getElementById("pr-detail");
    expect(section).not.toBeNull();
    expect(section!.getAttribute("data-content-state")).toBe("pr-list");
  });

  it("throughput card with team filter renders team-inline message", () => {
    const rollups = periodFixtureRollups();
    const container = mountSummaryCardsRich([{ chart: "throughput" }]);
    mountTargetCharts(["throughput"]);
    installSparklineNavigator(container, rollups, {
      ...FIXTURE_OPTIONS_BASE,
      filters: {
        repos: [],
        teams: ["team-1"],
        reviewers: [],
        authors: [],
      },
    });

    click(triggerForRich(container, { chart: "throughput" }));

    const section = document.getElementById("pr-detail")!;
    expect(section.getAttribute("data-content-state")).toBe("team-inline");
  });

  it("throughput card with reviewer filter renders reviewer-inline message", () => {
    const rollups = periodFixtureRollups();
    const container = mountSummaryCardsRich([{ chart: "throughput" }]);
    mountTargetCharts(["throughput"]);
    installSparklineNavigator(container, rollups, {
      ...FIXTURE_OPTIONS_BASE,
      filters: {
        repos: [],
        teams: [],
        reviewers: ["rev-1"],
        authors: [],
      },
    });

    click(triggerForRich(container, { chart: "throughput" }));

    const section = document.getElementById("pr-detail")!;
    expect(section.getAttribute("data-content-state")).toBe("reviewer-inline");
  });

  it("throughput card in comparison mode fires toast and does not open panel", () => {
    const rollups = periodFixtureRollups();
    const container = mountSummaryCardsRich([{ chart: "throughput" }]);
    mountTargetCharts(["throughput"]);
    installSparklineNavigator(container, rollups, FIXTURE_OPTIONS_BASE);

    publishComparisonToggled({ enabled: true });
    click(triggerForRich(container, { chart: "throughput" }));

    expect(isDetailPanelOpen()).toBe(false);
    expect(document.querySelector(".comparison-advisory-toast")).not.toBeNull();
  });

  it("throughput card with missing target chart renders inline advisory and does not open panel", () => {
    const rollups = periodFixtureRollups();
    const container = mountSummaryCardsRich([{ chart: "throughput" }]);
    // No #throughput-chart mounted — FR-003 path.
    installSparklineNavigator(container, rollups, FIXTURE_OPTIONS_BASE);

    click(triggerForRich(container, { chart: "throughput" }));

    expect(isDetailPanelOpen()).toBe(false);
    const advisory = document.querySelector(".sparkline-advisory");
    expect(advisory).not.toBeNull();
    expect(advisory!.textContent).toContain("throughput");
  });

  // -------------------------------------------------------------------------
  // US2 — cycle-time cards open period-scoped PR list with — P50 / — P90
  // -------------------------------------------------------------------------

  it("cycle-time P50 card sparkline opens panel with — P50 marker", () => {
    const rollups = periodFixtureRollups();
    const container = mountSummaryCardsRich([
      { chart: "cycle-time", metric: "p50" },
    ]);
    mountTargetCharts(["cycle-time"]);
    installSparklineNavigator(container, rollups, FIXTURE_OPTIONS_BASE);

    click(triggerForRich(container, { chart: "cycle-time", metric: "p50" }));

    expect(isDetailPanelOpen()).toBe(true);
    const title = document.querySelector("#detail-panel-title")!.textContent;
    expect(title).toBe("Period of Mar 17 – Apr 6, 2025 — P50");
  });

  it("cycle-time P90 card sparkline opens panel with — P90 marker", () => {
    const rollups = periodFixtureRollups();
    const container = mountSummaryCardsRich([
      { chart: "cycle-time", metric: "p90" },
    ]);
    mountTargetCharts(["cycle-time"]);
    installSparklineNavigator(container, rollups, FIXTURE_OPTIONS_BASE);

    click(triggerForRich(container, { chart: "cycle-time", metric: "p90" }));

    expect(isDetailPanelOpen()).toBe(true);
    const title = document.querySelector("#detail-panel-title")!.textContent;
    expect(title).toBe("Period of Mar 17 – Apr 6, 2025 — P90");
  });

  it("clicking cycleP50 then cycleP90 retargets in place with no flicker", () => {
    const rollups = periodFixtureRollups();
    const container = mountSummaryCardsRich([
      { chart: "cycle-time", metric: "p50" },
      { chart: "cycle-time", metric: "p90" },
    ]);
    mountTargetCharts(["cycle-time"]);
    installSparklineNavigator(container, rollups, FIXTURE_OPTIONS_BASE);

    const p50Trigger = triggerForRich(container, {
      chart: "cycle-time",
      metric: "p50",
    });
    const p90Trigger = triggerForRich(container, {
      chart: "cycle-time",
      metric: "p90",
    });

    click(p50Trigger);
    expect(document.querySelector("#detail-panel-title")!.textContent).toMatch(
      /— P50$/,
    );
    expect(p50Trigger.classList.contains("is-drilldown-active")).toBe(true);
    expect(p50Trigger.getAttribute("aria-expanded")).toBe("true");

    const initialRowIds = Array.from(
      document.querySelectorAll(
        "#pr-detail ol.detail-panel-pr-list li.detail-panel-pr-row a",
      ),
    ).map((a) => a.textContent);

    click(p90Trigger);

    expect(isDetailPanelOpen()).toBe(true);
    expect(document.querySelector("#detail-panel-title")!.textContent).toMatch(
      /— P90$/,
    );
    // Same period union so PR rows are byte-equivalent.
    const swappedRowIds = Array.from(
      document.querySelectorAll(
        "#pr-detail ol.detail-panel-pr-list li.detail-panel-pr-row a",
      ),
    ).map((a) => a.textContent);
    expect(swappedRowIds).toEqual(initialRowIds);
    // Active class swapped; aria-expanded mirrored.
    expect(p50Trigger.classList.contains("is-drilldown-active")).toBe(false);
    expect(p50Trigger.getAttribute("aria-expanded")).toBe("false");
    expect(p90Trigger.classList.contains("is-drilldown-active")).toBe(true);
    expect(p90Trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("clicking totalPrs then cycleP50 retargets across cards", () => {
    const rollups = periodFixtureRollups();
    const container = mountSummaryCardsRich([
      { chart: "throughput" },
      { chart: "cycle-time", metric: "p50" },
    ]);
    mountTargetCharts(["throughput", "cycle-time"]);
    installSparklineNavigator(container, rollups, FIXTURE_OPTIONS_BASE);

    const throughputTrigger = triggerForRich(container, {
      chart: "throughput",
    });
    const p50Trigger = triggerForRich(container, {
      chart: "cycle-time",
      metric: "p50",
    });

    click(throughputTrigger);
    expect(throughputTrigger.classList.contains("is-drilldown-active")).toBe(
      true,
    );
    expect(document.querySelector("#detail-panel-title")!.textContent).toBe(
      "Period of Mar 17 – Apr 6, 2025",
    );

    click(p50Trigger);
    expect(throughputTrigger.classList.contains("is-drilldown-active")).toBe(
      false,
    );
    expect(throughputTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(p50Trigger.classList.contains("is-drilldown-active")).toBe(true);
    expect(p50Trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector("#detail-panel-title")!.textContent).toMatch(
      /— P50$/,
    );
  });

  it("cycle-time cards with team filter render team-inline message", () => {
    const rollups = periodFixtureRollups();
    const container = mountSummaryCardsRich([
      { chart: "cycle-time", metric: "p50" },
      { chart: "cycle-time", metric: "p90" },
    ]);
    mountTargetCharts(["cycle-time"]);
    installSparklineNavigator(container, rollups, {
      ...FIXTURE_OPTIONS_BASE,
      filters: {
        repos: [],
        teams: ["team-1"],
        reviewers: [],
        authors: [],
      },
    });

    for (const metric of ["p50", "p90"] as const) {
      click(triggerForRich(container, { chart: "cycle-time", metric }));
      const section = document.getElementById("pr-detail")!;
      expect(section.getAttribute("data-content-state")).toBe("team-inline");
    }
  });

  it("cycle-time cards in comparison mode fire toast and do not open panel", () => {
    const rollups = periodFixtureRollups();
    const container = mountSummaryCardsRich([
      { chart: "cycle-time", metric: "p50" },
      { chart: "cycle-time", metric: "p90" },
    ]);
    mountTargetCharts(["cycle-time"]);
    installSparklineNavigator(container, rollups, FIXTURE_OPTIONS_BASE);

    publishComparisonToggled({ enabled: true });
    for (const metric of ["p50", "p90"] as const) {
      click(triggerForRich(container, { chart: "cycle-time", metric }));
      expect(isDetailPanelOpen()).toBe(false);
    }
    expect(document.querySelector(".comparison-advisory-toast")).not.toBeNull();
  });

  it("cycle-time cards with missing target chart render inline advisory", () => {
    const rollups = periodFixtureRollups();
    const container = mountSummaryCardsRich([
      { chart: "cycle-time", metric: "p50" },
      { chart: "cycle-time", metric: "p90" },
    ]);
    // No #cycle-time-trend mounted.
    installSparklineNavigator(container, rollups, FIXTURE_OPTIONS_BASE);

    for (const metric of ["p50", "p90"] as const) {
      click(triggerForRich(container, { chart: "cycle-time", metric }));
      expect(isDetailPanelOpen()).toBe(false);
    }
    const advisory = document.querySelector(".sparkline-advisory");
    expect(advisory).not.toBeNull();
    expect(advisory!.textContent).toContain("cycle time");
  });

  // -------------------------------------------------------------------------
  // US3 — reviewer card preservation (FR-002 / SC-005 regression-lock)
  // -------------------------------------------------------------------------

  it("reviewers card sparkline scrolls and does NOT open the DetailPanel", () => {
    const rollups = periodFixtureRollups();
    const container = mountSummaryCardsRich([{ chart: "reviewer" }]);
    mountTargetCharts(["reviewer"]);
    installSparklineNavigator(container, rollups, FIXTURE_OPTIONS_BASE);

    click(triggerForRich(container, { chart: "reviewer" }));

    expect(isDetailPanelOpen()).toBe(false);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it("reviewers card in comparison mode fires toast and does NOT scroll", () => {
    const rollups = periodFixtureRollups();
    const container = mountSummaryCardsRich([{ chart: "reviewer" }]);
    mountTargetCharts(["reviewer"]);
    installSparklineNavigator(container, rollups, FIXTURE_OPTIONS_BASE);

    publishComparisonToggled({ enabled: true });
    click(triggerForRich(container, { chart: "reviewer" }));

    expect(scrollSpy).not.toHaveBeenCalled();
    expect(document.querySelector(".comparison-advisory-toast")).not.toBeNull();
  });

  it("clicking reviewer after a panel-opening card clears the prior trigger's is-drilldown-active state", () => {
    // Cross-card retarget regression-lock: the user opens the panel
    // via a panel-opening card (cycleP50 here), then clicks the
    // reviewer card. The reviewer branch preserves the panel (FR-002
    // does not dismiss) but the previously-active trigger MUST lose
    // its `is-drilldown-active` / `aria-expanded="true"` attributes —
    // otherwise the visual claims one card is active while the user's
    // attention has moved to a different card.
    const rollups = periodFixtureRollups();
    const container = mountSummaryCardsRich([
      { chart: "cycle-time", metric: "p50" },
      { chart: "reviewer" },
    ]);
    mountTargetCharts(["cycle-time", "reviewer"]);
    installSparklineNavigator(container, rollups, FIXTURE_OPTIONS_BASE);

    const cycleP50Trigger = triggerForRich(container, {
      chart: "cycle-time",
      metric: "p50",
    });
    const reviewerTrigger = triggerForRich(container, { chart: "reviewer" });

    click(cycleP50Trigger);
    expect(isDetailPanelOpen()).toBe(true);
    expect(cycleP50Trigger.classList.contains("is-drilldown-active")).toBe(
      true,
    );
    expect(cycleP50Trigger.getAttribute("aria-expanded")).toBe("true");

    click(reviewerTrigger);

    // Reviewer card scrolls but does not open the panel.
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    // Prior active state cleared on the cycleP50 trigger.
    expect(cycleP50Trigger.classList.contains("is-drilldown-active")).toBe(
      false,
    );
    expect(cycleP50Trigger.getAttribute("aria-expanded")).toBe("false");
    // Reviewer trigger never gets an active class (it's a non-panel
    // path; only panel-opening triggers carry the active marker).
    expect(reviewerTrigger.classList.contains("is-drilldown-active")).toBe(
      false,
    );
  });

  it("missing-target advisory clears prior is-drilldown-active state from a panel-opening trigger", () => {
    // Companion to the reviewer-card retarget test: when the user
    // clicks a card whose target chart is absent, the advisory
    // renders adjacent to the trigger and the prior panel-opening
    // trigger's active state MUST clear (the user is genuinely
    // navigating; the failed advisory shouldn't leave them with a
    // stale "active" visual on a different card).
    const rollups = periodFixtureRollups();
    const container = mountSummaryCardsRich([
      { chart: "cycle-time", metric: "p50" },
      { chart: "throughput" },
    ]);
    // Mount only the cycle-time target, NOT throughput's.
    mountTargetCharts(["cycle-time"]);
    installSparklineNavigator(container, rollups, FIXTURE_OPTIONS_BASE);

    const cycleP50Trigger = triggerForRich(container, {
      chart: "cycle-time",
      metric: "p50",
    });
    const throughputTrigger = triggerForRich(container, {
      chart: "throughput",
    });

    click(cycleP50Trigger);
    expect(isDetailPanelOpen()).toBe(true);
    expect(cycleP50Trigger.classList.contains("is-drilldown-active")).toBe(
      true,
    );

    click(throughputTrigger);

    // Throughput target absent → advisory rendered, panel not retargeted.
    expect(document.querySelector(".sparkline-advisory")).not.toBeNull();
    // Prior active state cleared.
    expect(cycleP50Trigger.classList.contains("is-drilldown-active")).toBe(
      false,
    );
    expect(cycleP50Trigger.getAttribute("aria-expanded")).toBe("false");
  });

  // -------------------------------------------------------------------------
  // US4 — capability-aware DOM shape and stat row
  // -------------------------------------------------------------------------

  it("capability-on PR list rows include thread/comment/active counts", () => {
    const rollups: Rollup[] = [
      makePeriodRollup("2025-W12", "2025-03-17", "2025-03-23", [
        {
          id: 101,
          title: "feat: oauth",
          author_id: "alice",
          repository_id: "repo-1",
          cycle_time: 800,
          thread_count: 4,
          comment_count: 11,
          active_thread_count: 2,
        },
        {
          id: 102,
          title: "refactor: hooks",
          author_id: "alice",
          repository_id: "repo-1",
          cycle_time: 500,
          thread_count: 1,
          comment_count: 3,
          active_thread_count: 0,
        },
      ]),
    ];
    const container = mountSummaryCardsRich([{ chart: "throughput" }]);
    mountTargetCharts(["throughput"]);
    installSparklineNavigator(container, rollups, {
      ...FIXTURE_OPTIONS_BASE,
      commentsMetricsAvailable: true,
    });

    click(triggerForRich(container, { chart: "throughput" }));

    // Rows carry comments-metric spans.
    const metricSpans = document.querySelectorAll(
      "#pr-detail .comments-metric",
    );
    expect(metricSpans.length).toBe(6); // 2 rows × 3 axes
    // Comments stat row prepended above the PR list (FR-012 gate).
    const statRow = document.querySelector(".detail-panel-section--stat-row");
    expect(statRow).not.toBeNull();
    const statLabels = Array.from(statRow!.querySelectorAll("dl dt")).map(
      (dt) => dt.textContent,
    );
    expect(statLabels).toEqual(["Threads", "Comments", "Unresolved threads"]);
  });

  it("capability-on + team-inline state suppresses comments stat row", () => {
    const rollups = periodFixtureRollups();
    const container = mountSummaryCardsRich([{ chart: "throughput" }]);
    mountTargetCharts(["throughput"]);
    installSparklineNavigator(container, rollups, {
      ...FIXTURE_OPTIONS_BASE,
      commentsMetricsAvailable: true,
      filters: {
        repos: [],
        teams: ["team-1"],
        reviewers: [],
        authors: [],
      },
    });

    click(triggerForRich(container, { chart: "throughput" }));

    const section = document.getElementById("pr-detail")!;
    expect(section.getAttribute("data-content-state")).toBe("team-inline");
    // Stat row gate: capability-on AND content state pr-list. Team-
    // inline must suppress the row.
    expect(
      document.querySelector(".detail-panel-section--stat-row"),
    ).toBeNull();
  });
});
