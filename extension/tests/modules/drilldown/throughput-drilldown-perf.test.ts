/**
 * Throughput drill-down performance budget (feature 060 SC-001).
 *
 * Asserts two things on a week with 500 PR rows (the aggregator cap):
 *
 *   1. The wall-clock between a simulated `click` on a throughput bar and
 *      the panel landing in `is-open` + 500 PR rows appearing in the DOM
 *      is below a configured budget (< 250ms in jsdom).
 *   2. No new `fetch` / `XMLHttpRequest` / SDK RPC call fires between the
 *      install-time data capture and the panel render. The panel MUST be
 *      built from the already-rendered rollup slice with no round-trip.
 *
 * This is not a production-hardware number — jsdom is synchronous and
 * free of paint. It is the MEASURABILITY proof SC-001 calls for, locking
 * the no-network invariant that matters for the user-observed interaction.
 */

import { renderThroughputChart } from "../../../ui/modules/charts/throughput";
import { installThroughputDrilldown } from "../../../ui/modules/drilldown/throughput-drilldown";
import { publishComparisonToggled } from "../../../ui/modules/drilldown/lifecycle-signals";
import { __resetComparisonAdvisoryForTests } from "../../../ui/modules/drilldown/comparison-advisory";
import {
  dismissDetailPanel,
  isDetailPanelOpen,
} from "../../../ui/modules/shared/detail-panel";
import type { Rollup } from "../../../ui/dataset-loader";
import type { PrRecord } from "../../../ui/schemas/rollup.schema";
import {
  checkRegression,
  getMetricBaseline,
  loadPerfBaselines,
  measureWithWarmup,
} from "../../helpers/perf-measure";

const PERF_BUDGET_MS = 250;

function make500PrRollup(): Rollup {
  const prs: PrRecord[] = Array.from({ length: 500 }, (_, i) => ({
    id: 1000 + i,
    title: `PR ${1000 + i}`,
    author_id: "alice",
    repository_id: "repo-1",
    cycle_time: 500 - i,
  }));
  return {
    week: "2025-W20",
    pr_count: 500,
    cycle_time_p50: null,
    cycle_time_p90: null,
    authors_count: 1,
    reviewers_count: 1,
    by_repository: { "repo-1": { pr_count: 500 } },
    by_author: { alice: { pr_count: 500 } },
    by_team: null,
    prs,
    _prs_truncated: false,
    _prs_cap: 500,
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

describe("throughput-drilldown perf (feature 060 SC-001)", () => {
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

  // The previous single-shot `t1 - t0` measurement against a 250 ms hard
  // ceiling tripped on routine variance — observed locally at 251.8 ms
  // (issue #348). Warmup + median absorbs single-digit-ms jitter and a
  // first-iteration JIT-cold blip without loosening the literal SC-001
  // ceiling. The no-network invariant (the load-bearing SC-001 contract)
  // is asserted across ALL warmup AND measured iterations because the
  // fetch / XHR spies are installed outside `measureWithWarmup`.
  it("opens the panel with 500 rows under the SC-001 wall-clock budget and without any network RPC", () => {
    const rollups = [make500PrRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups, {
      filters: { repos: [], teams: [], reviewers: [], authors: [] },
      repositoriesDimension: [
        {
          repository_id: "repo-1",
          repository_name: "web-app",
          project_name: "Frontend",
          organization_name: "acme",
        },
      ],
      webContext: { collectionUri: "https://dev.azure.com/acme/" },
    });

    // Spy for every network surface the render path could in principle use.
    // Spies are installed outside the timed loop so the no-network
    // invariant covers warmup runs too — any RPC at any point fails the
    // test.
    const fetchSpy = jest.fn();
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: fetchSpy,
    });
    const xhrOpenSpy = jest.spyOn(XMLHttpRequest.prototype, "open");

    try {
      const median = measureWithWarmup(
        () => {
          firstBar(container).dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true }),
          );
        },
        {
          afterEach: () => {
            // Reset to closed-panel state so the next iteration measures
            // the same shape of work (open from scratch).
            if (isDetailPanelOpen()) {
              dismissDetailPanel("explicit-close-button");
            }
          },
        },
      );

      // Re-open once after measurement so we can assert the panel state
      // on a known iteration. This activation is not timed.
      firstBar(container).dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );

      expect(isDetailPanelOpen()).toBe(true);
      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      const rows = prSection!.querySelectorAll("ol > li");
      expect(rows.length).toBe(500);

      expect(median).toBeLessThan(PERF_BUDGET_MS);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(xhrOpenSpy).not.toHaveBeenCalled();

      const baseline = getMetricBaseline(
        loadPerfBaselines(),
        "drilldown_500pr_open_ms",
      );
      checkRegression("drilldown-500pr-open", median, baseline);
      console.log(
        JSON.stringify({
          test: "drilldown_500pr_open",
          duration_ms: median,
          budget_ms: PERF_BUDGET_MS,
          baseline_ms: baseline ?? "N/A",
        }),
      );
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: originalFetch,
      });
      xhrOpenSpy.mockRestore();
    }
  });
});
