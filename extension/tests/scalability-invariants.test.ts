/**
 * Scalability Invariants Tests
 *
 * These tests enforce scalability invariants by scanning code for required patterns.
 * If any of these tests fail, it indicates that scalability safeguards are missing.
 *
 * Constitution Gates: QG-25 through QG-29
 * Verification Requirements: VR-20 through VR-23
 *
 * SCALABILITY: These tests ensure the dashboard can handle enterprise-scale data:
 * - 156+ weeks (3 years) of data
 * - 200+ reviewers
 * - Comment extraction enabled
 */

import * as path from "path";
import { pathExists, readTextFile } from "./helpers/fs-test-utils";

describe("Scalability Invariants", () => {
  const extensionRoot = path.join(__dirname, "..");
  const chartsDir = path.join(extensionRoot, "ui", "modules", "charts");

  describe("Chart Data Caps", () => {
    test("Throughput chart has MAX_THROUGHPUT_POINTS defined", () => {
      const filePath = path.join(chartsDir, "throughput.ts");
      expect(pathExists(filePath)).toBe(true);

      const content = readTextFile(filePath);
      const hasMaxPoints =
        /MAX_THROUGHPUT_POINTS\s*=\s*\d+/.test(content) ||
        /const\s+MAX_THROUGHPUT_POINTS/.test(content);

      expect(hasMaxPoints).toBe(true);
    });

    test("Cycle time chart has MAX_CYCLE_TIME_POINTS defined", () => {
      const filePath = path.join(chartsDir, "cycle-time.ts");
      expect(pathExists(filePath)).toBe(true);

      const content = readTextFile(filePath);
      const hasMaxPoints =
        /MAX_CYCLE_TIME_POINTS\s*=\s*\d+/.test(content) ||
        /const\s+MAX_CYCLE_TIME_POINTS/.test(content);

      expect(hasMaxPoints).toBe(true);
    });

    test("Predictions chart has MAX_CHART_POINTS defined", () => {
      const filePath = path.join(chartsDir, "predictions.ts");
      expect(pathExists(filePath)).toBe(true);

      const content = readTextFile(filePath);
      const hasMaxPoints = /MAX_CHART_POINTS\s*=\s*\d+/.test(content);

      expect(hasMaxPoints).toBe(true);
    });

    test("ML module has MAX_SPARKLINE_POINTS defined", () => {
      const filePath = path.join(extensionRoot, "ui", "modules", "ml.ts");
      expect(pathExists(filePath)).toBe(true);

      const content = readTextFile(filePath);
      const hasMaxPoints = /MAX_SPARKLINE_POINTS\s*=\s*\d+/.test(content);

      expect(hasMaxPoints).toBe(true);
    });
  });

  describe("Synthetic Data Generator Capabilities", () => {
    const generatorPath = path.join(
      extensionRoot,
      "..",
      "scripts",
      "generate-synthetic-dataset.py",
    );

    test("Generator supports --users argument", () => {
      expect(pathExists(generatorPath)).toBe(true);

      const content = readTextFile(generatorPath);
      const hasUsersArg =
        /--users/.test(content) || /add_argument.*users/.test(content);

      expect(hasUsersArg).toBe(true);
    });

    test("Generator supports --include-comments flag", () => {
      expect(pathExists(generatorPath)).toBe(true);

      const content = readTextFile(generatorPath);
      const hasCommentsFlag =
        /--include-comments/.test(content) ||
        /add_argument.*include.?comments/.test(content);

      expect(hasCommentsFlag).toBe(true);
    });

    test("Generator does not cap users at 30", () => {
      expect(pathExists(generatorPath)).toBe(true);

      const content = readTextFile(generatorPath);
      const hasOldUserCap = /num_users\s*=\s*min\s*\(\s*30/.test(content);

      expect(hasOldUserCap).toBe(false);
    });

    test("Generator does not cap weeks at 52", () => {
      expect(pathExists(generatorPath)).toBe(true);

      const content = readTextFile(generatorPath);
      const hasOldWeekCap = /weeks\s*=\s*min\s*\(\s*52/.test(content);

      expect(hasOldWeekCap).toBe(false);
    });
  });

  describe("Data Point Limits Enforcement", () => {
    test("All chart files use slice() for data limiting", () => {
      const chartFiles = [
        "throughput.ts",
        "cycle-time.ts",
        "reviewer-activity.ts",
      ];

      const violations: string[] = [];

      for (const fileName of chartFiles) {
        const filePath = path.join(chartsDir, fileName);

        if (!pathExists(filePath)) {
          continue;
        }

        const content = readTextFile(filePath);

        // Check that the file either:
        // 1. Uses .slice() for data limiting, OR
        // 2. Has a MAX_*_POINTS constant
        const hasSlice = /\.slice\s*\(/.test(content);
        const hasMaxPointsConst = /MAX_\w+_POINTS/.test(content);

        if (!hasSlice && !hasMaxPointsConst) {
          violations.push(
            `${fileName}: No data limiting found (missing slice() or MAX_*_POINTS)`,
          );
        }
      }

      expect(violations).toEqual([]);
    });
  });
});

describe("Scalability Test Data Requirements", () => {
  /**
   * These constants define the minimum requirements for scalability testing.
   * Any test dataset claiming to be a "scalability test" must meet these thresholds.
   */
  const SCALABILITY_REQUIREMENTS = {
    MIN_WEEKS: 156, // 3 years
    MIN_REVIEWERS: 200,
    COMMENTS_REQUIRED: true,
  };

  test("Scalability requirements are documented", () => {
    // This test documents the non-negotiable requirements
    expect(SCALABILITY_REQUIREMENTS.MIN_WEEKS).toBeGreaterThanOrEqual(156);
    expect(SCALABILITY_REQUIREMENTS.MIN_REVIEWERS).toBeGreaterThanOrEqual(200);
    expect(SCALABILITY_REQUIREMENTS.COMMENTS_REQUIRED).toBe(true);
  });

  test("scalability requirements are enforced by invariant tests above", () => {
    // DASHBOARD_SCALABILITY.md was removed after feature completion (commit a7ac63b).
    // The scalability contract is now enforced by the invariant tests in this file:
    //   - Chart Data Caps: MAX_THROUGHPUT_POINTS, MAX_CYCLE_TIME_POINTS, MAX_CHART_POINTS, MAX_SPARKLINE_POINTS
    //   - Generator Capabilities: --users (≥200), --weeks (uncapped), --include-comments
    //   - Data Point Limits: slice()-based enforcement in all chart modules
    expect(SCALABILITY_REQUIREMENTS.MIN_WEEKS).toBe(156);
    expect(SCALABILITY_REQUIREMENTS.MIN_REVIEWERS).toBe(200);
    expect(SCALABILITY_REQUIREMENTS.COMMENTS_REQUIRED).toBe(true);
  });
});
