/**
 * Meta-test: Type Test Header Guard
 *
 * Enforces that type-test files contain the required COMPILE-TIME ONLY header.
 * This header serves as documentation and a clear contract that these files
 * must never be imported by runtime code.
 *
 * Contract: CQ-002
 * - Type-test files (*.type-test.ts) MUST include "COMPILE-TIME ONLY" in header
 * - Header must appear at the beginning of the file (within first 5 lines)
 *
 * @see specs/022-deterministic-smoke-tests/contracts/test-contracts.md
 */

import * as path from "path";
import { glob } from "glob";
import { pathExists, readTextFile } from "../helpers/fs-test-utils";

const TYPES_DIR = path.resolve(__dirname, "../types");

describe("Type Test Header Guard", () => {
  /**
   * CQ-002: Type-test files have COMPILE-TIME ONLY header
   *
   * Scans all *.type-test.ts files and verifies they contain the required
   * "COMPILE-TIME ONLY" header comment within the first 10 lines.
   */
  it("CQ-002: type-test files have COMPILE-TIME ONLY header", async () => {
    const violations: string[] = [];
    const HEADER_SEARCH_LINES = 10;
    const REQUIRED_TEXT = "COMPILE-TIME ONLY";

    // Get all type-test files
    const typeTestFiles = await glob("**/*.type-test.ts", {
      cwd: TYPES_DIR,
      absolute: true,
    });

    // Verify at least one type-test file exists
    if (typeTestFiles.length === 0) {
      throw new Error(
        `No type-test files found in ${TYPES_DIR}. Expected at least one *.type-test.ts file.`,
      );
    }

    for (const file of typeTestFiles) {
      const content = readTextFile(file);
      const lines = content.split("\n").slice(0, HEADER_SEARCH_LINES);
      const headerContent = lines.join("\n");

      if (!headerContent.includes(REQUIRED_TEXT)) {
        violations.push(
          `${path.basename(file)}: Missing "${REQUIRED_TEXT}" header in first ${HEADER_SEARCH_LINES} lines`,
        );
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Type-test files missing required header:\n${violations.join("\n")}\n\n` +
          `Add the following comment to the top of each type-test file:\n` +
          `/**\n * COMPILE-TIME ONLY: This file must never be imported by runtime code paths.\n */`,
      );
    }
  });

  /**
   * Supplementary: Verify types/ directory exists
   *
   * Ensures the meta-test is scanning the correct location.
   */
  it("types/ directory exists", () => {
    if (!pathExists(TYPES_DIR)) {
      throw new Error(`Types directory not found at ${TYPES_DIR}`);
    }
  });
});
