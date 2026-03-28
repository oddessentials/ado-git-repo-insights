/**
 * Guard: no `as any` / `: any` in files cleaned by refactor/any-types.
 *
 * This test locks the branch's stated goal: every file modified in the
 * any-types refactor must be free of explicit `any` usage (unless allowlisted).
 * If a future change reintroduces `any`, this test fails with the exact file and line.
 *
 * Additionally, a ratchet cap prevents new `any` from entering the broader
 * test suite without deliberate, reviewable justification.
 */

import * as path from "path";
import {
  pathExists,
  readDir,
  readJsonFile,
  readTextFile,
} from "../helpers/fs-test-utils";

// Pattern matches TypeScript any usage: ": any", "as any", "<any>"
// Requires proper type context boundaries to reduce false positives
const ANY_PATTERN = /:\s*any\s*[,;)}\]|[]|as\s+any\s*[,;)}\]|[]|<any>/g;

type AllowlistEntry = {
  file: string;
  maxCount: number;
  reason: string;
};
type AllowlistConfig = {
  allowlist: AllowlistEntry[];
  scanDirs: string[];
};

const extensionRoot = path.join(__dirname, "..", "..");
const allowlistPath = path.join(__dirname, "any-type-ratchet.allowlist.json");
const config = readJsonFile<AllowlistConfig>(allowlistPath);

function collectTsFiles(dirOrFile: string): string[] {
  const fullPath = path.join(extensionRoot, dirOrFile);
  if (!pathExists(fullPath)) return [];

  // If it's a direct file reference (ends with .ts), return it
  if (dirOrFile.endsWith(".ts")) {
    return [dirOrFile];
  }

  // Otherwise scan directory recursively
  const results: string[] = [];
  function walk(dir: string, relativeBase: string) {
    const entries = readDir(dir);
    for (const entry of entries) {
      const fullEntry = path.join(dir, entry);
      const relativePath = path.join(relativeBase, entry);
      try {
        // Try reading as directory
        readDir(fullEntry);
        walk(fullEntry, relativePath);
      } catch {
        // It's a file
        if (entry.endsWith(".ts") && !entry.endsWith(".test.ts.snap")) {
          results.push(relativePath.replace(/\\/g, "/"));
        }
      }
    }
  }
  walk(fullPath, dirOrFile);
  return results;
}

function countAnyInFile(filePath: string): { count: number; lines: string[] } {
  const content = readTextFile(path.join(extensionRoot, filePath));
  const fileLines = content.split("\n");
  const violations: string[] = [];

  for (let i = 0; i < fileLines.length; i++) {
    const line = fileLines[i];
    // Skip comment-only lines
    if (line!.trimStart().startsWith("//") || line!.trimStart().startsWith("*")) {
      continue;
    }
    const matches = line!.match(ANY_PATTERN);
    if (matches) {
      violations.push(`${filePath}:${i + 1}: ${line!.trim()}`);
    }
  }

  return { count: violations.length, lines: violations };
}

describe("any-type ratchet guard", () => {
  describe("any-detection regex accuracy", () => {
    // True positives — must match
    it.each([
      ["const x: any;", "typed variable"],
      ["const x: any)", "function parameter"],
      ["foo as any;", "type assertion with semicolon"],
      ["foo as any,", "type assertion with comma"],
      ["items: any[]", "typed array"],
      ["data: any}", "object property"],
      ["arg: any|string", "union type"],
    ])("detects: %s (%s)", (input) => {
      expect(input.match(ANY_PATTERN)).not.toBeNull();
    });

    // True negatives — must NOT match
    it.each([
      ["// this removes any doubt", "word in comment"],
      ["const anything = 5;", "word starting with any"],
      ["const x: unknown;", "unknown type"],
      ["// : any in a comment", "type syntax in comment"],
      ["* @param {any} x - docs", "jsdoc comment"],
      ['const s = "as any";', "inside string literal"],
    ])("ignores: %s (%s)", (input) => {
      expect(input.match(ANY_PATTERN)).toBeNull();
    });
  });

  it("no explicit `any` in branch-cleaned files outside allowlist", () => {
    const allFiles: string[] = [];
    for (const scanDir of config.scanDirs) {
      allFiles.push(...collectTsFiles(scanDir));
    }

    const violations: string[] = [];

    for (const file of allFiles) {
      const allowEntry = config.allowlist.find((a) =>
        file.endsWith(a.file.replace(/\\/g, "/")),
      );

      const result = countAnyInFile(file);

      if (allowEntry) {
        // Allowlisted file: check count does not exceed declared maximum
        if (result.count > allowEntry.maxCount) {
          violations.push(
            `${file}: ${result.count} any occurrences (allowed: ${allowEntry.maxCount}, reason: ${allowEntry.reason})`,
          );
        }
      } else if (result.count > 0) {
        violations.push(...result.lines);
      }
    }

    expect(violations).toEqual([]);
  });

  it("test-file any count does not exceed ratchet ceiling", () => {
    // This ceiling is a temporary maximum that may only decrease.
    // After fixing local-mode-integration.test.ts, the baseline is 49.
    // If you must raise it, add explicit justification here and request review.
    const ANY_RATCHET_CAP = 49;

    const testsDir = path.join(extensionRoot, "tests");
    const allTestFiles: string[] = [];

    function walkTests(dir: string, relBase: string) {
      const entries = readDir(dir);
      for (const entry of entries) {
        const fullEntry = path.join(dir, entry);
        const rel = path.join(relBase, entry).replace(/\\/g, "/");
        try {
          readDir(fullEntry);
          walkTests(fullEntry, rel);
        } catch {
          if (
            entry.endsWith(".ts") &&
            !entry.endsWith(".type-test.ts") &&
            !rel.includes("any-type-ratchet") &&
            !rel.includes("any-spread-guard")
          ) {
            allTestFiles.push(rel);
          }
        }
      }
    }
    walkTests(testsDir, "tests/");

    let totalAnyCount = 0;
    for (const file of allTestFiles) {
      totalAnyCount += countAnyInFile(file).count;
    }

    if (totalAnyCount > ANY_RATCHET_CAP) {
      throw new Error(
        `Test-file \`any\` count (${totalAnyCount}) exceeds ratchet ceiling (${ANY_RATCHET_CAP}). ` +
          `This ceiling is a temporary maximum that may only decrease. ` +
          `If you must raise it, add explicit justification in this test and request review.`,
      );
    }

    expect(totalAnyCount).toBeLessThanOrEqual(ANY_RATCHET_CAP);
  });
});
