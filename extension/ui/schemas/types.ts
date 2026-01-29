/**
 * Schema Validation Types
 *
 * Core types for schema validation results, errors, and warnings.
 * Based on contracts/schema-validator.ts specification.
 *
 * @module schemas/types
 */

/**
 * Result of a schema validation operation.
 */
export interface ValidationResult {
  /** Whether the validation passed */
  valid: boolean;
  /** Array of validation errors (empty if valid) */
  errors: ValidationError[];
  /** Array of warnings for permissive mode (unknown fields) */
  warnings: ValidationWarning[];
}

/**
 * A single validation error.
 */
export interface ValidationError {
  /** JSON path to the failing field (e.g., "aggregate_index.weekly_rollups[0].week") */
  field: string;
  /** Expected type or constraint */
  expected: string;
  /** Actual value or type found */
  actual: string;
  /** Human-readable error message */
  message: string;
}

/**
 * A validation warning (permissive mode only).
 */
export interface ValidationWarning {
  /** JSON path to the unexpected field */
  field: string;
  /** Warning message */
  message: string;
}

/**
 * Schema validator interface.
 * All validators follow this contract.
 */
export interface SchemaValidator<T> {
  /**
   * Validate data against the schema.
   *
   * @param data - Unknown data to validate
   * @param strict - If true, unknown fields cause errors; if false, they cause warnings
   * @returns ValidationResult with valid flag, errors, and warnings
   */
  validate(data: unknown, strict: boolean): ValidationResult;

  /**
   * Normalize data to ensure all optional fields have defaults.
   * Called after successful validation.
   *
   * @param data - Validated data
   * @returns Normalized data with defaults applied
   */
  normalize(data: unknown): T;
}

/**
 * Artifact types that can be validated.
 */
export type ArtifactType =
  | "manifest"
  | "rollup"
  | "dimensions"
  | "predictions"
  | "insights";

/**
 * Schema version constants for ML artifacts.
 * Used for validation and unsupported-schema state messages.
 */
export const ML_SCHEMA_MIN_VERSION = 1;
export const ML_SCHEMA_MAX_VERSION = 1;

/**
 * Creates a successful validation result.
 */
export function validResult(
  warnings: ValidationWarning[] = [],
): ValidationResult {
  return { valid: true, errors: [], warnings };
}

/**
 * Creates a failed validation result.
 */
export function invalidResult(
  errors: ValidationError[],
  warnings: ValidationWarning[] = [],
): ValidationResult {
  return { valid: false, errors, warnings };
}

/**
 * Creates a validation error.
 */
export function createError(
  field: string,
  expected: string,
  actual: string,
  message?: string,
): ValidationError {
  return {
    field,
    expected,
    actual,
    message: message || `Expected ${expected} at '${field}', got ${actual}`,
  };
}

/**
 * Creates a validation warning.
 */
export function createWarning(
  field: string,
  message?: string,
): ValidationWarning {
  return {
    field,
    message: message || `Unknown field '${field}'`,
  };
}
