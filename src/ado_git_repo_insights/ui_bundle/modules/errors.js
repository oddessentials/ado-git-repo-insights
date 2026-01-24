"use strict";
/**
 * Error handling and panel display module.
 *
 * INVARIANT: Element IDs, message text, and behavior must match exactly
 * to preserve user-facing diagnostics and existing test expectations.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleError = handleError;
exports.hideAllPanels = hideAllPanels;
exports.showSetupRequired = showSetupRequired;
exports.showMultiplePipelines = showMultiplePipelines;
exports.showPermissionDenied = showPermissionDenied;
exports.showGenericError = showGenericError;
exports.showArtifactsMissing = showArtifactsMissing;
exports.showLoading = showLoading;
exports.showContent = showContent;
const error_types_1 = require("../error-types");
const types_1 = require("../types");
const security_1 = require("./shared/security");
/**
 * Panel IDs for error and setup states.
 * INVARIANT: These must match index.html element IDs exactly.
 */
const PANEL_IDS = [
    "setup-required",
    "multiple-pipelines",
    "artifacts-missing",
    "permission-denied",
    "error-state",
    "loading-state",
    "main-content",
];
/**
 * Handle errors with appropriate UI panels.
 */
function handleError(error) {
    hideAllPanels();
    if (error instanceof error_types_1.PrInsightsError) {
        switch (error.type) {
            case error_types_1.ErrorTypes.SETUP_REQUIRED:
                showSetupRequired(error);
                break;
            case error_types_1.ErrorTypes.MULTIPLE_PIPELINES:
                showMultiplePipelines(error);
                break;
            case error_types_1.ErrorTypes.ARTIFACTS_MISSING:
                showArtifactsMissing(error);
                break;
            case error_types_1.ErrorTypes.PERMISSION_DENIED:
                showPermissionDenied(error);
                break;
            default:
                showGenericError(error.title, error.message);
                break;
        }
    }
    else {
        showGenericError("Error", (0, types_1.getErrorMessage)(error) || "An unexpected error occurred");
    }
}
/**
 * Hide all error/setup panels.
 */
function hideAllPanels() {
    PANEL_IDS.forEach((id) => {
        document.getElementById(id)?.classList.add("hidden");
    });
}
/**
 * Show setup required panel.
 * INVARIANT: Element IDs must match: setup-required, setup-message, setup-steps, docs-link
 */
function showSetupRequired(error) {
    const panel = document.getElementById("setup-required");
    if (!panel)
        return showGenericError(error.title, error.message);
    const messageEl = document.getElementById("setup-message");
    if (messageEl)
        messageEl.textContent = error.message;
    const details = error.details;
    if (details?.instructions && Array.isArray(details.instructions)) {
        const stepsList = document.getElementById("setup-steps");
        if (stepsList) {
            // SECURITY: Escape instructions to prevent XSS
            stepsList.innerHTML = details.instructions
                .map((s) => `<li>${(0, security_1.escapeHtml)(s)}</li>`)
                .join("");
        }
    }
    if (details?.docsUrl) {
        const docsLink = document.getElementById("docs-link");
        if (docsLink)
            docsLink.href = String(details.docsUrl);
    }
    panel.classList.remove("hidden");
}
/**
 * Show multiple pipelines panel.
 * INVARIANT: Element IDs must match: multiple-pipelines, multiple-message, pipeline-list
 */
function showMultiplePipelines(error) {
    const panel = document.getElementById("multiple-pipelines");
    if (!panel)
        return showGenericError(error.title, error.message);
    const messageEl = document.getElementById("multiple-message");
    if (messageEl)
        messageEl.textContent = error.message;
    const listEl = document.getElementById("pipeline-list");
    const details = error.details;
    if (listEl && details?.matches && Array.isArray(details.matches)) {
        // SECURITY: Escape pipeline names to prevent XSS
        listEl.innerHTML = details.matches
            .map((m) => `
                <a href="?pipelineId=${(0, security_1.escapeHtml)(String(m.id))}" class="pipeline-option">
                    <strong>${(0, security_1.escapeHtml)(m.name)}</strong>
                    <span class="pipeline-id">ID: ${(0, security_1.escapeHtml)(String(m.id))}</span>
                </a>
            `)
            .join("");
    }
    panel.classList.remove("hidden");
}
/**
 * Show permission denied panel.
 * INVARIANT: Element IDs must match: permission-denied, permission-message
 */
function showPermissionDenied(error) {
    const panel = document.getElementById("permission-denied");
    if (!panel)
        return showGenericError(error.title, error.message);
    const messageEl = document.getElementById("permission-message");
    if (messageEl)
        messageEl.textContent = error.message;
    panel.classList.remove("hidden");
}
/**
 * Show generic error state.
 * INVARIANT: Element IDs must match: error-state, error-title, error-message
 */
function showGenericError(title, message) {
    const panel = document.getElementById("error-state");
    if (!panel)
        return;
    const titleEl = document.getElementById("error-title");
    const messageEl = document.getElementById("error-message");
    if (titleEl)
        titleEl.textContent = title;
    if (messageEl)
        messageEl.textContent = message;
    panel.classList.remove("hidden");
}
/**
 * Show artifacts missing panel.
 * INVARIANT: Element IDs must match: artifacts-missing, missing-message, missing-steps
 */
function showArtifactsMissing(error) {
    const panel = document.getElementById("artifacts-missing");
    if (!panel)
        return showGenericError(error.title, error.message);
    const messageEl = document.getElementById("missing-message");
    if (messageEl)
        messageEl.textContent = error.message;
    const details = error.details;
    if (details?.instructions && Array.isArray(details.instructions)) {
        const stepsList = document.getElementById("missing-steps");
        if (stepsList) {
            // SECURITY: Escape instructions to prevent XSS
            stepsList.innerHTML = details.instructions
                .map((s) => `<li>${(0, security_1.escapeHtml)(s)}</li>`)
                .join("");
        }
    }
    panel.classList.remove("hidden");
}
/**
 * Show loading state.
 */
function showLoading() {
    document.getElementById("loading-state")?.classList.remove("hidden");
    document.getElementById("main-content")?.classList.add("hidden");
}
/**
 * Show main content.
 */
function showContent() {
    document.getElementById("loading-state")?.classList.add("hidden");
    document.getElementById("main-content")?.classList.remove("hidden");
}
//# sourceMappingURL=errors.js.map