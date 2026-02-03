/**
 * Tests for ArtifactClient and AuthenticatedDatasetLoader.
 *
 * Validates:
 * - ArtifactClient initialization and authentication
 * - Error handling for 401, 403, 404 responses
 * - URL building for artifact API
 * - AuthenticatedDatasetLoader manifest validation and caching
 */

import {
  ArtifactClient,
  AuthenticatedDatasetLoader,
  MockArtifactClient,
} from "../ui/artifact-client";
import type { ManifestSchema, VSSBuildArtifact } from "../ui/types";

// Mock VSS SDK globally
declare const VSS: {
  getWebContext: () => { collection: { uri: string }; project: { id: string } };
  getAccessToken: () => Promise<string | { token: string }>;
};

describe("ArtifactClient", () => {
  let mockFetch: jest.Mock;
  let originalVSS: typeof VSS | undefined;
  let originalVSSWasUndefined: boolean;

  beforeEach(() => {
    // Setup mock fetch
    mockFetch = jest.fn();
    (global as any).fetch = mockFetch;

    // Setup mock VSS SDK
    originalVSS = (global as any).VSS;
    originalVSSWasUndefined = typeof originalVSS === "undefined";
    (global as any).VSS = {
      getWebContext: () => ({
        collection: { uri: "https://dev.azure.com/testorg/" },
        project: { id: "test-project-id" },
      }),
      getAccessToken: () => Promise.resolve({ token: "mock-token-12345" }),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalVSSWasUndefined) {
      delete (global as any).VSS;
    } else {
      (global as any).VSS = originalVSS;
    }
  });

  describe("initialization", () => {
    it("creates client with projectId", () => {
      const client = new ArtifactClient("test-project");
      expect(client.projectId).toBe("test-project");
    });

    it("is not initialized before calling initialize()", async () => {
      const client = new ArtifactClient("test-project");

      // Calling a method before initialization should throw
      await expect(
        client.getArtifacts(123),
      ).rejects.toThrow("ArtifactClient not initialized");
    });

    it("sets auth token and collection URI on initialize()", async () => {
      const client = new ArtifactClient("test-project");
      const result = await client.initialize();

      expect(result).toBe(client); // Returns this for chaining
    });

    it("handles string token format", async () => {
      (global as any).VSS.getAccessToken = () => Promise.resolve("string-token");

      const client = new ArtifactClient("test-project");
      await client.initialize();

      // Should not throw - string token is handled
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ value: [] }),
      });

      await client.getArtifacts(123);

      expect(mockFetch).toHaveBeenCalled();
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe("Bearer string-token");
    });

    it("only initializes once (idempotent)", async () => {
      const client = new ArtifactClient("test-project");
      const accessTokenSpy = jest.spyOn(
        (global as any).VSS,
        "getAccessToken",
      );

      await client.initialize();
      await client.initialize();
      await client.initialize();

      expect(accessTokenSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("getArtifactFile", () => {
    it("throws if not initialized", async () => {
      const client = new ArtifactClient("test-project");

      await expect(
        client.getArtifactFile(123, "aggregates", "manifest.json"),
      ).rejects.toThrow("not initialized");
    });

    it("includes bearer token in request", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize();

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: "test" }),
      });

      await client.getArtifactFile(123, "aggregates", "manifest.json");

      expect(mockFetch).toHaveBeenCalled();
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe("Bearer mock-token-12345");
    });

    it("throws PermissionDeniedError on 401", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      await expect(
        client.getArtifactFile(123, "aggregates", "manifest.json"),
      ).rejects.toThrow("permission");
    });

    it("throws PermissionDeniedError on 403", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });

      await expect(
        client.getArtifactFile(123, "aggregates", "manifest.json"),
      ).rejects.toThrow("permission");
    });

    it("throws file not found error on 404", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(
        client.getArtifactFile(123, "aggregates", "missing.json"),
      ).rejects.toThrow("not found");
    });

    it("throws generic error on other status codes", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(
        client.getArtifactFile(123, "aggregates", "manifest.json"),
      ).rejects.toThrow("Failed to fetch artifact file");
    });

    it("returns parsed JSON on success", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize();

      const testData = { manifest_schema_version: 1, data: "test" };
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(testData),
      });

      const result = await client.getArtifactFile(123, "aggregates", "manifest.json");

      expect(result).toEqual(testData);
    });

    it("normalizes file path with leading slash", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize();

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      await client.getArtifactFile(123, "aggregates", "manifest.json");

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain(encodeURIComponent("/manifest.json"));
    });
  });

  describe("hasArtifactFile", () => {
    it("returns true when file exists", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize();

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
      });

      const result = await client.hasArtifactFile(123, "aggregates", "manifest.json");

      expect(result).toBe(true);
    });

    it("returns false when file does not exist", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await client.hasArtifactFile(123, "aggregates", "missing.json");

      expect(result).toBe(false);
    });

    it("returns false on fetch error", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize();

      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await client.hasArtifactFile(123, "aggregates", "manifest.json");

      expect(result).toBe(false);
    });

    it("uses HEAD method", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize();

      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      await client.hasArtifactFile(123, "aggregates", "manifest.json");

      expect(mockFetch.mock.calls[0][1].method).toBe("HEAD");
    });
  });

  describe("getArtifacts", () => {
    it("returns list of artifacts for build", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize();

      const artifacts: VSSBuildArtifact[] = [
        { name: "aggregates", resource: { downloadUrl: "https://test/download" } },
        { name: "logs", resource: { downloadUrl: "https://test/logs" } },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ value: artifacts }),
      });

      const result = await client.getArtifacts(123);

      expect(result).toEqual(artifacts);
    });

    it("returns empty array when no artifacts", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize();

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}), // No "value" property
      });

      const result = await client.getArtifacts(123);

      expect(result).toEqual([]);
    });

    it("throws on permission denied", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });

      await expect(client.getArtifacts(123)).rejects.toThrow("permission");
    });

    it("builds correct API URL", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize();

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ value: [] }),
      });

      await client.getArtifacts(456);

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain("test-project/_apis/build/builds/456/artifacts");
      expect(url).toContain("api-version=7.1");
    });
  });

  describe("authenticatedFetch", () => {
    it("includes auth header", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize();

      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      await client.authenticatedFetch("https://example.com/api");

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe("Bearer mock-token-12345");
    });

    it("throws if not initialized", async () => {
      const client = new ArtifactClient("test-project");

      await expect(
        client.authenticatedFetch("https://example.com/api"),
      ).rejects.toThrow("not initialized");
    });

    it("passes through request options", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize();

      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      await client.authenticatedFetch("https://example.com/api", {
        method: "POST",
        headers: { "X-Custom": "value" },
      });

      const options = mockFetch.mock.calls[0][1];
      expect(options.method).toBe("POST");
      expect(options.headers["X-Custom"]).toBe("value");
    });
  });

  describe("createDatasetLoader", () => {
    it("returns AuthenticatedDatasetLoader instance", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize();

      const loader = client.createDatasetLoader(123, "aggregates");

      expect(loader).toBeInstanceOf(AuthenticatedDatasetLoader);
    });
  });

  describe("VSS isolation", () => {
    it("does not allow VSS state to leak between tests", () => {
      (global as any).VSS.leakyKey = "leak";
      expect((global as any).VSS.leakyKey).toBe("leak");
    });

    it("restores VSS to a clean state", () => {
      expect((global as any).VSS.leakyKey).toBeUndefined();
    });
  });
});

// Extended MockArtifactClient with getArtifactFileViaSdk
class TestMockArtifactClient extends MockArtifactClient {
  async getArtifactFileViaSdk(
    buildId: number,
    artifactName: string,
    filePath: string,
  ): Promise<unknown> {
    return this.getArtifactFile(buildId, artifactName, filePath);
  }

  async getArtifactMetadata(): Promise<VSSBuildArtifact | null> {
    return {
      name: "aggregates",
      resource: { downloadUrl: "https://test/download?format=zip" },
    };
  }
}

describe("AuthenticatedDatasetLoader", () => {
  describe("loadManifest", () => {
    it("loads and validates manifest", async () => {
      const manifest: ManifestSchema = {
        manifest_schema_version: 1,
        dataset_schema_version: 1,
        aggregates_schema_version: 1,
        aggregate_index: {
          weekly_rollups: [],
          distributions: [],
        },
      };

      const mockData: Record<string, unknown> = {
        "123/aggregates/dataset-manifest.json": manifest,
      };
      const mockClient = new TestMockArtifactClient(mockData);

      const loader = new AuthenticatedDatasetLoader(
        mockClient as unknown as ArtifactClient,
        123,
        "aggregates",
      );

      const result = await loader.loadManifest();

      expect(result.manifest_schema_version).toBe(1);
    });

    it("throws on empty manifest", async () => {
      const mockClient = new TestMockArtifactClient({});

      // Override to return null
      mockClient.getArtifactFileViaSdk = jest.fn().mockResolvedValue(null);

      const loader = new AuthenticatedDatasetLoader(
        mockClient as unknown as ArtifactClient,
        123,
        "aggregates",
      );

      await expect(loader.loadManifest()).rejects.toThrow("empty or invalid");
    });

    it("wraps errors with context", async () => {
      const mockClient = new TestMockArtifactClient({});

      // Override to throw
      mockClient.getArtifactFileViaSdk = jest
        .fn()
        .mockRejectedValue(new Error("Network failure"));

      const loader = new AuthenticatedDatasetLoader(
        mockClient as unknown as ArtifactClient,
        123,
        "aggregates",
      );

      await expect(loader.loadManifest()).rejects.toThrow(
        "Failed to load dataset manifest",
      );
    });
  });

  describe("validateManifest", () => {
    it("throws on missing schema version", () => {
      const mockClient = new TestMockArtifactClient({});
      const loader = new AuthenticatedDatasetLoader(
        mockClient as unknown as ArtifactClient,
        123,
        "aggregates",
      );

      const invalidManifest = {} as ManifestSchema;

      expect(() => loader.validateManifest(invalidManifest)).toThrow(
        "missing schema version",
      );
    });

    it("throws on unsupported manifest version", () => {
      const mockClient = new TestMockArtifactClient({});
      const loader = new AuthenticatedDatasetLoader(
        mockClient as unknown as ArtifactClient,
        123,
        "aggregates",
      );

      const futureManifest: ManifestSchema = {
        manifest_schema_version: 999,
      };

      expect(() => loader.validateManifest(futureManifest)).toThrow(
        "version 999 not supported",
      );
    });

    it("throws on unsupported dataset version", () => {
      const mockClient = new TestMockArtifactClient({});
      const loader = new AuthenticatedDatasetLoader(
        mockClient as unknown as ArtifactClient,
        123,
        "aggregates",
      );

      const manifest: ManifestSchema = {
        manifest_schema_version: 1,
        dataset_schema_version: 999,
      };

      expect(() => loader.validateManifest(manifest)).toThrow(
        "Dataset version 999 not supported",
      );
    });

    it("throws on unsupported aggregates version", () => {
      const mockClient = new TestMockArtifactClient({});
      const loader = new AuthenticatedDatasetLoader(
        mockClient as unknown as ArtifactClient,
        123,
        "aggregates",
      );

      const manifest: ManifestSchema = {
        manifest_schema_version: 1,
        aggregates_schema_version: 999,
      };

      expect(() => loader.validateManifest(manifest)).toThrow(
        "Aggregates version 999 not supported",
      );
    });

    it("accepts valid manifest versions", () => {
      const mockClient = new TestMockArtifactClient({});
      const loader = new AuthenticatedDatasetLoader(
        mockClient as unknown as ArtifactClient,
        123,
        "aggregates",
      );

      const validManifest: ManifestSchema = {
        manifest_schema_version: 1,
        dataset_schema_version: 1,
        aggregates_schema_version: 1,
      };

      expect(() => loader.validateManifest(validManifest)).not.toThrow();
    });
  });

  describe("getWeeklyRollups", () => {
    it("throws if manifest not loaded", async () => {
      const mockClient = new TestMockArtifactClient({});
      const loader = new AuthenticatedDatasetLoader(
        mockClient as unknown as ArtifactClient,
        123,
        "aggregates",
      );

      await expect(
        loader.getWeeklyRollups(new Date("2026-01-01"), new Date("2026-01-31")),
      ).rejects.toThrow("Manifest not loaded");
    });

    it("uses rollup cache for repeated requests", async () => {
      const manifest: ManifestSchema = {
        manifest_schema_version: 1,
        aggregate_index: {
          weekly_rollups: [
            { week: "2026-W01", path: "aggregates/weekly_rollups/2026-W01.json" },
          ],
        },
      };

      const rollup = { week: "2026-W01", pr_count: 10 };

      const mockClient = new TestMockArtifactClient({});
      const getArtifactSpy = jest
        .fn()
        .mockResolvedValueOnce(manifest)
        .mockResolvedValue(rollup);
      mockClient.getArtifactFileViaSdk = getArtifactSpy;

      const loader = new AuthenticatedDatasetLoader(
        mockClient as unknown as ArtifactClient,
        123,
        "aggregates",
      );

      await loader.loadManifest();

      // First call
      await loader.getWeeklyRollups(new Date("2026-01-01"), new Date("2026-01-07"));
      const callCountAfterFirst = getArtifactSpy.mock.calls.length;

      // Second call should use cache
      await loader.getWeeklyRollups(new Date("2026-01-01"), new Date("2026-01-07"));

      // Should not have made additional API calls for the same week
      expect(getArtifactSpy.mock.calls.length).toBe(callCountAfterFirst);
    });
  });

  describe("loadPredictions", () => {
    it("returns unavailable state when no predictions in manifest", async () => {
      const manifest: ManifestSchema = {
        manifest_schema_version: 1,
        aggregate_index: {},
      };

      const mockClient = new TestMockArtifactClient({});
      mockClient.getArtifactFileViaSdk = jest.fn().mockResolvedValue(manifest);

      const loader = new AuthenticatedDatasetLoader(
        mockClient as unknown as ArtifactClient,
        123,
        "aggregates",
      );

      await loader.loadManifest();
      const result = await loader.loadPredictions();

      expect(result.state).toBe("unavailable");
    });

    it("returns ok state with data when predictions available", async () => {
      const manifest: ManifestSchema = {
        manifest_schema_version: 1,
        aggregate_index: {
          predictions: { path: "predictions/trends.json" },
        },
      };

      const predictionsData = { forecasts: [] };

      const mockClient = new TestMockArtifactClient({});
      mockClient.getArtifactFileViaSdk = jest
        .fn()
        .mockResolvedValueOnce(manifest)
        .mockResolvedValueOnce(predictionsData);

      const loader = new AuthenticatedDatasetLoader(
        mockClient as unknown as ArtifactClient,
        123,
        "aggregates",
      );

      await loader.loadManifest();
      const result = await loader.loadPredictions();

      expect(result.state).toBe("ok");
      expect(result.data).toEqual(predictionsData);
    });

    it("returns unavailable state on fetch error", async () => {
      const manifest: ManifestSchema = {
        manifest_schema_version: 1,
        aggregate_index: {
          predictions: { path: "predictions/trends.json" },
        },
      };

      const mockClient = new TestMockArtifactClient({});
      mockClient.getArtifactFileViaSdk = jest
        .fn()
        .mockResolvedValueOnce(manifest)
        .mockRejectedValueOnce(new Error("Network error"));

      const loader = new AuthenticatedDatasetLoader(
        mockClient as unknown as ArtifactClient,
        123,
        "aggregates",
      );

      await loader.loadManifest();
      const result = await loader.loadPredictions();

      expect(result.state).toBe("unavailable");
    });
  });

  describe("date range helpers", () => {
    it("getWeeksInRange returns correct week strings", () => {
      const mockClient = new TestMockArtifactClient({});
      const loader = new AuthenticatedDatasetLoader(
        mockClient as unknown as ArtifactClient,
        123,
        "aggregates",
      );

      const weeks = loader.getWeeksInRange(
        new Date("2026-01-06"), // Monday
        new Date("2026-01-19"), // Sunday of week 3
      );

      expect(weeks).toContain("2026-W02");
      expect(weeks).toContain("2026-W03");
    });

    it("getISOWeek returns correct format", () => {
      const mockClient = new TestMockArtifactClient({});
      const loader = new AuthenticatedDatasetLoader(
        mockClient as unknown as ArtifactClient,
        123,
        "aggregates",
      );

      const week = loader.getISOWeek(new Date("2026-01-15"));

      expect(week).toMatch(/^\d{4}-W\d{2}$/);
    });
  });

  describe("getCoverage", () => {
    it("returns null when manifest not loaded", () => {
      const mockClient = new TestMockArtifactClient({});
      const loader = new AuthenticatedDatasetLoader(
        mockClient as unknown as ArtifactClient,
        123,
        "aggregates",
      );

      expect(loader.getCoverage()).toBeNull();
    });

    it("returns coverage info from manifest", async () => {
      const manifest: ManifestSchema = {
        manifest_schema_version: 1,
        coverage: {
          first_week: "2025-W01",
          last_week: "2026-W01",
          total_weeks: 52,
        },
      };

      const mockClient = new TestMockArtifactClient({});
      mockClient.getArtifactFileViaSdk = jest.fn().mockResolvedValue(manifest);

      const loader = new AuthenticatedDatasetLoader(
        mockClient as unknown as ArtifactClient,
        123,
        "aggregates",
      );

      await loader.loadManifest();

      const coverage = loader.getCoverage();
      expect(coverage?.first_week).toBe("2025-W01");
      expect(coverage?.total_weeks).toBe(52);
    });
  });

  describe("getDefaultRangeDays", () => {
    it("returns 90 as default when manifest has no defaults", async () => {
      const manifest: ManifestSchema = {
        manifest_schema_version: 1,
      };

      const mockClient = new TestMockArtifactClient({});
      mockClient.getArtifactFileViaSdk = jest.fn().mockResolvedValue(manifest);

      const loader = new AuthenticatedDatasetLoader(
        mockClient as unknown as ArtifactClient,
        123,
        "aggregates",
      );

      await loader.loadManifest();

      expect(loader.getDefaultRangeDays()).toBe(90);
    });

    it("returns configured default from manifest", async () => {
      const manifest: ManifestSchema = {
        manifest_schema_version: 1,
        defaults: {
          default_date_range_days: 180,
        },
      };

      const mockClient = new TestMockArtifactClient({});
      mockClient.getArtifactFileViaSdk = jest.fn().mockResolvedValue(manifest);

      const loader = new AuthenticatedDatasetLoader(
        mockClient as unknown as ArtifactClient,
        123,
        "aggregates",
      );

      await loader.loadManifest();

      expect(loader.getDefaultRangeDays()).toBe(180);
    });
  });
});

describe("MockArtifactClient", () => {
  it("returns mock data for matching keys", async () => {
    const mockData = {
      "123/aggregates/test.json": { value: "test" },
    };
    const client = new MockArtifactClient(mockData);

    const result = await client.getArtifactFile(123, "aggregates", "test.json");

    expect(result).toEqual({ value: "test" });
  });

  it("throws for missing keys", async () => {
    const client = new MockArtifactClient({});

    await expect(
      client.getArtifactFile(123, "aggregates", "missing.json"),
    ).rejects.toThrow("Mock: File not found");
  });

  it("returns deep copy of data (no mutation)", async () => {
    const mockData = {
      "123/aggregates/test.json": { nested: { value: 1 } },
    };
    const client = new MockArtifactClient(mockData);

    const result1 = await client.getArtifactFile(123, "aggregates", "test.json");
    const result2 = await client.getArtifactFile(123, "aggregates", "test.json");

    expect(result1).toEqual(result2);
    expect(result1).not.toBe(result2); // Different object references
  });

  it("hasArtifactFile returns true for existing files", async () => {
    const mockData = {
      "123/aggregates/exists.json": {},
    };
    const client = new MockArtifactClient(mockData);

    expect(await client.hasArtifactFile(123, "aggregates", "exists.json")).toBe(true);
    expect(await client.hasArtifactFile(123, "aggregates", "missing.json")).toBe(false);
  });

  it("is initialized by default", () => {
    const client = new MockArtifactClient({});
    expect(client.initialized).toBe(true);
  });
});
