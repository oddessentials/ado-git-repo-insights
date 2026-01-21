"use strict";
/**
 * Error Taxonomy for PR Insights Hub
 *
 * Defines 6 distinct error types, each mapping to a specific UI panel/message.
 * This module is the single source of truth for error handling in the dashboard.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrInsightsError = exports.ErrorTypes = void 0;
exports.createSetupRequiredError = createSetupRequiredError;
exports.createMultiplePipelinesError = createMultiplePipelinesError;
exports.createNoSuccessfulBuildsError = createNoSuccessfulBuildsError;
exports.createArtifactsMissingError = createArtifactsMissingError;
exports.createPermissionDeniedError = createPermissionDeniedError;
exports.createInvalidConfigError = createInvalidConfigError;
/**
 * Error type constants.
 */
exports.ErrorTypes = {
  SETUP_REQUIRED: "setup_required",
  MULTIPLE_PIPELINES: "multiple_pipelines",
  NO_SUCCESSFUL_BUILDS: "no_successful_builds",
  ARTIFACTS_MISSING: "artifacts_missing",
  PERMISSION_DENIED: "permission_denied",
  INVALID_CONFIG: "invalid_config",
};
/**
 * Base error class for PR Insights errors.
 * Each error has a type, title, message, and optional details for the UI.
 */
class PrInsightsError extends Error {
  constructor(type, title, message, details = null) {
    super(message);
    this.name = "PrInsightsError";
    this.type = type;
    this.title = title;
    this.details = details;
  }
}
exports.PrInsightsError = PrInsightsError;
/**
 * Create a "Setup Required" error.
 * Shown when no pipeline with aggregates artifact is found.
 */
function createSetupRequiredError() {
  return new PrInsightsError(
    exports.ErrorTypes.SETUP_REQUIRED,
    "Setup Required",
    "No PR Insights pipeline found in this project.",
    {
      instructions: [
        "Create a pipeline from pr-insights-pipeline.yml",
        'Ensure it publishes an "aggregates" artifact',
        "Run it at least once successfully",
        "Return here to view your dashboard",
      ],
      docsUrl: "https://github.com/oddessentials/ado-git-repo-insights#setup",
    },
  );
}
/**
 * Create a "Multiple Pipelines" error.
 * Shown when more than one pipeline matches the discovery criteria.
 *
 * @param matches - Matching pipelines
 */
function createMultiplePipelinesError(matches) {
  return new PrInsightsError(
    exports.ErrorTypes.MULTIPLE_PIPELINES,
    "Multiple Pipelines Found",
    `Found ${matches.length} pipelines with aggregates. Please specify which one to use.`,
    {
      matches: matches.map((m) => ({ id: m.id, name: m.name })),
      hint: "Add ?pipelineId=<id> to the URL, or configure in Project Settings > PR Insights Settings.",
    },
  );
}
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
function createNoSuccessfulBuildsError(pipelineName) {
  return new PrInsightsError(
    exports.ErrorTypes.NO_SUCCESSFUL_BUILDS,
    "No Successful Runs",
    `Pipeline "${pipelineName}" has no successful builds.`,
    {
      instructions: [
        "Check the pipeline for errors",
        "Run it manually and ensure extraction completes",
        'Note: "Partially Succeeded" builds are acceptable - first runs may show this status because no prior database artifact exists yet, but extraction still works',
        "Return here after a successful or partially successful run",
      ],
    },
  );
}
/**
 * Create an "Artifacts Missing" error.
 * Shown when a build succeeded but doesn't have the aggregates artifact.
 *
 * @param pipelineName - Name of the pipeline
 * @param buildId - ID of the build
 */
function createArtifactsMissingError(pipelineName, buildId) {
  return new PrInsightsError(
    exports.ErrorTypes.ARTIFACTS_MISSING,
    "Aggregates Not Found",
    `Build #${buildId} of "${pipelineName}" does not have an aggregates artifact.`,
    {
      instructions: [
        "Add generateAggregates: true to your ExtractPullRequests task",
        "Add a PublishPipelineArtifact step for the aggregates directory",
        "Re-run the pipeline",
      ],
    },
  );
}
/**
 * Create a "Permission Denied" error.
 * Shown when API calls return 401/403.
 *
 * @param operation - Description of what operation failed
 */
function createPermissionDeniedError(operation) {
  return new PrInsightsError(
    exports.ErrorTypes.PERMISSION_DENIED,
    "Permission Denied",
    `You don't have permission to ${operation}.`,
    {
      instructions: [
        'Request "Build (Read)" permission from your project administrator',
        "Ensure you have access to view pipeline artifacts",
        "If using a service account, verify its permissions",
      ],
      permissionNeeded: "Build (Read)",
    },
  );
}
/**
 * Create an "Invalid Configuration" error.
 * Shown when query parameters or settings are invalid.
 *
 * @param param - Parameter name
 * @param value - Invalid value
 * @param reason - Why it's invalid
 */
function createInvalidConfigError(param, value, reason) {
  let hint;
  if (param === "pipelineId") {
    hint = "pipelineId must be a positive integer (e.g., ?pipelineId=123)";
  } else if (param === "dataset") {
    hint = "dataset must be a valid HTTPS URL";
  } else {
    hint = "Check the parameter value and try again";
  }
  return new PrInsightsError(
    exports.ErrorTypes.INVALID_CONFIG,
    "Invalid Configuration",
    `Invalid value for ${param}: "${value}"`,
    {
      reason,
      hint,
    },
  );
}
// Browser global exports for runtime compatibility
if (typeof window !== "undefined") {
  window.PrInsightsError = PrInsightsError;
}
//# sourceMappingURL=error-types.js.map
