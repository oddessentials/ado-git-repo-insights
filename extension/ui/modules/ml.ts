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

import {
  escapeHtml,
  renderTrustedHtml,
  appendTrustedHtml,
  createElement,
} from "./shared/render";
import type {
  PredictionsRenderData,
  InsightsRenderData,
  Forecast,
  ForecastValue,
  InsightItem,
} from "../types";
import type { MlDataProvider, MlFeatureState } from "./ml/types";
import { createInitialMlState } from "./ml/types";

/**
 * Type guard to check if data is valid PredictionsRenderData.
 */
function isPredictionsRenderData(data: unknown): data is PredictionsRenderData {
  return (
    typeof data === "object" &&
    data !== null &&
    "forecasts" in data &&
    Array.isArray((data as PredictionsRenderData).forecasts)
  );
}

/**
 * Type guard to check if data is valid InsightsRenderData.
 */
function isInsightsRenderData(data: unknown): data is InsightsRenderData {
  return (
    typeof data === "object" &&
    data !== null &&
    "insights" in data &&
    Array.isArray((data as InsightsRenderData).insights)
  );
}

/**
 * Severity icons for insight rendering.
 */
const SEVERITY_ICONS: Record<string, string> = {
  critical: "🔴",
  warning: "🟡",
  info: "🔵",
};

/**
 * Initialize Phase 5 features in the UI.
 * Sets up tab content areas for ML features.
 */
export function initializePhase5Features(): void {
  // Tab visibility is controlled by updateFeatureTabs based on manifest
  // This function can be extended for future Phase 5 setup
}

/**
 * Render predictions tab content.
 * @param container - The tab container element
 * @param predictions - Predictions data to render (null-safe)
 */
export function renderPredictions(
  container: HTMLElement | null,
  predictions: PredictionsRenderData | null,
): void {
  if (!container) return;
  if (!predictions) return;

  const content = document.createElement("div");
  content.className = "predictions-content";

  if (predictions.is_stub) {
    const warning = createElement(
      "div",
      { class: "stub-warning" },
      "⚠️ Demo data",
    );
    content.appendChild(warning);
  }

  predictions.forecasts.forEach((forecast: Forecast) => {
    const label = forecast.metric
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c: string) => c.toUpperCase());
    // SECURITY: Escape all user-controlled data to prevent XSS
    appendTrustedHtml(
      content,
      `
            <div class="forecast-section">
                <h4>${escapeHtml(label)} (${escapeHtml(String(forecast.unit))})</h4>
                <table class="forecast-table">
                    <thead><tr><th>Week</th><th>Predicted</th><th>Range</th></tr></thead>
                    <tbody>
                        ${forecast.values
                          .map(
                            (v: ForecastValue) => `
                            <tr>
                                <td>${escapeHtml(String(v.period_start))}</td>
                                <td>${escapeHtml(String(v.predicted))}</td>
                                <td>${escapeHtml(String(v.lower_bound))} - ${escapeHtml(String(v.upper_bound))}</td>
                            </tr>
                        `,
                          )
                          .join("")}
                    </tbody>
                </table>
            </div>
        `,
    );
  });

  const unavailable = container.querySelector(".feature-unavailable");
  if (unavailable) unavailable.classList.add("hidden");
  container.appendChild(content);
}

/**
 * Render AI insights tab content.
 * @param container - The tab container element
 * @param insights - Insights data to render (null-safe)
 */
export function renderAIInsights(
  container: HTMLElement | null,
  insights: InsightsRenderData | null,
): void {
  if (!container) return;
  if (!insights) return;

  const content = document.createElement("div");
  content.className = "insights-content";

  if (insights.is_stub) {
    const warning = createElement(
      "div",
      { class: "stub-warning" },
      "⚠️ Demo data",
    );
    content.appendChild(warning);
  }

  ["critical", "warning", "info"].forEach((severity) => {
    const items = insights.insights.filter(
      (i: InsightItem) => i.severity === severity,
    );
    if (!items.length) return;

    // SECURITY: Escape all user-controlled data to prevent XSS
    appendTrustedHtml(
      content,
      `
            <div class="severity-section">
                <h4>${SEVERITY_ICONS[severity]} ${severity.charAt(0).toUpperCase() + severity.slice(1)}</h4>
                <div class="insight-cards">
                    ${items
                      .map(
                        (i: InsightItem) => `
                        <div class="insight-card ${escapeHtml(String(i.severity))}">
                            <div class="insight-category">${escapeHtml(String(i.category))}</div>
                            <h5>${escapeHtml(String(i.title))}</h5>
                            <p>${escapeHtml(String(i.description))}</p>
                        </div>
                    `,
                      )
                      .join("")}
                </div>
            </div>
        `,
    );
  });

  const unavailable = container.querySelector(".feature-unavailable");
  if (unavailable) unavailable.classList.add("hidden");
  container.appendChild(content);
}

/**
 * Render predictions error state.
 * @param container - The tab container element
 * @param errorCode - Error code for diagnostics
 * @param message - User-facing error message
 */
export function renderPredictionsError(
  container: HTMLElement | null,
  errorCode: string,
  message: string,
): void {
  if (!container) return;

  const content = document.createElement("div");
  content.className = "predictions-error";
  // SECURITY: message and errorCode are escaped
  renderTrustedHtml(
    content,
    `
    <div class="error-message">
      <h4>Unable to Display Predictions</h4>
      <p>${escapeHtml(message)}</p>
      <code>[${escapeHtml(errorCode)}]</code>
    </div>
  `,
  );
  container.appendChild(content);
}

/**
 * Render predictions empty state.
 * @param container - The tab container element
 */
export function renderPredictionsEmpty(container: HTMLElement | null): void {
  if (!container) return;

  const content = document.createElement("div");
  content.className = "predictions-empty";
  // SECURITY: Static content only
  renderTrustedHtml(
    content,
    `
    <div class="empty-message">
      <h4>Predictions Not Generated Yet</h4>
      <p>Run the analytics pipeline with ML features enabled to see predictions.</p>
    </div>
  `,
  );
  container.appendChild(content);
}

/**
 * Render insights error state.
 * @param container - The tab container element
 * @param errorCode - Error code for diagnostics
 * @param message - User-facing error message
 */
export function renderInsightsError(
  container: HTMLElement | null,
  errorCode: string,
  message: string,
): void {
  if (!container) return;

  const content = document.createElement("div");
  content.className = "insights-error";
  // SECURITY: message and errorCode are escaped
  renderTrustedHtml(
    content,
    `
    <div class="error-message">
      <h4>Unable to Display AI Insights</h4>
      <p>${escapeHtml(message)}</p>
      <code>[${escapeHtml(errorCode)}]</code>
    </div>
  `,
  );
  container.appendChild(content);
}

/**
 * Render insights empty state.
 * @param container - The tab container element
 */
export function renderInsightsEmpty(container: HTMLElement | null): void {
  if (!container) return;

  const content = document.createElement("div");
  content.className = "insights-empty";
  // SECURITY: Static content only
  renderTrustedHtml(
    content,
    `
    <div class="empty-message">
      <h4>No Insights Available</h4>
      <p>Run the analytics pipeline with AI features enabled to see bottleneck analysis.</p>
    </div>
  `,
  );
  container.appendChild(content);
}

/**
 * Create an ML renderer with a data provider.
 * This is the async seam for future service integration.
 */
export function createMlRenderer(provider: MlDataProvider) {
  let state: MlFeatureState = createInitialMlState();

  return {
    getState: () => state,

    async loadAndRenderPredictions(
      container: HTMLElement | null,
    ): Promise<void> {
      if (!container) return;

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
        } else if (result.state === "unavailable") {
          state = { ...state, predictionsState: "unavailable" };
          renderPredictionsEmpty(container);
        } else {
          state = {
            ...state,
            predictionsState: "error",
            predictionsError: "Unknown error",
          };
          renderPredictionsError(
            container,
            "UNKNOWN",
            "Failed to load predictions",
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        state = {
          ...state,
          predictionsState: "error",
          predictionsError: message,
        };
        renderPredictionsError(container, "LOAD_FAILED", message);
      }
    },

    async loadAndRenderInsights(container: HTMLElement | null): Promise<void> {
      if (!container) return;

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
        } else if (result.state === "unavailable") {
          state = { ...state, insightsState: "unavailable" };
          renderInsightsEmpty(container);
        } else {
          state = {
            ...state,
            insightsState: "error",
            insightsError: "Unknown error",
          };
          renderInsightsError(container, "UNKNOWN", "Failed to load insights");
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
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
export {
  createInitialMlState,
  type MlDataProvider,
  type MlFeatureState,
} from "./ml/types";
