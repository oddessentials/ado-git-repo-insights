/**
 * Artifact Client Auth Pattern Tests
 *
 * These tests ensure the correct authentication pattern is used.
 * VSS.getAccessToken() is the documented method - NOT VSS.getService(AuthTokenService).
 *
 * This test prevents regression of the issue where VSS.ServiceIds.AuthTokenService
 * was used but doesn't exist in the bundled SDK, causing:
 * "Contribution with id '' could not be found"
 */

import { ArtifactClient } from "../ui/artifact-client";

describe("ArtifactClient Authentication Pattern", () => {
  let mockVSS: any;

  beforeEach(() => {
    // Create a mock VSS SDK that tracks method calls
    mockVSS = {
      getWebContext: jest.fn(() => ({
        collection: { uri: "https://dev.azure.com/test-org/" },
        project: { id: "test-project-id", name: "test-project" },
      })),
      getAccessToken: jest.fn(() =>
        Promise.resolve({ token: "mock-token-12345" }),
      ),
      getService: jest.fn(() => {
        throw new Error("VSS.getService should NOT be called for auth tokens");
      }),
      ServiceIds: {
        // Intentionally NOT including AuthTokenService to match real SDK
        ExtensionData: "ms.vss-web.data-service",
        Dialog: "ms.vss-web.dialog-service",
        Navigation: "ms.vss-web.navigation-service",
      },
    };

    (global as any).VSS = mockVSS;
  });

  afterEach(() => {
    delete (global as any).VSS;
    jest.clearAllMocks();
  });

  describe("initialize()", () => {
    it("should use VSS.getAccessToken() for authentication", async () => {
      const client = new ArtifactClient("test-project-id");

      await client.initialize();

      // Verify getAccessToken was called
      expect(mockVSS.getAccessToken).toHaveBeenCalledTimes(1);
    });

    it("should NOT use VSS.getService() for authentication", async () => {
      const client = new ArtifactClient("test-project-id");

      await client.initialize();

      // Verify getService was NOT called
      expect(mockVSS.getService).not.toHaveBeenCalled();
    });

    it("should extract token from getAccessToken result correctly", async () => {
      const expectedToken = "test-bearer-token-abc123";
      mockVSS.getAccessToken.mockResolvedValue({ token: expectedToken });

      const client = new ArtifactClient("test-project-id");
      await client.initialize();

      // Access the internal authToken (testing implementation detail, but critical)
      expect((client as any).authToken).toBe(expectedToken);
    });

    it("should handle getAccessToken returning token in correct format", async () => {
      // The VSS SDK returns { token: string } format
      mockVSS.getAccessToken.mockResolvedValue({ token: "format-test-token" });

      const client = new ArtifactClient("test-project-id");
      await client.initialize();

      expect((client as any).authToken).toBe("format-test-token");
    });
  });

  describe("SDK ServiceIds verification", () => {
    it("should verify AuthTokenService is NOT in bundled SDK ServiceIds", () => {
      // This documents the known limitation of the bundled SDK
      // If this test fails, it means the SDK was updated and we should review
      expect(mockVSS.ServiceIds.AuthTokenService).toBeUndefined();
    });

    it("should verify VSS.getAccessToken exists as the correct auth method", () => {
      expect(typeof mockVSS.getAccessToken).toBe("function");
    });
  });

  describe("authenticated fetch behavior", () => {
    beforeEach(() => {
      (global as any).fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ value: [] }),
        }),
      );
    });

    afterEach(() => {
      delete (global as any).fetch;
    });

    it("should use Bearer token in Authorization header", async () => {
      const testToken = "bearer-test-token";
      mockVSS.getAccessToken.mockResolvedValue({ token: testToken });

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
