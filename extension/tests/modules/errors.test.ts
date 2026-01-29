/**
 * Unit tests for errors module.
 *
 * Tests error panel display logic with DOM harness.
 */

import {
  handleError,
  hideAllPanels,
  showSetupRequired,
  showMultiplePipelines,
  showPermissionDenied,
  showGenericError,
  showArtifactsMissing,
  showLoading,
  showContent,
} from "../../ui/modules/errors";
import {
  PrInsightsError,
  ErrorTypes,
  createSetupRequiredError,
  createMultiplePipelinesError,
  createPermissionDeniedError,
  createArtifactsMissingError,
} from "../../ui/error-types";

/**
 * DOM structure for errors panel testing.
 * Matches the element IDs expected by the errors module.
 */
const ERROR_PANELS_DOM = `
  <div id="setup-required" class="hidden">
    <div id="setup-message"></div>
    <ul id="setup-steps"></ul>
    <a id="docs-link" href="#"></a>
  </div>
  <div id="multiple-pipelines" class="hidden">
    <div id="multiple-message"></div>
    <div id="pipeline-list"></div>
  </div>
  <div id="artifacts-missing" class="hidden">
    <div id="missing-message"></div>
    <ul id="missing-steps"></ul>
  </div>
  <div id="permission-denied" class="hidden">
    <div id="permission-message"></div>
  </div>
  <div id="error-state" class="hidden">
    <div id="error-title"></div>
    <div id="error-message"></div>
  </div>
  <div id="loading-state" class="hidden"></div>
  <div id="main-content" class="hidden"></div>
`;

describe("errors module", () => {
  beforeEach(() => {
    document.body.innerHTML = ERROR_PANELS_DOM;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  describe("hideAllPanels", () => {
    it("adds hidden class to all panel elements", () => {
      // First, show some panels
      document.getElementById("setup-required")?.classList.remove("hidden");
      document.getElementById("error-state")?.classList.remove("hidden");

      hideAllPanels();

      expect(
        document.getElementById("setup-required")?.classList.contains("hidden"),
      ).toBe(true);
      expect(
        document.getElementById("multiple-pipelines")?.classList.contains("hidden"),
      ).toBe(true);
      expect(
        document.getElementById("error-state")?.classList.contains("hidden"),
      ).toBe(true);
      expect(
        document.getElementById("loading-state")?.classList.contains("hidden"),
      ).toBe(true);
      expect(
        document.getElementById("main-content")?.classList.contains("hidden"),
      ).toBe(true);
    });

    it("handles missing elements gracefully", () => {
      document.body.innerHTML = ""; // Clear DOM

      expect(() => hideAllPanels()).not.toThrow();
    });
  });

  describe("showGenericError", () => {
    it("shows error panel with title and message", () => {
      showGenericError("Test Error", "Something went wrong");

      const errorPanel = document.getElementById("error-state");
      expect(errorPanel?.classList.contains("hidden")).toBe(false);

      expect(document.getElementById("error-title")?.textContent).toBe(
        "Test Error",
      );
      expect(document.getElementById("error-message")?.textContent).toBe(
        "Something went wrong",
      );
    });

    it("handles missing error panel gracefully", () => {
      document.body.innerHTML = ""; // Clear DOM

      expect(() => showGenericError("Error", "Message")).not.toThrow();
    });
  });

  describe("showSetupRequired", () => {
    it("shows setup panel with message", () => {
      const error = createSetupRequiredError();

      showSetupRequired(error);

      const panel = document.getElementById("setup-required");
      expect(panel?.classList.contains("hidden")).toBe(false);
    });

    it("populates instructions list from error details", () => {
      const error = createSetupRequiredError();

      showSetupRequired(error);

      const stepsList = document.getElementById("setup-steps");
      expect(stepsList?.children.length).toBe(4); // Factory creates 4 instructions
      expect(stepsList?.children[0]?.textContent).toContain("pipeline");
    });

    it("sets docs link href from error details", () => {
      const error = createSetupRequiredError();

      showSetupRequired(error);

      const docsLink = document.getElementById("docs-link") as HTMLAnchorElement;
      expect(docsLink?.href).toContain("github.com");
    });

    it("falls back to generic error when panel missing", () => {
      document.getElementById("setup-required")?.remove();
      const error = createSetupRequiredError();

      showSetupRequired(error);

      const errorPanel = document.getElementById("error-state");
      expect(errorPanel?.classList.contains("hidden")).toBe(false);
    });
  });

  describe("showMultiplePipelines", () => {
    it("shows multiple pipelines panel", () => {
      const error = createMultiplePipelinesError([
        { id: 1, name: "Pipeline 1" },
        { id: 2, name: "Pipeline 2" },
      ]);

      showMultiplePipelines(error);

      const panel = document.getElementById("multiple-pipelines");
      expect(panel?.classList.contains("hidden")).toBe(false);
    });

    it("renders pipeline options as links", () => {
      const error = createMultiplePipelinesError([
        { id: 123, name: "Build Pipeline" },
        { id: 456, name: "Release Pipeline" },
      ]);

      showMultiplePipelines(error);

      const listEl = document.getElementById("pipeline-list");
      expect(listEl?.innerHTML).toContain("?pipelineId=123");
      expect(listEl?.innerHTML).toContain("Build Pipeline");
      expect(listEl?.innerHTML).toContain("?pipelineId=456");
      expect(listEl?.innerHTML).toContain("Release Pipeline");
    });

    it("escapes HTML in pipeline names", () => {
      const error = createMultiplePipelinesError([
        { id: 1, name: '<script>alert("xss")</script>' },
      ]);

      showMultiplePipelines(error);

      const listEl = document.getElementById("pipeline-list");
      expect(listEl?.innerHTML).not.toContain("<script>");
      expect(listEl?.innerHTML).toContain("&lt;script&gt;");
    });

    it("falls back to generic error when panel missing", () => {
      document.getElementById("multiple-pipelines")?.remove();
      const error = createMultiplePipelinesError([{ id: 1, name: "Test" }]);

      showMultiplePipelines(error);

      const errorPanel = document.getElementById("error-state");
      expect(errorPanel?.classList.contains("hidden")).toBe(false);
    });
  });

  describe("showPermissionDenied", () => {
    it("shows permission denied panel", () => {
      const error = createPermissionDeniedError("view pipelines");

      showPermissionDenied(error);

      const panel = document.getElementById("permission-denied");
      expect(panel?.classList.contains("hidden")).toBe(false);
    });

    it("sets permission message", () => {
      const error = createPermissionDeniedError("access builds");

      showPermissionDenied(error);

      const messageEl = document.getElementById("permission-message");
      expect(messageEl?.textContent).toContain("access builds");
    });

    it("falls back to generic error when panel missing", () => {
      document.getElementById("permission-denied")?.remove();
      const error = createPermissionDeniedError("do something");

      showPermissionDenied(error);

      const errorPanel = document.getElementById("error-state");
      expect(errorPanel?.classList.contains("hidden")).toBe(false);
    });
  });

  describe("showArtifactsMissing", () => {
    it("shows artifacts missing panel", () => {
      const error = createArtifactsMissingError("Test Pipeline", 123);

      showArtifactsMissing(error);

      const panel = document.getElementById("artifacts-missing");
      expect(panel?.classList.contains("hidden")).toBe(false);
    });

    it("populates instructions list from error details", () => {
      const error = createArtifactsMissingError("Test Pipeline", 456);

      showArtifactsMissing(error);

      const stepsList = document.getElementById("missing-steps");
      expect(stepsList?.children.length).toBe(3); // Factory creates 3 instructions
    });

    it("falls back to generic error when panel missing", () => {
      document.getElementById("artifacts-missing")?.remove();
      const error = createArtifactsMissingError("Pipeline", 1);

      showArtifactsMissing(error);

      const errorPanel = document.getElementById("error-state");
      expect(errorPanel?.classList.contains("hidden")).toBe(false);
    });
  });

  describe("handleError", () => {
    it("handles SETUP_REQUIRED error type", () => {
      const error = createSetupRequiredError();

      handleError(error);

      const panel = document.getElementById("setup-required");
      expect(panel?.classList.contains("hidden")).toBe(false);
    });

    it("handles MULTIPLE_PIPELINES error type", () => {
      const error = createMultiplePipelinesError([{ id: 1, name: "Test" }]);

      handleError(error);

      const panel = document.getElementById("multiple-pipelines");
      expect(panel?.classList.contains("hidden")).toBe(false);
    });

    it("handles PERMISSION_DENIED error type", () => {
      const error = createPermissionDeniedError("access");

      handleError(error);

      const panel = document.getElementById("permission-denied");
      expect(panel?.classList.contains("hidden")).toBe(false);
    });

    it("handles ARTIFACTS_MISSING error type", () => {
      const error = createArtifactsMissingError("Pipeline", 1);

      handleError(error);

      const panel = document.getElementById("artifacts-missing");
      expect(panel?.classList.contains("hidden")).toBe(false);
    });

    it("handles unknown PrInsightsError types with generic error", () => {
      // Create an error with a different type
      const error = new PrInsightsError(
        "UNKNOWN_TYPE" as typeof ErrorTypes[keyof typeof ErrorTypes],
        "Unknown Error",
        "This is an unknown error type",
      );

      handleError(error);

      const errorPanel = document.getElementById("error-state");
      expect(errorPanel?.classList.contains("hidden")).toBe(false);
    });

    it("handles non-PrInsightsError with generic error", () => {
      handleError(new Error("Regular JavaScript error"));

      const errorPanel = document.getElementById("error-state");
      expect(errorPanel?.classList.contains("hidden")).toBe(false);
      expect(document.getElementById("error-title")?.textContent).toBe("Error");
    });

    it("handles string error", () => {
      handleError("String error message");

      const errorPanel = document.getElementById("error-state");
      expect(errorPanel?.classList.contains("hidden")).toBe(false);
    });

    it("handles null/undefined error", () => {
      handleError(null);

      const errorPanel = document.getElementById("error-state");
      expect(errorPanel?.classList.contains("hidden")).toBe(false);
      // getErrorMessage returns "Unknown error" for null
      expect(document.getElementById("error-message")?.textContent).toBe(
        "Unknown error",
      );
    });

    it("hides all panels before showing error", () => {
      // Pre-show some panels
      document.getElementById("setup-required")?.classList.remove("hidden");
      document.getElementById("main-content")?.classList.remove("hidden");

      handleError(new Error("Test"));

      // Previous panels should be hidden
      expect(
        document.getElementById("setup-required")?.classList.contains("hidden"),
      ).toBe(true);
      expect(
        document.getElementById("main-content")?.classList.contains("hidden"),
      ).toBe(true);
    });
  });

  describe("showLoading", () => {
    it("shows loading state and hides main content", () => {
      // Pre-setup: loading hidden, content visible
      document.getElementById("loading-state")?.classList.add("hidden");
      document.getElementById("main-content")?.classList.remove("hidden");

      showLoading();

      expect(
        document.getElementById("loading-state")?.classList.contains("hidden"),
      ).toBe(false);
      expect(
        document.getElementById("main-content")?.classList.contains("hidden"),
      ).toBe(true);
    });
  });

  describe("showContent", () => {
    it("hides loading state and shows main content", () => {
      // Pre-setup: loading visible, content hidden
      document.getElementById("loading-state")?.classList.remove("hidden");
      document.getElementById("main-content")?.classList.add("hidden");

      showContent();

      expect(
        document.getElementById("loading-state")?.classList.contains("hidden"),
      ).toBe(true);
      expect(
        document.getElementById("main-content")?.classList.contains("hidden"),
      ).toBe(false);
    });
  });
});
