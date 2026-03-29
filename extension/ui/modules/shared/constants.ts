/**
 * Shared constants for dashboard rendering.
 *
 * Centralizes magic numbers referenced by both TypeScript modules and CSS.
 * CSS media queries cannot read JS variables, so values here must be
 * coordinated with the corresponding CSS breakpoints — an automated test
 * asserts they agree.
 */

/**
 * Mobile breakpoint in pixels.
 * Coordinated with CSS `@media (max-width: 480px)` rules in styles.css.
 */
export const MOBILE_BREAKPOINT = 480;

/**
 * Sample size below which metrics should be visually de-emphasized
 * to signal low statistical confidence.
 */
export const LOW_SAMPLE_THRESHOLD = 10;

/**
 * PR count at which PR-based metrics reach moderate confidence.
 * Between LOW_SAMPLE_THRESHOLD and MODERATE_SAMPLE_THRESHOLD,
 * metrics are shown with reduced emphasis.
 */
export const MODERATE_SAMPLE_THRESHOLD = 30;

/**
 * Week count below which week-based metrics (cycle time, review time,
 * authors, reviewers) should be visually de-emphasized.
 */
export const LOW_WEEK_THRESHOLD = 3;

/**
 * Week count at which week-based metrics reach moderate confidence.
 * Aligns with SPARKLINE_LOOKBACK_WEEKS — a full sparkline window.
 */
export const MODERATE_WEEK_THRESHOLD = 8;
