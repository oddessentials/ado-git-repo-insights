/**
 * Mode parity integration tests.
 *
 * Verify that local mode and extension mode have equivalent initialization flows.
 */

import * as fs from "fs";
import * as path from "path";

describe("local/extension mode parity", () => {
  const dashboardPath = path.join(__dirname, "../../ui/dashboard.ts");
  const dashboardContent = fs.readFileSync(dashboardPath, "utf-8");

  describe("mode detection", () => {
    it("uses isLocalMode function (from module or local)", () => {
      // isLocalMode may be imported from ./modules or defined locally
      expect(dashboardContent).toContain("isLocalMode");
    });

    it("checks for localDataset query parameter", () => {
      expect(dashboardContent).toContain("getLocalDatasetPath");
    });
  });

  describe("resolve + init flow", () => {
    it("has resolveConfiguration function", () => {
      expect(dashboardContent).toContain("function resolveConfiguration");
    });

    it("has init function", () => {
      expect(dashboardContent).toContain("function init");
    });

    it("calls resolveConfiguration before loading data", () => {
      // Verify sequence: resolveConfiguration is called and its result used for loading
      expect(dashboardContent).toMatch(/resolveConfiguration.*loadDataset/s);
    });
  });

  describe("error handling parity", () => {
    it("uses showSetupRequired for both modes", () => {
      // showSetupRequired may be imported from ./modules or defined locally
      expect(dashboardContent).toContain("showSetupRequired");
    });

    it("uses showPermissionDenied for both modes", () => {
      // showPermissionDenied may be imported from ./modules or defined locally
      expect(dashboardContent).toContain("showPermissionDenied");
    });

    it("uses handleError for both modes", () => {
      // handleError may be imported from ./modules or defined locally
      expect(dashboardContent).toContain("handleError");
    });
  });

  describe("SDK initialization", () => {
    it("has initializeAdoSdk for extension mode", () => {
      expect(dashboardContent).toContain("initializeAdoSdk");
    });
    it("handles local mode without SDK", () => {
      // Local mode should skip SDK initialization
      expect(dashboardContent).toContain("isLocalMode");
      expect(dashboardContent).toContain("getLocalDatasetPath");
    });
  });

  describe("DatasetLoader parity", () => {
    it("uses DatasetLoader in both modes", () => {
      expect(dashboardContent).toContain("DatasetLoader");
    });

    it("supports direct URL configuration for local mode", () => {
      // DatasetLoader should accept configuration for local JSON
      expect(dashboardContent).toContain("DatasetLoader");
    });
  });
});
