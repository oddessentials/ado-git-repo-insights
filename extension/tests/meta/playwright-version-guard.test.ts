/**
 * Meta-test: Playwright Version Guard
 *
 * Enforces exact version pinning for @playwright/test dependency.
 * Caret (^) or tilde (~) versions cause non-deterministic CI behavior.
 *
 * Contract: DC-001
 * - Playwright version MUST be exactly pinned (no ^, no ~, no range)
 * - Format: "X.Y.Z" (three-part semver, no prefix)
 *
 * @see specs/022-deterministic-smoke-tests/contracts/test-contracts.md
 */

import * as path from "path";
import { readJsonFile } from "../helpers/fs-test-utils";

interface PackageJsonDeps {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

describe("Playwright Version Guard", () => {
  /**
   * DC-001: Playwright version is exactly pinned
   *
   * The @playwright/test dependency must use an exact version (e.g., "1.40.0")
   * without any range specifiers (^, ~, >, <, etc.).
   */
  it("DC-001: Playwright version is exactly pinned", () => {
    const packageJsonPath = path.resolve(__dirname, "../../package.json");
    const packageJson = readJsonFile<PackageJsonDeps>(packageJsonPath);

    const playwrightVersion =
      packageJson.devDependencies?.["@playwright/test"] ||
      packageJson.dependencies?.["@playwright/test"];

    // Must exist
    if (!playwrightVersion) {
      throw new Error(
        "@playwright/test not found in package.json dependencies",
      );
    }

    // Must be exact version (X.Y.Z format, no prefix)
    const exactVersionRegex = /^\d+\.\d+\.\d+$/;
    if (!exactVersionRegex.test(playwrightVersion)) {
      throw new Error(
        `@playwright/test version "${playwrightVersion}" is not exactly pinned. ` +
          `Use exact version (e.g., "1.40.0") without ^ or ~ prefix.`,
      );
    }
  });

  /**
   * Supplementary: Verify serve package is pinned
   *
   * The serve package is used for smoke test web servers.
   * It should also be pinned for reproducibility.
   */
  it("serve package version is pinned", () => {
    const packageJsonPath = path.resolve(__dirname, "../../package.json");
    const packageJson = readJsonFile<PackageJsonDeps>(packageJsonPath);

    const serveVersion =
      packageJson.devDependencies?.["serve"] ||
      packageJson.dependencies?.["serve"];

    // Must exist
    if (!serveVersion) {
      throw new Error("serve not found in package.json dependencies");
    }

    // Must be exact version (X.Y.Z format, no prefix)
    const exactVersionRegex = /^\d+\.\d+\.\d+$/;
    if (!exactVersionRegex.test(serveVersion)) {
      throw new Error(
        `serve version "${serveVersion}" is not exactly pinned. ` +
          `Use exact version (e.g., "14.2.0") without ^ or ~ prefix.`,
      );
    }
  });
});
