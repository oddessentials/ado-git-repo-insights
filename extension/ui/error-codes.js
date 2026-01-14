/**
 * Centralized Error Codes (Phase 4)
 *
 * Defines typed error model for deterministic UI error states.
 * Each error has a code, user-facing message, and recovery action.
 */

/**
 * Error code definitions for dataset loader failures.
 */
const ErrorCodes = {
    // Authentication/Permission errors
    NO_PERMISSION: {
        code: 'AUTH_001',
        message: 'You do not have permission to access this pipeline.',
        action: 'Check your Azure DevOps permissions for this project.',
    },

    AUTH_REQUIRED: {
        code: 'AUTH_002',
        message: 'Authentication required.',
        action: 'Sign in to Azure DevOps.',
    },

    // Resource not found errors
    NOT_FOUND: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        action: 'Verify the pipeline and project exist.',
    },

    PIPELINE_NOT_FOUND: {
        code: 'PIPE_404',
        message: 'Pipeline not found.',
        action: 'Check pipeline name in extension settings.',
    },

    // No data conditions
    NO_RUNS: {
        code: 'NO_RUNS',
        message: 'No successful pipeline runs found.',
        action: 'Run the analytics pipeline to generate data.',
    },

    NO_ARTIFACTS: {
        code: 'NO_ARTIFACTS',
        message: 'Pipeline completed but no artifacts were published.',
        action: 'Check pipeline logs for errors during artifact generation.',
    },

    // Schema/version errors
    VERSION_MISMATCH: {
        code: 'VER_001',
        message: 'Dataset version not supported by this extension.',
        action: 'Update the extension to the latest version.',
    },

    SCHEMA_INVALID: {
        code: 'SCHEMA_001',
        message: 'Dataset failed schema validation.',
        action: 'Re-run the pipeline or contact support.',
    },

    // Predictions-specific errors
    PRED_DISABLED: {
        code: 'PRED_000',
        message: 'Predictions feature is not enabled.',
        action: 'Enable predictions in pipeline configuration.',
    },

    PRED_SCHEMA_INVALID: {
        code: 'PRED_001',
        message: 'Predictions data failed validation.',
        action: 'Check predictions schema version compatibility.',
    },

    PRED_LOAD_ERROR: {
        code: 'PRED_002',
        message: 'Failed to load predictions data.',
        action: 'Retry or check network connectivity.',
    },

    PRED_HTTP_ERROR: {
        code: 'PRED_003',
        message: 'HTTP error loading predictions.',
        action: 'Check pipeline artifacts.',
    },

    // AI Insights-specific errors
    AI_DISABLED: {
        code: 'AI_000',
        message: 'AI Insights feature is not enabled.',
        action: 'Enable AI insights in pipeline configuration.',
    },

    AI_SCHEMA_INVALID: {
        code: 'AI_001',
        message: 'AI Insights data failed validation.',
        action: 'Check insights schema version compatibility.',
    },

    AI_LOAD_ERROR: {
        code: 'AI_002',
        message: 'Failed to load AI Insights data.',
        action: 'Retry or check network connectivity.',
    },

    AI_HTTP_ERROR: {
        code: 'AI_003',
        message: 'HTTP error loading AI Insights.',
        action: 'Check pipeline artifacts.',
    },

    // Transient/server errors
    TRANSIENT_ERROR: {
        code: 'SRV_5XX',
        message: 'Server temporarily unavailable.',
        action: 'Wait a moment and try again.',
    },

    NETWORK_ERROR: {
        code: 'NET_001',
        message: 'Network request failed.',
        action: 'Check your internet connection.',
    },

    // Unknown/fallback
    UNKNOWN: {
        code: 'UNKNOWN',
        message: 'An unexpected error occurred.',
        action: 'Refresh the page or contact support.',
    },
};

/**
 * Get error info by code string.
 * @param {string} code - Error code (e.g., 'PRED_001')
 * @returns {Object|null} Error info or null if not found
 */
function getErrorByCode(code) {
    for (const [, error] of Object.entries(ErrorCodes)) {
        if (error.code === code) {
            return error;
        }
    }
    return null;
}

/**
 * Create a user-facing error message with action.
 * @param {string} errorKey - Key from ErrorCodes (e.g., 'NO_PERMISSION')
 * @param {string} [details] - Optional additional details
 * @returns {Object} { code, message, action }
 */
function createErrorMessage(errorKey, details = null) {
    const error = ErrorCodes[errorKey] || ErrorCodes.UNKNOWN;
    return {
        code: error.code,
        message: details ? `${error.message} (${details})` : error.message,
        action: error.action,
    };
}

// Export for use
if (typeof module !== 'undefined') {
    module.exports = { ErrorCodes, getErrorByCode, createErrorMessage };
}
if (typeof window !== 'undefined') {
    window.ErrorCodes = ErrorCodes;
    window.getErrorByCode = getErrorByCode;
    window.createErrorMessage = createErrorMessage;
}
