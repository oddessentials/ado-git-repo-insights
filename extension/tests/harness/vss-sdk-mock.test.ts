/**
 * VSS SDK Mock Tests
 *
 * Tests for the VSS SDK mock allowlist.
 * Verifies all 6 allowlisted functions are mocked correctly.
 *
 * @module tests/harness/vss-sdk-mock.test.ts
 */

import {
  setupVssMocks,
  resetVssMocks,
  teardownVssMocks,
  isVssMocksSetup,
  setMockWebContext,
  getMockWebContext,
  setMockSettingValue,
  getMockSettingValue,
  clearMockSettings,
  getMockExtensionDataService,
  getMockBuildRestClient,
  defaultMockWebContext,
  setMockBuilds,
  setMockBuild,
  setMockArtifacts,
  setMockSettingError,
  setMockServiceError,
  getVssMocks,
  setMockReadyAsync,
  trackMockInitOptions,
  type VssSdkMocks,
} from "./vss-sdk-mock";

describe("VSS SDK Mock", () => {
  afterEach(() => {
    teardownVssMocks();
  });

  describe("setupVssMocks", () => {
    it("creates VSS global object", () => {
      expect((global as unknown as { VSS?: VssSdkMocks }).VSS).toBeUndefined();

      setupVssMocks();

      expect((global as unknown as { VSS?: VssSdkMocks }).VSS).toBeDefined();
    });

    it("returns mock object for assertions", () => {
      const mocks = setupVssMocks();

      expect(mocks).toHaveProperty("init");
      expect(mocks).toHaveProperty("ready");
      expect(mocks).toHaveProperty("notifyLoadSucceeded");
      expect(mocks).toHaveProperty("getWebContext");
      expect(mocks).toHaveProperty("getService");
      expect(mocks).toHaveProperty("require");
      expect(mocks).toHaveProperty("ServiceIds");
    });

    it("sets up all 6 allowlisted functions", () => {
      const mocks = setupVssMocks();

      // 1. VSS.init()
      expect(typeof mocks.init).toBe("function");

      // 2. VSS.ready()
      expect(typeof mocks.ready).toBe("function");

      // 3. VSS.notifyLoadSucceeded()
      expect(typeof mocks.notifyLoadSucceeded).toBe("function");

      // 4. VSS.getWebContext()
      expect(typeof mocks.getWebContext).toBe("function");

      // 5. VSS.getService()
      expect(typeof mocks.getService).toBe("function");

      // 6. VSS.require()
      expect(typeof mocks.require).toBe("function");
    });

    it("provides ServiceIds.ExtensionData", () => {
      const mocks = setupVssMocks();

      expect(mocks.ServiceIds.ExtensionData).toBe(
        "ms.vss-features.extension-data-service",
      );
    });
  });

  describe("isVssMocksSetup", () => {
    it("returns false when mocks not set up", () => {
      expect(isVssMocksSetup()).toBe(false);
    });

    it("returns true after setupVssMocks", () => {
      setupVssMocks();

      expect(isVssMocksSetup()).toBe(true);
    });

    it("returns false after teardownVssMocks", () => {
      setupVssMocks();
      teardownVssMocks();

      expect(isVssMocksSetup()).toBe(false);
    });
  });

  describe("VSS.init()", () => {
    it("can be called without error", () => {
      const mocks = setupVssMocks();

      expect(() => mocks.init()).not.toThrow();
    });

    it("records call for assertions", () => {
      const mocks = setupVssMocks();

      mocks.init();

      expect(mocks.init).toHaveBeenCalled();
    });
  });

  describe("VSS.ready()", () => {
    it("executes callback immediately", () => {
      const mocks = setupVssMocks();
      let executed = false;

      mocks.ready(() => {
        executed = true;
      });

      expect(executed).toBe(true);
    });

    it("records call for assertions", () => {
      const mocks = setupVssMocks();

      mocks.ready(() => {});

      expect(mocks.ready).toHaveBeenCalled();
    });
  });

  describe("VSS.notifyLoadSucceeded()", () => {
    it("can be called without error", () => {
      const mocks = setupVssMocks();

      expect(() => mocks.notifyLoadSucceeded()).not.toThrow();
    });

    it("records call for assertions", () => {
      const mocks = setupVssMocks();

      mocks.notifyLoadSucceeded();

      expect(mocks.notifyLoadSucceeded).toHaveBeenCalled();
    });
  });

  describe("VSS.getWebContext()", () => {
    it("returns default mock context", () => {
      const mocks = setupVssMocks();

      const context = mocks.getWebContext();

      expect(context.account.name).toBe("test-org");
      expect(context.project.name).toBe("test-project");
      expect(context.user.name).toBe("Test User");
    });

    it("returns context with all expected properties", () => {
      const mocks = setupVssMocks();

      const context = mocks.getWebContext();

      expect(context).toHaveProperty("account");
      expect(context).toHaveProperty("project");
      expect(context).toHaveProperty("user");
      expect(context.account).toHaveProperty("name");
      expect(context.account).toHaveProperty("id");
      expect(context.project).toHaveProperty("name");
      expect(context.project).toHaveProperty("id");
      expect(context.user).toHaveProperty("name");
      expect(context.user).toHaveProperty("id");
    });
  });

  describe("VSS.getService()", () => {
    it("returns extension data service", async () => {
      const mocks = setupVssMocks();

      const service = await mocks.getService(mocks.ServiceIds.ExtensionData);

      expect(service).toBeDefined();
      expect(service).toHaveProperty("getValue");
      expect(service).toHaveProperty("setValue");
    });

    it("returns service with all expected methods", async () => {
      const mocks = setupVssMocks();

      const service = await mocks.getService(mocks.ServiceIds.ExtensionData);

      expect(typeof service.getValue).toBe("function");
      expect(typeof service.setValue).toBe("function");
      expect(typeof service.getDocument).toBe("function");
      expect(typeof service.setDocument).toBe("function");
      expect(typeof service.createDocument).toBe("function");
      expect(typeof service.deleteDocument).toBe("function");
      expect(typeof service.getDocuments).toBe("function");
      expect(typeof service.queryCollections).toBe("function");
    });
  });

  describe("VSS.require()", () => {
    it("executes callback with TFS/Build/RestClient", () => {
      const mocks = setupVssMocks();
      let buildClient: { getClient: () => unknown } | undefined;

      mocks.require(
        ["TFS/Build/RestClient"],
        (client: { getClient: () => unknown }) => {
          buildClient = client;
        },
      );

      expect(buildClient).toBeDefined();
      expect(buildClient?.getClient).toBeDefined();
    });

    it("returns mock build client with expected methods", () => {
      const mocks = setupVssMocks();
      let restClient: ReturnType<typeof getMockBuildRestClient> | undefined;

      mocks.require(
        ["TFS/Build/RestClient"],
        (client: { getClient: () => unknown }) => {
          restClient = client.getClient() as ReturnType<
            typeof getMockBuildRestClient
          >;
        },
      );

      expect(restClient).toBeDefined();
      expect(typeof restClient?.getBuilds).toBe("function");
      expect(typeof restClient?.getBuild).toBe("function");
      expect(typeof restClient?.getArtifact).toBe("function");
      expect(typeof restClient?.getArtifacts).toBe("function");
    });

    it("executes callback for unknown dependencies", () => {
      const mocks = setupVssMocks();
      let called = false;

      mocks.require(["Unknown/Module"], () => {
        called = true;
      });

      expect(called).toBe(true);
    });
  });

  describe("resetVssMocks", () => {
    it("resets web context to default", () => {
      setupVssMocks();
      setMockWebContext({ account: { name: "custom-org", id: "custom-id" } });
      expect(getMockWebContext().account.name).toBe("custom-org");

      resetVssMocks();

      expect(getMockWebContext().account.name).toBe("test-org");
    });

    it("clears settings storage", () => {
      setupVssMocks();
      setMockSettingValue("test-key", "test-value");
      expect(getMockSettingValue("test-key")).toBe("test-value");

      resetVssMocks();

      expect(getMockSettingValue("test-key")).toBeUndefined();
    });

    it("clears mock call histories", () => {
      const mocks = setupVssMocks();
      mocks.init();
      mocks.notifyLoadSucceeded();
      expect(mocks.init).toHaveBeenCalled();

      resetVssMocks();

      expect(mocks.init).not.toHaveBeenCalled();
    });
  });

  describe("teardownVssMocks", () => {
    it("removes VSS global object", () => {
      setupVssMocks();
      expect((global as unknown as { VSS?: VssSdkMocks }).VSS).toBeDefined();

      teardownVssMocks();

      expect((global as unknown as { VSS?: VssSdkMocks }).VSS).toBeUndefined();
    });

    it("resets all mock state", () => {
      setupVssMocks();
      setMockWebContext({ account: { name: "custom", id: "id" } });
      setMockSettingValue("key", "value");

      teardownVssMocks();
      setupVssMocks();

      expect(getMockWebContext().account.name).toBe("test-org");
      expect(getMockSettingValue("key")).toBeUndefined();
    });
  });

  describe("setMockWebContext", () => {
    beforeEach(() => {
      setupVssMocks();
    });

    it("updates account name", () => {
      setMockWebContext({ account: { name: "new-org", id: "new-id" } });

      const context = getMockWebContext();
      expect(context.account.name).toBe("new-org");
    });

    it("updates project name", () => {
      setMockWebContext({ project: { name: "new-project", id: "proj-id" } });

      const context = getMockWebContext();
      expect(context.project.name).toBe("new-project");
    });

    it("updates user name", () => {
      setMockWebContext({ user: { name: "New User", id: "user-id" } });

      const context = getMockWebContext();
      expect(context.user.name).toBe("New User");
    });

    it("merges with default values", () => {
      setMockWebContext({ account: { name: "custom", id: "id" } });

      const context = getMockWebContext();
      expect(context.account.name).toBe("custom");
      expect(context.project.name).toBe("test-project"); // Default preserved
    });
  });

  describe("setMockSettingValue / getMockSettingValue", () => {
    beforeEach(() => {
      setupVssMocks();
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
      setupVssMocks();
    });

    it("clears all stored settings", () => {
      setMockSettingValue("key1", "value1");
      setMockSettingValue("key2", "value2");

      clearMockSettings();

      expect(getMockSettingValue("key1")).toBeUndefined();
      expect(getMockSettingValue("key2")).toBeUndefined();
    });
  });

  describe("Extension Data Service integration", () => {
    beforeEach(() => {
      setupVssMocks();
    });

    it("getValue returns stored setting", async () => {
      setMockSettingValue("test-key", "test-value");
      const service = getMockExtensionDataService();

      const value = await service.getValue("test-key");

      expect(value).toBe("test-value");
    });

    it("setValue stores and returns value", async () => {
      const service = getMockExtensionDataService();

      const result = await service.setValue("new-key", "new-value");

      expect(result).toBe("new-value");
      expect(getMockSettingValue("new-key")).toBe("new-value");
    });

    it("returns null for missing values", async () => {
      const service = getMockExtensionDataService();

      const value = await service.getValue("missing-key");

      expect(value).toBeNull();
    });
  });

  describe("Build REST Client integration", () => {
    beforeEach(() => {
      setupVssMocks();
    });

    it("getBuilds returns empty array by default", async () => {
      const client = getMockBuildRestClient();

      const builds = await client.getBuilds();

      expect(builds).toEqual([]);
    });

    it("getBuild returns null by default", async () => {
      const client = getMockBuildRestClient();

      const build = await client.getBuild();

      expect(build).toBeNull();
    });

    it("getArtifacts returns empty array by default", async () => {
      const client = getMockBuildRestClient();

      const artifacts = await client.getArtifacts();

      expect(artifacts).toEqual([]);
    });
  });

  describe("defaultMockWebContext", () => {
    it("has expected structure", () => {
      expect(defaultMockWebContext).toEqual({
        account: { name: "test-org", id: "org-123" },
        project: { name: "test-project", id: "proj-456" },
        user: { name: "Test User", id: "user-789", email: "test@example.com" },
        host: { name: "dev.azure.com", id: "host-001" },
        team: { name: "Test Team", id: "team-001" },
      });
    });

    it("is immutable (throws when attempting to modify)", () => {
      // Shallow copy still references frozen nested objects
      const copy = { ...defaultMockWebContext };

      // Attempting to modify a frozen nested object throws in strict mode
      expect(() => {
        copy.account.name = "modified";
      }).toThrow();

      // Original value is preserved
      expect(defaultMockWebContext.account.name).toBe("test-org");
    });
  });

  describe("setMockBuilds", () => {
    beforeEach(() => {
      setupVssMocks();
    });

    it("configures getBuilds to return specified builds", async () => {
      const mockBuilds = [
        { id: 1, name: "Build 1" },
        { id: 2, name: "Build 2" },
      ];

      setMockBuilds(mockBuilds);

      const client = getMockBuildRestClient();
      const result = await client.getBuilds();
      expect(result).toEqual(mockBuilds);
    });
  });

  describe("setMockBuild", () => {
    beforeEach(() => {
      setupVssMocks();
    });

    it("configures getBuild to return specified build", async () => {
      const mockBuild = { id: 123, name: "Test Build" };

      setMockBuild(mockBuild);

      const client = getMockBuildRestClient();
      const result = await client.getBuild();
      expect(result).toEqual(mockBuild);
    });
  });

  describe("setMockArtifacts", () => {
    beforeEach(() => {
      setupVssMocks();
    });

    it("configures getArtifacts to return specified artifacts", async () => {
      const mockArtifacts = [{ name: "drop", resource: {} }];

      setMockArtifacts(mockArtifacts);

      const client = getMockBuildRestClient();
      const result = await client.getArtifacts();
      expect(result).toEqual(mockArtifacts);
    });
  });

  describe("setMockSettingError", () => {
    beforeEach(() => {
      setupVssMocks();
    });

    it("configures getValue to throw error for specific key", async () => {
      const error = new Error("Permission denied");

      setMockSettingError("restricted-key", error);

      const service = getMockExtensionDataService();
      await expect(service.getValue("restricted-key")).rejects.toThrow(
        "Permission denied",
      );
    });

    it("still allows other keys to work", async () => {
      setMockSettingValue("allowed-key", "allowed-value");
      setMockSettingError("restricted-key", new Error("Denied"));

      const service = getMockExtensionDataService();
      const result = await service.getValue("allowed-key");
      expect(result).toBe("allowed-value");
    });
  });

  describe("setMockServiceError", () => {
    beforeEach(() => {
      setupVssMocks();
    });

    it("configures getService to throw error for specific service", async () => {
      const error = new Error("Service unavailable");

      setMockServiceError("ms.vss-features.extension-data-service", error);

      const mocks = getVssMocks();
      await expect(
        mocks.getService("ms.vss-features.extension-data-service"),
      ).rejects.toThrow("Service unavailable");
    });
  });

  describe("getVssMocks", () => {
    it("throws when mocks not set up", () => {
      expect(() => getVssMocks()).toThrow("VSS mocks not set up");
    });

    it("returns VSS mocks when set up", () => {
      setupVssMocks();

      const mocks = getVssMocks();
      expect(mocks).toBeDefined();
      expect(mocks.init).toBeDefined();
    });
  });

  describe("setMockReadyAsync", () => {
    beforeEach(() => {
      setupVssMocks();
    });

    it("delays callback execution", async () => {
      setMockReadyAsync(50);
      let executed = false;

      const mocks = getVssMocks();
      mocks.ready(() => {
        executed = true;
      });

      // Should not be executed immediately
      expect(executed).toBe(false);

      // Wait for delay
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(executed).toBe(true);
    });
  });

  describe("trackMockInitOptions", () => {
    beforeEach(() => {
      setupVssMocks();
    });

    it("tracks init options passed to VSS.init()", () => {
      const getLastOptions = trackMockInitOptions();
      const mocks = getVssMocks();

      mocks.init({ explicitNotifyLoaded: true });

      expect(getLastOptions()).toEqual({ explicitNotifyLoaded: true });
    });

    it("tracks multiple init calls", () => {
      const getLastOptions = trackMockInitOptions();
      const mocks = getVssMocks();

      mocks.init({ first: true });
      mocks.init({ second: true });

      expect(getLastOptions()).toEqual({ second: true });
    });
  });
});
