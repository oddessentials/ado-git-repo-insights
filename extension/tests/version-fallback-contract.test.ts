/**
 * Contract tests for the shared fetchWithVersionFallback function.
 *
 * This is the primary guard against version-fallback regression.
 * Both ArtifactClient and settings.ts depend on this contract.
 * Changes here affect every REST call in the extension.
 */

import {
  fetchWithVersionFallback,
  ADO_REST_API_VERSIONS,
} from "../ui/modules/api-versions";

/** Helper: create a mock Response with the given status. */
function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : `Status ${status}`,
    json: () => Promise.resolve(body),
    headers: new Headers(),
  } as Response;
}

describe("fetchWithVersionFallback contract", () => {
  let fetchFn: jest.Mock<Promise<Response>, [string]>;

  beforeEach(() => {
    fetchFn = jest.fn();
  });

  function buildUrl(version: string): string {
    return `https://dev.azure.com/org/_apis/test?api-version=${version}`;
  }

  // ── Auth fail-fast ────────────────────────────────────────────

  describe("auth fail-fast", () => {
    it("returns immediately on 401 without trying older versions", async () => {
      fetchFn.mockResolvedValueOnce(mockResponse(401));

      const result = await fetchWithVersionFallback(buildUrl, fetchFn, {
        isListEndpoint: true,
      });

      expect(result.response.status).toBe(401);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it("returns immediately on 403 without trying older versions", async () => {
      fetchFn.mockResolvedValueOnce(mockResponse(403));

      const result = await fetchWithVersionFallback(buildUrl, fetchFn, {
        isListEndpoint: false,
      });

      expect(result.response.status).toBe(403);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  // ── Version probing: 400 ──────────────────────────────────────

  describe("400 version mismatch", () => {
    it("retries through all versions and throws on exhaustion", async () => {
      fetchFn
        .mockResolvedValueOnce(mockResponse(400))
        .mockResolvedValueOnce(mockResponse(400))
        .mockResolvedValueOnce(mockResponse(400));

      await expect(
        fetchWithVersionFallback(buildUrl, fetchFn, { isListEndpoint: false }),
      ).rejects.toThrow(/api-version=5\.1: 400/);

      expect(fetchFn).toHaveBeenCalledTimes(3);
    });

    it("400 then 200 resolves on second version", async () => {
      fetchFn
        .mockResolvedValueOnce(mockResponse(400))
        .mockResolvedValueOnce(mockResponse(200, { value: [] }));

      const result = await fetchWithVersionFallback(buildUrl, fetchFn, {
        isListEndpoint: true,
      });

      expect(result.response.ok).toBe(true);
      expect(result.version).toBe("6.0");
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });
  });

  // ── Version probing: 404 (list vs resource) ───────────────────

  describe("404 behavior depends on isListEndpoint", () => {
    it("retries on 404 when isListEndpoint=true", async () => {
      fetchFn
        .mockResolvedValueOnce(mockResponse(404))
        .mockResolvedValueOnce(mockResponse(404))
        .mockResolvedValueOnce(mockResponse(404));

      await expect(
        fetchWithVersionFallback(buildUrl, fetchFn, { isListEndpoint: true }),
      ).rejects.toThrow(/api-version=5\.1: 404/);

      expect(fetchFn).toHaveBeenCalledTimes(3);
    });

    it("returns immediately on 404 when isListEndpoint=false", async () => {
      fetchFn.mockResolvedValueOnce(mockResponse(404));

      const result = await fetchWithVersionFallback(buildUrl, fetchFn, {
        isListEndpoint: false,
      });

      expect(result.response.status).toBe(404);
      expect(result.version).toBe("7.1");
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  // ── Server errors: immediate return ───────────────────────────

  describe("server errors return immediately (no retry)", () => {
    it("500 returns immediately", async () => {
      fetchFn.mockResolvedValueOnce(mockResponse(500));

      const result = await fetchWithVersionFallback(buildUrl, fetchFn, {
        isListEndpoint: true,
      });

      expect(result.response.status).toBe(500);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it("502 returns immediately", async () => {
      fetchFn.mockResolvedValueOnce(mockResponse(502));

      const result = await fetchWithVersionFallback(buildUrl, fetchFn, {
        isListEndpoint: true,
      });

      expect(result.response.status).toBe(502);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it("503 returns immediately", async () => {
      fetchFn.mockResolvedValueOnce(mockResponse(503));

      const result = await fetchWithVersionFallback(buildUrl, fetchFn, {
        isListEndpoint: false,
      });

      expect(result.response.status).toBe(503);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  // ── Success path ──────────────────────────────────────────────

  describe("success returns response with resolved version", () => {
    it("first version succeeds — returns version 7.1", async () => {
      fetchFn.mockResolvedValueOnce(mockResponse(200, { value: [] }));

      const result = await fetchWithVersionFallback(buildUrl, fetchFn, {
        isListEndpoint: true,
      });

      expect(result.response.ok).toBe(true);
      expect(result.version).toBe("7.1");
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it("passes correct URL with version to fetchFn", async () => {
      fetchFn.mockResolvedValueOnce(mockResponse(200));

      await fetchWithVersionFallback(buildUrl, fetchFn, {
        isListEndpoint: true,
      });

      expect(fetchFn).toHaveBeenCalledWith(
        "https://dev.azure.com/org/_apis/test?api-version=7.1",
      );
    });
  });

  // ── Mixed sequences ───────────────────────────────────────────

  describe("mixed version probe sequences", () => {
    it("400, 404-on-list, 200 resolves on version 5.1", async () => {
      fetchFn
        .mockResolvedValueOnce(mockResponse(400))
        .mockResolvedValueOnce(mockResponse(404))
        .mockResolvedValueOnce(mockResponse(200, { value: [] }));

      const result = await fetchWithVersionFallback(buildUrl, fetchFn, {
        isListEndpoint: true,
      });

      expect(result.version).toBe("5.1");
      expect(result.response.ok).toBe(true);
      expect(fetchFn).toHaveBeenCalledTimes(3);
    });
  });

  // ── Ordering invariant ────────────────────────────────────────

  describe("version ordering", () => {
    it("ADO_REST_API_VERSIONS is ordered newest → oldest", () => {
      const versions = [...ADO_REST_API_VERSIONS].map((v) => parseFloat(v));
      const descending = [...versions].sort((a, b) => b - a);
      expect(versions).toEqual(descending);
    });
  });
});
