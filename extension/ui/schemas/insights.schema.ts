/**
 * Insights Schema Validator
 *
 * Validates ai_insights/summary.json files.
 * Uses PERMISSIVE mode by default - unknown fields cause warnings, not errors.
 * Handles absent file (null/undefined) as valid since insights are optional.
 *
 * @module schemas/insights.schema
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
  validateArray,
  validateEnum,
  findUnknownFields,
} from "./utils";

// ============================================================================
// Types
// ============================================================================

/**
 * Insight data with metrics for inline visualization.
 */
export interface InsightData {
  metric_name: string;
  current_value: number;
  previous_value?: number;
  change_percent?: number;
  trend?: "up" | "down" | "stable";
}

/**
 * Affected entity (team, repository, or user).
 */
export interface AffectedEntity {
  type: "repository" | "team" | "user";
  id: string;
  name: string;
}

/**
 * Actionable recommendation.
 */
export interface Recommendation {
  action: string;
  effort?: "low" | "medium" | "high";
  priority?: "low" | "medium" | "high";
}

/**
 * Single insight item.
 */
export interface InsightItem {
  id: string | number;
  category: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  data?: InsightData;
  affected_entities?: AffectedEntity[];
  recommendation?: Recommendation;
}

/**
 * Insights structure.
 */
export interface Insights {
  schema_version: number;
  generated_at: string;
  is_stub?: boolean;
  insights: InsightItem[];
}

// ============================================================================
// Known Fields
// ============================================================================

const KNOWN_ROOT_FIELDS = new Set([
  "schema_version",
  "generated_at",
  "is_stub",
  "insights",
]);

const KNOWN_INSIGHT_FIELDS = new Set([
  "id",
  "category",
  "severity",
  "title",
  "description",
  "data",
  "affected_entities",
  "recommendation",
]);

const KNOWN_INSIGHT_DATA_FIELDS = new Set([
  "metric_name",
  "current_value",
  "previous_value",
  "change_percent",
  "trend",
]);

const KNOWN_AFFECTED_ENTITY_FIELDS = new Set(["type", "id", "name"]);

const KNOWN_RECOMMENDATION_FIELDS = new Set(["action", "effort", "priority"]);

const SEVERITY_VALUES = ["critical", "warning", "info"];
const ENTITY_TYPE_VALUES = ["repository", "team", "user"];
const EFFORT_PRIORITY_VALUES = ["low", "medium", "high"];
const TREND_VALUES = ["up", "down", "stable"];

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate insight data entry.
 */
function validateInsightData(
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

  // Required: metric_name
  const metricReq = validateRequired(data, "metric_name", path);
  if (metricReq) errors.push(metricReq);
  else {
    const err = validateString(
      data.metric_name,
      buildPath(path, "metric_name"),
    );
    if (err) errors.push(err);
  }

  // Required: current_value
  const valueReq = validateRequired(data, "current_value", path);
  if (valueReq) errors.push(valueReq);
  else {
    const err = validateNumber(
      data.current_value,
      buildPath(path, "current_value"),
    );
    if (err) errors.push(err);
  }

  // Optional: previous_value
  if ("previous_value" in data && data.previous_value !== undefined) {
    const err = validateNumber(
      data.previous_value,
      buildPath(path, "previous_value"),
    );
    if (err) errors.push(err);
  }

  // Optional: change_percent
  if ("change_percent" in data && data.change_percent !== undefined) {
    const err = validateNumber(
      data.change_percent,
      buildPath(path, "change_percent"),
    );
    if (err) errors.push(err);
  }

  // Optional: trend
  if ("trend" in data && data.trend !== undefined) {
    const err = validateEnum(
      data.trend,
      TREND_VALUES,
      buildPath(path, "trend"),
    );
    if (err) errors.push(err);
  }

  const unknown = findUnknownFields(
    data,
    KNOWN_INSIGHT_DATA_FIELDS,
    path,
    strict,
  );
  errors.push(...unknown.errors);
  warnings.push(...unknown.warnings);

  return { errors, warnings };
}

/**
 * Validate affected entity entry.
 */
function validateAffectedEntity(
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

  // Required: type
  const typeReq = validateRequired(data, "type", path);
  if (typeReq) errors.push(typeReq);
  else {
    const err = validateEnum(
      data.type,
      ENTITY_TYPE_VALUES,
      buildPath(path, "type"),
    );
    if (err) errors.push(err);
  }

  // Required: id
  const idReq = validateRequired(data, "id", path);
  if (idReq) errors.push(idReq);
  else {
    const err = validateString(data.id, buildPath(path, "id"));
    if (err) errors.push(err);
  }

  // Required: name
  const nameReq = validateRequired(data, "name", path);
  if (nameReq) errors.push(nameReq);
  else {
    const err = validateString(data.name, buildPath(path, "name"));
    if (err) errors.push(err);
  }

  const unknown = findUnknownFields(
    data,
    KNOWN_AFFECTED_ENTITY_FIELDS,
    path,
    strict,
  );
  errors.push(...unknown.errors);
  warnings.push(...unknown.warnings);

  return { errors, warnings };
}

/**
 * Validate recommendation entry.
 */
function validateRecommendation(
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

  // Required: action
  const actionReq = validateRequired(data, "action", path);
  if (actionReq) errors.push(actionReq);
  else {
    const err = validateString(data.action, buildPath(path, "action"));
    if (err) errors.push(err);
  }

  // Optional: effort
  if ("effort" in data && data.effort !== undefined) {
    const err = validateEnum(
      data.effort,
      EFFORT_PRIORITY_VALUES,
      buildPath(path, "effort"),
    );
    if (err) errors.push(err);
  }

  // Optional: priority
  if ("priority" in data && data.priority !== undefined) {
    const err = validateEnum(
      data.priority,
      EFFORT_PRIORITY_VALUES,
      buildPath(path, "priority"),
    );
    if (err) errors.push(err);
  }

  const unknown = findUnknownFields(
    data,
    KNOWN_RECOMMENDATION_FIELDS,
    path,
    strict,
  );
  errors.push(...unknown.errors);
  warnings.push(...unknown.warnings);

  return { errors, warnings };
}

/**
 * Validate insight item entry.
 */
function validateInsightItem(
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

  // Required: id (can be string or number)
  const idReq = validateRequired(data, "id", path);
  if (idReq) errors.push(idReq);
  else {
    const id = data.id;
    if (typeof id !== "string" && typeof id !== "number") {
      errors.push(
        createError(buildPath(path, "id"), "string | number", getTypeName(id)),
      );
    }
  }

  // Required: category
  const categoryReq = validateRequired(data, "category", path);
  if (categoryReq) errors.push(categoryReq);
  else {
    const err = validateString(data.category, buildPath(path, "category"));
    if (err) errors.push(err);
  }

  // Required: severity
  const severityReq = validateRequired(data, "severity", path);
  if (severityReq) errors.push(severityReq);
  else {
    const err = validateEnum(
      data.severity,
      SEVERITY_VALUES,
      buildPath(path, "severity"),
    );
    if (err) errors.push(err);
  }

  // Required: title
  const titleReq = validateRequired(data, "title", path);
  if (titleReq) errors.push(titleReq);
  else {
    const err = validateString(data.title, buildPath(path, "title"));
    if (err) errors.push(err);
  }

  // Required: description
  const descReq = validateRequired(data, "description", path);
  if (descReq) errors.push(descReq);
  else {
    const err = validateString(
      data.description,
      buildPath(path, "description"),
    );
    if (err) errors.push(err);
  }

  // Optional: data
  if ("data" in data && data.data !== undefined) {
    const result = validateInsightData(
      data.data,
      buildPath(path, "data"),
      strict,
    );
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  // Optional: affected_entities
  if ("affected_entities" in data && data.affected_entities !== undefined) {
    const arrErr = validateArray(
      data.affected_entities,
      buildPath(path, "affected_entities"),
    );
    if (arrErr) {
      errors.push(arrErr);
    } else if (isArray(data.affected_entities)) {
      data.affected_entities.forEach((entity, i) => {
        const result = validateAffectedEntity(
          entity,
          buildPath(path, `affected_entities[${i}]`),
          strict,
        );
        errors.push(...result.errors);
        warnings.push(...result.warnings);
      });
    }
  }

  // Optional: recommendation
  if ("recommendation" in data && data.recommendation !== undefined) {
    const result = validateRecommendation(
      data.recommendation,
      buildPath(path, "recommendation"),
      strict,
    );
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  const unknown = findUnknownFields(data, KNOWN_INSIGHT_FIELDS, path, strict);
  errors.push(...unknown.errors);
  warnings.push(...unknown.warnings);

  return { errors, warnings };
}

// ============================================================================
// Main Validator
// ============================================================================

/**
 * Validate insights data.
 *
 * @param data - Unknown data to validate (null/undefined = absent file = valid)
 * @param strict - If true, unknown fields cause errors; if false, they cause warnings
 * @returns ValidationResult
 */
export function validateInsights(
  data: unknown,
  strict: boolean,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Absent file is valid for insights (they're optional)
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
        "Insights must be an object",
      ),
    );
    return invalidResult(errors);
  }

  // Required fields
  const requiredFields = ["schema_version", "generated_at", "insights"];

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

  if ("insights" in data) {
    const arrErr = validateArray(data.insights, "insights");
    if (arrErr) {
      errors.push(arrErr);
    } else if (isArray(data.insights)) {
      data.insights.forEach((item, i) => {
        const result = validateInsightItem(
          item,
          buildPath("insights", i),
          strict,
        );
        errors.push(...result.errors);
        warnings.push(...result.warnings);
      });
    }
  }

  // Optional fields
  if ("is_stub" in data && data.is_stub !== undefined) {
    const err = validateBoolean(data.is_stub, "is_stub");
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
 * Normalize validated insights to ensure all optional fields have defaults.
 *
 * @param data - Validated insights data (null for absent file)
 * @returns Normalized Insights (or empty stub for absent file)
 */
export function normalizeInsights(data: unknown): Insights {
  // Absent file returns empty stub
  if (isNullish(data)) {
    return {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      is_stub: true,
      insights: [],
    };
  }

  const obj = data as Record<string, unknown>;

  return {
    schema_version: obj.schema_version as number,
    generated_at: obj.generated_at as string,
    is_stub: (obj.is_stub as boolean) ?? false,
    insights: obj.insights as InsightItem[],
  };
}

/**
 * Insights schema validator object implementing SchemaValidator interface.
 */
export const InsightsSchema: SchemaValidator<Insights> = {
  validate: validateInsights,
  normalize: normalizeInsights,
};
