/**
 * Per-endpoint-family API version fallback tests.
 *
 * Verifies that ArtifactClient caches resolved API versions per endpoint
 * family, not globally. This matters on Azure DevOps Server deployments
 * where different Build REST routes may support different API versions.
 */

import { ArtifactClient } from "../ui/artifact-client";
import {
  setupSdkMocks,
  teardownSdkMocks,
} from "./harness/vss-sdk-mock";

const TEST_COLLECTION_URI = "https://dev.azure.com/test-org/";
const TEST_AUTH_TOKEN = "mock-access-token-12345";

/** Helper: create a mock Response with the given status. */
function mockResponse(
  status: number,
  body: unknown = { value: [] },
): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : `Status ${status}`,
    json: () => Promise.resolve(body),
  };
}

describe("ArtifactClient per-endpoint-family version fallback", () => {
  let mockFetch: jest.Mock;
  const globalScope = global as unknown as { fetch: jest.Mock };

  beforeEach(() => {
    mockFetch = jest.fn();
    globalScope.fetch = mockFetch;
    setupSdkMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    teardownSdkMocks();
  });

  async function createClient(): Promise<ArtifactClient> {
    const client = new ArtifactClient("test-project");
    await client.initialize(TEST_COLLECTION_URI, TEST_AUTH_TOKEN);
    return client;
  }

  /** Extract api-version from the Nth fetch call's URL argument. */
  function versionOfCall(n: number): string {
    const call = mockFetch.mock.calls.at(n) as [string, ...unknown[]] | undefined;
    if (!call) return "no-call";
    const url = call[0];
    const match = url.match(/api-version=([^&]+)/);
    return match?.[1] ?? "unknown";
  }

  describe("per-family isolation", () => {
    it("definitions resolves on 7.1, builds on 6.0, artifacts on 5.1 in the same client", async () => {
      const client = await createClient();

      // definitions: 7.1 works immediately
      mockFetch.mockResolvedValueOnce(mockResponse(200));
      await client.getDefinitions();

      // builds: 7.1 → 400, 6.0 → 200
      mockFetch
        .mockResolvedValueOnce(mockResponse(400))
        .mockResolvedValueOnce(mockResponse(200));
      await client.getBuilds(1);

      // artifacts: 7.1 → 400, 6.0 → 400, 5.1 → 200
      mockFetch
        .mockResolvedValueOnce(mockResponse(400))
        .mockResolvedValueOnce(mockResponse(400))
        .mockResolvedValueOnce(mockResponse(200));
      await client.getArtifacts(1);

      // Verify each family probed independently
      // definitions: single call at 7.1
      expect(versionOfCall(0)).toBe("7.1");

      // builds: tried 7.1 (failed), then 6.0 (succeeded)
      expect(versionOfCall(1)).toBe("7.1");
      expect(versionOfCall(2)).toBe("6.0");

      // artifacts: tried 7.1, 6.0, 5.1
      expect(versionOfCall(3)).toBe("7.1");
      expect(versionOfCall(4)).toBe("6.0");
      expect(versionOfCall(5)).toBe("5.1");
    });
  });

  describe("family cache reuse", () => {
    it("second call to same family uses cached version without re-probing", async () => {
      const client = await createClient();

      // First definitions call: 7.1 → 400, 6.0 → 200
      mockFetch
        .mockResolvedValueOnce(mockResponse(400))
        .mockResolvedValueOnce(mockResponse(200));
      await client.getDefinitions();

      // Second definitions call: should use cached 6.0 directly
      mockFetch.mockResolvedValueOnce(mockResponse(200));
      await client.getDefinitions();

      // First call: 2 requests (7.1 failed, 6.0 succeeded)
      expect(versionOfCall(0)).toBe("7.1");
      expect(versionOfCall(1)).toBe("6.0");
      // Second call: 1 request (cached 6.0)
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(versionOfCall(2)).toBe("6.0");
    });

    it("cache for one family does not affect another family", async () => {
      const client = await createClient();

      // Resolve definitions on 7.1
      mockFetch.mockResolvedValueOnce(mockResponse(200));
      await client.getDefinitions();

      // builds still probes independently — 7.1 fails, 6.0 works
      mockFetch
        .mockResolvedValueOnce(mockResponse(400))
        .mockResolvedValueOnce(mockResponse(200));
      await client.getBuilds(1);

      // definitions: 1 call, builds: 2 calls
      expect(mockFetch).toHaveBeenCalledTimes(3);
      // builds probed independently (not reusing definitions' 7.1 cache)
      expect(versionOfCall(1)).toBe("7.1");
      expect(versionOfCall(2)).toBe("6.0");
    });
  });

  describe("auth fail-fast", () => {
    it("401 returns immediately without trying older versions", async () => {
      const client = await createClient();

      mockFetch.mockResolvedValueOnce(mockResponse(401));

      // getDefinitions checks for 401/403 and throws permission error
      await expect(client.getDefinitions()).rejects.toThrow("permission");

      // Only 1 fetch call — did not try 6.0 or 5.1
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("403 returns immediately without trying older versions", async () => {
      const client = await createClient();

      mockFetch.mockResolvedValueOnce(mockResponse(403));

      await expect(client.getBuilds(1)).rejects.toThrow("permission");

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("full fallback exhaustion", () => {
    it("throws when all versions return 400", async () => {
      const client = await createClient();

      mockFetch
        .mockResolvedValueOnce(mockResponse(400))
        .mockResolvedValueOnce(mockResponse(400))
        .mockResolvedValueOnce(mockResponse(400));

      await expect(client.getDefinitions()).rejects.toThrow(
        "Build API api-version=5.1: 400",
      );

      // All 3 versions tried
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("throws when all versions return 404", async () => {
      const client = await createClient();

      mockFetch
        .mockResolvedValueOnce(mockResponse(404))
        .mockResolvedValueOnce(mockResponse(404))
        .mockResolvedValueOnce(mockResponse(404));

      await expect(client.getArtifacts(1)).rejects.toThrow(
        "Build API api-version=5.1: 404",
      );
    });
  });

  describe("artifact-file family as first entry", () => {
    it("artifact-file resolves independently on older Server version", async () => {
      const client = await createClient();

      // artifact-file: 7.1 → 404, 6.0 → 404, 5.1 → 200
      const fileData = { test: "data" };
      mockFetch
        .mockResolvedValueOnce(mockResponse(404))
        .mockResolvedValueOnce(mockResponse(404))
        .mockResolvedValueOnce(mockResponse(200, fileData));

      const result = await client.getArtifactFile(1, "aggregates", "manifest.json");

      expect(result).toEqual(fileData);

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(versionOfCall(0)).toBe("7.1");
      expect(versionOfCall(1)).toBe("6.0");
      expect(versionOfCall(2)).toBe("5.1");
    });

    it("hasArtifactFile probes independently from getArtifactFile", async () => {
      const client = await createClient();

      // Resolve getArtifactFile on 6.0
      mockFetch
        .mockResolvedValueOnce(mockResponse(400))
        .mockResolvedValueOnce(mockResponse(200, { test: "data" }));
      await client.getArtifactFile(1, "aggregates", "manifest.json");

      // hasArtifactFile reuses the same "artifact-file" family cache
      mockFetch.mockResolvedValueOnce(mockResponse(200));
      const exists = await client.hasArtifactFile(1, "aggregates", "other.json");

      expect(exists).toBe(true);

      // hasArtifactFile reused cached 6.0 (1 call, not 2)
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(versionOfCall(2)).toBe("6.0");
    });
  });
});
