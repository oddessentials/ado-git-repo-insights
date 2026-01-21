/**
 * ADO SDK Mock Tests (Phase 4)
 *
 * Tests for the ADO Extension SDK mock infrastructure.
 */

import {
  createSdkMock,
  createBuildApiMock,
  BuildApiScenarios,
  installSdkMocks,
} from "./mocks/ado-sdk";

describe("ADO SDK Mocks", () => {
  describe("createSdkMock", () => {
    it("creates mock with default values", () => {
      const sdk = createSdkMock();

      expect(sdk.getWebContext()).toBeDefined();
      expect(sdk.getWebContext().account.name).toBe("test-org");
      expect(sdk.getWebContext().project.name).toBe("test-project");
    });

    it("allows custom access token", async () => {
      const sdk = createSdkMock({ accessToken: "custom-token" });

      const token = await sdk.getAccessToken();
      expect(token.token).toBe("custom-token");
    });

    it("allows custom web context", () => {
      const customContext = {
        account: { name: "my-org" },
        project: { name: "my-project", id: "proj-custom" },
        user: { name: "Custom User", id: "user-custom" },
      };
      const sdk = createSdkMock({ webContext: customContext });

      expect(sdk.getWebContext().account.name).toBe("my-org");
      expect(sdk.getWebContext().project.name).toBe("my-project");
    });

    it("provides required SDK methods", () => {
      const sdk = createSdkMock();

      expect(typeof sdk.getWebContext).toBe("function");
      expect(typeof sdk.getAccessToken).toBe("function");
      expect(typeof sdk.getConfiguration).toBe("function");
      expect(typeof sdk.notifyLoadSucceeded).toBe("function");
      expect(typeof sdk.notifyLoadFailed).toBe("function");
      expect(typeof sdk.resize).toBe("function");
    });
  });

  describe("createBuildApiMock", () => {
    it("returns successful runs and artifacts for SUCCESS scenario", async () => {
      const api = createBuildApiMock("SUCCESS");

      const runs = await api.getBuilds();
      expect(runs.length).toBe(1);
      expect(runs[0].result).toBe("succeeded");

      const artifacts = await api.getArtifacts();
      expect(artifacts.length).toBe(1);
      expect(artifacts[0].name).toBe("insights-output");
    });

    it("returns empty runs for NO_RUNS scenario", async () => {
      const api = createBuildApiMock("NO_RUNS");

      const runs = await api.getBuilds();
      expect(runs).toEqual([]);
    });

    it("returns empty artifacts for NO_ARTIFACTS scenario", async () => {
      const api = createBuildApiMock("NO_ARTIFACTS");

      const runs = await api.getBuilds();
      expect(runs.length).toBe(1);

      const artifacts = await api.getArtifacts();
      expect(artifacts).toEqual([]);
    });

    it("throws 403 for PERMISSION_DENIED scenario", async () => {
      const api = createBuildApiMock("PERMISSION_DENIED");

      await expect(api.getBuilds()).rejects.toMatchObject({
        status: 403,
      });
    });

    it("throws 404 for NOT_FOUND scenario", async () => {
      const api = createBuildApiMock("NOT_FOUND");

      await expect(api.getBuilds()).rejects.toMatchObject({
        status: 404,
      });
    });

    it("throws 503 for TRANSIENT_ERROR scenario", async () => {
      const api = createBuildApiMock("TRANSIENT_ERROR");

      await expect(api.getBuilds()).rejects.toMatchObject({
        status: 503,
      });
    });

    it("generates artifact content URLs", () => {
      const api = createBuildApiMock("SUCCESS");

      const url = api.getArtifactContentUrl(
        "insights-output",
        "dataset-manifest.json",
      );
      expect(url).toContain("insights-output");
      expect(url).toContain("dataset-manifest.json");
    });
  });

  describe("installSdkMocks", () => {
    it("installs SDK on global object", () => {
      const sdk = installSdkMocks();

      expect((global as any).VSS).toBe(sdk);
    });

    it("returns the created SDK", () => {
      const sdk = installSdkMocks({ accessToken: "test-token" });

      expect(sdk).toBeDefined();
      expect(sdk.getWebContext).toBeDefined();
    });
  });

  describe("BuildApiScenarios", () => {
    it("defines all required scenarios", () => {
      expect(BuildApiScenarios["NO_RUNS"]).toBeDefined();
      expect(BuildApiScenarios["NO_ARTIFACTS"]).toBeDefined();
      expect(BuildApiScenarios["PERMISSION_DENIED"]).toBeDefined();
      expect(BuildApiScenarios["NOT_FOUND"]).toBeDefined();
      expect(BuildApiScenarios["TRANSIENT_ERROR"]).toBeDefined();
      expect(BuildApiScenarios["SUCCESS"]).toBeDefined();
    });
  });
});
