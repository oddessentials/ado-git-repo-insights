/**
 * Tests for DatasetLoader nested layout resolution.
 *
 * Verifies that DatasetLoader can find dataset-manifest.json
 * in various nested artifact layouts from Azure DevOps downloads.
 */

import { DatasetLoader, DATASET_CANDIDATE_PATHS } from "../ui/dataset-loader";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("DatasetLoader Nested Layout Resolution", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // Suppress console output during tests
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("DATASET_CANDIDATE_PATHS", () => {
    it("includes only supported candidate paths in priority order", () => {
      expect(DATASET_CANDIDATE_PATHS).toContain("");
      expect(DATASET_CANDIDATE_PATHS).toContain("aggregates");
      // Deprecated paths should NOT be included
      expect(DATASET_CANDIDATE_PATHS).not.toContain("aggregates/aggregates");
      expect(DATASET_CANDIDATE_PATHS).not.toContain("dataset");
      // Root should be first (highest priority)
      expect(DATASET_CANDIDATE_PATHS[0]).toBe("");
      // Only 2 paths supported
      expect(DATASET_CANDIDATE_PATHS).toHaveLength(2);
    });
  });

  describe("resolveDatasetRoot", () => {
    it("finds manifest at root (base URL)", async () => {
      const loader = new DatasetLoader("./run_artifacts");

      // First candidate (root) returns 200
      mockFetch.mockResolvedValueOnce({ ok: true });

      const result = await loader.resolveDatasetRoot();

      expect(result).toBe("./run_artifacts");
      expect(mockFetch).toHaveBeenCalledWith(
        "./run_artifacts/dataset-manifest.json",
        { method: "HEAD" },
      );
    });

    it("finds manifest in aggregates/ subdirectory", async () => {
      const loader = new DatasetLoader("./run_artifacts");

      // Root returns 404, aggregates returns 200
      mockFetch
        .mockResolvedValueOnce({ ok: false }) // root
        .mockResolvedValueOnce({ ok: true }); // aggregates

      const result = await loader.resolveDatasetRoot();

      expect(result).toBe("./run_artifacts/aggregates");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("deprecated aggregates/aggregates layout is NOT supported", async () => {
      const loader = new DatasetLoader("./run_artifacts");

      // Root and aggregates return 404 - deprecated nested layout not probed
      mockFetch
        .mockResolvedValueOnce({ ok: false }) // root
        .mockResolvedValueOnce({ ok: false }); // aggregates

      const result = await loader.resolveDatasetRoot();

      // Should return null - deprecated path not supported
      expect(result).toBeNull();
      // Only 2 probes - aggregates/aggregates NOT probed
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("returns null when manifest not found in any candidate", async () => {
      const loader = new DatasetLoader("./run_artifacts");

      // All candidates return 404
      mockFetch.mockResolvedValue({ ok: false });

      const result = await loader.resolveDatasetRoot();

      expect(result).toBeNull();
    });

    it("handles network errors gracefully and continues probing", async () => {
      const loader = new DatasetLoader("./run_artifacts");

      // First throws error, second succeeds
      mockFetch
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({ ok: true });

      const result = await loader.resolveDatasetRoot();

      expect(result).toBe("./run_artifacts/aggregates");
    });

    it("caches result and returns same value on subsequent calls", async () => {
      const loader = new DatasetLoader("./run_artifacts");

      mockFetch.mockResolvedValueOnce({ ok: true });

      const result1 = await loader.resolveDatasetRoot();
      const result2 = await loader.resolveDatasetRoot();

      expect(result1).toBe("./run_artifacts");
      expect(result2).toBe("./run_artifacts");
      // Should only fetch once due to caching
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("works with empty base URL", async () => {
      const loader = new DatasetLoader("");

      mockFetch.mockResolvedValueOnce({ ok: true });

      const result = await loader.resolveDatasetRoot();

      expect(result).toBe("");
      expect(mockFetch).toHaveBeenCalledWith("dataset-manifest.json", {
        method: "HEAD",
      });
    });
  });

  describe("loadManifest with nested layouts", () => {
    const validManifest = {
      manifest_schema_version: 1,
      dataset_schema_version: 1,
      aggregates_schema_version: 1,
      generated_at: "2026-01-14T12:00:00Z",
      run_id: "test-run-123",
      aggregate_index: {
        weekly_rollups: [],
        distributions: [],
      },
    };

    it("auto-resolves dataset root before loading manifest", async () => {
      const loader = new DatasetLoader("./run_artifacts");

      // HEAD request for probing
      mockFetch.mockResolvedValueOnce({ ok: false }); // root
      mockFetch.mockResolvedValueOnce({ ok: true }); // aggregates

      // GET request for actual manifest
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => validManifest,
      });

      const manifest = await loader.loadManifest();

      expect(manifest).toEqual(validManifest);
      // 2 HEAD requests for probing + 1 GET request for loading
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch).toHaveBeenLastCalledWith(
        "./run_artifacts/aggregates/dataset-manifest.json",
      );
    });

    it("uses resolved effective base URL for all subsequent paths", async () => {
      const loader = new DatasetLoader("./run_artifacts");

      // Resolve to aggregates/
      mockFetch.mockResolvedValueOnce({ ok: false }); // root
      mockFetch.mockResolvedValueOnce({ ok: true }); // aggregates

      // Load manifest
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => validManifest,
      });

      await loader.loadManifest();

      // Load dimensions should use effective base URL
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          repositories: [],
          users: [],
          projects: [],
          teams: [],
        }),
      });

      await loader.loadDimensions();

      expect(mockFetch).toHaveBeenLastCalledWith(
        "./run_artifacts/aggregates/aggregates/dimensions.json",
      );
    });
  });

  describe("resolvePath with effective base URL", () => {
    it("uses effective base URL after resolution", async () => {
      const loader = new DatasetLoader("./run_artifacts");

      // Resolve to aggregates/
      mockFetch.mockResolvedValueOnce({ ok: false }); // root
      mockFetch.mockResolvedValueOnce({ ok: true }); // aggregates

      await loader.resolveDatasetRoot();

      // Access protected method via type assertion for testing
      const resolved = (loader as any).resolvePath("test.json");

      expect(resolved).toBe("./run_artifacts/aggregates/test.json");
    });

    it("falls back to base URL when resolution finds nothing", async () => {
      const loader = new DatasetLoader("./run_artifacts");

      // All candidates return 404
      mockFetch.mockResolvedValue({ ok: false });

      await loader.resolveDatasetRoot();

      const resolved = (loader as any).resolvePath("test.json");

      // Falls back to base URL when no nested layout found
      expect(resolved).toBe("./run_artifacts/test.json");
    });
  });
});
