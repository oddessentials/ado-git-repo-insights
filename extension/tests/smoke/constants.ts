/**
 * Smoke test constants.
 *
 * This file contains centralized constants for smoke tests to ensure
 * deterministic and consistent timeout handling across all test files.
 *
 * Contract: FR-007, FR-008, FR-009
 * - All smoke test waits MUST use SMOKE_TIMEOUT_MS
 * - Ad-hoc timeout literals are forbidden in smoke tests
 * - This file is the sole location for smoke timeout constants
 */

/**
 * Standard timeout for smoke test waits (milliseconds).
 *
 * Used for:
 * - waitForSelector() calls
 * - expect().toBeVisible() assertions
 * - expect().toHaveText() assertions
 * - Any condition-based wait in smoke tests
 *
 * Value: 15 seconds - generous timeout to handle CI variability
 * while still failing fast on genuine issues.
 */
export const SMOKE_TIMEOUT_MS = 15_000;
