/**
 * Meta-test: No Runtime Type-Test Imports
 *
 * Enforces that runtime code (extension/ui/) never imports from type-test files.
 * Type-test files are compile-time only and must not be bundled into production.
 *
 * Contract: CQ-003
 * - Files under extension/ui/ MUST NOT import from extension/tests/types/
 * - This includes both static imports and dynamic requires
 *
 * @see specs/022-deterministic-smoke-tests/contracts/test-contracts.md
 */

import * as path from "path";
import { glob } from "glob";
import { pathExists, readTextFile } from "../helpers/fs-test-utils";

const UI_DIR = path.resolve(__dirname, "../../ui");

describe("No Runtime Type-Test Imports", () => {
  /**
   * CQ-003: No imports from tests/types/ in ui/
   *
   * Scans all TypeScript files in extension/ui/ for imports that reference
   * the tests/types/ directory. Such imports would cause type-test code
   * to be included in the production bundle.
   */
  it("CQ-003: no imports from tests/types in ui/", async () => {
    const violations: string[] = [];

    // Patterns that would import from tests/types/
    const forbiddenPatterns = [
      /from\s+["']\.\.\/tests\/types\//,
      /from\s+["']\.\.\/\.\.\/tests\/types\//,
      /from\s+["']@\/tests\/types\//,
      /require\s*\(\s*["'].*tests\/types\//,
      /import\s*\(\s*["'].*tests\/types\//,
    ];

    // Get all TypeScript files in ui/
    const uiFiles = await glob("**/*.ts", {
      cwd: UI_DIR,
      absolute: true,
      ignore: ["**/node_modules/**", "**/*.d.ts"],
    });

    for (const file of uiFiles) {
      const content = readTextFile(file);
      const lines = content.split("\n");

      lines.forEach((line, index) => {
        for (const pattern of forbiddenPatterns) {
          if (pattern.test(line)) {
            violations.push(
              `${path.relative(UI_DIR, file)}:${index + 1}: ${line.trim()}`,
            );
            break; // Only report once per line
          }
        }
      });
    }

    if (violations.length > 0) {
      throw new Error(
        `Forbidden imports from tests/types/ found in ui/:\n${violations.join("\n")}\n\n` +
          `Type-test files are compile-time only and must not be imported by runtime code.`,
      );
    }
  });

  /**
   * Supplementary: Verify ui/ directory exists
   *
   * Ensures the meta-test is scanning the correct location.
   */
  it("ui/ directory exists", () => {
    if (!pathExists(UI_DIR)) {
      throw new Error(`UI directory not found at ${UI_DIR}`);
    }
  });
});
