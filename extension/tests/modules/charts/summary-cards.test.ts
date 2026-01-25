/**
 * Summary Cards Module Tests
 *
 * JSDOM behavior tests for renderSummaryCards.
 * Tests chart render contracts:
 * - Values rendered correctly
 * - Sparklines rendered
 * - Deltas shown/hidden based on previous period
 * - Edge case handling
 */

import {
  renderSummaryCards,
  type SummaryCardsContainers,
  type RenderSummaryCardsOptions,
} from "../../../ui/modules/charts/summary-cards";

describe("summary-cards module", () => {
  /**
   * Create mock container elements for testing.
   */
  function createContainers(): SummaryCardsContainers {
    return {
      totalPrs: document.createElement("span"),
      cycleP50: document.createElement("span"),
      cycleP90: document.createElement("span"),
      authorsCount: document.createElement("span"),
      reviewersCount: document.createElement("span"),
      totalPrsSparkline: document.createElement("div"),
      cycleP50Sparkline: document.createElement("div"),
      cycleP90Sparkline: document.createElement("div"),
      authorsSparkline: document.createElement("div"),
      reviewersSparkline: document.createElement("div"),
      totalPrsDelta: document.createElement("div"),
      cycleP50Delta: document.createElement("div"),
      cycleP90Delta: document.createElement("div"),
      authorsDelta: document.createElement("div"),
      reviewersDelta: document.createElement("div"),
    };
  }

  /**
   * Create sample rollups for testing.
   */
  function createRollups(count: number = 4) {
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

  describe("renderSummaryCards", () => {
    it("renders metric values correctly", () => {
      const containers = createContainers();
      const rollups = createRollups();

      renderSummaryCards({
        rollups,
        containers,
      });

      // Total PRs: 10 + 15 + 20 + 25 = 70
      expect(containers.totalPrs!.textContent).toBe("70");
      // Cycle times should show formatted durations
      expect(containers.cycleP50!.textContent).not.toBe("-");
      expect(containers.cycleP90!.textContent).not.toBe("-");
      // Authors avg: (5 + 6 + 7 + 8) / 4 = 6.5 → 7 (rounded)
      expect(containers.authorsCount!.textContent).toBe("7");
      // Reviewers avg: (3 + 4 + 5 + 6) / 4 = 4.5 → 5 (rounded)
      expect(containers.reviewersCount!.textContent).toBe("5");
    });

    it("renders sparklines with valid data", () => {
      const containers = createContainers();
      const rollups = createRollups(4); // Need >= 2 points for sparklines

      renderSummaryCards({
        rollups,
        containers,
      });

      // Sparklines should contain SVG
      expect(containers.totalPrsSparkline!.innerHTML).toContain("<svg");
      expect(containers.cycleP50Sparkline!.innerHTML).toContain("<svg");
    });

    it("renders deltas when previous period exists", () => {
      const containers = createContainers();
      const rollups = createRollups(4);
      const prevRollups = createRollups(4).map((r) => ({
        ...r,
        pr_count: r.pr_count - 5, // Previous had fewer PRs
      }));

      renderSummaryCards({
        rollups,
        prevRollups,
        containers,
      });

      // Delta should contain arrow and percentage
      expect(containers.totalPrsDelta!.innerHTML).toContain("delta-arrow");
    });

    it("clears deltas when no previous period", () => {
      const containers = createContainers();
      const rollups = createRollups();

      // Pre-populate delta to verify it gets cleared
      containers.totalPrsDelta!.innerHTML = "some content";
      containers.totalPrsDelta!.className = "some-class";

      renderSummaryCards({
        rollups,
        prevRollups: [],
        containers,
      });

      expect(containers.totalPrsDelta!.innerHTML).toBe("");
      expect(containers.totalPrsDelta!.className).toBe("metric-delta");
    });

    it("handles empty rollups gracefully", () => {
      const containers = createContainers();

      expect(() => {
        renderSummaryCards({
          rollups: [],
          containers,
        });
      }).not.toThrow();

      expect(containers.totalPrs!.textContent).toBe("0");
      expect(containers.cycleP50!.textContent).toBe("-");
    });

    it("handles null containers gracefully", () => {
      const containers: SummaryCardsContainers = {
        totalPrs: null,
        cycleP50: null,
        cycleP90: null,
        authorsCount: null,
        reviewersCount: null,
        totalPrsSparkline: null,
        cycleP50Sparkline: null,
        cycleP90Sparkline: null,
        authorsSparkline: null,
        reviewersSparkline: null,
        totalPrsDelta: null,
        cycleP50Delta: null,
        cycleP90Delta: null,
        authorsDelta: null,
        reviewersDelta: null,
      };

      expect(() => {
        renderSummaryCards({
          rollups: createRollups(),
          containers,
        });
      }).not.toThrow();
    });

    it("calls performance metrics collector when provided", () => {
      const containers = createContainers();
      const rollups = createRollups();

      const metricsCollector = {
        mark: jest.fn(),
        measure: jest.fn(),
      };

      renderSummaryCards({
        rollups,
        containers,
        metricsCollector,
      });

      expect(metricsCollector.mark).toHaveBeenCalledWith(
        "render-summary-cards-start",
      );
      expect(metricsCollector.mark).toHaveBeenCalledWith(
        "render-summary-cards-end",
      );
      expect(metricsCollector.mark).toHaveBeenCalledWith(
        "first-meaningful-paint",
      );
      expect(metricsCollector.measure).toHaveBeenCalledWith(
        "init-to-fmp",
        "dashboard-init",
        "first-meaningful-paint",
      );
    });

    it("shows inverse delta for cycle times (lower is better)", () => {
      const containers = createContainers();
      const rollups = createRollups(4);
      // Previous period had FASTER cycle times (lower values)
      const prevRollups = createRollups(4).map((r) => ({
        ...r,
        cycle_time_p50: r.cycle_time_p50 - 20, // Was faster before
        cycle_time_p90: r.cycle_time_p90 - 40,
      }));

      renderSummaryCards({
        rollups,
        prevRollups,
        containers,
      });

      // Cycle time increased (bad), so should show inverse indicator
      // The delta-negative-inverse class indicates "went up but that's bad"
      expect(containers.cycleP50Delta!.className).toContain("inverse");
    });
  });
});
