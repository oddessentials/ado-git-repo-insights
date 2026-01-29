/**
 * Manifest Schema Validator
 *
 * Validates dataset-manifest.json files.
 * Uses STRICT mode by default - unknown fields cause errors.
 *
 * @module schemas/manifest.schema
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
  getTypeName,
  buildPath,
  validateRequired,
  validateNumber,
  validateString,
  validateIsoDatetime,
  validateIsoDate,
  validateIsoWeek,
  validateYear,
  validateArray,
  validateBoolean,
  findUnknownFields,
  validateNonNegativeNumber,
} from "./utils";

// ============================================================================
// Types
// ============================================================================

/**
 * Weekly rollup index entry.
 */
export interface WeeklyRollupEntry {
  week: string;
  path: string;
  pr_count?: number;
  size_bytes?: number;
  start_date?: string;
  end_date?: string;
}

/**
 * Distribution index entry.
 */
export interface DistributionEntry {
  year: string;
  path: string;
  total_prs?: number;
  size_bytes?: number;
  start_date?: string;
  end_date?: string;
}

/**
 * Aggregate index structure.
 */
export interface AggregateIndex {
  weekly_rollups: WeeklyRollupEntry[];
  distributions: DistributionEntry[];
}

/**
 * Date range structure.
 */
export interface DateRange {
  min: string;
  max: string;
}

/**
 * Coverage information.
 */
export interface Coverage {
  total_prs: number;
  date_range: DateRange;
  comments?: string;
}

/**
 * Feature flags.
 */
export interface Features {
  teams?: boolean;
  comments?: boolean;
  predictions?: boolean;
  ai_insights?: boolean;
}

/**
 * Limits configuration.
 */
export interface Limits {
  max_weekly_files?: number;
  max_distribution_files?: number;
}

/**
 * Defaults configuration.
 */
export interface Defaults {
  default_date_range_days?: number;
}

/**
 * Dataset manifest structure.
 */
export interface DatasetManifest {
  manifest_schema_version: number;
  dataset_schema_version: number;
  aggregates_schema_version: number;
  predictions_schema_version?: number;
  insights_schema_version?: number;
  generated_at: string;
  run_id: string;
  defaults?: Defaults;
  limits?: Limits;
  features?: Features;
  coverage?: Coverage;
  aggregate_index: AggregateIndex;
  warnings?: string[];
}

// ============================================================================
// Known Fields
// ============================================================================

const KNOWN_ROOT_FIELDS = new Set([
  "manifest_schema_version",
  "dataset_schema_version",
  "aggregates_schema_version",
  "predictions_schema_version",
  "insights_schema_version",
  "generated_at",
  "run_id",
  "defaults",
  "limits",
  "features",
  "coverage",
  "aggregate_index",
  "warnings",
  "operational", // Production field for operational metadata
]);

const KNOWN_WEEKLY_ROLLUP_FIELDS = new Set([
  "week",
  "path",
  "pr_count",
  "size_bytes",
  "start_date", // Production field
  "end_date", // Production field
]);
const KNOWN_DISTRIBUTION_FIELDS = new Set([
  "year",
  "path",
  "total_prs",
  "size_bytes",
  "start_date", // Production field
  "end_date", // Production field
]);
const KNOWN_COVERAGE_FIELDS = new Set([
  "total_prs",
  "date_range",
  "comments",
  "row_counts", // Production field
  "teams_count", // Production field
]);
const KNOWN_DATE_RANGE_FIELDS = new Set(["min", "max"]);
const KNOWN_FEATURES_FIELDS = new Set([
  "teams",
  "comments",
  "predictions",
  "ai_insights",
]);
const KNOWN_LIMITS_FIELDS = new Set([
  "max_weekly_files",
  "max_distribution_files",
  "max_date_range_days_soft", // Production field
]);
const KNOWN_DEFAULTS_FIELDS = new Set(["default_date_range_days"]);

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a weekly rollup entry.
 */
function validateWeeklyRollupEntry(
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

  // Required fields
  const weekReq = validateRequired(data, "week", path);
  if (weekReq) errors.push(weekReq);
  else {
    const weekErr = validateIsoWeek(data.week, buildPath(path, "week"));
    if (weekErr) errors.push(weekErr);
  }

  const pathReq = validateRequired(data, "path", path);
  if (pathReq) errors.push(pathReq);
  else {
    const pathErr = validateString(data.path, buildPath(path, "path"));
    if (pathErr) errors.push(pathErr);
  }

  // Optional fields
  if ("size_bytes" in data && data.size_bytes !== undefined) {
    const sizeErr = validateNonNegativeNumber(
      data.size_bytes,
      buildPath(path, "size_bytes"),
    );
    if (sizeErr) errors.push(sizeErr);
  }

  if ("pr_count" in data && data.pr_count !== undefined) {
    const prCountErr = validateNonNegativeNumber(
      data.pr_count,
      buildPath(path, "pr_count"),
    );
    if (prCountErr) errors.push(prCountErr);
  }

  if ("start_date" in data && data.start_date !== undefined) {
    const err = validateIsoDate(data.start_date, buildPath(path, "start_date"));
    if (err) errors.push(err);
  }

  if ("end_date" in data && data.end_date !== undefined) {
    const err = validateIsoDate(data.end_date, buildPath(path, "end_date"));
    if (err) errors.push(err);
  }

  // Unknown fields
  const unknown = findUnknownFields(
    data,
    KNOWN_WEEKLY_ROLLUP_FIELDS,
    path,
    strict,
  );
  errors.push(...unknown.errors);
  warnings.push(...unknown.warnings);

  return { errors, warnings };
}

/**
 * Validate a distribution entry.
 */
function validateDistributionEntry(
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

  // Required fields
  const yearReq = validateRequired(data, "year", path);
  if (yearReq) errors.push(yearReq);
  else {
    const yearErr = validateYear(data.year, buildPath(path, "year"));
    if (yearErr) errors.push(yearErr);
  }

  const pathReq = validateRequired(data, "path", path);
  if (pathReq) errors.push(pathReq);
  else {
    const pathErr = validateString(data.path, buildPath(path, "path"));
    if (pathErr) errors.push(pathErr);
  }

  // Optional fields
  if ("size_bytes" in data && data.size_bytes !== undefined) {
    const sizeErr = validateNonNegativeNumber(
      data.size_bytes,
      buildPath(path, "size_bytes"),
    );
    if (sizeErr) errors.push(sizeErr);
  }

  if ("total_prs" in data && data.total_prs !== undefined) {
    const totalPrsErr = validateNonNegativeNumber(
      data.total_prs,
      buildPath(path, "total_prs"),
    );
    if (totalPrsErr) errors.push(totalPrsErr);
  }

  if ("start_date" in data && data.start_date !== undefined) {
    const err = validateIsoDate(data.start_date, buildPath(path, "start_date"));
    if (err) errors.push(err);
  }

  if ("end_date" in data && data.end_date !== undefined) {
    const err = validateIsoDate(data.end_date, buildPath(path, "end_date"));
    if (err) errors.push(err);
  }

  // Unknown fields
  const unknown = findUnknownFields(
    data,
    KNOWN_DISTRIBUTION_FIELDS,
    path,
    strict,
  );
  errors.push(...unknown.errors);
  warnings.push(...unknown.warnings);

  return { errors, warnings };
}

/**
 * Validate aggregate index.
 */
function validateAggregateIndex(
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

  // weekly_rollups
  const weeklyReq = validateRequired(data, "weekly_rollups", path);
  if (weeklyReq) errors.push(weeklyReq);
  else {
    const weeklyArrErr = validateArray(
      data.weekly_rollups,
      buildPath(path, "weekly_rollups"),
    );
    if (weeklyArrErr) errors.push(weeklyArrErr);
    else if (isArray(data.weekly_rollups)) {
      data.weekly_rollups.forEach((item, i) => {
        const result = validateWeeklyRollupEntry(
          item,
          buildPath(path, `weekly_rollups[${i}]`),
          strict,
        );
        errors.push(...result.errors);
        warnings.push(...result.warnings);
      });
    }
  }

  // distributions
  const distReq = validateRequired(data, "distributions", path);
  if (distReq) errors.push(distReq);
  else {
    const distArrErr = validateArray(
      data.distributions,
      buildPath(path, "distributions"),
    );
    if (distArrErr) errors.push(distArrErr);
    else if (isArray(data.distributions)) {
      data.distributions.forEach((item, i) => {
        const result = validateDistributionEntry(
          item,
          buildPath(path, `distributions[${i}]`),
          strict,
        );
        errors.push(...result.errors);
        warnings.push(...result.warnings);
      });
    }
  }

  return { errors, warnings };
}

/**
 * Validate date range.
 */
function validateDateRange(
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

  const minReq = validateRequired(data, "min", path);
  if (minReq) errors.push(minReq);
  else {
    const minErr = validateIsoDate(data.min, buildPath(path, "min"));
    if (minErr) errors.push(minErr);
  }

  const maxReq = validateRequired(data, "max", path);
  if (maxReq) errors.push(maxReq);
  else {
    const maxErr = validateIsoDate(data.max, buildPath(path, "max"));
    if (maxErr) errors.push(maxErr);
  }

  const unknown = findUnknownFields(
    data,
    KNOWN_DATE_RANGE_FIELDS,
    path,
    strict,
  );
  errors.push(...unknown.errors);
  warnings.push(...unknown.warnings);

  return { errors, warnings };
}

/**
 * Validate coverage section.
 */
function validateCoverage(
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

  // total_prs (required)
  if ("total_prs" in data) {
    const prErr = validateNonNegativeNumber(
      data.total_prs,
      buildPath(path, "total_prs"),
    );
    if (prErr) errors.push(prErr);
  }

  // date_range (required if coverage present)
  if ("date_range" in data) {
    const result = validateDateRange(
      data.date_range,
      buildPath(path, "date_range"),
      strict,
    );
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  // comments (optional - can be string or object in production)
  if ("comments" in data && data.comments !== undefined) {
    const commentsValue = data.comments;
    // Accept both string (legacy) and object (production) formats
    if (typeof commentsValue !== "string" && !isObject(commentsValue)) {
      errors.push(
        createError(
          buildPath(path, "comments"),
          "string or object",
          getTypeName(commentsValue),
          `Expected string or object at '${buildPath(path, "comments")}'`,
        ),
      );
    }
  }

  // row_counts (optional object - production field)
  if ("row_counts" in data && data.row_counts !== undefined) {
    if (!isObject(data.row_counts)) {
      errors.push(
        createError(
          buildPath(path, "row_counts"),
          "object",
          getTypeName(data.row_counts),
        ),
      );
    }
  }

  // teams_count (optional number - production field)
  if ("teams_count" in data && data.teams_count !== undefined) {
    const err = validateNonNegativeNumber(
      data.teams_count,
      buildPath(path, "teams_count"),
    );
    if (err) errors.push(err);
  }

  const unknown = findUnknownFields(data, KNOWN_COVERAGE_FIELDS, path, strict);
  errors.push(...unknown.errors);
  warnings.push(...unknown.warnings);

  return { errors, warnings };
}

/**
 * Validate features section.
 */
function validateFeatures(
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

  // Use hasOwnProperty.call for safe property check (avoids prototype pollution)
  const boolFields = ["teams", "comments", "predictions", "ai_insights"];
  for (const field of boolFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      const fieldValue = Object.getOwnPropertyDescriptor(data, field)?.value;
      if (fieldValue !== undefined) {
        const err = validateBoolean(fieldValue, buildPath(path, field));
        if (err) errors.push(err);
      }
    }
  }

  const unknown = findUnknownFields(data, KNOWN_FEATURES_FIELDS, path, strict);
  errors.push(...unknown.errors);
  warnings.push(...unknown.warnings);

  return { errors, warnings };
}

/**
 * Validate limits section.
 */
function validateLimits(
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

  if ("max_weekly_files" in data && data.max_weekly_files !== undefined) {
    const err = validateNonNegativeNumber(
      data.max_weekly_files,
      buildPath(path, "max_weekly_files"),
    );
    if (err) errors.push(err);
  }

  if (
    "max_distribution_files" in data &&
    data.max_distribution_files !== undefined
  ) {
    const err = validateNonNegativeNumber(
      data.max_distribution_files,
      buildPath(path, "max_distribution_files"),
    );
    if (err) errors.push(err);
  }

  // Production field
  if (
    "max_date_range_days_soft" in data &&
    data.max_date_range_days_soft !== undefined
  ) {
    const err = validateNonNegativeNumber(
      data.max_date_range_days_soft,
      buildPath(path, "max_date_range_days_soft"),
    );
    if (err) errors.push(err);
  }

  const unknown = findUnknownFields(data, KNOWN_LIMITS_FIELDS, path, strict);
  errors.push(...unknown.errors);
  warnings.push(...unknown.warnings);

  return { errors, warnings };
}

/**
 * Validate defaults section.
 */
function validateDefaults(
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

  if (
    "default_date_range_days" in data &&
    data.default_date_range_days !== undefined
  ) {
    const err = validateNonNegativeNumber(
      data.default_date_range_days,
      buildPath(path, "default_date_range_days"),
    );
    if (err) errors.push(err);
  }

  const unknown = findUnknownFields(data, KNOWN_DEFAULTS_FIELDS, path, strict);
  errors.push(...unknown.errors);
  warnings.push(...unknown.warnings);

  return { errors, warnings };
}

// ============================================================================
// Main Validator
// ============================================================================

/**
 * Validate a dataset manifest.
 *
 * @param data - Unknown data to validate
 * @param strict - If true, unknown fields cause errors; if false, they cause warnings
 * @returns ValidationResult
 */
export function validateManifest(
  data: unknown,
  strict: boolean,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Must be an object
  if (!isObject(data)) {
    errors.push(
      createError(
        "",
        "object",
        getTypeName(data),
        "Manifest must be an object",
      ),
    );
    return invalidResult(errors);
  }

  // Required fields
  const requiredFields = [
    "manifest_schema_version",
    "dataset_schema_version",
    "aggregates_schema_version",
    "generated_at",
    "run_id",
    "aggregate_index",
  ];

  for (const field of requiredFields) {
    const err = validateRequired(data, field, "");
    if (err) errors.push(err);
  }

  // Type validations for required fields (only if present)
  if ("manifest_schema_version" in data) {
    const err = validateNumber(
      data.manifest_schema_version,
      "manifest_schema_version",
    );
    if (err) errors.push(err);
  }

  if ("dataset_schema_version" in data) {
    const err = validateNumber(
      data.dataset_schema_version,
      "dataset_schema_version",
    );
    if (err) errors.push(err);
  }

  if ("aggregates_schema_version" in data) {
    const err = validateNumber(
      data.aggregates_schema_version,
      "aggregates_schema_version",
    );
    if (err) errors.push(err);
  }

  if ("generated_at" in data) {
    const err = validateIsoDatetime(data.generated_at, "generated_at");
    if (err) errors.push(err);
  }

  if ("run_id" in data) {
    const err = validateString(data.run_id, "run_id");
    if (err) errors.push(err);
  }

  // aggregate_index
  if ("aggregate_index" in data) {
    const result = validateAggregateIndex(
      data.aggregate_index,
      "aggregate_index",
      strict,
    );
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  // Optional fields with type validation
  if (
    "predictions_schema_version" in data &&
    data.predictions_schema_version !== undefined
  ) {
    const err = validateNumber(
      data.predictions_schema_version,
      "predictions_schema_version",
    );
    if (err) errors.push(err);
  }

  if (
    "insights_schema_version" in data &&
    data.insights_schema_version !== undefined
  ) {
    const err = validateNumber(
      data.insights_schema_version,
      "insights_schema_version",
    );
    if (err) errors.push(err);
  }

  if ("defaults" in data && data.defaults !== undefined) {
    const result = validateDefaults(data.defaults, "defaults", strict);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  if ("limits" in data && data.limits !== undefined) {
    const result = validateLimits(data.limits, "limits", strict);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  if ("features" in data && data.features !== undefined) {
    const result = validateFeatures(data.features, "features", strict);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  if ("coverage" in data && data.coverage !== undefined) {
    const result = validateCoverage(data.coverage, "coverage", strict);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  if ("warnings" in data && data.warnings !== undefined) {
    const err = validateArray(data.warnings, "warnings");
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
 * Normalize a validated manifest to ensure all optional fields have defaults.
 *
 * @param data - Validated manifest data
 * @returns Normalized DatasetManifest
 */
export function normalizeManifest(data: unknown): DatasetManifest {
  const obj = data as Record<string, unknown>;

  return {
    manifest_schema_version: obj.manifest_schema_version as number,
    dataset_schema_version: obj.dataset_schema_version as number,
    aggregates_schema_version: obj.aggregates_schema_version as number,
    predictions_schema_version: (obj.predictions_schema_version as number) ?? 1,
    insights_schema_version: (obj.insights_schema_version as number) ?? 1,
    generated_at: obj.generated_at as string,
    run_id: obj.run_id as string,
    defaults: (obj.defaults as Defaults) ?? { default_date_range_days: 90 },
    limits: (obj.limits as Limits) ?? {
      max_weekly_files: 52,
      max_distribution_files: 5,
    },
    features: (obj.features as Features) ?? {},
    coverage: obj.coverage as Coverage | undefined,
    aggregate_index: obj.aggregate_index as AggregateIndex,
    warnings: (obj.warnings as string[]) ?? [],
  };
}

/**
 * Manifest schema validator object implementing SchemaValidator interface.
 */
export const ManifestSchema: SchemaValidator<DatasetManifest> = {
  validate: validateManifest,
  normalize: normalizeManifest,
};
