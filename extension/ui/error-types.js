/**
 * Error Taxonomy for PR Insights Hub
 *
 * Defines 6 distinct error types, each mapping to a specific UI panel/message.
 * This module is the single source of truth for error handling in the dashboard.
 */

/**
 * Error type constants.
 */
const ErrorTypes = {
    SETUP_REQUIRED: 'setup_required',
    MULTIPLE_PIPELINES: 'multiple_pipelines',
    NO_SUCCESSFUL_BUILDS: 'no_successful_builds',
    ARTIFACTS_MISSING: 'artifacts_missing',
    PERMISSION_DENIED: 'permission_denied',
    INVALID_CONFIG: 'invalid_config'
};

/**
 * Base error class for PR Insights errors.
 * Each error has a type, title, message, and optional details for the UI.
 */
class PrInsightsError extends Error {
    constructor(type, title, message, details = null) {
        super(message);
        this.name = 'PrInsightsError';
        this.type = type;
        this.title = title;
        this.details = details;
    }
}

/**
 * Create a "Setup Required" error.
 * Shown when no pipeline with aggregates artifact is found.
 *
 * @returns {PrInsightsError}
 */
function createSetupRequiredError() {
    return new PrInsightsError(
        ErrorTypes.SETUP_REQUIRED,
        'Setup Required',
        'No PR Insights pipeline found in this project.',
        {
            instructions: [
                'Create a pipeline from pr-insights-pipeline.yml',
                'Ensure it publishes an "aggregates" artifact',
                'Run it at least once successfully',
                'Return here to view your dashboard'
            ],
            docsUrl: 'https://github.com/oddessentials/ado-git-repo-insights#setup'
        }
    );
}

/**
 * Create a "Multiple Pipelines" error.
 * Shown when more than one pipeline matches the discovery criteria.
 *
 * @param {Array<{id: number, name: string}>} matches - Matching pipelines
 * @returns {PrInsightsError}
 */
function createMultiplePipelinesError(matches) {
    return new PrInsightsError(
        ErrorTypes.MULTIPLE_PIPELINES,
        'Multiple Pipelines Found',
        `Found ${matches.length} pipelines with aggregates. Please specify which one to use.`,
        {
            matches: matches.map(m => ({ id: m.id, name: m.name })),
            hint: 'Add ?pipelineId=<id> to the URL, or configure in Project Settings > PR Insights Settings.'
        }
    );
}

/**
 * Create a "No Successful Builds" error.
 * Shown when a pipeline exists but has no succeeded builds.
 *
 * @param {string} pipelineName - Name of the pipeline
 * @returns {PrInsightsError}
 */
function createNoSuccessfulBuildsError(pipelineName) {
    return new PrInsightsError(
        ErrorTypes.NO_SUCCESSFUL_BUILDS,
        'No Successful Runs',
        `Pipeline "${pipelineName}" has no successful builds.`,
        {
            instructions: [
                'Check the pipeline for errors',
                'Run it manually and ensure it succeeds',
                'Return here after a successful run'
            ]
        }
    );
}

/**
 * Create an "Artifacts Missing" error.
 * Shown when a build succeeded but doesn't have the aggregates artifact.
 *
 * @param {string} pipelineName - Name of the pipeline
 * @param {number} buildId - ID of the build
 * @returns {PrInsightsError}
 */
function createArtifactsMissingError(pipelineName, buildId) {
    return new PrInsightsError(
        ErrorTypes.ARTIFACTS_MISSING,
        'Aggregates Not Found',
        `Build #${buildId} of "${pipelineName}" does not have an aggregates artifact.`,
        {
            instructions: [
                'Add generateAggregates: true to your ExtractPullRequests task',
                'Add a PublishPipelineArtifact step for the aggregates directory',
                'Re-run the pipeline'
            ]
        }
    );
}

/**
 * Create a "Permission Denied" error.
 * Shown when API calls return 401/403.
 *
 * @param {string} operation - Description of what operation failed
 * @returns {PrInsightsError}
 */
function createPermissionDeniedError(operation) {
    return new PrInsightsError(
        ErrorTypes.PERMISSION_DENIED,
        'Permission Denied',
        `You don't have permission to ${operation}.`,
        {
            instructions: [
                'Request "Build (Read)" permission from your project administrator',
                'Ensure you have access to view pipeline artifacts',
                'If using a service account, verify its permissions'
            ],
            permissionNeeded: 'Build (Read)'
        }
    );
}

/**
 * Create an "Invalid Configuration" error.
 * Shown when query parameters or settings are invalid.
 *
 * @param {string} param - Parameter name
 * @param {string} value - Invalid value
 * @param {string} reason - Why it's invalid
 * @returns {PrInsightsError}
 */
function createInvalidConfigError(param, value, reason) {
    return new PrInsightsError(
        ErrorTypes.INVALID_CONFIG,
        'Invalid Configuration',
        `Invalid value for ${param}: "${value}"`,
        {
            reason: reason,
            hint: param === 'pipelineId'
                ? 'pipelineId must be a positive integer (e.g., ?pipelineId=123)'
                : param === 'dataset'
                    ? 'dataset must be a valid HTTPS URL'
                    : 'Check the parameter value and try again'
        }
    );
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ErrorTypes,
        PrInsightsError,
        createSetupRequiredError,
        createMultiplePipelinesError,
        createNoSuccessfulBuildsError,
        createArtifactsMissingError,
        createPermissionDeniedError,
        createInvalidConfigError
    };
}
