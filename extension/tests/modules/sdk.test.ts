/**
 * SDK Module Tests
 *
 * Comprehensive tests for the shared SDK initialization module including:
 * - Local mode detection (isLocalMode, getLocalDatasetPath)
 * - SDK state management (isSdkInitialized, resetSdkState)
 * - SDK initialization (init → ready → notifyLoadSucceeded sequence, FR-014)
 * - Extension data service access (getExtensionDataService)
 * - Web context access (getWebContext)
 * - Collection URI access (getCollectionUri)
 * - Access token retrieval (getAccessToken)
 */

import {
  isLocalMode,
  getLocalDatasetPath,
  isSdkInitialized,
  resetSdkState,
  initializeAdoSdk,
  getWebContext,
  getExtensionDataService,
  getCollectionUri,
  getAccessToken,
} from "../../ui/modules/sdk";

import {
  mockSdkModule,
  setupSdkMocks,
  setMockServiceLocation,
} from "../harness/vss-sdk-mock";

// Store original window properties for cleanup
const originalLocalDashboardMode = (
  window as { LOCAL_DASHBOARD_MODE?: boolean }
).LOCAL_DASHBOARD_MODE;
const originalDatasetPath = (window as { DATASET_PATH?: string }).DATASET_PATH;

describe("SDK Module", () => {
  beforeEach(() => {
    setupSdkMocks();
    resetSdkState();
    delete (window as { LOCAL_DASHBOARD_MODE?: boolean }).LOCAL_DASHBOARD_MODE;
    delete (window as { DATASET_PATH?: string }).DATASET_PATH;
  });

  afterAll(() => {
    if (originalLocalDashboardMode !== undefined) {
      (window as { LOCAL_DASHBOARD_MODE?: boolean }).LOCAL_DASHBOARD_MODE =
        originalLocalDashboardMode;
    }
    if (originalDatasetPath !== undefined) {
      (window as { DATASET_PATH?: string }).DATASET_PATH = originalDatasetPath;
    }
  });

  describe("isLocalMode", () => {
    it("returns false when LOCAL_DASHBOARD_MODE is undefined", () => {
      expect(isLocalMode()).toBe(false);
    });

    it("returns false when LOCAL_DASHBOARD_MODE is false", () => {
      (window as { LOCAL_DASHBOARD_MODE?: boolean }).LOCAL_DASHBOARD_MODE =
        false;
      expect(isLocalMode()).toBe(false);
    });

    it("returns true when LOCAL_DASHBOARD_MODE is true", () => {
      (window as { LOCAL_DASHBOARD_MODE?: boolean }).LOCAL_DASHBOARD_MODE =
        true;
      expect(isLocalMode()).toBe(true);
    });

    it("returns false for truthy non-boolean values", () => {
      (
        window as unknown as { LOCAL_DASHBOARD_MODE: number }
      ).LOCAL_DASHBOARD_MODE = 1;
      expect(isLocalMode()).toBe(false);
    });
  });

  describe("getLocalDatasetPath", () => {
    it("returns default './dataset' when DATASET_PATH is undefined", () => {
      expect(getLocalDatasetPath()).toBe("./dataset");
    });

    it("returns custom path when DATASET_PATH is set", () => {
      (window as { DATASET_PATH?: string }).DATASET_PATH = "/custom/path";
      expect(getLocalDatasetPath()).toBe("/custom/path");
    });

    it("returns default for empty string DATASET_PATH", () => {
      (window as { DATASET_PATH?: string }).DATASET_PATH = "";
      expect(getLocalDatasetPath()).toBe("./dataset");
    });

    it("handles paths with special characters", () => {
      (window as { DATASET_PATH?: string }).DATASET_PATH =
        "/path/with spaces/and%20encoding";
      expect(getLocalDatasetPath()).toBe("/path/with spaces/and%20encoding");
    });
  });

  describe("isSdkInitialized", () => {
    it("returns false initially", () => {
      expect(isSdkInitialized()).toBe(false);
    });

    it("persists state across multiple calls", () => {
      expect(isSdkInitialized()).toBe(false);
      expect(isSdkInitialized()).toBe(false);
    });
  });

  describe("resetSdkState", () => {
    it("resets SDK state to uninitialized", () => {
      resetSdkState();
      expect(isSdkInitialized()).toBe(false);
    });

    it("can be called multiple times safely", () => {
      resetSdkState();
      resetSdkState();
      resetSdkState();
      expect(isSdkInitialized()).toBe(false);
    });
  });

  describe("getWebContext", () => {
    it("returns undefined when SDK is not initialized", () => {
      expect(getWebContext()).toBeUndefined();
    });

    it("maps missing project and team to undefined (closes sdk.ts L314, L317)", async () => {
      // Host returns a webContext without project/team (organization-level
      // context or a host that doesn't expose team membership). The two
      // conditional expressions at L314/L317 must take their falsy branches.
      mockSdkModule.getWebContext.mockImplementation(
        () =>
          ({
            project: undefined,
            team: undefined,
          }) as unknown as {
            project: { name: string; id: string };
            team: { name: string; id: string };
          },
      );
      await initializeAdoSdk();

      const result = getWebContext();
      expect(result).toBeDefined();
      expect(result?.project).toBeUndefined();
      expect(result?.team).toBeUndefined();
      // User and host still come from their default mocks.
      expect(result?.user.id).toBe("user-789");
      expect(result?.host.id).toBe("host-001");
    });
  });

  describe("initializeAdoSdk", () => {
    it("calls SDK.init with { loaded: false }", async () => {
      await initializeAdoSdk();
      expect(mockSdkModule.init).toHaveBeenCalledWith({ loaded: false });
    });

    it("sets SDK as initialized after ready", async () => {
      await initializeAdoSdk();
      expect(isSdkInitialized()).toBe(true);
    });

    it("calls notifyLoadSucceeded after ready (FR-014)", async () => {
      await initializeAdoSdk();
      expect(mockSdkModule.notifyLoadSucceeded).toHaveBeenCalled();
    });

    it("executes onReady callback when provided", async () => {
      const onReady = jest.fn();
      await initializeAdoSdk({ onReady });
      expect(onReady).toHaveBeenCalled();
    });

    it("onReady callback fires between ready and notifyLoadSucceeded (FR-014)", async () => {
      const callOrder: string[] = [];
      mockSdkModule.ready.mockImplementation(() => {
        callOrder.push("ready");
        return Promise.resolve();
      });
      mockSdkModule.notifyLoadSucceeded.mockImplementation(() => {
        callOrder.push("notifyLoadSucceeded");
        return Promise.resolve();
      });
      const onReady = jest.fn(() => callOrder.push("onReady"));

      await initializeAdoSdk({ onReady });

      expect(callOrder).toEqual(["ready", "onReady", "notifyLoadSucceeded"]);
    });

    it("getWebContext returns context during onReady (not undefined)", async () => {
      let contextDuringOnReady: ReturnType<typeof getWebContext> | undefined;

      await initializeAdoSdk({
        onReady: () => {
          contextDuringOnReady = getWebContext();
        },
      });

      expect(contextDuringOnReady).toBeDefined();
      expect(contextDuringOnReady?.project?.name).toBe("test-project");
    });

    it("resizeHost is callable during onReady (not gated out)", async () => {
      const { resizeHost } = await import("../../ui/modules/sdk");
      let resizeCalledDuringOnReady = false;

      await initializeAdoSdk({
        onReady: () => {
          resizeHost(undefined, 500);
          resizeCalledDuringOnReady =
            mockSdkModule.resize.mock.calls.length > 0;
        },
      });

      expect(resizeCalledDuringOnReady).toBe(true);
      expect(mockSdkModule.resize).toHaveBeenCalledWith(undefined, 500);
    });

    it("skips initialization if already initialized (idempotency)", async () => {
      await initializeAdoSdk();
      jest.clearAllMocks();

      await initializeAdoSdk();
      expect(mockSdkModule.init).not.toHaveBeenCalled();
    });

    it("shares in-flight promise for concurrent callers", async () => {
      // Make ready() resolve after a short delay
      mockSdkModule.ready.mockImplementation(
        () => new Promise<void>((resolve) => setTimeout(resolve, 50)),
      );
      resetSdkState();

      // Two concurrent calls
      const p1 = initializeAdoSdk();
      const p2 = initializeAdoSdk();

      await Promise.all([p1, p2]);

      // SDK.init should be called exactly once, not twice
      expect(mockSdkModule.init).toHaveBeenCalledTimes(1);
      expect(isSdkInitialized()).toBe(true);
    });

    it("rejects on timeout", async () => {
      mockSdkModule.ready.mockImplementation(() => new Promise<void>(() => {}));
      resetSdkState();

      await expect(initializeAdoSdk({ timeout: 50 })).rejects.toThrow(
        "Azure DevOps SDK initialization timed out",
      );
    });

    it("rolls back sdkInitialized if onReady throws", async () => {
      resetSdkState();

      await expect(
        initializeAdoSdk({
          onReady: () => {
            throw new Error("callback failed");
          },
        }),
      ).rejects.toThrow("callback failed");

      expect(isSdkInitialized()).toBe(false);
    });

    it("rolls back sdkInitialized if notifyLoadSucceeded rejects", async () => {
      mockSdkModule.notifyLoadSucceeded.mockImplementation(() =>
        Promise.reject(new Error("host notification failed")),
      );
      resetSdkState();

      await expect(initializeAdoSdk()).rejects.toThrow(
        "host notification failed",
      );

      expect(isSdkInitialized()).toBe(false);
    });

    it("does not set sdkInitialized if timeout fires before ready resolves", async () => {
      mockSdkModule.ready.mockImplementation(
        () => new Promise<void>((resolve) => setTimeout(resolve, 200)),
      );
      resetSdkState();

      await expect(initializeAdoSdk({ timeout: 50 })).rejects.toThrow(
        "timed out",
      );

      // Wait for the background ready to resolve
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(isSdkInitialized()).toBe(false);
    });

    it("does not set sdkInitialized if timeout fires during notifyLoadSucceeded", async () => {
      // ready() resolves instantly, but notifyLoadSucceeded hangs
      mockSdkModule.notifyLoadSucceeded.mockImplementation(
        () => new Promise<void>((resolve) => setTimeout(resolve, 200)),
      );
      resetSdkState();

      await expect(initializeAdoSdk({ timeout: 50 })).rejects.toThrow(
        "timed out",
      );

      // Wait for the background notifyLoadSucceeded to resolve
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(isSdkInitialized()).toBe(false);
    });

    it("does not commit sdkInitialized if attempt was invalidated during onReady", async () => {
      // Simulate the scenario where the timeout fires and invalidates
      // the current attempt while onReady is executing. In practice
      // this requires the timeout to fire between onReady and
      // notifyLoadSucceeded. We test the guard by manually
      // incrementing initAttemptId inside onReady (simulating what
      // the timeout callback would do).
      resetSdkState();

      // Import the module to access initAttemptId indirectly
      const sdkModule = await import("../../ui/modules/sdk");

      let contextDuringOnReady: ReturnType<typeof getWebContext>;

      await initializeAdoSdk({
        onReady: () => {
          // At this point sdkReadyForCalls is true, wrappers work
          contextDuringOnReady = getWebContext();
          // Simulate timeout invalidation by resetting state
          // (this is what the timeout callback does: initAttemptId++)
          sdkModule.resetSdkState();
        },
      });

      // onReady saw the context (sdkReadyForCalls was true)
      expect(contextDuringOnReady!).toBeDefined();
      // But the final commit was blocked because resetSdkState
      // invalidated the attempt
      expect(isSdkInitialized()).toBe(false);
    });

    it("allows retry after timeout", async () => {
      // First attempt: ready hangs, times out
      mockSdkModule.ready.mockImplementation(() => new Promise<void>(() => {}));
      resetSdkState();

      await expect(initializeAdoSdk({ timeout: 50 })).rejects.toThrow(
        "timed out",
      );
      expect(isSdkInitialized()).toBe(false);

      // Second attempt: succeeds normally
      setupSdkMocks();
      resetSdkState();

      await initializeAdoSdk();
      expect(isSdkInitialized()).toBe(true);
    });

    it("allows getWebContext after initialization", async () => {
      await initializeAdoSdk();

      const context = getWebContext();
      expect(context).toBeDefined();
      expect(context?.project?.name).toBe("test-project");
      expect(context?.project?.id).toBe("proj-456");
    });
  });

  describe("getExtensionDataService", () => {
    let originalFetch: typeof global.fetch;

    beforeEach(async () => {
      originalFetch = global.fetch;
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "test-key", value: "test-value" }),
        }),
      ) as unknown as typeof global.fetch;
      // SDK must be initialized before getExtensionDataService can resolve
      await initializeAdoSdk();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("returns object with getValue and setValue methods", async () => {
      const client = await getExtensionDataService();
      expect(typeof client.getValue).toBe("function");
      expect(typeof client.setValue).toBe("function");
    });

    it("defers getAccessToken to per-request (not construction time)", async () => {
      const ds = await getExtensionDataService();
      // Token is NOT fetched at construction — only when a request is made
      expect(mockSdkModule.getAccessToken).not.toHaveBeenCalled();

      // After a getValue call, the token should be fetched
      const mockFetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "k", value: "v" }),
        }),
      );
      (global as unknown as { fetch: jest.Mock }).fetch = mockFetch;
      await ds.getValue("k", { scopeType: "User", defaultValue: "" });
      expect(mockSdkModule.getAccessToken).toHaveBeenCalled();
    });

    it("calls getExtensionContext for REST URL construction", async () => {
      await getExtensionDataService();
      expect(mockSdkModule.getExtensionContext).toHaveBeenCalled();
    });

    it("getValue uses direct REST call, not XDM proxy", async () => {
      const client = await getExtensionDataService();
      await client.getValue("test-key", { scopeType: "User" });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const url = (global.fetch as jest.Mock).mock.calls.at(0)?.[0] as string;
      expect(url).toContain("_apis/ExtensionManagement/InstalledExtensions");
      expect(url).toContain("Scopes/User/Me");
      expect(url).toContain("test-key");
      // Must NOT call the old XDM data service
      expect(mockSdkModule.getService).not.toHaveBeenCalledWith(
        "ms.vss-features.extension-data-service",
      );
    });

    it("getValue returns defaultValue on 404", async () => {
      const client = await getExtensionDataService();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const result = await client.getValue("missing", {
        scopeType: "User",
        defaultValue: "fallback",
      });
      expect(result).toBe("fallback");
    });

    it("setValue sends PUT with document envelope", async () => {
      const client = await getExtensionDataService();
      await client.setValue("my-key", 42, { scopeType: "User" });

      const call = (global.fetch as jest.Mock).mock.calls.at(0);
      const url = call?.[0] as string;
      const opts = call?.[1] as RequestInit;
      expect(url).toContain("my-key");
      expect(opts.method).toBe("PUT");
      expect(JSON.parse(opts.body as string)).toEqual({
        id: "my-key",
        value: 42,
      });
    });

    it("getValue throws on non-ok, non-404 response", async () => {
      const client = await getExtensionDataService();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(
        client.getValue("key", { scopeType: "User" }),
      ).rejects.toThrow("Extension data GET failed: 500");
    });

    it("getValue returns raw doc when response has no value property", async () => {
      const client = await getExtensionDataService();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve("raw-string-value"),
      });

      const result = await client.getValue<string>("key", {
        scopeType: "User",
      });
      expect(result).toBe("raw-string-value");
    });

    it("setValue throws on non-ok response", async () => {
      const client = await getExtensionDataService();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });

      await expect(
        client.setValue("key", "val", { scopeType: "User" }),
      ).rejects.toThrow("Extension data PUT failed: 403");
    });

    it("setValue returns raw doc when response has no value property", async () => {
      const client = await getExtensionDataService();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve("raw-put-result"),
      });

      const result = await client.setValue("key", "val", { scopeType: "User" });
      expect(result).toBe("raw-put-result");
    });

    it("getValue without options defaults to non-User scope and returns undefined on 404 (closes sdk.ts L229, L230, L252)", async () => {
      // Call with no options: `options?.scopeType` is undefined (≠ "User")
      // so the buildUrl ternaries at L229/230 take the "Default"/"Current"
      // branches. On 404 `options?.defaultValue ?? undefined` takes the
      // left-nullish branch at L252.
      const client = await getExtensionDataService();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const result = await client.getValue("missing-key");

      expect(result).toBeUndefined();
      const url = (global.fetch as jest.Mock).mock.calls.at(-1)?.[0] as string;
      expect(url).toContain("Scopes/Default/Current");
    });
  });

  describe("getCollectionUri", () => {
    it("returns the mock resource area location", async () => {
      const uri = await getCollectionUri();
      expect(uri).toBe("https://dev.azure.com/test-org/");
    });

    it("calls getService with LocationService ID", async () => {
      await getCollectionUri();
      expect(mockSdkModule.getService).toHaveBeenCalledWith(
        "ms.vss-features.location-service",
      );
    });

    it("uses getResourceAreaLocation, not getServiceLocation", async () => {
      await getCollectionUri();

      // Retrieve the mock location service from the last getService call
      const locationService = await mockSdkModule.getService(
        "ms.vss-features.location-service",
      );
      const svc = locationService as unknown as {
        getResourceAreaLocation: jest.Mock;
        getServiceLocation: jest.Mock;
      };

      expect(svc.getResourceAreaLocation).toHaveBeenCalledWith(
        "79134c72-4a58-4b42-976c-04e7115f32bf",
      );
      expect(svc.getServiceLocation).not.toHaveBeenCalled();
    });

    it("normalizes URI without trailing slash", async () => {
      setMockServiceLocation("https://dev.azure.com/test-org");
      const uri = await getCollectionUri();
      expect(uri).toBe("https://dev.azure.com/test-org/");
    });

    it("preserves URI that already has trailing slash", async () => {
      setMockServiceLocation("https://dev.azure.com/test-org/");
      const uri = await getCollectionUri();
      expect(uri).toBe("https://dev.azure.com/test-org/");
    });

    it("preserves Server-style collection path segment", async () => {
      setMockServiceLocation(
        "https://tfs.example.com:8080/tfs/DefaultCollection/",
      );
      const uri = await getCollectionUri();
      expect(uri).toBe("https://tfs.example.com:8080/tfs/DefaultCollection/");
    });

    it("normalizes Server-style path without trailing slash", async () => {
      setMockServiceLocation(
        "https://tfs.example.com:8080/tfs/DefaultCollection",
      );
      const uri = await getCollectionUri();
      expect(uri).toBe("https://tfs.example.com:8080/tfs/DefaultCollection/");
    });

    it("caches the resolved URI and does not call getService again", async () => {
      const first = await getCollectionUri();
      mockSdkModule.getService.mockClear();

      const second = await getCollectionUri();
      expect(second).toBe(first);
      expect(mockSdkModule.getService).not.toHaveBeenCalled();
    });
  });

  describe("getAccessToken", () => {
    it("returns a string token (not { token })", async () => {
      const token = await getAccessToken();
      expect(typeof token).toBe("string");
      expect(token).toBe("mock-access-token-12345");
    });

    it("calls SDK.getAccessToken fresh on each non-concurrent invocation", async () => {
      mockSdkModule.getAccessToken
        .mockResolvedValueOnce("token-1")
        .mockResolvedValueOnce("token-2");

      const first = await getAccessToken();
      const second = await getAccessToken();

      expect(first).toBe("token-1");
      expect(second).toBe("token-2");
      expect(mockSdkModule.getAccessToken).toHaveBeenCalledTimes(2);
    });

    it("deduplicates concurrent calls within the same tick", async () => {
      let resolveToken: (value: string) => void;
      mockSdkModule.getAccessToken.mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveToken = resolve;
        }),
      );

      // Two concurrent calls before the first resolves
      const promise1 = getAccessToken();
      const promise2 = getAccessToken();

      resolveToken!("shared-token");

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toBe("shared-token");
      expect(result2).toBe("shared-token");
      // Only one SDK call — both callers shared the in-flight promise
      expect(mockSdkModule.getAccessToken).toHaveBeenCalledTimes(1);
    });

    it("yields a fresh token after the in-flight promise resolves", async () => {
      mockSdkModule.getAccessToken
        .mockResolvedValueOnce("batch-1-token")
        .mockResolvedValueOnce("batch-2-token");

      // First batch
      const first = await getAccessToken();
      expect(first).toBe("batch-1-token");

      // After resolution, next call gets a fresh token
      const second = await getAccessToken();
      expect(second).toBe("batch-2-token");
      expect(mockSdkModule.getAccessToken).toHaveBeenCalledTimes(2);
    });

    it("resetSdkState clears in-flight token state", async () => {
      mockSdkModule.getAccessToken.mockResolvedValueOnce("before-reset");
      await getAccessToken();

      resetSdkState();

      mockSdkModule.getAccessToken.mockResolvedValueOnce("after-reset");
      const token = await getAccessToken();
      expect(token).toBe("after-reset");
    });
  });

  describe("getExtensionDataService token freshness", () => {
    it("resolves a fresh token per getValue/setValue call", async () => {
      await initializeAdoSdk();

      // Setup mock fetch
      const mockFetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "key", value: "val" }),
        }),
      );
      (global as unknown as { fetch: jest.Mock }).fetch = mockFetch;

      mockSdkModule.getAccessToken
        .mockResolvedValueOnce("token-A")
        .mockResolvedValueOnce("token-B");

      const ds = await getExtensionDataService();

      await ds.getValue("some-key", { scopeType: "User", defaultValue: "" });
      await ds.getValue("other-key", { scopeType: "User", defaultValue: "" });

      // Each getValue call should have used a different token
      const call1 = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
      const call2 = mockFetch.mock.calls[1] as unknown as [string, RequestInit];
      const authHeader1 = call1[1].headers as Record<string, string>;
      const authHeader2 = call2[1].headers as Record<string, string>;

      expect(authHeader1.Authorization).toBe("Bearer token-A");
      expect(authHeader2.Authorization).toBe("Bearer token-B");
    });
  });

  describe("module-level state isolation", () => {
    it("state is shared across multiple imports", () => {
      expect(isSdkInitialized()).toBe(false);
      resetSdkState();
      expect(isSdkInitialized()).toBe(false);
    });

    it("resetSdkState affects subsequent isSdkInitialized calls", async () => {
      await initializeAdoSdk();
      expect(isSdkInitialized()).toBe(true);

      resetSdkState();
      expect(isSdkInitialized()).toBe(false);
    });
  });
});
