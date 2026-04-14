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
 * - Negative tests: `expectTypeOf` assertions from `expect-type` that verify
 *   type-level constraints at compile time (no @ts-expect-error directives)
 *
 * If a negative test's constraint no longer holds (type regression), TypeScript
 * will emit a compile error and the build fails.
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
import { expectTypeOf } from "expect-type";

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
// Negative Tests - These verify type constraints via expectTypeOf assertions
// ============================================================================

/**
 * Negative Test 1: BreakdownEntry cannot be assigned to number
 *
 * If BreakdownEntry regresses to a simple number type, this assertion
 * will fail to compile.
 */
function negativeTest_breakdownEntryIsNotNumber(entry: BreakdownEntry): void {
  expectTypeOf(entry).not.toMatchTypeOf<number>();
}

/**
 * Negative Test 2: Rollup.by_repository['key'] cannot be treated as direct number
 *
 * If by_repository regresses to Record<string, number>, this assertion
 * will fail to compile.
 */
function negativeTest_byRepositoryNotNumber(rollup: WeeklyRollup): void {
  const entry = rollup.by_repository?.["repo-a"];
  if (entry) {
    expectTypeOf(entry).not.toMatchTypeOf<number>();
  }
}

/**
 * Negative Test 3: Rollup.by_team['key'] cannot be treated as direct number
 *
 * If by_team regresses to Record<string, number>, this assertion
 * will fail to compile.
 */
function negativeTest_byTeamNotNumber(rollup: WeeklyRollup): void {
  const entry = rollup.by_team?.["team-x"];
  if (entry) {
    expectTypeOf(entry).not.toMatchTypeOf<number>();
  }
}

/**
 * Negative Test 4: Cannot access non-existent property on BreakdownEntry
 *
 * Verifies that BreakdownEntry is a strict interface, not a loose Record.
 */
function negativeTest_noArbitraryProperties(_entry: BreakdownEntry): void {
  expectTypeOf<BreakdownEntry>().not.toMatchTypeOf<{
    nonExistentField: unknown;
  }>();
}

/**
 * Negative Test 5: ReviewerBreakdownEntry does not expose cycle_time fields.
 */
function negativeTest_reviewerBreakdownNoCycleTime(
  _entry: ReviewerBreakdownEntry,
): void {
  expectTypeOf<ReviewerBreakdownEntry>().not.toMatchTypeOf<{
    cycle_time_p50: unknown;
  }>();
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
