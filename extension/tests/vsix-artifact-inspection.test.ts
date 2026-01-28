/**
 * VSIX Artifact Inspection Tests (Tier B)
 *
 * ONLY run in jobs that package a VSIX. These tests inspect the
 * actual .vsix contents to prove what Azure DevOps will actually execute.
 *
 * Environment:
 * - VSIX_REQUIRED=true: Missing VSIX is a HARD FAILURE (not a skip)
 * - VSIX_REQUIRED unset/false: Tests skip if no VSIX exists
 *
 * Invariant: If a VSIX is shipped, CI must have inspected its contents.
 */
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

describe("VSIX Artifact Inspection (Tier B)", () => {
  const extensionDir = path.join(__dirname, "..");
  const vsixPattern = /OddEssentials\.ado-git-repo-insights-[\d.]+\.vsix$/;
  const vsixRequired = process.env.VSIX_REQUIRED === "true";

  // Find the latest VSIX file
  function findLatestVsix(): string | null {
    try {
      const files = fs.readdirSync(extensionDir);
      const vsixFiles = files.filter((f) => vsixPattern.test(f));
      if (vsixFiles.length === 0) return null;
      // Sort by modification time, newest first
      vsixFiles.sort((a, b) => {
        const statA = fs.statSync(path.join(extensionDir, a));
        const statB = fs.statSync(path.join(extensionDir, b));
        return statB.mtimeMs - statA.mtimeMs;
      });
      return path.join(extensionDir, vsixFiles[0]);
    } catch {
      return null;
    }
  }

  const vsixPath = findLatestVsix();
  let vsixContents: string[] = [];
  let manifest: any;

  beforeAll(() => {
    // HARD FAIL if VSIX required but missing
    if (vsixRequired && !vsixPath) {
      throw new Error(
        "VSIX_REQUIRED=true but no .vsix file found in extension/. " +
          'Run "npm run package:vsix" before running Tier B tests.',
      );
    }

    // Load manifest for contribution URI validation
    const manifestPath = path.join(extensionDir, "vss-extension.json");
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    if (!vsixPath) return;

    // Extract VSIX contents using platform-appropriate method
    const isWindows = process.platform === "win32";

    if (isWindows) {
      // Windows: Use PowerShell with proper escaping
      try {
        // Escape backslashes for PowerShell
        const escapedPath = vsixPath.replace(/\\/g, "\\\\");
        const output = execSync(
          `powershell -NoProfile -Command "Add-Type -Assembly System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::OpenRead('${escapedPath}').Entries | ForEach-Object { $_.FullName }"`,
          { encoding: "utf-8", cwd: extensionDir },
        );
        vsixContents = output.split(/\r?\n/).filter((l) => l.trim());
      } catch (e) {
        if (vsixRequired) {
          throw new Error(`Failed to read VSIX contents on Windows: ${e}`);
        }
      }
    } else {
      // Unix: Use unzip with awk
      try {
        const output = execSync(
          `unzip -l "${vsixPath}" | awk 'NR>3 {print $4}'`,
          {
            encoding: "utf-8",
            cwd: extensionDir,
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        vsixContents = output
          .split(/\r?\n/)
          .filter((l) => l && !l.includes("---"));
      } catch (e) {
        if (vsixRequired) {
          throw new Error(`Failed to read VSIX contents on Unix: ${e}`);
        }
      }
    }
  });

  // Skip entire suite if no VSIX and not required
  const skipTests = !vsixPath && !vsixRequired;

  (skipTests ? describe.skip : describe)("Actual VSIX Contents", () => {
    it("VSIX contains dist/ui directory", () => {
      expect(vsixContents.some((f) => f.startsWith("dist/ui/"))).toBe(true);
    });

    it("VSIX contains dist/ui/*.js files", () => {
      const jsFiles = vsixContents.filter(
        (f) => f.startsWith("dist/ui/") && f.endsWith(".js"),
      );
      expect(jsFiles).toContain("dist/ui/dashboard.js");
      expect(jsFiles).toContain("dist/ui/settings.js");
    });

    it("VSIX contains dist/ui/*.html files", () => {
      const htmlFiles = vsixContents.filter(
        (f) => f.startsWith("dist/ui/") && f.endsWith(".html"),
      );
      expect(htmlFiles).toContain("dist/ui/index.html");
      expect(htmlFiles).toContain("dist/ui/settings.html");
    });

    it("VSIX does NOT contain ui/*.ts source files", () => {
      const uiTsFiles = vsixContents.filter(
        (f) => f.startsWith("ui/") && f.endsWith(".ts") && !f.endsWith(".d.ts"),
      );
      expect(uiTsFiles).toEqual([]);
    });

    it("VSIX does NOT contain top-level ui/ directory", () => {
      // After the fix, there should be no ui/ directory, only dist/ui/
      const uiDirFiles = vsixContents.filter(
        (f) => f.startsWith("ui/") && !f.startsWith("dist/"),
      );
      expect(uiDirFiles).toEqual([]);
    });

    it("all contribution URIs resolve to files inside the VSIX", () => {
      const contributions = manifest.contributions || [];

      for (const contribution of contributions) {
        const uri = contribution.properties?.uri;
        if (uri) {
          // URI should exist in the VSIX
          const found = vsixContents.includes(uri);
          if (!found) {
            throw new Error(
              `Contribution ${contribution.id} has URI "${uri}" not found in VSIX`,
            );
          }
        }
      }
    });
  });
});
