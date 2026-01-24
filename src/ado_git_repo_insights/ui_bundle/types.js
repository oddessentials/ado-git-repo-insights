"use strict";
/**
 * Shared Type Definitions for PR Insights Hub
 *
 * This module provides TypeScript type definitions for:
 * - VSS SDK types (Azure DevOps SDK lacks full TS definitions)
 * - Dataset and rollup types
 * - Cache system types
 * - Error handling utilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isErrorWithMessage = isErrorWithMessage;
exports.isErrorWithCode = isErrorWithCode;
exports.getErrorMessage = getErrorMessage;
exports.getErrorCode = getErrorCode;
exports.hasMLMethods = hasMLMethods;
// =============================================================================
// Error Handling Utilities
// =============================================================================
/**
 * Type guard to check if a value is an object with a message property.
 */
function isErrorWithMessage(error) {
    return (typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof error.message === "string");
}
/**
 * Type guard to check if a value is an object with a code property.
 */
function isErrorWithCode(error) {
    return (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string");
}
/**
 * Safely extract an error message from an unknown caught value.
 */
function getErrorMessage(error) {
    if (isErrorWithMessage(error))
        return error.message;
    if (typeof error === "string")
        return error;
    return "Unknown error";
}
/**
 * Safely extract an error code from an unknown caught value.
 */
function getErrorCode(error) {
    if (isErrorWithCode(error))
        return error.code;
    return undefined;
}
/**
 * Type guard for ML-enabled dataset loaders.
 */
function hasMLMethods(loader) {
    return (typeof loader === "object" &&
        loader !== null &&
        typeof loader.loadPredictions === "function" &&
        typeof loader.loadInsights === "function");
}
//# sourceMappingURL=types.js.map