/**
 * Rollup Schema Validator
 *
 * Validates weekly rollup JSON files.
 * Uses PERMISSIVE mode by default - unknown fields cause warnings, not errors.
 *
 * @module schemas/rollup.schema
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
  isNumber,
  getTypeName,
  buildPath,
  validateRequired,
  validateNumber,
  validateIsoDate,
  validateIsoWeek,
  validateNonNegativeNumber,
  findUnknownFields,
} from "./utils";

// ============================================================================
// Types
// ============================================================================

/**
 * Breakdown by repository or team.
 */
export interface BreakdownEntry {
  pr_count: number;
  cycle_time_p50?: number;
  cycle_time_p90?: number;
  review_time_p50?: number;
  review_time_p90?: number;
}

/**
 * Weekly rollup structure.
 */
export interface WeeklyRollup {
  week: string;
  start_date?: string;
  end_date?: string;
  pr_count: number;
  cycle_time_p50?: number;
  cycle_time_p90?: number;
  review_time_p50?: number;
  review_time_p90?: number;
  authors_count?: number;
  reviewers_count?: number;
  by_repository?: Record<string, BreakdownEntry>;
  by_team?: Record<string, BreakdownEntry>;
}

// ============================================================================
// Known Fields
// ============================================================================

const KNOWN_ROOT_FIELDS = new Set([
  "week",
  "start_date",
  "end_date",
  "pr_count",
  "cycle_time_p50",
  "cycle_time_p90",
  "review_time_p50",
  "review_time_p90",
  "authors_count",
  "reviewers_count",
  "by_repository",
  "by_team",
]);

const KNOWN_BREAKDOWN_FIELDS = new Set([
  "pr_count",
  "cycle_time_p50",
  "cycle_time_p90",
  "review_time_p50",
  "review_time_p90",
]);

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a breakdown entry (by_repository or by_team item).
 */
function validateBreakdownEntry(
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

  // pr_count is typically present but not strictly required in breakdowns
  if ("pr_count" in data) {
    const err = validateNonNegativeNumber(
      data.pr_count,
      buildPath(path, "pr_count"),
    );
    if (err) errors.push(err);
  }

  // Optional numeric fields
  // Use hasOwnProperty.call for safe property check (avoids prototype pollution)
  const numericFields = [
    "cycle_time_p50",
    "cycle_time_p90",
    "review_time_p50",
    "review_time_p90",
  ];
  for (const field of numericFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      const fieldValue = Object.getOwnPropertyDescriptor(data, field)?.value;
      if (fieldValue !== undefined) {
        const err = validateNumber(fieldValue, buildPath(path, field));
        if (err) errors.push(err);
      }
    }
  }

  const unknown = findUnknownFields(data, KNOWN_BREAKDOWN_FIELDS, path, strict);
  errors.push(...unknown.errors);
  warnings.push(...unknown.warnings);

  return { errors, warnings };
}

/**
 * Validate a breakdown object (by_repository or by_team).
 */
function validateBreakdown(
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

  // Each key is a repository/team name, value is a breakdown entry
  for (const [key, value] of Object.entries(data)) {
    const result = validateBreakdownEntry(value, buildPath(path, key), strict);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  return { errors, warnings };
}

// ============================================================================
// Main Validator
// ============================================================================

/**
 * Validate a weekly rollup.
 *
 * @param data - Unknown data to validate
 * @param strict - If true, unknown fields cause errors; if false, they cause warnings
 * @returns ValidationResult
 */
export function validateRollup(
  data: unknown,
  strict: boolean,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Must be an object
  if (!isObject(data)) {
    errors.push(
      createError("", "object", getTypeName(data), "Rollup must be an object"),
    );
    return invalidResult(errors);
  }

  // Required fields
  const requiredFields = ["week", "pr_count"];

  for (const field of requiredFields) {
    const err = validateRequired(data, field, "");
    if (err) errors.push(err);
  }

  // Type validations for required fields
  if ("week" in data) {
    const err = validateIsoWeek(data.week, "week");
    if (err) errors.push(err);
  }

  if ("pr_count" in data) {
    const err = validateNonNegativeNumber(data.pr_count, "pr_count");
    if (err) errors.push(err);
  }

  // Optional date fields (may not be present in legacy rollups)
  if ("start_date" in data && data.start_date !== undefined) {
    const err = validateIsoDate(data.start_date, "start_date");
    if (err) errors.push(err);
  }

  if ("end_date" in data && data.end_date !== undefined) {
    const err = validateIsoDate(data.end_date, "end_date");
    if (err) errors.push(err);
  }

  // Optional numeric fields
  const numericFields = [
    "cycle_time_p50",
    "cycle_time_p90",
    "review_time_p50",
    "review_time_p90",
    "authors_count",
    "reviewers_count",
  ];

  // Use hasOwnProperty.call for safe property check (avoids prototype pollution)
  for (const field of numericFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      const fieldValue = Object.getOwnPropertyDescriptor(data, field)?.value;
      if (fieldValue !== undefined) {
        const err = validateNumber(fieldValue, field);
        if (err) errors.push(err);
      }
    }
  }

  // Optional breakdown objects
  if (
    Object.prototype.hasOwnProperty.call(data, "by_repository") &&
    data.by_repository !== undefined
  ) {
    const result = validateBreakdown(
      data.by_repository,
      "by_repository",
      strict,
    );
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  if ("by_team" in data && data.by_team !== undefined) {
    const result = validateBreakdown(data.by_team, "by_team", strict);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
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
 * Default values for rollup fields.
 */
const ROLLUP_FIELD_DEFAULTS = {
  cycle_time_p50: 0,
  cycle_time_p90: 0,
  review_time_p50: 0,
  review_time_p90: 0,
  authors_count: 0,
  reviewers_count: 0,
  by_repository: {},
  by_team: {},
};

/**
 * Normalize a validated rollup to ensure all optional fields have defaults.
 *
 * @param data - Validated rollup data
 * @returns Normalized WeeklyRollup
 */
export function normalizeRollup(data: unknown): WeeklyRollup {
  const obj = data as Record<string, unknown>;

  return {
    week: obj.week as string,
    start_date: obj.start_date as string,
    end_date: obj.end_date as string,
    pr_count: obj.pr_count as number,
    cycle_time_p50: isNumber(obj.cycle_time_p50)
      ? obj.cycle_time_p50
      : ROLLUP_FIELD_DEFAULTS.cycle_time_p50,
    cycle_time_p90: isNumber(obj.cycle_time_p90)
      ? obj.cycle_time_p90
      : ROLLUP_FIELD_DEFAULTS.cycle_time_p90,
    review_time_p50: isNumber(obj.review_time_p50)
      ? obj.review_time_p50
      : ROLLUP_FIELD_DEFAULTS.review_time_p50,
    review_time_p90: isNumber(obj.review_time_p90)
      ? obj.review_time_p90
      : ROLLUP_FIELD_DEFAULTS.review_time_p90,
    authors_count: isNumber(obj.authors_count)
      ? obj.authors_count
      : ROLLUP_FIELD_DEFAULTS.authors_count,
    reviewers_count: isNumber(obj.reviewers_count)
      ? obj.reviewers_count
      : ROLLUP_FIELD_DEFAULTS.reviewers_count,
    by_repository:
      (obj.by_repository as Record<string, BreakdownEntry>) ??
      ROLLUP_FIELD_DEFAULTS.by_repository,
    by_team:
      (obj.by_team as Record<string, BreakdownEntry>) ??
      ROLLUP_FIELD_DEFAULTS.by_team,
  };
}

/**
 * Rollup schema validator object implementing SchemaValidator interface.
 */
export const RollupSchema: SchemaValidator<WeeklyRollup> = {
  validate: validateRollup,
  normalize: normalizeRollup,
};
