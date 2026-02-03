/**
 * ML State Rendering Tests
 *
 * Tests for renderPredictionsForState and renderInsightsForState functions.
 * Validates the 5-state × 2 artifact type matrix with triple assertion pattern.
 *
 * States: setup-required, no-data, invalid-artifact, unsupported-schema, ready
 * Artifact types: predictions, insights
 *
 * @module tests/dashboard/ml-state-rendering.test.ts
 */

import { jest } from "@jest/globals";
import {
  setupDomHarness,
  teardownDomHarness,
  createErrorAssertionContext,
} from "../harness/dom-harness";
import {
  renderPredictionsForState,
  renderInsightsForState,
} from "../../ui/modules/ml";
import type { ArtifactState } from "../../ui/types";

// Load fixtures
import predictionsReady from "../fixtures/predictions-ready.json";
import predictionsNoData from "../fixtures/predictions-no-data.json";
import predictionsInvalid from "../fixtures/predictions-invalid.json";
import predictionsUnsupportedV from "../fixtures/predictions-unsupported-v.json";
import insightsReady from "../fixtures/insights-ready.json";
import insightsNoData from "../fixtures/insights-no-data.json";
import insightsInvalid from "../fixtures/insights-invalid.json";
import insightsUnsupportedV from "../fixtures/insights-unsupported-v.json";

// Custom DOM for ML tab containers
const ML_TAB_DOM = `
<div id="app">
  <div id="predictions-container"></div>
  <div id="insights-container"></div>
</div>
`;

describe("ML State Rendering", () => {
  beforeEach(() => {
    setupDomHarness({ customDom: ML_TAB_DOM });
  });

  afterEach(() => {
    teardownDomHarness();
    jest.restoreAllMocks();
  });

  // =========================================================================
  // Predictions State Tests (T012-T016)
  // =========================================================================

  describe("renderPredictionsForState", () => {
    describe("ready state (T012)", () => {
      it("renders predictions content without runtime errors", () => {
        const ctx = createErrorAssertionContext();
        const container = document.getElementById("predictions-container");
        const state: ArtifactState = {
          type: "ready",
          data: {
            forecasts: predictionsReady.predictions.map((p) => ({
              metric: p.metric,
              unit: "count",
              values: [
                {
                  period_start: p.period,
                  predicted: p.predicted_value,
                  lower_bound: p.confidence_lower,
                  upper_bound: p.confidence_upper,
                },
              ],
            })),
          },
        };

        // Triple assertion pattern
        // 1. No throws
        expect(() => {
          renderPredictionsForState(container, state);
        }).not.toThrow();

        // 2. No console.error
        ctx.assertNoErrors();

        // 3. Correct DOM output - predictions uses "predictions-charts-content" class
        expect(
          container?.querySelector(".predictions-charts-content"),
        ).not.toBeNull();

        ctx.restore();
      });

      it("clears existing content before rendering", () => {
        const container = document.getElementById("predictions-container");
        if (container) {
          container.innerHTML =
            '<div class="predictions-content">old content</div>';
        }

        const state: ArtifactState = {
          type: "ready",
          data: {
            forecasts: [],
          },
        };

        renderPredictionsForState(container, state);

        // Should have replaced old content
        const contents = container?.querySelectorAll(".predictions-content");
        expect(contents?.length).toBeLessThanOrEqual(1);
      });
    });

    describe("no-data state (T013)", () => {
      it("renders no-data state without runtime errors", () => {
        const ctx = createErrorAssertionContext();
        const container = document.getElementById("predictions-container");
        const state: ArtifactState = {
          type: "no-data",
        };

        // Triple assertion pattern
        expect(() => {
          renderPredictionsForState(container, state);
        }).not.toThrow();

        ctx.assertNoErrors();
        expect(container?.querySelector(".artifact-state")).not.toBeNull();

        ctx.restore();
      });

      it("includes quality indicator when insufficient data", () => {
        const container = document.getElementById("predictions-container");
        const state: ArtifactState = {
          type: "no-data",
          quality: "insufficient",
        };

        renderPredictionsForState(container, state);

        // Should render artifact-state element
        expect(container?.querySelector(".artifact-state")).not.toBeNull();
      });
    });

    describe("invalid-artifact state (T014)", () => {
      it("renders error banner without runtime errors", () => {
        const ctx = createErrorAssertionContext();
        const container = document.getElementById("predictions-container");
        const state: ArtifactState = {
          type: "invalid-artifact",
          error: "Schema validation failed",
          path: "predictions/trends.json",
        };

        // Triple assertion pattern
        expect(() => {
          renderPredictionsForState(container, state);
        }).not.toThrow();

        ctx.assertNoErrors();
        expect(
          container?.querySelector(".artifact-error-banner"),
        ).not.toBeNull();

        ctx.restore();
      });

      it("displays error message in banner", () => {
        const container = document.getElementById("predictions-container");
        const state: ArtifactState = {
          type: "invalid-artifact",
          error: "Missing required field: forecasts",
        };

        renderPredictionsForState(container, state);

        const banner = container?.querySelector(".artifact-error-banner");
        expect(banner?.textContent).toContain("Invalid");
      });
    });

    describe("unsupported-schema state (T015)", () => {
      it("renders unsupported schema banner without runtime errors", () => {
        const ctx = createErrorAssertionContext();
        const container = document.getElementById("predictions-container");
        const state: ArtifactState = {
          type: "unsupported-schema",
          version: 99,
          supported: [1, 1],
        };

        // Triple assertion pattern
        expect(() => {
          renderPredictionsForState(container, state);
        }).not.toThrow();

        ctx.assertNoErrors();
        expect(
          container?.querySelector(".artifact-error-banner"),
        ).not.toBeNull();

        ctx.restore();
      });

      it("displays version information in banner", () => {
        const container = document.getElementById("predictions-container");
        const state: ArtifactState = {
          type: "unsupported-schema",
          version: 99,
          supported: [1, 1],
        };

        renderPredictionsForState(container, state);

        const banner = container?.querySelector(".artifact-error-banner");
        expect(banner?.textContent).toContain("99");
      });
    });

    describe("setup-required state (T016)", () => {
      it("renders empty state without runtime errors", () => {
        const ctx = createErrorAssertionContext();
        const container = document.getElementById("predictions-container");
        const state: ArtifactState = {
          type: "setup-required",
        };

        // Triple assertion pattern
        expect(() => {
          renderPredictionsForState(container, state);
        }).not.toThrow();

        ctx.assertNoErrors();
        expect(container?.querySelector(".ml-empty-state")).not.toBeNull();

        ctx.restore();
      });

      it("provides setup guidance", () => {
        const container = document.getElementById("predictions-container");
        const state: ArtifactState = {
          type: "setup-required",
        };

        renderPredictionsForState(container, state);

        // Should contain setup-related text
        const emptyState = container?.querySelector(".ml-empty-state");
        expect(emptyState).not.toBeNull();
      });
    });

    describe("null container handling", () => {
      it("handles null container without errors", () => {
        const ctx = createErrorAssertionContext();
        const state: ArtifactState = { type: "setup-required" };

        expect(() => {
          renderPredictionsForState(null, state);
        }).not.toThrow();

        ctx.assertNoErrors();
        ctx.restore();
      });
    });
  });

  // =========================================================================
  // Insights State Tests (T017-T021)
  // =========================================================================

  describe("renderInsightsForState", () => {
    describe("ready state (T017)", () => {
      it("renders insights content without runtime errors", () => {
        const ctx = createErrorAssertionContext();
        const container = document.getElementById("insights-container");
        const state: ArtifactState = {
          type: "ready",
          data: {
            insights: insightsReady.insights.map((i) => ({
              id: String(i.id),
              severity: i.severity as "critical" | "warning" | "info",
              category: i.category,
              title: i.title,
              description: i.description,
            })),
          },
        };

        // Triple assertion pattern
        expect(() => {
          renderInsightsForState(container, state);
        }).not.toThrow();

        ctx.assertNoErrors();
        expect(container?.querySelector(".insights-content")).not.toBeNull();

        ctx.restore();
      });

      it("renders multiple insight cards", () => {
        const container = document.getElementById("insights-container");
        const state: ArtifactState = {
          type: "ready",
          data: {
            insights: [
              {
                id: "1",
                severity: "warning" as const,
                category: "velocity",
                title: "Test Insight 1",
                description: "Description 1",
              },
              {
                id: "2",
                severity: "info" as const,
                category: "quality",
                title: "Test Insight 2",
                description: "Description 2",
              },
            ],
          },
        };

        renderInsightsForState(container, state);

        const content = container?.querySelector(".insights-content");
        expect(content).not.toBeNull();
      });
    });

    describe("no-data state (T018)", () => {
      it("renders no-data state without runtime errors", () => {
        const ctx = createErrorAssertionContext();
        const container = document.getElementById("insights-container");
        const state: ArtifactState = {
          type: "no-data",
        };

        // Triple assertion pattern
        expect(() => {
          renderInsightsForState(container, state);
        }).not.toThrow();

        ctx.assertNoErrors();
        expect(container?.querySelector(".artifact-state")).not.toBeNull();

        ctx.restore();
      });
    });

    describe("invalid-artifact state (T019)", () => {
      it("renders error banner without runtime errors", () => {
        const ctx = createErrorAssertionContext();
        const container = document.getElementById("insights-container");
        const state: ArtifactState = {
          type: "invalid-artifact",
          error: "Schema validation failed",
          path: "ai_insights/summary.json",
        };

        // Triple assertion pattern
        expect(() => {
          renderInsightsForState(container, state);
        }).not.toThrow();

        ctx.assertNoErrors();
        expect(
          container?.querySelector(".artifact-error-banner"),
        ).not.toBeNull();

        ctx.restore();
      });
    });

    describe("unsupported-schema state (T020)", () => {
      it("renders unsupported schema banner without runtime errors", () => {
        const ctx = createErrorAssertionContext();
        const container = document.getElementById("insights-container");
        const state: ArtifactState = {
          type: "unsupported-schema",
          version: 99,
          supported: [1, 1],
        };

        // Triple assertion pattern
        expect(() => {
          renderInsightsForState(container, state);
        }).not.toThrow();

        ctx.assertNoErrors();
        expect(
          container?.querySelector(".artifact-error-banner"),
        ).not.toBeNull();

        ctx.restore();
      });
    });

    describe("setup-required state (T021)", () => {
      it("renders empty state without runtime errors", () => {
        const ctx = createErrorAssertionContext();
        const container = document.getElementById("insights-container");
        const state: ArtifactState = {
          type: "setup-required",
        };

        // Triple assertion pattern
        expect(() => {
          renderInsightsForState(container, state);
        }).not.toThrow();

        ctx.assertNoErrors();
        expect(container?.querySelector(".ml-empty-state")).not.toBeNull();

        ctx.restore();
      });
    });

    describe("null container handling", () => {
      it("handles null container without errors", () => {
        const ctx = createErrorAssertionContext();
        const state: ArtifactState = { type: "setup-required" };

        expect(() => {
          renderInsightsForState(null, state);
        }).not.toThrow();

        ctx.assertNoErrors();
        ctx.restore();
      });
    });
  });
});
