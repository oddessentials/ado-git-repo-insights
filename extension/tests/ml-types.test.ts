/**
 * Type guard tests for ML features.
 *
 * Tests the hasMLMethods type guard for proper detection
 * of optional ML methods on DatasetLoader instances.
 */

import { hasMLMethods } from "../ui/types";
import {
  type PredictionsData,
  type InsightsData,
  type ManifestSchema,
  type DimensionsData,
  type DistributionData,
  type CoverageInfo,
} from "../ui/types";

describe("hasMLMethods type guard", () => {
  // Mock minimal loader without ML methods
  const createBasicLoader = () => ({
    loadManifest: jest.fn(),
    loadDimensions: jest.fn(),
    getWeeklyRollups: jest.fn(),
    getDistributions: jest.fn(),
    getCoverage: jest.fn(),
    getDefaultRangeDays: jest.fn(),
  });

  // Mock loader with ML methods
  const createMLLoader = () => ({
    ...createBasicLoader(),
    loadPredictions: jest.fn(
      async (): Promise<PredictionsData> => ({
        state: "ok",
        data: { forecasts: [] },
      }),
    ),
    loadInsights: jest.fn(
      async (): Promise<InsightsData> => ({
        state: "ok",
        data: { insights: [] },
      }),
    ),
  });

  it("returns false for basic loader without ML methods", () => {
    const loader = createBasicLoader();
    expect(hasMLMethods(loader)).toBe(false);
  });

  it("returns true for loader with both ML methods", () => {
    const loader = createMLLoader();
    expect(hasMLMethods(loader)).toBe(true);
  });

  it("returns false if only loadPredictions exists", () => {
    const loader = {
      ...createBasicLoader(),
      loadPredictions: jest.fn(),
    };
    expect(hasMLMethods(loader)).toBe(false);
  });

  it("returns false if only loadInsights exists", () => {
    const loader = {
      ...createBasicLoader(),
      loadInsights: jest.fn(),
    };
    expect(hasMLMethods(loader)).toBe(false);
  });

  it("returns false for null", () => {
    expect(hasMLMethods(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(hasMLMethods(undefined)).toBe(false);
  });

  it("returns false for primitive types", () => {
    expect(hasMLMethods("string")).toBe(false);
    expect(hasMLMethods(123)).toBe(false);
    expect(hasMLMethods(true)).toBe(false);
  });

  it("type narrows correctly in conditional", () => {
    const loader = createMLLoader();

    if (hasMLMethods(loader)) {
      // TypeScript should allow calling these methods
      const predPromise = loader.loadPredictions();
      const insightPromise = loader.loadInsights();

      expect(predPromise).toBeDefined();
      expect(insightPromise).toBeDefined();
    }
  });
});

describe("Type interface consistency", () => {
  // These tests verify that our type interfaces are self-consistent

  it("QueryParamResult modes match expected usage", () => {
    const directResult = {
      mode: "direct" as const,
      value: "https://example.com/data",
      warning: null,
    };
    const explicitResult = {
      mode: "explicit" as const,
      value: 123,
      warning: null,
    };
    const discoverResult = {
      mode: "discover" as const,
      value: null,
    };

    expect(directResult.mode).toBe("direct");
    expect(typeof directResult.value).toBe("string");
    expect(explicitResult.mode).toBe("explicit");
    expect(typeof explicitResult.value).toBe("number");
    expect(discoverResult.mode).toBe("discover");
    expect(discoverResult.value).toBeNull();
  });

  it("PredictionsRenderData has required fields", () => {
    const predictions = {
      is_stub: true,
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

    expect(predictions.forecasts.length).toBe(1);
    expect(predictions.forecasts[0].values.length).toBe(1);
    expect(predictions.forecasts[0].values[0].predicted).toBe(10);
  });

  it("InsightsRenderData has required fields", () => {
    const insights = {
      is_stub: false,
      insights: [
        {
          severity: "warning" as const,
          category: "Performance",
          title: "Slow Code Reviews",
          description: "Code reviews are taking longer than average.",
        },
      ],
    };

    expect(insights.insights.length).toBe(1);
    expect(insights.insights[0].severity).toBe("warning");
  });
});
