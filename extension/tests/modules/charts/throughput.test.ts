/**
 * Throughput Chart Module Tests
 *
 * JSDOM behavior tests for renderThroughputChart.
 * Tests chart render contracts:
 * - Container cleared before render
 * - Bars created for each rollup week
 * - Trend line rendered when >= 4 data points
 * - No-data message for empty rollups
 */

import {
  renderThroughputChart,
  MAX_VISIBLE_LABELS,
} from "../../../ui/modules/charts/throughput";
import type { Rollup } from "../../../ui/dataset-loader";

/** Shared test fixture: create N rollups with predictable values. */
function makeTestRollups(count: number): Rollup[] {
  return Array.from({ length: count }, (_, i) => ({
    week: `2025-W${String(i + 1).padStart(2, "0")}`,
    pr_count: 10 + i * 5,
    cycle_time_p50: 60 + i * 10,
    cycle_time_p90: 120 + i * 20,
    authors_count: 5 + i,
    reviewers_count: 3 + i,
    by_repository: null,
    by_team: null,
  }));
}

describe("throughput module", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    // Global NaN invariant: no chart should ever produce NaN in SVG coordinates
    expect(container.innerHTML).not.toContain("NaN");
    document.body.removeChild(container);
  });

  describe("renderThroughputChart", () => {
    it("renders bars for each week", () => {
      const rollups = makeTestRollups(4);
      renderThroughputChart(container, rollups);

      const bars = container.querySelectorAll(".bar-container");
      expect(bars.length).toBe(4);
    });

    it("renders week labels from rollup week string", () => {
      const rollups = makeTestRollups(2);
      renderThroughputChart(container, rollups);

      expect(container.innerHTML).toContain("01"); // W01
      expect(container.innerHTML).toContain("02"); // W02
    });

    it("renders trend line when >= 4 data points", () => {
      const rollups = makeTestRollups(6);
      renderThroughputChart(container, rollups);

      expect(container.innerHTML).toContain("trend-line-overlay");
      expect(container.innerHTML).toContain("<svg");
      expect(container.innerHTML).toContain("<path");
    });

    it("does not render trend line with < 4 data points", () => {
      const rollups = makeTestRollups(3);
      renderThroughputChart(container, rollups);

      expect(container.innerHTML).not.toContain("trend-line-overlay");
    });

    it("renders legend with weekly PRs and average labels", () => {
      const rollups = makeTestRollups(4);
      renderThroughputChart(container, rollups);

      expect(container.innerHTML).toContain("chart-legend");
      expect(container.innerHTML).toContain("Weekly PRs");
      expect(container.innerHTML).toContain("4-week avg");
    });

    it("shows no-data message for empty rollups", () => {
      renderThroughputChart(container, []);

      expect(container.innerHTML).toContain("no-data");
      expect(container.innerHTML).toContain("No data for selected range");
    });

    it("handles null container gracefully", () => {
      const rollups = makeTestRollups(4);

      expect(() => {
        renderThroughputChart(null, rollups);
      }).not.toThrow();
    });

    it("sets bar height based on max PR count", () => {
      // Create rollups with known values
      const rollups: Rollup[] = [
        {
          week: "2025-W01",
          pr_count: 50, // half of max
          cycle_time_p50: 60,
          cycle_time_p90: 120,
          authors_count: 5,
          reviewers_count: 3,
          by_repository: null,
          by_team: null,
        },
        {
          week: "2025-W02",
          pr_count: 100, // max
          cycle_time_p50: 70,
          cycle_time_p90: 140,
          authors_count: 6,
          reviewers_count: 4,
          by_repository: null,
          by_team: null,
        },
      ];

      renderThroughputChart(container, rollups);

      // Second bar should have 100% height
      expect(container.innerHTML).toContain("height: 100%");
      // First bar should have 50% height
      expect(container.innerHTML).toContain("height: 50%");
    });

    it("includes PR count in data attributes", () => {
      const rollups = makeTestRollups(2);
      renderThroughputChart(container, rollups);

      // First rollup has pr_count of 10 — uses data-week and data-count instead of title
      const bar = container.querySelector(
        '.bar-container[data-week="2025-W01"]',
      );
      expect(bar).not.toBeNull();
      expect(bar?.getAttribute("data-count")).toBe("10");
    });

    it("renders standard week format label from W-suffix", () => {
      const rollups: Rollup[] = [
        {
          week: "2025-W03",
          pr_count: 10,
          cycle_time_p50: 60,
          cycle_time_p90: 120,
          authors_count: 5,
          reviewers_count: 3,
          by_repository: null,
          by_team: null,
        },
      ];

      renderThroughputChart(container, rollups);

      expect(container.innerHTML).toContain("03");
    });

    it("uses full string for non-standard week format", () => {
      const rollups: Rollup[] = [
        {
          week: "custom_format",
          pr_count: 10,
          cycle_time_p50: 60,
          cycle_time_p90: 120,
          authors_count: 5,
          reviewers_count: 3,
          by_repository: null,
          by_team: null,
        },
      ];

      renderThroughputChart(container, rollups);

      expect(container.innerHTML).toContain("custom_format");
    });
  });
});

describe("Label thinning", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  it("shows all labels when bar count <= MAX_VISIBLE_LABELS", () => {
    renderThroughputChart(container, makeTestRollups(16));
    const labels = container.querySelectorAll(".bar-label");
    expect(labels.length).toBe(16);
    const nonEmpty = Array.from(labels).filter((l) => l.textContent !== "");
    expect(nonEmpty.length).toBe(16);
  });

  it("thins labels when bar count > MAX_VISIBLE_LABELS (17 bars, step=2)", () => {
    renderThroughputChart(container, makeTestRollups(17));
    const labels = container.querySelectorAll(".bar-label");
    expect(labels.length).toBe(17);
    const nonEmpty = Array.from(labels).filter((l) => l.textContent !== "");
    // Math.ceil(17/16) = 2, so labels at 0,2,4,...,16 = 9 labels
    expect(nonEmpty.length).toBe(9);
  });

  it("thins labels for 104 bars (step=7, 15 labels)", () => {
    renderThroughputChart(container, makeTestRollups(104));
    const labels = container.querySelectorAll(".bar-label");
    expect(labels.length).toBe(104);
    const nonEmpty = Array.from(labels).filter((l) => l.textContent !== "");
    // Math.ceil(104/16) = 7, labels at 0,7,14,...,98 = 15 labels
    expect(nonEmpty.length).toBe(15);
  });

  it("always renders .bar-label element for every bar (preserves flex spacing)", () => {
    renderThroughputChart(container, makeTestRollups(50));
    const labels = container.querySelectorAll(".bar-label");
    expect(labels.length).toBe(50);
  });

  it("first label (index 0) is always visible", () => {
    renderThroughputChart(container, makeTestRollups(104));
    const labels = container.querySelectorAll(".bar-label");
    expect(labels[0].textContent).not.toBe("");
  });

  it("shows tooltip with week and PR count on bar hover", () => {
    renderThroughputChart(container, makeTestRollups(4));

    const bar = container.querySelector("[data-tooltip]") as HTMLElement;
    bar.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    const tooltip = document.querySelector(".chart-tooltip");
    expect(tooltip).not.toBeNull();
    expect(tooltip?.textContent).toContain("2025-W01");
    expect(tooltip?.textContent).toContain("10");

    bar.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
  });
});

describe("Throughput trend line legend", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  it("shows insufficient legend AND no trend SVG when < 4 weeks", () => {
    renderThroughputChart(container, makeTestRollups(3));

    // Legend must indicate trend line is unavailable
    expect(container.innerHTML).toContain("needs 4+ weeks");
    expect(container.querySelector(".legend-insufficient")).not.toBeNull();
    // AND no trend SVG path must exist — assert both together
    expect(container.querySelector(".trend-line-overlay")).toBeNull();
  });

  it("shows normal legend AND trend SVG path when >= 4 weeks", () => {
    renderThroughputChart(container, makeTestRollups(6));

    // Legend must show normal "4-week avg" without qualifier
    expect(container.innerHTML).toContain("4-week avg");
    expect(container.innerHTML).not.toContain("needs 4+ weeks");
    expect(container.querySelector(".legend-insufficient")).toBeNull();
    // AND trend SVG must contain a path element
    const overlay = container.querySelector(".trend-line-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay?.innerHTML).toContain("<path");
  });
});
