/**
 * Synthetic Data Generator Module (T050-T053)
 *
 * Generates realistic preview data for ML features when real data is unavailable.
 * Used ONLY in development/preview mode, never in production.
 *
 * All synthetic data is clearly marked with:
 * - is_stub: true
 * - generated_by: "synthetic-preview"
 */

import type {
  PredictionsRenderData,
  InsightsRenderData,
  Forecast,
  ForecastValue,
  InsightItem,
} from "../../types";

/**
 * Generator identifier for synthetic data.
 */
const SYNTHETIC_GENERATOR = "synthetic-preview";

/**
 * Fixed seed for deterministic synthetic data.
 * Using memorable hex value "seed food" = 0x5EEDF00D
 */
const SYNTHETIC_SEED = 0x5eedf00d;

/**
 * Mulberry32 seeded PRNG algorithm.
 *
 * A fast, high-quality 32-bit PRNG that produces deterministic sequences
 * for a given seed. Used instead of Math.random() for reproducible preview data.
 *
 * @param seed - Initial seed value (32-bit integer)
 * @returns Function that returns the next random number [0, 1)
 */
function mulberry32(seed: number): () => number {
  return function (): number {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create a seeded random number generator for synthetic data.
 *
 * @returns Function that returns deterministic random numbers [0, 1)
 */
export function createSeededRandom(): () => number {
  return mulberry32(SYNTHETIC_SEED);
}

/**
 * Generate a date string offset from today by the given number of weeks.
 */
function getWeekOffset(weeks: number): string {
  const date = new Date();
  date.setDate(date.getDate() + weeks * 7);
  return date.toISOString().split("T")[0] ?? "";
}

/**
 * Generate synthetic forecast values for a metric.
 * Creates 4 weeks of realistic forecast data with confidence bands.
 *
 * @param baseValue - Starting value for the metric
 * @param trend - Direction of trend ("up", "down", or "stable")
 * @param variability - Amount of noise to add
 * @param random - Seeded random function for deterministic output
 */
function generateForecastValues(
  baseValue: number,
  trend: "up" | "down" | "stable",
  variability: number,
  random: () => number,
): ForecastValue[] {
  const values: ForecastValue[] = [];
  let currentValue = baseValue;

  for (let week = 1; week <= 4; week++) {
    // Apply trend
    const trendMultiplier =
      trend === "up" ? 1.05 : trend === "down" ? 0.95 : 1.0;
    currentValue = currentValue * trendMultiplier;

    // Add some variability using seeded random
    const noise = (random() - 0.5) * variability;
    const predicted = Math.round(currentValue + noise);

    // Confidence bands (wider as we go further out)
    const confidenceWidth = variability * (1 + week * 0.3);
    const lowerBound = Math.round(predicted - confidenceWidth);
    const upperBound = Math.round(predicted + confidenceWidth);

    values.push({
      period_start: getWeekOffset(week),
      predicted: Math.max(0, predicted),
      lower_bound: Math.max(0, lowerBound),
      upper_bound: Math.max(0, upperBound),
    });
  }

  return values;
}

/**
 * Generate synthetic predictions data (T051).
 *
 * Creates realistic forecast data for:
 * - PR Throughput (trending up)
 * - Cycle Time (trending stable)
 *
 * Uses seeded PRNG for deterministic output across page reloads.
 *
 * @returns Synthetic predictions data marked as preview
 */
export function generateSyntheticPredictions(): PredictionsRenderData {
  // Create seeded random for deterministic output
  const random = createSeededRandom();

  // Note: review_time_minutes removed - it used cycle_time as misleading proxy
  const forecasts: Forecast[] = [
    {
      metric: "pr_throughput",
      unit: "PRs/week",
      values: generateForecastValues(25, "up", 5, random),
    },
    {
      metric: "cycle_time_minutes",
      unit: "minutes",
      values: generateForecastValues(180, "stable", 30, random),
    },
  ];

  return {
    is_stub: true,
    generated_by: SYNTHETIC_GENERATOR,
    generated_at: new Date().toISOString(),
    forecaster: "linear",
    data_quality: "low_confidence",
    forecasts,
  };
}

/**
 * Generate synthetic insights data (T052).
 *
 * Creates 3 sample insights (one per category) with realistic content:
 * - Bottleneck: Code review delay (warning)
 * - Trend: Increasing cycle time (warning)
 * - Anomaly: Unusual activity spike (info)
 *
 * All insights include v2 schema fields (data, recommendation).
 *
 * @returns Synthetic insights data marked as preview
 */
export function generateSyntheticInsights(): InsightsRenderData {
  const insights: InsightItem[] = [
    {
      id: "synthetic-bottleneck-1",
      category: "bottleneck",
      severity: "warning",
      title: "Code Review Delay Detected",
      description:
        "Pull requests are spending 3x longer in code review than the team average. This may indicate reviewer capacity issues.",
      affected_entities: [
        { type: "team", name: "Backend Services", member_count: 5 },
        { type: "repository", name: "api-gateway" },
      ],
      data: {
        metric: "review_time_minutes",
        current_value: 180,
        previous_value: 60,
        change_percent: 200,
        trend_direction: "up",
        sparkline: [45, 55, 60, 90, 120, 150, 180],
      },
      recommendation: {
        action:
          "Consider adding more code reviewers or implementing automated review checks",
        priority: "high",
        effort: "medium",
      },
    },
    {
      id: "synthetic-trend-1",
      category: "trend",
      severity: "warning",
      title: "Cycle Time Increasing",
      description:
        "Average cycle time has increased by 25% over the past 4 weeks. This trend suggests growing complexity or process friction.",
      affected_entities: [
        { type: "team", name: "Platform Team", member_count: 8 },
      ],
      data: {
        metric: "cycle_time_minutes",
        current_value: 250,
        previous_value: 200,
        change_percent: 25,
        trend_direction: "up",
        sparkline: [180, 195, 210, 225, 240, 250],
      },
      recommendation: {
        action:
          "Review PR sizes and consider breaking down large changes into smaller, reviewable chunks",
        priority: "medium",
        effort: "low",
      },
    },
    {
      id: "synthetic-anomaly-1",
      category: "anomaly",
      severity: "info",
      title: "Unusual Activity Spike",
      description:
        "PR volume is 40% higher than typical for this period. This may be related to a planned release or sprint end.",
      affected_entities: [
        { type: "author", name: "release-bot" },
        { type: "repository", name: "frontend-app" },
      ],
      data: {
        metric: "pr_throughput",
        current_value: 42,
        previous_value: 30,
        change_percent: 40,
        trend_direction: "up",
        sparkline: [28, 30, 32, 35, 38, 42],
      },
      recommendation: {
        action:
          "Monitor merge queue capacity and ensure CI/CD pipelines can handle increased load",
        priority: "low",
        effort: "low",
      },
    },
  ];

  return {
    is_stub: true,
    generated_by: SYNTHETIC_GENERATOR,
    generated_at: new Date().toISOString(),
    schema_version: 1,
    insights,
  };
}

/**
 * Check if data is synthetic (marked as stub).
 * @param data - Data object to check
 * @returns true if data has is_stub: true
 */
export function isSyntheticData(
  data: { is_stub?: boolean } | null | undefined,
): boolean {
  return data?.is_stub === true;
}
