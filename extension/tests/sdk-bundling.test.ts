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

  describe("artifact-client SDK isolation", () => {
    it("artifact-client.ts does not import from modules/sdk or azure-devops-extension-sdk", () => {
      const artifactClientPath = path.join(UI_DIR, "artifact-client.ts");
      const content = _fs.readFileSync(artifactClientPath, "utf8");

      // Must not import the SDK directly
      expect(content).not.toMatch(/from\s+["']azure-devops-extension-sdk["']/);
      // Must not import from the modules barrel (which re-exports SDK)
      expect(content).not.toMatch(/from\s+["']\.\/(modules|modules\/sdk)["']/);
    });

    it("artifact-client.js bundle does not contain SDK internals", () => {
      const bundlePath = path.join(DIST_UI_DIR, "artifact-client.js");
      if (!_fs.existsSync(bundlePath)) return; // Skip if not built
      const content = _fs.readFileSync(bundlePath, "utf8");

      // XDM channelManager is the SDK's core internal — its presence
      // means the SDK was bundled into artifact-client.js
      expect(content).not.toContain("channelManager");
    });
  });

  describe("resize bridge", () => {
    it("host-resize.ts uses resizeHost from sdk.ts, not globalThis.VSS", () => {
      const hostResizePath = path.join(UI_DIR, "modules", "shared", "host-resize.ts");
      const content = _fs.readFileSync(hostResizePath, "utf8");

      // Must import resizeHost from the SDK abstraction
      expect(content).toMatch(/import\s*\{[^}]*resizeHost[^}]*\}\s*from\s*["']\.\.\/sdk["']/);
      // Must not reference the legacy globalThis.VSS pattern
      expect(content).not.toMatch(/globalThis.*VSS/);
      expect(content).not.toMatch(/VSS\?\.resize/);
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

  describe("demo surface parity", () => {
    it("docs/ does not contain VSS.SDK.min.js", () => {
      const docsDir = path.join(__dirname, "../../docs");
      const sdkFile = path.join(docsDir, "VSS.SDK.min.js");
      expect(_fs.existsSync(sdkFile)).toBe(false);
    });

    it("build-demo.sh does not require VSS.SDK.min.js", () => {
      const buildDemoPath = path.join(__dirname, "../../scripts/build-demo.sh");
      if (!_fs.existsSync(buildDemoPath)) return;
      const content = _fs.readFileSync(buildDemoPath, "utf8");
      expect(content).not.toContain('"VSS.SDK.min.js"');
    });
  });
});
