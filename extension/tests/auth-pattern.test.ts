/**
 * ArtifactClient Authentication Pattern Tests
 *
 * Verifies that ArtifactClient:
 * - Accepts credentials via initialize() (SDK-free)
 * - Uses Bearer token in all authenticated requests
 * - Fails fast if not initialized
 *
 * SDK integration (getAccessToken, getCollectionUri) is tested
 * at the caller level (dashboard.ts, settings.ts), not here.
 */

import { ArtifactClient } from "../ui/artifact-client";
import { setupSdkMocks, teardownSdkMocks } from "./harness/vss-sdk-mock";

const TEST_COLLECTION_URI = "https://dev.azure.com/test-org/";
const TEST_AUTH_TOKEN = "test-bearer-token-abc123";
const TEST_TOKEN_PROVIDER = (): Promise<string> =>
  Promise.resolve(TEST_AUTH_TOKEN);

describe("ArtifactClient Authentication Pattern", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    setupSdkMocks();
    originalFetch = (global as unknown as { fetch: typeof fetch }).fetch;
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ value: [] }),
      }),
    );
  });

  afterEach(() => {
    (global as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    jest.clearAllMocks();
    teardownSdkMocks();
  });

  describe("initialize()", () => {
    it("stores credentials passed by the caller", async () => {
      const client = new ArtifactClient("test-project-id");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      expect(
        (client as unknown as { tokenProvider: (() => Promise<string>) | null })
          .tokenProvider,
      ).toBe(TEST_TOKEN_PROVIDER);
      expect(
        (client as unknown as { collectionUri?: string }).collectionUri,
      ).toBe(TEST_COLLECTION_URI);
    });

    it("is idempotent — second call is a no-op", async () => {
      const client = new ArtifactClient("test-project-id");
      const otherProvider = (): Promise<string> =>
        Promise.resolve("other-token");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);
      await client.initialize("https://other.com/", otherProvider);

      // First values are preserved
      expect(
        (client as unknown as { tokenProvider: (() => Promise<string>) | null })
          .tokenProvider,
      ).toBe(TEST_TOKEN_PROVIDER);
    });
  });

  describe("authenticated fetch behavior", () => {
    it("uses Bearer token in Authorization header", async () => {
      const client = new ArtifactClient("test-project-id");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      await client.getArtifacts(12345);

      const mockFetch = (global as unknown as { fetch: jest.Mock }).fetch;
      expect(mockFetch).toHaveBeenCalled();

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect((options.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${TEST_AUTH_TOKEN}`,
      );
    });

    it("uses collection URI as base URL for API calls", async () => {
      const client = new ArtifactClient("test-project-id");
      await client.initialize(TEST_COLLECTION_URI, TEST_TOKEN_PROVIDER);

      await client.getArtifacts(12345);

      const mockFetch = (global as unknown as { fetch: jest.Mock }).fetch;
      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toMatch(/^https:\/\/dev\.azure\.com\/test-org\//);
    });

    it("fails fast if not initialized", async () => {
      const client = new ArtifactClient("test-project-id");

      await expect(client.getArtifacts(12345)).rejects.toThrow(
        "ArtifactClient not initialized",
      );
    });
  });
});
