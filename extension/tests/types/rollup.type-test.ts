/**
 * COMPILE-TIME ONLY: This file must never be imported by runtime code paths.
 *
 * Type Tests for Rollup Schema
 *
 * This file contains compile-time type tests to verify that:
 * 1. BreakdownEntry and Rollup types are correctly defined
 * 2. Type regressions are caught at compile time
 *
 * Test Mechanism:
 * - Positive tests: Code that MUST compile without errors
 * - Negative tests: Code using `// @ts-expect-error -- REASON:` that MUST produce type errors
 *
 * If a negative test's expected error disappears (type regression), TypeScript
 * will emit error TS2578: "Unused '@ts-expect-error' directive" and the build fails.
 *
 * Run: pnpm run test:types
 * Pass: Exit code 0 (all expected errors occurred, all positive tests compiled)
 * Fail: Exit code non-zero (regression or broken positive test)
 *
 * @see FR-001, FR-002, FR-004 in spec.md
 * @module tests/types/rollup.type-test
 */

import type {
  BreakdownEntry,
  ReviewerBreakdownEntry,
  WeeklyRollup,
} from "../../ui/schemas/rollup.schema";

// ============================================================================
// Positive Tests - These MUST compile without errors
// ============================================================================

/**
 * Positive Test 1: Access pr_count from BreakdownEntry via Rollup.by_repository
 *
 * Verifies that by_repository is typed as Record<string, BreakdownEntry>
 * and that pr_count is accessible as a number.
 */
function positiveTest_byRepositoryPrCount(rollup: WeeklyRollup): number {
  const entry: BreakdownEntry | undefined = rollup.by_repository?.["repo-a"];
  if (entry) {
    // This MUST compile: pr_count exists on BreakdownEntry and is a number
    const prCount: number = entry.pr_count;
    return prCount;
  }
  return 0;
}

/**
 * Positive Test 2: Access pr_count from BreakdownEntry via Rollup.by_team
 *
 * Verifies that by_team is typed as Record<string, BreakdownEntry>
 * and that pr_count is accessible as a number.
 */
function positiveTest_byTeamPrCount(rollup: WeeklyRollup): number {
  const entry: BreakdownEntry | undefined = rollup.by_team?.["team-x"];
  if (entry) {
    // This MUST compile: pr_count exists on BreakdownEntry and is a number
    const prCount: number = entry.pr_count;
    return prCount;
  }
  return 0;
}

/**
 * Positive Test 3: BreakdownEntry has all expected optional fields
 *
 * Verifies the complete shape of BreakdownEntry.
 */
function positiveTest_breakdownEntryShape(entry: BreakdownEntry): void {
  // All these field accesses MUST compile
  const _prCount: number = entry.pr_count;
  const _cycleP50: number | null | undefined = entry.cycle_time_p50;
  const _cycleP90: number | null | undefined = entry.cycle_time_p90;
  const _reviewP50: number | null | undefined = entry.review_time_p50;
  const _reviewP90: number | null | undefined = entry.review_time_p90;
  const _authors: number | undefined = entry.authors_count;
  const _reviewers: number | undefined = entry.reviewers_count;

  // Suppress unused variable warnings (these are compile-time checks only)
  void _prCount;
  void _cycleP50;
  void _cycleP90;
  void _reviewP50;
  void _reviewP90;
  void _authors;
  void _reviewers;
}

/**
 * Positive Test 4: ReviewerBreakdownEntry exposes reviewer activity fields.
 */
function positiveTest_reviewerBreakdownShape(
  entry: ReviewerBreakdownEntry,
): void {
  const _reviewedPrs: number = entry.reviewed_prs;
  const _reviewsCount: number = entry.reviews_count;
  const _approvalRate: number | null | undefined = entry.approval_rate;
  const _authors: number | undefined = entry.authors_count;
  const _repositories: number | undefined = entry.repositories_count;

  void _reviewedPrs;
  void _reviewsCount;
  void _approvalRate;
  void _authors;
  void _repositories;
}

// ============================================================================
// Negative Tests - These MUST produce type errors (caught by @ts-expect-error)
// ============================================================================

/**
 * Negative Test 1: BreakdownEntry cannot be assigned to number
 *
 * If this compiles without the @ts-expect-error, it means BreakdownEntry
 * has regressed to a simple number type, which is the original bug.
 */
function negativeTest_breakdownEntryIsNotNumber(entry: BreakdownEntry): void {
  // @ts-expect-error -- REASON: BreakdownEntry is an object with pr_count, not a number - regression test for type safety
  const num: number = entry;
  void num;
}

/**
 * Negative Test 2: Rollup.by_repository['key'] cannot be treated as direct number
 *
 * If this compiles without the @ts-expect-error, it means by_repository
 * has regressed to Record<string, number> instead of Record<string, BreakdownEntry>.
 */
function negativeTest_byRepositoryNotNumber(rollup: WeeklyRollup): void {
  const entry = rollup.by_repository?.["repo-a"];
  if (entry) {
    // @ts-expect-error -- REASON: entry is BreakdownEntry, not number - regression test for by_repository type
    const sum: number = entry + 10;
    void sum;
  }
}

/**
 * Negative Test 3: Rollup.by_team['key'] cannot be treated as direct number
 *
 * If this compiles without the @ts-expect-error, it means by_team
 * has regressed to Record<string, number> instead of Record<string, BreakdownEntry>.
 */
function negativeTest_byTeamNotNumber(rollup: WeeklyRollup): void {
  const entry = rollup.by_team?.["team-x"];
  if (entry) {
    // @ts-expect-error -- REASON: entry is BreakdownEntry, not number - regression test for by_team type
    const sum: number = entry + 10;
    void sum;
  }
}

/**
 * Negative Test 4: Cannot access non-existent property on BreakdownEntry
 *
 * Verifies that BreakdownEntry is a strict interface, not a loose Record.
 */
function negativeTest_noArbitraryProperties(entry: BreakdownEntry): void {
  // @ts-expect-error -- REASON: nonExistentField does not exist on BreakdownEntry - verifies strict interface
  const _value = entry.nonExistentField;
  void _value;
}

/**
 * Negative Test 5: ReviewerBreakdownEntry does not expose cycle_time fields.
 */
function negativeTest_reviewerBreakdownNoCycleTime(
  entry: ReviewerBreakdownEntry,
): void {
  // @ts-expect-error -- REASON: reviewer breakdowns intentionally exclude cycle-time fields
  const _value = entry.cycle_time_p50;
  void _value;
}

// ============================================================================
// Export to prevent "file is not a module" error
// ============================================================================

export {
  positiveTest_byRepositoryPrCount,
  positiveTest_byTeamPrCount,
  positiveTest_breakdownEntryShape,
  positiveTest_reviewerBreakdownShape,
  negativeTest_breakdownEntryIsNotNumber,
  negativeTest_byRepositoryNotNumber,
  negativeTest_byTeamNotNumber,
  negativeTest_noArbitraryProperties,
  negativeTest_reviewerBreakdownNoCycleTime,
};
