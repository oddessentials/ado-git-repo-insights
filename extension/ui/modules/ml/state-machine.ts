/**
 * ML Artifact State Machine
 *
 * Implements the 5-state gating contract per FR-001 through FR-004:
 * - setup-required: Artifact file does not exist
 * - no-data: Artifact exists but data_quality = "insufficient" OR data array is empty
 * - invalid-artifact: Artifact exists but fails JSON parsing or required field validation
 * - unsupported-schema: Artifact parses but schema_version is not in supported range
 * - ready: Artifact is valid and contains renderable data
 *
 * State resolution is ABSOLUTE: once a state resolves, no further checks run.
 * First match wins. No mixed UI. No fallthrough.
 *
 * @module modules/ml/state-machine
 */

import type {
  ArtifactState,
  PredictionsRenderData,
  InsightsRenderData,
} from "../../types";
import { ML_SCHEMA_VERSION_RANGE } from "../../types";

/**
 * Load result from dataset loader with state information.
 */
export interface ArtifactLoadResult {
  /** Whether the artifact file exists */
  exists: boolean;
  /** Raw parsed JSON data (null if doesn't exist or parse failed) */
  data: unknown;
  /** Parse error message if JSON parsing failed */
  parseError?: string;
  /** File path for error messages */
  path?: string;
}

/**
 * Check if schema_version is within supported range.
 */
function isSchemaVersionSupported(version: unknown): version is number {
  if (typeof version !== "number") return false;
  const [min, max] = ML_SCHEMA_VERSION_RANGE;
  return version >= min && version <= max;
}

/**
 * Check if data object has required fields for predictions.
 */
function hasPredictionsRequiredFields(data: unknown): data is {
  schema_version: unknown;
  generated_at: string;
  forecasts: unknown[];
} {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    "schema_version" in obj &&
    "generated_at" in obj &&
    "forecasts" in obj &&
    Array.isArray(obj.forecasts)
  );
}

/**
 * Check if data object has required fields for insights.
 */
function hasInsightsRequiredFields(data: unknown): data is {
  schema_version: unknown;
  generated_at: string;
  insights: unknown[];
} {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    "schema_version" in obj &&
    "generated_at" in obj &&
    "insights" in obj &&
    Array.isArray(obj.insights)
  );
}

/**
 * Check if predictions data indicates no-data state.
 * no-data = data_quality is "insufficient" OR forecasts array is empty
 */
function isPredictionsNoData(data: PredictionsRenderData): boolean {
  if (data.data_quality === "insufficient") return true;
  if (!data.forecasts || data.forecasts.length === 0) return true;
  return false;
}

/**
 * Check if insights data indicates no-data state.
 * no-data = insights array is empty
 */
function isInsightsNoData(data: InsightsRenderData): boolean {
  if (!data.insights || data.insights.length === 0) return true;
  return false;
}

/**
 * Resolve artifact state for predictions.
 * Follows check order per FR-004: existence → validity → fields → version → data quality/length
 * First match wins - once a state resolves, no further checks run.
 *
 * @param result - Load result from dataset loader
 * @returns ArtifactState discriminated union
 */
export function resolvePredictionsState(
  result: ArtifactLoadResult,
): ArtifactState {
  // Check 1: File existence
  if (!result.exists) {
    return { type: "setup-required" };
  }

  // Check 2: JSON validity
  if (result.parseError) {
    return {
      type: "invalid-artifact",
      error: result.parseError,
      path: result.path,
    };
  }

  // Check 3: Required fields
  if (!hasPredictionsRequiredFields(result.data)) {
    return {
      type: "invalid-artifact",
      error:
        "Missing required fields: schema_version, generated_at, or forecasts",
      path: result.path,
    };
  }

  const data = result.data;

  // Check 4: Schema version
  if (!isSchemaVersionSupported(data.schema_version)) {
    return {
      type: "unsupported-schema",
      version:
        typeof data.schema_version === "number" ? data.schema_version : -1,
      supported: ML_SCHEMA_VERSION_RANGE,
    };
  }

  // Cast to render data type for remaining checks
  const renderData = data as unknown as PredictionsRenderData;

  // Check 5: Data quality/length
  if (isPredictionsNoData(renderData)) {
    return {
      type: "no-data",
      quality:
        renderData.data_quality === "insufficient" ? "insufficient" : undefined,
    };
  }

  // Check 6: All checks pass - ready state
  return {
    type: "ready",
    data: renderData,
  };
}

/**
 * Resolve artifact state for insights.
 * Follows check order per FR-004: existence → validity → fields → version → data quality/length
 * First match wins - once a state resolves, no further checks run.
 *
 * @param result - Load result from dataset loader
 * @returns ArtifactState discriminated union
 */
export function resolveInsightsState(
  result: ArtifactLoadResult,
): ArtifactState {
  // Check 1: File existence
  if (!result.exists) {
    return { type: "setup-required" };
  }

  // Check 2: JSON validity
  if (result.parseError) {
    return {
      type: "invalid-artifact",
      error: result.parseError,
      path: result.path,
    };
  }

  // Check 3: Required fields
  if (!hasInsightsRequiredFields(result.data)) {
    return {
      type: "invalid-artifact",
      error:
        "Missing required fields: schema_version, generated_at, or insights",
      path: result.path,
    };
  }

  const data = result.data;

  // Check 4: Schema version
  if (!isSchemaVersionSupported(data.schema_version)) {
    return {
      type: "unsupported-schema",
      version:
        typeof data.schema_version === "number" ? data.schema_version : -1,
      supported: ML_SCHEMA_VERSION_RANGE,
    };
  }

  // Cast to render data type for remaining checks
  const renderData = data as unknown as InsightsRenderData;

  // Check 5: Data quality/length
  if (isInsightsNoData(renderData)) {
    return { type: "no-data" };
  }

  // Check 6: All checks pass - ready state
  return {
    type: "ready",
    data: renderData,
  };
}

/**
 * Get human-readable error message for artifact state.
 * Used for tab-level error banners per FR-009.
 */
export function getStateMessage(state: ArtifactState): string {
  switch (state.type) {
    case "setup-required":
      return "Setup Required";
    case "no-data":
      return state.quality === "insufficient"
        ? "Insufficient Data"
        : "No Data Available";
    case "invalid-artifact":
      return `Invalid Data Format${state.path ? `: ${state.path}` : ""}`;
    case "unsupported-schema":
      return `Unsupported Schema Version ${state.version} (supported: ${state.supported[0]}-${state.supported[1]})`;
    case "ready":
      return "Data Available";
  }
}

/**
 * Check if state indicates an error condition (not ready or setup-required).
 */
export function isErrorState(state: ArtifactState): boolean {
  return (
    state.type === "invalid-artifact" || state.type === "unsupported-schema"
  );
}

/**
 * Check if state indicates data is available for rendering.
 */
export function isReadyState(state: ArtifactState): state is {
  type: "ready";
  data: PredictionsRenderData | InsightsRenderData;
} {
  return state.type === "ready";
}
