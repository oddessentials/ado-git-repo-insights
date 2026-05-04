/**
 * Unit tests for week-range helpers (#363 / Q-R2 lock).
 *
 * Covers `formatPeriodTitle` — the multi-rollup title used by the
 * summary-card sparkline drill-down panel. The other exports
 * (`parseIsoLocalDate`, `isoWeekRange`, `formatWeekRangeTitle`,
 * `formatWeekTitle`, `weekRangeForAria`) are exercised indirectly by the
 * throughput / cycle-time / reviewer drill-down tests; this file pins
 * `formatPeriodTitle`'s four output-string branches per
 * `specs/363-summary-card-pr-drilldown/data-model.md` § 4 and
 * `contracts/sparkline-pr-list.md` § 2.
 */

import {
  formatPeriodTitle,
  formatWeekTitle,
} from "../../../ui/modules/drilldown/week-range";
import type { Rollup } from "../../../ui/dataset-loader";

function makeRollup(
  week: string,
  start_date: string | undefined,
  end_date: string | undefined,
): Rollup {
  return {
    week,
    start_date,
    end_date,
    pr_count: 0,
    cycle_time_p50: null,
    cycle_time_p90: null,
    authors_count: 0,
    reviewers_count: 0,
    by_repository: null,
    by_team: null,
  };
}

describe("formatPeriodTitle", () => {
  it("empty rollups returns 'No period selected'", () => {
    expect(formatPeriodTitle([])).toBe("No period selected");
  });

  it("single rollup delegates to formatWeekTitle", () => {
    const rollup = makeRollup("2025-W12", "2025-03-17", "2025-03-23");
    expect(formatPeriodTitle([rollup])).toBe(formatWeekTitle(rollup));
  });

  it("multi-rollup same year emits 'Period of Mar 17 – Apr 13, 2025'", () => {
    const w12 = makeRollup("2025-W12", "2025-03-17", "2025-03-23");
    const w13 = makeRollup("2025-W13", "2025-03-24", "2025-03-30");
    const w15 = makeRollup("2025-W15", "2025-04-07", "2025-04-13");
    expect(formatPeriodTitle([w12, w13, w15])).toBe(
      "Period of Mar 17 – Apr 13, 2025",
    );
  });

  it("multi-rollup cross-year emits 'Period of Dec 30, 2024 – Jan 26, 2025'", () => {
    const w53 = makeRollup("2024-W53", "2024-12-30", "2025-01-05");
    const w04 = makeRollup("2025-W04", "2025-01-20", "2025-01-26");
    expect(formatPeriodTitle([w53, w04])).toBe(
      "Period of Dec 30, 2024 – Jan 26, 2025",
    );
  });

  it("multi-rollup with one rollup missing start/end dates falls back to isoWeekRange", () => {
    // Coverage for the falsy-date arms of the start_date / end_date
    // ternaries and the directStart && directEnd ? ... : isoWeekRange()
    // fallback inside formatPeriodTitle. The third rollup carries an
    // unparseable week key alongside missing dates so that the
    // ``if (!pair) continue`` branch is exercised too — its date
    // contribution is dropped, leaving the period span anchored on
    // the two valid rollups.
    const w12 = makeRollup("2025-W12", "2025-03-17", "2025-03-23");
    const w13Fallback = makeRollup("2025-W13", undefined, undefined);
    const wBogus = makeRollup("bogus-key", undefined, undefined);
    expect(formatPeriodTitle([w12, w13Fallback, wBogus])).toBe(
      "Period of Mar 17 – 30, 2025",
    );
  });

  it("multi-rollup with all rollups invalid returns 'No period selected'", () => {
    // Every rollup has missing dates AND an unparseable week key, so
    // every iteration of the period walk hits the ``continue`` arm of
    // the ``if (!pair) continue`` guard. earliestStart / latestEnd
    // both stay null → the ``!earliestStart || !latestEnd`` fallback
    // arm fires and returns "No period selected".
    const wA = makeRollup("not-a-week", undefined, undefined);
    const wB = makeRollup("also-bogus", undefined, undefined);
    expect(formatPeriodTitle([wA, wB])).toBe("No period selected");
  });
});
