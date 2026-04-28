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
import {
  setupSdkMocks,
  teardownSdkMocks,
  mockSdkModule,
} from "./harness/vss-sdk-mock";

// Test credentials for ArtifactClient.initialize()
const TEST_COLLECTION_URI = "https://dev.azure.com/test-org/";
const TEST_AUTH_TOKEN = "mock-access-token-12345";
const TEST_TOKEN_PROVIDER = (): Promise<string> =>
  Promise.resolve(TEST_AUTH_TOKEN);

describe("ArtifactClient", () => {
  let mockFetch: jest.Mock;
  const globalScope = global as unknown as {
    fetch: jest.Mock;
  };

  beforeEach(() => {
    // Setup mock fetch — returns success by default so API version
    // fallback resolves on the first real call.
    mockFetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ value: [] }),
      }),
    );
    globalScope.fetch = mockFetch;

    // Setup SDK mocks (replaces old global.VSS pattern)
    setupSdkMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    teardownSdkMocks();
  });

  describe("initialization", () => {
    it("creates client with projectId", () => {
      const client = new ArtifactClient("test-project");
      expect(client.projectId).toBe("test-project");
    });

    it("is not initialized before calling initialize()", async () => {
      const client = new ArtifactClient("test-project");

      // Calling a method before initialization should throw
      await expect(client.getArtifacts(123)).rejects.toThrow(
        "ArtifactClient not initialized",
      );
    });

    it("sets auth token and collection URI on initialize()", async () => {
      const client = new ArtifactClient("test-project");
      const result = await client.initialize(
        TEST_COLLECTION_URI,
        TEST_TOKEN_PROVIDER,
      );

      expect(result).toBe(client); // Returns this for chaining
    });

    it("uses the SDK access token as a plain string", async () => {
      // The new SDK returns a plain string token (not { token: string })
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      // Should not throw - string token is handled
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ value: [] }),
      });

      await client.getArtifacts(123);

      expect(mockFetch).toHaveBeenCalled();
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe("Bearer mock-access-token-12345");
    });

    it("only initializes once (idempotent)", async () => {
      const client = new ArtifactClient("test-project");
      const otherProvider = (): Promise<string> =>
        Promise.resolve("other-token");

      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);
      await client.initialize("https://other.com/", otherProvider);

      // First values are preserved — second call is a no-op
      expect(
        (client as unknown as { tokenProvider: (() => Promise<string>) | null })
          .tokenProvider,
      ).toBe(TEST_TOKEN_PROVIDER);
      expect(
        (client as unknown as { collectionUri?: string }).collectionUri,
      ).toBe(TEST_COLLECTION_URI);
    });
  });

  describe("token provider per-request resolution", () => {
    it("calls token provider on each request", async () => {
      const provider = jest
        .fn<Promise<string>, []>()
        .mockResolvedValue(TEST_AUTH_TOKEN);
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, provider);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ value: [] }),
      });

      await client.getDefinitions();
      await client.getBuilds(1);
      await client.getArtifacts(1);

      // Provider called once per request (3 total)
      expect(provider).toHaveBeenCalledTimes(3);
    });

    it("resolves fresh token on cached-version fast path", async () => {
      let callCount = 0;
      const provider = jest.fn<Promise<string>, []>(() =>
        Promise.resolve(`token-${++callCount}`),
      );
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, provider);

      // First call: version resolution path (slow path → caches version)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ value: [] }),
      });
      await client.getDefinitions();

      // Second call: cached-version fast path
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ value: [] }),
      });
      await client.getDefinitions();

      // Provider called both times — fast path still resolves fresh token
      expect(provider).toHaveBeenCalledTimes(2);

      // Verify different tokens were used in the Authorization headers
      const headers1 = mockFetch.mock.calls[0]![1].headers as Record<
        string,
        string
      >;
      const headers2 = mockFetch.mock.calls[1]![1].headers as Record<
        string,
        string
      >;
      expect(headers1.Authorization).toBe("Bearer token-1");
      expect(headers2.Authorization).toBe("Bearer token-2");
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
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: "test" }),
      });

      await client.getArtifactFile(123, "aggregates", "manifest.json");

      expect(mockFetch).toHaveBeenCalled();
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe("Bearer mock-access-token-12345");
    });

    it("throws PermissionDeniedError on 401", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

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
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

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
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

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
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

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
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      const testData = { manifest_schema_version: 1, data: "test" };
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(testData),
      });

      const result = await client.getArtifactFile(
        123,
        "aggregates",
        "manifest.json",
      );

      expect(result).toEqual(testData);
    });

    it("normalizes file path with leading slash", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

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
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
      });

      const result = await client.hasArtifactFile(
        123,
        "aggregates",
        "manifest.json",
      );

      expect(result).toBe(true);
    });

    it("returns false when file does not exist", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await client.hasArtifactFile(
        123,
        "aggregates",
        "missing.json",
      );

      expect(result).toBe(false);
    });

    it("returns false on fetch error", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await client.hasArtifactFile(
        123,
        "aggregates",
        "manifest.json",
      );

      expect(result).toBe(false);
    });

    it("uses HEAD method", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      await client.hasArtifactFile(123, "aggregates", "manifest.json");

      expect(mockFetch.mock.calls[0][1].method).toBe("HEAD");
    });
  });

  describe("getArtifacts", () => {
    it("returns list of artifacts for build", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      const artifacts: VSSBuildArtifact[] = [
        {
          name: "aggregates",
          resource: { downloadUrl: "https://test/download" },
        },
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
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

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
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });

      await expect(client.getArtifacts(123)).rejects.toThrow("permission");
    });

    it("builds correct API URL", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

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

  describe("getDefinitions", () => {
    it("returns list of definitions for project", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      const definitions = [
        { id: 1, name: "pipeline-a" },
        { id: 2, name: "pipeline-b" },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ value: definitions }),
      });

      const result = await client.getDefinitions();

      expect(result).toEqual(definitions);
    });

    it("returns empty array when no definitions", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      const result = await client.getDefinitions();

      expect(result).toEqual([]);
    });

    it("builds correct API URL with default params", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ value: [] }),
      });

      await client.getDefinitions();

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain("test-project/_apis/build/definitions");
      expect(url).toContain("api-version=7.1");
      expect(url).toContain("$top=50");
      expect(url).toContain("queryOrder=2");
    });

    it("uses custom top and queryOrder params", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ value: [] }),
      });

      await client.getDefinitions(10, 1);

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain("$top=10");
      expect(url).toContain("queryOrder=1");
    });

    it("throws on permission denied (401)", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      await expect(client.getDefinitions()).rejects.toThrow("permission");
    });

    it("throws on permission denied (403)", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });

      await expect(client.getDefinitions()).rejects.toThrow("permission");
    });

    it("throws generic error on server error", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(client.getDefinitions()).rejects.toThrow(
        "Failed to list definitions: 500",
      );
    });

    it("throws if not initialized", async () => {
      const client = new ArtifactClient("test-project");

      await expect(client.getDefinitions()).rejects.toThrow("not initialized");
    });
  });

  describe("getBuilds", () => {
    it("returns builds for a definition", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      const builds = [
        {
          id: 100,
          definition: { id: 1, name: "pipeline-a" },
          status: 2,
          result: 6,
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ value: builds }),
      });

      const result = await client.getBuilds(1);

      expect(result).toEqual(builds);
    });

    it("returns empty array when no builds", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      const result = await client.getBuilds(1);

      expect(result).toEqual([]);
    });

    it("builds correct API URL with definition filter", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ value: [] }),
      });

      await client.getBuilds(42);

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain("test-project/_apis/build/builds");
      expect(url).toContain("api-version=7.1");
      expect(url).toContain("definitions=42");
      expect(url).toContain("statusFilter=2");
      expect(url).toContain("resultFilter=6");
      expect(url).toContain("$top=1");
    });

    it("uses custom top param", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ value: [] }),
      });

      await client.getBuilds(42, 5);

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain("$top=5");
    });

    it("throws on permission denied (401)", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      await expect(client.getBuilds(1)).rejects.toThrow("permission");
    });

    it("throws on permission denied (403)", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });

      await expect(client.getBuilds(1)).rejects.toThrow("permission");
    });

    it("throws generic error on server error", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(client.getBuilds(1)).rejects.toThrow(
        "Failed to list builds: 500",
      );
    });

    it("throws if not initialized", async () => {
      const client = new ArtifactClient("test-project");

      await expect(client.getBuilds(1)).rejects.toThrow("not initialized");
    });
  });

  describe("authenticatedFetch", () => {
    it("includes auth header", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      await client.authenticatedFetch("https://example.com/api");

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe("Bearer mock-access-token-12345");
    });

    it("throws if not initialized", async () => {
      const client = new ArtifactClient("test-project");

      await expect(
        client.authenticatedFetch("https://example.com/api"),
      ).rejects.toThrow("not initialized");
    });

    it("passes through request options", async () => {
      const client = new ArtifactClient("test-project");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

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
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      const loader = client.createDatasetLoader(123, "aggregates");

      expect(loader).toBeInstanceOf(AuthenticatedDatasetLoader);
    });
  });

  describe("SDK mock isolation", () => {
    it("does not allow SDK mock state to leak between tests", () => {
      // Verify that setupSdkMocks() in beforeEach resets state cleanly
      expect(mockSdkModule.getAccessToken).toBeDefined();
      // Call count should be 0 since we haven't called initialize() in this test
      expect(mockSdkModule.getAccessToken.mock.calls.length).toBe(0);
    });

    it("resets mock call counts between tests", () => {
      // Previous test did not call getAccessToken, this test verifies isolation
      expect(mockSdkModule.getAccessToken.mock.calls.length).toBe(0);
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
        aggregates_schema_version: 3,
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
        aggregates_schema_version: 3,
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
            {
              week: "2026-W01",
              path: "aggregates/weekly_rollups/2026-W01.json",
            },
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
      await loader.getWeeklyRollups(
        new Date("2026-01-01"),
        new Date("2026-01-07"),
      );
      const callCountAfterFirst = getArtifactSpy.mock.calls.length;

      // Second call should use cache
      await loader.getWeeklyRollups(
        new Date("2026-01-01"),
        new Date("2026-01-07"),
      );

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

  describe("getCapabilityState", () => {
    // Regression: AuthenticatedDatasetLoader previously did not implement
    // getCapabilityState(); the dashboard's capability gate at
    // `dashboard.ts:1087` short-circuited on `undefined`, removing the
    // comments-trend chart row in production even when the manifest had
    // `capabilities.comments_metrics: true`. These tests construct a real
    // AuthenticatedDatasetLoader (no fake of getCapabilityState) and prove
    // the live-extension path now mirrors DatasetLoader semantics.

    function buildLoader(manifest: ManifestSchema): AuthenticatedDatasetLoader {
      const mockData: Record<string, unknown> = {
        "123/aggregates/dataset-manifest.json": manifest,
      };
      const mockClient = new TestMockArtifactClient(mockData);
      return new AuthenticatedDatasetLoader(
        mockClient as unknown as ArtifactClient,
        123,
        "aggregates",
      );
    }

    const baseManifest: ManifestSchema = {
      manifest_schema_version: 1,
      dataset_schema_version: 1,
      aggregates_schema_version: 3,
      aggregate_index: { weekly_rollups: [], distributions: [] },
    };

    it("returns commentsMetricsAvailable=true when manifest has capabilities.comments_metrics=true (live-extension regression for Feature 333)", async () => {
      const loader = buildLoader({
        ...baseManifest,
        capabilities: {
          author_filters: true,
          author_repo_exact: true,
          comments_metrics: true,
          reviewer_repository_mode: "constrained",
          reviewer_team_mode: "disallowed",
          cross_dimensional_available: true,
        },
      });

      await loader.loadManifest();

      expect(loader.getCapabilityState().commentsMetricsAvailable).toBe(true);
    });

    it("returns commentsMetricsAvailable=false when manifest has capabilities.comments_metrics=false (negative control — prevents accidental permissive gating)", async () => {
      const loader = buildLoader({
        ...baseManifest,
        capabilities: {
          author_filters: true,
          author_repo_exact: true,
          comments_metrics: false,
          reviewer_repository_mode: "constrained",
          reviewer_team_mode: "disallowed",
          cross_dimensional_available: false,
        },
      });

      await loader.loadManifest();

      expect(loader.getCapabilityState().commentsMetricsAvailable).toBe(false);
    });

    it("returns DEFAULT_CAPABILITY_STATE.commentsMetricsAvailable=false when manifest omits capabilities and features.comments", async () => {
      const loader = buildLoader(baseManifest);

      await loader.loadManifest();

      expect(loader.getCapabilityState().commentsMetricsAvailable).toBe(false);
    });

    it("falls back to features.comments=true when capabilities.comments_metrics is absent (legacy-manifest compatibility — same fallback as DatasetLoader)", async () => {
      const loader = buildLoader({
        ...baseManifest,
        features: { comments: true },
      });

      await loader.loadManifest();

      expect(loader.getCapabilityState().commentsMetricsAvailable).toBe(true);
    });

    it("returns DEFAULT_CAPABILITY_STATE before loadManifest() is called (no-state baseline)", () => {
      const loader = buildLoader(baseManifest);

      expect(loader.getCapabilityState().commentsMetricsAvailable).toBe(false);
      expect(loader.getCapabilityState().commentsCoverageStatus).toBe(
        "disabled",
      );
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

    const result1 = await client.getArtifactFile(
      123,
      "aggregates",
      "test.json",
    );
    const result2 = await client.getArtifactFile(
      123,
      "aggregates",
      "test.json",
    );

    expect(result1).toEqual(result2);
    expect(result1).not.toBe(result2); // Different object references
  });

  it("hasArtifactFile returns true for existing files", async () => {
    const mockData = {
      "123/aggregates/exists.json": {},
    };
    const client = new MockArtifactClient(mockData);

    expect(await client.hasArtifactFile(123, "aggregates", "exists.json")).toBe(
      true,
    );
    expect(
      await client.hasArtifactFile(123, "aggregates", "missing.json"),
    ).toBe(false);
  });

  it("is initialized by default", () => {
    const client = new MockArtifactClient({});
    expect(client.initialized).toBe(true);
  });

  it("getDefinitions returns mock definitions", async () => {
    const definitions = [
      { id: 1, name: "pipeline-a" },
      { id: 2, name: "pipeline-b" },
    ];
    const client = new MockArtifactClient({ definitions });

    const result = await client.getDefinitions();

    expect(result).toEqual(definitions);
  });

  it("getDefinitions returns empty array when no mock data", async () => {
    const client = new MockArtifactClient({});

    const result = await client.getDefinitions();

    expect(result).toEqual([]);
  });

  it("getBuilds returns mock builds for definition", async () => {
    const builds = [
      {
        id: 100,
        definition: { id: 1, name: "pipeline-a" },
        status: 2,
        result: 6,
      },
    ];
    const client = new MockArtifactClient({ "builds/1": builds });

    const result = await client.getBuilds(1);

    expect(result).toEqual(builds);
  });

  it("getBuilds returns empty array when no mock data for definition", async () => {
    const client = new MockArtifactClient({});

    const result = await client.getBuilds(999);

    expect(result).toEqual([]);
  });
});
