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
import * as _fsOriginal from "fs";
function _loadFs(): typeof _fsOriginal {
  return _fsOriginal;
}
const _fs = _loadFs();
import * as path from "path";
import { execFileSync, execSync } from "child_process";

describe("VSIX Artifact Inspection (Tier B)", () => {
  const extensionDir = path.join(__dirname, "..");
  const vsixPattern = /OddEssentials\.ado-git-repo-insights-[\d.]+\.vsix$/;
  const vsixRequired = process.env.VSIX_REQUIRED === "true";

  // Find the latest VSIX file
  function findLatestVsix(): string | null {
    try {
      const files = _fs.readdirSync(extensionDir);
      const vsixFiles = files.filter((f) => vsixPattern.test(f));
      if (vsixFiles.length === 0) return null;
      // Sort by modification time, newest first
      vsixFiles.sort((a, b) => {
        const statA = _fs.statSync(path.join(extensionDir, a));
        const statB = _fs.statSync(path.join(extensionDir, b));
        return statB.mtimeMs - statA.mtimeMs;
      });
      return path.join(extensionDir, vsixFiles[0]!);
    } catch {
      return null;
    }
  }

  const vsixPath = findLatestVsix();
  let vsixContents: string[] = [];
  let manifest: {
    contributions?: Array<{ id?: string; properties?: { uri?: string } }>;
    screenshots?: Array<{ path: string }>;
  };

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
    manifest = JSON.parse(_fs.readFileSync(manifestPath, "utf-8"));

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
      } catch (error) {
        if (vsixRequired) {
          const wrappedError = new Error(
            `Failed to read VSIX contents on Windows: ${error}`,
          );
          (wrappedError as Error & { cause?: unknown }).cause = error;
          throw wrappedError;
        }
      }
    } else {
      // Unix: invoke `unzip -l` directly via execFileSync — no shell, no
      // pipeline. The previous form `unzip -l ... | awk ...` masked unzip's
      // failure (e.g. binary missing) because the pipeline's exit code came
      // from awk, which happily processes 0 lines and exits 0. With
      // execFileSync the failure surfaces as ENOENT/non-zero exit and is
      // caught below.
      let output: string;
      try {
        output = execFileSync("unzip", ["-l", vsixPath], {
          encoding: "utf-8",
          cwd: extensionDir,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        // Spawn-time ENOENT/EACCES means the unzip binary itself could not
        // be invoked. WSL's Node reports EACCES (errno -13) when the binary
        // is not in PATH (its `/mnt/c/...` entries fail readdir during the
        // lookup); native Linux/macOS report ENOENT. Treat both as the
        // "unzip not installed" remediation case.
        if (
          (err.code === "ENOENT" || err.code === "EACCES") &&
          err.syscall?.startsWith("spawn") &&
          vsixRequired
        ) {
          const wrapped = new Error(
            `unzip could not be invoked (${err.code}). It is required on ` +
              "macOS/Linux for VSIX artifact inspection — install it with " +
              "your distro package manager " +
              "(e.g. `apt install unzip`, `brew install unzip`).",
          );
          (wrapped as Error & { cause?: unknown }).cause = error;
          throw wrapped;
        }
        if (vsixRequired) {
          const wrappedError = new Error(
            `Failed to read VSIX contents on Unix: ${error}`,
          );
          (wrappedError as Error & { cause?: unknown }).cause = error;
          throw wrappedError;
        }
        return;
      }

      // `unzip -l` output:
      //  Length      Date    Time    Name
      // ---------  ---------- -----   ----
      //      161  2026-01-01 12:34   extension.vsomanifest
      //      ...
      // ---------                     -------
      //   1234                        17 files
      //
      // Capture the rows BETWEEN the two `---`-prefixed separator lines and
      // take column 4+ (filenames may contain spaces). Separator-driven
      // parsing is more robust than a fixed `slice(3)` if unzip ever adjusts
      // its banner.
      const lines = output.split(/\r?\n/);
      let inDataSection = false;
      for (const line of lines) {
        if (/^-{3,}/.test(line)) {
          if (inDataSection) break; // footer separator: end of file list
          inDataSection = true; // header separator: file list begins next line
          continue;
        }
        if (!inDataSection) continue;
        const cols = line.trim().split(/\s+/);
        if (cols.length >= 4) {
          vsixContents.push(cols.slice(3).join(" "));
        }
      }
    }

    // Regression lock: if the VSIX is required and content extraction yielded
    // nothing, fail at setup time. Closes the silent-empty class — every
    // per-file assertion would otherwise report a confusing `Received array: []`.
    if (vsixRequired && vsixContents.length === 0) {
      throw new Error(
        "VSIX artifact inspection extracted an empty content list. " +
          "The VSIX may be malformed, or the platform extractor " +
          `(${process.platform === "win32" ? "PowerShell" : "unzip"}) ` +
          "produced unexpected output.",
      );
    }
  });

  // Skip justification: requires VSIX artifact on disk (produced by package:vsix); not available in standard test runs
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

    it("VSIX contains icon file", () => {
      expect(vsixContents.some((f) => f === "images/icon.png")).toBe(true);
    });

    it("VSIX contains overview.md", () => {
      expect(vsixContents.some((f) => f === "overview.md")).toBe(true);
    });

    it("VSIX contains all screenshot files", () => {
      const screenshots = manifest.screenshots || [];
      for (const screenshot of screenshots) {
        expect(vsixContents).toContain(screenshot.path);
      }
    });
  });
});
