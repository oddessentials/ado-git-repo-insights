/**
 * Guard: suppression count in refactor-touched files does not increase.
 *
 * Uses the same allowlist-driven pattern as any-type-ratchet.test.ts.
 * Ensures eslint-disable, @ts-ignore, and @ts-expect-error directives
 * in files cleaned by the any-types refactor stay within declared caps.
 */

import * as path from "path";
import { pathExists, readJsonFile, readTextFile } from "../helpers/fs-test-utils";

// Matches eslint-disable (block or line), @ts-ignore, @ts-expect-error
const SUPPRESSION_PATTERN =
  /eslint-disable(?:-next-line|-line)?|@ts-ignore|@ts-expect-error/g;

type CapEntry = { file: string; max: number; reason: string };
type AllowlistConfig = {
  caps: CapEntry[];
  zeroSuppressionFiles: string[];
};

const extensionRoot = path.join(__dirname, "..", "..");
const config = readJsonFile<AllowlistConfig>(
  path.join(__dirname, "suppression-ratchet.allowlist.json"),
);

function countSuppressions(filePath: string): {
  count: number;
  lines: string[];
} {
  const fullPath = path.join(extensionRoot, filePath);
  if (!pathExists(fullPath)) return { count: 0, lines: [] };

  const content = readTextFile(fullPath);
  const fileLines = content.split("\n");
  const violations: string[] = [];

  for (let i = 0; i < fileLines.length; i++) {
    const line = fileLines[i];
    // Count all suppression directives (including comments — these ARE the suppressions)
    const matches = line.match(SUPPRESSION_PATTERN);
    if (matches) {
      violations.push(`${filePath}:${i + 1}: ${line.trim()}`);
    }
  }

  return { count: violations.length, lines: violations };
}

describe("suppression ratchet guard", () => {
  it("capped files do not exceed their declared suppression limits", () => {
    const violations: string[] = [];

    for (const cap of config.caps) {
      const result = countSuppressions(cap.file);
      if (result.count > cap.max) {
        violations.push(
          `${cap.file}: ${result.count} suppressions (cap: ${cap.max}, reason: ${cap.reason})`,
        );
        violations.push(...result.lines.map((l) => `  ${l}`));
      }
    }

    expect(violations).toEqual([]);
  });

  it("zero-suppression files remain clean", () => {
    const violations: string[] = [];

    for (const file of config.zeroSuppressionFiles) {
      const result = countSuppressions(file);
      if (result.count > 0) {
        violations.push(
          `${file}: expected 0 suppressions, found ${result.count}`,
        );
        violations.push(...result.lines.map((l) => `  ${l}`));
      }
    }

    expect(violations).toEqual([]);
  });

  it("total suppression count across touched files does not exceed ceiling", () => {
    // 1 file-level block in fs-test-utils + 1 prefer-const in dashboard
    // + 2 prefer-const in production-issues = 4 total
    const SUPPRESSION_CEILING = 4;

    const allFiles = [
      ...config.caps.map((c) => c.file),
      ...config.zeroSuppressionFiles,
    ];

    let total = 0;
    for (const file of allFiles) {
      total += countSuppressions(file).count;
    }

    if (total > SUPPRESSION_CEILING) {
      throw new Error(
        `Suppression count (${total}) exceeds ceiling (${SUPPRESSION_CEILING}). ` +
          `This ceiling is a temporary maximum that may only decrease. ` +
          `If you must raise it, add explicit justification and request review.`,
      );
    }

    expect(total).toBeLessThanOrEqual(SUPPRESSION_CEILING);
  });
});
