/**
 * Tests for error-types.ts
 *
 * Verifies the error taxonomy for PR Insights Hub:
 * - PrInsightsError class
 * - Error creation factory functions
 * - Error type constants
 */

import {
  ErrorTypes,
  PrInsightsError,
  createSetupRequiredError,
  createMultiplePipelinesError,
  createNoSuccessfulBuildsError,
  createArtifactsMissingError,
  createPermissionDeniedError,
  createInvalidConfigError,
} from "../ui/error-types";

describe("error-types", () => {
  describe("ErrorTypes constants", () => {
    it("defines all required error types", () => {
      expect(ErrorTypes.SETUP_REQUIRED).toBe("setup_required");
      expect(ErrorTypes.MULTIPLE_PIPELINES).toBe("multiple_pipelines");
      expect(ErrorTypes.NO_SUCCESSFUL_BUILDS).toBe("no_successful_builds");
      expect(ErrorTypes.ARTIFACTS_MISSING).toBe("artifacts_missing");
      expect(ErrorTypes.PERMISSION_DENIED).toBe("permission_denied");
      expect(ErrorTypes.INVALID_CONFIG).toBe("invalid_config");
    });

    it("has 6 distinct error types", () => {
      expect(Object.keys(ErrorTypes)).toHaveLength(6);
    });
  });

  describe("PrInsightsError class", () => {
    it("creates an error with all properties", () => {
      const error = new PrInsightsError(
        ErrorTypes.SETUP_REQUIRED,
        "Test Title",
        "Test message",
        { instructions: ["Step 1"], docsUrl: "https://example.com" },
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(PrInsightsError);
      expect(error.name).toBe("PrInsightsError");
      expect(error.type).toBe(ErrorTypes.SETUP_REQUIRED);
      expect(error.title).toBe("Test Title");
      expect(error.message).toBe("Test message");
      expect(error.details).toEqual({
        instructions: ["Step 1"],
        docsUrl: "https://example.com",
      });
    });

    it("defaults details to null", () => {
      const error = new PrInsightsError(
        ErrorTypes.SETUP_REQUIRED,
        "Title",
        "Message",
      );

      expect(error.details).toBeNull();
    });
  });

  describe("createSetupRequiredError", () => {
    it("creates a setup required error with correct properties", () => {
      const error = createSetupRequiredError();

      expect(error.type).toBe(ErrorTypes.SETUP_REQUIRED);
      expect(error.title).toBe("Setup Required");
      expect(error.message).toBe(
        "No PR Insights pipeline found in this project.",
      );
    });

    it("includes setup instructions", () => {
      const error = createSetupRequiredError();
      const details = error.details as {
        instructions: string[];
        docsUrl: string;
      };

      expect(details.instructions).toContain(
        "Create a pipeline from pr-insights-pipeline.yml",
      );
      expect(details.instructions).toContain(
        'Ensure it publishes an "aggregates" artifact',
      );
      expect(details.instructions).toContain(
        "Run it at least once successfully",
      );
      expect(details.instructions).toContain(
        "Return here to view your dashboard",
      );
    });

    it("includes documentation URL", () => {
      const error = createSetupRequiredError();
      const details = error.details as {
        instructions: string[];
        docsUrl: string;
      };

      expect(details.docsUrl).toBe(
        "https://github.com/oddessentials/ado-git-repo-insights#setup",
      );
    });
  });

  describe("createMultiplePipelinesError", () => {
    it("creates error with correct type and title", () => {
      const matches = [{ id: 1, name: "Pipeline A" }];
      const error = createMultiplePipelinesError(matches);

      expect(error.type).toBe(ErrorTypes.MULTIPLE_PIPELINES);
      expect(error.title).toBe("Multiple Pipelines Found");
    });

    it("includes count in message", () => {
      const matches = [
        { id: 1, name: "Pipeline A" },
        { id: 2, name: "Pipeline B" },
      ];
      const error = createMultiplePipelinesError(matches);

      expect(error.message).toBe(
        "Found 2 pipelines with aggregates. Please specify which one to use.",
      );
    });

    it("includes pipeline matches in details", () => {
      const matches = [
        { id: 1, name: "Pipeline A" },
        { id: 2, name: "Pipeline B" },
      ];
      const error = createMultiplePipelinesError(matches);
      const details = error.details as {
        matches: Array<{ id: number; name: string }>;
        hint: string;
      };

      expect(details.matches).toHaveLength(2);
      expect(details.matches[0]).toEqual({ id: 1, name: "Pipeline A" });
      expect(details.matches[1]).toEqual({ id: 2, name: "Pipeline B" });
    });

    it("includes hint about pipelineId parameter", () => {
      const matches = [{ id: 1, name: "Test" }];
      const error = createMultiplePipelinesError(matches);
      const details = error.details as {
        matches: Array<{ id: number; name: string }>;
        hint: string;
      };

      expect(details.hint).toContain("?pipelineId=<id>");
    });
  });

  describe("createNoSuccessfulBuildsError", () => {
    it("creates error with pipeline name in message", () => {
      const error = createNoSuccessfulBuildsError("My Pipeline");

      expect(error.type).toBe(ErrorTypes.NO_SUCCESSFUL_BUILDS);
      expect(error.title).toBe("No Successful Runs");
      expect(error.message).toBe(
        'Pipeline "My Pipeline" has no successful builds.',
      );
    });

    it("includes instructions about partially succeeded builds", () => {
      const error = createNoSuccessfulBuildsError("Test Pipeline");
      const details = error.details as { instructions: string[] };

      const hasPartiallySucceededNote = details.instructions.some(
        (instruction) => instruction.includes("Partially Succeeded"),
      );
      expect(hasPartiallySucceededNote).toBe(true);
    });
  });

  describe("createArtifactsMissingError", () => {
    it("includes pipeline name and build ID in message", () => {
      const error = createArtifactsMissingError("My Pipeline", 12345);

      expect(error.type).toBe(ErrorTypes.ARTIFACTS_MISSING);
      expect(error.title).toBe("Aggregates Not Found");
      expect(error.message).toBe(
        'Build #12345 of "My Pipeline" does not have an aggregates artifact.',
      );
    });

    it("includes aggregates configuration instructions", () => {
      const error = createArtifactsMissingError("Test", 1);
      const details = error.details as { instructions: string[] };

      expect(details.instructions).toContain(
        "Add generateAggregates: true to your ExtractPullRequests task",
      );
    });
  });

  describe("createPermissionDeniedError", () => {
    it("includes operation in message", () => {
      const error = createPermissionDeniedError("read artifacts");

      expect(error.type).toBe(ErrorTypes.PERMISSION_DENIED);
      expect(error.title).toBe("Permission Denied");
      expect(error.message).toBe(
        "You don't have permission to read artifacts.",
      );
    });

    it("includes required permission in details", () => {
      const error = createPermissionDeniedError("view builds");
      const details = error.details as {
        instructions: string[];
        permissionNeeded: string;
      };

      expect(details.permissionNeeded).toBe("Build (Read)");
    });
  });

  describe("createInvalidConfigError", () => {
    it("creates error with param and value in message", () => {
      const error = createInvalidConfigError(
        "pipelineId",
        "abc",
        "Must be a number",
      );

      expect(error.type).toBe(ErrorTypes.INVALID_CONFIG);
      expect(error.title).toBe("Invalid Configuration");
      expect(error.message).toBe('Invalid value for pipelineId: "abc"');
    });

    it("provides specific hint for pipelineId", () => {
      const error = createInvalidConfigError("pipelineId", "xyz", "Invalid");
      const details = error.details as { reason: string; hint: string };

      expect(details.reason).toBe("Invalid");
      expect(details.hint).toContain("positive integer");
      expect(details.hint).toContain("?pipelineId=123");
    });

    it("provides specific hint for dataset", () => {
      const error = createInvalidConfigError(
        "dataset",
        "ftp://bad",
        "Invalid protocol",
      );
      const details = error.details as { reason: string; hint: string };

      expect(details.hint).toContain("valid HTTPS URL");
    });

    it("provides generic hint for unknown params", () => {
      const error = createInvalidConfigError(
        "unknownParam",
        "value",
        "Invalid",
      );
      const details = error.details as { reason: string; hint: string };

      expect(details.hint).toBe("Check the parameter value and try again");
    });
  });
});
