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
import * as path from "path";
import {
  pathExists,
  readBufferFile,
  readDir,
  readJsonFile,
  readTextFile,
} from "./helpers/fs-test-utils";

type Contribution = {
  id: string;
  type: string;
  properties?: { uri?: string };
};

type VsixManifest = {
  files?: Array<{ addressable?: boolean; path: string }>;
  contributions?: Contribution[];
  galleryFlags?: string[];
  tags?: string[];
  galleryBanner?: { color: string; theme: string };
  links?: Record<string, { uri: string }>;
  CustomerQnASupport?: { enableqna: boolean; url: string };
  badges?: unknown[];
  description?: string;
  screenshots?: Array<{ path: string }>;
};

describe("VSIX Packaging Contract (Tier A)", () => {
  const extensionDir = path.join(__dirname, "..");
  const manifestPath = path.join(extensionDir, "vss-extension.json");
  let manifest: VsixManifest;

  beforeAll(() => {
    manifest = readJsonFile<VsixManifest>(manifestPath);
  });

  describe("Addressable Files Configuration", () => {
    it("must package dist/ui (compiled), not ui (source)", () => {
      const addressableEntry = manifest.files?.find((file) => file.addressable);
      expect(addressableEntry).toBeDefined();
      expect(addressableEntry!.path).toBe("dist/ui");
      expect(addressableEntry!.path).not.toBe("ui");
    });

    it("dist/ui directory must exist at test time", () => {
      const distUiPath = path.join(extensionDir, "dist", "ui");
      expect(pathExists(distUiPath)).toBe(true);
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
          expect(pathExists(filePath)).toBe(true);
        }
      }
    });

    it("all hub contributions must reference dist/ui/", () => {
      const hubs =
        manifest.contributions?.filter(
          (contribution) => contribution.type === "ms.vss-web.hub",
        ) || [];

      expect(hubs.length).toBeGreaterThan(0);

      for (const hub of hubs) {
        const uri = hub.properties?.uri;
        expect(uri).toBeDefined();
        expect(uri!).toMatch(/^dist\/ui\//);

        // Verify referenced file exists
        const filePath = path.join(extensionDir, uri!);
        expect(pathExists(filePath)).toBe(true);
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
      "error-types.js",
      "artifact-client.js",
      "dataset-loader.js",
    ];

    it.each(requiredFiles)("must contain %s", (filename) => {
      const filePath = path.join(extensionDir, "dist", "ui", filename);
      expect(pathExists(filePath)).toBe(true);
    });
  });

  describe("No TypeScript Source in dist/ui", () => {
    it("must NOT contain any source .ts files (excluding .d.ts declarations)", () => {
      const distUiPath = path.join(extensionDir, "dist", "ui");
      const files = readDir(distUiPath);
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
        const content = readTextFile(filePath);

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
        const content = readTextFile(filePath);

        // Check for global exposure footer added by esbuild
        expect(content).toContain("Object.assign(window,");
      },
    );
  });

  describe("HTML References Correct JS Files", () => {
    it("index.html must reference .js files (not .ts)", () => {
      const htmlPath = path.join(extensionDir, "dist", "ui", "index.html");
      const content = readTextFile(htmlPath);

      // Must reference .js files
      expect(content).toContain("dashboard.js");
      expect(content).toContain("dataset-loader.js");

      // Must NOT reference .ts files
      expect(content).not.toContain("dashboard.ts");
      expect(content).not.toContain("dataset-loader.ts");
    });

    it("settings.html must reference .js files (not .ts)", () => {
      const htmlPath = path.join(extensionDir, "dist", "ui", "settings.html");
      const content = readTextFile(htmlPath);

      // Must reference .js files
      expect(content).toContain("settings.js");

      // Must NOT reference .ts files
      expect(content).not.toContain("settings.ts");
    });
  });

  describe("Marketplace Readiness", () => {
    it("galleryFlags contains Public and Preview", () => {
      expect(manifest.galleryFlags).toBeDefined();
      expect(manifest.galleryFlags!).toContain("Public");
      expect(manifest.galleryFlags!).toContain("Preview");
    });

    it("tags array has at least 8 entries", () => {
      expect(manifest.tags).toBeDefined();
      expect(Array.isArray(manifest.tags)).toBe(true);
      expect(manifest.tags!.length).toBeGreaterThanOrEqual(8);
    });

    it("galleryBanner has valid hex color and theme", () => {
      expect(manifest.galleryBanner).toBeDefined();
      expect(manifest.galleryBanner!.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(["dark", "light"]).toContain(manifest.galleryBanner!.theme);
    });

    it("all 6 link types exist", () => {
      const requiredLinks = [
        "home",
        "repository",
        "issues",
        "support",
        "license",
        "getstarted",
      ];
      expect(manifest.links).toBeDefined();
      for (const linkType of requiredLinks) {
        const linkEntry = Object.entries(manifest.links ?? {}).find(
          ([candidateLinkType]) => candidateLinkType === linkType,
        )?.[1];
        expect(linkEntry).toBeDefined();
        expect(linkEntry?.uri).toBeDefined();
      }
    });

    it("CustomerQnASupport is enabled with URL", () => {
      expect(manifest.CustomerQnASupport).toBeDefined();
      expect(manifest.CustomerQnASupport!.enableqna).toBe(true);
      expect(manifest.CustomerQnASupport!.url).toBeDefined();
    });

    it("badges array has at least 2 entries", () => {
      expect(manifest.badges).toBeDefined();
      expect(Array.isArray(manifest.badges)).toBe(true);
      expect(manifest.badges!.length).toBeGreaterThanOrEqual(2);
    });

    it("description is under 200 characters", () => {
      expect(manifest.description).toBeDefined();
      expect(manifest.description!.length).toBeLessThanOrEqual(200);
    });

    it("description contains optional/configurable/add-on qualifier for ML/AI", () => {
      expect(manifest.description!).toMatch(/optional|configurable|add-on/i);
    });

    it("at least 3 screenshots defined", () => {
      expect(manifest.screenshots).toBeDefined();
      expect(Array.isArray(manifest.screenshots)).toBe(true);
      expect(manifest.screenshots!.length).toBeGreaterThanOrEqual(3);
    });

    it("all screenshot files exist on disk", () => {
      for (const screenshot of manifest.screenshots!) {
        const filePath = path.join(extensionDir, screenshot.path);
        expect(pathExists(filePath)).toBe(true);
      }
    });

    it("icon file exists and has PNG magic bytes", () => {
      const iconPath = path.join(extensionDir, "images", "icon.png");
      expect(pathExists(iconPath)).toBe(true);
      const buffer = readBufferFile(iconPath);
      // PNG magic bytes: 89 50 4E 47
      expect(buffer[0]).toBe(0x89);
      expect(buffer[1]).toBe(0x50);
      expect(buffer[2]).toBe(0x4e);
      expect(buffer[3]).toBe(0x47);
    });

    it("icon file has 128x128 dimensions", () => {
      const iconPath = path.join(extensionDir, "images", "icon.png");
      const buffer = readBufferFile(iconPath);
      // PNG IHDR chunk: width at bytes 16-19, height at bytes 20-23 (big-endian uint32)
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      expect(width).toBe(128);
      expect(height).toBe(128);
    });

    it("screenshot files are production-quality assets (branch-aware)", () => {
      const githubRef = process.env.GITHUB_REF || "";
      const isProtectedBranch = /refs\/heads\/(main|release)/.test(githubRef);
      const MIN_SCREENSHOT_WIDTH = 800;
      const MIN_SCREENSHOT_HEIGHT = 400;

      for (const screenshot of manifest.screenshots!) {
        const filePath = path.join(extensionDir, screenshot.path);
        const buffer = readBufferFile(filePath);

        // Must be a valid PNG (magic bytes: 89 50 4E 47)
        const isPng =
          buffer[0] === 0x89 &&
          buffer[1] === 0x50 &&
          buffer[2] === 0x4e &&
          buffer[3] === 0x47;

        // Read dimensions from PNG IHDR chunk (bytes 16-23, big-endian uint32)
        const width = buffer.length >= 24 ? buffer.readUInt32BE(16) : 0;
        const height = buffer.length >= 24 ? buffer.readUInt32BE(20) : 0;

        if (isProtectedBranch) {
          expect(isPng).toBe(true);
          expect(width).toBeGreaterThanOrEqual(MIN_SCREENSHOT_WIDTH);
          expect(height).toBeGreaterThanOrEqual(MIN_SCREENSHOT_HEIGHT);
        } else if (
          !isPng ||
          width < MIN_SCREENSHOT_WIDTH ||
          height < MIN_SCREENSHOT_HEIGHT
        ) {
          console.warn(
            `WARNING: ${screenshot.path} may be a placeholder ` +
              `(${width}x${height}, png=${isPng}). ` +
              `Must be a real screenshot (>=${MIN_SCREENSHOT_WIDTH}x${MIN_SCREENSHOT_HEIGHT} PNG) before merging to main.`,
          );
        }
      }
    });
  });
});
