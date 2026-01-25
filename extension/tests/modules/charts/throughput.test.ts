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

import { renderThroughputChart } from "../../../ui/modules/charts/throughput";
import type { Rollup } from "../../../ui/dataset-loader";

describe("throughput module", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  /**
   * Create sample rollups for testing.
   */
  function createRollups(count: number = 8): Rollup[] {
    return Array.from({ length: count }, (_, i) => ({
      week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
      pr_count: 10 + i * 5,
      cycle_time_p50: 60 + i * 10,
      cycle_time_p90: 120 + i * 20,
      authors_count: 5 + i,
      reviewers_count: 3 + i,
      by_repository: null,
      by_team: null,
    }));
  }

  describe("renderThroughputChart", () => {
    it("renders bars for each week", () => {
      const rollups = createRollups(4);
      renderThroughputChart(container, rollups);

      const bars = container.querySelectorAll(".bar-container");
      expect(bars.length).toBe(4);
    });

    it("renders week labels from rollup week string", () => {
      const rollups = createRollups(2);
      renderThroughputChart(container, rollups);

      expect(container.innerHTML).toContain("01"); // W01
      expect(container.innerHTML).toContain("02"); // W02
    });

    it("renders trend line when >= 4 data points", () => {
      const rollups = createRollups(6);
      renderThroughputChart(container, rollups);

      expect(container.innerHTML).toContain("trend-line-overlay");
      expect(container.innerHTML).toContain("<svg");
      expect(container.innerHTML).toContain("<path");
    });

    it("does not render trend line with < 4 data points", () => {
      const rollups = createRollups(3);
      renderThroughputChart(container, rollups);

      expect(container.innerHTML).not.toContain("trend-line-overlay");
    });

    it("renders legend with weekly PRs and average labels", () => {
      const rollups = createRollups(4);
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
      const rollups = createRollups(4);

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

    it("includes PR count in title attribute", () => {
      const rollups = createRollups(2);
      renderThroughputChart(container, rollups);

      // First rollup has pr_count of 10
      expect(container.innerHTML).toContain('title="2025-W01: 10 PRs"');
    });
  });
});
