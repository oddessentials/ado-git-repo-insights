/**
 * Meta-test: broken-docs Drift Protection
 *
 * This test validates that the broken-docs fixture maintains structural parity
 * with docs/index.html. When docs changes, broken-docs must be updated to match
 * so that negative smoke tests remain valid.
 *
 * Purpose: Detect when docs/index.html changes in ways that would break
 * the negative smoke test fixture.
 */

import * as _fsOriginal from "fs";
function _loadFs(): typeof _fsOriginal {
  return _fsOriginal;
}
const _fs = _loadFs();
import * as path from "path";

describe("broken-docs Drift Protection", () => {
  const DOCS_HTML = path.resolve(__dirname, "../../../docs/index.html");
  const BROKEN_HTML = path.resolve(
    __dirname,
    "../fixtures/broken-docs/index.html",
  );

  /**
   * Required structural elements that must exist in both docs and broken-docs.
   * These are the DOM elements that smoke tests depend on.
   */
  const REQUIRED_STRUCTURE = [
    'id="main-content"',
    'id="loading-state"',
    'id="comments-coverage-banner"',
    'id="repo-filter-group"',
    'id="team-filter-group"',
    'id="reviewer-filter-group"',
    'id="reviewer-filter-notice"',
    'id="author-filter-group"',
    'id="author-filter-notice"',
    'data-testid="error-setup-required"',
    'data-testid="error-generic"',
    'data-testid="filter-repository"',
    'data-testid="filter-team"',
    'data-testid="filter-reviewer"',
    'data-testid="filter-author"',
    'id="setup-required"',
    'id="error-state"',
  ];

  it("docs/index.html exists", () => {
    expect(_fs.existsSync(DOCS_HTML)).toBe(true);
  });

  it("broken-docs/index.html exists", () => {
    expect(_fs.existsSync(BROKEN_HTML)).toBe(true);
  });

  it("broken-docs/index.html has same structure as docs/index.html", () => {
    const docsContent = _fs.readFileSync(DOCS_HTML, "utf-8");
    const brokenContent = _fs.readFileSync(BROKEN_HTML, "utf-8");

    const missingInDocs: string[] = [];
    const missingInBroken: string[] = [];

    for (const pattern of REQUIRED_STRUCTURE) {
      if (!docsContent.includes(pattern)) {
        missingInDocs.push(pattern);
      }
      if (!brokenContent.includes(pattern)) {
        missingInBroken.push(pattern);
      }
    }

    if (missingInDocs.length > 0) {
      throw new Error(
        `docs/index.html is missing required structure:\n` +
          `  ${missingInDocs.join("\n  ")}\n\n` +
          `These elements are required for smoke tests.`,
      );
    }

    if (missingInBroken.length > 0) {
      throw new Error(
        `broken-docs/index.html is missing required structure:\n` +
          `  ${missingInBroken.join("\n  ")}\n\n` +
          `Sync broken-docs/index.html with docs/index.html to maintain parity.`,
      );
    }

    expect(missingInDocs).toEqual([]);
    expect(missingInBroken).toEqual([]);
  });

  it("broken-docs/data/dataset-manifest.json contains intentionally malformed JSON", () => {
    const manifestPath = path.resolve(
      __dirname,
      "../fixtures/broken-docs/data/dataset-manifest.json",
    );

    expect(_fs.existsSync(manifestPath)).toBe(true);

    const content = _fs.readFileSync(manifestPath, "utf-8");

    // The manifest should NOT be valid JSON (intentionally malformed)
    let isValidJson = true;
    try {
      JSON.parse(content);
    } catch {
      isValidJson = false;
    }

    if (isValidJson) {
      throw new Error(
        "broken-docs/data/dataset-manifest.json should be intentionally malformed JSON",
      );
    }
    expect(isValidJson).toBe(false);
  });

  it("broken-docs has required JS and CSS files", () => {
    const brokenDocsDir = path.resolve(__dirname, "../fixtures/broken-docs");

    const requiredFiles = [
      "index.html",
      "styles.css",
      "error-types.js",
      "artifact-client.js",
      "dataset-loader.js",
      "dashboard.js",
      "data/dataset-manifest.json",
    ];

    const missingFiles: string[] = [];
    for (const file of requiredFiles) {
      const filePath = path.join(brokenDocsDir, file);
      if (!_fs.existsSync(filePath)) {
        missingFiles.push(file);
      }
    }

    if (missingFiles.length > 0) {
      throw new Error(
        `broken-docs fixture is missing required files:\n` +
          `  ${missingFiles.join("\n  ")}\n\n` +
          `These files are required for the negative smoke test.`,
      );
    }

    expect(missingFiles).toEqual([]);
  });
});
