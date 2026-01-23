/**
 * VSIX Packaging Contract Tests (Tier A)
 *
 * CRITICAL INVARIANTS:
 * 1. VSIX must package dist/ui (compiled IIFE JS), NOT ui (TypeScript source)
 * 2. All contribution URIs must resolve to existing files in dist/ui
 * 3. JS bundles must be IIFE format (no ESM import/export) for ADO script tags
 *
 * These tests protect against "tsc overwrote esbuild bundles" regressions.
 *
 * NOTE: Tier B tests (actual VSIX inspection) are in vsix-artifact-inspection.test.ts
 * and only run in jobs that package a VSIX.
 */
import * as fs from "fs";
import * as path from "path";

describe("VSIX Packaging Contract (Tier A)", () => {
  const extensionDir = path.join(__dirname, "..");
  const manifestPath = path.join(extensionDir, "vss-extension.json");
  let manifest: any;

  beforeAll(() => {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  });

  describe("Addressable Files Configuration", () => {
    it("must package dist/ui (compiled), not ui (source)", () => {
      const addressableEntry = manifest.files?.find((f: any) => f.addressable);
      expect(addressableEntry).toBeDefined();
      expect(addressableEntry.path).toBe("dist/ui");
      expect(addressableEntry.path).not.toBe("ui");
    });

    it("dist/ui directory must exist at test time", () => {
      const distUiPath = path.join(extensionDir, "dist", "ui");
      expect(fs.existsSync(distUiPath)).toBe(true);
    });
  });

  describe("Contribution URI Validation (ALL entrypoints)", () => {
    it("every contribution with a URI must reference an existing file", () => {
      const contributions = manifest.contributions || [];

      for (const contribution of contributions) {
        const uri = contribution.properties?.uri;
        if (uri) {
          // URI must reference dist/ui path
          if (!uri.match(/^dist\/ui\//)) {
            throw new Error(
              `Contribution ${contribution.id} has URI "${uri}" not under dist/ui/`,
            );
          }

          // Referenced file must exist
          const filePath = path.join(extensionDir, uri);
          expect(fs.existsSync(filePath)).toBe(true);
        }
      }
    });

    it("all hub contributions must reference dist/ui/", () => {
      const hubs =
        manifest.contributions?.filter(
          (c: any) => c.type === "ms.vss-web.hub",
        ) || [];

      expect(hubs.length).toBeGreaterThan(0);

      for (const hub of hubs) {
        const uri = hub.properties?.uri;
        expect(uri).toBeDefined();
        expect(uri).toMatch(/^dist\/ui\//);

        // Verify referenced file exists
        const filePath = path.join(extensionDir, uri);
        expect(fs.existsSync(filePath)).toBe(true);
      }
    });

    it("no contribution URI should reference old ui/ path", () => {
      const contributions = manifest.contributions || [];

      for (const contribution of contributions) {
        const uri = contribution.properties?.uri;
        if (uri) {
          // Must NOT be old ui/ path (without dist/)
          expect(uri).not.toMatch(/^ui\//);
        }
      }
    });
  });

  describe("dist/ui Contains Required Assets", () => {
    const requiredFiles = [
      "dashboard.js",
      "settings.js",
      "index.html",
      "settings.html",
      "styles.css",
      "VSS.SDK.min.js",
      "error-types.js",
      "artifact-client.js",
      "dataset-loader.js",
    ];

    it.each(requiredFiles)("must contain %s", (filename) => {
      const filePath = path.join(extensionDir, "dist", "ui", filename);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  describe("No TypeScript Source in dist/ui", () => {
    it("must NOT contain any source .ts files (excluding .d.ts declarations)", () => {
      const distUiPath = path.join(extensionDir, "dist", "ui");
      const files = fs.readdirSync(distUiPath);
      // Source TS files end with .ts but NOT .d.ts
      // .d.ts declaration files are harmless and can be shipped
      const sourceTsFiles = files.filter(
        (f) => f.endsWith(".ts") && !f.endsWith(".d.ts"),
      );
      expect(sourceTsFiles).toEqual([]);
    });
  });

  describe("IIFE Format Invariant (Critical - Prevents tsc Overwrite)", () => {
    // These are the main UI entry points - they MUST be IIFE, not CommonJS
    const iifeEntryPoints = [
      "dashboard.js",
      "settings.js",
      "dataset-loader.js",
      "artifact-client.js",
      "error-types.js",
    ];

    it.each(iifeEntryPoints)(
      "%s must be IIFE format (no import/export)",
      (filename) => {
        const filePath = path.join(extensionDir, "dist", "ui", filename);
        const content = fs.readFileSync(filePath, "utf-8");

        // CRITICAL: Check for ESM tokens that would break in ADO script tags
        // If these fail, it means tsc overwrote esbuild output
        expect(content).not.toMatch(/^import /m);
        expect(content).not.toMatch(/^export /m);
        expect(content).not.toMatch(/import\s*\(/); // dynamic import
        expect(content).not.toMatch(/exports\./); // CommonJS exports
        expect(content).not.toMatch(/module\.exports/); // CommonJS

        // Should start with "use strict" and IIFE pattern
        // This is the esbuild signature - tsc output looks different
        expect(content).toMatch(/^"use strict";\s*var\s+\w+\s*=\s*\(\(\)\s*=>/);
      },
    );

    it.each(["dashboard.js", "settings.js"])(
      "%s must expose expected global",
      (filename) => {
        const filePath = path.join(extensionDir, "dist", "ui", filename);
        const content = fs.readFileSync(filePath, "utf-8");

        // Check for global exposure footer added by esbuild
        expect(content).toContain("Object.assign(window,");
      },
    );
  });

  describe("HTML References Correct JS Files", () => {
    it("index.html must reference .js files (not .ts)", () => {
      const htmlPath = path.join(extensionDir, "dist", "ui", "index.html");
      const content = fs.readFileSync(htmlPath, "utf-8");

      // Must reference .js files
      expect(content).toContain("dashboard.js");
      expect(content).toContain("dataset-loader.js");

      // Must NOT reference .ts files
      expect(content).not.toContain("dashboard.ts");
      expect(content).not.toContain("dataset-loader.ts");
    });

    it("settings.html must reference .js files (not .ts)", () => {
      const htmlPath = path.join(extensionDir, "dist", "ui", "settings.html");
      const content = fs.readFileSync(htmlPath, "utf-8");

      // Must reference .js files
      expect(content).toContain("settings.js");

      // Must NOT reference .ts files
      expect(content).not.toContain("settings.ts");
    });
  });
});
