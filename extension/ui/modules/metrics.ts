/**
 * Metrics calculation module.
 *
 * DOM-FREE: Pure functions only. No document.* or window.* access.
 * Uses shared/format.ts for any formatting needs.
 */

import type { Rollup } from "../dataset-loader";
import { median } from "./shared/format";

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
  const rangeDays = Math.ceil(
    (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
  );
  const prevEnd = new Date(start.getTime() - 1); // Day before start
  const prevStart = new Date(
    prevEnd.getTime() - rangeDays * 24 * 60 * 60 * 1000,
  );
  return { start: prevStart, end: prevEnd };
}

/**
 * Apply dimension filters to rollups data.
 * Uses by_repository slices when available for accurate filtering.
 * Pure function - no side effects.
 */
export function applyFiltersToRollups(
  rollups: Rollup[],
  filters: DimensionFilters,
): Rollup[] {
  // No filters active - return original data
  if (!filters.repos.length && !filters.teams.length) {
    return rollups;
  }

  return rollups.map((rollup) => {
    // If we have by_repository slices and repo filter is active, use them
    if (
      filters.repos.length &&
      rollup.by_repository &&
      typeof rollup.by_repository === "object"
    ) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- REASON: by_repository verified non-null in enclosing if condition (line 135)
      const byRepository = rollup.by_repository!;
      const selectedRepos = filters.repos
        .map((repoId) => {
          // eslint-disable-next-line security/detect-object-injection -- SECURITY: repoId comes from validated filter state
          const repoData = byRepository[repoId];
          if (repoData) return repoData;

          return Object.entries(byRepository).find(
            ([name]) => name === repoId,
          )?.[1];
        })
        .filter((r): r is number => r !== undefined);

      if (selectedRepos.length === 0) {
        return {
          ...rollup,
          pr_count: 0,
          cycle_time_p50: null,
          cycle_time_p90: null,
          authors_count: 0,
          reviewers_count: 0,
        };
      }

      // Aggregate metrics - by_repository values are PR counts per repo
      const totalPrCount = selectedRepos.reduce((sum, count) => sum + count, 0);

      // When filtering by repo, we only have PR count per repo.
      // Other metrics (cycle time, authors, reviewers) cannot be filtered
      // as they're only available at the rollup level, not per-repo.
      return {
        ...rollup,
        pr_count: totalPrCount,
        // NOTE: cycle_time/authors/reviewers preserved from unfiltered rollup
        // as we don't have per-repo breakdown for these metrics
      } as Rollup;
    }

    // If we have by_team slices and team filter is active, use them
    if (
      filters.teams.length &&
      rollup.by_team &&
      typeof rollup.by_team === "object"
    ) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- REASON: by_team verified non-null in enclosing if condition (line 178)
      const byTeam = rollup.by_team!;
      const selectedTeams = filters.teams
        // eslint-disable-next-line security/detect-object-injection -- SECURITY: teamId comes from validated filter state
        .map((teamId) => byTeam[teamId])
        .filter((t): t is number => t !== undefined);

      if (selectedTeams.length === 0) {
        return {
          ...rollup,
          pr_count: 0,
          cycle_time_p50: null,
          cycle_time_p90: null,
          authors_count: 0,
          reviewers_count: 0,
        };
      }

      // Aggregate metrics - by_team values are PR counts per team
      const totalPrCount = selectedTeams.reduce((sum, count) => sum + count, 0);

      // When filtering by team, we only have PR count per team.
      // Other metrics are preserved from the unfiltered rollup.
      return {
        ...rollup,
        pr_count: totalPrCount,
        // NOTE: cycle_time/authors/reviewers preserved from unfiltered rollup
        // as we don't have per-team breakdown for these metrics
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
