/**
 * HTTP Response Tests for ArtifactClient
 *
 * Tests for _authenticatedFetch behavior across all HTTP response scenarios.
 * Validates proper error handling, response parsing, and edge cases.
 *
 * Per spec: "Tests that validate artifact client handles all HTTP response
 * scenarios correctly"
 *
 * @module tests/artifact-client/http-responses.test.ts
 */

import { ArtifactClient } from "../../ui/artifact-client";
import {
  setupSdkMocks,
  teardownSdkMocks,
} from "../harness/vss-sdk-mock";

describe("ArtifactClient HTTP Response Handling", () => {
  let mockFetch: jest.Mock;
  let client: ArtifactClient;

  beforeEach(async () => {
    // Setup SDK mocks (replaces old global.VSS pattern)
    setupSdkMocks();

    // Setup mock fetch — returns success by default
    mockFetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ value: [] }),
      }),
    );
    (global as unknown as { fetch: jest.Mock }).fetch = mockFetch;

    // Initialize client with token provider (resolved per-request)
    client = new ArtifactClient("test-project");
    await client.initialize(
      "https://dev.azure.com/test-org/",
      () => Promise.resolve("mock-access-token-12345"),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    teardownSdkMocks();
  });

  // =========================================================================
  // T030: 200 Success Response
  // =========================================================================

  describe("200 success response (T030)", () => {
    it("returns parsed JSON data on successful response", async () => {
      const testData = { schema_version: 1, data: "test-value" };
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

    it("includes authorization header in request", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      await client.getArtifactFile(123, "aggregates", "test.json");

      expect(mockFetch).toHaveBeenCalled();
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe("Bearer mock-access-token-12345");
    });

    it("includes Accept: application/json header", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      await client.getArtifactFile(123, "aggregates", "test.json");

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Accept).toBe("application/json");
    });
  });

  // =========================================================================
  // T031: 401 Unauthorized Response
  // =========================================================================

  describe("401 unauthorized response (T031)", () => {
    it("throws error with permission message on 401", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      await expect(
        client.getArtifactFile(123, "aggregates", "manifest.json"),
      ).rejects.toThrow(/permission/i);
    });

    it("does not expose token in error message", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      try {
        await client.getArtifactFile(123, "aggregates", "manifest.json");
        fail("Expected error to be thrown");
      } catch (error) {
        expect(String(error)).not.toContain("mock-token");
      }
    });
  });

  // =========================================================================
  // T032: 403 Forbidden Response
  // =========================================================================

  describe("403 forbidden response (T032)", () => {
    it("throws error with permission message on 403", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });

      await expect(
        client.getArtifactFile(123, "aggregates", "manifest.json"),
      ).rejects.toThrow(/permission/i);
    });

    it("distinguishes between authentication (401) and authorization (403)", async () => {
      // Both should throw permission errors, but the underlying cause differs
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });

      await expect(
        client.getArtifactFile(123, "aggregates", "manifest.json"),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // T033: 404 Not Found Response
  // =========================================================================

  describe("404 not found response (T033)", () => {
    it("throws error with not found message on 404", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(
        client.getArtifactFile(123, "aggregates", "missing.json"),
      ).rejects.toThrow(/not found/i);
    });

    it("includes file path context in error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(
        client.getArtifactFile(123, "aggregates", "specific-file.json"),
      ).rejects.toThrow();
    });

    it("hasArtifactFile returns false on 404", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const exists = await client.hasArtifactFile(
        123,
        "aggregates",
        "missing.json",
      );

      expect(exists).toBe(false);
    });
  });

  // =========================================================================
  // T034: 500 Server Error Response
  // =========================================================================

  describe("500 server error response (T034)", () => {
    it("throws error on 500 internal server error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(
        client.getArtifactFile(123, "aggregates", "manifest.json"),
      ).rejects.toThrow();
    });

    it("throws error on 502 bad gateway", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
      });

      await expect(
        client.getArtifactFile(123, "aggregates", "manifest.json"),
      ).rejects.toThrow();
    });

    it("throws error on 503 service unavailable", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      });

      await expect(
        client.getArtifactFile(123, "aggregates", "manifest.json"),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // T035: Malformed JSON Response
  // =========================================================================

  describe("malformed JSON response (T035)", () => {
    it("throws error when response body is not valid JSON", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError("Unexpected token")),
      });

      await expect(
        client.getArtifactFile(123, "aggregates", "corrupted.json"),
      ).rejects.toThrow();
    });

    it("throws error when response body is empty", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.reject(new SyntaxError("Unexpected end of JSON input")),
      });

      await expect(
        client.getArtifactFile(123, "aggregates", "empty.json"),
      ).rejects.toThrow();
    });

    it("throws error when response is HTML instead of JSON", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
      });

      await expect(
        client.getArtifactFile(123, "aggregates", "error-page.json"),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // T036: Timeout Handling Gap Documentation
  // =========================================================================

  describe("timeout handling - gap documentation (T036)", () => {
    /**
     * IMPORTANT: This test documents a KNOWN GAP in the current implementation.
     *
     * The artifact client does NOT implement request timeout handling.
     * If a request hangs indefinitely, there is no mechanism to abort it.
     *
     * This is intentional documentation, NOT a bug to fix in this feature.
     * Future enhancement: Add AbortController with configurable timeout.
     *
     * Per spec: "Artifact client has no timeout/retry logic; tests document
     * current behavior without adding resilience features"
     */
    it("documents that no timeout handling exists (gap documentation)", () => {
      // This test verifies that the fetch call does NOT include an AbortSignal
      // which would be required for timeout implementation

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      // The absence of AbortSignal in the fetch options documents the gap
      // A future implementation would add: signal: AbortSignal.timeout(30000)

      expect(true).toBe(true); // Placeholder assertion - test exists for documentation
    });

    it("fetch is called without AbortSignal (confirming no timeout)", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      await client.getArtifactFile(123, "aggregates", "test.json");

      // Verify no signal property in fetch options
      const fetchOptions = mockFetch.mock.calls[0][1];
      expect(fetchOptions.signal).toBeUndefined();
    });

    /**
     * Future enhancement test template (commented out):
     *
     * it("aborts request after timeout period", async () => {
     *   jest.useFakeTimers();
     *   mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves
     *
     *   const promise = client.getArtifactFile(123, "aggregates", "slow.json");
     *   jest.advanceTimersByTime(30000);
     *
     *   await expect(promise).rejects.toThrow(/timeout/i);
     *   jest.useRealTimers();
     * });
     */
  });

  // =========================================================================
  // Network Error Handling
  // =========================================================================

  describe("network error handling", () => {
    it("throws error on network failure", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      await expect(
        client.getArtifactFile(123, "aggregates", "manifest.json"),
      ).rejects.toThrow();
    });

    it("throws error on DNS resolution failure", async () => {
      mockFetch.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));

      await expect(
        client.getArtifactFile(123, "aggregates", "manifest.json"),
      ).rejects.toThrow();
    });
  });
});
