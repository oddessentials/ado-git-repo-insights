/**
 * Predictions Schema Validator
 *
 * Validates predictions/trends.json files.
 * Uses PERMISSIVE mode by default - unknown fields cause warnings, not errors.
 * Handles absent file (null/undefined) as valid since predictions are optional.
 *
 * @module schemas/predictions.schema
 */

import type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
  SchemaValidator,
} from "./types";
import { validResult, invalidResult, createError } from "./types";
import {
  isObject,
  isArray,
  isNullish,
  getTypeName,
  buildPath,
  validateRequired,
  validateNumber,
  validateString,
  validateBoolean,
  validateIsoDatetime,
  validateIsoDate,
  validateArray,
  validateNonNegativeNumber,
  findUnknownFields,
} from "./utils";

// ============================================================================
// Types
// ============================================================================

/**
 * A single forecast value point.
 */
export interface ForecastValue {
  period_start: string;
  predicted: number;
  lower_bound?: number;
  upper_bound?: number;
}

/**
 * A forecast for a specific metric.
 */
export interface Forecast {
  metric: string;
  unit: string;
  horizon_weeks: number;
  values: ForecastValue[];
}

/**
 * Predictions structure.
 */
export interface Predictions {
  schema_version: number;
  generated_at: string;
  generated_by?: string;
  is_stub?: boolean;
  forecasts: Forecast[];
  state?: string;
}

// ============================================================================
// Known Fields
// ============================================================================

const KNOWN_ROOT_FIELDS = new Set([
  "schema_version",
  "generated_at",
  "generated_by",
  "is_stub",
  "forecasts",
  "state",
]);

const KNOWN_FORECAST_FIELDS = new Set([
  "metric",
  "unit",
  "horizon_weeks",
  "values",
]);

const KNOWN_FORECAST_VALUE_FIELDS = new Set([
  "period_start",
  "predicted",
  "lower_bound",
  "upper_bound",
]);

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a forecast value entry.
 */
function validateForecastValue(
  data: unknown,
  path: string,
  strict: boolean,
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!isObject(data)) {
    errors.push(createError(path, "object", getTypeName(data)));
    return { errors, warnings };
  }

  // Required: period_start
  const periodReq = validateRequired(data, "period_start", path);
  if (periodReq) errors.push(periodReq);
  else {
    const periodErr = validateIsoDate(
      data.period_start,
      buildPath(path, "period_start"),
    );
    if (periodErr) errors.push(periodErr);
  }

  // Required: predicted
  const predictedReq = validateRequired(data, "predicted", path);
  if (predictedReq) errors.push(predictedReq);
  else {
    const predictedErr = validateNumber(
      data.predicted,
      buildPath(path, "predicted"),
    );
    if (predictedErr) errors.push(predictedErr);
  }

  // Optional: lower_bound
  if ("lower_bound" in data && data.lower_bound !== undefined) {
    const lowerErr = validateNumber(
      data.lower_bound,
      buildPath(path, "lower_bound"),
    );
    if (lowerErr) errors.push(lowerErr);
  }

  // Optional: upper_bound
  if ("upper_bound" in data && data.upper_bound !== undefined) {
    const upperErr = validateNumber(
      data.upper_bound,
      buildPath(path, "upper_bound"),
    );
    if (upperErr) errors.push(upperErr);
  }

  const unknown = findUnknownFields(
    data,
    KNOWN_FORECAST_VALUE_FIELDS,
    path,
    strict,
  );
  errors.push(...unknown.errors);
  warnings.push(...unknown.warnings);

  return { errors, warnings };
}

/**
 * Validate a forecast entry.
 */
function validateForecastEntry(
  data: unknown,
  path: string,
  strict: boolean,
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!isObject(data)) {
    errors.push(createError(path, "object", getTypeName(data)));
    return { errors, warnings };
  }

  // Required: metric
  const metricReq = validateRequired(data, "metric", path);
  if (metricReq) errors.push(metricReq);
  else {
    const metricErr = validateString(data.metric, buildPath(path, "metric"));
    if (metricErr) errors.push(metricErr);
  }

  // Required: unit
  const unitReq = validateRequired(data, "unit", path);
  if (unitReq) errors.push(unitReq);
  else {
    const unitErr = validateString(data.unit, buildPath(path, "unit"));
    if (unitErr) errors.push(unitErr);
  }

  // Required: horizon_weeks
  const horizonReq = validateRequired(data, "horizon_weeks", path);
  if (horizonReq) errors.push(horizonReq);
  else {
    const horizonErr = validateNonNegativeNumber(
      data.horizon_weeks,
      buildPath(path, "horizon_weeks"),
    );
    if (horizonErr) errors.push(horizonErr);
  }

  // Required: values
  const valuesReq = validateRequired(data, "values", path);
  if (valuesReq) errors.push(valuesReq);
  else {
    const valuesArrErr = validateArray(data.values, buildPath(path, "values"));
    if (valuesArrErr) {
      errors.push(valuesArrErr);
    } else if (isArray(data.values)) {
      data.values.forEach((item, i) => {
        const result = validateForecastValue(
          item,
          buildPath(path, `values[${i}]`),
          strict,
        );
        errors.push(...result.errors);
        warnings.push(...result.warnings);
      });
    }
  }

  const unknown = findUnknownFields(data, KNOWN_FORECAST_FIELDS, path, strict);
  errors.push(...unknown.errors);
  warnings.push(...unknown.warnings);

  return { errors, warnings };
}

// ============================================================================
// Main Validator
// ============================================================================

/**
 * Validate predictions data.
 *
 * @param data - Unknown data to validate (null/undefined = absent file = valid)
 * @param strict - If true, unknown fields cause errors; if false, they cause warnings
 * @returns ValidationResult
 */
export function validatePredictions(
  data: unknown,
  strict: boolean,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Absent file is valid for predictions (they're optional)
  if (isNullish(data)) {
    return validResult();
  }

  // Must be an object
  if (!isObject(data)) {
    errors.push(
      createError(
        "",
        "object",
        getTypeName(data),
        "Predictions must be an object",
      ),
    );
    return invalidResult(errors);
  }

  // Required fields
  const requiredFields = ["schema_version", "generated_at", "forecasts"];

  for (const field of requiredFields) {
    const err = validateRequired(data, field, "");
    if (err) errors.push(err);
  }

  // Type validations for required fields
  if ("schema_version" in data) {
    const err = validateNumber(data.schema_version, "schema_version");
    if (err) errors.push(err);
  }

  if ("generated_at" in data) {
    const err = validateIsoDatetime(data.generated_at, "generated_at");
    if (err) errors.push(err);
  }

  if ("forecasts" in data) {
    const arrErr = validateArray(data.forecasts, "forecasts");
    if (arrErr) {
      errors.push(arrErr);
    } else if (isArray(data.forecasts)) {
      data.forecasts.forEach((item, i) => {
        const result = validateForecastEntry(
          item,
          buildPath("forecasts", i),
          strict,
        );
        errors.push(...result.errors);
        warnings.push(...result.warnings);
      });
    }
  }

  // Optional fields
  if ("generated_by" in data && data.generated_by !== undefined) {
    const err = validateString(data.generated_by, "generated_by");
    if (err) errors.push(err);
  }

  if ("is_stub" in data && data.is_stub !== undefined) {
    const err = validateBoolean(data.is_stub, "is_stub");
    if (err) errors.push(err);
  }

  if ("state" in data && data.state !== undefined) {
    const err = validateString(data.state, "state");
    if (err) errors.push(err);
  }

  // Check for unknown fields at root
  const unknown = findUnknownFields(data, KNOWN_ROOT_FIELDS, "", strict);
  errors.push(...unknown.errors);
  warnings.push(...unknown.warnings);

  if (errors.length > 0) {
    return invalidResult(errors, warnings);
  }

  return validResult(warnings);
}

/**
 * Normalize validated predictions to ensure all optional fields have defaults.
 *
 * @param data - Validated predictions data (null for absent file)
 * @returns Normalized Predictions (or empty stub for absent file)
 */
export function normalizePredictions(data: unknown): Predictions {
  // Absent file returns empty stub
  if (isNullish(data)) {
    return {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      is_stub: true,
      forecasts: [],
    };
  }

  const obj = data as Record<string, unknown>;

  return {
    schema_version: obj.schema_version as number,
    generated_at: obj.generated_at as string,
    generated_by: obj.generated_by as string | undefined,
    is_stub: (obj.is_stub as boolean) ?? false,
    forecasts: obj.forecasts as Forecast[],
    state: obj.state as string | undefined,
  };
}

/**
 * Predictions schema validator object implementing SchemaValidator interface.
 */
export const PredictionsSchema: SchemaValidator<Predictions> = {
  validate: validatePredictions,
  normalize: normalizePredictions,
};
