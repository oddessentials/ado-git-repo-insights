/**
 * Meta-test: Edge Case Traceability Enforcement
 *
 * This test scans metrics.edge-cases.test.ts for `// Covers EC-###:` comments
 * and fails if any EC-001 through EC-005 is missing or duplicated.
 *
 * Purpose: Ensure exhaustive edge case coverage is maintained and traceable.
 *
 * Contract: FR-037, FR-038
 */

import * as fs from "fs";
import * as path from "path";

describe("EC Traceability Meta-Test", () => {
  const REQUIRED_EDGE_CASES = [
    "EC-001",
    "EC-002",
    "EC-003",
    "EC-004",
    "EC-005",
  ];
  const EDGE_CASE_TEST_FILE = path.resolve(
    __dirname,
    "../modules/metrics.edge-cases.test.ts",
  );

  it("metrics.edge-cases.test.ts exists", () => {
    expect(fs.existsSync(EDGE_CASE_TEST_FILE)).toBe(true);
  });

  it("all required EC-### markers are present (EC-001 through EC-005)", () => {
    const content = fs.readFileSync(EDGE_CASE_TEST_FILE, "utf-8");

    // Pattern: // Covers EC-###: description
    const coveragePattern = /\/\/\s*Covers\s+(EC-\d{3}):/g;
    const matches = [...content.matchAll(coveragePattern)];
    const foundMarkers = matches.map((m) => m[1]);

    // Check for missing markers
    const missing = REQUIRED_EDGE_CASES.filter(
      (ec) => !foundMarkers.includes(ec),
    );
    if (missing.length > 0) {
      throw new Error(
        `Missing edge case coverage markers: ${missing.join(", ")}\n` +
          `Each edge case must have a comment: // Covers EC-###: description`,
      );
    }
  });

  it("no duplicate EC-### markers exist", () => {
    const content = fs.readFileSync(EDGE_CASE_TEST_FILE, "utf-8");

    // Pattern: // Covers EC-###: description
    const coveragePattern = /\/\/\s*Covers\s+(EC-\d{3}):/g;
    const matches = [...content.matchAll(coveragePattern)];
    const foundMarkers = matches.map((m) => m[1]);

    // Check for duplicates
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const marker of foundMarkers) {
      if (seen.has(marker)) {
        duplicates.push(marker);
      }
      seen.add(marker);
    }

    if (duplicates.length > 0) {
      throw new Error(
        `Duplicate edge case coverage markers: ${duplicates.join(", ")}\n` +
          `Each EC-### marker should appear exactly once.`,
      );
    }
  });

  it("EC markers follow the standard format", () => {
    const content = fs.readFileSync(EDGE_CASE_TEST_FILE, "utf-8");

    // Find all EC-### patterns
    const allEcPattern = /EC-\d{3}/g;
    const allMatches = [...content.matchAll(allEcPattern)];
    const allMarkers = new Set(allMatches.map((m) => m[0]));

    // Find properly formatted coverage comments
    const coveragePattern = /\/\/\s*Covers\s+(EC-\d{3}):/g;
    const properMatches = [...content.matchAll(coveragePattern)];
    const properMarkers = new Set(properMatches.map((m) => m[1]));

    // Check that all mentioned EC markers have proper coverage comments
    const unmarked = [...allMarkers].filter((m) => !properMarkers.has(m));
    // Filter out false positives (EC markers in comments/descriptions are OK)
    const requiredUnmarked = unmarked.filter((m) =>
      REQUIRED_EDGE_CASES.includes(m),
    );

    if (requiredUnmarked.length > 0) {
      // This is informational - the main check is in the previous test
      console.log(
        `Info: EC markers mentioned but not in "// Covers" format: ${requiredUnmarked.join(", ")}`,
      );
    }

    // All required markers should be in proper format
    expect(properMarkers.size).toBeGreaterThanOrEqual(
      REQUIRED_EDGE_CASES.length,
    );
  });

  it("each EC marker has an associated test", () => {
    const content = fs.readFileSync(EDGE_CASE_TEST_FILE, "utf-8");

    // Pattern: it("EC-### or it('EC-###
    const testPattern = /it\s*\(\s*["'`]EC-\d{3}/g;
    const matches = [...content.matchAll(testPattern)];

    expect(matches.length).toBeGreaterThanOrEqual(REQUIRED_EDGE_CASES.length);
  });
});
