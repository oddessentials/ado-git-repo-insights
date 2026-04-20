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
        availability: {
          ...baseAvailability,
          reviewerDataPresent: true,
          reviewerDataEmpty: true,
        },
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

  describe("approval rate (US2)", () => {
    function createRollupsWithReviewer(approvalRate: number | null) {
      return Array.from({ length: 4 }, (_, i) => ({
        week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
        pr_count: 10,
        cycle_time_p50: 60,
        cycle_time_p90: 120,
        authors_count: 5,
        reviewers_count: 3,
        by_repository: null,
        by_team: null,
        by_reviewer: {
          "alice-id": {
            reviewed_prs: 8,
            reviews_count: 10,
            approval_rate: approvalRate,
            authors_count: 3,
            repositories_count: 2,
          },
        },
      }));
    }

    it("shows approval rate with time-period label when reviewer filter is active", () => {
      const rollups = createRollupsWithReviewer(0.78);
      renderReviewerActivity(container, rollups, {
        reviewerFilterActive: true,
        filters: { repos: [], teams: [], reviewers: ["alice-id"], authors: [] },
        unfilteredRollups: rollups,
      });

      expect(container.innerHTML).toContain("Approval Rate");
      expect(container.innerHTML).toContain("78%");
      // Time-period label must be present
      expect(container.innerHTML).toContain("(last 4 weeks)");
    });

    it("hides approval rate when reviewer filter is NOT active", () => {
      const rollups = createRollupsWithReviewer(0.78);
      renderReviewerActivity(container, rollups, {
        reviewerFilterActive: false,
      });

      expect(container.innerHTML).not.toContain("Approval Rate");
    });

    it("shows no-data state for null approval_rate", () => {
      const rollups = createRollupsWithReviewer(null);
      renderReviewerActivity(container, rollups, {
        reviewerFilterActive: true,
        filters: { repos: [], teams: [], reviewers: ["alice-id"], authors: [] },
        unfilteredRollups: rollups,
      });

      // Element present with explicit no-data indicator (not silently omitted)
      const el = container.querySelector(".approval-rate");
      expect(el).not.toBeNull();
      expect(el!.classList.contains("approval-rate-no-data")).toBe(true);
      expect(el!.textContent).toContain("No data");
      // No coverage label when no weeks contributed
      expect(el!.textContent).not.toContain("weeks");
      // Must not contain any percentage
      expect(el!.textContent).not.toMatch(/\d+%/);
    });

    it("shows 0% for approval_rate of 0.0", () => {
      const rollups = createRollupsWithReviewer(0.0);
      renderReviewerActivity(container, rollups, {
        reviewerFilterActive: true,
        filters: { repos: [], teams: [], reviewers: ["alice-id"], authors: [] },
        unfilteredRollups: rollups,
      });

      expect(container.innerHTML).toContain("Approval Rate");
      expect(container.innerHTML).toContain("0%");
    });

    it("shows 100% for approval_rate of 1.0", () => {
      const rollups = createRollupsWithReviewer(1.0);
      renderReviewerActivity(container, rollups, {
        reviewerFilterActive: true,
        filters: { repos: [], teams: [], reviewers: ["alice-id"], authors: [] },
        unfilteredRollups: rollups,
      });

      expect(container.innerHTML).toContain("Approval Rate");
      expect(container.innerHTML).toContain("100%");
    });

    it("weights approval rate by reviewed_prs, not reviews_count", () => {
      // Divergent reviewed_prs vs reviews_count with different approval rates.
      // Week 1: 5 PRs, 10 reviews, 80% approval
      // Week 2: 5 PRs, 5 reviews, 40% approval
      // Correct (PR-weighted):      (0.8×5 + 0.4×5) / (5+5) = 6/10 = 60%
      // Wrong (event-weighted):     (0.8×10 + 0.4×5) / (10+5) = 10/15 ≈ 67%
      const rollups = [
        {
          week: "2025-W01",
          pr_count: 10,
          cycle_time_p50: 60,
          cycle_time_p90: 120,
          authors_count: 5,
          reviewers_count: 3,
          by_repository: null,
          by_team: null,
          by_reviewer: {
            "alice-id": {
              reviewed_prs: 5,
              reviews_count: 10,
              approval_rate: 0.8,
              authors_count: 3,
              repositories_count: 2,
            },
          },
        },
        {
          week: "2025-W02",
          pr_count: 10,
          cycle_time_p50: 60,
          cycle_time_p90: 120,
          authors_count: 5,
          reviewers_count: 3,
          by_repository: null,
          by_team: null,
          by_reviewer: {
            "alice-id": {
              reviewed_prs: 5,
              reviews_count: 5,
              approval_rate: 0.4,
              authors_count: 3,
              repositories_count: 2,
            },
          },
        },
      ];

      renderReviewerActivity(container, rollups, {
        reviewerFilterActive: true,
        filters: { repos: [], teams: [], reviewers: ["alice-id"], authors: [] },
        unfilteredRollups: rollups,
      });

      // PR-weighted: (0.8×5 + 0.4×5) / 10 = 6/10 = 60%
      expect(container.innerHTML).toContain("Approval Rate");
      expect(container.innerHTML).toContain("60%");
      // Must NOT show the event-weighted answer
      expect(container.innerHTML).not.toContain("67%");
    });

    it("approval badge follows PR weighting when review events diverge from reviewed PRs", () => {
      // Extreme divergence: Week 1 has 1 reviewed PR but 10 events (all approved).
      // Week 2 has 10 reviewed PRs but 10 events (none approved).
      // Event-weighted: (1.0×10 + 0.0×10) / 20 = 50% ← wrong
      // PR-weighted:    (1.0×1 + 0.0×10) / 11 ≈ 9%  ← correct
      const rollups = [
        {
          week: "2025-W01",
          pr_count: 5,
          cycle_time_p50: 60,
          cycle_time_p90: 120,
          authors_count: 3,
          reviewers_count: 2,
          by_repository: null,
          by_team: null,
          by_reviewer: {
            "alice-id": {
              reviewed_prs: 1,
              reviews_count: 10,
              approval_rate: 1.0,
              authors_count: 1,
              repositories_count: 1,
            },
          },
        },
        {
          week: "2025-W02",
          pr_count: 15,
          cycle_time_p50: 80,
          cycle_time_p90: 160,
          authors_count: 5,
          reviewers_count: 3,
          by_repository: null,
          by_team: null,
          by_reviewer: {
            "alice-id": {
              reviewed_prs: 10,
              reviews_count: 10,
              approval_rate: 0.0,
              authors_count: 5,
              repositories_count: 3,
            },
          },
        },
      ];

      renderReviewerActivity(container, rollups, {
        reviewerFilterActive: true,
        filters: { repos: [], teams: [], reviewers: ["alice-id"], authors: [] },
        unfilteredRollups: rollups,
      });

      // PR-weighted: (1.0×1 + 0.0×10) / 11 = 1/11 ≈ 0.0909 → 9%
      expect(container.innerHTML).toContain("9%");
      // Must NOT show event-weighted 50%
      expect(container.innerHTML).not.toContain("50%");
    });

    it("approval rate reflects only the displayed 8-week window, not full range", () => {
      // 12 weeks: first 4 have 50% approval, last 8 have 90% approval
      const rollups = Array.from({ length: 12 }, (_, i) => ({
        week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
        pr_count: 10,
        cycle_time_p50: 60,
        cycle_time_p90: 120,
        authors_count: 5,
        reviewers_count: 3,
        by_repository: null,
        by_team: null,
        by_reviewer: {
          "alice-id": {
            reviewed_prs: 10,
            reviews_count: 12,
            approval_rate: i < 4 ? 0.5 : 0.9,
            authors_count: 3,
            repositories_count: 2,
          },
        },
      }));

      renderReviewerActivity(container, rollups, {
        reviewerFilterActive: true,
        filters: { repos: [], teams: [], reviewers: ["alice-id"], authors: [] },
        unfilteredRollups: rollups,
      });

      // Chart shows last 8 weeks (W05-W12), all with 0.9 approval
      // Badge must show 90%, NOT the full-range average that includes the 0.5 weeks
      expect(container.innerHTML).toContain("Approval Rate");
      expect(container.innerHTML).toContain("90%");
      expect(container.innerHTML).not.toContain("Approval Rate: 77%"); // would be ~77% if full range used
    });

    it("approval rate label uses metric-specific coverage, not chart window size", () => {
      // 12 weeks input → chart displays last 8 (MAX_REVIEWER_WEEKS)
      // All 8 visible weeks have approval_rate → badge says "(from 8 weeks of data)"
      const rollups = createRollupsWithReviewer(0.85);
      const longRollups = [
        ...rollups,
        ...rollups,
        ...rollups, // 12 weeks
      ].map((r, i) => ({
        ...r,
        week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
      }));

      renderReviewerActivity(container, longRollups, {
        reviewerFilterActive: true,
        filters: { repos: [], teams: [], reviewers: ["alice-id"], authors: [] },
        unfilteredRollups: longRollups,
      });

      const badge = container.querySelector(".approval-rate");
      expect(badge).not.toBeNull();
      expect(badge!.getAttribute("data-weeks")).toBe("8");
      expect(badge!.textContent).toContain("(from 8 weeks of data)");

      // Short input: 3 weeks → all have data, label says "(from 3 weeks of data)"
      container.innerHTML = "";
      const shortRollups = createRollupsWithReviewer(0.9).slice(0, 3);
      renderReviewerActivity(container, shortRollups, {
        reviewerFilterActive: true,
        filters: { repos: [], teams: [], reviewers: ["alice-id"], authors: [] },
        unfilteredRollups: shortRollups,
      });

      const badge2 = container.querySelector(".approval-rate");
      expect(badge2!.getAttribute("data-weeks")).toBe("3");
      expect(badge2!.textContent).toContain("(from 3 weeks of data)");
    });

    it("badge shows metric-specific coverage when only some weeks have approval data", () => {
      // 8 visible weeks, only 3 with approval_rate data for the reviewer
      const rollups = Array.from({ length: 8 }, (_, i) => ({
        week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
        pr_count: 10,
        cycle_time_p50: 60,
        cycle_time_p90: 120,
        authors_count: 5,
        reviewers_count: 3,
        by_repository: null,
        by_team: null,
        by_reviewer:
          i < 3
            ? {
                "alice-id": {
                  reviewed_prs: 5,
                  reviews_count: 6,
                  approval_rate: 0.8,
                  authors_count: 3,
                  repositories_count: 2,
                },
              }
            : null,
      }));

      renderReviewerActivity(container, rollups, {
        reviewerFilterActive: true,
        filters: { repos: [], teams: [], reviewers: ["alice-id"], authors: [] },
        unfilteredRollups: rollups,
      });

      const badge = container.querySelector(".approval-rate");
      expect(badge).not.toBeNull();
      // Must say "from 3 weeks of data", NOT "last 8 weeks"
      expect(badge!.getAttribute("data-weeks")).toBe("3");
      expect(badge!.textContent).toContain("(from 3 weeks of data)");
      expect(badge!.textContent).not.toContain("8 weeks");
      expect(badge!.textContent).toContain("80%");
    });

    it("approval badge uses first reviewer only when multiple are selected", () => {
      const rollups = [
        {
          week: "2025-W01",
          pr_count: 20,
          cycle_time_p50: 60,
          cycle_time_p90: 120,
          authors_count: 5,
          reviewers_count: 4,
          by_repository: null,
          by_team: null,
          by_reviewer: {
            "alice-id": {
              reviewed_prs: 5,
              reviews_count: 5,
              approval_rate: 0.8,
              authors_count: 3,
              repositories_count: 2,
            },
            "bob-id": {
              reviewed_prs: 5,
              reviews_count: 5,
              approval_rate: 0.2,
              authors_count: 3,
              repositories_count: 2,
            },
          },
        },
      ];

      // Multi-select: alice first
      renderReviewerActivity(container, rollups, {
        reviewerFilterActive: true,
        filters: {
          repos: [],
          teams: [],
          reviewers: ["alice-id", "bob-id"],
          authors: [],
        },
        unfilteredRollups: rollups,
      });

      // First-reviewer-only: alice's 80%
      // All-reviewer blend would be (0.8×5 + 0.2×5) / 10 = 50%
      expect(container.innerHTML).toContain("80%");
      expect(container.innerHTML).not.toContain("50%");
    });

    it("only first reviewer is used — explicit scope lock", () => {
      const rollups = [
        {
          week: "2025-W01",
          pr_count: 20,
          cycle_time_p50: 60,
          cycle_time_p90: 120,
          authors_count: 5,
          reviewers_count: 4,
          by_repository: null,
          by_team: null,
          by_reviewer: {
            "alice-id": {
              reviewed_prs: 5,
              reviews_count: 5,
              approval_rate: 0.8,
              authors_count: 3,
              repositories_count: 2,
            },
            "bob-id": {
              reviewed_prs: 5,
              reviews_count: 5,
              approval_rate: 0.2,
              authors_count: 3,
              repositories_count: 2,
            },
          },
        },
      ];

      // Bob first this time
      renderReviewerActivity(container, rollups, {
        reviewerFilterActive: true,
        filters: {
          repos: [],
          teams: [],
          reviewers: ["bob-id", "alice-id"],
          authors: [],
        },
        unfilteredRollups: rollups,
      });

      // Must show bob's rate (20%), not alice's (80%)
      expect(container.innerHTML).toContain("20%");
      expect(container.innerHTML).not.toContain("80%");
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Branch coverage completeness: exercise every remaining partial so
  // reviewer-activity.ts can join LOCKED_ZERO_FILES. Each test targets
  // a specific `??`/ `if` / `<= 0` path that existing tests leave alone.
  // ────────────────────────────────────────────────────────────────────

  describe("optional-field fallbacks and approval rate edge cases", () => {
    const baseAvailability: DataAvailabilitySignal = {
      reviewerDataPresent: true,
      reviewerDataEmpty: false,
      cycleTimePresent: true,
      reviewerRepoMode: "constrained",
      commentsStatus: "disabled",
    };

    it("handles null rollups with availability-only options (rollups + unfilteredRollups fallbacks)", () => {
      // rollups is null and options omits unfilteredRollups, so both
      // `unfilteredRollups ?? []` and `rollups ?? []` right-hand branches
      // in the empty-data classifier block fire.
      renderReviewerActivity(container, null as unknown as Rollup[], {
        availability: baseAvailability,
      });

      expect(container.innerHTML).toContain("no-data");
    });

    it("handles all-zero reviewers_count with availability-only options (unfilteredRollups fallback in second classifier block)", () => {
      // Non-empty rollups where every reviewers_count is 0 take the
      // `maxReviewers === 0` branch. Passing availability without
      // unfilteredRollups exercises the second `options.unfilteredRollups
      // ?? []` fallback on that path.
      const zeroRollups: Rollup[] = Array.from({ length: 3 }, (_, i) => ({
        week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
        pr_count: 10,
        cycle_time_p50: 60,
        cycle_time_p90: 120,
        authors_count: 5,
        reviewers_count: 0,
        by_repository: null,
        by_team: null,
      }));

      renderReviewerActivity(container, zeroRollups, {
        availability: baseAvailability,
      });

      expect(container.innerHTML).toContain("no-data");
    });

    it("skips reviewers that are absent from the by_reviewer map", () => {
      // Filter requests "ghost-id", but the rollup only has alice-id in
      // its by_reviewer map. computeApprovalRate's `if (!entry) continue`
      // truthy branch fires, leaving totalPrs at 0 → null rate path.
      const rollups: Rollup[] = [
        {
          week: "2025-W01",
          pr_count: 10,
          cycle_time_p50: 60,
          cycle_time_p90: 120,
          authors_count: 5,
          reviewers_count: 3,
          by_repository: null,
          by_team: null,
          by_reviewer: {
            "alice-id": {
              reviewed_prs: 8,
              reviews_count: 10,
              approval_rate: 0.9,
              authors_count: 3,
              repositories_count: 2,
            },
          },
        },
      ];

      renderReviewerActivity(container, rollups, {
        reviewerFilterActive: true,
        filters: { repos: [], teams: [], reviewers: ["ghost-id"], authors: [] },
        unfilteredRollups: rollups,
      });

      const el = container.querySelector(".approval-rate");
      expect(el).not.toBeNull();
      expect(el!.classList.contains("approval-rate-no-data")).toBe(true);
    });

    it("skips reviewer entries whose reviewed_prs is zero", () => {
      // `prs <= 0 → continue` truthy branch. Rate stays null → no-data.
      const rollups: Rollup[] = [
        {
          week: "2025-W01",
          pr_count: 10,
          cycle_time_p50: 60,
          cycle_time_p90: 120,
          authors_count: 5,
          reviewers_count: 3,
          by_repository: null,
          by_team: null,
          by_reviewer: {
            "alice-id": {
              reviewed_prs: 0,
              reviews_count: 0,
              approval_rate: 0.9,
              authors_count: 3,
              repositories_count: 2,
            },
          },
        },
      ];

      renderReviewerActivity(container, rollups, {
        reviewerFilterActive: true,
        filters: { repos: [], teams: [], reviewers: ["alice-id"], authors: [] },
        unfilteredRollups: rollups,
      });

      const el = container.querySelector(".approval-rate");
      expect(el).not.toBeNull();
      expect(el!.classList.contains("approval-rate-no-data")).toBe(true);
    });

    it("treats reviewer entries with null reviewed_prs as zero via the ?? fallback", () => {
      // Cast around the schema's `reviewed_prs: number` so we can feed a
      // nullish value. `?? 0` right side fires, then `0 <= 0` → continue,
      // leaving the rate at null. Defensive runtime behavior against
      // partially-malformed rollups from older extracts.
      const rollups: Rollup[] = [
        {
          week: "2025-W01",
          pr_count: 10,
          cycle_time_p50: 60,
          cycle_time_p90: 120,
          authors_count: 5,
          reviewers_count: 3,
          by_repository: null,
          by_team: null,
          by_reviewer: {
            "alice-id": {
              reviewed_prs: null as unknown as number,
              reviews_count: 4,
              approval_rate: 0.9,
              authors_count: 3,
              repositories_count: 2,
            },
          },
        },
      ];

      renderReviewerActivity(container, rollups, {
        reviewerFilterActive: true,
        filters: { repos: [], teams: [], reviewers: ["alice-id"], authors: [] },
        unfilteredRollups: rollups,
      });

      const el = container.querySelector(".approval-rate");
      expect(el).not.toBeNull();
      expect(el!.classList.contains("approval-rate-no-data")).toBe(true);
    });
  });

  // PR #302 P1.F — gating note disclosing that drill-down requires a
  // reviewer filter. Without this note, reviewer rows without a filter
  // look interactive but clicks are no-ops (narrowed-scope decision #4).
  // Plain <p> (no role / no aria-live) — see
  // `extension/ui/modules/charts/reviewer-activity.ts` comment at the
  // gating-note branch for the a11y rationale.
  describe("reviewer-gating-note (PR #302 P1.F)", () => {
    it("renders the gating note when no reviewer filter is active", () => {
      renderReviewerActivity(container, createRollups(4), {
        reviewerFilterActive: false,
      });

      const note = container.querySelector<HTMLElement>(
        ".reviewer-gating-note",
      );
      expect(note).not.toBeNull();
      expect(note!.textContent).toBe(
        "Filter to a reviewer to drill into weekly activity.",
      );
    });

    it("omits the gating note when the reviewer filter is active", () => {
      renderReviewerActivity(container, createRollups(4), {
        reviewerFilterActive: true,
        filters: {
          repos: [],
          teams: [],
          reviewers: ["alice-id"],
          authors: [],
        },
      });

      expect(container.querySelector(".reviewer-gating-note")).toBeNull();
    });

    it("gating note carries NO ARIA role (steady-state body text, not a live region)", () => {
      renderReviewerActivity(container, createRollups(4), {
        reviewerFilterActive: false,
      });

      const note = container.querySelector<HTMLElement>(
        ".reviewer-gating-note",
      );
      expect(note).not.toBeNull();
      expect(note!.hasAttribute("role")).toBe(false);
    });

    it("gating note carries NO aria-live attribute (filter-UI owns the transition announcement)", () => {
      renderReviewerActivity(container, createRollups(4), {
        reviewerFilterActive: false,
      });

      const note = container.querySelector<HTMLElement>(
        ".reviewer-gating-note",
      );
      expect(note).not.toBeNull();
      expect(note!.hasAttribute("aria-live")).toBe(false);
    });
  });
});
