/**
 * SDK Module Tests
 *
 * Comprehensive tests for the shared SDK initialization module including:
 * - Local mode detection (isLocalMode, getLocalDatasetPath)
 * - SDK state management (isSdkInitialized, resetSdkState)
 * - SDK initialization timeout, callback behavior, and idempotency
 * - Build client retrieval (getBuildClient)
 * - Extension data service access (getExtensionDataService)
 * - Web context access (getWebContext)
 */

import {
  isLocalMode,
  getLocalDatasetPath,
  isSdkInitialized,
  resetSdkState,
  initializeAdoSdk,
  getWebContext,
  getBuildClient,
  getExtensionDataService,
} from "../../ui/modules/sdk";

// Store original window properties for cleanup
const originalLocalDashboardMode = (
  window as { LOCAL_DASHBOARD_MODE?: boolean }
).LOCAL_DASHBOARD_MODE;
const originalDatasetPath = (window as { DATASET_PATH?: string }).DATASET_PATH;

describe("SDK Module", () => {
  beforeEach(() => {
    // Reset SDK state before each test
    resetSdkState();
    // Reset window properties
    delete (window as { LOCAL_DASHBOARD_MODE?: boolean }).LOCAL_DASHBOARD_MODE;
    delete (window as { DATASET_PATH?: string }).DATASET_PATH;
  });

  afterAll(() => {
    // Restore original window properties
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
      // Test that only explicit true triggers local mode
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
      expect(isSdkInitialized()).toBe(false); // Multiple calls should be consistent
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
    // Mock VSS global for initialization tests
    const mockWebContext = {
      project: { name: "TestProject", id: "test-id" },
      user: { name: "TestUser", id: "user-id" },
      host: { name: "org.visualstudio.com" },
    };

    const mockVSS = {
      init: jest.fn(),
      ready: jest.fn((callback: () => void) => {
        // Simulate async ready callback
        setTimeout(callback, 10);
      }),
      notifyLoadSucceeded: jest.fn(),
      getWebContext: jest.fn(() => mockWebContext),
    };

    beforeEach(() => {
      // Setup VSS mock
      (global as unknown as { VSS: typeof mockVSS }).VSS = mockVSS;
      jest.clearAllMocks();
      resetSdkState();
    });

    afterEach(() => {
      // Clean up VSS mock
      delete (global as unknown as { VSS?: typeof mockVSS }).VSS;
    });

    it("calls VSS.init with correct options", async () => {
      await initializeAdoSdk();

      expect(mockVSS.init).toHaveBeenCalledWith({
        explicitNotifyLoaded: true,
        usePlatformScripts: true,
        usePlatformStyles: true,
      });
    });

    it("sets SDK as initialized after VSS.ready", async () => {
      await initializeAdoSdk();
      expect(isSdkInitialized()).toBe(true);
    });

    it("calls VSS.notifyLoadSucceeded after ready", async () => {
      await initializeAdoSdk();
      expect(mockVSS.notifyLoadSucceeded).toHaveBeenCalled();
    });

    it("executes onReady callback when provided", async () => {
      const onReady = jest.fn();
      await initializeAdoSdk({ onReady });
      expect(onReady).toHaveBeenCalled();
    });

    it("onReady callback is called before notifyLoadSucceeded", async () => {
      const callOrder: string[] = [];
      mockVSS.notifyLoadSucceeded.mockImplementation(() => {
        callOrder.push("notifyLoadSucceeded");
      });
      const onReady = jest.fn(() => callOrder.push("onReady"));

      await initializeAdoSdk({ onReady });

      expect(callOrder).toEqual(["onReady", "notifyLoadSucceeded"]);
    });

    it("skips initialization if already initialized", async () => {
      await initializeAdoSdk();
      jest.clearAllMocks();

      await initializeAdoSdk();
      expect(mockVSS.init).not.toHaveBeenCalled();
    });

    it("uses default timeout of 10000ms", async () => {
      // Verify default timeout by checking it doesn't reject quickly
      const fastVSS = {
        ...mockVSS,
        ready: jest.fn((callback: () => void) => {
          setTimeout(callback, 5);
        }),
      };
      (global as unknown as { VSS: typeof fastVSS }).VSS = fastVSS;

      await expect(initializeAdoSdk()).resolves.toBeUndefined();
    });

    it("rejects on timeout", async () => {
      const slowVSS = {
        ...mockVSS,
        ready: jest.fn(), // Never calls the callback
      };
      (global as unknown as { VSS: typeof slowVSS }).VSS = slowVSS;
      resetSdkState();

      await expect(initializeAdoSdk({ timeout: 50 })).rejects.toThrow(
        "Azure DevOps SDK initialization timed out",
      );
    });

    it("allows getWebContext after initialization", async () => {
      await initializeAdoSdk();

      const context = getWebContext();
      expect(context).toEqual(mockWebContext);
      expect(mockVSS.getWebContext).toHaveBeenCalled();
    });
  });

  describe("getBuildClient", () => {
    it("resolves with Build REST client via VSS.require", async () => {
      const mockBuildClient = {
        getBuilds: jest.fn(),
        getDefinitions: jest.fn(),
      };
      const mockBuildRestClient = {
        getClient: jest.fn(() => mockBuildClient),
      };

      // Setup VSS.require mock
      const mockVSS = {
        require: jest.fn(
          (modules: string[], callback: (...args: unknown[]) => void) => {
            expect(modules).toEqual(["TFS/Build/RestClient"]);
            callback(mockBuildRestClient);
          },
        ),
      };
      (global as unknown as { VSS: typeof mockVSS }).VSS = mockVSS;

      const client = await getBuildClient();

      expect(client).toBe(mockBuildClient);
      expect(mockBuildRestClient.getClient).toHaveBeenCalled();

      // Cleanup
      delete (global as unknown as { VSS?: typeof mockVSS }).VSS;
    });
  });

  describe("getExtensionDataService", () => {
    it("resolves via VSS.getService with ExtensionData service ID", async () => {
      const mockDataService = {
        getValue: jest.fn(),
        setValue: jest.fn(),
      };

      // Setup VSS mock
      const mockVSS = {
        getService: jest.fn(() => Promise.resolve(mockDataService)),
        ServiceIds: {
          ExtensionData: "extension-data-service-id",
        },
      };
      (global as unknown as { VSS: typeof mockVSS }).VSS = mockVSS;

      const service = await getExtensionDataService();

      expect(service).toBe(mockDataService);
      expect(mockVSS.getService).toHaveBeenCalledWith(
        "extension-data-service-id",
      );

      // Cleanup
      delete (global as unknown as { VSS?: typeof mockVSS }).VSS;
    });
  });

  describe("module-level state isolation", () => {
    it("state is shared across multiple imports", () => {
      // This test verifies the module singleton pattern
      expect(isSdkInitialized()).toBe(false);
      resetSdkState();
      expect(isSdkInitialized()).toBe(false);
    });

    it("resetSdkState affects subsequent isSdkInitialized calls", async () => {
      const mockVSS = {
        init: jest.fn(),
        ready: jest.fn((callback: () => void) => setTimeout(callback, 5)),
        notifyLoadSucceeded: jest.fn(),
        getWebContext: jest.fn(),
      };
      (global as unknown as { VSS: typeof mockVSS }).VSS = mockVSS;

      await initializeAdoSdk();
      expect(isSdkInitialized()).toBe(true);

      resetSdkState();
      expect(isSdkInitialized()).toBe(false);

      delete (global as unknown as { VSS?: typeof mockVSS }).VSS;
    });
  });
});
