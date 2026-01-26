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
    expect(container.querySelector(".predictions-content")).toBeNull();
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

    expect(container.querySelector(".predictions-content")).not.toBeNull();
    expect(container.querySelector(".forecast-section")).not.toBeNull();
    expect(container.textContent).toContain("Pr Count");
    expect(container.textContent).toContain("10");
  });

  it("shows stub warning when is_stub is true", () => {
    const predictions: PredictionsRenderData = {
      is_stub: true,
      forecasts: [],
    };

    renderPredictions(container, predictions);

    expect(container.querySelector(".stub-warning")).not.toBeNull();
    expect(container.textContent).toContain("Demo data");
  });

  it("hides feature-unavailable element", () => {
    const predictions: PredictionsRenderData = { forecasts: [] };

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
          values: [],
        },
      ],
    };

    renderPredictions(container, predictions);

    // Script tags should be escaped (case may vary due to title-case formatting)
    expect(container.innerHTML).not.toContain("<script>");
    expect(container.innerHTML.toLowerCase()).toContain("&lt;script&gt;");
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

  it("shows stub warning when is_stub is true", () => {
    const insights: InsightsRenderData = {
      is_stub: true,
      insights: [],
    };

    renderAIInsights(container, insights);

    expect(container.querySelector(".stub-warning")).not.toBeNull();
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

  it("renders empty state message", () => {
    const container = document.createElement("div");
    renderPredictionsEmpty(container);

    expect(container.querySelector(".predictions-empty")).not.toBeNull();
    expect(container.textContent).toContain("Predictions Not Generated");
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
  it("renders empty state message", () => {
    const container = document.createElement("div");
    renderInsightsEmpty(container);

    expect(container.querySelector(".insights-empty")).not.toBeNull();
    expect(container.textContent).toContain("No Insights Available");
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
    expect(container.querySelector(".predictions-content")).not.toBeNull();
  });

  it("handles unavailable predictions", async () => {
    mockProvider = {
      loadPredictions: jest.fn().mockResolvedValue({ state: "unavailable" }),
      loadInsights: jest.fn(),
    };

    const renderer = createMlRenderer(mockProvider);
    await renderer.loadAndRenderPredictions(container);

    expect(renderer.getState().predictionsState).toBe("unavailable");
    expect(container.querySelector(".predictions-empty")).not.toBeNull();
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
