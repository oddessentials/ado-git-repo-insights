/**
 * Drill-down barrel.
 *
 * Re-exports the public surface of the drill-down feature modules.
 * Per-consumer modules (throughput / cycle-time / reviewer / sparkline)
 * land in subsequent commits of this feature; this barrel grows as they
 * come online.
 */

export * from "./lifecycle-signals";
export * from "./comparison-advisory";
