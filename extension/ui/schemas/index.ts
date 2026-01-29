/**
 * Schema Validation Module
 *
 * Barrel export for schema validation types, errors, and utilities.
 * Individual schema validators will be added as they are implemented.
 *
 * @module schemas
 */

// Core types
export type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
  SchemaValidator,
  ArtifactType,
} from "./types";

export {
  validResult,
  invalidResult,
  createError,
  createWarning,
} from "./types";

// Error class
export { SchemaValidationError } from "./errors";

// Utilities
export {
  // Type checking
  isObject,
  isString,
  isNumber,
  isBoolean,
  isArray,
  isNullish,
  getTypeName,
  // Path building
  buildPath,
  // Validation helpers
  validateRequired,
  validateString,
  validateNumber,
  validateNonNegativeNumber,
  validatePositiveNumber,
  validateBoolean,
  validateArray,
  validateObject,
  // Date/time validation
  validateIsoDate,
  validateIsoDatetime,
  validateIsoWeek,
  validateYear,
  // Unknown fields
  findUnknownFields,
  // Enum validation
  validateEnum,
} from "./utils";

// Schema validators
export {
  validateManifest,
  normalizeManifest,
  ManifestSchema,
} from "./manifest.schema";
export type {
  DatasetManifest,
  AggregateIndex,
  WeeklyRollupEntry,
  DistributionEntry,
  Coverage,
  Features,
  Limits,
  Defaults,
} from "./manifest.schema";

export { validateRollup, normalizeRollup, RollupSchema } from "./rollup.schema";
export type { WeeklyRollup, BreakdownEntry } from "./rollup.schema";

export {
  validateDimensions,
  normalizeDimensions,
  DimensionsSchema,
} from "./dimensions.schema";
export type {
  Dimensions,
  RepositoryEntry,
  UserEntry,
  ProjectEntry,
  TeamEntry,
} from "./dimensions.schema";

export {
  validatePredictions,
  normalizePredictions,
  PredictionsSchema,
} from "./predictions.schema";
export type {
  Predictions,
  Forecast,
  ForecastValue,
} from "./predictions.schema";
