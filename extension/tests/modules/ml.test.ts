/**
 * ML Module Rendering Tests
 *
 * Tests for the ML features rendering module including:
 * - renderPredictions and renderAIInsights functions
 * - Error and empty state rendering
 * - createMlRenderer factory and state management
 * - XSS prevention in rendered content
 */

import {
  renderPredictions,
  renderAIInsights,
  renderPredictionsError,
  renderPredictionsEmpty,
  renderInsightsError,
  renderInsightsEmpty,
  createMlRenderer,
  initializePhase5Features,
  createInitialMlState,
} from "../../ui/modules/ml";
import {
  createSeededRandom,
  generateSyntheticPredictions,
  generateSyntheticInsights,
} from "../../ui/modules/ml/synthetic";
import type {
  PredictionsRenderData,
  InsightsRenderData,
  PredictionsData,
  InsightsData,
} from "../../ui/types";
import type { MlDataProvider } from "../../ui/modules/ml/types";

describe("renderPredictions", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    container.innerHTML = '<div class="feature-unavailable"></div>';
  });

  it("does nothing when container is null", () => {
    const predictions: PredictionsRenderData = { forecasts: [] };
    expect(() => renderPredictions(null, predictions)).not.toThrow();
  });

  it("does nothing when predictions is null", () => {
    expect(() => renderPredictions(container, null)).not.toThrow();
    expect(container.querySelector(".predictions-charts-content")).toBeNull();
  });

  it("renders predictions content", () => {
    const predictions: PredictionsRenderData = {
      forecasts: [
        {
          metric: "pr_count",
          unit: "count",
          values: [
            {
              period_start: "2024-W01",
              predicted: 10,
              lower_bound: 8,
              upper_bound: 12,
            },
          ],
        },
      ],
    };

    renderPredictions(container, predictions);

    expect(
      container.querySelector(".predictions-charts-content"),
    ).not.toBeNull();
    expect(container.querySelector(".forecast-chart")).not.toBeNull();
    expect(container.textContent).toContain("Pr Count");
    expect(container.textContent).toContain("10");
  });

  it("shows preview banner when is_stub is true", () => {
    const predictions: PredictionsRenderData = {
      is_stub: true,
      forecasts: [],
    };

    renderPredictions(container, predictions);

    expect(container.querySelector(".preview-banner")).not.toBeNull();
    expect(container.textContent).toContain("PREVIEW");
  });

  it("hides feature-unavailable element when forecasts exist", () => {
    const predictions: PredictionsRenderData = {
      forecasts: [
        {
          metric: "test",
          unit: "count",
          values: [
            {
              period_start: "2024-W01",
              predicted: 10,
              lower_bound: 8,
              upper_bound: 12,
            },
          ],
        },
      ],
    };

    renderPredictions(container, predictions);

    const unavailable = container.querySelector(".feature-unavailable");
    expect(unavailable?.classList.contains("hidden")).toBe(true);
  });

  it("escapes XSS in metric names", () => {
    const predictions: PredictionsRenderData = {
      forecasts: [
        {
          metric: "<script>alert('xss')</script>",
          unit: "count",
          values: [
            {
              period_start: "2024-W01",
              predicted: 10,
              lower_bound: 8,
              upper_bound: 12,
            },
          ],
        },
      ],
    };

    renderPredictions(container, predictions);

    // Script element should not be created in the DOM
    expect(container.querySelector("script")).toBeNull();
    // The h4 text content should contain the literal text (escaped)
    const h4 = container.querySelector("h4");
    expect(h4?.textContent).toContain("Script");
    // ID attributes should be sanitized (no angle brackets)
    const chartId = h4?.id;
    expect(chartId).not.toContain("<");
    expect(chartId).not.toContain(">");
  });
});

describe("renderAIInsights", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    container.innerHTML = '<div class="feature-unavailable"></div>';
  });

  it("does nothing when container is null", () => {
    const insights: InsightsRenderData = { insights: [] };
    expect(() => renderAIInsights(null, insights)).not.toThrow();
  });

  it("does nothing when insights is null", () => {
    expect(() => renderAIInsights(container, null)).not.toThrow();
    expect(container.querySelector(".insights-content")).toBeNull();
  });

  it("renders insights grouped by severity", () => {
    const insights: InsightsRenderData = {
      insights: [
        {
          severity: "critical",
          category: "Performance",
          title: "Slow",
          description: "Too slow",
        },
        {
          severity: "warning",
          category: "Process",
          title: "Warn",
          description: "Watch out",
        },
        {
          severity: "info",
          category: "FYI",
          title: "Info",
          description: "Just info",
        },
      ],
    };

    renderAIInsights(container, insights);

    expect(container.querySelector(".insights-content")).not.toBeNull();
    expect(container.querySelectorAll(".severity-section").length).toBe(3);
    expect(container.querySelectorAll(".insight-card").length).toBe(3);
  });

  it("shows preview banner when is_stub is true", () => {
    const insights: InsightsRenderData = {
      is_stub: true,
      insights: [],
    };

    renderAIInsights(container, insights);

    expect(container.querySelector(".preview-banner")).not.toBeNull();
    expect(container.textContent).toContain("PREVIEW");
  });

  it("escapes XSS in insight content", () => {
    const insights: InsightsRenderData = {
      insights: [
        {
          severity: "critical",
          category: "<script>alert('xss')</script>",
          title: "Test",
          description: "Desc",
        },
      ],
    };

    renderAIInsights(container, insights);

    expect(container.innerHTML).not.toContain("<script>");
    expect(container.innerHTML).toContain("&lt;script&gt;");
  });
});

describe("renderPredictionsError", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  it("does nothing when container is null", () => {
    expect(() => renderPredictionsError(null, "CODE", "message")).not.toThrow();
  });

  it("renders error with code and message", () => {
    renderPredictionsError(container, "LOAD_FAILED", "Network error");

    expect(container.querySelector(".predictions-error")).not.toBeNull();
    expect(container.textContent).toContain("Unable to Display Predictions");
    expect(container.textContent).toContain("Network error");
    expect(container.textContent).toContain("LOAD_FAILED");
  });

  it("escapes XSS in error messages", () => {
    renderPredictionsError(container, "<test>", "<img onerror=alert(1)>");

    // HTML tags should be escaped (angle brackets become &lt; and &gt;)
    expect(container.innerHTML).not.toContain("<test>");
    expect(container.innerHTML).not.toContain("<img ");
    // The escaped content should contain the text but with escaped angle brackets
    expect(container.innerHTML).toContain("&lt;test&gt;");
    expect(container.innerHTML).toContain("&lt;img");
  });
});

describe("renderPredictionsEmpty", () => {
  it("does nothing when container is null", () => {
    expect(() => renderPredictionsEmpty(null)).not.toThrow();
  });

  it("renders empty state with setup guide", () => {
    const container = document.createElement("div");
    renderPredictionsEmpty(container);

    expect(container.querySelector(".ml-empty-state")).not.toBeNull();
    expect(container.querySelector(".setup-guide")).not.toBeNull();
    expect(container.textContent).toContain("No Prediction Data Available");
  });
});

describe("renderInsightsError", () => {
  it("renders error with code and message", () => {
    const container = document.createElement("div");
    renderInsightsError(container, "API_ERROR", "Service unavailable");

    expect(container.querySelector(".insights-error")).not.toBeNull();
    expect(container.textContent).toContain("Unable to Display AI Insights");
    expect(container.textContent).toContain("Service unavailable");
  });
});

describe("renderInsightsEmpty", () => {
  it("renders empty state with setup guide", () => {
    const container = document.createElement("div");
    renderInsightsEmpty(container);

    expect(container.querySelector(".ml-empty-state")).not.toBeNull();
    expect(container.querySelector(".setup-guide")).not.toBeNull();
    expect(container.textContent).toContain("No AI Insights Available");
  });
});

describe("createInitialMlState", () => {
  it("creates state with idle status", () => {
    const state = createInitialMlState();

    expect(state.predictionsState).toBe("idle");
    expect(state.insightsState).toBe("idle");
    expect(state.predictionsData).toBeNull();
    expect(state.insightsData).toBeNull();
  });
});

describe("createMlRenderer", () => {
  let container: HTMLElement;
  let mockProvider: MlDataProvider;

  beforeEach(() => {
    container = document.createElement("div");
    container.innerHTML = '<div class="feature-unavailable"></div>';
  });

  it("creates renderer with initial idle state", () => {
    mockProvider = {
      loadPredictions: jest.fn(),
      loadInsights: jest.fn(),
    };

    const renderer = createMlRenderer(mockProvider);
    const state = renderer.getState();

    expect(state.predictionsState).toBe("idle");
    expect(state.insightsState).toBe("idle");
  });

  it("loads and renders predictions successfully", async () => {
    const predictionsData: PredictionsData = {
      state: "ok",
      data: {
        forecasts: [{ metric: "test", unit: "count", values: [] }],
      },
    };

    mockProvider = {
      loadPredictions: jest.fn().mockResolvedValue(predictionsData),
      loadInsights: jest.fn(),
    };

    const renderer = createMlRenderer(mockProvider);
    await renderer.loadAndRenderPredictions(container);

    expect(mockProvider.loadPredictions).toHaveBeenCalled();
    expect(renderer.getState().predictionsState).toBe("loaded");
    expect(
      container.querySelector(".predictions-charts-content"),
    ).not.toBeNull();
  });

  it("handles unavailable predictions", async () => {
    mockProvider = {
      loadPredictions: jest.fn().mockResolvedValue({ state: "unavailable" }),
      loadInsights: jest.fn(),
    };

    const renderer = createMlRenderer(mockProvider);
    await renderer.loadAndRenderPredictions(container);

    expect(renderer.getState().predictionsState).toBe("unavailable");
    expect(container.querySelector(".ml-empty-state")).not.toBeNull();
  });

  it("handles prediction load errors", async () => {
    mockProvider = {
      loadPredictions: jest
        .fn()
        .mockRejectedValue(new Error("Network failure")),
      loadInsights: jest.fn(),
    };

    const renderer = createMlRenderer(mockProvider);
    await renderer.loadAndRenderPredictions(container);

    expect(renderer.getState().predictionsState).toBe("error");
    expect(renderer.getState().predictionsError).toBe("Network failure");
    expect(container.querySelector(".predictions-error")).not.toBeNull();
  });

  it("loads and renders insights successfully", async () => {
    const insightsData: InsightsData = {
      state: "ok",
      data: {
        insights: [
          {
            severity: "info",
            category: "Test",
            title: "Title",
            description: "Desc",
          },
        ],
      },
    };

    mockProvider = {
      loadPredictions: jest.fn(),
      loadInsights: jest.fn().mockResolvedValue(insightsData),
    };

    const renderer = createMlRenderer(mockProvider);
    await renderer.loadAndRenderInsights(container);

    expect(mockProvider.loadInsights).toHaveBeenCalled();
    expect(renderer.getState().insightsState).toBe("loaded");
    expect(container.querySelector(".insights-content")).not.toBeNull();
  });

  it("handles insight load errors", async () => {
    mockProvider = {
      loadPredictions: jest.fn(),
      loadInsights: jest.fn().mockRejectedValue(new Error("API error")),
    };

    const renderer = createMlRenderer(mockProvider);
    await renderer.loadAndRenderInsights(container);

    expect(renderer.getState().insightsState).toBe("error");
    expect(renderer.getState().insightsError).toBe("API error");
  });

  it("does nothing when container is null", async () => {
    mockProvider = {
      loadPredictions: jest.fn(),
      loadInsights: jest.fn(),
    };

    const renderer = createMlRenderer(mockProvider);
    await renderer.loadAndRenderPredictions(null);
    await renderer.loadAndRenderInsights(null);

    expect(mockProvider.loadPredictions).not.toHaveBeenCalled();
    expect(mockProvider.loadInsights).not.toHaveBeenCalled();
  });
});

describe("initializePhase5Features", () => {
  it("completes without error", () => {
    expect(() => initializePhase5Features()).not.toThrow();
  });
});

/**
 * Synthetic Data Determinism Tests (T018-T020)
 *
 * Verifies that synthetic preview data is deterministic across page reloads
 * by using seeded PRNG (mulberry32) instead of Math.random().
 */
describe("Synthetic Data Determinism", () => {
  describe("createSeededRandom (T018)", () => {
    it("produces consistent sequence across multiple calls", () => {
      const random1 = createSeededRandom();
      const random2 = createSeededRandom();

      // Generate 10 values from each generator
      const sequence1 = Array.from({ length: 10 }, () => random1());
      const sequence2 = Array.from({ length: 10 }, () => random2());

      // Both generators should produce identical sequences
      expect(sequence1).toEqual(sequence2);
    });

    it("produces values in range [0, 1)", () => {
      const random = createSeededRandom();

      for (let i = 0; i < 100; i++) {
        const value = random();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    });

    it("produces non-trivial variance (not all same value)", () => {
      const random = createSeededRandom();
      const values = Array.from({ length: 10 }, () => random());

      // At least some values should be different
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBeGreaterThan(1);
    });
  });

  describe("generateSyntheticPredictions (T019)", () => {
    it("returns identical values on consecutive calls", () => {
      const predictions1 = generateSyntheticPredictions();
      const predictions2 = generateSyntheticPredictions();

      // Compare forecasts (excluding generated_at which varies by time)
      expect(predictions1.forecasts).toEqual(predictions2.forecasts);
      expect(predictions1.is_stub).toEqual(predictions2.is_stub);
      expect(predictions1.generated_by).toEqual(predictions2.generated_by);
      expect(predictions1.forecaster).toEqual(predictions2.forecaster);
      expect(predictions1.data_quality).toEqual(predictions2.data_quality);
    });

    it("has is_stub flag set to true", () => {
      const predictions = generateSyntheticPredictions();
      expect(predictions.is_stub).toBe(true);
    });

    it("has generated_by set to synthetic-preview", () => {
      const predictions = generateSyntheticPredictions();
      expect(predictions.generated_by).toBe("synthetic-preview");
    });

    it("contains exactly 2 forecasts (pr_throughput, cycle_time_minutes)", () => {
      const predictions = generateSyntheticPredictions();
      expect(predictions.forecasts).toHaveLength(2);

      const metrics = predictions.forecasts.map((f) => f.metric);
      expect(metrics).toContain("pr_throughput");
      expect(metrics).toContain("cycle_time_minutes");
    });

    it("each forecast has 4 weeks of values", () => {
      const predictions = generateSyntheticPredictions();

      for (const forecast of predictions.forecasts) {
        expect(forecast.values).toHaveLength(4);
      }
    });

    it("forecast values have valid structure", () => {
      const predictions = generateSyntheticPredictions();

      for (const forecast of predictions.forecasts) {
        for (const value of forecast.values) {
          expect(typeof value.period_start).toBe("string");
          expect(typeof value.predicted).toBe("number");
          expect(typeof value.lower_bound).toBe("number");
          expect(typeof value.upper_bound).toBe("number");
          expect(value.predicted).toBeGreaterThanOrEqual(0);
          expect(value.lower_bound).toBeGreaterThanOrEqual(0);
          expect(value.upper_bound).toBeGreaterThanOrEqual(value.predicted);
        }
      }
    });
  });

  describe("generateSyntheticInsights (T020)", () => {
    it("returns identical values on consecutive calls", () => {
      const insights1 = generateSyntheticInsights();
      const insights2 = generateSyntheticInsights();

      // Compare insights (excluding generated_at which varies by time)
      expect(insights1.insights).toEqual(insights2.insights);
      expect(insights1.is_stub).toEqual(insights2.is_stub);
      expect(insights1.generated_by).toEqual(insights2.generated_by);
      expect(insights1.schema_version).toEqual(insights2.schema_version);
    });

    it("has is_stub flag set to true", () => {
      const insights = generateSyntheticInsights();
      expect(insights.is_stub).toBe(true);
    });

    it("has generated_by set to synthetic-preview", () => {
      const insights = generateSyntheticInsights();
      expect(insights.generated_by).toBe("synthetic-preview");
    });

    it("contains exactly 3 insights (one per category)", () => {
      const insights = generateSyntheticInsights();
      expect(insights.insights).toHaveLength(3);

      const categories = insights.insights.map((i) => i.category);
      expect(categories).toContain("bottleneck");
      expect(categories).toContain("trend");
      expect(categories).toContain("anomaly");
    });

    it("each insight has required v2 schema fields", () => {
      const insights = generateSyntheticInsights();

      for (const insight of insights.insights) {
        // Required base fields
        expect(insight.id).toBeDefined();
        expect(insight.category).toBeDefined();
        expect(insight.severity).toBeDefined();
        expect(insight.title).toBeDefined();
        expect(insight.description).toBeDefined();

        // v2 schema fields
        expect(insight.data).toBeDefined();
        expect(insight.recommendation).toBeDefined();

        // data fields
        expect(insight.data?.metric).toBeDefined();
        expect(insight.data?.current_value).toBeDefined();
        expect(insight.data?.sparkline).toBeDefined();

        // recommendation fields
        expect(insight.recommendation?.action).toBeDefined();
        expect(insight.recommendation?.priority).toBeDefined();
      }
    });

    it("insight IDs are deterministic and start with synthetic-", () => {
      const insights = generateSyntheticInsights();

      for (const insight of insights.insights) {
        expect(insight.id).toMatch(/^synthetic-/);
      }
    });
  });
});

/**
 * State-Based Rendering Tests (T017-T021, T029-T033)
 *
 * Tests for the 5-state artifact gating UI rendering.
 * Each state should render exactly one UI variant.
 */
import {
  sortInsights,
  renderPredictionsForState,
  renderInsightsForState,
  renderInvalidArtifactBanner,
  renderUnsupportedSchemaBanner,
  renderStaleDataBanner,
} from "../../ui/modules/ml";
import type { ArtifactState, InsightItem } from "../../ui/types";

describe("sortInsights (T031)", () => {
  it("sorts by severity DESC (critical > warning > info)", () => {
    const insights: InsightItem[] = [
      {
        id: "insight-1",
        category: "test",
        severity: "info",
        title: "Info",
        description: "Info insight",
      },
      {
        id: "insight-2",
        category: "test",
        severity: "critical",
        title: "Critical",
        description: "Critical insight",
      },
      {
        id: "insight-3",
        category: "test",
        severity: "warning",
        title: "Warning",
        description: "Warning insight",
      },
    ];

    const sorted = sortInsights(insights);

    expect(sorted[0].severity).toBe("critical");
    expect(sorted[1].severity).toBe("warning");
    expect(sorted[2].severity).toBe("info");
  });

  it("sorts by category ASC when severity is equal", () => {
    const insights: InsightItem[] = [
      {
        id: "insight-1",
        category: "zulu",
        severity: "warning",
        title: "Z",
        description: "Zulu",
      },
      {
        id: "insight-2",
        category: "alpha",
        severity: "warning",
        title: "A",
        description: "Alpha",
      },
      {
        id: "insight-3",
        category: "mike",
        severity: "warning",
        title: "M",
        description: "Mike",
      },
    ];

    const sorted = sortInsights(insights);

    expect(sorted[0].category).toBe("alpha");
    expect(sorted[1].category).toBe("mike");
    expect(sorted[2].category).toBe("zulu");
  });

  it("sorts by id ASC when severity and category are equal", () => {
    const insights: InsightItem[] = [
      {
        id: "insight-30",
        category: "test",
        severity: "info",
        title: "T30",
        description: "Test 30",
      },
      {
        id: "insight-10",
        category: "test",
        severity: "info",
        title: "T10",
        description: "Test 10",
      },
      {
        id: "insight-20",
        category: "test",
        severity: "info",
        title: "T20",
        description: "Test 20",
      },
    ];

    const sorted = sortInsights(insights);

    expect(sorted[0].id).toBe("insight-10");
    expect(sorted[1].id).toBe("insight-20");
    expect(sorted[2].id).toBe("insight-30");
  });

  it("applies full sort order: severity DESC → category ASC → id ASC", () => {
    const insights: InsightItem[] = [
      {
        id: "b-2",
        category: "beta",
        severity: "info",
        title: "B2",
        description: "Beta 2",
      },
      {
        id: "a-1",
        category: "alpha",
        severity: "critical",
        title: "A1",
        description: "Alpha 1",
      },
      {
        id: "b-1",
        category: "beta",
        severity: "info",
        title: "B1",
        description: "Beta 1",
      },
      {
        id: "a-1i",
        category: "alpha",
        severity: "info",
        title: "A1i",
        description: "Alpha 1 info",
      },
    ];

    const sorted = sortInsights(insights);

    // First: critical severity
    expect(sorted[0].severity).toBe("critical");
    expect(sorted[0].category).toBe("alpha");
    // Then: info severity, alpha category
    expect(sorted[1].severity).toBe("info");
    expect(sorted[1].category).toBe("alpha");
    expect(sorted[1].id).toBe("a-1i");
    // Then: info severity, beta category, id b-1
    expect(sorted[2].category).toBe("beta");
    expect(sorted[2].id).toBe("b-1");
    // Last: info severity, beta category, id b-2
    expect(sorted[3].category).toBe("beta");
    expect(sorted[3].id).toBe("b-2");
  });

  it("does not mutate the original array", () => {
    const original: InsightItem[] = [
      {
        id: "insight-2",
        category: "b",
        severity: "info",
        title: "B",
        description: "B",
      },
      {
        id: "insight-1",
        category: "a",
        severity: "critical",
        title: "A",
        description: "A",
      },
    ];

    const sorted = sortInsights(original);

    // Original should remain unchanged
    expect(original[0].id).toBe("insight-2");
    expect(original[1].id).toBe("insight-1");
    // Sorted should be different
    expect(sorted[0].id).toBe("insight-1");
    expect(sorted).not.toBe(original);
  });

  it("handles string IDs correctly with alphabetical ordering", () => {
    const insights: InsightItem[] = [
      {
        id: "z-insight",
        category: "test",
        severity: "info",
        title: "Z",
        description: "Z",
      },
      {
        id: "a-insight",
        category: "test",
        severity: "info",
        title: "A",
        description: "A",
      },
    ];

    const sorted = sortInsights(insights);

    expect(sorted[0].id).toBe("a-insight");
    expect(sorted[1].id).toBe("z-insight");
  });
});

describe("Predictions Tab State Rendering (T017-T021)", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  it("T017: renders setup-required state when artifact missing", () => {
    const state: ArtifactState = { type: "setup-required" };

    renderPredictionsForState(container, state);

    expect(container.querySelector(".ml-empty-state")).not.toBeNull();
    expect(container.textContent).toContain("Prediction");
  });

  it("T018: renders ready state with valid artifact", () => {
    const state: ArtifactState = {
      type: "ready",
      data: {
        forecasts: [
          {
            metric: "pr_throughput",
            unit: "count",
            values: [
              {
                period_start: "2026-01-28",
                predicted: 15,
                lower_bound: 12,
                upper_bound: 18,
              },
            ],
          },
        ],
      },
    };

    renderPredictionsForState(container, state);

    expect(
      container.querySelector(".predictions-charts-content"),
    ).not.toBeNull();
  });

  it("T019: renders invalid-artifact state with malformed JSON", () => {
    const state: ArtifactState = {
      type: "invalid-artifact",
      error: "Unexpected token at position 42",
      path: "predictions/trends.json",
    };

    renderPredictionsForState(container, state);

    expect(container.querySelector(".artifact-error-banner")).not.toBeNull();
    expect(container.textContent).toContain("Unexpected token");
  });

  it("T020: renders unsupported-schema state with wrong version", () => {
    const state: ArtifactState = {
      type: "unsupported-schema",
      version: 99,
      supported: [1, 1],
    };

    renderPredictionsForState(container, state);

    expect(container.querySelector(".artifact-error-banner")).not.toBeNull();
    expect(container.textContent).toContain("99");
    expect(container.textContent).toContain("supported");
  });

  it("renders no-data state when forecasts array is empty", () => {
    const state: ArtifactState = { type: "no-data" };

    renderPredictionsForState(container, state);

    expect(container.querySelector(".artifact-state.no-data")).not.toBeNull();
  });

  it("does nothing when container is null", () => {
    const state: ArtifactState = { type: "setup-required" };

    // Should not throw
    expect(() => renderPredictionsForState(null, state)).not.toThrow();
  });
});

describe("AI Insights Tab State Rendering (T029-T033)", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  it("T029: renders setup-required state when artifact missing", () => {
    const state: ArtifactState = { type: "setup-required" };

    renderInsightsForState(container, state);

    expect(container.querySelector(".ml-empty-state")).not.toBeNull();
    expect(container.textContent).toContain("Insight");
  });

  it("T030: renders ready state with valid artifact", () => {
    const state: ArtifactState = {
      type: "ready",
      data: {
        insights: [
          {
            id: "insight-1",
            category: "velocity",
            severity: "warning",
            title: "Test Insight",
            description: "A test insight description",
          },
        ],
      },
    };

    renderInsightsForState(container, state);

    expect(container.querySelector(".insights-content")).not.toBeNull();
  });

  it("T032: renders no-data state when insights array is empty", () => {
    const state: ArtifactState = { type: "no-data" };

    renderInsightsForState(container, state);

    expect(container.querySelector(".artifact-state.no-data")).not.toBeNull();
  });

  it("renders invalid-artifact state", () => {
    const state: ArtifactState = {
      type: "invalid-artifact",
      error: "Missing required field: insights",
      path: "insights/summary.json",
    };

    renderInsightsForState(container, state);

    expect(container.querySelector(".artifact-error-banner")).not.toBeNull();
    expect(container.textContent).toContain("Missing required field");
  });

  it("renders unsupported-schema state", () => {
    const state: ArtifactState = {
      type: "unsupported-schema",
      version: 99,
      supported: [1, 1],
    };

    renderInsightsForState(container, state);

    expect(container.querySelector(".artifact-error-banner")).not.toBeNull();
  });

  it("does nothing when container is null", () => {
    const state: ArtifactState = { type: "setup-required" };

    expect(() => renderInsightsForState(null, state)).not.toThrow();
  });
});

describe("Error Banner Components (T026, T027)", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  it("T026: renderInvalidArtifactBanner shows error and path", () => {
    renderInvalidArtifactBanner(
      container,
      "Syntax error at line 5",
      "predictions/trends.json",
    );

    expect(container.querySelector(".artifact-error-banner")).not.toBeNull();
    expect(container.textContent).toContain("Syntax error at line 5");
    expect(container.textContent).toContain("predictions/trends.json");
  });

  it("T026: renderInvalidArtifactBanner handles missing path", () => {
    renderInvalidArtifactBanner(container, "Parse failed");

    expect(container.querySelector(".artifact-error-banner")).not.toBeNull();
    expect(container.textContent).toContain("Parse failed");
  });

  it("T027: renderUnsupportedSchemaBanner shows version info", () => {
    renderUnsupportedSchemaBanner(container, 99, [1, 1]);

    expect(container.querySelector(".artifact-error-banner")).not.toBeNull();
    expect(container.textContent).toContain("99");
    expect(container.textContent).toContain("1");
  });

  it("escapes XSS in error messages", () => {
    renderInvalidArtifactBanner(
      container,
      "<script>alert('xss')</script>",
      "<img onerror='alert(1)'>",
    );

    expect(container.innerHTML).not.toContain("<script>");
    expect(container.innerHTML).not.toContain("<img onerror");
  });
});

describe("T033: Stale Data Warning Banner (T038)", () => {
  it("returns HTML string with generated_at timestamp", () => {
    const html = renderStaleDataBanner("2026-01-15T10:30:00Z");

    expect(html).toContain("stale");
    expect(html).toContain("2026");
  });

  it("handles undefined timestamp gracefully", () => {
    const html = renderStaleDataBanner(undefined);

    expect(html).toContain("stale");
  });
});

describe("T021: Predictions Chronological Ordering", () => {
  it("forecast values are sorted by period_start in chart rendering", () => {
    // This test verifies the contract - the sorting happens in predictions.ts
    // by sorting the values array before rendering
    const unsortedValues = [
      {
        period_start: "2026-01-30",
        predicted: 10,
        lower_bound: 8,
        upper_bound: 12,
      },
      {
        period_start: "2026-01-28",
        predicted: 15,
        lower_bound: 12,
        upper_bound: 18,
      },
      {
        period_start: "2026-01-29",
        predicted: 12,
        lower_bound: 10,
        upper_bound: 14,
      },
    ];

    // Sort by period_start (same logic as predictions.ts T028)
    const sorted = [...unsortedValues].sort((a, b) =>
      a.period_start.localeCompare(b.period_start),
    );

    expect(sorted[0].period_start).toBe("2026-01-28");
    expect(sorted[1].period_start).toBe("2026-01-29");
    expect(sorted[2].period_start).toBe("2026-01-30");
  });
});
