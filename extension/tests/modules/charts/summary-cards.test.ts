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

    it("skips label when fewer than 2 data points (sparkline not rendered)", () => {
      const containers = createContainers();
      const card = document.createElement("div");
      card.className = "card";
      card.appendChild(document.createElement("h3"));
      card.appendChild(containers.totalPrs!);
      card.appendChild(containers.totalPrsSparkline!);
      document.body.appendChild(card);

      renderSummaryCards({ rollups: createRollups(1), containers });

      // renderSparkline requires >= 2 points; label should not appear
      const label = card.querySelector(".sparkline-label");
      expect(label).toBeNull();
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

    it("aggregate cards show 'From N weeks', not 'Based on N PRs'", () => {
      const containers = createContainers();
      // Aggregate card (cycle time — derived from weekly rollups)
      const aggCard = document.createElement("div");
      aggCard.className = "card";
      aggCard.appendChild(document.createElement("h3"));
      aggCard.appendChild(containers.cycleP50!);
      document.body.appendChild(aggCard);

      // Total PRs card (PR count — directly from data)
      const prCard = document.createElement("div");
      prCard.className = "card";
      prCard.appendChild(document.createElement("h3"));
      prCard.appendChild(containers.totalPrs!);
      document.body.appendChild(prCard);

      renderSummaryCards({ rollups: createRollups(4), containers });

      const aggSample = aggCard.querySelector(".metric-sample-size");
      const prSample = prCard.querySelector(".metric-sample-size");

      // Aggregate card: week-based label
      expect(aggSample!.textContent).toBe("From 4 weeks");
      // Total PRs card: PR-based label
      expect(prSample!.textContent).toBe("Based on 70 PRs");
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

    it("review-time cards show week count from non-null data, not total PRs", () => {
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

      // 4 rollups but only 2 have review_time data
      const rollups = [
        { week: "2025-W01", pr_count: 20, cycle_time_p50: 60, cycle_time_p90: 120, review_time_p50: 30, review_time_p90: 60, authors_count: 5, reviewers_count: 3, by_repository: null, by_team: null },
        { week: "2025-W02", pr_count: 25, cycle_time_p50: 45, cycle_time_p90: 90, review_time_p50: null, review_time_p90: null, authors_count: 7, reviewers_count: 4, by_repository: null, by_team: null },
        { week: "2025-W03", pr_count: 15, cycle_time_p50: 50, cycle_time_p90: 100, review_time_p50: 45, review_time_p90: 90, authors_count: 6, reviewers_count: 3, by_repository: null, by_team: null },
        { week: "2025-W04", pr_count: 30, cycle_time_p50: 55, cycle_time_p90: 110, review_time_p50: null, review_time_p90: null, authors_count: 8, reviewers_count: 5, by_repository: null, by_team: null },
      ];

      renderSummaryCards({ rollups, containers });

      // Total PRs card: PR-based label
      const prSample = prCard.querySelector(".metric-sample-size");
      expect(prSample!.textContent).toBe("Based on 90 PRs");

      // Review-time card: week-based label, only 2 weeks have non-null p50
      const rtSample = rtCard.querySelector(".metric-sample-size");
      expect(rtSample!.textContent).toBe("From 2 weeks");
    });

    it("sparkline label shows calendar span of consecutive non-null data", () => {
      const containers = createContainers();
      const card = document.createElement("div");
      card.className = "card";
      card.appendChild(document.createElement("h3"));
      card.appendChild(containers.reviewTimeP50!);
      card.appendChild(containers.reviewTimeP50Sparkline!);
      document.body.appendChild(card);

      // 8 rollups, only first 3 have non-null review_time_p50 (indices 0,1,2)
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

      // 3 consecutive points at indices 0-2 → span = 3
      const label = card.querySelector(".sparkline-label");
      expect(label).not.toBeNull();
      expect(label!.textContent).toBe("Last 3 weeks");
    });

    it("sparse series label reflects calendar span, not point count", () => {
      const containers = createContainers();
      const card = document.createElement("div");
      card.className = "card";
      card.appendChild(document.createElement("h3"));
      card.appendChild(containers.reviewTimeP50!);
      card.appendChild(containers.reviewTimeP50Sparkline!);
      document.body.appendChild(card);

      // 8 rollups, non-null at indices 0, 3, 7 (scattered across 8-week span)
      const rollups = Array.from({ length: 8 }, (_, i) => ({
        week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
        pr_count: 10,
        cycle_time_p50: 60,
        cycle_time_p90: 120,
        review_time_p50: (i === 0 || i === 3 || i === 7) ? 30 + i * 10 : null as number | null,
        review_time_p90: null as number | null,
        authors_count: 5,
        reviewers_count: 3,
        by_repository: null,
        by_team: null,
      }));

      renderSummaryCards({ rollups, containers });

      // 3 points but spanning indices 0-7 → calendar span = 8
      const label = card.querySelector(".sparkline-label");
      expect(label).not.toBeNull();
      expect(label!.textContent).toBe("Last 8 weeks");
    });

    it("P50 card count excludes weeks where only P90 exists", () => {
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

      const rollups = [
        { week: "2025-W01", pr_count: 10, cycle_time_p50: 60, cycle_time_p90: 120, review_time_p50: 30, review_time_p90: 60, authors_count: 5, reviewers_count: 3, by_repository: null, by_team: null },
        { week: "2025-W02", pr_count: 15, cycle_time_p50: 45, cycle_time_p90: 90, review_time_p50: null, review_time_p90: 90, authors_count: 7, reviewers_count: 4, by_repository: null, by_team: null },
        { week: "2025-W03", pr_count: 20, cycle_time_p50: 50, cycle_time_p90: 100, review_time_p50: 45, review_time_p90: null, authors_count: 6, reviewers_count: 3, by_repository: null, by_team: null },
      ];

      renderSummaryCards({ rollups, containers });

      // P50 card: only weeks 1 and 3 have p50 → 2 weeks
      const p50Sample = p50Card.querySelector(".metric-sample-size");
      expect(p50Sample!.textContent).toBe("From 2 weeks");

      // P90 card: only weeks 1 and 2 have p90 → 2 weeks
      const p90Sample = p90Card.querySelector(".metric-sample-size");
      expect(p90Sample!.textContent).toBe("From 2 weeks");
    });

    it("non-Total-PR cards must not render 'Based on N PRs'", () => {
      const containers = createContainers();
      const aggregateEls = [
        containers.cycleP50!,
        containers.cycleP90!,
        containers.authorsCount!,
        containers.reviewersCount!,
      ];
      const cards: HTMLElement[] = [];
      for (const el of aggregateEls) {
        const card = document.createElement("div");
        card.className = "card";
        card.appendChild(document.createElement("h3"));
        card.appendChild(el);
        document.body.appendChild(card);
        cards.push(card);
      }

      renderSummaryCards({ rollups: createRollups(8), containers });

      for (const card of cards) {
        const label = card.querySelector(".metric-sample-size")?.textContent ?? "";
        expect(label).not.toContain("Based on");
        expect(label).not.toContain("PRs");
        expect(label).toContain("weeks");
      }
    });
  });
});
