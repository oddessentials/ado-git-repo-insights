/**
 * Centralized Error Codes (Phase 4)
 *
 * Defines typed error model for deterministic UI error states.
 * Each error has a code, user-facing message, and recovery action.
 */
/**
 * Error code definition structure.
 */
export interface ErrorCodeDefinition {
  code: string;
  message: string;
  action: string;
}
/**
 * Error message with optional details.
 */
export interface ErrorMessage {
  code: string;
  message: string;
  action: string;
}
/**
 * Error code keys as a type for type-safe lookups.
 */
export type ErrorCodeKey = keyof typeof ErrorCodes;
/**
 * Error code definitions for dataset loader failures.
 */
export declare const ErrorCodes: {
  readonly NO_PERMISSION: {
    readonly code: "AUTH_001";
    readonly message: "You do not have permission to access this pipeline.";
    readonly action: "Check your Azure DevOps permissions for this project.";
  };
  readonly AUTH_REQUIRED: {
    readonly code: "AUTH_002";
    readonly message: "Authentication required.";
    readonly action: "Sign in to Azure DevOps.";
  };
  readonly NOT_FOUND: {
    readonly code: "NOT_FOUND";
    readonly message: "The requested resource was not found.";
    readonly action: "Verify the pipeline and project exist.";
  };
  readonly PIPELINE_NOT_FOUND: {
    readonly code: "PIPE_404";
    readonly message: "Pipeline not found.";
    readonly action: "Check pipeline name in extension settings.";
  };
  readonly NO_RUNS: {
    readonly code: "NO_RUNS";
    readonly message: "No successful pipeline runs found.";
    readonly action: "Run the analytics pipeline to generate data.";
  };
  readonly NO_ARTIFACTS: {
    readonly code: "NO_ARTIFACTS";
    readonly message: "Pipeline completed but no artifacts were published.";
    readonly action: "Check pipeline logs for errors during artifact generation.";
  };
  readonly VERSION_MISMATCH: {
    readonly code: "VER_001";
    readonly message: "Dataset version not supported by this extension.";
    readonly action: "Update the extension to the latest version.";
  };
  readonly SCHEMA_INVALID: {
    readonly code: "SCHEMA_001";
    readonly message: "Dataset failed schema validation.";
    readonly action: "Re-run the pipeline or contact support.";
  };
  readonly PRED_DISABLED: {
    readonly code: "PRED_000";
    readonly message: "Predictions feature is not enabled.";
    readonly action: "Enable predictions in pipeline configuration.";
  };
  readonly PRED_SCHEMA_INVALID: {
    readonly code: "PRED_001";
    readonly message: "Predictions data failed validation.";
    readonly action: "Check predictions schema version compatibility.";
  };
  readonly PRED_LOAD_ERROR: {
    readonly code: "PRED_002";
    readonly message: "Failed to load predictions data.";
    readonly action: "Retry or check network connectivity.";
  };
  readonly PRED_HTTP_ERROR: {
    readonly code: "PRED_003";
    readonly message: "HTTP error loading predictions.";
    readonly action: "Check pipeline artifacts.";
  };
  readonly AI_DISABLED: {
    readonly code: "AI_000";
    readonly message: "AI Insights feature is not enabled.";
    readonly action: "Enable AI insights in pipeline configuration.";
  };
  readonly AI_SCHEMA_INVALID: {
    readonly code: "AI_001";
    readonly message: "AI Insights data failed validation.";
    readonly action: "Check insights schema version compatibility.";
  };
  readonly AI_LOAD_ERROR: {
    readonly code: "AI_002";
    readonly message: "Failed to load AI Insights data.";
    readonly action: "Retry or check network connectivity.";
  };
  readonly AI_HTTP_ERROR: {
    readonly code: "AI_003";
    readonly message: "HTTP error loading AI Insights.";
    readonly action: "Check pipeline artifacts.";
  };
  readonly TRANSIENT_ERROR: {
    readonly code: "SRV_5XX";
    readonly message: "Server temporarily unavailable.";
    readonly action: "Wait a moment and try again.";
  };
  readonly NETWORK_ERROR: {
    readonly code: "NET_001";
    readonly message: "Network request failed.";
    readonly action: "Check your internet connection.";
  };
  readonly UNKNOWN: {
    readonly code: "UNKNOWN";
    readonly message: "An unexpected error occurred.";
    readonly action: "Refresh the page or contact support.";
  };
};
/**
 * Get error info by code string.
 * @param code - Error code (e.g., 'PRED_001')
 * @returns Error info or null if not found
 */
export declare function getErrorByCode(
  code: string,
): ErrorCodeDefinition | null;
/**
 * Create a user-facing error message with action.
 * @param errorKey - Key from ErrorCodes (e.g., 'NO_PERMISSION')
 * @param details - Optional additional details
 * @returns Error message object
 */
export declare function createErrorMessage(
  errorKey: string,
  details?: string | null,
): ErrorMessage;
