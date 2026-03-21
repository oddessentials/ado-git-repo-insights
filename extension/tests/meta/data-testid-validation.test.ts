/**
 * Meta-test: data-testid DOM Validation
 *
 * This test validates that required data-testid attributes exist in docs/index.html.
 * It ensures the smoke tests have valid selectors to target.
 *
 * Contract: FR-022 (data-testid selectors only), FR-033, FR-034
 */

import * as fs from "fs";
import * as path from "path";

describe("data-testid DOM Validation", () => {
  const HTML_PATH = path.resolve(__dirname, "../../../docs/index.html");

  /**
   * Required data-testid attributes for smoke tests.
   * Each entry must exist in docs/index.html.
   */
  const REQUIRED_TEST_IDS = [
    "total-prs",
    "filter-repository",
    "filter-team",
    "filter-reviewer",
    "filter-author",
    "comments-coverage-banner",
    "error-setup-required",
    "error-generic",
  ];

  it("docs/index.html exists", () => {
    expect(fs.existsSync(HTML_PATH)).toBe(true);
  });

  it("all required data-testid attributes exist", () => {
    const html = fs.readFileSync(HTML_PATH, "utf-8");
    const missing: string[] = [];

    for (const testId of REQUIRED_TEST_IDS) {
      if (!html.includes(`data-testid="${testId}"`)) {
        missing.push(testId);
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `Missing required data-testid attributes in docs/index.html:\n` +
          `  ${missing.join(", ")}\n\n` +
          `These data-testid attributes are required by smoke tests.\n` +
          `Add them to the corresponding DOM elements.`,
      );
    }

    expect(missing).toEqual([]);
  });

  it("no duplicate data-testid attributes", () => {
    const html = fs.readFileSync(HTML_PATH, "utf-8");
    const matches = [...html.matchAll(/data-testid="([^"]+)"/g)];
    const ids = matches.map((m) => m[1]);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);

    if (duplicates.length > 0) {
      throw new Error(
        `Duplicate data-testid attributes found in docs/index.html:\n` +
          `  ${[...new Set(duplicates)].join(", ")}\n\n` +
          `Each data-testid must be unique within the document.`,
      );
    }

    expect(duplicates).toEqual([]);
  });

  it("data-testid values follow naming convention", () => {
    const html = fs.readFileSync(HTML_PATH, "utf-8");
    const matches = [...html.matchAll(/data-testid="([^"]+)"/g)];
    const ids = matches.map((m) => m[1]);

    // Convention: lowercase kebab-case (e.g., "filter-repository", "error-generic")
    const invalidIds = ids.filter(
      (id) => !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id),
    );

    if (invalidIds.length > 0) {
      throw new Error(
        `Invalid data-testid naming convention:\n` +
          `  ${invalidIds.join(", ")}\n\n` +
          `data-testid values should be lowercase kebab-case (e.g., "filter-repository").`,
      );
    }

    expect(invalidIds).toEqual([]);
  });

  /**
   * Validate that required test IDs are on semantic elements.
   * This ensures Playwright selectors target meaningful UI components.
   */
  it("required data-testid attributes are on appropriate elements", () => {
    const html = fs.readFileSync(HTML_PATH, "utf-8");

    // Check filter-repository is on a select element
    expect(html).toMatch(/<select[^>]*data-testid="filter-repository"/);

    // Check filter-team is on a select element
    expect(html).toMatch(/<select[^>]*data-testid="filter-team"/);

    // Check filter-reviewer is on a select element
    expect(html).toMatch(/<select[^>]*data-testid="filter-reviewer"/);

    // Check filter-author is on a searchable input element
    expect(html).toMatch(/<input[^>]*data-testid="filter-author"/);

    // Check comments coverage banner is on a displayable element
    expect(html).toMatch(/<div[^>]*data-testid="comments-coverage-banner"/);

    // Check total-prs is on a displayable element
    expect(html).toMatch(/<div[^>]*data-testid="total-prs"/);

    // Check error panels are on div elements
    expect(html).toMatch(/<div[^>]*data-testid="error-setup-required"/);
    expect(html).toMatch(/<div[^>]*data-testid="error-generic"/);
  });
});
