/**
 * Error Taxonomy for PR Insights Hub
 *
 * Defines 6 distinct error types, each mapping to a specific UI panel/message.
 * This module is the single source of truth for error handling in the dashboard.
 */
/**
 * Error type constants.
 */
export declare const ErrorTypes: {
    readonly SETUP_REQUIRED: "setup_required";
    readonly MULTIPLE_PIPELINES: "multiple_pipelines";
    readonly NO_SUCCESSFUL_BUILDS: "no_successful_builds";
    readonly ARTIFACTS_MISSING: "artifacts_missing";
    readonly PERMISSION_DENIED: "permission_denied";
    readonly INVALID_CONFIG: "invalid_config";
};
export type ErrorType = typeof ErrorTypes[keyof typeof ErrorTypes];
/**
 * Pipeline match information for multiple pipelines error.
 */
export interface PipelineMatch {
    id: number;
    name: string;
}
/**
 * Details for setup required error.
 */
export interface SetupRequiredDetails {
    instructions: string[];
    docsUrl: string;
}
/**
 * Details for multiple pipelines error.
 */
export interface MultiplePipelinesDetails {
    matches: PipelineMatch[];
    hint: string;
}
/**
 * Details for no successful builds error.
 */
export interface NoSuccessfulBuildsDetails {
    instructions: string[];
}
/**
 * Details for artifacts missing error.
 */
export interface ArtifactsMissingDetails {
    instructions: string[];
}
/**
 * Details for permission denied error.
 */
export interface PermissionDeniedDetails {
    instructions: string[];
    permissionNeeded: string;
}
/**
 * Details for invalid config error.
 */
export interface InvalidConfigDetails {
    reason: string;
    hint: string;
}
/**
 * Union type for all error details.
 */
export type ErrorDetails = SetupRequiredDetails | MultiplePipelinesDetails | NoSuccessfulBuildsDetails | ArtifactsMissingDetails | PermissionDeniedDetails | InvalidConfigDetails | null;
/**
 * Base error class for PR Insights errors.
 * Each error has a type, title, message, and optional details for the UI.
 */
export declare class PrInsightsError extends Error {
    readonly name = "PrInsightsError";
    readonly type: ErrorType;
    readonly title: string;
    readonly details: ErrorDetails;
    constructor(type: ErrorType, title: string, message: string, details?: ErrorDetails);
}
/**
 * Create a "Setup Required" error.
 * Shown when no pipeline with aggregates artifact is found.
 */
export declare function createSetupRequiredError(): PrInsightsError;
/**
 * Create a "Multiple Pipelines" error.
 * Shown when more than one pipeline matches the discovery criteria.
 *
 * @param matches - Matching pipelines
 */
export declare function createMultiplePipelinesError(matches: PipelineMatch[]): PrInsightsError;
/**
 * Create a "No Successful Builds" error.
 * Shown when a pipeline exists but has no succeeded or partially succeeded builds.
 *
 * Note: The dashboard accepts both "Succeeded" and "PartiallySucceeded" builds.
 * First-run pipelines often show as PartiallySucceeded because the "Download Previous
 * Database" step fails (no prior artifact exists), but continues due to continueOnError.
 * This is expected behavior - the extraction and artifact publishing still succeed.
 *
 * @param pipelineName - Name of the pipeline
 */
export declare function createNoSuccessfulBuildsError(pipelineName: string): PrInsightsError;
/**
 * Create an "Artifacts Missing" error.
 * Shown when a build succeeded but doesn't have the aggregates artifact.
 *
 * @param pipelineName - Name of the pipeline
 * @param buildId - ID of the build
 */
export declare function createArtifactsMissingError(pipelineName: string, buildId: number): PrInsightsError;
/**
 * Create a "Permission Denied" error.
 * Shown when API calls return 401/403.
 *
 * @param operation - Description of what operation failed
 */
export declare function createPermissionDeniedError(operation: string): PrInsightsError;
/**
 * Create an "Invalid Configuration" error.
 * Shown when query parameters or settings are invalid.
 *
 * @param param - Parameter name
 * @param value - Invalid value
 * @param reason - Why it's invalid
 */
export declare function createInvalidConfigError(param: string, value: string, reason: string): PrInsightsError;
