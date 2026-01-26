/**
 * Cycle Time Charts Module Tests
 *
 * JSDOM behavior tests for renderCycleDistribution and renderCycleTimeTrend.
 * Tests chart render contracts:
 * - Distribution buckets rendered correctly
 * - Trend chart with P50/P90 lines
 * - Edge cases: insufficient data, null values
 */

import {
  renderCycleDistribution,
  renderCycleTimeTrend,
} from "../../../ui/modules/charts/cycle-time";
import type { Rollup } from "../../../ui/dataset-loader";
import type { DistributionData } from "../../../ui/types";

describe("cycle-time module", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe("renderCycleDistribution", () => {
    /**
     * Create sample distribution data for testing.
     */
    function createDistribution(): DistributionData {
      return {
        year: "2025",
        cycle_time_buckets: {
          "0-1h": 10,
          "1-4h": 25,
          "4-24h": 30,
          "1-3d": 20,
          "3-7d": 10,
          "7d+": 5,
        },
      };
    }

    it("renders distribution rows for each bucket", () => {
      renderCycleDistribution(container, [createDistribution()]);

      const rows = container.querySelectorAll(".dist-row");
      expect(rows.length).toBe(6);
    });

    it("shows bucket labels", () => {
      renderCycleDistribution(container, [createDistribution()]);

      expect(container.innerHTML).toContain("0-1h");
      expect(container.innerHTML).toContain("1-4h");
      expect(container.innerHTML).toContain("4-24h");
      expect(container.innerHTML).toContain("1-3d");
      expect(container.innerHTML).toContain("3-7d");
      expect(container.innerHTML).toContain("7d+");
    });

    it("shows count and percentage for each bucket", () => {
      renderCycleDistribution(container, [createDistribution()]);

      // 30 out of 100 total = 30%
      expect(container.innerHTML).toContain("30 (30.0%)");
    });

    it("sets bar width based on percentage", () => {
      renderCycleDistribution(container, [createDistribution()]);

      expect(container.innerHTML).toContain("width: 30.0%");
    });

    it("shows no-data message for empty distributions", () => {
      renderCycleDistribution(container, []);

      expect(container.innerHTML).toContain("no-data");
      expect(container.innerHTML).toContain("No data for selected range");
    });

    it("shows no-data message when all buckets are zero", () => {
      const emptyDist: DistributionData = {
        year: "2025",
        cycle_time_buckets: {},
      };
      renderCycleDistribution(container, [emptyDist]);

      expect(container.innerHTML).toContain("No cycle time data");
    });

    it("handles null container gracefully", () => {
      expect(() => {
        renderCycleDistribution(null, [createDistribution()]);
      }).not.toThrow();
    });

    it("aggregates multiple distributions", () => {
      const dist1: DistributionData = {
        year: "2025",
        cycle_time_buckets: { "0-1h": 10 },
      };
      const dist2: DistributionData = {
        year: "2025",
        cycle_time_buckets: { "0-1h": 20 },
      };

      renderCycleDistribution(container, [dist1, dist2]);

      // Should aggregate: 10 + 20 = 30
      expect(container.innerHTML).toContain("30 (100.0%)");
    });
  });

  describe("renderCycleTimeTrend", () => {
    /**
     * Create sample rollups with cycle time data.
     */
    function createRollups(count: number = 6): Rollup[] {
      return Array.from({ length: count }, (_, i) => ({
        week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
        pr_count: 10 + i * 5,
        cycle_time_p50: 60 + i * 10, // 60, 70, 80, 90, 100, 110 minutes
        cycle_time_p90: 120 + i * 20, // 120, 140, 160, 180, 200, 220 minutes
        authors_count: 5 + i,
        reviewers_count: 3 + i,
        by_repository: null,
        by_team: null,
      }));
    }

    it("renders SVG line chart", () => {
      renderCycleTimeTrend(container, createRollups());

      expect(container.innerHTML).toContain("<svg");
      expect(container.innerHTML).toContain("line-chart");
    });

    it("renders P50 and P90 lines", () => {
      renderCycleTimeTrend(container, createRollups());

      expect(container.innerHTML).toContain("line-chart-p50");
      expect(container.innerHTML).toContain("line-chart-p90");
    });

    it("renders data point circles", () => {
      renderCycleTimeTrend(container, createRollups());

      expect(container.innerHTML).toContain("line-chart-dot");
      expect(container.innerHTML).toContain('data-metric="P50"');
      expect(container.innerHTML).toContain('data-metric="P90"');
    });

    it("renders legend with P50 and P90 labels", () => {
      renderCycleTimeTrend(container, createRollups());

      expect(container.innerHTML).toContain("chart-legend");
      expect(container.innerHTML).toContain("P50 (Median)");
      expect(container.innerHTML).toContain("P90");
    });

    it("renders Y-axis labels with formatted duration", () => {
      renderCycleTimeTrend(container, createRollups());

      expect(container.innerHTML).toContain("line-chart-axis");
    });

    it("shows no-data message with less than 2 rollups", () => {
      renderCycleTimeTrend(container, createRollups(1));

      expect(container.innerHTML).toContain("no-data");
      expect(container.innerHTML).toContain("Not enough data for trend");
    });

    it("shows no-data message when all cycle times are null", () => {
      const nullRollups = createRollups(4).map((r) => ({
        ...r,
        cycle_time_p50: null,
        cycle_time_p90: null,
      }));

      renderCycleTimeTrend(container, nullRollups);

      expect(container.innerHTML).toContain("No cycle time data available");
    });

    it("handles null container gracefully", () => {
      expect(() => {
        renderCycleTimeTrend(null, createRollups());
      }).not.toThrow();
    });

    it("includes week data in dot attributes for tooltips", () => {
      renderCycleTimeTrend(container, createRollups(3));

      expect(container.innerHTML).toContain('data-week="2025-W01"');
    });
  });
});
