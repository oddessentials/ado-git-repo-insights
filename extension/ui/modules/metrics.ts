/**
 * Metrics calculation module.
 *
 * DOM-FREE: Pure functions only. No document.* or window.* access.
 * Uses shared/format.ts for any formatting needs.
 */

import type { Rollup } from "../dataset-loader";
import type { BreakdownEntry } from "../schemas/rollup.schema";
import { median } from "./shared/format";

/**
 * Safely convert any value to a finite number.
 * Returns 0 for undefined, null, NaN, Infinity, or non-numeric values.
 *
 * @param value - Any value to convert
 * @returns A finite number, or 0 if conversion fails
 */
function toFiniteNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Calculated metrics result.
 */
export interface CalculatedMetrics {
  totalPrs: number;
  cycleP50: number | null;
  cycleP90: number | null;
  avgAuthors: number;
  avgReviewers: number;
}

/**
 * Dimension filter state.
 */
export interface DimensionFilters {
  repos: string[];
  teams: string[];
}

/**
 * Date range for comparison periods.
 */
export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * Calculate metrics from rollups data.
 * Pure function - no side effects.
 */
export function calculateMetrics(rollups: Rollup[]): CalculatedMetrics {
  if (!rollups || !rollups.length) {
    return {
      totalPrs: 0,
      cycleP50: null,
      cycleP90: null,
      avgAuthors: 0,
      avgReviewers: 0,
    };
  }

  const totalPrs = rollups.reduce((sum, r) => sum + (r.pr_count || 0), 0);

  const p50Values = rollups
    .map((r) => r.cycle_time_p50)
    .filter((v): v is number => v !== null && v !== undefined);
  const p90Values = rollups
    .map((r) => r.cycle_time_p90)
    .filter((v): v is number => v !== null && v !== undefined);

  const authorsSum = rollups.reduce(
    (sum, r) => sum + (r.authors_count || 0),
    0,
  );
  const reviewersSum = rollups.reduce(
    (sum, r) => sum + (r.reviewers_count || 0),
    0,
  );

  return {
    totalPrs,
    cycleP50: p50Values.length ? median(p50Values) : null,
    cycleP90: p90Values.length ? median(p90Values) : null,
    avgAuthors:
      rollups.length > 0 ? Math.round(authorsSum / rollups.length) : 0,
    avgReviewers:
      rollups.length > 0 ? Math.round(reviewersSum / rollups.length) : 0,
  };
}

/**
 * Calculate percentage change between two values.
 * Pure function - no side effects.
 */
export function calculatePercentChange(
  current: number | null | undefined,
  previous: number | null | undefined,
): number | null {
  if (previous === null || previous === undefined || previous === 0) {
    return null;
  }
  if (current === null || current === undefined) {
    return null;
  }
  return ((current - previous) / previous) * 100;
}

/**
 * Calculate the previous period date range for comparison.
 * Pure function - no side effects.
 */
export function getPreviousPeriod(
  start: Date,
  end: Date,
): { start: Date; end: Date } {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  const rangeDays = Math.ceil(
    (end.getTime() - start.getTime()) / MS_PER_DAY,
  );
  const prevEnd = new Date(start.getTime() - MS_PER_DAY); // Day before start
  const prevStart = new Date(prevEnd.getTime() - rangeDays * MS_PER_DAY);
  return { start: prevStart, end: prevEnd };
}

/**
 * Aggregated metrics from a set of breakdown entries.
 */
interface AggregatedSlice {
  pr_count: number;
  cycle_time_p50: number | null;
  cycle_time_p90: number | null;
  authors_count: number;
  reviewers_count: number;
}

/**
 * Aggregate metrics from a list of BreakdownEntry objects.
 * Returns summed counts and PR-weighted average cycle times.
 */
function aggregateEntries(entries: BreakdownEntry[]): AggregatedSlice {
  const totalPrCount = entries.reduce(
    (sum, entry) => sum + toFiniteNumber(entry.pr_count),
    0,
  );
  const totalAuthors = entries.reduce(
    (sum, entry) => sum + toFiniteNumber(entry.authors_count),
    0,
  );
  const totalReviewers = entries.reduce(
    (sum, entry) => sum + toFiniteNumber(entry.reviewers_count),
    0,
  );

  // Only entries with a finite numeric p50 participate in the p50 average;
  // entries missing cycle-time data do not dilute the weighted result.
  const p50Entries = entries.filter(
    (e) => typeof e.cycle_time_p50 === "number" && Number.isFinite(e.cycle_time_p50),
  );
  const p90Entries = entries.filter(
    (e) => typeof e.cycle_time_p90 === "number" && Number.isFinite(e.cycle_time_p90),
  );

  let cycleP50: number | null = null;
  let cycleP90: number | null = null;

  if (p50Entries.length > 0) {
    const p50PrCount = p50Entries.reduce(
      (sum, e) => sum + toFiniteNumber(e.pr_count), 0,
    );
    if (p50PrCount > 0) {
      cycleP50 = p50Entries.reduce(
        (sum, e) => sum + toFiniteNumber(e.cycle_time_p50) * toFiniteNumber(e.pr_count), 0,
      ) / p50PrCount;
    }
  }

  if (p90Entries.length > 0) {
    const p90PrCount = p90Entries.reduce(
      (sum, e) => sum + toFiniteNumber(e.pr_count), 0,
    );
    if (p90PrCount > 0) {
      cycleP90 = p90Entries.reduce(
        (sum, e) => sum + toFiniteNumber(e.cycle_time_p90) * toFiniteNumber(e.pr_count), 0,
      ) / p90PrCount;
    }
  }

  return {
    pr_count: totalPrCount,
    cycle_time_p50: cycleP50,
    cycle_time_p90: cycleP90,
    authors_count: totalAuthors,
    reviewers_count: totalReviewers,
  };
}

/**
 * Resolve selected breakdown entries from a breakdown map.
 * Looks up each key directly, then falls back to name-based search.
 */
function resolveBreakdownEntries(
  breakdown: Record<string, BreakdownEntry>,
  keys: string[],
): BreakdownEntry[] {
  return keys
    .map((key) => {
      // eslint-disable-next-line security/detect-object-injection -- SECURITY: key comes from validated filter state
      const direct = breakdown[key];
      if (direct) return direct;
      return Object.entries(breakdown).find(([name]) => name === key)?.[1];
    })
    .filter(
      (entry): entry is BreakdownEntry =>
        entry !== undefined && typeof entry?.pr_count === "number",
    );
}

const ZEROED_ROLLUP_FIELDS = {
  pr_count: 0,
  cycle_time_p50: null,
  cycle_time_p90: null,
  authors_count: 0,
  reviewers_count: 0,
} as const;

/**
 * Build a filtered rollup from an aggregated slice.
 * Falls back to the original rollup values when the slice has no cycle time
 * data (backward compatibility with legacy by_repository that only has pr_count).
 */
function buildFilteredRollup(
  rollup: Rollup,
  slice: AggregatedSlice,
): Rollup {
  // Zero-leakage guard: when the slice has no PRs, zero all metric fields
  // so global authors_count/reviewers_count/cycle_time don't leak through.
  if (slice.pr_count === 0) {
    return { ...rollup, ...ZEROED_ROLLUP_FIELDS } as Rollup;
  }
  return {
    ...rollup,
    pr_count: slice.pr_count,
    // Always override to prevent global values leaking through the
    // ...rollup spread when the slice legitimately has null/0 values.
    cycle_time_p50: slice.cycle_time_p50,
    cycle_time_p90: slice.cycle_time_p90,
    authors_count: slice.authors_count,
    reviewers_count: slice.reviewers_count,
  } as Rollup;
}

/**
 * Apply dimension filters to rollups data.
 * Uses by_repository and by_team slices when available for accurate filtering.
 * When both filters are active, prefers exact cross-dimensional lookup from
 * by_team_and_repo (v2 schema). Falls back to proportional intersection
 * estimation for rollups without cross-dimensional data.
 * Pure function - no side effects.
 */
export function applyFiltersToRollups(
  rollups: Rollup[],
  filters: DimensionFilters,
): Rollup[] {
  if (!filters.repos.length && !filters.teams.length) {
    return rollups;
  }

  return rollups.map((rollup) => {
    const repoBreakdown =
      filters.repos.length > 0 &&
      rollup.by_repository &&
      typeof rollup.by_repository === "object"
        ? rollup.by_repository
        : null;
    const teamBreakdown =
      filters.teams.length > 0 &&
      rollup.by_team &&
      typeof rollup.by_team === "object"
        ? rollup.by_team
        : null;

    let repoSlice: AggregatedSlice | null = null;
    if (repoBreakdown) {
      const entries = resolveBreakdownEntries(
        repoBreakdown,
        filters.repos,
      );
      if (entries.length === 0) {
        return { ...rollup, ...ZEROED_ROLLUP_FIELDS };
      }
      repoSlice = aggregateEntries(entries);
    }

    let teamSlice: AggregatedSlice | null = null;
    if (teamBreakdown) {
      const entries = resolveBreakdownEntries(
        teamBreakdown,
        filters.teams,
      );
      if (entries.length === 0) {
        return { ...rollup, ...ZEROED_ROLLUP_FIELDS };
      }
      teamSlice = aggregateEntries(entries);
    }

    // Single filter active — use its slice directly
    if (repoSlice && !teamSlice) {
      return buildFilteredRollup(rollup, repoSlice);
    }
    if (teamSlice && !repoSlice) {
      return buildFilteredRollup(rollup, teamSlice);
    }

    // Both filters active — cross-dimensional exact lookup (priority over proportional).
    // Uses pre-computed team-repo intersection data when available (v2 schema).
    if (repoSlice && teamSlice && rollup.by_team_and_repo) {
      const crossDimEntries: BreakdownEntry[] = [];
      for (const team of filters.teams) {
        // eslint-disable-next-line security/detect-object-injection -- SECURITY: team comes from validated filter state
        const teamRepos = rollup.by_team_and_repo[team];
        if (!teamRepos) continue;
        for (const repo of filters.repos) {
          // eslint-disable-next-line security/detect-object-injection -- SECURITY: repo comes from validated filter state
          const entry = teamRepos[repo];
          if (entry) crossDimEntries.push(entry);
        }
      }
      const expectedCount = filters.teams.length * filters.repos.length;
      const isTruncated =
        (rollup.by_team_and_repo as Record<string, unknown>)["_truncated"] ===
        true;
      if (crossDimEntries.length > 0) {
        // When the map is truncated and some intersections are missing,
        // the partial result undercounts — fall through to proportional.
        if (isTruncated && crossDimEntries.length < expectedCount) {
          // Truncated partial hit — fall through to proportional below
          console.warn(
            `Cross-dim data truncated for week ${rollup.week}: ` +
              `found ${crossDimEntries.length}/${expectedCount} entries, ` +
              `using proportional estimation`,
          );
        } else {
          const exactSlice = aggregateEntries(crossDimEntries);
          return buildFilteredRollup(rollup, exactSlice);
        }
      } else if (!isTruncated) {
        // All lookups missed on a non-truncated map — genuinely zero.
        return { ...rollup, ...ZEROED_ROLLUP_FIELDS } as Rollup;
      }
      // Truncated map (full miss or partial hit) — fall through to proportional below
    }

    // Both filters active — proportional intersection (fallback for v1 rollups).
    // Each slice represents a marginal share of the rollup total.
    // Team slices may exceed the total when multi-team members cause overlap,
    // so shares are clamped to [0, 1] before combining.
    // The intersection is estimated as: total * (repoShare * teamShare).
    if (repoSlice && teamSlice) {
      const total = rollup.pr_count || 1;
      const repoShare = Math.min(1, repoSlice.pr_count / total);
      const teamShare = Math.min(1, teamSlice.pr_count / total);
      const combinedRatio = repoShare * teamShare;

      const combinedPrCount = Math.round(rollup.pr_count * combinedRatio);

      // Zero-leakage guard: when proportional estimation rounds to 0 PRs,
      // zero all metric fields so global values don't leak through.
      if (combinedPrCount === 0) {
        return { ...rollup, ...ZEROED_ROLLUP_FIELDS } as Rollup;
      }

      const combinedAuthors = Math.round(
        (rollup.authors_count || 0) * combinedRatio,
      );
      const combinedReviewers = Math.round(
        (rollup.reviewers_count || 0) * combinedRatio,
      );

      // Cycle time: average the two slice estimates (both are valid
      // weighted averages for their dimension, no basis to prefer one)
      const p50s = [repoSlice.cycle_time_p50, teamSlice.cycle_time_p50].filter(
        (v): v is number => v !== null,
      );
      const p90s = [repoSlice.cycle_time_p90, teamSlice.cycle_time_p90].filter(
        (v): v is number => v !== null,
      );

      return {
        ...rollup,
        pr_count: combinedPrCount,
        // Always override to prevent global values leaking through the
        // ...rollup spread when proportional estimates are null/0.
        cycle_time_p50:
          p50s.length > 0
            ? p50s.reduce((a, b) => a + b, 0) / p50s.length
            : null,
        cycle_time_p90:
          p90s.length > 0
            ? p90s.reduce((a, b) => a + b, 0) / p90s.length
            : null,
        authors_count: combinedAuthors,
        reviewers_count: combinedReviewers,
      } as Rollup;
    }

    return rollup;
  });
}

/**
 * Extract sparkline data from rollups.
 * Pure function - no side effects.
 */
export function extractSparklineData(rollups: Rollup[]): {
  prCounts: number[];
  p50s: number[];
  p90s: number[];
  authors: number[];
  reviewers: number[];
} {
  return {
    prCounts: rollups.map((r) => r.pr_count || 0),
    p50s: rollups.map((r) => r.cycle_time_p50 || 0),
    p90s: rollups.map((r) => r.cycle_time_p90 || 0),
    authors: rollups.map((r) => r.authors_count || 0),
    reviewers: rollups.map((r) => r.reviewers_count || 0),
  };
}

/**
 * Calculate moving average for trend line.
 * Pure function - no side effects.
 */
export function calculateMovingAverage(
  values: number[],
  window = 4,
): (number | null)[] {
  return values.map((_, i) => {
    if (i < window - 1) return null;
    const slice = values.slice(i - window + 1, i + 1);
    const sum = slice.reduce((a, b) => a + b, 0);
    return sum / window;
  });
}
