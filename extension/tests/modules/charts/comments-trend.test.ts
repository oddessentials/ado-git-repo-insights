/**
 * Comments-Trend Chart Module Tests
 *
 * JSDOM behavior tests for renderCommentsTrendChart (T015 — TDD scaffold).
 *
 * Covers FR-1-01..06 + FR-2-06 cases (v) and (vi) + chart-layer idempotency:
 *   (a) 12 stacked bars + overlaid line + 3-series legend on a 12-week fixture.
 *   (b) Range filter narrowing → 6 bars, legend stable, line re-rendered.
 *   (c) Truncation indicator surfaces when input exceeds MAX_COMMENTS_TREND_POINTS.
 *   (d) FR-2-06 case (v) — qualifier applied ONLY to partial-marked weeks.
 *   (e) FR-2-06 case (vi) — all-unextracted week renders bar in DOM with
 *       zero-height segments + qualifier; line connects through zero point.
 *   (f) Each bar carries `data-drilldown-week` matching the rollup's week.
 *   (g) Each bar has accessibility attributes (tabindex, role=button,
 *       aria-label, aria-expanded) per the throughput chart's contract.
 *   (h) Round-12 chart-layer content idempotency — calling
 *       renderCommentsTrendChart twice on the same container yields ONE chart,
 *       not two.
 *
 * TDD INTENT: This file is authored for T015 BEFORE T016 implements
 * `extension/ui/modules/charts/comments-trend.ts`. All tests MUST currently
 * FAIL at import time with "Cannot find module ../../../ui/modules/charts/
 * comments-trend". After T016 lands, all 8 tests are expected to pass.
 *
 * Imagined API (T016 to match):
 *   export const MAX_COMMENTS_TREND_POINTS: 104;
 *   export function renderCommentsTrendChart(
 *     container: HTMLElement | null,
 *     rollups: Rollup[],
 *     options?: { filters?: FilterState; ... },
 *   ): void;
 *
 * Partial-coverage rendering convention (test asserts both, T016/T018 to
 * implement either or both per ADR T005):
 *   - CSS class `coverage-partial` applied to the bar's `.bar-container`.
 *   - Data attribute `data-coverage-partial="true"` on the bar's
 *     `.bar-container`.
 * The qualifier MUST be applied only when `rollup[W].comments.coverage_partial
 * === true`; non-partial bars MUST NOT carry it (FR-1-04).
 */

import {
  renderCommentsTrendChart,
  MAX_COMMENTS_TREND_POINTS,
} from "../../../ui/modules/charts/comments-trend";
import { installThroughputDrilldown } from "../../../ui/modules/drilldown/throughput-drilldown";
import {
  publishComparisonToggled,
  publishFiltersChanged,
} from "../../../ui/modules/drilldown/lifecycle-signals";
import { __resetComparisonAdvisoryForTests } from "../../../ui/modules/drilldown/comparison-advisory";
import {
  dismissDetailPanel,
  isDetailPanelOpen,
} from "../../../ui/modules/shared/detail-panel";
import type { Rollup } from "../../../ui/dataset-loader";
import type { FilterState } from "../../../ui/modules/filters";

// jsdom lacks PointerEvent — mirror the polyfill used by other drill-down
// tests so synthesized pointer sequences (tap activation in T023) work.
if (typeof PointerEvent === "undefined") {
  (globalThis as Record<string, unknown>).PointerEvent =
    class PointerEvent extends MouseEvent {
      constructor(type: string, init?: PointerEventInit) {
        super(type, init);
      }
    };
}

void publishFiltersChanged; // imported for symmetry with throughput tests; not exercised here

/**
 * Build a Rollup with a `comments` sub-object populated per the FR-2-06
 * contract: four atomic fields (thread_count, comment_count,
 * active_thread_count, coverage_partial). active_thread_count <=
 * thread_count is preserved per INV-1-06.
 */
function makeCommentsRollup(
  index: number,
  options: {
    thread_count?: number;
    comment_count?: number;
    active_thread_count?: number;
    coverage_partial?: boolean;
  } = {},
): Rollup {
  const threadCount = options.thread_count ?? 5 + index;
  const activeThreadCount =
    options.active_thread_count ?? Math.min(2, threadCount);
  return {
    week: `2025-W${String(index + 1).padStart(2, "0")}`,
    pr_count: 10 + index * 2,
    cycle_time_p50: 60 + index * 5,
    cycle_time_p90: 120 + index * 10,
    authors_count: 4 + index,
    reviewers_count: 3 + index,
    by_repository: null,
    by_team: null,
    comments: {
      thread_count: threadCount,
      comment_count: options.comment_count ?? threadCount * 4,
      active_thread_count: activeThreadCount,
      coverage_partial: options.coverage_partial ?? false,
    },
  };
}

/** Build a sequence of N comments-bearing rollups. */
function makeCommentsRollups(count: number): Rollup[] {
  return Array.from({ length: count }, (_, i) => makeCommentsRollup(i));
}

/** Build an empty FilterState. */
function emptyFilters(): FilterState {
  return { repos: [], teams: [], reviewers: [], authors: [] };
}

describe("comments-trend module", () => {
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

  describe("renderCommentsTrendChart", () => {
    it("(a) renders 12 stacked bars + overlaid line + 3-series legend on a 12-week fixture (FR-1-01, FR-1-02)", () => {
      const rollups = makeCommentsRollups(12);

      renderCommentsTrendChart(container, rollups, { filters: emptyFilters() });

      // 12 bars (one per week in the fixture)
      const bars = container.querySelectorAll(".bar-container");
      expect(bars.length).toBe(12);

      // Each bar carries TWO stacked segments — resolved (lower) and
      // unresolved (upper). The exact class names are: `.bar-segment-resolved`
      // and `.bar-segment-unresolved` (modeled on throughput's `.bar` but
      // split for the stack). T016 must emit both per FR-1-02.
      bars.forEach((bar) => {
        expect(bar.querySelector(".bar-segment-resolved")).not.toBeNull();
        expect(bar.querySelector(".bar-segment-unresolved")).not.toBeNull();
      });

      // ONE SVG line series for `comment_count` overlaid on the same vertical
      // axis. T016 mirrors throughput's `.trend-line-overlay` pattern; the
      // comments-trend-specific overlay class is `.comments-line-overlay`.
      const overlays = container.querySelectorAll(".comments-line-overlay");
      expect(overlays.length).toBe(1);
      expect(overlays[0]?.querySelector("svg")).not.toBeNull();
      expect(overlays[0]?.querySelector("path")).not.toBeNull();

      // Three legend items naming each series. FR-1-02 says the chart shows
      // resolved + unresolved + comments. Exact legend copy is locked at T016
      // time, but each series' legend label MUST be present.
      const legend = container.querySelector(".chart-legend");
      expect(legend).not.toBeNull();
      const legendItems = legend?.querySelectorAll(".legend-item") ?? [];
      expect(legendItems.length).toBe(3);
    });

    it("(b) re-renders with narrowed range — 12 weeks → 6 weeks (FR-1-03)", () => {
      const rollups12 = makeCommentsRollups(12);

      renderCommentsTrendChart(container, rollups12, {
        filters: emptyFilters(),
      });
      expect(container.querySelectorAll(".bar-container").length).toBe(12);

      // Narrow the range by re-rendering with a 6-week subset (the
      // dashboard owns the slicing, the chart honors what's passed).
      const rollups6 = rollups12.slice(0, 6);
      renderCommentsTrendChart(container, rollups6, {
        filters: emptyFilters(),
      });

      // Bar count drops from 12 to 6.
      expect(container.querySelectorAll(".bar-container").length).toBe(6);

      // Legend MUST remain stable — still 3 items. FR-1-02 guarantees
      // legend stability across weeks (resolved/unresolved/line).
      const legendItems = container.querySelectorAll(
        ".chart-legend .legend-item",
      );
      expect(legendItems.length).toBe(3);

      // Line series re-rendered. There MUST be exactly one overlay (idempotent
      // replacement, not stacked).
      expect(container.querySelectorAll(".comments-line-overlay").length).toBe(
        1,
      );
    });

    it("(c) renders truncation indicator when input exceeds the display cap (FR-1-06)", () => {
      // Sanity check: cap is the throughput-symmetric 104.
      expect(MAX_COMMENTS_TREND_POINTS).toBe(104);

      const overflow = MAX_COMMENTS_TREND_POINTS + 6; // 110 weeks
      const rollups = makeCommentsRollups(overflow);

      renderCommentsTrendChart(container, rollups, { filters: emptyFilters() });

      // Bars limited to the cap (most recent slice, per the throughput pattern).
      const bars = container.querySelectorAll(".bar-container");
      expect(bars.length).toBe(MAX_COMMENTS_TREND_POINTS);

      // Truncation indicator surfaces using the shared chart-layout helper's
      // markup (.truncation-indicator + .truncation-badge). Same convention as
      // throughput.
      const truncation = container.querySelector(".truncation-indicator");
      expect(truncation).not.toBeNull();
      expect(truncation?.classList.contains("truncation-badge")).toBe(true);
      expect(truncation?.textContent).toContain(
        String(MAX_COMMENTS_TREND_POINTS),
      );
    });

    it("(d) FR-2-06 case (v) — applies partial-coverage qualifier ONLY to partial-marked weeks", () => {
      // Mixed fixture: 4 weeks, weeks 0+1 NOT partial, weeks 2+3 partial.
      // The qualifier convention is asserted via BOTH a CSS class
      // `coverage-partial` AND a data attribute `data-coverage-partial="true"`
      // on the partial bars; the non-partial bars MUST NOT carry either.
      // T016/T018 must emit both per ADR T005 (hatched fill + dimmed colors
      // are styled via the class hook; the data attribute makes the partial
      // state queryable for tests, tooltip wiring, and accessibility tooling).
      const rollups: Rollup[] = [
        makeCommentsRollup(0, { coverage_partial: false }),
        makeCommentsRollup(1, { coverage_partial: false }),
        makeCommentsRollup(2, { coverage_partial: true }),
        makeCommentsRollup(3, { coverage_partial: true }),
      ];

      renderCommentsTrendChart(container, rollups, { filters: emptyFilters() });

      const bars = container.querySelectorAll<HTMLElement>(".bar-container");
      expect(bars.length).toBe(4);

      // Non-partial weeks (0 + 1) MUST NOT carry the qualifier.
      expect(bars[0]!.classList.contains("coverage-partial")).toBe(false);
      expect(bars[0]!.getAttribute("data-coverage-partial")).not.toBe("true");
      expect(bars[1]!.classList.contains("coverage-partial")).toBe(false);
      expect(bars[1]!.getAttribute("data-coverage-partial")).not.toBe("true");

      // Partial weeks (2 + 3) MUST carry the qualifier.
      expect(bars[2]!.classList.contains("coverage-partial")).toBe(true);
      expect(bars[2]!.getAttribute("data-coverage-partial")).toBe("true");
      expect(bars[3]!.classList.contains("coverage-partial")).toBe(true);
      expect(bars[3]!.getAttribute("data-coverage-partial")).toBe("true");
    });

    it("(e) FR-2-06 case (vi) — all-unextracted week renders zero-height bar with qualifier; line connects through zero point", () => {
      // Build a 4-week fixture where week index 1 is all-unextracted
      // (coverage_partial=true, all numeric fields = 0). The remaining three
      // weeks have non-zero comment counts so the comment-line is drawn and
      // we can verify it CONNECTS THROUGH the zero point rather than skipping
      // the all-unextracted week.
      const rollups: Rollup[] = [
        makeCommentsRollup(0, {
          thread_count: 8,
          active_thread_count: 3,
          comment_count: 30,
          coverage_partial: false,
        }),
        // All-unextracted week (the one under test)
        makeCommentsRollup(1, {
          thread_count: 0,
          active_thread_count: 0,
          comment_count: 0,
          coverage_partial: true,
        }),
        makeCommentsRollup(2, {
          thread_count: 6,
          active_thread_count: 2,
          comment_count: 22,
          coverage_partial: false,
        }),
        makeCommentsRollup(3, {
          thread_count: 10,
          active_thread_count: 4,
          comment_count: 40,
          coverage_partial: false,
        }),
      ];

      renderCommentsTrendChart(container, rollups, { filters: emptyFilters() });

      // The all-unextracted bar element MUST be present in the DOM (no
      // silent omission for zero-value weeks per FR-2-06 case (vi)).
      const bars = container.querySelectorAll<HTMLElement>(".bar-container");
      expect(bars.length).toBe(4);

      // Locate the W02 bar (index 1, week label "2025-W02").
      const allUnextractedBar = container.querySelector<HTMLElement>(
        '.bar-container[data-drilldown-week="2025-W02"]',
      );
      expect(allUnextractedBar).not.toBeNull();

      // Both stacked segments MUST be present (not optimized away). They
      // render with zero height — the height assertion accepts either
      // explicit "0%" / "0px" / "0" representation.
      const resolvedSegment = allUnextractedBar!.querySelector<HTMLElement>(
        ".bar-segment-resolved",
      );
      const unresolvedSegment = allUnextractedBar!.querySelector<HTMLElement>(
        ".bar-segment-unresolved",
      );
      expect(resolvedSegment).not.toBeNull();
      expect(unresolvedSegment).not.toBeNull();

      const resolvedHeight = resolvedSegment!.getAttribute("style") ?? "";
      const unresolvedHeight = unresolvedSegment!.getAttribute("style") ?? "";
      // Zero-height conveys "no extracted contribution" — accept any of the
      // common zero serializations the renderer might pick.
      expect(resolvedHeight).toMatch(/height:\s*0(\.0)?(%|px)?/);
      expect(unresolvedHeight).toMatch(/height:\s*0(\.0)?(%|px)?/);

      // The qualifier IS applied (FR-2-06 case (vi) — the partial qualifier
      // is the user-facing "we don't know yet" signal even when all numerics
      // are zero).
      expect(allUnextractedBar!.classList.contains("coverage-partial")).toBe(
        true,
      );
      expect(allUnextractedBar!.getAttribute("data-coverage-partial")).toBe(
        "true",
      );

      // The comment-line MUST connect THROUGH the zero point (it MUST NOT
      // skip the all-unextracted week). The comment-count series renders one
      // dot/marker per week — verifying we see 4 markers/points (one per
      // week, including the zero one) is the minimum proof the line did not
      // skip W02. T016 may emit dots as `.comments-line-dot` or use a
      // contiguous SVG path with explicit point markers; we accept either by
      // counting the path's data points indirectly via the dot-marker class.
      const lineDots = container.querySelectorAll(".comments-line-dot");
      expect(lineDots.length).toBe(4);
    });

    it("(f) each bar carries data-drilldown-week matching the rollup's week (US2 wiring contract)", () => {
      const rollups = makeCommentsRollups(5);

      renderCommentsTrendChart(container, rollups, { filters: emptyFilters() });

      const bars = container.querySelectorAll<HTMLElement>(".bar-container");
      expect(bars.length).toBe(5);

      // Every bar's data-drilldown-week MUST equal the rollup week string.
      // T015 only verifies the attribute is set; T022 wires the click
      // handlers that consume it. We assert by querying each expected week
      // directly (avoids index-based array access for ESLint's
      // security/detect-object-injection rule).
      const renderedWeeks = Array.from(bars).map((bar) =>
        bar.getAttribute("data-drilldown-week"),
      );
      const expectedWeeks = rollups.map((r) => r.week);
      expect(renderedWeeks).toEqual(expectedWeeks);
    });

    it("(g) each bar has accessibility attributes per throughput contract (FR-1-05)", () => {
      const rollups = makeCommentsRollups(3);

      renderCommentsTrendChart(container, rollups, { filters: emptyFilters() });

      const bars = container.querySelectorAll<HTMLElement>(".bar-container");
      expect(bars.length).toBe(3);

      bars.forEach((bar) => {
        // Focusable
        expect(bar.getAttribute("tabindex")).toBe("0");
        // Activatable as a button
        expect(bar.getAttribute("role")).toBe("button");
        // aria-expanded is "false" before drill-down opens (mirrors
        // throughput.ts:104). The throughput-drilldown module flips it to
        // "true" on activate; chart-rendering is the initial-state contract.
        expect(bar.getAttribute("aria-expanded")).toBe("false");
        // aria-label MUST be present and non-empty (descriptive — week +
        // counts or similar; exact wording is locked at T016 time).
        const ariaLabel = bar.getAttribute("aria-label");
        expect(ariaLabel).not.toBeNull();
        expect(ariaLabel!.length).toBeGreaterThan(0);
      });
    });

    it("treats a null container as a safe no-op (mirrors throughput's pattern)", () => {
      // The dashboard's capability-off path (T021) may invoke this chart
      // function before ensureCommentsTrendContainer has provisioned the
      // container, which means a null may legitimately reach the chart on
      // a transient state-change. Throughput's renderThroughputChart
      // returns early on null (throughput.ts:44); this chart matches that
      // convention so dashboard call sites stay symmetric across charts.
      expect(() => {
        renderCommentsTrendChart(null, makeCommentsRollups(3));
      }).not.toThrow();
    });

    it("renders empty-state copy when no rollups carry the comments sub-object (capability-off path defense)", () => {
      // Defense for the capability-off path (FR-3-03): if the dashboard
      // passes only rollups whose `comments` key is absent, the chart's
      // internal filter rejects them and renderNoData replaces the
      // container's content with a clear message rather than emitting an
      // empty (broken-looking) chart frame.
      const noCommentsRollups: Rollup[] = [
        {
          week: "2025-W01",
          pr_count: 5,
          cycle_time_p50: 60,
          cycle_time_p90: 120,
          authors_count: 2,
          reviewers_count: 1,
          by_repository: null,
          by_team: null,
        },
      ];

      renderCommentsTrendChart(container, noCommentsRollups, {
        filters: emptyFilters(),
      });

      // No bars / no chart structure rendered.
      expect(container.querySelectorAll(".bar-container").length).toBe(0);
      // No-data copy mentions the comments-specific guidance from T016.
      expect(container.textContent).toContain("No comments data");
    });

    it("renders a single-week fixture without dividing by zero in the line overlay", () => {
      // FR Edge case "Single-week dataset" — chart MUST render with a
      // single bar; the line overlay's x-coordinate computation guards
      // against rollups.length === 1 (which would otherwise yield 0/0
      // when computing fractional positions). One dot marker, one bar,
      // legend stays at 3 items.
      const oneWeek = makeCommentsRollups(1);

      renderCommentsTrendChart(container, oneWeek, { filters: emptyFilters() });

      expect(container.querySelectorAll(".bar-container").length).toBe(1);
      // Single line dot at the centered x position (no NaN, no skip).
      const dots = container.querySelectorAll<SVGElement>(".comments-line-dot");
      expect(dots.length).toBe(1);
      expect(dots[0]?.getAttribute("cx")).not.toContain("NaN");
      // Legend remains stable at 3 items even with a single-week input.
      expect(
        container.querySelectorAll(".chart-legend .legend-item").length,
      ).toBe(3);
    });

    it("uses singular thread/comment wording in aria-label when count is 1", () => {
      // Edge case for screen-reader correctness: when thread_count = 1 or
      // comment_count = 1, the aria-label MUST use "thread" / "comment"
      // (singular) rather than "threads" / "comments". Plural-only text
      // would read awkwardly to assistive tech ("1 threads").
      const rollup = makeCommentsRollup(0, {
        thread_count: 1,
        active_thread_count: 1,
        comment_count: 1,
        coverage_partial: false,
      });

      renderCommentsTrendChart(container, [rollup], {
        filters: emptyFilters(),
      });

      const bar = container.querySelector<HTMLElement>(".bar-container");
      expect(bar).not.toBeNull();
      const ariaLabel = bar!.getAttribute("aria-label") ?? "";
      // Singular forms appear; plural "threads" / "comments" do NOT.
      // Counts in the label are exact — no "1 threads" misread.
      expect(ariaLabel).toContain("1 thread ");
      expect(ariaLabel).toContain("1 comment");
      expect(ariaLabel).not.toMatch(/\b1 threads\b/);
      expect(ariaLabel).not.toMatch(/\b1 comments\b/);
    });

    it("tooltip callback emits partial-coverage advisory text only on partial bars", () => {
      // Tooltip rendering is wired via `addChartTooltips`, which listens
      // for `mouseenter` / `pointerdown` + `pointerup` on each
      // `[data-tooltip]` bar (see modules/charts.ts:212-271). This test
      // dispatches `mouseenter` events to drive the tooltip path through
      // `buildTooltipHtml`, then asserts the tooltip body contains the
      // partial-coverage advisory ONLY for partial bars.
      const rollups: Rollup[] = [
        makeCommentsRollup(0, { coverage_partial: false }),
        makeCommentsRollup(1, { coverage_partial: true }),
      ];

      renderCommentsTrendChart(container, rollups, {
        filters: emptyFilters(),
      });

      const bars = container.querySelectorAll<HTMLElement>(".bar-container");
      expect(bars.length).toBe(2);

      // Activate the non-partial bar — tooltip MUST NOT mention "partial."
      // The tooltip element is appended to document.body by
      // showChartTooltip, not nested inside the chart container; query at
      // the document level.
      bars[0]!.dispatchEvent(new Event("mouseenter"));
      const tooltipAfterFirst = document.querySelector(".chart-tooltip");
      expect(tooltipAfterFirst).not.toBeNull();
      expect(tooltipAfterFirst!.textContent ?? "").not.toContain("partial");
      bars[0]!.dispatchEvent(new Event("mouseleave"));

      // Activate the partial bar — tooltip MUST mention "partial totals."
      bars[1]!.dispatchEvent(new Event("mouseenter"));
      const tooltipAfterSecond = document.querySelector(".chart-tooltip");
      expect(tooltipAfterSecond).not.toBeNull();
      expect(tooltipAfterSecond!.textContent ?? "").toContain("partial");
      bars[1]!.dispatchEvent(new Event("mouseleave"));
    });

    it("(h) round-12 chart-layer content idempotency — re-rendering same container yields ONE chart, not two", () => {
      // Round-12 lesson (project_332_resolution.md / feedback_test_buggy_
      // code_path_layer.md): chart-layer content idempotency is verified by
      // re-rendering into the same container and asserting no duplicates.
      // This test verifies CHART-LAYER idempotency only; T025 covers
      // dashboard-layer (ensureCommentsTrendContainer check-first) idempotency
      // separately.
      //
      // T016 mirrors throughput's `renderTrustedHtml` pattern, which replaces
      // the container's content on each call. Calling renderCommentsTrendChart
      // twice with identical inputs MUST therefore produce ONE chart, not two.
      const rollups = makeCommentsRollups(12);
      const options = { filters: emptyFilters() };

      renderCommentsTrendChart(container, rollups, options);
      renderCommentsTrendChart(container, rollups, options);

      // Exactly 12 bars (not 24).
      expect(container.querySelectorAll(".bar-container").length).toBe(12);

      // Exactly 1 line-series overlay (not 2).
      expect(container.querySelectorAll(".comments-line-overlay").length).toBe(
        1,
      );

      // Exactly 3 legend items (not 6).
      const legendItems = container.querySelectorAll(
        ".chart-legend .legend-item",
      );
      expect(legendItems.length).toBe(3);
    });
  });
});

/**
 * T023 — Drill-down activation tests for the comments-trend chart.
 *
 * Verifies that the existing throughput-drilldown installer
 * (`installThroughputDrilldown`) wires bar click + keyboard activation
 * for comments-trend bars without modification, because both surfaces
 * share the `data-drilldown-week` convention and the installer uses a
 * delegated listener that resolves any descendant matching that
 * attribute. T022 added a parallel install call site in dashboard.ts so
 * the comments-trend container gets the same drill-down behavior the
 * throughput chart has had since Feature 060.
 */
describe("comments-trend drilldown integration (T023)", () => {
  let container: HTMLElement;

  beforeEach(() => {
    publishComparisonToggled({ enabled: false });
    __resetComparisonAdvisoryForTests();
    document.body.innerHTML = "";
    container = document.createElement("div");
    container.id = "comments-trend";
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (isDetailPanelOpen()) dismissDetailPanel("explicit-close-button");
    publishComparisonToggled({ enabled: false });
    __resetComparisonAdvisoryForTests();
    document.body.innerHTML = "";
  });

  function renderAndInstall(rollups: Rollup[]): HTMLElement {
    renderCommentsTrendChart(container, rollups, { filters: emptyFilters() });
    installThroughputDrilldown(container, rollups);
    const bar = container.querySelector<HTMLElement>(".bar-container");
    if (!bar) throw new Error("bar-container not rendered");
    return bar;
  }

  it("(a) clicking a comments-trend bar opens the drill-down panel for that week", () => {
    const rollups = makeCommentsRollups(3);
    const bar = renderAndInstall(rollups);

    expect(isDetailPanelOpen()).toBe(false);
    bar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(isDetailPanelOpen()).toBe(true);

    // The activated bar's aria-expanded MUST flip to "true" — same
    // accessibility contract throughput honors via
    // installThroughputDrilldown's `activate` helper.
    expect(bar.getAttribute("aria-expanded")).toBe("true");
  });

  it("(b) keyboard Enter/Space on a focused comments-trend bar opens the same panel", () => {
    const rollups = makeCommentsRollups(3);
    const bar = renderAndInstall(rollups);

    // Enter activates.
    bar.focus();
    bar.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(isDetailPanelOpen()).toBe(true);
    expect(bar.getAttribute("aria-expanded")).toBe("true");

    // Dismiss + try Space on a different bar.
    dismissDetailPanel("explicit-close-button");
    expect(isDetailPanelOpen()).toBe(false);

    const bars = container.querySelectorAll<HTMLElement>(".bar-container");
    const second = bars[1];
    expect(second).toBeDefined();
    second!.focus();
    second!.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
    expect(isDetailPanelOpen()).toBe(true);
    expect(second!.getAttribute("aria-expanded")).toBe("true");
  });

  it("(c) aria-expanded toggles back to false when the panel dismisses", async () => {
    const rollups = makeCommentsRollups(3);
    const bar = renderAndInstall(rollups);

    bar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(bar.getAttribute("aria-expanded")).toBe("true");

    // Dismiss the panel — installThroughputDrilldown's panel observer
    // (line 353-365) flips aria-expanded back to "false" via clearActive
    // when the panel's `is-open` class is removed. MutationObserver
    // callbacks are microtask-scheduled, so await a microtask turn before
    // asserting (mirroring the throughput drilldown tests' pattern at
    // tests/modules/drilldown/throughput-drilldown.test.ts).
    dismissDetailPanel("explicit-close-button");
    expect(isDetailPanelOpen()).toBe(false);
    await Promise.resolve();
    expect(bar.getAttribute("aria-expanded")).toBe("false");
  });
});
