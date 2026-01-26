/**
 * ML Data Provider interface (async seam for future service integration).
 *
 * This allows swapping between:
 * - Local JSON files (current)
 * - Pipeline artifact-loaded JSON
 * - Remote service calls (future Prophet/OpenAI)
 *
 * Caching and error handling can be centralized via provider implementations.
 */

import type { PredictionsData, InsightsData } from "../../types";

/**
 * Interface for loading ML data from any source.
 */
export interface MlDataProvider {
  /**
   * Load throughput predictions (Prophet forecasts).
   */
  loadPredictions(): Promise<PredictionsData>;

  /**
   * Load AI-generated insights (bottleneck analysis).
   */
  loadInsights(): Promise<InsightsData>;
}

/**
 * State types for ML data loading.
 */
export type MlLoadState =
  | "idle"
  | "loading"
  | "loaded"
  | "error"
  | "unavailable";

/**
 * ML feature state for UI rendering.
 */
export interface MlFeatureState {
  predictionsState: MlLoadState;
  insightsState: MlLoadState;
  predictionsData: PredictionsData | null;
  insightsData: InsightsData | null;
  predictionsError: string | null;
  insightsError: string | null;
}

/**
 * Create initial ML feature state.
 */
export function createInitialMlState(): MlFeatureState {
  return {
    predictionsState: "idle",
    insightsState: "idle",
    predictionsData: null,
    insightsData: null,
    predictionsError: null,
    insightsError: null,
  };
}
