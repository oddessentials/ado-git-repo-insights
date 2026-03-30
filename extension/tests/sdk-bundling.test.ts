/**
 * SDK Bundling Integrity Tests
 *
 * Post-migration from vss-web-extension-sdk to azure-devops-extension-sdk.
 * Ensures:
 * - The old VSS.SDK.min.js file is NOT bundled (no longer used)
 * - The new SDK packages are in dependencies
 * - HTML files do NOT reference the old SDK script
 * - HTML files load app scripts in correct order
 */

import * as _fsOriginal from "fs";
function _loadFs(): typeof _fsOriginal { return _fsOriginal; }
const _fs = _loadFs();
import * as path from "path";

import packageJson from "../package.json";

const UI_DIR = path.join(__dirname, "../ui");
const DIST_UI_DIR = path.join(__dirname, "../dist/ui");
const INDEX_HTML = path.join(UI_DIR, "index.html");
const SETTINGS_HTML = path.join(UI_DIR, "settings.html");

// CDN URL pattern that causes 404 after ADO sprint updates
const STALE_CDN_PATTERN = /cdn\.vsassets\.io\/v\/[A-Z0-9_]+\//i;

describe("SDK Bundling Integrity (post-migration)", () => {
  describe("VSS.SDK.min.js removal", () => {
    it("does NOT exist in extension/ui folder", () => {
      const sdkFile = path.join(UI_DIR, "VSS.SDK.min.js");
      expect(_fs.existsSync(sdkFile)).toBe(false);
    });

    it("does NOT exist in dist/ui folder", () => {
      const sdkFile = path.join(DIST_UI_DIR, "VSS.SDK.min.js");
      expect(_fs.existsSync(sdkFile)).toBe(false);
    });
  });

  describe("index.html", () => {
    let content: string;

    beforeAll(() => {
      content = _fs.readFileSync(INDEX_HTML, "utf8");
    });

    it("does NOT reference VSS.SDK.min.js", () => {
      expect(content).not.toMatch(/VSS\.SDK\.min\.js/);
    });

    it("does not reference versioned CDN URL", () => {
      const hasStaleCdn = STALE_CDN_PATTERN.test(content);
      expect(hasStaleCdn).toBe(false);
    });

    it("loads app scripts in correct order", () => {
      const errorTypesIndex = content.indexOf("error-types.js");
      const artifactClientIndex = content.indexOf("artifact-client.js");
      const datasetLoaderIndex = content.indexOf("dataset-loader.js");
      const dashboardIndex = content.indexOf("dashboard.js");

      expect(errorTypesIndex).toBeGreaterThan(-1);
      expect(artifactClientIndex).toBeGreaterThan(-1);
      expect(datasetLoaderIndex).toBeGreaterThan(-1);
      expect(dashboardIndex).toBeGreaterThan(-1);

      // error-types -> artifact-client -> dataset-loader -> dashboard
      expect(errorTypesIndex).toBeLessThan(artifactClientIndex);
      expect(artifactClientIndex).toBeLessThan(datasetLoaderIndex);
      expect(datasetLoaderIndex).toBeLessThan(dashboardIndex);
    });
  });

  describe("settings.html", () => {
    let content: string;

    beforeAll(() => {
      content = _fs.readFileSync(SETTINGS_HTML, "utf8");
    });

    it("does NOT reference VSS.SDK.min.js", () => {
      expect(content).not.toMatch(/VSS\.SDK\.min\.js/);
    });

    it("does not reference versioned CDN URL", () => {
      const hasStaleCdn = STALE_CDN_PATTERN.test(content);
      expect(hasStaleCdn).toBe(false);
    });

    it("loads settings.js", () => {
      expect(content).toContain("settings.js");
    });
  });

  describe("package.json", () => {
    it("does NOT include vss-web-extension-sdk dependency", () => {
      const deps: Record<string, string> = {
        ...(packageJson.dependencies || {}),
        ...(packageJson.devDependencies || {}),
      };
      expect(deps["vss-web-extension-sdk"]).toBeUndefined();
    });

    it("includes azure-devops-extension-sdk dependency", () => {
      const deps: Record<string, string> = {
        ...(packageJson.dependencies || {}),
        ...(packageJson.devDependencies || {}),
      };
      expect(deps["azure-devops-extension-sdk"]).toBeDefined();
    });

    it("includes azure-devops-extension-api dependency", () => {
      const deps: Record<string, string> = {
        ...(packageJson.dependencies || {}),
        ...(packageJson.devDependencies || {}),
      };
      expect(deps["azure-devops-extension-api"]).toBeDefined();
    });
  });
});
