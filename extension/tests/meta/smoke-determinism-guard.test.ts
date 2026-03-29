/**
 * Meta-test: Smoke Test Determinism Guard
 *
 * Enforces determinism contracts for smoke tests via static analysis.
 * These tests scan smoke test files for forbidden patterns that cause flakiness.
 *
 * Contracts enforced:
 * - WPC-001: No waitForTimeout() calls
 * - WPC-002: No networkidle waits
 * - TC-002: No timeout literals (must use SMOKE_TIMEOUT_MS)
 * - AC-001: All screenshots must use testInfo.outputPath()
 * - CQ-001: No custom deepClone implementations
 *
 * @see specs/022-deterministic-smoke-tests/contracts/test-contracts.md
 */

import * as _fsOriginal from "fs";
function _loadFs(): typeof _fsOriginal { return _fsOriginal; }
const _fs = _loadFs();
import * as path from "path";
import { glob } from "glob";

const SMOKE_DIR = path.resolve(__dirname, "../smoke");
const TESTS_DIR = path.resolve(__dirname, "..");

describe("Smoke Test Determinism Guard", () => {
  let smokeTestFiles: string[];

  beforeAll(async () => {
    // Get all smoke test files
    smokeTestFiles = await glob("**/*.smoke.ts", {
      cwd: SMOKE_DIR,
      absolute: true,
    });
  });

  /**
   * WPC-001: No waitForTimeout in smoke tests
   *
   * waitForTimeout() is a fixed delay that causes flaky tests.
   * Tests must use condition-based waits instead.
   */
  it("WPC-001: no waitForTimeout in smoke tests", () => {
    const violations: string[] = [];

    for (const file of smokeTestFiles) {
      const content = _fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");

      lines.forEach((line, index) => {
        if (line.includes("waitForTimeout")) {
          violations.push(
            `${path.basename(file)}:${index + 1}: ${line.trim()}`,
          );
        }
      });
    }

    if (violations.length > 0) {
      throw new Error(
        `waitForTimeout() found in smoke tests (use condition-based waits instead):\n${violations.join("\n")}`,
      );
    }
  });

  /**
   * WPC-002: No networkidle in smoke tests
   *
   * networkidle waits for 500ms of no network activity, which is unreliable.
   * Tests must use explicit DOM state assertions instead.
   */
  it("WPC-002: no networkidle in smoke tests", () => {
    const violations: string[] = [];

    for (const file of smokeTestFiles) {
      const content = _fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");

      lines.forEach((line, index) => {
        if (line.includes("networkidle")) {
          violations.push(
            `${path.basename(file)}:${index + 1}: ${line.trim()}`,
          );
        }
      });
    }

    if (violations.length > 0) {
      throw new Error(
        `networkidle found in smoke tests (use explicit DOM state assertions instead):\n${violations.join("\n")}`,
      );
    }
  });

  /**
   * TC-002: No timeout literals in smoke tests
   *
   * All timeouts must use the centralized SMOKE_TIMEOUT_MS constant.
   * Hardcoded timeout values (e.g., { timeout: 5000 }) are forbidden.
   */
  it("TC-002: no timeout literals in smoke tests", () => {
    const violations: string[] = [];
    // Match patterns like "timeout: 5000" or "timeout: 15000" but not "timeout: SMOKE_TIMEOUT_MS"
    const timeoutLiteralRegex = /timeout:\s*\d+/g;

    for (const file of smokeTestFiles) {
      const content = _fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");

      lines.forEach((line, index) => {
        // Skip lines that use the constant
        if (line.includes("SMOKE_TIMEOUT_MS")) {
          return;
        }
        const matches = line.match(timeoutLiteralRegex);
        if (matches) {
          violations.push(
            `${path.basename(file)}:${index + 1}: ${line.trim()}`,
          );
        }
      });
    }

    if (violations.length > 0) {
      throw new Error(
        `Timeout literals found in smoke tests (use SMOKE_TIMEOUT_MS instead):\n${violations.join("\n")}`,
      );
    }
  });

  /**
   * AC-001: All screenshots must use testInfo.outputPath()
   *
   * Hardcoded screenshot paths cause artifact collisions in parallel execution.
   * All page.screenshot() calls must use testInfo.outputPath(filename).
   */
  it("AC-001: all screenshots use testInfo.outputPath", () => {
    const violations: string[] = [];
    // Match patterns like 'path: "test-artifacts/' or "path: 'test-artifacts/"
    const hardcodedPathRegex = /path:\s*["']test-artifacts\//g;

    for (const file of smokeTestFiles) {
      const content = _fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");

      lines.forEach((line, index) => {
        const matches = line.match(hardcodedPathRegex);
        if (matches) {
          violations.push(
            `${path.basename(file)}:${index + 1}: ${line.trim()}`,
          );
        }
      });
    }

    if (violations.length > 0) {
      throw new Error(
        `Hardcoded screenshot paths found (use testInfo.outputPath() instead):\n${violations.join("\n")}`,
      );
    }
  });

  /**
   * CQ-001: No custom deepClone implementations
   *
   * Tests must use native structuredClone() for deep cloning.
   * Custom deepClone functions are maintenance burden and may have bugs.
   */
  it("CQ-001: no custom deepClone implementations in tests", async () => {
    const violations: string[] = [];
    const functionDefRegex = /function\s+deepClone/g;
    const arrowFunctionRegex = /const\s+deepClone\s*=/g;

    // Scan all test files, not just smoke tests
    const allTestFiles = await glob("**/*.ts", {
      cwd: TESTS_DIR,
      absolute: true,
      ignore: ["**/node_modules/**"],
    });

    for (const file of allTestFiles) {
      const content = _fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");

      lines.forEach((line, index) => {
        if (functionDefRegex.test(line) || arrowFunctionRegex.test(line)) {
          violations.push(
            `${path.relative(TESTS_DIR, file)}:${index + 1}: ${line.trim()}`,
          );
        }
        // Reset regex lastIndex for next iteration
        functionDefRegex.lastIndex = 0;
        arrowFunctionRegex.lastIndex = 0;
      });
    }

    if (violations.length > 0) {
      throw new Error(
        `Custom deepClone implementations found (use structuredClone() instead):\n${violations.join("\n")}`,
      );
    }
  });
});
