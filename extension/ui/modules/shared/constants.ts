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
