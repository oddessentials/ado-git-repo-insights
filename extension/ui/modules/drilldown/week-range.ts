/**
 * Week-range helpers shared by the per-chart drill-down consumers
 * (throughput / cycle-time / reviewer — US1, US2, US3).
 *
 * All three consumers open the DetailPanel with a title of the form
 * "Week of {condensed range}", derived from the rollup's authoritative
 * `start_date` / `end_date` pair (written by `aggregators.py`
 * `WeeklyRollup`). Recomputing from the ISO week key is a defensive
 * fallback for rollups missing those fields.
 *
 * Correctness invariants locked by `throughput-drilldown.test.ts`:
 *
 *   - Dates are always pinned to LOCAL midnight. A UTC-midnight Date
 *     fed to `toLocaleDateString` would shift the displayed day west
 *     of UTC.
 *   - Impossible calendar dates (e.g. "2025-02-31") are rejected by
 *     round-tripping y/m/d through `new Date` and matching the fields
 *     back out, so silent rollover can't masquerade as a valid date.
 *   - Condensed range format matches `specs/059-chart-drill-down/data-
 *     model.md:19` ("Mar 18 – 24, 2025" same-month,
 *     "Mar 31 – Apr 6, 2025" cross-month,
 *     "Dec 30, 2024 – Jan 5, 2025" cross-year).
 */

import type { Rollup } from "../../dataset-loader";

/**
 * Parse a `YYYY-MM-DD` string as a LOCAL-midnight Date. Returns null if
 * the string is not in that shape OR if the y/m/d round-trip through
 * `new Date(y, m, d)` does not match the input (catching impossible
 * calendar days such as `"2025-02-31"` that JavaScript would otherwise
 * silently roll over).
 */
export function parseIsoLocalDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/**
 * Compute the Monday–Sunday local-midnight date range for an ISO 8601
 * week key (e.g. "2025-W12"). ISO anchor: Jan 4 is always in week 1.
 *
 * Returns null on an unparseable key or a weekNum outside 1–53. Use
 * only as a fallback for rollups missing `start_date` / `end_date` —
 * the pipeline-written pair is authoritative.
 */
export function isoWeekRange(week: string): { start: Date; end: Date } | null {
  const match = /^(\d{4})-W(\d{1,2})$/.exec(week);
  if (!match) return null;
  const year = Number(match[1]);
  const weekNum = Number(match[2]);
  if (weekNum < 1 || weekNum > 53) return null;
  const jan4 = new Date(year, 0, 4);
  // Convert JS day-of-week (Sun=0..Sat=6) to ISO Mon-relative offset (Mon=0..Sun=6).
  const mondayOffset = (jan4.getDay() + 6) % 7;
  const start = new Date(jan4);
  start.setDate(jan4.getDate() - mondayOffset + (weekNum - 1) * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

/**
 * Format a Monday/Sunday pair as a condensed week-range string. See
 * `specs/059-chart-drill-down/data-model.md:19` for the canonical
 * examples.
 */
export function formatWeekRangeTitle(start: Date, end: Date): string {
  const startMonth = start.toLocaleDateString("en-US", { month: "short" });
  const endMonth = end.toLocaleDateString("en-US", { month: "short" });
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  if (startYear !== endYear) {
    return (
      `${startMonth} ${start.getDate()}, ${startYear} – ` +
      `${endMonth} ${end.getDate()}, ${endYear}`
    );
  }
  if (startMonth === endMonth) {
    return `${startMonth} ${start.getDate()} – ${end.getDate()}, ${startYear}`;
  }
  return (
    `${startMonth} ${start.getDate()} – ` +
    `${endMonth} ${end.getDate()}, ${startYear}`
  );
}

/**
 * Format the rollup's week as a "Week of {condensed range}" title.
 * Prefers the authoritative `start_date` / `end_date` fields; falls
 * back to the ISO-week computation when either is absent or
 * unparseable; final fallback is the raw ISO week key.
 */
export function formatWeekTitle(rollup: Rollup): string {
  const start = rollup.start_date ? parseIsoLocalDate(rollup.start_date) : null;
  const end = rollup.end_date ? parseIsoLocalDate(rollup.end_date) : null;
  if (start && end) {
    return `Week of ${formatWeekRangeTitle(start, end)}`;
  }
  const range = isoWeekRange(rollup.week);
  if (!range) return `Week ${rollup.week}`;
  return `Week of ${formatWeekRangeTitle(range.start, range.end)}`;
}

/**
 * Condensed week-range string suitable for parameterized aria-labels on
 * chart triggers (e.g. "Mar 17 – 23, 2025"). Same date-resolution logic
 * as `formatWeekTitle` but WITHOUT the "Week of " prefix — chart
 * templates compose the full label inline as
 * `Drill into {metric/count} for week of ${weekRangeForAria(rollup)}`.
 *
 * Single source of truth for the parameterized string so chart-side
 * labels and panel-side titles cannot drift on the same rollup.
 */
export function weekRangeForAria(rollup: Rollup): string {
  const start = rollup.start_date ? parseIsoLocalDate(rollup.start_date) : null;
  const end = rollup.end_date ? parseIsoLocalDate(rollup.end_date) : null;
  if (start && end) {
    return formatWeekRangeTitle(start, end);
  }
  const range = isoWeekRange(rollup.week);
  if (!range) return rollup.week;
  return formatWeekRangeTitle(range.start, range.end);
}

/**
 * Format the active rollup window as a panel title for the summary-card
 * sparkline drill-down (#363 / Q-R2 lock).
 *
 * Branching:
 *   - Empty input → `"No period selected"`.
 *   - Single rollup → delegates to `formatWeekTitle(rollups[0])` so the
 *     existing per-week panel title shape is preserved.
 *   - Two or more rollups → walks every rollup, preferring the
 *     authoritative `start_date` / `end_date` pair via
 *     `parseIsoLocalDate`, falling back to `isoWeekRange(rollup.week)`
 *     when either date is missing or unparseable; aggregates
 *     `earliestStart = min(allStarts)` and `latestEnd = max(allEnds)`,
 *     and returns `"Period of " + formatWeekRangeTitle(earliestStart,
 *     latestEnd)`. Same-month / cross-month / cross-year output is
 *     produced by the existing `formatWeekRangeTitle` formatter, so the
 *     date-format surface cannot drift between per-week and period
 *     titles.
 *   - When no rollup contributes a valid date pair after the walk →
 *     `"No period selected"` (same fallback as empty input).
 *
 * See `specs/363-summary-card-pr-drilldown/data-model.md` § 4 and
 * `specs/363-summary-card-pr-drilldown/contracts/sparkline-pr-list.md`
 * § 2 for the full output-string enumeration.
 */
export function formatPeriodTitle(rollups: readonly Rollup[]): string {
  const [first, ...rest] = rollups;
  if (!first) {
    return "No period selected";
  }
  if (rest.length === 0) {
    return formatWeekTitle(first);
  }
  let earliestStart: Date | null = null;
  let latestEnd: Date | null = null;
  for (const rollup of rollups) {
    const directStart = rollup.start_date
      ? parseIsoLocalDate(rollup.start_date)
      : null;
    const directEnd = rollup.end_date
      ? parseIsoLocalDate(rollup.end_date)
      : null;
    const pair =
      directStart && directEnd
        ? { start: directStart, end: directEnd }
        : isoWeekRange(rollup.week);
    if (!pair) continue;
    if (!earliestStart || pair.start < earliestStart) {
      earliestStart = pair.start;
    }
    if (!latestEnd || pair.end > latestEnd) {
      latestEnd = pair.end;
    }
  }
  if (!earliestStart || !latestEnd) {
    return "No period selected";
  }
  return `Period of ${formatWeekRangeTitle(earliestStart, latestEnd)}`;
}
