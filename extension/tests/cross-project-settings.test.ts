/**
 * Cross-Project Settings Tests
 *
 * Verifies that cross-project configuration is correctly
 * implemented in dashboard.ts and settings.ts.
 */

import * as fs from "fs";
import * as path from "path";

describe("Cross-Project Settings", () => {
  describe("dashboard.ts configuration", () => {
    let dashboardCode: string;

    beforeAll(() => {
      const dashboardPath = path.join(__dirname, "../ui/dashboard.ts");
      dashboardCode = fs.readFileSync(dashboardPath, "utf8");
    });

    it("should have SETTINGS_KEY_PROJECT constant", () => {
      expect(dashboardCode).toContain(
        'SETTINGS_KEY_PROJECT = "pr-insights-source-project"',
      );
    });

    it("should have SETTINGS_KEY_PIPELINE constant", () => {
      expect(dashboardCode).toContain(
        'SETTINGS_KEY_PIPELINE = "pr-insights-pipeline-id"',
      );
    });

    it("should have getSourceConfig function that returns both projectId and pipelineId", () => {
      expect(dashboardCode).toContain("async function getSourceConfig()");
      // Result object with typed fields (may be multi-line)
      expect(dashboardCode).toMatch(
        /const result:\s*\{\s*projectId:\s*string \| null;\s*pipelineId:\s*number \| null\s*\}/,
      );
    });

    it("should read project setting with SETTINGS_KEY_PROJECT", () => {
      // Check that SETTINGS_KEY_PROJECT is used with User scope
      expect(dashboardCode).toContain("SETTINGS_KEY_PROJECT");
      expect(dashboardCode).toMatch(/scopeType:\s*["']User["']/);
    });

    it("should log source project origin", () => {
      expect(dashboardCode).toMatch(/console\.log.*Source project/s);
    });

    it("should use targetProjectId for ArtifactClient initialization", () => {
      expect(dashboardCode).toContain("new ArtifactClient(targetProjectId)");
    });

    it("should pass targetProjectId to resolveFromPipelineId", () => {
      // Check for calls with targetProjectId parameter (multiline-safe)
      expect(dashboardCode).toMatch(
        /resolveFromPipelineId\([^)]*targetProjectId/s,
      );
    });

    it("should pass targetProjectId to discoverAndResolve", () => {
      expect(dashboardCode).toContain("discoverAndResolve(targetProjectId)");
    });
  });

  describe("settings.ts configuration", () => {
    let settingsCode: string;

    beforeAll(() => {
      const settingsPath = path.join(__dirname, "../ui/settings.ts");
      settingsCode = fs.readFileSync(settingsPath, "utf8");
    });

    it("should have SETTINGS_KEY_PROJECT constant matching dashboard", () => {
      expect(settingsCode).toContain(
        'SETTINGS_KEY_PROJECT = "pr-insights-source-project"',
      );
    });

    it("should have SETTINGS_KEY_PIPELINE constant matching dashboard", () => {
      expect(settingsCode).toContain(
        'SETTINGS_KEY_PIPELINE = "pr-insights-pipeline-id"',
      );
    });

    it("should have tryLoadProjectDropdown for graceful degradation", () => {
      expect(settingsCode).toContain("async function tryLoadProjectDropdown()");
    });

    it("should have getOrganizationProjects for dropdown population", () => {
      expect(settingsCode).toContain(
        "async function getOrganizationProjects()",
      );
    });

    it("should have projectDropdownAvailable flag", () => {
      expect(settingsCode).toContain("let projectDropdownAvailable = false");
    });

    it("should save project ID separately from pipeline ID", () => {
      // Check that both keys are used with setValue
      expect(settingsCode).toMatch(
        /setValue\(\s*SETTINGS_KEY_PROJECT,\s*projectId/s,
      );
      expect(settingsCode).toMatch(
        /setValue\(\s*SETTINGS_KEY_PIPELINE,\s*pipelineId/s,
      );
    });
  });

  describe("settings keys consistency", () => {
    it("should use the same settings keys in both files", () => {
      const dashboardPath = path.join(__dirname, "../ui/dashboard.ts");
      const settingsPath = path.join(__dirname, "../ui/settings.ts");

      const dashboardCode = fs.readFileSync(dashboardPath, "utf8");
      const settingsCode = fs.readFileSync(settingsPath, "utf8");

      // Extract settings keys from both files (double quotes from Prettier)
      const dashboardProjectKey = dashboardCode.match(
        /SETTINGS_KEY_PROJECT\s*=\s*"([^"]+)"/,
      )?.[1];
      const dashboardPipelineKey = dashboardCode.match(
        /SETTINGS_KEY_PIPELINE\s*=\s*"([^"]+)"/,
      )?.[1];
      const settingsProjectKey = settingsCode.match(
        /SETTINGS_KEY_PROJECT\s*=\s*"([^"]+)"/,
      )?.[1];
      const settingsPipelineKey = settingsCode.match(
        /SETTINGS_KEY_PIPELINE\s*=\s*"([^"]+)"/,
      )?.[1];

      expect(dashboardProjectKey).toBe("pr-insights-source-project");
      expect(settingsProjectKey).toBe("pr-insights-source-project");
      expect(dashboardProjectKey).toBe(settingsProjectKey);

      expect(dashboardPipelineKey).toBe("pr-insights-pipeline-id");
      expect(settingsPipelineKey).toBe("pr-insights-pipeline-id");
      expect(dashboardPipelineKey).toBe(settingsPipelineKey);
    });
  });

  describe("vss-extension.json manifest", () => {
    let manifest: any;

    beforeAll(() => {
      const manifestPath = path.join(__dirname, "../vss-extension.json");
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    });

    it("should have vso.project scope for listing projects", () => {
      expect(manifest.scopes).toContain("vso.project");
    });

    it("should have vso.build scope for accessing artifacts", () => {
      expect(manifest.scopes).toContain("vso.build");
    });

    it("should have vso.settings scope for extension data", () => {
      expect(manifest.scopes).toContain("vso.settings");
    });
  });
});
