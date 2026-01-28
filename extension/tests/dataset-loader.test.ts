/**
 * Dataset Loader Contract Tests (Phase 3.5)
 *
 * Tests for dataset loader behavior:
 * - Schema validation functions return typed results
 * - Load functions return typed state objects
 * - Functions never throw, return error states instead
 */

import { DatasetLoader } from "../ui/dataset-loader";

describe("DatasetLoader", () => {
  let loader: DatasetLoader;

  beforeEach(() => {
    loader = new DatasetLoader("http://test-api");
  });

  describe("validatePredictionsSchema", () => {
    it("returns { valid: true } for valid input", () => {
      const validPredictions = {
        schema_version: 1,
        generated_at: "2026-01-14T12:00:00Z",
        forecasts: [
          {
            metric: "pr_throughput",
            unit: "count",
            values: [
              {
                period_start: "2026-01-13",
                predicted: 25,
                lower_bound: 20,
                upper_bound: 30,
              },
            ],
          },
        ],
      };

      const result = (loader as any).validatePredictionsSchema(
        validPredictions,
      );
      expect(result).toEqual({ valid: true });
    });

    it("returns { valid: false, error } for missing data", () => {
      const result = (loader as any).validatePredictionsSchema(null as any);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("returns { valid: false, error } for missing schema_version", () => {
      const invalidPredictions = {
        generated_at: "2026-01-14T12:00:00Z",
        forecasts: [],
      };

      const result = (loader as any).validatePredictionsSchema(
        invalidPredictions as any,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("schema_version");
    });

    it("returns { valid: false, error } for unsupported schema version", () => {
      const futurePredictions = {
        schema_version: 99,
        generated_at: "2026-01-14T12:00:00Z",
        forecasts: [],
      };

      const result = (loader as any).validatePredictionsSchema(
        futurePredictions as any,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("version");
    });

    it("returns { valid: false, error } for missing forecasts array", () => {
      const invalidPredictions = {
        schema_version: 1,
        generated_at: "2026-01-14T12:00:00Z",
      };

      const result = (loader as any).validatePredictionsSchema(
        invalidPredictions as any,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("forecasts");
    });

    it("returns { valid: false, error } for invalid forecast structure", () => {
      const invalidPredictions = {
        schema_version: 1,
        generated_at: "2026-01-14T12:00:00Z",
        forecasts: [{ invalid: true }],
      };

      const result = (loader as any).validatePredictionsSchema(
        invalidPredictions as any,
      );
      expect(result.valid).toBe(false);
    });
  });

  describe("validateInsightsSchema", () => {
    it("returns { valid: true } for valid input", () => {
      const validInsights = {
        schema_version: 1,
        generated_at: "2026-01-14T12:00:00Z",
        insights: [
          {
            id: "insight-1",
            category: "bottleneck",
            severity: "warning",
            title: "Test Insight",
            description: "Test description",
            affected_entities: ["project:test"],
          },
        ],
      };

      const result = (loader as any).validateInsightsSchema(validInsights);
      expect(result).toEqual({ valid: true });
    });

    it("returns typed error object, never throws", () => {
      // Test with various invalid inputs - should never throw
      const testCases = [null, undefined, {}, { insights: "not-array" }];

      testCases.forEach((input) => {
        expect(() => {
          const result = (loader as any).validateInsightsSchema(input as any);
          expect(result.valid).toBe(false);
        }).not.toThrow();
      });
    });

    it("returns { valid: false, error } for missing schema_version", () => {
      const invalidInsights = {
        generated_at: "2026-01-14T12:00:00Z",
        insights: [],
      };

      const result = (loader as any).validateInsightsSchema(
        invalidInsights as any,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("schema_version");
    });

    it("returns { valid: false, error } for missing insights array", () => {
      const invalidInsights = {
        schema_version: 1,
        generated_at: "2026-01-14T12:00:00Z",
      };

      const result = (loader as any).validateInsightsSchema(
        invalidInsights as any,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("insights");
    });

    it("returns { valid: false, error } for invalid insight structure", () => {
      const invalidInsights = {
        schema_version: 1,
        generated_at: "2026-01-14T12:00:00Z",
        insights: [{ id: "test" }], // Missing required fields
      };

      const result = (loader as any).validateInsightsSchema(
        invalidInsights as any,
      );
      expect(result.valid).toBe(false);
    });
  });

  describe("loadPredictions state machine", () => {
    const validManifest = {
      manifest_schema_version: 1,
      dataset_schema_version: 1,
      aggregates_schema_version: 1,
      features: { predictions: true },
    };

    beforeEach(async () => {
      (loader as any).manifest = validManifest;
    });

    it('returns { state: "disabled" } when feature flag is false', async () => {
      (loader as any).manifest = {
        ...validManifest,
        features: { predictions: false },
      };

      const result = await loader.loadPredictions();
      expect(result).toEqual({ state: "disabled" });
    });

    it('returns { state: "missing" } on 404', async () => {
      (global as any).fetch = jest.fn(() => mockFetch404());

      const result = await loader.loadPredictions();
      expect(result).toEqual({ state: "missing" });
    });

    it('returns { state: "auth" } on 401', async () => {
      (global as any).fetch = jest.fn(() => mockFetch401());

      const result = await loader.loadPredictions();
      expect(result).toEqual({ state: "auth" });
    });

    it('returns { state: "auth" } on 403', async () => {
      (global as any).fetch = jest.fn(() => mockFetch403());

      const result = await loader.loadPredictions();
      expect(result).toEqual({ state: "auth" });
    });

    it('returns { state: "invalid" } on schema failure', async () => {
      const invalidData = { schema_version: 99, forecasts: [] };
      (global as any).fetch = jest.fn(() => mockFetchResponse(invalidData));

      const result = await loader.loadPredictions();
      expect(result.state).toBe("invalid");
      expect(result.error).toBe("PRED_001");
    });

    it('returns { state: "ok", data } on success', async () => {
      const validData = {
        schema_version: 1,
        generated_at: "2026-01-14T12:00:00Z",
        forecasts: [
          {
            metric: "pr_throughput",
            unit: "count",
            horizon_weeks: 4,
            values: [
              {
                period_start: "2026-01-13",
                predicted: 25,
                lower_bound: 20,
                upper_bound: 30,
              },
            ],
          },
        ],
      };
      (global as any).fetch = jest.fn(() => mockFetchResponse(validData));

      const result = await loader.loadPredictions();
      expect(result.state).toBe("ok");
      expect(result.data).toEqual(validData);
    });

    it("always returns typed state object (never null or undefined)", async () => {
      const testCases = [
        { mock: () => mockFetch404(), expectedState: "missing" },
        { mock: () => mockFetch401(), expectedState: "auth" },
        {
          mock: () => mockFetchResponse({ schema_version: 99 }),
          expectedState: "invalid",
        },
        {
          mock: () =>
            mockFetchResponse({
              schema_version: 1,
              generated_at: "2026-01-14T12:00:00Z",
              forecasts: [],
            }),
          expectedState: "ok",
        },
      ];

      for (const { mock, expectedState } of testCases) {
        (global as any).fetch = jest.fn(mock);
        const result = await loader.loadPredictions();
        expect(result).not.toBeNull();
        expect(result).not.toBeUndefined();
        expect(result.state).toBe(expectedState);
      }
    });
  });

  describe("loadInsights state machine", () => {
    const validManifest = {
      manifest_schema_version: 1,
      dataset_schema_version: 1,
      aggregates_schema_version: 1,
      features: { ai_insights: true },
    };

    beforeEach(async () => {
      (loader as any).manifest = validManifest;
    });

    it('returns { state: "disabled" } when feature flag is false', async () => {
      (loader as any).manifest = {
        ...validManifest,
        features: { ai_insights: false },
      };

      const result = await loader.loadInsights();
      expect(result).toEqual({ state: "disabled" });
    });

    it('returns { state: "missing" } on 404', async () => {
      (global as any).fetch = jest.fn(() => mockFetch404());

      const result = await loader.loadInsights();
      expect(result).toEqual({ state: "missing" });
    });

    it('returns { state: "auth" } on 401', async () => {
      (global as any).fetch = jest.fn(() => mockFetch401());

      const result = await loader.loadInsights();
      expect(result).toEqual({ state: "auth" });
    });

    it('returns { state: "invalid" } on schema failure', async () => {
      const invalidData = { schema_version: 99, insights: [] };
      (global as any).fetch = jest.fn(() => mockFetchResponse(invalidData));

      const result = await loader.loadInsights();
      expect(result.state).toBe("invalid");
      expect(result.error).toBe("AI_001");
    });

    it('returns { state: "ok", data } on success', async () => {
      const validData = {
        schema_version: 1,
        generated_at: "2026-01-14T12:00:00Z",
        insights: [
          {
            id: "insight-1",
            category: "bottleneck",
            severity: "warning",
            title: "Test",
            description: "Test description",
            affected_entities: [],
          },
        ],
      };
      (global as any).fetch = jest.fn(() => mockFetchResponse(validData));

      const result = await loader.loadInsights();
      expect(result.state).toBe("ok");
      expect(result.data).toEqual(validData);
    });
  });

  describe("isFeatureEnabled", () => {
    it("returns false when manifest is not loaded", () => {
      (loader as any).manifest = null;
      expect(loader.isFeatureEnabled("predictions")).toBe(false);
    });

    it("returns true when feature flag is true", () => {
      (loader as any).manifest = { features: { predictions: true } };
      expect(loader.isFeatureEnabled("predictions")).toBe(true);
    });

    it("returns false when feature flag is false", () => {
      (loader as any).manifest = { features: { predictions: false } };
      expect(loader.isFeatureEnabled("predictions")).toBe(false);
    });
  });
});
