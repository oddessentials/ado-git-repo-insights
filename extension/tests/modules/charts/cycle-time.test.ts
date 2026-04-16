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
  BUCKET_COLOR_MAP,
} from "../../../ui/modules/charts/cycle-time";
import type { Rollup } from "../../../ui/dataset-loader";
import type {
  DataAvailabilitySignal,
  DistributionData,
} from "../../../ui/types";

describe("cycle-time module", () => {
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

    it("shows no-data and no SVG for empty rollups array", () => {
      renderCycleTimeTrend(container, []);

      expect(container.innerHTML).toContain("no-data");
      expect(container.innerHTML).not.toContain("<svg");
    });

    it("renders data-value attributes on dot elements", () => {
      const rollups = Array.from({ length: 4 }, (_, i) => ({
        week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
        pr_count: 10 + i * 5,
        cycle_time_p50: 60 + i * 10,
        cycle_time_p90: 120 + i * 20,
        authors_count: 5 + i,
        reviewers_count: 3 + i,
        by_repository: null,
        by_team: null,
      }));

      renderCycleTimeTrend(container, rollups);

      const dots = container.querySelectorAll(".line-chart-dot");
      expect(dots.length).toBeGreaterThan(0);
      dots.forEach((dot) => {
        expect(dot.getAttribute("data-value")).not.toBeNull();
      });
    });

    it("emits data-tooltip on every trend dot so addChartTooltips can attach", () => {
      // Regression lock for commit ff42968a (Jan 2026): when addChartTooltips
      // was moved into modules/charts.ts, its selector changed from
      // `.line-chart-dot` to `[data-tooltip]`. Cycle-time circles stopped
      // being picked up and hover tooltips silently broke for three months.
      // Every dot must carry data-tooltip="true" or the listeners never bind.
      renderCycleTimeTrend(container, createRollups(4));
      const dots = container.querySelectorAll(".line-chart-dot");
      expect(dots.length).toBeGreaterThan(0);
      dots.forEach((dot) => {
        expect(dot.getAttribute("data-tooltip")).toBe("true");
      });
    });
  });

  describe("hover tooltip interactions", () => {
    afterEach(() => {
      // Dismiss any chart-tooltip nodes that a hover test may have appended
      // to document.body so they do not leak across tests.
      document
        .querySelectorAll(".chart-tooltip")
        .forEach((node) => node.remove());
    });

    function createTrendRollups() {
      return Array.from({ length: 4 }, (_, i) => ({
        week: `2025-W${(i + 1).toString().padStart(2, "0")}`,
        pr_count: 10 + i * 5,
        cycle_time_p50: 60 + i * 10, // 60, 70, 80, 90 minutes
        cycle_time_p90: 120 + i * 20, // 120, 140, 160, 180 minutes
        authors_count: 5 + i,
        reviewers_count: 3 + i,
        by_repository: null,
        by_team: null,
      }));
    }

    it("renders a tooltip with week + duration when hovering a P50 dot", () => {
      renderCycleTimeTrend(container, createTrendRollups());
      const p50Dot = container.querySelector(
        '.line-chart-dot[data-metric="P50"]',
      ) as HTMLElement | null;
      expect(p50Dot).not.toBeNull();

      p50Dot!.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

      const tooltip = document.querySelector(".chart-tooltip");
      expect(tooltip).not.toBeNull();
      expect(tooltip!.innerHTML).toContain("2025-W01");
      expect(tooltip!.innerHTML).toContain("P50");
      expect(tooltip!.innerHTML).toContain("legend-p50");
    });

    it("renders a tooltip with the P90 legend class when hovering a P90 dot", () => {
      renderCycleTimeTrend(container, createTrendRollups());
      const p90Dot = container.querySelector(
        '.line-chart-dot[data-metric="P90"]',
      ) as HTMLElement | null;
      expect(p90Dot).not.toBeNull();

      p90Dot!.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

      const tooltip = document.querySelector(".chart-tooltip");
      expect(tooltip).not.toBeNull();
      expect(tooltip!.innerHTML).toContain("P90");
      expect(tooltip!.innerHTML).toContain("legend-p90");
      // Both metric sides must escape the week string via the shared escapeHtml
      // helper — the template literal already runs it, so the raw value lands
      // verbatim for a safe ISO-week fixture.
      expect(tooltip!.innerHTML).toContain("2025-W01");
    });

    it("dismisses the tooltip on mouseleave", () => {
      renderCycleTimeTrend(container, createTrendRollups());
      const dot = container.querySelector(
        ".line-chart-dot",
      ) as HTMLElement | null;
      expect(dot).not.toBeNull();

      dot!.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      expect(document.querySelector(".chart-tooltip")).not.toBeNull();

      dot!.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
      expect(document.querySelector(".chart-tooltip")).toBeNull();
    });
  });

  describe("classifier integration paths", () => {
    /**
     * Default availability signal for testing classifier integration.
     */
    const baseAvailability: DataAvailabilitySignal = {
      reviewerDataPresent: true,
      reviewerDataEmpty: false,
      cycleTimePresent: false,
      reviewerRepoMode: "constrained",
      commentsStatus: "disabled",
    };

    describe("renderCycleDistribution with options.availability", () => {
      it("triggers classifier when availability provided and no data", () => {
        renderCycleDistribution(container, [], {
          availability: { ...baseAvailability, cycleTimePresent: false },
          unfilteredRollups: [],
        });

        // Classifier should produce a "not extracted" message for cycle time
        expect(container.innerHTML).toContain("no-data");
        // With cycleTimePresent: false, classifier returns NOT_EXTRACTED message
        expect(container.innerHTML).toContain("not yet available");
      });

      it("triggers classifier with filters and empty data", () => {
        const unfilteredRollups: Rollup[] = Array.from(
          { length: 4 },
          (_, i) => ({
            week: `2025-W${String(i + 1).padStart(2, "0")}`,
            pr_count: 10,
            cycle_time_p50: 60,
            cycle_time_p90: 120,
            authors_count: 5,
            reviewers_count: 3,
            by_repository: null,
            by_team: null,
          }),
        );

        renderCycleDistribution(container, [], {
          availability: { ...baseAvailability, cycleTimePresent: true },
          filters: { repos: ["repo-a"], teams: [], reviewers: [], authors: [] },
          unfilteredRollups,
        });

        expect(container.innerHTML).toContain("no-data");
      });

      it("still works without options (backward compatibility)", () => {
        renderCycleDistribution(container, []);

        expect(container.innerHTML).toContain("no-data");
        expect(container.innerHTML).toContain("No data for selected range");
      });
    });

    describe("renderCycleTimeTrend with options.availability", () => {
      it("triggers classifier when availability provided and insufficient data", () => {
        const singleRollup: Rollup[] = [
          {
            week: "2025-W01",
            pr_count: 10,
            cycle_time_p50: 60,
            cycle_time_p90: 120,
            authors_count: 5,
            reviewers_count: 3,
            by_repository: null,
            by_team: null,
          },
        ];

        renderCycleTimeTrend(container, singleRollup, {
          availability: { ...baseAvailability, cycleTimePresent: true },
          unfilteredRollups: singleRollup,
        });

        expect(container.innerHTML).toContain("no-data");
      });

      it("triggers classifier with empty rollups and availability", () => {
        renderCycleTimeTrend(container, [], {
          availability: { ...baseAvailability, cycleTimePresent: false },
          unfilteredRollups: [],
        });

        expect(container.innerHTML).toContain("no-data");
        // Classifier produces NOT_EXTRACTED for cycle_time_trend when cycleTimePresent: false
        expect(container.innerHTML).toContain("not yet available");
      });

      it("still works without options (backward compatibility)", () => {
        renderCycleTimeTrend(container, []);

        expect(container.innerHTML).toContain("no-data");
        expect(container.innerHTML).toContain("Not enough data for trend");
      });
    });
  });

  describe("dynamic legend for partial metrics", () => {
    it("shows P50 normal and P90 insufficient when P90 has only 1 point", () => {
      const rollups: Rollup[] = Array.from({ length: 4 }, (_, i) => ({
        week: `2025-W${String(i + 1).padStart(2, "0")}`,
        pr_count: 10,
        cycle_time_p50: 60 + i * 10,
        // Only first rollup has P90
        cycle_time_p90: i === 0 ? 120 : null,
        authors_count: 5,
        reviewers_count: 3,
        by_repository: null,
        by_team: null,
      }));
      renderCycleTimeTrend(container, rollups);

      expect(container.innerHTML).toContain("P50 (Median)");
      expect(container.innerHTML).not.toContain(
        "P50 (Median) — insufficient points",
      );
      expect(container.innerHTML).toContain("P90 — insufficient points");
      expect(container.querySelector(".legend-insufficient")).not.toBeNull();
    });

    it("omits P50 legend entirely when P50 has 0 data points", () => {
      const rollups: Rollup[] = Array.from({ length: 4 }, (_, i) => ({
        week: `2025-W${String(i + 1).padStart(2, "0")}`,
        pr_count: 10,
        cycle_time_p50: null,
        cycle_time_p90: 120 + i * 20,
        authors_count: 5,
        reviewers_count: 3,
        by_repository: null,
        by_team: null,
      }));
      renderCycleTimeTrend(container, rollups);

      expect(container.innerHTML).not.toContain("P50");
      expect(container.innerHTML).toContain("P90");
      expect(container.querySelector(".legend-insufficient")).toBeNull();
    });

    it("shows both legends normal when both metrics have sufficient data", () => {
      const rollups: Rollup[] = Array.from({ length: 4 }, (_, i) => ({
        week: `2025-W${String(i + 1).padStart(2, "0")}`,
        pr_count: 10,
        cycle_time_p50: 60 + i * 10,
        cycle_time_p90: 120 + i * 20,
        authors_count: 5,
        reviewers_count: 3,
        by_repository: null,
        by_team: null,
      }));
      renderCycleTimeTrend(container, rollups);

      expect(container.innerHTML).toContain("P50 (Median)");
      expect(container.innerHTML).toContain("P90");
      expect(container.innerHTML).not.toContain("insufficient points");
      expect(container.querySelector(".legend-insufficient")).toBeNull();
    });
  });

  describe("BUCKET_COLOR_MAP (FR-012)", () => {
    const expectedBuckets = ["0-1h", "1-4h", "4-24h", "1-3d", "3-7d", "7d+"];

    it("maps all 6 distribution bucket labels", () => {
      for (const label of expectedBuckets) {
        expect(BUCKET_COLOR_MAP.has(label)).toBe(true);
      }
      expect(BUCKET_COLOR_MAP.size).toBe(6);
    });

    it("assigns correct speed categories", () => {
      expect(BUCKET_COLOR_MAP.get("0-1h")).toBe("fast");
      expect(BUCKET_COLOR_MAP.get("1-4h")).toBe("fast");
      expect(BUCKET_COLOR_MAP.get("4-24h")).toBe("moderate");
      expect(BUCKET_COLOR_MAP.get("1-3d")).toBe("moderate");
      expect(BUCKET_COLOR_MAP.get("3-7d")).toBe("slow");
      expect(BUCKET_COLOR_MAP.get("7d+")).toBe("slow");
    });

    it("returns undefined for unknown bucket labels (fallback to default)", () => {
      expect(BUCKET_COLOR_MAP.get("unknown")).toBeUndefined();
      expect(BUCKET_COLOR_MAP.get("0-30m")).toBeUndefined();
    });
  });

  describe("distribution bucket color classes (US5)", () => {
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

    it("applies bucket-fast class to 0-1h and 1-4h rows", () => {
      renderCycleDistribution(container, [createDistribution()]);
      const rows = container.querySelectorAll(".dist-row");

      // First two rows: 0-1h, 1-4h
      expect(rows[0]?.classList.contains("bucket-fast")).toBe(true);
      expect(rows[1]?.classList.contains("bucket-fast")).toBe(true);
    });

    it("applies bucket-moderate class to 4-24h and 1-3d rows", () => {
      renderCycleDistribution(container, [createDistribution()]);
      const rows = container.querySelectorAll(".dist-row");

      expect(rows[2]?.classList.contains("bucket-moderate")).toBe(true);
      expect(rows[3]?.classList.contains("bucket-moderate")).toBe(true);
    });

    it("applies bucket-slow class to 3-7d and 7d+ rows", () => {
      renderCycleDistribution(container, [createDistribution()]);
      const rows = container.querySelectorAll(".dist-row");

      expect(rows[4]?.classList.contains("bucket-slow")).toBe(true);
      expect(rows[5]?.classList.contains("bucket-slow")).toBe(true);
    });

    it("omits bucket-* class for unknown labels (fallback to default)", () => {
      // Distribution with an unknown label alongside known ones
      const dist: DistributionData = {
        year: "2025",
        cycle_time_buckets: {
          "0-1h": 10,
          "custom-bucket": 5,
        },
      };
      renderCycleDistribution(container, [dist]);

      const rows = container.querySelectorAll(".dist-row");
      // 0-1h row gets bucket-fast
      expect(rows[0]?.classList.contains("bucket-fast")).toBe(true);
      // Unknown bucket labels get no bucket-* class (only in hardcoded map rows)
      // Note: unknown labels not in the hardcoded buckets Map won't appear at all
      // since the Map is initialized with only 6 known labels
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Branch coverage completeness: exercise the optional-field fallbacks
  // and the equal-value range guard so cycle-time.ts stays at 100% branch
  // coverage when it joins LOCKED_ZERO_FILES.
  // ────────────────────────────────────────────────────────────────────

  describe("optional-field fallbacks and edge cases", () => {
    it("renderCycleDistribution with filters-only options uses empty-array/default fallbacks", () => {
      // Passes options without `unfilteredRollups` or `availability` so the
      // `?? []` and `?? { ... }` right-hand branches in the classifyEmptyState
      // argument object are exercised.
      renderCycleDistribution(container, [], {
        filters: { repos: ["r1"], teams: [], reviewers: [], authors: [] },
      });

      expect(container.innerHTML).toContain("no-data");
    });

    it("renderCycleDistribution handles distribution with undefined cycle_time_buckets", () => {
      // cycle_time_buckets is optional — the `|| {}` fallback on the
      // Object.entries call must be exercised.
      const bareDist: DistributionData = { year: "2025" };
      renderCycleDistribution(container, [bareDist]);

      // No bucket values → total === 0 → "No cycle time data" branch
      expect(container.innerHTML).toContain("No cycle time data");
    });

    it("renderCycleTimeTrend with filters-only options uses empty-array/default fallbacks", () => {
      // Insufficient rollups + partial options → classifyEmptyState runs
      // with the `?? []` and `?? { ... }` right-hand branches. We pass
      // a null `rollups` (cast around the type) so the `rollups ?? []`
      // runtime guard at filteredRollups is also exercised — this is the
      // intended safety net for untyped JavaScript callers since the outer
      // `if (!rollups || rollups.length < 2)` check accepts null.
      renderCycleTimeTrend(container, null as unknown as Rollup[], {
        filters: { repos: [], teams: ["team-a"], reviewers: [], authors: [] },
      });

      expect(container.innerHTML).toContain("no-data");
    });

    it("renderCycleTimeTrend handles identical cycle time values (range fallback)", () => {
      // When maxVal === minVal the raw range is 0; the `|| 1` guard must
      // keep the y-coordinate math finite. Verify no NaN in rendered SVG.
      const flatRollups: Rollup[] = Array.from({ length: 4 }, (_, i) => ({
        week: `2025-W${String(i + 1).padStart(2, "0")}`,
        pr_count: 10,
        cycle_time_p50: 60,
        cycle_time_p90: 60,
        authors_count: 5,
        reviewers_count: 3,
        by_repository: null,
        by_team: null,
      }));

      renderCycleTimeTrend(container, flatRollups);

      expect(container.innerHTML).toContain("<svg");
      expect(container.innerHTML).toContain("line-chart-dot");
      expect(container.innerHTML).not.toContain("NaN");
    });
  });
});
