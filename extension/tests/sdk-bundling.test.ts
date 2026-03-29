/**
 * SDK Bundling Integrity Tests
 *
 * Ensures the VSS SDK is properly bundled locally to avoid CDN version drift.
 * The Azure DevOps CDN uses versioned URLs that return 404 after sprint updates.
 *
 * These tests prevent regressions where:
 * - The SDK file is accidentally removed
 * - HTML files are reverted to use the stale CDN URL
 * - The SDK file becomes corrupted/empty
 */

import * as _fsOriginal from "fs";
function _loadFs(): typeof _fsOriginal { return _fsOriginal; }
const _fs = _loadFs();
import * as path from "path";

// Use require for package.json to avoid TS build issues if resolveJsonModule is not perfectly set up in all environments
// but since I enabled it, import is also fine.
import packageJson from "../package.json";

const UI_DIR = path.join(__dirname, "../ui");
const SDK_FILE = path.join(UI_DIR, "VSS.SDK.min.js");
const INDEX_HTML = path.join(UI_DIR, "index.html");
const SETTINGS_HTML = path.join(UI_DIR, "settings.html");

// CDN URL pattern that causes 404 after ADO sprint updates
const STALE_CDN_PATTERN = /cdn\.vsassets\.io\/v\/[A-Z0-9_]+\//i;

describe("SDK Bundling Integrity", () => {
  describe("VSS.SDK.min.js", () => {
    it("exists in extension/ui folder", () => {
      expect(_fs.existsSync(SDK_FILE)).toBe(true);
    });

    it("is non-empty", () => {
      const stats = _fs.statSync(SDK_FILE);
      expect(stats.size).toBeGreaterThan(1000); // SDK should be at least 1KB
    });

    it("contains VSS namespace definition", () => {
      const content = _fs.readFileSync(SDK_FILE, "utf8");
      // The SDK defines the VSS global namespace
      expect(content).toMatch(/VSS/);
    });
  });

  describe("index.html", () => {
    let content: string;

    beforeAll(() => {
      content = _fs.readFileSync(INDEX_HTML, "utf8");
    });

    it("references local SDK file", () => {
      expect(content).toMatch(/src=["']VSS\.SDK\.min\.js["']/);
    });

    it("does not reference versioned CDN URL", () => {
      const hasStaleCdn = STALE_CDN_PATTERN.test(content);
      expect(hasStaleCdn).toBe(false);
    });

    it("loads SDK before other scripts", () => {
      const sdkIndex = content.indexOf("VSS.SDK.min.js");
      // Note: index.html might still reference dashboard.js until we update it to bundle
      const dashboardIndex = content.indexOf("dashboard.js");

      expect(sdkIndex).toBeGreaterThan(-1);
      expect(dashboardIndex).toBeGreaterThan(-1);
      expect(sdkIndex).toBeLessThan(dashboardIndex);
    });
  });

  describe("settings.html", () => {
    let content: string;

    beforeAll(() => {
      content = _fs.readFileSync(SETTINGS_HTML, "utf8");
    });

    it("references local SDK file", () => {
      expect(content).toMatch(/src=["']VSS\.SDK\.min\.js["']/);
    });

    it("does not reference versioned CDN URL", () => {
      const hasStaleCdn = STALE_CDN_PATTERN.test(content);
      expect(hasStaleCdn).toBe(false);
    });

    it("loads SDK before settings.js", () => {
      const sdkIndex = content.indexOf("VSS.SDK.min.js");
      const settingsIndex = content.indexOf("settings.js");

      expect(sdkIndex).toBeGreaterThan(-1);
      expect(settingsIndex).toBeGreaterThan(-1);
      expect(sdkIndex).toBeLessThan(settingsIndex);
    });
  });

  describe("package.json", () => {
    it("includes vss-web-extension-sdk dependency", () => {
      const deps: Record<string, string> = {
        ...(packageJson.dependencies || {}),
        ...(packageJson.devDependencies || {}),
      };
      expect(deps["vss-web-extension-sdk"]).toBeDefined();
    });
  });
});
