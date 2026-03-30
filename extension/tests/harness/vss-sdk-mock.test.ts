/**
 * Azure DevOps Extension SDK Mock Harness Tests
 *
 * Verifies the mock harness for azure-devops-extension-sdk and
 * azure-devops-extension-api provides correct mock behavior.
 *
 * @module tests/harness/vss-sdk-mock.test.ts
 */

import {
  setupSdkMocks,
  resetSdkMocks,
  teardownSdkMocks,
  setMockWebContext,
  getMockWebContext,
  setMockSettingValue,
  getMockSettingValue,
  clearMockSettings,
  getMockExtensionDataManager,
  getMockCoreRestClient,
  defaultMockWebContext,
  defaultMockUserContext,
  defaultMockHostContext,
  defaultMockExtensionContext,
  setMockBuilds,
  setMockBuild,
  setMockArtifacts,
  setMockSettingError,
  setMockServiceError,
  setMockReadyAsync,
  setMockAccessToken,
  setMockServiceLocation,
  trackMockInitOptions,
  configureExtensionDataService,
  mockValidDashboardSettings,
  mockMissingDashboardSettings,
  mockInvalidDashboardSettings,
  mockDashboardSettingsError,
  mockSdkModule,
  mockApiModule,
  type MockExtensionDataService,
  type MockLocationService,
} from "./vss-sdk-mock";

describe("Azure DevOps Extension SDK Mock Harness", () => {
  afterEach(() => {
    teardownSdkMocks();
  });

  describe("mockSdkModule", () => {
    it("exports all SDK functions", () => {
      expect(mockSdkModule).toHaveProperty("init");
      expect(mockSdkModule).toHaveProperty("ready");
      expect(mockSdkModule).toHaveProperty("notifyLoadSucceeded");
      expect(mockSdkModule).toHaveProperty("getWebContext");
      expect(mockSdkModule).toHaveProperty("getUser");
      expect(mockSdkModule).toHaveProperty("getHost");
      expect(mockSdkModule).toHaveProperty("getExtensionContext");
      expect(mockSdkModule).toHaveProperty("getAccessToken");
      expect(mockSdkModule).toHaveProperty("getAppToken");
      expect(mockSdkModule).toHaveProperty("getService");
    });

    it("init returns a Promise", async () => {
      setupSdkMocks();
      const result = mockSdkModule.init();
      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBeUndefined();
    });

    it("ready returns a Promise", async () => {
      setupSdkMocks();
      const result = mockSdkModule.ready();
      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBeUndefined();
    });

    it("notifyLoadSucceeded returns a Promise", async () => {
      setupSdkMocks();
      const result = mockSdkModule.notifyLoadSucceeded();
      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBeUndefined();
    });

    it("getAccessToken returns a string (not { token })", async () => {
      setupSdkMocks();
      const token = await mockSdkModule.getAccessToken();
      expect(typeof token).toBe("string");
      expect(token).toBe("mock-access-token-12345");
    });

    it("getWebContext returns mock context with project and team", () => {
      setupSdkMocks();
      const ctx = mockSdkModule.getWebContext();
      expect(ctx).toHaveProperty("project");
      expect(ctx).toHaveProperty("team");
      expect(ctx.project.name).toBe("test-project");
      expect(ctx.project.id).toBe("proj-456");
    });

    it("getUser returns mock user context", () => {
      setupSdkMocks();
      const user = mockSdkModule.getUser();
      expect(user.id).toBe("user-789");
      expect(user.name).toBe("Test User");
      expect(user.displayName).toBe("Test User");
    });

    it("getHost returns mock host context", () => {
      setupSdkMocks();
      const host = mockSdkModule.getHost();
      expect(host.id).toBe("host-001");
      expect(host.name).toBe("test-org");
      expect(host.isHosted).toBe(true);
    });

    it("getExtensionContext returns mock extension context", () => {
      setupSdkMocks();
      const ext = mockSdkModule.getExtensionContext();
      expect(ext.id).toBe("publisher.extension");
      expect(ext.publisherId).toBe("publisher");
    });
  });

  describe("mockApiModule", () => {
    it("exports CommonServiceIds", () => {
      expect(mockApiModule.CommonServiceIds).toHaveProperty(
        "ExtensionDataService",
      );
      expect(mockApiModule.CommonServiceIds.ExtensionDataService).toBe(
        "ms.vss-features.extension-data-service",
      );
      expect(mockApiModule.CommonServiceIds).toHaveProperty(
        "LocationService",
      );
    });

    it("exports getClient", () => {
      expect(typeof mockApiModule.getClient).toBe("function");
    });

    it("getClient returns mock core REST client", () => {
      setupSdkMocks();
      const client = mockApiModule.getClient(null);
      expect(client).toHaveProperty("getProjects");
    });
  });

  describe("getService (data service chain)", () => {
    beforeEach(() => {
      setupSdkMocks();
    });

    it("returns data service for ExtensionDataService ID", async () => {
      const service = await mockSdkModule.getService(
        "ms.vss-features.extension-data-service",
      );
      expect(service).toHaveProperty("getExtensionDataManager");
    });

    it("data service → data manager chain works", async () => {
      const service = await mockSdkModule.getService(
        "ms.vss-features.extension-data-service",
      );
      const manager = await (service as MockExtensionDataService).getExtensionDataManager(
        "ext-id",
        "token",
      );
      expect(manager).toHaveProperty("getValue");
      expect(manager).toHaveProperty("setValue");
      expect(manager).toHaveProperty("getDocument");
      expect(manager).toHaveProperty("setDocument");
      expect(manager).toHaveProperty("createDocument");
      expect(manager).toHaveProperty("deleteDocument");
    });

    it("returns location service for LocationService ID", async () => {
      const service = await mockSdkModule.getService(
        "ms.vss-features.location-service",
      );
      expect(service).toHaveProperty("getServiceLocation");
    });

    it("rejects for unknown service ID", async () => {
      await expect(
        mockSdkModule.getService("unknown-service"),
      ).rejects.toThrow("Unknown service");
    });
  });

  describe("resetSdkMocks / setupSdkMocks", () => {
    it("resets web context to default", () => {
      setupSdkMocks();
      setMockWebContext({ project: { name: "custom", id: "custom-id" } });
      expect(getMockWebContext().project.name).toBe("custom");

      resetSdkMocks();

      expect(getMockWebContext().project.name).toBe("test-project");
    });

    it("clears settings storage", () => {
      setupSdkMocks();
      setMockSettingValue("test-key", "test-value");
      expect(getMockSettingValue("test-key")).toBe("test-value");

      resetSdkMocks();

      expect(getMockSettingValue("test-key")).toBeUndefined();
    });

    it("clears mock call histories", async () => {
      setupSdkMocks();
      await mockSdkModule.init();
      expect(mockSdkModule.init).toHaveBeenCalled();

      resetSdkMocks();

      expect(mockSdkModule.init).not.toHaveBeenCalled();
    });
  });

  describe("setMockWebContext", () => {
    beforeEach(() => {
      setupSdkMocks();
    });

    it("updates project", () => {
      setMockWebContext({ project: { name: "new-project", id: "proj-id" } });
      expect(getMockWebContext().project.name).toBe("new-project");
    });

    it("updates team", () => {
      setMockWebContext({ team: { name: "New Team", id: "team-id" } });
      expect(getMockWebContext().team.name).toBe("New Team");
    });

    it("merges with default values", () => {
      setMockWebContext({ project: { name: "custom", id: "id" } });
      const context = getMockWebContext();
      expect(context.project.name).toBe("custom");
      expect(context.team.name).toBe("Test Team"); // Default preserved
    });
  });

  describe("setMockAccessToken", () => {
    beforeEach(() => {
      setupSdkMocks();
    });

    it("changes the token returned by getAccessToken", async () => {
      setMockAccessToken("custom-token");
      const token = await mockSdkModule.getAccessToken();
      expect(token).toBe("custom-token");
    });
  });

  describe("setMockServiceLocation", () => {
    beforeEach(() => {
      setupSdkMocks();
    });

    it("changes the location returned by LocationService", async () => {
      setMockServiceLocation("https://custom.azure.com/org/");
      const service = await mockSdkModule.getService(
        "ms.vss-features.location-service",
      );
      const location = await (service as MockLocationService).getServiceLocation();
      expect(location).toBe("https://custom.azure.com/org/");
    });
  });

  describe("setMockSettingValue / getMockSettingValue", () => {
    beforeEach(() => {
      setupSdkMocks();
    });

    it("stores and retrieves setting values", () => {
      setMockSettingValue("my-setting", "my-value");
      expect(getMockSettingValue("my-setting")).toBe("my-value");
    });

    it("stores complex objects", () => {
      const complexValue = { nested: { data: [1, 2, 3] } };
      setMockSettingValue("complex", complexValue);
      expect(getMockSettingValue("complex")).toEqual(complexValue);
    });

    it("returns undefined for missing keys", () => {
      expect(getMockSettingValue("nonexistent")).toBeUndefined();
    });
  });

  describe("clearMockSettings", () => {
    beforeEach(() => {
      setupSdkMocks();
    });

    it("clears all stored settings", () => {
      setMockSettingValue("key1", "value1");
      setMockSettingValue("key2", "value2");

      clearMockSettings();

      expect(getMockSettingValue("key1")).toBeUndefined();
      expect(getMockSettingValue("key2")).toBeUndefined();
    });
  });

  describe("Extension Data Manager integration", () => {
    beforeEach(() => {
      setupSdkMocks();
    });

    it("getValue returns stored setting", async () => {
      setMockSettingValue("test-key", "test-value");
      const manager = getMockExtensionDataManager();
      const value = await manager.getValue("test-key");
      expect(value).toBe("test-value");
    });

    it("setValue stores and returns value", async () => {
      const manager = getMockExtensionDataManager();
      const result = await manager.setValue("new-key", "new-value");
      expect(result).toBe("new-value");
      expect(getMockSettingValue("new-key")).toBe("new-value");
    });

    it("returns null for missing values", async () => {
      const manager = getMockExtensionDataManager();
      const value = await manager.getValue("missing-key");
      expect(value).toBeNull();
    });
  });

  describe("Core REST Client", () => {
    beforeEach(() => {
      setupSdkMocks();
    });

    it("getProjects returns default projects", async () => {
      const client = getMockCoreRestClient();
      const projects = await client.getProjects() as Array<{ name: string; id: string }>;
      expect(projects).toHaveLength(2);
      expect(projects[0]).toHaveProperty("name", "test-project");
    });
  });

  describe("defaultMockWebContext", () => {
    it("has expected structure", () => {
      expect(defaultMockWebContext).toEqual({
        project: { name: "test-project", id: "proj-456" },
        team: { name: "Test Team", id: "team-001" },
      });
    });

    it("is immutable (throws when attempting to modify)", () => {
      const copy = { ...defaultMockWebContext };
      expect(() => {
        copy.project.name = "modified";
      }).toThrow();
      expect(defaultMockWebContext.project.name).toBe("test-project");
    });
  });

  describe("defaultMockUserContext", () => {
    it("has expected structure", () => {
      expect(defaultMockUserContext.id).toBe("user-789");
      expect(defaultMockUserContext.name).toBe("Test User");
    });
  });

  describe("defaultMockHostContext", () => {
    it("has expected structure", () => {
      expect(defaultMockHostContext.id).toBe("host-001");
      expect(defaultMockHostContext.name).toBe("test-org");
      expect(defaultMockHostContext.isHosted).toBe(true);
    });
  });

  describe("defaultMockExtensionContext", () => {
    it("has expected structure", () => {
      expect(defaultMockExtensionContext.id).toBe("publisher.extension");
    });
  });

  describe("setMockBuilds", () => {
    beforeEach(() => {
      setupSdkMocks();
    });

    it("configures getBuilds to return specified builds", async () => {
      const mockBuilds = [
        { id: 1, name: "Build 1" },
        { id: 2, name: "Build 2" },
      ];
      setMockBuilds(mockBuilds);
      const client = getMockCoreRestClient();
      const extended = client as unknown as { getBuilds: () => Promise<unknown[]> };
      const result = await extended.getBuilds();
      expect(result).toEqual(mockBuilds);
    });
  });

  describe("setMockBuild", () => {
    beforeEach(() => {
      setupSdkMocks();
    });

    it("configures getBuild to return specified build", async () => {
      const mockBuild = { id: 123, name: "Test Build" };
      setMockBuild(mockBuild);
      const client = getMockCoreRestClient();
      const extended = client as unknown as { getBuild: () => Promise<unknown> };
      const result = await extended.getBuild();
      expect(result).toEqual(mockBuild);
    });
  });

  describe("setMockArtifacts", () => {
    beforeEach(() => {
      setupSdkMocks();
    });

    it("configures getArtifacts to return specified artifacts", async () => {
      const mockArtifacts = [{ name: "drop", resource: {} }];
      setMockArtifacts(mockArtifacts);
      const client = getMockCoreRestClient();
      const extended = client as unknown as { getArtifacts: () => Promise<unknown[]> };
      const result = await extended.getArtifacts();
      expect(result).toEqual(mockArtifacts);
    });
  });

  describe("setMockSettingError", () => {
    beforeEach(() => {
      setupSdkMocks();
    });

    it("configures getValue to throw error for specific key", async () => {
      setMockSettingError("restricted-key", new Error("Permission denied"));
      const manager = getMockExtensionDataManager();
      await expect(manager.getValue("restricted-key")).rejects.toThrow(
        "Permission denied",
      );
    });

    it("still allows other keys to work", async () => {
      setMockSettingValue("allowed-key", "allowed-value");
      setMockSettingError("restricted-key", new Error("Denied"));
      const manager = getMockExtensionDataManager();
      const result = await manager.getValue("allowed-key");
      expect(result).toBe("allowed-value");
    });
  });

  describe("setMockServiceError", () => {
    beforeEach(() => {
      setupSdkMocks();
    });

    it("configures getService to throw for specific service", async () => {
      setMockServiceError(
        "ms.vss-features.extension-data-service",
        new Error("Service unavailable"),
      );
      await expect(
        mockSdkModule.getService("ms.vss-features.extension-data-service"),
      ).rejects.toThrow("Service unavailable");
    });
  });

  describe("setMockReadyAsync", () => {
    beforeEach(() => {
      setupSdkMocks();
    });

    it("delays ready resolution", async () => {
      setMockReadyAsync(50);
      const start = Date.now();
      await mockSdkModule.ready();
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(30); // Allow timing tolerance
    });
  });

  describe("trackMockInitOptions", () => {
    beforeEach(() => {
      setupSdkMocks();
    });

    it("tracks init options", async () => {
      const getLastOptions = trackMockInitOptions();
      await mockSdkModule.init({ loaded: false });
      expect(getLastOptions()).toEqual({ loaded: false });
    });

    it("tracks multiple init calls", async () => {
      const getLastOptions = trackMockInitOptions();
      await mockSdkModule.init({ loaded: false });
      await mockSdkModule.init({ loaded: true });
      expect(getLastOptions()).toEqual({ loaded: true });
    });
  });

  describe("configureExtensionDataService", () => {
    beforeEach(() => {
      setupSdkMocks();
    });

    it("configures values to return from getValue", async () => {
      configureExtensionDataService({
        values: {
          "pr-insights-source-project": "my-project",
          "pr-insights-pipeline-id": 42,
        },
      });
      const manager = getMockExtensionDataManager();
      expect(await manager.getValue("pr-insights-source-project")).toBe(
        "my-project",
      );
      expect(await manager.getValue("pr-insights-pipeline-id")).toBe(42);
    });

    it("configures missing keys to return undefined", async () => {
      configureExtensionDataService({
        missingKeys: ["pr-insights-source-project"],
      });
      const manager = getMockExtensionDataManager();
      expect(
        await manager.getValue("pr-insights-source-project"),
      ).toBeUndefined();
    });

    it("configures error keys to reject with error", async () => {
      configureExtensionDataService({
        errorKeys: {
          "pr-insights-source-project": new Error("Service unavailable"),
        },
      });
      const manager = getMockExtensionDataManager();
      await expect(
        manager.getValue("pr-insights-source-project"),
      ).rejects.toThrow("Service unavailable");
    });

    it("returns null for unconfigured keys", async () => {
      configureExtensionDataService({
        values: { "other-key": "other-value" },
      });
      const manager = getMockExtensionDataManager();
      expect(await manager.getValue("unconfigured-key")).toBeNull();
    });
  });

  describe("mockValidDashboardSettings", () => {
    beforeEach(() => {
      setupSdkMocks();
    });

    it("sets up valid dashboard settings", async () => {
      mockValidDashboardSettings();
      const manager = getMockExtensionDataManager();
      expect(await manager.getValue("pr-insights-source-project")).toBe(
        "test-project",
      );
      expect(await manager.getValue("pr-insights-pipeline-id")).toBe(123);
      expect(await manager.getValue("pr-insights-artifact-name")).toBe(
        "pr-insights-data",
      );
    });
  });

  describe("mockMissingDashboardSettings", () => {
    beforeEach(() => {
      setupSdkMocks();
    });

    it("sets up missing dashboard settings", async () => {
      mockMissingDashboardSettings();
      const manager = getMockExtensionDataManager();
      expect(
        await manager.getValue("pr-insights-source-project"),
      ).toBeUndefined();
      expect(
        await manager.getValue("pr-insights-pipeline-id"),
      ).toBeUndefined();
    });
  });

  describe("mockInvalidDashboardSettings", () => {
    beforeEach(() => {
      setupSdkMocks();
    });

    it("sets up invalid dashboard settings", async () => {
      mockInvalidDashboardSettings();
      const manager = getMockExtensionDataManager();
      expect(await manager.getValue("pr-insights-source-project")).toBe("");
      expect(await manager.getValue("pr-insights-pipeline-id")).toBe(-1);
    });
  });

  describe("mockDashboardSettingsError", () => {
    beforeEach(() => {
      setupSdkMocks();
    });

    it("sets up dashboard settings to throw errors", async () => {
      mockDashboardSettingsError();
      const manager = getMockExtensionDataManager();
      await expect(
        manager.getValue("pr-insights-source-project"),
      ).rejects.toThrow("ExtensionData service unavailable");
    });

    it("supports custom error message", async () => {
      mockDashboardSettingsError("Custom error message");
      const manager = getMockExtensionDataManager();
      await expect(
        manager.getValue("pr-insights-source-project"),
      ).rejects.toThrow("Custom error message");
    });
  });
});
