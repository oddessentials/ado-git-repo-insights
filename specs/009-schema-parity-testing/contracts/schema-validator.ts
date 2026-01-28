/**
 * Schema Validator Contract
 *
 * This file defines the TypeScript interface contract for schema validation.
 * Implementation will be in extension/ui/schemas/index.ts
 *
 * Feature: 009-schema-parity-testing
 */

// ============================================================================
// Core Types
// ============================================================================

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

// ============================================================================
// Validator Interface
// ============================================================================

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

// ============================================================================
// Exported Validators (to be implemented)
// ============================================================================

/**
 * Manifest schema validator.
 * Strict mode: dataset-manifest.json must have no unknown fields.
 */
export declare const manifestValidator: SchemaValidator<ManifestSchema>;

/**
 * Rollup schema validator.
 * Permissive mode: weekly rollup files may have unknown fields (logged as warnings).
 */
export declare const rollupValidator: SchemaValidator<RollupSchema>;

/**
 * Dimensions schema validator.
 * Strict mode: dimensions.json must have no unknown fields.
 */
export declare const dimensionsValidator: SchemaValidator<DimensionsSchema>;

/**
 * Predictions schema validator.
 * Permissive mode: predictions.json may have unknown fields (logged as warnings).
 * Note: File may be absent; absence is not a validation error.
 */
export declare const predictionsValidator: SchemaValidator<PredictionsSchema>;

// ============================================================================
// Convenience Functions (to be implemented)
// ============================================================================

/**
 * Validate manifest data with strict mode (default for manifest).
 */
export declare function validateManifest(data: unknown): ValidationResult;

/**
 * Validate rollup data with permissive mode (default for rollup).
 */
export declare function validateRollup(data: unknown): ValidationResult;

/**
 * Validate dimensions data with strict mode (default for dimensions).
 */
export declare function validateDimensions(data: unknown): ValidationResult;

/**
 * Validate predictions data with permissive mode (default for predictions).
 * Returns valid=true if data is undefined/null (file optional).
 */
export declare function validatePredictions(data: unknown): ValidationResult;

// ============================================================================
// Schema Types (derived from extension/ui/types.ts)
// ============================================================================

/**
 * Manifest schema type.
 */
export interface ManifestSchema {
  manifest_schema_version: number;
  dataset_schema_version?: number;
  aggregates_schema_version?: number;
  predictions_schema_version?: number;
  insights_schema_version?: number;
  generated_at?: string;
  run_id?: string;
  defaults?: {
    default_date_range_days?: number;
  };
  limits?: {
    max_weekly_files?: number;
    max_distribution_files?: number;
  };
  features?: Record<string, boolean>;
  coverage?: {
    total_prs?: number;
    date_range?: {
      min?: string;
      max?: string;
    };
    comments?: string;
  };
  aggregate_index?: {
    weekly_rollups?: Array<{
      week: string;
      path: string;
      pr_count?: number;
      size_bytes?: number;
    }>;
    distributions?: Array<{
      year: string;
      path: string;
      total_prs?: number;
      size_bytes?: number;
    }>;
    predictions?: { path: string };
    ai_insights?: { path: string };
  };
  warnings?: string[];
}

/**
 * Rollup schema type.
 */
export interface RollupSchema {
  week: string;
  pr_count?: number;
  cycle_time_p50?: number | null;
  cycle_time_p90?: number | null;
  authors_count?: number;
  reviewers_count?: number;
  by_repository?: Record<string, number> | null;
  by_team?: Record<string, number> | null;
}

/**
 * Dimensions schema type.
 */
export interface DimensionsSchema {
  repositories?: Array<{
    id: string;
    name: string;
    project?: string;
  }>;
  users?: Array<{
    id: string;
    displayName: string;
    uniqueName?: string;
  }>;
  projects?: Array<{
    id: string;
    name: string;
  }>;
  teams?: Array<{
    id: string;
    name: string;
    projectId?: string;
  }>;
  date_range?: {
    min: string;
    max: string;
  };
}

/**
 * Predictions schema type.
 */
export interface PredictionsSchema {
  state: "disabled" | "missing" | "auth" | "ok" | "error" | "invalid" | "unavailable";
  data?: unknown;
  error?: string;
  message?: string;
}

// ============================================================================
// Error Class
// ============================================================================

/**
 * Error thrown when schema validation fails in DatasetLoader.
 */
export declare class SchemaValidationError extends Error {
  /** Validation errors that caused the failure */
  readonly errors: ValidationError[];
  /** Type of artifact that failed validation */
  readonly artifactType: "manifest" | "rollup" | "dimensions" | "predictions";

  constructor(
    errors: ValidationError[],
    artifactType: "manifest" | "rollup" | "dimensions" | "predictions"
  );
}
