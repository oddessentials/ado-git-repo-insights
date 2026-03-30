/**
 * Artifact Client Auth Pattern Tests
 *
 * These tests ensure the correct authentication pattern is used.
 * The ArtifactClient must use getAccessToken() from sdk.ts (which delegates
 * to azure-devops-extension-sdk) -- NOT getAppToken() or any legacy
 * VSS.getService(AuthTokenService) pattern.
 *
 * This test prevents regression of the issue where an incorrect auth
 * method was used, causing "Contribution with id '' could not be found".
 */

import { ArtifactClient } from "../ui/artifact-client";
import {
  setupSdkMocks,
  teardownSdkMocks,
  setMockAccessToken,
  setMockServiceLocation,
  mockSdkModule,
} from "./harness/vss-sdk-mock";

describe("ArtifactClient Authentication Pattern", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    setupSdkMocks();
    // Save the original mock fetch (set up in tests/setup.ts) and replace with our own
    originalFetch = global.fetch;
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ value: [] }),
      } as Response),
    );
  });

  afterEach(() => {
    teardownSdkMocks();
    // Restore the original mock fetch (don't delete — setup.ts expects it)
    (global as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    jest.clearAllMocks();
  });

  describe("initialize()", () => {
    it("should use getAccessToken() from the SDK for authentication", async () => {
      const client = new ArtifactClient("test-project-id");

      await client.initialize();

      // Verify getAccessToken was called (via the mock SDK module)
      expect(mockSdkModule.getAccessToken).toHaveBeenCalled();
    });

    it("should NOT use getAppToken() for authentication", async () => {
      const client = new ArtifactClient("test-project-id");

      await client.initialize();

      // Verify getAppToken was NOT called
      expect(mockSdkModule.getAppToken).not.toHaveBeenCalled();
    });

    it("should extract token as a plain string (not { token })", async () => {
      const expectedToken = "test-bearer-token-abc123";
      setMockAccessToken(expectedToken);

      const client = new ArtifactClient("test-project-id");
      await client.initialize();

      // Access the internal authToken (testing implementation detail, but critical)
      expect((client as unknown as { authToken?: string }).authToken).toBe(
        expectedToken,
      );
    });

    it("should use the LocationService for collection URI", async () => {
      setMockServiceLocation("https://dev.azure.com/custom-org/");

      const client = new ArtifactClient("test-project-id");
      await client.initialize();

      // Verify the SDK's getService was called (for LocationService)
      expect(mockSdkModule.getService).toHaveBeenCalled();
    });
  });

  describe("authenticated fetch behavior", () => {
    it("should use Bearer token in Authorization header", async () => {
      const testToken = "bearer-test-token";
      setMockAccessToken(testToken);

      const client = new ArtifactClient("test-project-id");
      await client.initialize();

      // Trigger an authenticated request
      await client.getArtifacts(12345);

      // Verify fetch was called with Bearer token
      expect(global.fetch).toHaveBeenCalled();
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const headers = fetchCall[1].headers;
      expect(headers.Authorization).toBe(`Bearer ${testToken}`);
    });
  });
});
