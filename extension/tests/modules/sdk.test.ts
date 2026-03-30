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
          resizeCalledDuringOnReady = mockSdkModule.resize.mock.calls.length > 0;
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
      mockSdkModule.ready.mockImplementation(
        () => new Promise<void>(() => {}),
      );
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

    it("allows retry after timeout", async () => {
      // First attempt: ready hangs, times out
      mockSdkModule.ready.mockImplementation(
        () => new Promise<void>(() => {}),
      );
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
    it("returns object with getValue and setValue methods", async () => {
      const manager = await getExtensionDataService();
      expect(typeof manager.getValue).toBe("function");
      expect(typeof manager.setValue).toBe("function");
    });

    it("calls getService with ExtensionDataService ID", async () => {
      await getExtensionDataService();
      expect(mockSdkModule.getService).toHaveBeenCalledWith(
        "ms.vss-features.extension-data-service",
      );
    });

    it("calls getAccessToken for data manager creation", async () => {
      await getExtensionDataService();
      expect(mockSdkModule.getAccessToken).toHaveBeenCalled();
    });

    it("calls getExtensionContext for data manager creation", async () => {
      await getExtensionDataService();
      expect(mockSdkModule.getExtensionContext).toHaveBeenCalled();
    });
  });

  describe("getCollectionUri", () => {
    it("returns the mock service location", async () => {
      const uri = await getCollectionUri();
      expect(uri).toBe("https://dev.azure.com/test-org/");
    });

    it("calls getService with LocationService ID", async () => {
      await getCollectionUri();
      expect(mockSdkModule.getService).toHaveBeenCalledWith(
        "ms.vss-features.location-service",
      );
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
  });

  describe("getAccessToken", () => {
    it("returns a string token (not { token })", async () => {
      const token = await getAccessToken();
      expect(typeof token).toBe("string");
      expect(token).toBe("mock-access-token-12345");
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
