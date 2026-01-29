/**
 * ML State Machine Tests
 *
 * Tests for the 5-state artifact gating contract per FR-001 through FR-004.
 * Verifies first-match-wins behavior and state resolution order.
 *
 * @module tests/modules/ml-state-machine
 */

import {
  resolvePredictionsState,
  resolveInsightsState,
  getStateMessage,
  isErrorState,
  isReadyState,
  type ArtifactLoadResult,
} from "../../ui/modules/ml/state-machine";

describe("ML State Machine", () => {
  describe("resolvePredictionsState", () => {
    it("returns setup-required when file does not exist", () => {
      const result: ArtifactLoadResult = {
        exists: false,
        data: null,
      };

      const state = resolvePredictionsState(result);

      expect(state.type).toBe("setup-required");
    });

    it("returns invalid-artifact when JSON parsing fails", () => {
      const result: ArtifactLoadResult = {
        exists: true,
        data: null,
        parseError: "Unexpected token at position 42",
        path: "predictions/trends.json",
      };

      const state = resolvePredictionsState(result);

      expect(state.type).toBe("invalid-artifact");
      if (state.type === "invalid-artifact") {
        expect(state.error).toBe("Unexpected token at position 42");
        expect(state.path).toBe("predictions/trends.json");
      }
    });

    it("returns invalid-artifact when required fields are missing", () => {
      const result: ArtifactLoadResult = {
        exists: true,
        data: { some: "data" }, // Missing schema_version, generated_at, forecasts
      };

      const state = resolvePredictionsState(result);

      expect(state.type).toBe("invalid-artifact");
      if (state.type === "invalid-artifact") {
        expect(state.error).toContain("Missing required fields");
      }
    });

    it("returns unsupported-schema when schema_version is too high", () => {
      const result: ArtifactLoadResult = {
        exists: true,
        data: {
          schema_version: 99,
          generated_at: "2026-01-28T12:00:00Z",
          forecasts: [],
        },
      };

      const state = resolvePredictionsState(result);

      expect(state.type).toBe("unsupported-schema");
      if (state.type === "unsupported-schema") {
        expect(state.version).toBe(99);
        expect(state.supported).toEqual([1, 1]);
      }
    });

    it("returns no-data when forecasts array is empty", () => {
      const result: ArtifactLoadResult = {
        exists: true,
        data: {
          schema_version: 1,
          generated_at: "2026-01-28T12:00:00Z",
          forecasts: [],
        },
      };

      const state = resolvePredictionsState(result);

      expect(state.type).toBe("no-data");
    });

    it("returns no-data when data_quality is insufficient", () => {
      const result: ArtifactLoadResult = {
        exists: true,
        data: {
          schema_version: 1,
          generated_at: "2026-01-28T12:00:00Z",
          data_quality: "insufficient",
          forecasts: [
            {
              metric: "pr_cycle_time",
              unit: "hours",
              values: [],
            },
          ],
        },
      };

      const state = resolvePredictionsState(result);

      expect(state.type).toBe("no-data");
      if (state.type === "no-data") {
        expect(state.quality).toBe("insufficient");
      }
    });

    it("returns ready when all checks pass", () => {
      const result: ArtifactLoadResult = {
        exists: true,
        data: {
          schema_version: 1,
          generated_at: "2026-01-28T12:00:00Z",
          forecasts: [
            {
              metric: "pr_cycle_time",
              unit: "hours",
              horizon_weeks: 4,
              values: [
                {
                  period_start: "2026-01-28",
                  predicted: 24.5,
                  lower_bound: 20.0,
                  upper_bound: 29.0,
                },
              ],
            },
          ],
        },
      };

      const state = resolvePredictionsState(result);

      expect(state.type).toBe("ready");
      if (state.type === "ready") {
        expect(state.data).toBeDefined();
      }
    });

    it("follows first-match-wins order: existence before validity", () => {
      // Both conditions could match, but existence check comes first
      const result: ArtifactLoadResult = {
        exists: false,
        data: null,
        parseError: "This should not matter",
      };

      const state = resolvePredictionsState(result);

      expect(state.type).toBe("setup-required");
    });

    it("follows first-match-wins order: validity before fields", () => {
      const result: ArtifactLoadResult = {
        exists: true,
        data: { incomplete: "data" }, // Would fail field check
        parseError: "Syntax error", // But parse error comes first
      };

      const state = resolvePredictionsState(result);

      expect(state.type).toBe("invalid-artifact");
      if (state.type === "invalid-artifact") {
        expect(state.error).toBe("Syntax error");
      }
    });
  });

  describe("resolveInsightsState", () => {
    it("returns setup-required when file does not exist", () => {
      const result: ArtifactLoadResult = {
        exists: false,
        data: null,
      };

      const state = resolveInsightsState(result);

      expect(state.type).toBe("setup-required");
    });

    it("returns invalid-artifact when required fields are missing", () => {
      const result: ArtifactLoadResult = {
        exists: true,
        data: { some: "data" },
      };

      const state = resolveInsightsState(result);

      expect(state.type).toBe("invalid-artifact");
    });

    it("returns unsupported-schema when schema_version is too high", () => {
      const result: ArtifactLoadResult = {
        exists: true,
        data: {
          schema_version: 99,
          generated_at: "2026-01-28T12:00:00Z",
          insights: [],
        },
      };

      const state = resolveInsightsState(result);

      expect(state.type).toBe("unsupported-schema");
    });

    it("returns no-data when insights array is empty", () => {
      const result: ArtifactLoadResult = {
        exists: true,
        data: {
          schema_version: 1,
          generated_at: "2026-01-28T12:00:00Z",
          insights: [],
        },
      };

      const state = resolveInsightsState(result);

      expect(state.type).toBe("no-data");
    });

    it("returns ready when all checks pass", () => {
      const result: ArtifactLoadResult = {
        exists: true,
        data: {
          schema_version: 1,
          generated_at: "2026-01-28T12:00:00Z",
          insights: [
            {
              id: 1,
              category: "velocity",
              severity: "warning",
              title: "Test",
              description: "Test insight",
            },
          ],
        },
      };

      const state = resolveInsightsState(result);

      expect(state.type).toBe("ready");
    });
  });

  describe("getStateMessage", () => {
    it("returns correct message for setup-required", () => {
      expect(getStateMessage({ type: "setup-required" })).toBe(
        "Setup Required",
      );
    });

    it("returns correct message for no-data without quality", () => {
      expect(getStateMessage({ type: "no-data" })).toBe("No Data Available");
    });

    it("returns correct message for no-data with insufficient quality", () => {
      expect(
        getStateMessage({ type: "no-data", quality: "insufficient" }),
      ).toBe("Insufficient Data");
    });

    it("returns correct message for invalid-artifact", () => {
      const msg = getStateMessage({
        type: "invalid-artifact",
        error: "Parse error",
        path: "test.json",
      });
      expect(msg).toBe("Invalid Data Format: test.json");
    });

    it("returns correct message for unsupported-schema", () => {
      const msg = getStateMessage({
        type: "unsupported-schema",
        version: 99,
        supported: [1, 1],
      });
      expect(msg).toBe("Unsupported Schema Version 99 (supported: 1-1)");
    });

    it("returns correct message for ready", () => {
      expect(
        getStateMessage({
          type: "ready",
          data: { forecasts: [] } as any,
        }),
      ).toBe("Data Available");
    });
  });

  describe("isErrorState", () => {
    it("returns true for invalid-artifact", () => {
      expect(isErrorState({ type: "invalid-artifact", error: "test" })).toBe(
        true,
      );
    });

    it("returns true for unsupported-schema", () => {
      expect(
        isErrorState({
          type: "unsupported-schema",
          version: 99,
          supported: [1, 1],
        }),
      ).toBe(true);
    });

    it("returns false for setup-required", () => {
      expect(isErrorState({ type: "setup-required" })).toBe(false);
    });

    it("returns false for no-data", () => {
      expect(isErrorState({ type: "no-data" })).toBe(false);
    });

    it("returns false for ready", () => {
      expect(
        isErrorState({ type: "ready", data: { forecasts: [] } as any }),
      ).toBe(false);
    });
  });

  describe("isReadyState", () => {
    it("returns true for ready state", () => {
      const state = { type: "ready" as const, data: { forecasts: [] } as any };
      expect(isReadyState(state)).toBe(true);
    });

    it("returns false for non-ready states", () => {
      expect(isReadyState({ type: "setup-required" })).toBe(false);
      expect(isReadyState({ type: "no-data" })).toBe(false);
      expect(isReadyState({ type: "invalid-artifact", error: "test" })).toBe(
        false,
      );
      expect(
        isReadyState({
          type: "unsupported-schema",
          version: 99,
          supported: [1, 1],
        }),
      ).toBe(false);
    });
  });
});
