"use strict";
/**
 * Metrics calculation module.
 *
 * DOM-FREE: Pure functions only. No document.* or window.* access.
 * Uses shared/format.ts for any formatting needs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateMetrics = calculateMetrics;
exports.calculatePercentChange = calculatePercentChange;
exports.getPreviousPeriod = getPreviousPeriod;
exports.applyFiltersToRollups = applyFiltersToRollups;
exports.extractSparklineData = extractSparklineData;
exports.calculateMovingAverage = calculateMovingAverage;
const format_1 = require("./shared/format");
/**
 * Calculate metrics from rollups data.
 * Pure function - no side effects.
 */
function calculateMetrics(rollups) {
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
        .filter((v) => v !== null && v !== undefined);
    const p90Values = rollups
        .map((r) => r.cycle_time_p90)
        .filter((v) => v !== null && v !== undefined);
    const authorsSum = rollups.reduce((sum, r) => sum + (r.authors_count || 0), 0);
    const reviewersSum = rollups.reduce((sum, r) => sum + (r.reviewers_count || 0), 0);
    return {
        totalPrs,
        cycleP50: p50Values.length ? (0, format_1.median)(p50Values) : null,
        cycleP90: p90Values.length ? (0, format_1.median)(p90Values) : null,
        avgAuthors: rollups.length > 0 ? Math.round(authorsSum / rollups.length) : 0,
        avgReviewers: rollups.length > 0 ? Math.round(reviewersSum / rollups.length) : 0,
    };
}
/**
 * Calculate percentage change between two values.
 * Pure function - no side effects.
 */
function calculatePercentChange(current, previous) {
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
function getPreviousPeriod(start, end) {
    const rangeDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const prevEnd = new Date(start.getTime() - 1); // Day before start
    const prevStart = new Date(prevEnd.getTime() - rangeDays * 24 * 60 * 60 * 1000);
    return { start: prevStart, end: prevEnd };
}
/**
 * Apply dimension filters to rollups data.
 * Uses by_repository slices when available for accurate filtering.
 * Pure function - no side effects.
 */
function applyFiltersToRollups(rollups, filters) {
    // No filters active - return original data
    if (!filters.repos.length && !filters.teams.length) {
        return rollups;
    }
    return rollups.map((rollup) => {
        // If we have by_repository slices and repo filter is active, use them
        if (filters.repos.length && rollup.by_repository && typeof rollup.by_repository === "object") {
            const selectedRepos = filters.repos
                .map((repoId) => {
                const repoData = rollup.by_repository[repoId];
                if (repoData)
                    return repoData;
                return Object.entries(rollup.by_repository).find(([name]) => name === repoId)?.[1];
            })
                .filter((r) => r !== undefined);
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
            };
        }
        // If we have by_team slices and team filter is active, use them
        if (filters.teams.length && rollup.by_team && typeof rollup.by_team === "object") {
            const selectedTeams = filters.teams
                .map((teamId) => rollup.by_team[teamId])
                .filter((t) => t !== undefined);
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
            };
        }
        return rollup;
    });
}
/**
 * Extract sparkline data from rollups.
 * Pure function - no side effects.
 */
function extractSparklineData(rollups) {
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
function calculateMovingAverage(values, window = 4) {
    return values.map((_, i) => {
        if (i < window - 1)
            return null;
        const slice = values.slice(i - window + 1, i + 1);
        const sum = slice.reduce((a, b) => a + b, 0);
        return sum / window;
    });
}
//# sourceMappingURL=metrics.js.map