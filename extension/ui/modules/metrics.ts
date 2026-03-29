/**
 * Metrics calculation module.
 *
 * DOM-FREE: Pure functions only. No document.* or window.* access.
 * Uses shared/format.ts for any formatting needs.
 */

import type { Rollup } from "../dataset-loader";
import type {
  BreakdownEntry,
  ReviewerBreakdownEntry,
} from "../schemas/rollup.schema";
import { median } from "./shared/format";

const HAS_WINDOW = typeof window !== "undefined";
const IS_PRODUCTION =
  typeof process !== "undefined" && process.env.NODE_ENV === "production";
const SHOULD_WARN_ON_COERCION =
  !IS_PRODUCTION && HAS_WINDOW && window.__DASHBOARD_DEBUG__ === true;
let hasWarnedOnMetricCoercion = false;

/**
 * Safely convert any value to a finite number.
 * Returns 0 for undefined, null, NaN, Infinity, or non-numeric values.
 *
 * @param value - Any value to convert
 * @returns A finite number, or 0 if conversion fails
 */
function toFiniteNumber(value: unknown): number {
  const n = Number(value);
  if (Number.isFinite(n)) {
    return n;
  }
  if (SHOULD_WARN_ON_COERCION && !hasWarnedOnMetricCoercion) {
    hasWarnedOnMetricCoercion = true;
    console.warn(
      "metrics.ts coerced a non-finite metric value to 0; verify upstream rollup data if this is unexpected.",
      value,
    );
  }
  return 0;
}

function getOwnPropertyValue<T>(
  obj: Record<string, T>,
  key: string,
): T | undefined {
  return new Map<string, T>(Object.entries(obj)).get(key);
}

/**
 * Calculated metrics result.
 */
export interface CalculatedMetrics {
  totalPrs: number;
  cycleP50: number | null;
  cycleP90: number | null;
  reviewTimeP50: number | null;
  reviewTimeP90: number | null;
  avgAuthors: number;
  avgReviewers: number;
}

/**
 * Dimension filter state.
 */
export interface DimensionFilters {
  repos: string[];
  teams: string[];
  reviewers?: string[];
  authors?: string[];
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
      reviewTimeP50: null,
      reviewTimeP90: null,
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

  const reviewTimeP50Values = rollups
    .map((r) => r.review_time_p50)
    .filter((v): v is number => v !== null && v !== undefined);
  const reviewTimeP90Values = rollups
    .map((r) => r.review_time_p90)
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
    reviewTimeP50: reviewTimeP50Values.length
      ? median(reviewTimeP50Values)
      : null,
    reviewTimeP90: reviewTimeP90Values.length
      ? median(reviewTimeP90Values)
      : null,
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
  const rangeDays = Math.ceil((end.getTime() - start.getTime()) / MS_PER_DAY);
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
  review_time_p50: number | null;
  review_time_p90: number | null;
  authors_count: number;
  reviewers_count: number;
}

export interface AggregatedReviewerSlice {
  reviewed_prs: number;
  reviews_count: number;
  approval_rate: number | null;
  authors_count: number;
  repositories_count: number;
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
    (e) =>
      typeof e.cycle_time_p50 === "number" && Number.isFinite(e.cycle_time_p50),
  );
  const p90Entries = entries.filter(
    (e) =>
      typeof e.cycle_time_p90 === "number" && Number.isFinite(e.cycle_time_p90),
  );

  let cycleP50: number | null = null;
  let cycleP90: number | null = null;

  if (p50Entries.length > 0) {
    const p50PrCount = p50Entries.reduce(
      (sum, e) => sum + toFiniteNumber(e.pr_count),
      0,
    );
    if (p50PrCount > 0) {
      cycleP50 =
        p50Entries.reduce(
          (sum, e) =>
            sum + toFiniteNumber(e.cycle_time_p50) * toFiniteNumber(e.pr_count),
          0,
        ) / p50PrCount;
    }
  }

  if (p90Entries.length > 0) {
    const p90PrCount = p90Entries.reduce(
      (sum, e) => sum + toFiniteNumber(e.pr_count),
      0,
    );
    if (p90PrCount > 0) {
      cycleP90 =
        p90Entries.reduce(
          (sum, e) =>
            sum + toFiniteNumber(e.cycle_time_p90) * toFiniteNumber(e.pr_count),
          0,
        ) / p90PrCount;
    }
  }

  // Review time: same PR-weighted average pattern as cycle time.
  const rtP50Entries = entries.filter(
    (e) =>
      typeof e.review_time_p50 === "number" &&
      Number.isFinite(e.review_time_p50),
  );
  const rtP90Entries = entries.filter(
    (e) =>
      typeof e.review_time_p90 === "number" &&
      Number.isFinite(e.review_time_p90),
  );

  let reviewTimeP50: number | null = null;
  let reviewTimeP90: number | null = null;

  if (rtP50Entries.length > 0) {
    const rtP50PrCount = rtP50Entries.reduce(
      (sum, e) => sum + toFiniteNumber(e.pr_count),
      0,
    );
    if (rtP50PrCount > 0) {
      reviewTimeP50 =
        rtP50Entries.reduce(
          (sum, e) =>
            sum +
            toFiniteNumber(e.review_time_p50) * toFiniteNumber(e.pr_count),
          0,
        ) / rtP50PrCount;
    }
  }

  if (rtP90Entries.length > 0) {
    const rtP90PrCount = rtP90Entries.reduce(
      (sum, e) => sum + toFiniteNumber(e.pr_count),
      0,
    );
    if (rtP90PrCount > 0) {
      reviewTimeP90 =
        rtP90Entries.reduce(
          (sum, e) =>
            sum +
            toFiniteNumber(e.review_time_p90) * toFiniteNumber(e.pr_count),
          0,
        ) / rtP90PrCount;
    }
  }

  return {
    pr_count: totalPrCount,
    cycle_time_p50: cycleP50,
    cycle_time_p90: cycleP90,
    review_time_p50: reviewTimeP50,
    review_time_p90: reviewTimeP90,
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
      const direct = getOwnPropertyValue(breakdown, key);
      if (direct) return direct;
      return Object.entries(breakdown).find(([name]) => name === key)?.[1];
    })
    .filter(
      (entry): entry is BreakdownEntry =>
        entry !== undefined && typeof entry?.pr_count === "number",
    );
}

function resolveReviewerEntries(
  breakdown: Record<string, ReviewerBreakdownEntry>,
  keys: string[],
): ReviewerBreakdownEntry[] {
  return keys
    .map((key) => {
      const direct = getOwnPropertyValue(breakdown, key);
      if (direct) return direct;
      return Object.entries(breakdown).find(([name]) => name === key)?.[1];
    })
    .filter(
      (entry): entry is ReviewerBreakdownEntry =>
        entry !== undefined && typeof entry?.reviewed_prs === "number",
    );
}

export function aggregateReviewerEntries(
  entries: ReviewerBreakdownEntry[],
): AggregatedReviewerSlice {
  const reviewedPrs = entries.reduce(
    (sum, entry) => sum + toFiniteNumber(entry.reviewed_prs),
    0,
  );
  const reviewsCount = entries.reduce(
    (sum, entry) => sum + toFiniteNumber(entry.reviews_count),
    0,
  );
  const authorsCount = entries.reduce(
    (sum, entry) => sum + toFiniteNumber(entry.authors_count),
    0,
  );
  const repositoriesCount = entries.reduce(
    (sum, entry) => sum + toFiniteNumber(entry.repositories_count),
    0,
  );

  const approvalEntries = entries.filter(
    (e) =>
      typeof e.approval_rate === "number" && Number.isFinite(e.approval_rate),
  );
  const approvalDenominator = approvalEntries.reduce(
    (sum, entry) => sum + toFiniteNumber(entry.reviews_count),
    0,
  );
  const approvalWeightedSum = approvalEntries.reduce(
    (sum, entry) =>
      sum +
      toFiniteNumber(entry.approval_rate) * toFiniteNumber(entry.reviews_count),
    0,
  );

  return {
    reviewed_prs: reviewedPrs,
    reviews_count: reviewsCount,
    approval_rate:
      approvalDenominator > 0
        ? approvalWeightedSum / approvalDenominator
        : null,
    authors_count: authorsCount,
    repositories_count: repositoriesCount,
  };
}

const ZEROED_ROLLUP_FIELDS = {
  pr_count: 0,
  cycle_time_p50: null,
  cycle_time_p90: null,
  review_time_p50: null,
  review_time_p90: null,
  authors_count: 0,
  reviewers_count: 0,
} as const;

/**
 * Build a filtered rollup from an aggregated slice.
 * Falls back to the original rollup values when the slice has no cycle time
 * data (backward compatibility with legacy by_repository that only has pr_count).
 */
function buildFilteredRollup(rollup: Rollup, slice: AggregatedSlice): Rollup {
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
    review_time_p50: slice.review_time_p50,
    review_time_p90: slice.review_time_p90,
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
  const firstAuthor = filters.authors?.[0];
  const authorFilters = firstAuthor ? [firstAuthor] : [];
  const firstReviewer = filters.reviewers?.[0];
  const reviewerFilters = firstReviewer ? [firstReviewer] : [];

  if (
    !filters.repos.length &&
    !filters.teams.length &&
    !reviewerFilters.length &&
    !authorFilters.length
  ) {
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
    const authorBreakdown =
      authorFilters.length > 0 &&
      rollup.by_author &&
      typeof rollup.by_author === "object"
        ? rollup.by_author
        : null;
    const reviewerBreakdown =
      reviewerFilters.length > 0 &&
      rollup.by_reviewer &&
      typeof rollup.by_reviewer === "object"
        ? rollup.by_reviewer
        : null;

    if (reviewerFilters.length > 0 && !reviewerBreakdown) {
      return { ...rollup, ...ZEROED_ROLLUP_FIELDS };
    }
    if (authorFilters.length > 0 && !authorBreakdown) {
      return { ...rollup, ...ZEROED_ROLLUP_FIELDS };
    }

    let repoSlice: AggregatedSlice | null = null;
    if (repoBreakdown) {
      const entries = resolveBreakdownEntries(repoBreakdown, filters.repos);
      if (entries.length === 0) {
        return { ...rollup, ...ZEROED_ROLLUP_FIELDS };
      }
      repoSlice = aggregateEntries(entries);
    }

    let teamSlice: AggregatedSlice | null = null;
    if (teamBreakdown) {
      const entries = resolveBreakdownEntries(teamBreakdown, filters.teams);
      if (entries.length === 0) {
        return { ...rollup, ...ZEROED_ROLLUP_FIELDS };
      }
      teamSlice = aggregateEntries(entries);
    }

    let authorSlice: AggregatedSlice | null = null;
    if (authorBreakdown) {
      const entries = resolveBreakdownEntries(authorBreakdown, authorFilters);
      if (entries.length === 0) {
        return { ...rollup, ...ZEROED_ROLLUP_FIELDS };
      }
      authorSlice = aggregateEntries(entries);
    }

    let reviewerSlice: AggregatedReviewerSlice | null = null;
    if (reviewerBreakdown) {
      const entries = resolveReviewerEntries(
        reviewerBreakdown,
        reviewerFilters,
      );
      if (entries.length === 0) {
        return { ...rollup, ...ZEROED_ROLLUP_FIELDS };
      }
      reviewerSlice = aggregateReviewerEntries(entries);
    }

    if (reviewerSlice) {
      if (repoSlice || teamSlice) {
        console.warn(
          "Combined reviewer filtering with repository/team filters is not supported; using reviewer-only filtering",
        );
      }

      return buildFilteredRollup(rollup, {
        pr_count: reviewerSlice.reviewed_prs,
        cycle_time_p50: null,
        cycle_time_p90: null,
        review_time_p50: null,
        review_time_p90: null,
        authors_count: reviewerSlice.authors_count,
        // Reuse reviewers_count for review-activity UI surfaces.
        reviewers_count: reviewerSlice.reviews_count,
      });
    }

    if (authorSlice && repoSlice && rollup.by_author_and_repo) {
      let cdPr = 0,
        cdAuthors = 0,
        cdReviewers = 0;
      let cdP50WSum = 0,
        cdP50WPr = 0,
        cdP90WSum = 0,
        cdP90WPr = 0;
      let cdRtP50WSum = 0,
        cdRtP50WPr = 0,
        cdRtP90WSum = 0,
        cdRtP90WPr = 0;
      let cdFound = 0;

      for (const authorId of authorFilters) {
        const authorRepos = getOwnPropertyValue(
          rollup.by_author_and_repo,
          authorId,
        );
        if (!authorRepos) continue;
        for (const repo of filters.repos) {
          const e = getOwnPropertyValue(authorRepos, repo);
          if (!e) continue;
          cdFound++;
          const pr = toFiniteNumber(e.pr_count);
          cdPr += pr;
          cdAuthors += toFiniteNumber(e.authors_count);
          cdReviewers += toFiniteNumber(e.reviewers_count);
          const p50 = e.cycle_time_p50;
          if (typeof p50 === "number" && Number.isFinite(p50)) {
            cdP50WSum += p50 * pr;
            cdP50WPr += pr;
          }
          const p90 = e.cycle_time_p90;
          if (typeof p90 === "number" && Number.isFinite(p90)) {
            cdP90WSum += p90 * pr;
            cdP90WPr += pr;
          }
          const rtP50 = e.review_time_p50;
          if (typeof rtP50 === "number" && Number.isFinite(rtP50)) {
            cdRtP50WSum += rtP50 * pr;
            cdRtP50WPr += pr;
          }
          const rtP90 = e.review_time_p90;
          if (typeof rtP90 === "number" && Number.isFinite(rtP90)) {
            cdRtP90WSum += rtP90 * pr;
            cdRtP90WPr += pr;
          }
        }
      }

      if (cdFound > 0) {
        const isTruncated =
          (rollup.by_author_and_repo as Record<string, unknown>)[
            "_truncated"
          ] === true;
        const expectedCount = authorFilters.length * filters.repos.length;
        if (isTruncated && cdFound < expectedCount) {
          console.warn(
            `Author x repo data truncated for week ${rollup.week}: ` +
              `found ${cdFound}/${expectedCount} entries, ` +
              `using proportional estimation`,
          );
        } else {
          if (teamSlice) {
            console.warn(
              "Combined author and team filtering is constrained; using author+repository metrics while retaining team UI state",
            );
          }
          return buildFilteredRollup(rollup, {
            pr_count: cdPr,
            cycle_time_p50: cdP50WPr > 0 ? cdP50WSum / cdP50WPr : null,
            cycle_time_p90: cdP90WPr > 0 ? cdP90WSum / cdP90WPr : null,
            review_time_p50:
              cdRtP50WPr > 0 ? cdRtP50WSum / cdRtP50WPr : null,
            review_time_p90:
              cdRtP90WPr > 0 ? cdRtP90WSum / cdRtP90WPr : null,
            authors_count: cdAuthors,
            reviewers_count: cdReviewers,
          });
        }
      } else if (
        (rollup.by_author_and_repo as Record<string, unknown>)["_truncated"] !==
        true
      ) {
        return { ...rollup, ...ZEROED_ROLLUP_FIELDS } as Rollup;
      }
    }

    if (authorSlice && repoSlice) {
      const total = rollup.pr_count || 1;
      const authorShare = Math.min(1, authorSlice.pr_count / total);
      const repoShare = Math.min(1, repoSlice.pr_count / total);
      const combinedRatio = authorShare * repoShare;
      const combinedPrCount = Math.round(rollup.pr_count * combinedRatio);

      if (combinedPrCount === 0) {
        return { ...rollup, ...ZEROED_ROLLUP_FIELDS } as Rollup;
      }

      const combinedAuthors = Math.round(
        (rollup.authors_count || 0) * combinedRatio,
      );
      const combinedReviewers = Math.round(
        (rollup.reviewers_count || 0) * combinedRatio,
      );
      const p50s = [
        authorSlice.cycle_time_p50,
        repoSlice.cycle_time_p50,
      ].filter((v): v is number => v !== null);
      const p90s = [
        authorSlice.cycle_time_p90,
        repoSlice.cycle_time_p90,
      ].filter((v): v is number => v !== null);
      const rtP50s = [
        authorSlice.review_time_p50,
        repoSlice.review_time_p50,
      ].filter((v): v is number => v !== null);
      const rtP90s = [
        authorSlice.review_time_p90,
        repoSlice.review_time_p90,
      ].filter((v): v is number => v !== null);

      if (teamSlice) {
        console.warn(
          "Combined author and team filtering is constrained; using author+repository metrics while retaining team UI state",
        );
      }

      return {
        ...rollup,
        pr_count: combinedPrCount,
        cycle_time_p50:
          p50s.length > 0
            ? p50s.reduce((a, b) => a + b, 0) / p50s.length
            : null,
        cycle_time_p90:
          p90s.length > 0
            ? p90s.reduce((a, b) => a + b, 0) / p90s.length
            : null,
        review_time_p50:
          rtP50s.length > 0
            ? rtP50s.reduce((a, b) => a + b, 0) / rtP50s.length
            : null,
        review_time_p90:
          rtP90s.length > 0
            ? rtP90s.reduce((a, b) => a + b, 0) / rtP90s.length
            : null,
        authors_count: combinedAuthors,
        reviewers_count: combinedReviewers,
      } as Rollup;
    }

    if (authorSlice) {
      if (teamSlice) {
        console.warn(
          "Combined author and team filtering is constrained; using author-only metrics while retaining team UI state",
        );
      }
      return buildFilteredRollup(rollup, authorSlice);
    }

    // Both filters active — cross-dimensional exact lookup (priority over proportional).
    // Uses pre-computed team-repo intersection data when available (v2 schema).
    // Single-pass inline aggregation avoids intermediate array + multiple reduce passes.
    if (repoSlice && teamSlice && rollup.by_team_and_repo) {
      let cdPr = 0,
        cdAuthors = 0,
        cdReviewers = 0;
      let cdP50WSum = 0,
        cdP50WPr = 0,
        cdP90WSum = 0,
        cdP90WPr = 0;
      let cdRtP50WSum = 0,
        cdRtP50WPr = 0,
        cdRtP90WSum = 0,
        cdRtP90WPr = 0;
      let cdFound = 0;

      for (const team of filters.teams) {
        const teamRepos = getOwnPropertyValue(rollup.by_team_and_repo, team);
        if (!teamRepos) continue;
        for (const repo of filters.repos) {
          const e = getOwnPropertyValue(teamRepos, repo);
          if (!e) continue;
          cdFound++;
          const pr = toFiniteNumber(e.pr_count);
          cdPr += pr;
          cdAuthors += toFiniteNumber(e.authors_count);
          cdReviewers += toFiniteNumber(e.reviewers_count);
          const p50 = e.cycle_time_p50;
          if (typeof p50 === "number" && Number.isFinite(p50)) {
            cdP50WSum += p50 * pr;
            cdP50WPr += pr;
          }
          const p90 = e.cycle_time_p90;
          if (typeof p90 === "number" && Number.isFinite(p90)) {
            cdP90WSum += p90 * pr;
            cdP90WPr += pr;
          }
          const rtP50 = e.review_time_p50;
          if (typeof rtP50 === "number" && Number.isFinite(rtP50)) {
            cdRtP50WSum += rtP50 * pr;
            cdRtP50WPr += pr;
          }
          const rtP90 = e.review_time_p90;
          if (typeof rtP90 === "number" && Number.isFinite(rtP90)) {
            cdRtP90WSum += rtP90 * pr;
            cdRtP90WPr += pr;
          }
        }
      }

      if (cdFound > 0) {
        // Defer _truncated check to after the loop — only needed when entries exist.
        const isTruncated =
          (rollup.by_team_and_repo as Record<string, unknown>)["_truncated"] ===
          true;
        const expectedCount = filters.teams.length * filters.repos.length;
        if (isTruncated && cdFound < expectedCount) {
          // Truncated partial hit — fall through to proportional below
          console.warn(
            `Cross-dim data truncated for week ${rollup.week}: ` +
              `found ${cdFound}/${expectedCount} entries, ` +
              `using proportional estimation`,
          );
        } else {
          return buildFilteredRollup(rollup, {
            pr_count: cdPr,
            cycle_time_p50: cdP50WPr > 0 ? cdP50WSum / cdP50WPr : null,
            cycle_time_p90: cdP90WPr > 0 ? cdP90WSum / cdP90WPr : null,
            review_time_p50:
              cdRtP50WPr > 0 ? cdRtP50WSum / cdRtP50WPr : null,
            review_time_p90:
              cdRtP90WPr > 0 ? cdRtP90WSum / cdRtP90WPr : null,
            authors_count: cdAuthors,
            reviewers_count: cdReviewers,
          });
        }
      } else if (
        (rollup.by_team_and_repo as Record<string, unknown>)["_truncated"] !==
        true
      ) {
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
      const rtP50s = [
        repoSlice.review_time_p50,
        teamSlice.review_time_p50,
      ].filter((v): v is number => v !== null);
      const rtP90s = [
        repoSlice.review_time_p90,
        teamSlice.review_time_p90,
      ].filter((v): v is number => v !== null);

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
        review_time_p50:
          rtP50s.length > 0
            ? rtP50s.reduce((a, b) => a + b, 0) / rtP50s.length
            : null,
        review_time_p90:
          rtP90s.length > 0
            ? rtP90s.reduce((a, b) => a + b, 0) / rtP90s.length
            : null,
        authors_count: combinedAuthors,
        reviewers_count: combinedReviewers,
      } as Rollup;
    }

    // Single filter active — use its slice directly after author-aware branches.
    if (repoSlice && !teamSlice) {
      return buildFilteredRollup(rollup, repoSlice);
    }
    if (teamSlice && !repoSlice) {
      return buildFilteredRollup(rollup, teamSlice);
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
  p50s: (number | null)[];
  p90s: (number | null)[];
  reviewTimeP50s: (number | null)[];
  reviewTimeP90s: (number | null)[];
  authors: number[];
  reviewers: number[];
} {
  return {
    prCounts: rollups.map((r) => r.pr_count ?? 0),
    p50s: rollups.map((r) => r.cycle_time_p50 ?? null),
    p90s: rollups.map((r) => r.cycle_time_p90 ?? null),
    reviewTimeP50s: rollups.map((r) => r.review_time_p50 ?? null),
    reviewTimeP90s: rollups.map((r) => r.review_time_p90 ?? null),
    authors: rollups.map((r) => r.authors_count ?? 0),
    reviewers: rollups.map((r) => r.reviewers_count ?? 0),
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
