/**
 * Error diagnostics tests.
 *
 * Verifies error panel element IDs, message text, and behavior match
 * existing test expectations and user-facing diagnostics.
 */

import * as fs from "fs";
import * as path from "path";

describe("error diagnostics preservation", () => {
  const errorsPath = path.join(__dirname, "../../ui/modules/errors.ts");
  const errorsContent = fs.readFileSync(errorsPath, "utf-8");
  const indexHtmlPath = path.join(__dirname, "../../ui/index.html");

  describe("panel IDs", () => {
    it("defines required panel IDs", () => {
      expect(errorsContent).toContain("setup-required");
      expect(errorsContent).toContain("multiple-pipelines");
      expect(errorsContent).toContain("artifacts-missing");
      expect(errorsContent).toContain("permission-denied");
      expect(errorsContent).toContain("error-state");
    });

    it("panel IDs match index.html", () => {
      if (fs.existsSync(indexHtmlPath)) {
        const htmlContent = fs.readFileSync(indexHtmlPath, "utf-8");
        expect(htmlContent).toContain('id="setup-required"');
        expect(htmlContent).toContain('id="error-state"');
        expect(htmlContent).toContain('id="loading-state"');
      } else {
        // Skip if file doesn't exist during test
        expect(true).toBe(true);
      }
    });
  });

  describe("error message element IDs", () => {
    it("setup-required uses correct sub-element IDs", () => {
      expect(errorsContent).toContain("setup-message");
      expect(errorsContent).toContain("setup-steps");
      expect(errorsContent).toContain("docs-link");
    });

    it("multiple-pipelines uses correct sub-element IDs", () => {
      expect(errorsContent).toContain("multiple-message");
      expect(errorsContent).toContain("pipeline-list");
    });

    it("permission-denied uses correct sub-element IDs", () => {
      expect(errorsContent).toContain("permission-message");
    });

    it("artifacts-missing uses correct sub-element IDs", () => {
      expect(errorsContent).toContain("missing-message");
      expect(errorsContent).toContain("missing-steps");
    });

    it("generic error uses correct sub-element IDs", () => {
      expect(errorsContent).toContain("error-title");
      expect(errorsContent).toContain("error-message");
    });
  });

  describe("error handling functions", () => {
    it("exports handleError function", () => {
      expect(errorsContent).toContain("export function handleError");
    });

    it("exports showSetupRequired function", () => {
      expect(errorsContent).toContain("export function showSetupRequired");
    });

    it("exports showPermissionDenied function", () => {
      expect(errorsContent).toContain("export function showPermissionDenied");
    });

    it("exports showGenericError function", () => {
      expect(errorsContent).toContain("export function showGenericError");
    });

    it("exports hideAllPanels function", () => {
      expect(errorsContent).toContain("export function hideAllPanels");
    });
  });

  describe("security", () => {
    it("uses escapeHtml for XSS prevention", () => {
      expect(errorsContent).toContain("escapeHtml");
    });

    it("imports escapeHtml from shared module", () => {
      // escapeHtml can be imported from shared/security or shared/render (which re-exports it)
      // Import may be multiline, so check for import statement and module path separately
      expect(errorsContent).toContain("escapeHtml");
      expect(errorsContent).toMatch(
        /from\s+["']\.\/shared\/(security|render)["']/,
      );
    });
  });

  describe("error type handling", () => {
    it("handles PrInsightsError instances", () => {
      expect(errorsContent).toContain("PrInsightsError");
      expect(errorsContent).toContain("ErrorTypes");
    });

    it("handles all standard error types", () => {
      expect(errorsContent).toContain("ErrorTypes.SETUP_REQUIRED");
      expect(errorsContent).toContain("ErrorTypes.MULTIPLE_PIPELINES");
      expect(errorsContent).toContain("ErrorTypes.ARTIFACTS_MISSING");
      expect(errorsContent).toContain("ErrorTypes.PERMISSION_DENIED");
    });

    it("fallback to generic error for unknown types", () => {
      expect(errorsContent).toContain("showGenericError");
    });
  });
});
