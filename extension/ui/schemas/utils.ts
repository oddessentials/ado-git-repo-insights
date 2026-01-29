/**
 * Schema Validation Utilities
 *
 * Helper functions for type checking, JSON path building, and validation operations.
 *
 * @module schemas/utils
 */

import type { ValidationError, ValidationWarning } from "./types";
import { createError, createWarning } from "./types";

// ============================================================================
// Type Checking Helpers
// ============================================================================

/**
 * Check if value is a plain object (not null, not array).
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check if value is a string.
 */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Check if value is a number (not NaN).
 */
export function isNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

/**
 * Check if value is a boolean.
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/**
 * Check if value is an array.
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Check if value is null or undefined.
 */
export function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * Get the type name of a value for error messages.
 */
export function getTypeName(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

// ============================================================================
// JSON Path Builder
// ============================================================================

/**
 * Build a JSON path string from parent path and key.
 */
export function buildPath(parent: string, key: string | number): string {
  if (parent === "") {
    return typeof key === "number" ? `[${key}]` : key;
  }
  if (typeof key === "number") {
    return `${parent}[${key}]`;
  }
  return `${parent}.${key}`;
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate that a required field exists and is not null/undefined.
 */
export function validateRequired(
  data: Record<string, unknown>,
  field: string,
  path: string,
): ValidationError | null {
  // Use Object.prototype.hasOwnProperty.call for safe property check (avoids prototype pollution)
  const hasField = Object.prototype.hasOwnProperty.call(data, field);
  const fieldValue = hasField
    ? Object.getOwnPropertyDescriptor(data, field)?.value
    : undefined;
  if (!hasField || fieldValue === undefined) {
    return createError(
      buildPath(path, field),
      "required field",
      "missing",
      `Missing required field '${field}'`,
    );
  }
  return null;
}

/**
 * Validate that a field is a string.
 */
export function validateString(
  value: unknown,
  path: string,
): ValidationError | null {
  if (!isString(value)) {
    return createError(path, "string", getTypeName(value));
  }
  return null;
}

/**
 * Validate that a field is a number.
 */
export function validateNumber(
  value: unknown,
  path: string,
): ValidationError | null {
  if (!isNumber(value)) {
    return createError(path, "number", getTypeName(value));
  }
  return null;
}

/**
 * Validate that a field is a non-negative number.
 */
export function validateNonNegativeNumber(
  value: unknown,
  path: string,
): ValidationError | null {
  if (!isNumber(value)) {
    return createError(path, "number", getTypeName(value));
  }
  if (value < 0) {
    return createError(
      path,
      "number >= 0",
      String(value),
      `Expected non-negative number at '${path}'`,
    );
  }
  return null;
}

/**
 * Validate that a field is a positive number.
 */
export function validatePositiveNumber(
  value: unknown,
  path: string,
): ValidationError | null {
  if (!isNumber(value)) {
    return createError(path, "number", getTypeName(value));
  }
  if (value <= 0) {
    return createError(
      path,
      "number > 0",
      String(value),
      `Expected positive number at '${path}'`,
    );
  }
  return null;
}

/**
 * Validate that a field is a boolean.
 */
export function validateBoolean(
  value: unknown,
  path: string,
): ValidationError | null {
  if (!isBoolean(value)) {
    return createError(path, "boolean", getTypeName(value));
  }
  return null;
}

/**
 * Validate that a field is an array.
 */
export function validateArray(
  value: unknown,
  path: string,
): ValidationError | null {
  if (!isArray(value)) {
    return createError(path, "array", getTypeName(value));
  }
  return null;
}

/**
 * Validate that a field is an object.
 */
export function validateObject(
  value: unknown,
  path: string,
): ValidationError | null {
  if (!isObject(value)) {
    return createError(path, "object", getTypeName(value));
  }
  return null;
}

// ============================================================================
// Date/Time Validation
// ============================================================================

/**
 * ISO 8601 date pattern (YYYY-MM-DD).
 */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ISO 8601 datetime pattern (YYYY-MM-DDTHH:mm:ss with optional timezone).
 * Uses bounded quantifiers to prevent ReDoS via catastrophic backtracking.
 */
/* eslint-disable security/detect-unsafe-regex -- SECURITY: Pattern is safe - all groups use bounded quantifiers to prevent ReDoS */
const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/;
/* eslint-enable security/detect-unsafe-regex */

/**
 * ISO week pattern (YYYY-Www).
 */
const ISO_WEEK_PATTERN = /^\d{4}-W\d{2}$/;

/**
 * Year pattern (YYYY).
 */
const YEAR_PATTERN = /^\d{4}$/;

/**
 * Validate ISO 8601 date format (YYYY-MM-DD).
 */
export function validateIsoDate(
  value: unknown,
  path: string,
): ValidationError | null {
  if (!isString(value)) {
    return createError(
      path,
      "ISO date string (YYYY-MM-DD)",
      getTypeName(value),
    );
  }
  if (!ISO_DATE_PATTERN.test(value)) {
    return createError(
      path,
      "ISO date format (YYYY-MM-DD)",
      value,
      `Invalid date format at '${path}': expected YYYY-MM-DD`,
    );
  }
  return null;
}

/**
 * Validate ISO 8601 datetime format.
 */
export function validateIsoDatetime(
  value: unknown,
  path: string,
): ValidationError | null {
  if (!isString(value)) {
    return createError(path, "ISO datetime string", getTypeName(value));
  }
  if (!ISO_DATETIME_PATTERN.test(value)) {
    return createError(
      path,
      "ISO datetime format",
      value,
      `Invalid datetime format at '${path}'`,
    );
  }
  return null;
}

/**
 * Validate ISO week format (YYYY-Www).
 */
export function validateIsoWeek(
  value: unknown,
  path: string,
): ValidationError | null {
  if (!isString(value)) {
    return createError(path, "ISO week string (YYYY-Www)", getTypeName(value));
  }
  if (!ISO_WEEK_PATTERN.test(value)) {
    return createError(
      path,
      "ISO week format (YYYY-Www)",
      value,
      `Invalid week format at '${path}': expected YYYY-Www`,
    );
  }
  return null;
}

/**
 * Validate year format (YYYY).
 */
export function validateYear(
  value: unknown,
  path: string,
): ValidationError | null {
  if (!isString(value)) {
    return createError(path, "year string (YYYY)", getTypeName(value));
  }
  if (!YEAR_PATTERN.test(value)) {
    return createError(
      path,
      "year format (YYYY)",
      value,
      `Invalid year format at '${path}': expected YYYY`,
    );
  }
  return null;
}

// ============================================================================
// Unknown Fields Detection
// ============================================================================

/**
 * Find unknown fields in an object given a set of known fields.
 *
 * @param data - The object to check
 * @param knownFields - Set of field names that are expected
 * @param path - Current JSON path for error messages
 * @param strict - If true, return errors; if false, return warnings
 */
export function findUnknownFields(
  data: Record<string, unknown>,
  knownFields: Set<string>,
  path: string,
  strict: boolean,
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  for (const key of Object.keys(data)) {
    if (!knownFields.has(key)) {
      const fieldPath = buildPath(path, key);
      if (strict) {
        errors.push(
          createError(
            fieldPath,
            "known field",
            "unknown",
            `Unknown field '${key}' not allowed in strict mode`,
          ),
        );
      } else {
        warnings.push(
          createWarning(
            fieldPath,
            `Unknown field '${key}' (ignored in permissive mode)`,
          ),
        );
      }
    }
  }

  return { errors, warnings };
}

/**
 * Validate an enum value.
 */
export function validateEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  path: string,
): ValidationError | null {
  if (!isString(value)) {
    return createError(
      path,
      `one of: ${allowedValues.join(", ")}`,
      getTypeName(value),
    );
  }
  if (!allowedValues.includes(value as T)) {
    return createError(
      path,
      `one of: ${allowedValues.join(", ")}`,
      value,
      `Invalid enum value at '${path}'`,
    );
  }
  return null;
}
