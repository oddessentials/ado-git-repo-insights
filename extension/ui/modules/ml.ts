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
} from "./shared/render";
import type {
  PredictionsRenderData,
  InsightsRenderData,
  InsightItem,
  InsightData,
  Recommendation,
  AffectedEntity,
} from "../types";
import type { MlDataProvider, MlFeatureState } from "./ml/types";
import { createInitialMlState } from "./ml/types";
import {
  renderPredictionsWithCharts,
  type RollupForChart,
} from "./charts/predictions";
import { canShowSyntheticData } from "./ml/dev-mode";
import { generateSyntheticPredictions, generateSyntheticInsights } from "./ml/synthetic";
import {
  renderPredictionsEmptyWithGuide,
  renderInsightsEmptyWithGuide,
} from "./ml/setup-guides";

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
 * Priority badge labels and CSS classes.
 */
const PRIORITY_BADGES: Record<string, { label: string; cssClass: string }> = {
  high: { label: "High Priority", cssClass: "priority-high" },
  medium: { label: "Medium Priority", cssClass: "priority-medium" },
  low: { label: "Low Priority", cssClass: "priority-low" },
};

/**
 * Effort badge labels and CSS classes.
 */
const EFFORT_BADGES: Record<string, { label: string; cssClass: string }> = {
  high: { label: "High Effort", cssClass: "effort-high" },
  medium: { label: "Medium Effort", cssClass: "effort-medium" },
  low: { label: "Low Effort", cssClass: "effort-low" },
};

/**
 * Trend direction icons.
 */
const TREND_ICONS: Record<string, string> = {
  up: "↗",
  down: "↘",
  stable: "→",
};

/**
 * Render a sparkline as an inline SVG for insight cards (T038).
 * Named distinctly from charts.ts renderSparkline to avoid export conflicts.
 * @param values - Array of numeric values for the sparkline
 * @param width - SVG width (default 60)
 * @param height - SVG height (default 20)
 * @returns HTML string for the sparkline SVG
 */
function renderInsightSparkline(
  values: number[] | undefined,
  width: number = 60,
  height: number = 20,
): string {
  if (!values || values.length < 2) {
    return `<span class="sparkline-empty">—</span>`;
  }

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;
  const padding = 2;
  const effectiveHeight = height - padding * 2;
  const effectiveWidth = width - padding * 2;

  // Calculate points for polyline
  const points = values
    .map((val, i) => {
      const x = padding + (i / (values.length - 1)) * effectiveWidth;
      const y = padding + (1 - (val - minVal) / range) * effectiveHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return `
    <svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <polyline
        points="${points}"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  `;
}

/**
 * Render the data section with metric and sparkline (T040).
 * @param data - Insight data with metric, values, and trend
 * @returns HTML string for the data section
 */
function renderInsightDataSection(data: InsightData | undefined): string {
  if (!data) return "";

  const metricLabel = data.metric
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const trendIcon = TREND_ICONS[data.trend_direction] || "";
  const trendClass = `trend-${data.trend_direction}`;

  // Format change percent
  const changeDisplay = data.change_percent !== undefined
    ? `${data.change_percent > 0 ? "+" : ""}${data.change_percent.toFixed(1)}%`
    : "";

  return `
    <div class="insight-data-section">
      <div class="insight-metric">
        <span class="metric-label">${escapeHtml(metricLabel)}</span>
        <span class="metric-value">${escapeHtml(String(data.current_value))}</span>
        ${changeDisplay ? `<span class="metric-change ${trendClass}">${trendIcon} ${escapeHtml(changeDisplay)}</span>` : ""}
      </div>
      <div class="insight-sparkline">
        ${renderInsightSparkline(data.sparkline)}
      </div>
    </div>
  `;
}

/**
 * Render the recommendation section with priority/effort badges (T041).
 * @param recommendation - Recommendation with action, priority, and effort
 * @returns HTML string for the recommendation section
 */
function renderRecommendationSection(recommendation: Recommendation | undefined): string {
  if (!recommendation) return "";

  const priorityBadge = PRIORITY_BADGES[recommendation.priority] ?? { label: "Medium Priority", cssClass: "priority-medium" };
  const effortBadge = EFFORT_BADGES[recommendation.effort] ?? { label: "Medium Effort", cssClass: "effort-medium" };

  return `
    <div class="insight-recommendation">
      <div class="recommendation-header">
        <span class="recommendation-label">Recommendation</span>
        <div class="recommendation-badges">
          <span class="badge ${priorityBadge.cssClass}">${escapeHtml(priorityBadge.label)}</span>
          <span class="badge ${effortBadge.cssClass}">${escapeHtml(effortBadge.label)}</span>
        </div>
      </div>
      <p class="recommendation-action">${escapeHtml(recommendation.action)}</p>
    </div>
  `;
}

/**
 * Render the affected entities display with member counts (T042).
 * @param entities - Array of affected entities
 * @returns HTML string for the entities section
 */
function renderAffectedEntities(entities: AffectedEntity[] | undefined): string {
  if (!entities || entities.length === 0) return "";

  const entityItems = entities
    .map((entity) => {
      const memberCount = entity.member_count !== undefined
        ? `<span class="entity-count">(${entity.member_count})</span>`
        : "";
      const entityIcon = entity.type === "team" ? "👥"
        : entity.type === "repository" ? "📁"
        : "👤";
      return `
        <span class="entity-item ${escapeHtml(entity.type)}">
          <span class="entity-icon">${entityIcon}</span>
          <span class="entity-name">${escapeHtml(entity.name)}</span>
          ${memberCount}
        </span>
      `;
    })
    .join("");

  return `
    <div class="insight-affected-entities">
      <span class="entities-label">Affects:</span>
      <div class="entities-list">${entityItems}</div>
    </div>
  `;
}

/**
 * Render a rich insight card with all v2 schema fields (T039).
 * @param insight - The insight item to render
 * @returns HTML string for the insight card
 */
function renderRichInsightCard(insight: InsightItem): string {
  const severityIcon = SEVERITY_ICONS[insight.severity] || SEVERITY_ICONS.info;

  return `
    <div class="insight-card rich-card ${escapeHtml(String(insight.severity))}">
      <div class="insight-header">
        <span class="severity-icon">${severityIcon}</span>
        <span class="insight-category">${escapeHtml(String(insight.category))}</span>
      </div>
      <h5 class="insight-title">${escapeHtml(String(insight.title))}</h5>
      <p class="insight-description">${escapeHtml(String(insight.description))}</p>
      ${renderInsightDataSection(insight.data)}
      ${renderAffectedEntities(insight.affected_entities)}
      ${renderRecommendationSection(insight.recommendation)}
    </div>
  `;
}

/**
 * Render prominent preview banner for synthetic data (T056).
 * Used to clearly indicate that displayed data is demo/preview only.
 * @returns HTML string for the preview banner
 */
function renderPreviewBanner(): string {
  return `
    <div class="preview-banner">
      <span class="preview-icon">&#x26A0;</span>
      <div class="preview-text">
        <strong>PREVIEW - Demo Data</strong>
        <span>This is synthetic data for preview purposes only. Run the analytics pipeline to see real metrics.</span>
      </div>
    </div>
  `;
}

/**
 * Initialize Phase 5 features in the UI.
 * Sets up tab content areas for ML features.
 */
export function initializePhase5Features(): void {
  // Tab visibility is controlled by updateFeatureTabs based on manifest
  // This function can be extended for future Phase 5 setup
}

/**
 * Render predictions tab content with forecast charts.
 * @param container - The tab container element
 * @param predictions - Predictions data to render (null-safe)
 * @param rollups - Optional historical rollup data for chart context
 */
export function renderPredictions(
  container: HTMLElement | null,
  predictions: PredictionsRenderData | null,
  rollups?: RollupForChart[],
): void {
  // Use the chart-based rendering from predictions module
  renderPredictionsWithCharts(container, predictions, rollups);
}

/**
 * Render AI insights tab content with rich cards.
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

  // Show prominent preview banner for synthetic data (T056)
  if (insights.is_stub) {
    appendTrustedHtml(content, renderPreviewBanner());
  }

  // Group insights by severity and render with rich cards
  ["critical", "warning", "info"].forEach((severity) => {
    const items = insights.insights.filter(
      (i: InsightItem) => i.severity === severity,
    );
    if (!items.length) return;

    // SECURITY: All user-controlled data is escaped in renderRichInsightCard
    appendTrustedHtml(
      content,
      `
        <div class="severity-section">
          <h4>${SEVERITY_ICONS[severity]} ${severity.charAt(0).toUpperCase() + severity.slice(1)}</h4>
          <div class="insight-cards">
            ${items.map((i: InsightItem) => renderRichInsightCard(i)).join("")}
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
 * Render predictions empty state with setup guide (T065).
 * @param container - The tab container element
 */
export function renderPredictionsEmpty(container: HTMLElement | null): void {
  if (!container) return;

  // Use setup guide for rich empty state
  renderPredictionsEmptyWithGuide(container);
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
 * Render insights empty state with setup guide (T066).
 * @param container - The tab container element
 */
export function renderInsightsEmpty(container: HTMLElement | null): void {
  if (!container) return;

  // Use setup guide for rich empty state
  renderInsightsEmptyWithGuide(container);
}

/**
 * Options for ML renderer behavior.
 */
export interface MlRendererOptions {
  /** Enable dev mode to show synthetic data when real data is unavailable */
  devMode?: boolean;
}

/**
 * Create an ML renderer with a data provider.
 * This is the async seam for future service integration.
 *
 * @param provider - Data provider for loading ML data
 * @param options - Optional configuration including devMode flag
 */
export function createMlRenderer(provider: MlDataProvider, options: MlRendererOptions = {}) {
  let state: MlFeatureState = createInitialMlState();
  const { devMode = false } = options;

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
          // T054: Synthetic fallback for predictions when unavailable
          if (canShowSyntheticData(devMode)) {
            const syntheticData = generateSyntheticPredictions();
            state = {
              ...state,
              predictionsState: "loaded",
              predictionsData: { state: "ok", data: syntheticData },
            };
            renderPredictions(container, syntheticData);
          } else {
            state = { ...state, predictionsState: "unavailable" };
            renderPredictionsEmpty(container);
          }
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
          // T055: Synthetic fallback for insights when unavailable
          if (canShowSyntheticData(devMode)) {
            const syntheticData = generateSyntheticInsights();
            state = {
              ...state,
              insightsState: "loaded",
              insightsData: { state: "ok", data: syntheticData },
            };
            renderAIInsights(container, syntheticData);
          } else {
            state = { ...state, insightsState: "unavailable" };
            renderInsightsEmpty(container);
          }
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

// Re-export dev mode utilities (US3)
export {
  isProductionEnvironment,
  canShowSyntheticData,
  isLocalDevelopment,
  getCurrentHostname,
} from "./ml/dev-mode";

// Re-export synthetic data generators (US3)
export {
  generateSyntheticPredictions,
  generateSyntheticInsights,
  isSyntheticData,
} from "./ml/synthetic";

// Re-export setup guide utilities (US4)
export {
  renderPredictionsSetupGuide,
  renderInsightsSetupGuide,
  getPredictionsYaml,
  getInsightsYaml,
  attachCopyHandlers,
} from "./ml/setup-guides";
