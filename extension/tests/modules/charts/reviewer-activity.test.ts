/**
 * Reviewer Activity Chart Module Tests
 *
 * JSDOM behavior tests for renderReviewerActivity.
 * Tests chart render contracts:
 * - Horizontal bars rendered
 * - Takes last 8 weeks
 * - No-data message when empty
 */

import { renderReviewerActivity } from "../../../ui/modules/charts/reviewer-activity";
import type { Rollup } from "../../../ui/dataset-loader";
import type { DataAvailabilitySignal } from "../../../ui/types";

describe("reviewer-activity module", () => {
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

  /**
   * Create sample rollups for testing.
   */
  function createRollups(count: number = 10): Rollup[] {
    return Array.from({ length: count }, (_, i) => ({
      week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
      pr_count: 10 + i * 5,
      cycle_time_p50: 60 + i * 10,
      cycle_time_p90: 120 + i * 20,
      authors_count: 5 + i,
      reviewers_count: 3 + i, // 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
      by_repository: null,
      by_team: null,
    }));
  }

  describe("renderReviewerActivity", () => {
    it("renders horizontal bar chart container", () => {
      renderReviewerActivity(container, createRollups(4));

      expect(container.innerHTML).toContain("horizontal-bar-chart");
    });

    it("renders bar rows for each week", () => {
      const rollups = createRollups(4);
      renderReviewerActivity(container, rollups);

      const rows = container.querySelectorAll(".h-bar-row");
      expect(rows.length).toBe(4);
    });

    it("takes only last 8 weeks when more data provided", () => {
      const rollups = createRollups(12); // Create 12 weeks
      renderReviewerActivity(container, rollups);

      const rows = container.querySelectorAll(".h-bar-row");
      expect(rows.length).toBe(8);

      // Should show weeks 05-12 (last 8), not 01-04
      expect(container.innerHTML).toContain("W05");
      expect(container.innerHTML).toContain("W12");
      expect(container.innerHTML).not.toContain("W01");
    });

    it("renders week labels with W prefix", () => {
      renderReviewerActivity(container, createRollups(3));

      expect(container.innerHTML).toContain("W01");
      expect(container.innerHTML).toContain("W02");
      expect(container.innerHTML).toContain("W03");
    });

    it("renders reviewer count values", () => {
      const rollups = createRollups(2);
      renderReviewerActivity(container, rollups);

      // First rollup has reviewers_count: 3, second: 4
      expect(container.innerHTML).toContain(">3</span>");
      expect(container.innerHTML).toContain(">4</span>");
    });

    it("sets bar width based on max reviewer count", () => {
      const rollups: Rollup[] = [
        {
          week: "2025-W01",
          pr_count: 10,
          cycle_time_p50: 60,
          cycle_time_p90: 120,
          authors_count: 5,
          reviewers_count: 5, // half of max
          by_repository: null,
          by_team: null,
        },
        {
          week: "2025-W02",
          pr_count: 15,
          cycle_time_p50: 70,
          cycle_time_p90: 140,
          authors_count: 6,
          reviewers_count: 10, // max
          by_repository: null,
          by_team: null,
        },
      ];

      renderReviewerActivity(container, rollups);

      // Second bar should have 100% width
      expect(container.innerHTML).toContain("width: 100%");
      // First bar should have 50% width
      expect(container.innerHTML).toContain("width: 50%");
    });

    it("includes reviewer count in title attribute", () => {
      const rollups = createRollups(2);
      renderReviewerActivity(container, rollups);

      // First rollup: week 2025-W01, 3 reviewers
      expect(container.innerHTML).toContain('title="2025-W01: 3 reviewers"');
    });

    it("shows no-data message for empty rollups", () => {
      renderReviewerActivity(container, []);

      expect(container.innerHTML).toContain("no-data");
      expect(container.innerHTML).toContain("No reviewer data available");
    });

    it("shows no-data message when all reviewers counts are zero", () => {
      const rollups = createRollups(3).map((r) => ({
        ...r,
        reviewers_count: 0,
      }));

      renderReviewerActivity(container, rollups);

      expect(container.innerHTML).toContain("No reviewer data available");
    });

    it("uses reviewer-activity copy when reviewer filter is active", () => {
      renderReviewerActivity(container, createRollups(2), {
        reviewerFilterActive: true,
      });

      expect(container.innerHTML).toContain("Review activity per week");
      expect(container.innerHTML).toContain('title="2025-W01: 3 reviews"');
    });

    it("shows reviewer-activity no-data message when reviewer filter is active", () => {
      renderReviewerActivity(container, [], { reviewerFilterActive: true });

      expect(container.innerHTML).toContain("No review activity available");
      expect(container.innerHTML).toContain(
        "Try widening the date range or adjusting reviewer filters.",
      );
      expect(container.innerHTML).not.toContain(
        "Reviewer data requires the extraction pipeline to capture reviewer details.",
      );
    });

    it("suppresses pipeline hint for zero-count rollups when reviewer filter is active", () => {
      const rollups = createRollups(3).map((r) => ({
        ...r,
        reviewers_count: 0,
      }));

      renderReviewerActivity(container, rollups, {
        reviewerFilterActive: true,
      });

      expect(container.innerHTML).toContain("No review activity available");
      expect(container.innerHTML).toContain(
        "Try widening the date range or adjusting reviewer filters.",
      );
      expect(container.innerHTML).not.toContain(
        "Reviewer data requires the extraction pipeline to capture reviewer details.",
      );
    });

    it("keeps pipeline hint for unfiltered empty reviewer data", () => {
      renderReviewerActivity(container, []);

      expect(container.innerHTML).toContain(
        "Try widening the date range or adjusting repository/team filters.",
      );
      expect(container.innerHTML).not.toContain(
        "Reviewer data requires the extraction pipeline to capture reviewer details.",
      );
    });

    it("shows pipeline hint for unfiltered zero-count reviewer data", () => {
      const rollups = createRollups(2).map((r) => ({
        ...r,
        reviewers_count: 0,
      }));

      renderReviewerActivity(container, rollups);

      expect(container.innerHTML).toContain(
        "Reviewer data requires the extraction pipeline to capture reviewer details.",
      );
      expect(container.innerHTML).not.toContain(
        "Try widening the date range or adjusting repository/team filters.",
      );
    });

    it("handles null container gracefully", () => {
      expect(() => {
        renderReviewerActivity(null, createRollups(4));
      }).not.toThrow();
    });

    it("renders standard week format label from W-suffix", () => {
      const rollups: Rollup[] = [
        {
          week: "2025-W03",
          pr_count: 10,
          cycle_time_p50: 60,
          cycle_time_p90: 120,
          authors_count: 5,
          reviewers_count: 8,
          by_repository: null,
          by_team: null,
        },
      ];

      renderReviewerActivity(container, rollups);

      expect(container.innerHTML).toContain("W03");
    });

    it("uses full string for non-standard week format", () => {
      const rollups: Rollup[] = [
        {
          week: "custom_format",
          pr_count: 10,
          cycle_time_p50: 60,
          cycle_time_p90: 120,
          authors_count: 5,
          reviewers_count: 8,
          by_repository: null,
          by_team: null,
        },
      ];

      renderReviewerActivity(container, rollups);

      expect(container.innerHTML).toContain("Wcustom_format");
    });
  });

  describe("classifier integration paths", () => {
    const baseAvailability: DataAvailabilitySignal = {
      reviewerDataPresent: false,
      reviewerDataEmpty: false,
      cycleTimePresent: true,
      reviewerRepoMode: "constrained",
      commentsStatus: "disabled",
    };

    it("renderReviewerActivity with availability triggers classifier path for empty rollups", () => {
      renderReviewerActivity(container, [], {
        availability: { ...baseAvailability, reviewerDataPresent: false },
        unfilteredRollups: [],
      });

      expect(container.innerHTML).toContain("no-data");
      // Classifier with reviewerDataPresent: false produces NOT_EXTRACTED message
      expect(container.innerHTML).toContain("not yet available");
    });

    it("renderReviewerActivity with availability triggers classifier for zero-count rollups", () => {
      const rollups = createRollups(3).map((r) => ({
        ...r,
        reviewers_count: 0,
      }));

      renderReviewerActivity(container, rollups, {
        availability: { ...baseAvailability, reviewerDataPresent: true, reviewerDataEmpty: true },
        unfilteredRollups: rollups,
      });

      expect(container.innerHTML).toContain("no-data");
    });

    it("fallback hints match legacy behavior when no availability provided", () => {
      // Empty rollups without availability — uses fallback path
      renderReviewerActivity(container, []);

      expect(container.innerHTML).toContain("No reviewer data available");
      expect(container.innerHTML).toContain(
        "Try widening the date range or adjusting repository/team filters.",
      );
    });

    it("fallback hints match legacy behavior for zero-count without availability", () => {
      const rollups = createRollups(2).map((r) => ({
        ...r,
        reviewers_count: 0,
      }));

      renderReviewerActivity(container, rollups);

      expect(container.innerHTML).toContain("No reviewer data available");
      expect(container.innerHTML).toContain(
        "Reviewer data requires the extraction pipeline to capture reviewer details.",
      );
    });

    it("classifier path with active filters and availability", () => {
      const unfilteredRollups = createRollups(4);

      renderReviewerActivity(container, [], {
        availability: { ...baseAvailability, reviewerDataPresent: true },
        filters: { repos: ["repo-a"], teams: [], reviewers: [], authors: [] },
        unfilteredRollups,
      });

      expect(container.innerHTML).toContain("no-data");
    });
  });
});
