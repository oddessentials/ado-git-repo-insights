/**
 * Schema Validation Error Class
 *
 * Custom error class thrown when schema validation fails in DatasetLoader.
 * Includes detailed validation errors and artifact type for debugging.
 *
 * @module schemas/errors
 */

import type { ValidationError, ArtifactType } from "./types";

/**
 * Error thrown when schema validation fails in DatasetLoader.
 *
 * @example
 * ```typescript
 * try {
 *   await datasetLoader.loadManifest();
 * } catch (error) {
 *   if (error instanceof SchemaValidationError) {
 *     console.error(`Validation failed for ${error.artifactType}:`);
 *     error.errors.forEach(e => console.error(`  ${e.field}: ${e.message}`));
 *   }
 * }
 * ```
 */
export class SchemaValidationError extends Error {
  /** Validation errors that caused the failure */
  readonly errors: ValidationError[];
  /** Type of artifact that failed validation */
  readonly artifactType: ArtifactType;

  constructor(errors: ValidationError[], artifactType: ArtifactType) {
    const errorSummary = errors
      .slice(0, 3)
      .map((e) => `${e.field}: ${e.message}`)
      .join("; ");
    const moreCount = errors.length > 3 ? ` (+${errors.length - 3} more)` : "";

    super(
      `Schema validation failed for ${artifactType}: ${errorSummary}${moreCount}`,
    );

    this.name = "SchemaValidationError";
    this.errors = errors;
    this.artifactType = artifactType;

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SchemaValidationError);
    }
  }

  /**
   * Get a formatted string of all validation errors.
   */
  getDetailedMessage(): string {
    const lines = [`Schema validation failed for ${this.artifactType}:`];
    for (const error of this.errors) {
      lines.push(`  - ${error.field}: ${error.message}`);
      lines.push(`    Expected: ${error.expected}`);
      lines.push(`    Actual: ${error.actual}`);
    }
    return lines.join("\n");
  }
}
