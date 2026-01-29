/**
 * DatasetLoader Validation Tests
 *
 * Tests for DatasetLoader schema validation integration:
 * - Valid data passes validation
 * - Missing required fields throw SchemaValidationError
 * - Invalid types throw SchemaValidationError
 * - Cached data skips validation
 *
 * @module tests/dataset-loader-validation.test.ts
 */

import { DatasetLoader } from "../ui/dataset-loader";
import { SchemaValidationError } from "../ui/schemas/errors";

// Mock fetch responses
function createMockFetch(
  response: unknown,
  status = 200,
  ok = true,
): jest.Mock {
  return jest.fn(() =>
    Promise.resolve({
      ok,
      status,
      statusText: ok ? "OK" : "Error",
      json: () => Promise.resolve(response),
    }),
  );
}

// Helper to set effectiveBaseUrl on loader (testing protected field)
function setEffectiveBaseUrl(loader: DatasetLoader, url: string): void {
  // Use Object.defineProperty to bypass protected access
  Object.defineProperty(loader, "effectiveBaseUrl", {
    value: url,
    writable: true,
    configurable: true,
  });
}

// Valid fixtures matching production format
const validManifest = {
  manifest_schema_version: 1,
  dataset_schema_version: 1,
  aggregates_schema_version: 1,
  generated_at: "2026-01-14T12:00:00Z",
  run_id: "test-run-123",
  defaults: {
    default_date_range_days: 90,
  },
  limits: {
    max_weekly_files: 52,
    max_distribution_files: 5,
  },
  features: {
    predictions: true,
    ai_insights: false,
  },
  coverage: {
    total_prs: 100,
    date_range: {
      min: "2025-01-01",
      max: "2026-01-14",
    },
  },
  aggregate_index: {
    weekly_rollups: [
      {
        week: "2026-W03",
        path: "aggregates/weekly_rollups/2026-W03.json",
        start_date: "2026-01-13",
        end_date: "2026-01-19",
      },
    ],
    distributions: [],
  },
};

const validDimensions = {
  repositories: [
    {
      repository_id: "repo-1",
      repository_name: "main-repo",
      organization_name: "test-org",
      project_name: "test-project",
    },
  ],
  users: [{ user_id: "user-1", display_name: "Alice Developer" }],
  projects: [{ organization_name: "test-org", project_name: "test-project" }],
  teams: [],
  date_range: {
    min: "2025-01-01",
    max: "2026-01-14",
  },
};

const validRollup = {
  week: "2026-W03",
  start_date: "2026-01-13",
  end_date: "2026-01-19",
  pr_count: 42,
  cycle_time_p50: 24.5,
  cycle_time_p90: 72.0,
  authors_count: 8,
  reviewers_count: 5,
  by_repository: {
    "repo-1": { pr_count: 25, cycle_time_p50: 20.0 },
    "repo-2": { pr_count: 17, cycle_time_p50: 30.0 },
  },
  by_team: {
    "team-1": { pr_count: 30 },
    "team-2": { pr_count: 12 },
  },
};

const validPredictions = {
  schema_version: 1,
  generated_at: "2026-01-14T12:00:00Z",
  forecasts: [
    {
      metric: "pr_throughput",
      unit: "count",
      horizon_weeks: 4,
      values: [
        {
          period_start: "2026-01-20",
          predicted: 45,
          lower_bound: 38,
          upper_bound: 52,
        },
      ],
    },
  ],
};

describe("DatasetLoader Validation Integration", () => {
  let loader: DatasetLoader;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    loader = new DatasetLoader("http://test-api");
    // Set effective base URL to skip probing
    setEffectiveBaseUrl(loader, "http://test-api");
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("loadManifest validation", () => {
    it("should pass validation for valid manifest", async () => {
      global.fetch = createMockFetch(
        validManifest,
      ) as unknown as typeof global.fetch;

      const result = await loader.loadManifest();

      expect(result).toBeDefined();
      expect(result.manifest_schema_version).toBe(1);
    });

    it("should throw SchemaValidationError when manifest_schema_version is missing", async () => {
      const invalidManifest = { ...validManifest };
      delete (invalidManifest as Record<string, unknown>)
        .manifest_schema_version;
      global.fetch = createMockFetch(
        invalidManifest,
      ) as unknown as typeof global.fetch;

      await expect(loader.loadManifest()).rejects.toThrow(
        SchemaValidationError,
      );
    });

    it("should throw SchemaValidationError when manifest_schema_version is wrong type", async () => {
      const invalidManifest = {
        ...validManifest,
        manifest_schema_version: "1",
      };
      global.fetch = createMockFetch(
        invalidManifest,
      ) as unknown as typeof global.fetch;

      await expect(loader.loadManifest()).rejects.toThrow(
        SchemaValidationError,
      );
    });

    it("should throw SchemaValidationError with field information", async () => {
      const invalidManifest = { ...validManifest };
      delete (invalidManifest as Record<string, unknown>)
        .manifest_schema_version;
      global.fetch = createMockFetch(
        invalidManifest,
      ) as unknown as typeof global.fetch;

      let caught: SchemaValidationError | null = null;
      try {
        await loader.loadManifest();
      } catch (error) {
        caught = error as SchemaValidationError;
      }

      expect(caught).toBeInstanceOf(SchemaValidationError);
      expect(caught?.artifactType).toBe("manifest");
      expect(caught?.errors.length).toBeGreaterThan(0);
      expect(caught?.errors[0].field).toContain("manifest_schema_version");
    });

    it("should cache validated manifest and skip validation on subsequent calls", async () => {
      global.fetch = createMockFetch(
        validManifest,
      ) as unknown as typeof global.fetch;

      // First call - should validate
      const result1 = await loader.loadManifest();

      // Set fetch to return invalid data (should not be called)
      const invalidManifest = {};
      global.fetch = createMockFetch(
        invalidManifest,
      ) as unknown as typeof global.fetch;

      // Second call - should return cached, not re-fetch
      const result2 = await loader.loadManifest();

      expect(result2).toBe(result1);
    });
  });

  describe("loadDimensions validation", () => {
    beforeEach(async () => {
      // Load manifest first (required)
      global.fetch = createMockFetch(
        validManifest,
      ) as unknown as typeof global.fetch;
      await loader.loadManifest();
    });

    it("should pass validation for valid dimensions", async () => {
      global.fetch = createMockFetch(
        validDimensions,
      ) as unknown as typeof global.fetch;

      const result = await loader.loadDimensions();

      expect(result).toBeDefined();
      expect(result?.repositories).toHaveLength(1);
    });

    it("should throw SchemaValidationError when repositories is missing", async () => {
      const invalidDimensions = { users: [], projects: [] };
      global.fetch = createMockFetch(
        invalidDimensions,
      ) as unknown as typeof global.fetch;

      await expect(loader.loadDimensions()).rejects.toThrow(
        SchemaValidationError,
      );
    });

    it("should throw SchemaValidationError when repository item is invalid", async () => {
      const invalidDimensions = {
        repositories: [{ invalid: "data" }],
        users: [],
        projects: [],
      };
      global.fetch = createMockFetch(
        invalidDimensions,
      ) as unknown as typeof global.fetch;

      await expect(loader.loadDimensions()).rejects.toThrow(
        SchemaValidationError,
      );
    });

    it("should include field path in error for nested validation failures", async () => {
      const invalidDimensions = {
        repositories: [{ repository_id: 123, repository_name: "test" }], // id should be string
        users: [],
        projects: [],
      };
      global.fetch = createMockFetch(
        invalidDimensions,
      ) as unknown as typeof global.fetch;

      let caught: SchemaValidationError | null = null;
      try {
        await loader.loadDimensions();
      } catch (error) {
        caught = error as SchemaValidationError;
      }

      expect(caught).toBeInstanceOf(SchemaValidationError);
      expect(caught?.artifactType).toBe("dimensions");
      expect(caught?.errors.some((e) => e.field.includes("repository"))).toBe(
        true,
      );
    });

    it("should cache validated dimensions and skip validation on subsequent calls", async () => {
      global.fetch = createMockFetch(
        validDimensions,
      ) as unknown as typeof global.fetch;

      // First call - should validate
      const result1 = await loader.loadDimensions();

      // Set fetch to return invalid data
      global.fetch = createMockFetch({}) as unknown as typeof global.fetch;

      // Second call - should return cached
      const result2 = await loader.loadDimensions();

      expect(result2).toBe(result1);
    });
  });

  describe("rollup validation", () => {
    beforeEach(async () => {
      // Load manifest first
      global.fetch = createMockFetch(
        validManifest,
      ) as unknown as typeof global.fetch;
      await loader.loadManifest();
    });

    it("should pass validation for valid rollup", async () => {
      global.fetch = createMockFetch(
        validRollup,
      ) as unknown as typeof global.fetch;

      const result = await loader.getWeeklyRollups(
        new Date("2026-01-13"),
        new Date("2026-01-19"),
      );

      expect(result).toHaveLength(1);
      expect(result[0].week).toBe("2026-W03");
    });

    it("should throw SchemaValidationError when week is missing", async () => {
      const invalidRollup = { ...validRollup };
      delete (invalidRollup as Record<string, unknown>).week;
      global.fetch = createMockFetch(
        invalidRollup,
      ) as unknown as typeof global.fetch;

      await expect(
        loader.getWeeklyRollups(new Date("2026-01-13"), new Date("2026-01-19")),
      ).rejects.toThrow(SchemaValidationError);
    });

    it("should throw SchemaValidationError when week format is invalid", async () => {
      const invalidRollup = { ...validRollup, week: "2026-03" }; // Invalid format
      global.fetch = createMockFetch(
        invalidRollup,
      ) as unknown as typeof global.fetch;

      await expect(
        loader.getWeeklyRollups(new Date("2026-01-13"), new Date("2026-01-19")),
      ).rejects.toThrow(SchemaValidationError);
    });

    it("should cache validated rollups and skip validation on subsequent calls", async () => {
      // First fetch returns valid rollup
      let fetchCount = 0;
      global.fetch = jest.fn(() => {
        fetchCount++;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(validRollup),
        });
      }) as unknown as typeof global.fetch;

      // First call - should fetch and validate
      const result1 = await loader.getWeeklyRollups(
        new Date("2026-01-13"),
        new Date("2026-01-19"),
      );

      // Second call for same range - should use cache
      const result2 = await loader.getWeeklyRollups(
        new Date("2026-01-13"),
        new Date("2026-01-19"),
      );

      // Both calls should return same data
      expect(result1[0].week).toBe(result2[0].week);
      // Fetch should only be called once
      expect(fetchCount).toBe(1);
    });

    it("should warn on unknown fields in permissive mode", async () => {
      const rollupWithExtra = { ...validRollup, unknown_field: "extra" };
      global.fetch = createMockFetch(
        rollupWithExtra,
      ) as unknown as typeof global.fetch;

      // In permissive mode, should warn but not throw
      const consoleSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const result = await loader.getWeeklyRollups(
        new Date("2026-01-13"),
        new Date("2026-01-19"),
      );

      expect(result).toHaveLength(1);
      // Verify warning was logged
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("loadPredictions validation", () => {
    beforeEach(async () => {
      // Load manifest with predictions enabled
      global.fetch = createMockFetch(
        validManifest,
      ) as unknown as typeof global.fetch;
      await loader.loadManifest();
    });

    it("should pass validation for valid predictions", async () => {
      global.fetch = createMockFetch(
        validPredictions,
      ) as unknown as typeof global.fetch;

      const result = await loader.loadPredictions();

      expect(result.state).toBe("ok");
    });

    it("should return invalid state when schema_version is wrong type", async () => {
      const invalidPredictions = { ...validPredictions, schema_version: "1" };
      global.fetch = createMockFetch(
        invalidPredictions,
      ) as unknown as typeof global.fetch;

      const result = await loader.loadPredictions();

      expect(result.state).toBe("invalid");
    });

    it("should return invalid state when forecasts is missing", async () => {
      const invalidPredictions = {
        schema_version: 1,
        generated_at: "2026-01-14T12:00:00Z",
      };
      global.fetch = createMockFetch(
        invalidPredictions,
      ) as unknown as typeof global.fetch;

      const result = await loader.loadPredictions();

      expect(result.state).toBe("invalid");
    });

    it("should return disabled state when feature flag is false", async () => {
      // Create fresh loader with disabled predictions
      const disabledLoader = new DatasetLoader("http://test-api");
      setEffectiveBaseUrl(disabledLoader, "http://test-api");

      const manifestDisabled = {
        ...validManifest,
        features: { predictions: false },
      };
      global.fetch = createMockFetch(
        manifestDisabled,
      ) as unknown as typeof global.fetch;
      await disabledLoader.loadManifest();

      const result = await disabledLoader.loadPredictions();

      expect(result.state).toBe("disabled");
    });

    it("should return missing state on 404", async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
        }),
      ) as unknown as typeof global.fetch;

      const result = await loader.loadPredictions();

      expect(result.state).toBe("missing");
    });

    it("should warn on unknown fields and still return valid", async () => {
      const predictionsWithExtra = {
        ...validPredictions,
        unknown_field: "extra",
      };
      global.fetch = createMockFetch(
        predictionsWithExtra,
      ) as unknown as typeof global.fetch;

      const consoleSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const result = await loader.loadPredictions();

      expect(result.state).toBe("ok");
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("validation error details", () => {
    beforeEach(async () => {
      global.fetch = createMockFetch(
        validManifest,
      ) as unknown as typeof global.fetch;
      await loader.loadManifest();
    });

    it("should provide detailed error messages for multiple validation failures", async () => {
      const invalidDimensions = {
        repositories: [
          { repository_id: 123 }, // Wrong type
          { repository_name: "test" }, // Missing id
        ],
        users: [{ display_name: "Test" }], // Missing user_id
        projects: [], // Valid but empty
      };
      global.fetch = createMockFetch(
        invalidDimensions,
      ) as unknown as typeof global.fetch;

      let caught: SchemaValidationError | null = null;
      try {
        await loader.loadDimensions();
      } catch (error) {
        caught = error as SchemaValidationError;
      }

      expect(caught).toBeInstanceOf(SchemaValidationError);

      // Should have multiple errors
      expect(caught?.errors.length).toBeGreaterThanOrEqual(3);

      // Each error should have required fields
      for (const err of caught?.errors ?? []) {
        expect(err.field).toBeDefined();
        expect(err.expected).toBeDefined();
        expect(err.actual).toBeDefined();
        expect(err.message).toBeDefined();
      }

      // getDetailedMessage should include all errors
      const detailed = caught?.getDetailedMessage();
      expect(detailed).toContain("dimensions");
    });
  });
});
