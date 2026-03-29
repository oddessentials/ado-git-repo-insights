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
      reviewTimeP50: document.createElement("span"),
      reviewTimeP90: document.createElement("span"),
      authorsCount: document.createElement("span"),
      reviewersCount: document.createElement("span"),
      totalPrsSparkline: document.createElement("div"),
      cycleP50Sparkline: document.createElement("div"),
      cycleP90Sparkline: document.createElement("div"),
      reviewTimeP50Sparkline: document.createElement("div"),
      reviewTimeP90Sparkline: document.createElement("div"),
      authorsSparkline: document.createElement("div"),
      reviewersSparkline: document.createElement("div"),
      totalPrsDelta: document.createElement("div"),
      cycleP50Delta: document.createElement("div"),
      cycleP90Delta: document.createElement("div"),
      reviewTimeP50Delta: document.createElement("div"),
      reviewTimeP90Delta: document.createElement("div"),
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
        reviewTimeP50: null,
        reviewTimeP90: null,
        authorsCount: null,
        reviewersCount: null,
        totalPrsSparkline: null,
        cycleP50Sparkline: null,
        cycleP90Sparkline: null,
        reviewTimeP50Sparkline: null,
        reviewTimeP90Sparkline: null,
        authorsSparkline: null,
        reviewersSparkline: null,
        totalPrsDelta: null,
        cycleP50Delta: null,
        cycleP90Delta: null,
        reviewTimeP50Delta: null,
        reviewTimeP90Delta: null,
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

    it("handles all-null cycle times gracefully (cross-dimensional low traffic)", () => {
      const containers = createContainers();
      const rollups = Array.from({ length: 8 }, (_, i) => ({
        week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
        pr_count: 2, // Below threshold → null cycle times
        cycle_time_p50: null as number | null,
        cycle_time_p90: null as number | null,
        authors_count: 1,
        reviewers_count: 1,
        by_repository: null,
        by_team: null,
      }));

      renderSummaryCards({ rollups, containers });

      // Summary card should show "-" not "0"
      expect(containers.cycleP50!.textContent).toBe("-");
      expect(containers.cycleP90!.textContent).toBe("-");
      // Sparklines should be empty (no misleading zero line)
      expect(containers.cycleP50Sparkline!.innerHTML).toBe("");
      expect(containers.cycleP90Sparkline!.innerHTML).toBe("");
      // PR sparkline should still render
      expect(containers.totalPrsSparkline!.innerHTML).toContain("<svg");
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

  describe("review time metrics (US1)", () => {
    it("renders review time P50/P90 as formatted durations", () => {
      const containers = createContainers();
      // review_time values are in minutes (same unit as cycle_time)
      const rollups = [
        {
          week: "2025-W01",
          pr_count: 10,
          cycle_time_p50: 60,
          cycle_time_p90: 120,
          review_time_p50: 90,   // 1.5h
          review_time_p90: 240,  // 4.0h
          authors_count: 5,
          reviewers_count: 3,
          by_repository: null,
          by_team: null,
        },
        {
          week: "2025-W02",
          pr_count: 15,
          cycle_time_p50: 45,
          cycle_time_p90: 90,
          review_time_p50: 90,
          review_time_p90: 240,
          authors_count: 7,
          reviewers_count: 4,
          by_repository: null,
          by_team: null,
        },
      ];

      renderSummaryCards({ rollups, containers });

      // formatDuration(90) = "1.5h", formatDuration(240) = "4.0h"
      expect(containers.reviewTimeP50!.textContent).not.toBe("-");
      expect(containers.reviewTimeP90!.textContent).not.toBe("-");
      expect(containers.reviewTimeP50!.textContent).toContain("h");
      expect(containers.reviewTimeP90!.textContent).toContain("h");
    });

    it("shows dash for null review time values", () => {
      const containers = createContainers();
      const rollups = [
        {
          week: "2025-W01",
          pr_count: 10,
          cycle_time_p50: 60,
          cycle_time_p90: 120,
          review_time_p50: null,
          review_time_p90: null,
          authors_count: 5,
          reviewers_count: 3,
          by_repository: null,
          by_team: null,
        },
      ];

      renderSummaryCards({ rollups, containers });

      expect(containers.reviewTimeP50!.textContent).toBe("-");
      expect(containers.reviewTimeP90!.textContent).toBe("-");
    });

    it("renders review time sparklines with valid data", () => {
      const containers = createContainers();
      const rollups = Array.from({ length: 4 }, (_, i) => ({
        week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
        pr_count: 10,
        cycle_time_p50: 60,
        cycle_time_p90: 120,
        review_time_p50: 30 + i * 15,   // minutes
        review_time_p90: 60 + i * 30,   // minutes
        authors_count: 5,
        reviewers_count: 3,
        by_repository: null,
        by_team: null,
      }));

      renderSummaryCards({ rollups, containers });

      expect(containers.reviewTimeP50Sparkline!.innerHTML).toContain("<svg");
      expect(containers.reviewTimeP90Sparkline!.innerHTML).toContain("<svg");
    });

    it("clears review time sparklines when all values are null", () => {
      const containers = createContainers();
      const rollups = Array.from({ length: 4 }, (_, i) => ({
        week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
        pr_count: 10,
        cycle_time_p50: 60,
        cycle_time_p90: 120,
        review_time_p50: null as number | null,
        review_time_p90: null as number | null,
        authors_count: 5,
        reviewers_count: 3,
        by_repository: null,
        by_team: null,
      }));

      renderSummaryCards({ rollups, containers });

      expect(containers.reviewTimeP50Sparkline!.innerHTML).toBe("");
      expect(containers.reviewTimeP90Sparkline!.innerHTML).toBe("");
    });

    it("hides review time cards when dataset has no review_time data", () => {
      // Wrap review time values inside .card elements so closest() works
      const containers = createContainers();
      const p50Card = document.createElement("div");
      p50Card.className = "card";
      p50Card.appendChild(containers.reviewTimeP50!);
      document.body.appendChild(p50Card);
      const p90Card = document.createElement("div");
      p90Card.className = "card";
      p90Card.appendChild(containers.reviewTimeP90!);
      document.body.appendChild(p90Card);

      const rollups = createRollups(4); // no review_time fields

      renderSummaryCards({ rollups, containers });

      expect(p50Card.style.display).toBe("none");
      expect(p90Card.style.display).toBe("none");
    });

    it("shows review time cards when dataset has review_time data", () => {
      const containers = createContainers();
      const p50Card = document.createElement("div");
      p50Card.className = "card";
      p50Card.appendChild(containers.reviewTimeP50!);
      document.body.appendChild(p50Card);
      const p90Card = document.createElement("div");
      p90Card.className = "card";
      p90Card.appendChild(containers.reviewTimeP90!);
      document.body.appendChild(p90Card);

      const rollups = [
        {
          week: "2025-W01",
          pr_count: 10,
          cycle_time_p50: 60,
          cycle_time_p90: 120,
          review_time_p50: 90,
          review_time_p90: 240,
          authors_count: 5,
          reviewers_count: 3,
          by_repository: null,
          by_team: null,
        },
      ];

      renderSummaryCards({ rollups, containers });

      expect(p50Card.style.display).toBe("");
      expect(p90Card.style.display).toBe("");
    });

    it("hides review time cards when filtered rollups null review_time even if unfiltered data has it", () => {
      const containers = createContainers();
      const p50Card = document.createElement("div");
      p50Card.className = "card";
      p50Card.appendChild(containers.reviewTimeP50!);
      document.body.appendChild(p50Card);
      const p90Card = document.createElement("div");
      p90Card.className = "card";
      p90Card.appendChild(containers.reviewTimeP90!);
      document.body.appendChild(p90Card);

      // Filtered rollups have review_time nulled (as applyFiltersToRollups does for reviewer filters)
      const filteredRollups = createRollups(4); // no review_time fields

      // Unfiltered rollups DO have review_time data
      const unfilteredRollups = [
        {
          week: "2025-W01",
          pr_count: 10,
          cycle_time_p50: 60,
          cycle_time_p90: 120,
          review_time_p50: 90,
          review_time_p90: 240,
          authors_count: 5,
          reviewers_count: 3,
          by_repository: null,
          by_team: null,
        },
      ];

      renderSummaryCards({ rollups: filteredRollups, containers, unfilteredRollups });

      // Cards must be hidden — filtered slice has no review_time data.
      // Showing blank "-" KPIs is worse than hiding for unsupported slices.
      expect(p50Card.style.display).toBe("none");
      expect(p90Card.style.display).toBe("none");
    });

    it("hides review time cards when both filtered and unfiltered rollups lack review_time", () => {
      const containers = createContainers();
      const p50Card = document.createElement("div");
      p50Card.className = "card";
      p50Card.appendChild(containers.reviewTimeP50!);
      document.body.appendChild(p50Card);
      const p90Card = document.createElement("div");
      p90Card.className = "card";
      p90Card.appendChild(containers.reviewTimeP90!);
      document.body.appendChild(p90Card);

      const rollups = createRollups(4);
      const unfilteredRollups = createRollups(4); // also no review_time

      renderSummaryCards({ rollups, containers, unfilteredRollups });

      expect(p50Card.style.display).toBe("none");
      expect(p90Card.style.display).toBe("none");
    });
  });

  describe("sparkline time labels (US4)", () => {
    it("displays 'Last N weeks' below each sparkline", () => {
      const containers = createContainers();
      const card = document.createElement("div");
      card.className = "card";
      card.appendChild(document.createElement("h3"));
      card.appendChild(containers.totalPrs!);
      card.appendChild(containers.totalPrsSparkline!);
      document.body.appendChild(card);

      // 20 weeks → capped at 8
      renderSummaryCards({ rollups: createRollups(20), containers });

      const label = card.querySelector(".sparkline-label");
      expect(label).not.toBeNull();
      expect(label!.textContent).toBe("Last 8 weeks");
    });

    it("reflects actual week count when fewer than lookback", () => {
      const containers = createContainers();
      const card = document.createElement("div");
      card.className = "card";
      card.appendChild(document.createElement("h3"));
      card.appendChild(containers.totalPrs!);
      card.appendChild(containers.totalPrsSparkline!);
      document.body.appendChild(card);

      renderSummaryCards({ rollups: createRollups(4), containers });

      const label = card.querySelector(".sparkline-label");
      expect(label!.textContent).toBe("Last 4 weeks");
    });

    it("shows 'Last 1 week' label for single-week selection", () => {
      const containers = createContainers();
      const card = document.createElement("div");
      card.className = "card";
      card.appendChild(document.createElement("h3"));
      card.appendChild(containers.totalPrs!);
      card.appendChild(containers.totalPrsSparkline!);
      document.body.appendChild(card);

      renderSummaryCards({ rollups: createRollups(1), containers });

      // Label provides time context even when sparkline doesn't render (< 2 points)
      const label = card.querySelector(".sparkline-label");
      expect(label).not.toBeNull();
      expect(label!.textContent).toBe("Last 1 week");
    });

    it("shows consistent N across all sparkline labels", () => {
      const containers = createContainers();
      const pairs: [HTMLElement, HTMLElement][] = [
        [containers.totalPrs!, containers.totalPrsSparkline!],
        [containers.cycleP50!, containers.cycleP50Sparkline!],
      ];
      const cards: HTMLElement[] = [];
      for (const [valEl, sparkEl] of pairs) {
        const card = document.createElement("div");
        card.className = "card";
        card.appendChild(document.createElement("h3"));
        card.appendChild(valEl);
        card.appendChild(sparkEl);
        document.body.appendChild(card);
        cards.push(card);
      }

      renderSummaryCards({ rollups: createRollups(12), containers });

      const labels = cards
        .map((c) => c.querySelector(".sparkline-label")?.textContent)
        .filter(Boolean);
      expect(labels.length).toBe(pairs.length);
      expect(new Set(labels).size).toBe(1);
      expect(labels[0]).toBe("Last 8 weeks");
    });

    it("sparkline label N equals min(filteredRollups.length, lookback)", () => {
      // Invariant: the label must reflect the exact filtered dataset,
      // not any unfiltered or global source.
      const containers = createContainers();
      const card = document.createElement("div");
      card.className = "card";
      card.appendChild(document.createElement("h3"));
      card.appendChild(containers.totalPrs!);
      card.appendChild(containers.totalPrsSparkline!);
      document.body.appendChild(card);

      // Simulate a filter that reduces 20 weeks to 6
      const filteredRollups = createRollups(6);
      renderSummaryCards({ rollups: filteredRollups, containers });

      const label = card.querySelector(".sparkline-label");
      expect(label).not.toBeNull();
      // 6 < 8 (lookback cap), so label shows 6
      expect(label!.textContent).toBe("Last 6 weeks");

      // Re-render with 12 weeks (exceeds lookback)
      renderSummaryCards({ rollups: createRollups(12), containers });
      const label2 = card.querySelector(".sparkline-label");
      expect(label2!.textContent).toBe("Last 8 weeks");
    });

    it("clears stale sparkline labels when re-render produces zero rollups", () => {
      const containers = createContainers();
      const card = document.createElement("div");
      card.className = "card";
      card.appendChild(document.createElement("h3"));
      card.appendChild(containers.totalPrs!);
      card.appendChild(containers.totalPrsSparkline!);
      document.body.appendChild(card);

      // First render: populated
      renderSummaryCards({ rollups: createRollups(4), containers });
      expect(card.querySelector(".sparkline-label")).not.toBeNull();

      // Re-render with empty rollups (e.g. narrow filter producing no data)
      renderSummaryCards({ rollups: [], containers });
      expect(card.querySelector(".sparkline-label")).toBeNull();
    });
  });

  describe("sample size indicator (US3)", () => {
    it("displays 'Based on N PRs' on the Total PRs card", () => {
      const containers = createContainers();
      const card = document.createElement("div");
      card.className = "card";
      const h3 = document.createElement("h3");
      h3.textContent = "Total PRs";
      card.appendChild(h3);
      card.appendChild(containers.totalPrs!);
      document.body.appendChild(card);

      // 4 rollups: pr_count = 10 + 15 + 20 + 25 = 70
      renderSummaryCards({ rollups: createRollups(4), containers });

      const sampleEl = card.querySelector(".metric-sample-size");
      expect(sampleEl).not.toBeNull();
      expect(sampleEl!.textContent).toBe("Based on 70 PRs");
    });

    it("uses singular 'PR' for count of 1", () => {
      const containers = createContainers();
      const card = document.createElement("div");
      card.className = "card";
      card.appendChild(document.createElement("h3"));
      card.appendChild(containers.totalPrs!);
      document.body.appendChild(card);

      const rollups = [{
        week: "2025-W01", pr_count: 1,
        cycle_time_p50: 60, cycle_time_p90: 120,
        authors_count: 1, reviewers_count: 1,
        by_repository: null, by_team: null,
      }];

      renderSummaryCards({ rollups, containers });

      const sampleEl = card.querySelector(".metric-sample-size");
      expect(sampleEl!.textContent).toBe("Based on 1 PR");
    });

    it("totalPrs card shows PR count, cycle card shows week count", () => {
      const containers = createContainers();
      // Cycle time card
      const aggCard = document.createElement("div");
      aggCard.className = "card";
      aggCard.appendChild(document.createElement("h3"));
      aggCard.appendChild(containers.cycleP50!);
      document.body.appendChild(aggCard);

      // Total PRs card
      const prCard = document.createElement("div");
      prCard.className = "card";
      prCard.appendChild(document.createElement("h3"));
      prCard.appendChild(containers.totalPrs!);
      document.body.appendChild(prCard);

      // 4 rollups, all with non-null cycle_time_p50
      renderSummaryCards({ rollups: createRollups(4), containers });

      const aggSample = aggCard.querySelector(".metric-sample-size");
      const prSample = prCard.querySelector(".metric-sample-size");

      // PR card: sum of pr_count (10+15+20+25=70)
      expect(prSample!.textContent).toBe("Based on 70 PRs");
      // Cycle card: week count (4 weeks with non-null cycle_time_p50)
      expect(aggSample!.textContent).toBe("From 4 weeks of data");
    });

    it("applies .low-sample class when below LOW_SAMPLE_THRESHOLD", () => {
      const containers = createContainers();
      const card = document.createElement("div");
      card.className = "card";
      card.appendChild(document.createElement("h3"));
      card.appendChild(containers.totalPrs!);
      document.body.appendChild(card);

      const rollups = [{
        week: "2025-W01", pr_count: 5,
        cycle_time_p50: 60, cycle_time_p90: 120,
        authors_count: 2, reviewers_count: 1,
        by_repository: null, by_team: null,
      }];

      renderSummaryCards({ rollups, containers });

      const sampleEl = card.querySelector(".metric-sample-size");
      expect(sampleEl).not.toBeNull();
      expect(sampleEl!.classList.contains("low-sample")).toBe(true);
      expect(sampleEl!.textContent).toBe("Based on 5 PRs");
    });
  });

  describe("correctness regressions", () => {
    it("sample-size subtitle renders under .card (not .metric-card)", () => {
      const containers = createContainers();
      // Use real HTML class "card" matching index.html
      const card = document.createElement("div");
      card.className = "card";
      card.appendChild(document.createElement("h3"));
      card.appendChild(containers.totalPrs!);
      document.body.appendChild(card);

      renderSummaryCards({ rollups: createRollups(4), containers });

      expect(card.querySelector(".metric-sample-size")).not.toBeNull();
    });

    it("review-time cards show week-based sample size from non-null weeks", () => {
      const containers = createContainers();

      // Total PRs card
      const prCard = document.createElement("div");
      prCard.className = "card";
      prCard.appendChild(document.createElement("h3"));
      prCard.appendChild(containers.totalPrs!);
      document.body.appendChild(prCard);

      // Review-time card
      const rtCard = document.createElement("div");
      rtCard.className = "card";
      rtCard.appendChild(document.createElement("h3"));
      rtCard.appendChild(containers.reviewTimeP50!);
      document.body.appendChild(rtCard);

      // 4 rollups, 2 with non-null review_time_p50
      const rollups = [
        { week: "2025-W01", pr_count: 20, cycle_time_p50: 60, cycle_time_p90: 120, review_time_p50: 30, review_time_p90: 60, authors_count: 5, reviewers_count: 3, by_repository: null, by_team: null },
        { week: "2025-W02", pr_count: 25, cycle_time_p50: 45, cycle_time_p90: 90, review_time_p50: null, review_time_p90: null, authors_count: 7, reviewers_count: 4, by_repository: null, by_team: null },
        { week: "2025-W03", pr_count: 15, cycle_time_p50: 50, cycle_time_p90: 100, review_time_p50: 45, review_time_p90: 90, authors_count: 6, reviewers_count: 3, by_repository: null, by_team: null },
        { week: "2025-W04", pr_count: 30, cycle_time_p50: 55, cycle_time_p90: 110, review_time_p50: null, review_time_p90: null, authors_count: 8, reviewers_count: 5, by_repository: null, by_team: null },
      ];

      renderSummaryCards({ rollups, containers });

      // PR card: sum of pr_count (20+25+15+30=90)
      const prSample = prCard.querySelector(".metric-sample-size");
      expect(prSample!.textContent).toBe("Based on 90 PRs");

      // Review-time card: 2 non-null review_time_p50 weeks
      const rtSample = rtCard.querySelector(".metric-sample-size");
      expect(rtSample!.textContent).toBe("From 2 weeks of data");
    });

    it("sparkline label uses metric-specific week count, not raw rollup count", () => {
      const containers = createContainers();
      const rtCard = document.createElement("div");
      rtCard.className = "card";
      rtCard.appendChild(document.createElement("h3"));
      rtCard.appendChild(containers.reviewTimeP50!);
      rtCard.appendChild(containers.reviewTimeP50Sparkline!);
      document.body.appendChild(rtCard);

      const authCard = document.createElement("div");
      authCard.className = "card";
      authCard.appendChild(document.createElement("h3"));
      authCard.appendChild(containers.authorsCount!);
      authCard.appendChild(containers.authorsSparkline!);
      document.body.appendChild(authCard);

      // 8 rollups, only first 3 have non-null review_time_p50
      const rollups = Array.from({ length: 8 }, (_, i) => ({
        week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
        pr_count: 10,
        cycle_time_p50: 60,
        cycle_time_p90: 120,
        review_time_p50: i < 3 ? 30 + i * 10 : null as number | null,
        review_time_p90: i < 3 ? 60 + i * 20 : null as number | null,
        authors_count: 5,
        reviewers_count: 3,
        by_repository: null,
        by_team: null,
      }));

      renderSummaryCards({ rollups, containers });

      // Review-time card: 3 non-null weeks → "Last 3 weeks"
      const rtLabel = rtCard.querySelector(".sparkline-label");
      expect(rtLabel).not.toBeNull();
      expect(rtLabel!.textContent).toBe("Last 3 weeks");

      // Authors card: all 8 weeks → "Last 8 weeks"
      const authLabel = authCard.querySelector(".sparkline-label");
      expect(authLabel).not.toBeNull();
      expect(authLabel!.textContent).toBe("Last 8 weeks");
    });

    it("review-time P50/P90 cards show independent week counts", () => {
      const containers = createContainers();

      const p50Card = document.createElement("div");
      p50Card.className = "card";
      p50Card.appendChild(document.createElement("h3"));
      p50Card.appendChild(containers.reviewTimeP50!);
      document.body.appendChild(p50Card);

      const p90Card = document.createElement("div");
      p90Card.className = "card";
      p90Card.appendChild(document.createElement("h3"));
      p90Card.appendChild(containers.reviewTimeP90!);
      document.body.appendChild(p90Card);

      // P50 non-null on weeks 1,3 (2 weeks). P90 non-null on weeks 1,2 (2 weeks).
      // Different weeks but same count — ensures independence is wired, not coincidental.
      const rollups = [
        { week: "2025-W01", pr_count: 10, cycle_time_p50: 60, cycle_time_p90: 120, review_time_p50: 30, review_time_p90: 60, authors_count: 5, reviewers_count: 3, by_repository: null, by_team: null },
        { week: "2025-W02", pr_count: 15, cycle_time_p50: 45, cycle_time_p90: 90, review_time_p50: null, review_time_p90: 90, authors_count: 7, reviewers_count: 4, by_repository: null, by_team: null },
        { week: "2025-W03", pr_count: 20, cycle_time_p50: 50, cycle_time_p90: 100, review_time_p50: 45, review_time_p90: null, authors_count: 6, reviewers_count: 3, by_repository: null, by_team: null },
      ];

      renderSummaryCards({ rollups, containers });

      // P50: 2 non-null review_time_p50 weeks (W01, W03)
      const p50Sample = p50Card.querySelector(".metric-sample-size");
      expect(p50Sample!.textContent).toBe("From 2 weeks of data");

      // P90: 2 non-null review_time_p90 weeks (W01, W02) — independent from P50
      const p90Sample = p90Card.querySelector(".metric-sample-size");
      expect(p90Sample!.textContent).toBe("From 2 weeks of data");
    });

    it("P90 card shows different count than P50 when null patterns diverge", () => {
      const containers = createContainers();

      const p50Card = document.createElement("div");
      p50Card.className = "card";
      p50Card.appendChild(document.createElement("h3"));
      p50Card.appendChild(containers.cycleP50!);
      document.body.appendChild(p50Card);

      const p90Card = document.createElement("div");
      p90Card.className = "card";
      p90Card.appendChild(document.createElement("h3"));
      p90Card.appendChild(containers.cycleP90!);
      document.body.appendChild(p90Card);

      // P50 non-null on weeks 1,2 (2 weeks). P90 non-null on weeks 1,2,3,4 (4 weeks).
      const rollups = [
        { week: "2025-W01", pr_count: 10, cycle_time_p50: 60, cycle_time_p90: 120, authors_count: 5, reviewers_count: 3, by_repository: null, by_team: null },
        { week: "2025-W02", pr_count: 15, cycle_time_p50: 45, cycle_time_p90: 90, authors_count: 7, reviewers_count: 4, by_repository: null, by_team: null },
        { week: "2025-W03", pr_count: 20, cycle_time_p50: null, cycle_time_p90: 100, authors_count: 6, reviewers_count: 3, by_repository: null, by_team: null },
        { week: "2025-W04", pr_count: 12, cycle_time_p50: null, cycle_time_p90: 140, authors_count: 4, reviewers_count: 2, by_repository: null, by_team: null },
      ];

      renderSummaryCards({ rollups, containers });

      // P50: 2 non-null weeks → low-sample (2 < 3)
      const p50Sample = p50Card.querySelector(".metric-sample-size");
      expect(p50Sample!.textContent).toBe("From 2 weeks of data");
      expect(p50Sample!.classList.contains("low-sample")).toBe(true);

      // P90: 4 non-null weeks → moderate-sample (3 ≤ 4 < 8)
      const p90Sample = p90Card.querySelector(".metric-sample-size");
      expect(p90Sample!.textContent).toBe("From 4 weeks of data");
      expect(p90Sample!.classList.contains("moderate-sample")).toBe(true);
    });

    it("week-based cards show 'From N weeks of data'", () => {
      const containers = createContainers();
      const weekBasedEls = [
        containers.cycleP50!,
        containers.cycleP90!,
        containers.authorsCount!,
        containers.reviewersCount!,
      ];
      const cards: HTMLElement[] = [];
      for (const el of weekBasedEls) {
        const card = document.createElement("div");
        card.className = "card";
        card.appendChild(document.createElement("h3"));
        card.appendChild(el);
        document.body.appendChild(card);
        cards.push(card);
      }

      // createRollups(8) produces 8 rollups, all with non-null cycle_time_p50
      renderSummaryCards({ rollups: createRollups(8), containers });

      for (const card of cards) {
        const label = card.querySelector(".metric-sample-size")?.textContent ?? "";
        expect(label).toContain("From");
        expect(label).toContain("weeks of data");
      }
    });

    it("zero-count suppresses sample-size subtitle", () => {
      const containers = createContainers();
      const card = document.createElement("div");
      card.className = "card";
      card.appendChild(document.createElement("h3"));
      card.appendChild(containers.reviewTimeP50!);
      document.body.appendChild(card);

      // All rollups have null review_time_p50 → reviewTimeP50WeekCount = 0
      const rollups = [
        { week: "2025-W01", pr_count: 10, cycle_time_p50: 60, cycle_time_p90: 120, authors_count: 5, reviewers_count: 3, by_repository: null, by_team: null },
        { week: "2025-W02", pr_count: 15, cycle_time_p50: 80, cycle_time_p90: 160, authors_count: 7, reviewers_count: 4, by_repository: null, by_team: null },
      ];

      renderSummaryCards({ rollups, containers });

      // No subtitle when count is 0 — card is in no-data state
      expect(card.querySelector(".metric-sample-size")).toBeNull();
    });

    it("cycle card with partial data shows week count and low-sample tier", () => {
      const containers = createContainers();
      const card = document.createElement("div");
      card.className = "card";
      card.appendChild(document.createElement("h3"));
      card.appendChild(containers.cycleP50!);
      document.body.appendChild(card);

      // 8 rollups, only 2 with non-null cycle_time_p50
      const rollups = Array.from({ length: 8 }, (_, i) => ({
        week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
        pr_count: 10,
        cycle_time_p50: i < 2 ? 60 + i * 10 : (null as number | null),
        cycle_time_p90: i < 2 ? 120 + i * 20 : (null as number | null),
        authors_count: 5,
        reviewers_count: 3,
        by_repository: null,
        by_team: null,
      }));

      renderSummaryCards({ rollups, containers });

      const sampleEl = card.querySelector(".metric-sample-size");
      expect(sampleEl).not.toBeNull();
      expect(sampleEl!.textContent).toBe("From 2 weeks of data");
      expect(sampleEl!.classList.contains("low-sample")).toBe(true); // 2 < LOW_WEEK_THRESHOLD(3)
    });

    it("week-based moderate tier at 4 weeks", () => {
      const containers = createContainers();
      const card = document.createElement("div");
      card.className = "card";
      card.appendChild(document.createElement("h3"));
      card.appendChild(containers.cycleP50!);
      document.body.appendChild(card);

      // 4 rollups, all with non-null cycle_time_p50 → cycleP50WeekCount = 4
      renderSummaryCards({ rollups: createRollups(4), containers });

      const sampleEl = card.querySelector(".metric-sample-size");
      expect(sampleEl).not.toBeNull();
      expect(sampleEl!.classList.contains("moderate-sample")).toBe(true); // 3 <= 4 < 8
      expect(sampleEl!.classList.contains("low-sample")).toBe(false);
    });

    it("week-based adequate tier at 8+ weeks", () => {
      const containers = createContainers();
      const card = document.createElement("div");
      card.className = "card";
      card.appendChild(document.createElement("h3"));
      card.appendChild(containers.cycleP50!);
      document.body.appendChild(card);

      // 8 rollups, all with non-null cycle_time_p50 → cycleP50WeekCount = 8
      renderSummaryCards({ rollups: createRollups(8), containers });

      const sampleEl = card.querySelector(".metric-sample-size");
      expect(sampleEl).not.toBeNull();
      expect(sampleEl!.classList.contains("moderate-sample")).toBe(false);
      expect(sampleEl!.classList.contains("low-sample")).toBe(false);
    });

    it("PR-based tier boundaries: 9 low, 10 moderate, 30 adequate", () => {
      const makeRollup = (prCount: number) => [{
        week: "2025-W01", pr_count: prCount,
        cycle_time_p50: 60, cycle_time_p90: 120,
        authors_count: 5, reviewers_count: 3,
        by_repository: null, by_team: null,
      }];

      for (const { prCount, expected } of [
        { prCount: 9, expected: "low-sample" },
        { prCount: 10, expected: "moderate-sample" },
        { prCount: 30, expected: "adequate" },
      ]) {
        const containers = createContainers();
        const card = document.createElement("div");
        card.className = "card";
        card.appendChild(document.createElement("h3"));
        card.appendChild(containers.totalPrs!);
        document.body.appendChild(card);

        renderSummaryCards({ rollups: makeRollup(prCount), containers });

        const el = card.querySelector(".metric-sample-size")!;
        if (expected === "adequate") {
          expect(el.classList.contains("low-sample")).toBe(false);
          expect(el.classList.contains("moderate-sample")).toBe(false);
        } else {
          expect(el.classList.contains(expected)).toBe(true);
        }

        document.body.removeChild(card);
      }
    });
  });

  describe("delta period label", () => {
    it("shows 'vs prior N weeks' when windows are aligned", () => {
      const containers = createContainers();
      const card = document.createElement("div");
      card.className = "card";
      card.appendChild(document.createElement("h3"));
      card.appendChild(containers.totalPrs!);
      card.appendChild(containers.totalPrsDelta!);
      document.body.appendChild(card);

      const rollups = createRollups(8);
      const prevRollups = createRollups(8);

      renderSummaryCards({ rollups, prevRollups, containers });

      expect(containers.totalPrsDelta!.innerHTML).toContain("vs prior 8 weeks");
    });

    it("shows singular 'week' for 1 prevRollup", () => {
      const containers = createContainers();
      const card = document.createElement("div");
      card.className = "card";
      card.appendChild(document.createElement("h3"));
      card.appendChild(containers.totalPrs!);
      card.appendChild(containers.totalPrsDelta!);
      document.body.appendChild(card);

      const rollups = createRollups(1);
      const prevRollups = createRollups(1);

      renderSummaryCards({ rollups, prevRollups, containers });

      expect(containers.totalPrsDelta!.innerHTML).toContain("vs prior 1 week");
      expect(containers.totalPrsDelta!.innerHTML).not.toContain("weeks");
    });

    it("falls back to 'vs prev' when windows are mismatched", () => {
      const containers = createContainers();
      const card = document.createElement("div");
      card.className = "card";
      card.appendChild(document.createElement("h3"));
      card.appendChild(containers.totalPrs!);
      card.appendChild(containers.totalPrsDelta!);
      document.body.appendChild(card);

      const rollups = createRollups(8);
      const prevRollups = createRollups(5); // mismatch > 1

      renderSummaryCards({ rollups, prevRollups, containers });

      expect(containers.totalPrsDelta!.innerHTML).toContain("vs prev");
      expect(containers.totalPrsDelta!.innerHTML).not.toContain("vs prior");
    });

    it("tolerates off-by-one window difference", () => {
      const containers = createContainers();
      const card = document.createElement("div");
      card.className = "card";
      card.appendChild(document.createElement("h3"));
      card.appendChild(containers.totalPrs!);
      card.appendChild(containers.totalPrsDelta!);
      document.body.appendChild(card);

      const rollups = createRollups(8);
      const prevRollups = createRollups(7); // mismatch = 1 → tolerated

      renderSummaryCards({ rollups, prevRollups, containers });

      expect(containers.totalPrsDelta!.innerHTML).toContain("vs prior 7 weeks");
    });

    it("clears deltas and label when prevRollups is empty", () => {
      const containers = createContainers();
      const card = document.createElement("div");
      card.className = "card";
      card.appendChild(document.createElement("h3"));
      card.appendChild(containers.totalPrs!);
      card.appendChild(containers.totalPrsDelta!);
      document.body.appendChild(card);

      // Pre-populate delta
      containers.totalPrsDelta!.innerHTML = '<span class="delta-label">old</span>';

      renderSummaryCards({ rollups: createRollups(4), prevRollups: [], containers });

      expect(containers.totalPrsDelta!.innerHTML).toBe("");
      expect(containers.totalPrsDelta!.querySelector(".delta-label")).toBeNull();
    });

    it("sparse series: all labels match metric-specific coverage, not raw window", () => {
      const containers = createContainers();

      // Cycle P50 card
      const cycleCard = document.createElement("div");
      cycleCard.className = "card";
      cycleCard.appendChild(document.createElement("h3"));
      cycleCard.appendChild(containers.cycleP50!);
      cycleCard.appendChild(containers.cycleP50Sparkline!);
      cycleCard.appendChild(containers.cycleP50Delta!);
      document.body.appendChild(cycleCard);

      // Authors card (uses weekCount = all rollups)
      const authCard = document.createElement("div");
      authCard.className = "card";
      authCard.appendChild(document.createElement("h3"));
      authCard.appendChild(containers.authorsCount!);
      authCard.appendChild(containers.authorsSparkline!);
      authCard.appendChild(containers.authorsDelta!);
      document.body.appendChild(authCard);

      // 8 rollups, only 2 with non-null cycle_time_p50
      const rollups = Array.from({ length: 8 }, (_, i) => ({
        week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
        pr_count: 10,
        cycle_time_p50: i < 2 ? 60 + i * 10 : (null as number | null),
        cycle_time_p90: i < 2 ? 120 + i * 20 : (null as number | null),
        authors_count: 5,
        reviewers_count: 3,
        by_repository: null,
        by_team: null,
      }));
      // Previous period: same sparsity pattern
      const prevRollups = Array.from({ length: 8 }, (_, i) => ({
        week: `2024-W${(i + 45).toString().padStart(2, "0")}`,
        pr_count: 8,
        cycle_time_p50: i < 2 ? 55 + i * 10 : (null as number | null),
        cycle_time_p90: i < 2 ? 110 + i * 20 : (null as number | null),
        authors_count: 4,
        reviewers_count: 2,
        by_repository: null,
        by_team: null,
      }));

      renderSummaryCards({ rollups, prevRollups, containers });

      // Cycle P50 card: only 2 non-null weeks — all labels must say "2"
      const cycleSample = cycleCard.querySelector(".metric-sample-size");
      expect(cycleSample!.textContent).toBe("From 2 weeks of data");
      const cycleSparkline = cycleCard.querySelector(".sparkline-label");
      expect(cycleSparkline!.textContent).toBe("Last 2 weeks");
      expect(containers.cycleP50Delta!.innerHTML).toContain("vs prior 2 weeks");

      // Authors card: all 8 weeks — labels must say "8"
      const authSample = authCard.querySelector(".metric-sample-size");
      expect(authSample!.textContent).toBe("From 8 weeks of data");
      const authSparkline = authCard.querySelector(".sparkline-label");
      expect(authSparkline!.textContent).toBe("Last 8 weeks");
      expect(containers.authorsDelta!.innerHTML).toContain("vs prior 8 weeks");
    });
  });

  describe("review-time card visibility (Bug 3)", () => {
    it("hides review-time cards when filtered slice lacks review_time but global data has it", () => {
      const containers = createContainers();
      const rtCard = document.createElement("div");
      rtCard.className = "card";
      rtCard.appendChild(document.createElement("h3"));
      rtCard.appendChild(containers.reviewTimeP50!);
      document.body.appendChild(rtCard);

      // Unfiltered rollups have review_time data
      const unfilteredRollups = Array.from({ length: 4 }, (_, i) => ({
        week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
        pr_count: 10, cycle_time_p50: 60, cycle_time_p90: 120,
        review_time_p50: 900 + i * 100, review_time_p90: 1800 + i * 200,
        authors_count: 5, reviewers_count: 3,
        by_repository: null, by_team: null,
      }));

      // Filtered rollups have NO review_time data (e.g., reviewer filter zeros them)
      const rollups = Array.from({ length: 4 }, (_, i) => ({
        week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
        pr_count: 5, cycle_time_p50: null, cycle_time_p90: null,
        review_time_p50: null as number | null, review_time_p90: null as number | null,
        authors_count: 3, reviewers_count: 2,
        by_repository: null, by_team: null,
      }));

      renderSummaryCards({ rollups, unfilteredRollups, containers });

      // Card must be hidden — not showing blank "-" KPIs
      expect(rtCard.style.display).toBe("none");
      // Container must have no stale content
      expect(containers.reviewTimeP50!.textContent).toBe("");
    });

    it("shows review-time cards when filtered slice HAS review_time data", () => {
      const containers = createContainers();
      const rtCard = document.createElement("div");
      rtCard.className = "card";
      rtCard.appendChild(document.createElement("h3"));
      rtCard.appendChild(containers.reviewTimeP50!);
      document.body.appendChild(rtCard);

      const rollups = Array.from({ length: 4 }, (_, i) => ({
        week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
        pr_count: 10, cycle_time_p50: 60, cycle_time_p90: 120,
        review_time_p50: 900 + i * 100, review_time_p90: 1800,
        authors_count: 5, reviewers_count: 3,
        by_repository: null, by_team: null,
      }));

      renderSummaryCards({ rollups, containers });

      expect(rtCard.style.display).not.toBe("none");
      expect(containers.reviewTimeP50!.textContent).not.toBe("");
      expect(containers.reviewTimeP50!.textContent).not.toBe("-");
    });

    it("visibility derived from filtered rollups regardless of unfiltered data", () => {
      const containers = createContainers();
      const rtCard = document.createElement("div");
      rtCard.className = "card";
      rtCard.appendChild(document.createElement("h3"));
      rtCard.appendChild(containers.reviewTimeP50!);
      document.body.appendChild(rtCard);

      const noReviewTimeRollups = Array.from({ length: 4 }, (_, i) => ({
        week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
        pr_count: 10, cycle_time_p50: 60, cycle_time_p90: 120,
        authors_count: 5, reviewers_count: 3,
        by_repository: null, by_team: null,
      }));

      const withReviewTimeRollups = Array.from({ length: 4 }, (_, i) => ({
        week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
        pr_count: 10, cycle_time_p50: 60, cycle_time_p90: 120,
        review_time_p50: 900, review_time_p90: 1800,
        authors_count: 5, reviewers_count: 3,
        by_repository: null, by_team: null,
      }));

      // Case 1: unfilteredRollups have data, filtered don't → hidden
      renderSummaryCards({ rollups: noReviewTimeRollups, unfilteredRollups: withReviewTimeRollups, containers });
      expect(rtCard.style.display).toBe("none");

      // Case 2: no unfilteredRollups passed, filtered don't have data → still hidden
      renderSummaryCards({ rollups: noReviewTimeRollups, containers });
      expect(rtCard.style.display).toBe("none");
    });
  });
});
