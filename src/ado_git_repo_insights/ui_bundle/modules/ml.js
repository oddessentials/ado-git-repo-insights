"use strict";
/**
 * ML Features Rendering Module
 *
 * Phase 5 expansion point for Prophet predictions and OpenAI insights.
 *
 * Architectural constraints:
 * - Rendering functions receive container from dashboard.ts
 * - Uses MlDataProvider interface for data loading (async seam)
 * - Caching and error handling centralized via provider interface
 * - Uses shared/security.ts for XSS prevention
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInitialMlState = void 0;
exports.initializePhase5Features = initializePhase5Features;
exports.renderPredictions = renderPredictions;
exports.renderAIInsights = renderAIInsights;
exports.renderPredictionsError = renderPredictionsError;
exports.renderPredictionsEmpty = renderPredictionsEmpty;
exports.renderInsightsError = renderInsightsError;
exports.renderInsightsEmpty = renderInsightsEmpty;
exports.createMlRenderer = createMlRenderer;
const security_1 = require("./shared/security");
const types_1 = require("./ml/types");
/**
 * Type guard to check if data is valid PredictionsRenderData.
 */
function isPredictionsRenderData(data) {
    return (typeof data === "object" &&
        data !== null &&
        "forecasts" in data &&
        Array.isArray(data.forecasts));
}
/**
 * Type guard to check if data is valid InsightsRenderData.
 */
function isInsightsRenderData(data) {
    return (typeof data === "object" &&
        data !== null &&
        "insights" in data &&
        Array.isArray(data.insights));
}
/**
 * Severity icons for insight rendering.
 */
const SEVERITY_ICONS = {
    critical: "🔴",
    warning: "🟡",
    info: "🔵",
};
/**
 * Initialize Phase 5 features in the UI.
 * Sets up tab content areas for ML features.
 */
function initializePhase5Features() {
    // Tab visibility is controlled by updateFeatureTabs based on manifest
    // This function can be extended for future Phase 5 setup
}
/**
 * Render predictions tab content.
 * @param container - The tab container element
 * @param predictions - Predictions data to render (null-safe)
 */
function renderPredictions(container, predictions) {
    if (!container)
        return;
    if (!predictions)
        return;
    const content = document.createElement("div");
    content.className = "predictions-content";
    if (predictions.is_stub) {
        content.innerHTML += `<div class="stub-warning">⚠️ Demo data</div>`;
    }
    predictions.forecasts.forEach((forecast) => {
        const label = forecast.metric
            .replace(/_/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());
        // SECURITY: Escape all user-controlled data to prevent XSS
        content.innerHTML += `
            <div class="forecast-section">
                <h4>${(0, security_1.escapeHtml)(label)} (${(0, security_1.escapeHtml)(String(forecast.unit))})</h4>
                <table class="forecast-table">
                    <thead><tr><th>Week</th><th>Predicted</th><th>Range</th></tr></thead>
                    <tbody>
                        ${forecast.values
            .map((v) => `
                            <tr>
                                <td>${(0, security_1.escapeHtml)(String(v.period_start))}</td>
                                <td>${(0, security_1.escapeHtml)(String(v.predicted))}</td>
                                <td>${(0, security_1.escapeHtml)(String(v.lower_bound))} - ${(0, security_1.escapeHtml)(String(v.upper_bound))}</td>
                            </tr>
                        `)
            .join("")}
                    </tbody>
                </table>
            </div>
        `;
    });
    const unavailable = container.querySelector(".feature-unavailable");
    if (unavailable)
        unavailable.classList.add("hidden");
    container.appendChild(content);
}
/**
 * Render AI insights tab content.
 * @param container - The tab container element
 * @param insights - Insights data to render (null-safe)
 */
function renderAIInsights(container, insights) {
    if (!container)
        return;
    if (!insights)
        return;
    const content = document.createElement("div");
    content.className = "insights-content";
    if (insights.is_stub) {
        content.innerHTML += `<div class="stub-warning">⚠️ Demo data</div>`;
    }
    ["critical", "warning", "info"].forEach((severity) => {
        const items = insights.insights.filter((i) => i.severity === severity);
        if (!items.length)
            return;
        // SECURITY: Escape all user-controlled data to prevent XSS
        content.innerHTML += `
            <div class="severity-section">
                <h4>${SEVERITY_ICONS[severity]} ${severity.charAt(0).toUpperCase() + severity.slice(1)}</h4>
                <div class="insight-cards">
                    ${items
            .map((i) => `
                        <div class="insight-card ${(0, security_1.escapeHtml)(String(i.severity))}">
                            <div class="insight-category">${(0, security_1.escapeHtml)(String(i.category))}</div>
                            <h5>${(0, security_1.escapeHtml)(String(i.title))}</h5>
                            <p>${(0, security_1.escapeHtml)(String(i.description))}</p>
                        </div>
                    `)
            .join("")}
                </div>
            </div>
        `;
    });
    const unavailable = container.querySelector(".feature-unavailable");
    if (unavailable)
        unavailable.classList.add("hidden");
    container.appendChild(content);
}
/**
 * Render predictions error state.
 * @param container - The tab container element
 * @param errorCode - Error code for diagnostics
 * @param message - User-facing error message
 */
function renderPredictionsError(container, errorCode, message) {
    if (!container)
        return;
    const content = document.createElement("div");
    content.className = "predictions-error";
    content.innerHTML = `
    <div class="error-message">
      <h4>Unable to Display Predictions</h4>
      <p>${(0, security_1.escapeHtml)(message)}</p>
      <code>[${(0, security_1.escapeHtml)(errorCode)}]</code>
    </div>
  `;
    container.appendChild(content);
}
/**
 * Render predictions empty state.
 * @param container - The tab container element
 */
function renderPredictionsEmpty(container) {
    if (!container)
        return;
    const content = document.createElement("div");
    content.className = "predictions-empty";
    content.innerHTML = `
    <div class="empty-message">
      <h4>Predictions Not Generated Yet</h4>
      <p>Run the analytics pipeline with ML features enabled to see predictions.</p>
    </div>
  `;
    container.appendChild(content);
}
/**
 * Render insights error state.
 * @param container - The tab container element
 * @param errorCode - Error code for diagnostics
 * @param message - User-facing error message
 */
function renderInsightsError(container, errorCode, message) {
    if (!container)
        return;
    const content = document.createElement("div");
    content.className = "insights-error";
    content.innerHTML = `
    <div class="error-message">
      <h4>Unable to Display AI Insights</h4>
      <p>${(0, security_1.escapeHtml)(message)}</p>
      <code>[${(0, security_1.escapeHtml)(errorCode)}]</code>
    </div>
  `;
    container.appendChild(content);
}
/**
 * Render insights empty state.
 * @param container - The tab container element
 */
function renderInsightsEmpty(container) {
    if (!container)
        return;
    const content = document.createElement("div");
    content.className = "insights-empty";
    content.innerHTML = `
    <div class="empty-message">
      <h4>No Insights Available</h4>
      <p>Run the analytics pipeline with AI features enabled to see bottleneck analysis.</p>
    </div>
  `;
    container.appendChild(content);
}
/**
 * Create an ML renderer with a data provider.
 * This is the async seam for future service integration.
 */
function createMlRenderer(provider) {
    let state = (0, types_1.createInitialMlState)();
    return {
        getState: () => state,
        async loadAndRenderPredictions(container) {
            if (!container)
                return;
            state = { ...state, predictionsState: "loading" };
            try {
                const result = await provider.loadPredictions();
                if (result.state === "ok" && isPredictionsRenderData(result.data)) {
                    state = {
                        ...state,
                        predictionsState: "loaded",
                        predictionsData: result,
                    };
                    renderPredictions(container, result.data);
                }
                else if (result.state === "unavailable") {
                    state = { ...state, predictionsState: "unavailable" };
                    renderPredictionsEmpty(container);
                }
                else {
                    state = {
                        ...state,
                        predictionsState: "error",
                        predictionsError: "Unknown error",
                    };
                    renderPredictionsError(container, "UNKNOWN", "Failed to load predictions");
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : "Unknown error";
                state = {
                    ...state,
                    predictionsState: "error",
                    predictionsError: message,
                };
                renderPredictionsError(container, "LOAD_FAILED", message);
            }
        },
        async loadAndRenderInsights(container) {
            if (!container)
                return;
            state = { ...state, insightsState: "loading" };
            try {
                const result = await provider.loadInsights();
                if (result.state === "ok" && isInsightsRenderData(result.data)) {
                    state = {
                        ...state,
                        insightsState: "loaded",
                        insightsData: result,
                    };
                    renderAIInsights(container, result.data);
                }
                else if (result.state === "unavailable") {
                    state = { ...state, insightsState: "unavailable" };
                    renderInsightsEmpty(container);
                }
                else {
                    state = {
                        ...state,
                        insightsState: "error",
                        insightsError: "Unknown error",
                    };
                    renderInsightsError(container, "UNKNOWN", "Failed to load insights");
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : "Unknown error";
                state = {
                    ...state,
                    insightsState: "error",
                    insightsError: message,
                };
                renderInsightsError(container, "LOAD_FAILED", message);
            }
        },
    };
}
// Re-export types for convenience
var types_2 = require("./ml/types");
Object.defineProperty(exports, "createInitialMlState", { enumerable: true, get: function () { return types_2.createInitialMlState; } });
//# sourceMappingURL=ml.js.map