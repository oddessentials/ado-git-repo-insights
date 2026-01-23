/**
 * Smoke render tests - validate HTML + JS execute without runtime errors.
 *
 * These tests simulate Azure DevOps extension constraints:
 * - Plain <script> tags (no module loader)
 * - Strict relative paths
 * - No Node-only globals
 *
 * Tests catch "bundled but breaks at runtime" regressions.
 */
import * as fs from "fs";
import * as path from "path";
import { JSDOM } from "jsdom";

describe("Smoke Render Tests (ADO Simulation)", () => {
  const distUiPath = path.join(__dirname, "..", "dist", "ui");

  /**
   * Create a jsdom instance simulating Azure DevOps extension environment.
   * - VSS SDK is mocked
   * - No Node globals exposed
   * - Scripts loaded via eval (simulating <script> tags)
   */
  function createAdoSimulatedDOM(htmlFile: string): JSDOM {
    const htmlPath = path.join(distUiPath, htmlFile);
    const html = fs.readFileSync(htmlPath, "utf-8");

    const dom = new JSDOM(html, {
      runScripts: "outside-only",
      url: "https://dev.azure.com/testorg/testproject/_apps/hub/OddEssentials.ado-git-repo-insights.pr-insights-hub",
      // Don't provide Node globals
      pretendToBeVisual: true,
    });

    // Mock VSS SDK (provided by Azure DevOps host page)
    dom.window.eval(`
            window.VSS = {
                _initCalled: false,
                _readyCalled: false,
                init: function(opts) {
                    this._initCalled = true;
                    this._initOpts = opts;
                },
                ready: function(cb) {
                    this._readyCalled = true;
                    // Simulate async ready
                    setTimeout(cb, 0);
                },
                notifyLoadSucceeded: function() {
                    this._loadSucceeded = true;
                },
                getWebContext: function() {
                    return {
                        project: { id: 'test-project-id', name: 'Test Project' },
                        host: { id: 'test-org' }
                    };
                },
                getService: function() {
                    return Promise.resolve({
                        getValue: function() { return Promise.resolve(null); },
                        setValue: function() { return Promise.resolve(); }
                    });
                },
                require: function(deps, cb) {
                    // Mock REST clients
                    cb({
                        getClient: function() {
                            return {
                                getProjects: function() { return Promise.resolve([]); },
                                getDefinitions: function() { return Promise.resolve([]); },
                                getBuilds: function() { return Promise.resolve([]); }
                            };
                        }
                    });
                },
                ServiceIds: { ExtensionData: 'Microsoft.VisualStudio.Services.ExtensionData' }
            };
        `);

    return dom;
  }

  describe("Settings Page", () => {
    it("settings.html loads scripts without throwing", () => {
      const dom = createAdoSimulatedDOM("settings.html");

      // Load the settings script (simulating <script src="settings.js">)
      const settingsJs = fs.readFileSync(
        path.join(distUiPath, "settings.js"),
        "utf-8",
      );

      // Should not throw any syntax or runtime errors
      expect(() => dom.window.eval(settingsJs)).not.toThrow();

      dom.window.close();
    });

    it("settings.html has required DOM elements", () => {
      const dom = createAdoSimulatedDOM("settings.html");

      // These elements are required for settings functionality
      expect(dom.window.document.getElementById("save-btn")).not.toBeNull();
      expect(dom.window.document.getElementById("clear-btn")).not.toBeNull();
      expect(dom.window.document.getElementById("pipeline-id")).not.toBeNull();
      expect(dom.window.document.getElementById("project-id")).not.toBeNull();
      expect(
        dom.window.document.getElementById("status-display"),
      ).not.toBeNull();

      dom.window.close();
    });

    it("settings page is not blank (has visible content)", () => {
      const dom = createAdoSimulatedDOM("settings.html");

      // Page should have visible text content (not a blank page)
      const body = dom.window.document.body;
      const textContent = body.textContent?.trim() || "";
      expect(textContent.length).toBeGreaterThan(100);
      expect(textContent).toContain("Settings");

      dom.window.close();
    });
  });

  describe("Dashboard Page", () => {
    it("index.html loads all scripts in dependency order without throwing", () => {
      const dom = createAdoSimulatedDOM("index.html");

      // Load scripts in exact dependency order from index.html
      const scripts = [
        "error-types.js",
        "artifact-client.js",
        "dataset-loader.js",
        "dashboard.js",
      ];

      for (const script of scripts) {
        const content = fs.readFileSync(path.join(distUiPath, script), "utf-8");
        expect(() => dom.window.eval(content)).not.toThrow();
      }

      dom.window.close();
    });

    it("index.html has required DOM elements", () => {
      const dom = createAdoSimulatedDOM("index.html");

      // These elements are required for dashboard functionality
      expect(dom.window.document.getElementById("app")).not.toBeNull();
      expect(
        dom.window.document.getElementById("loading-state"),
      ).not.toBeNull();
      expect(dom.window.document.getElementById("main-content")).not.toBeNull();
      expect(
        dom.window.document.getElementById("setup-required"),
      ).not.toBeNull();

      dom.window.close();
    });

    it("dashboard page is not blank (has visible content)", () => {
      const dom = createAdoSimulatedDOM("index.html");

      // Page should have visible text content
      const body = dom.window.document.body;
      const textContent = body.textContent?.trim() || "";
      expect(textContent.length).toBeGreaterThan(100);
      expect(textContent).toContain("PR Insights");

      dom.window.close();
    });

    it("dashboard exposes DatasetLoader global after script load", () => {
      const dom = createAdoSimulatedDOM("index.html");

      // Load all scripts
      const scripts = [
        "error-types.js",
        "artifact-client.js",
        "dataset-loader.js",
        "dashboard.js",
      ];

      for (const script of scripts) {
        const content = fs.readFileSync(path.join(distUiPath, script), "utf-8");
        dom.window.eval(content);
      }

      // DatasetLoader should be exposed as a global (required for IIFE format)
      expect(dom.window.DatasetLoader).toBeDefined();
      expect(typeof dom.window.DatasetLoader).toBe("function");

      dom.window.close();
    });
  });

  describe("Script Format Validation (No ESM)", () => {
    const entryPoints = ["dashboard.js", "settings.js"];

    it.each(entryPoints)(
      "%s does not use ESM import/export syntax",
      (filename) => {
        const content = fs.readFileSync(
          path.join(distUiPath, filename),
          "utf-8",
        );

        // These would cause "Unexpected token" errors in ADO
        expect(content).not.toMatch(/^import\s+/m);
        expect(content).not.toMatch(/^export\s+/m);
        expect(content).not.toContain("import(");
      },
    );
  });
});
