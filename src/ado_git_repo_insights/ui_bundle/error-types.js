"use strict";
var PRInsightsErrorTypes = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // ui/error-types.ts
  var error_types_exports = {};
  __export(error_types_exports, {
    ErrorTypes: () => ErrorTypes,
    PrInsightsError: () => PrInsightsError,
    createArtifactsMissingError: () => createArtifactsMissingError,
    createInvalidConfigError: () => createInvalidConfigError,
    createMultiplePipelinesError: () => createMultiplePipelinesError,
    createNoSuccessfulBuildsError: () => createNoSuccessfulBuildsError,
    createPermissionDeniedError: () => createPermissionDeniedError,
    createSetupRequiredError: () => createSetupRequiredError
  });
  var ErrorTypes = {
    SETUP_REQUIRED: "setup_required",
    MULTIPLE_PIPELINES: "multiple_pipelines",
    NO_SUCCESSFUL_BUILDS: "no_successful_builds",
    ARTIFACTS_MISSING: "artifacts_missing",
    PERMISSION_DENIED: "permission_denied",
    INVALID_CONFIG: "invalid_config"
  };
  var PrInsightsError = class extends Error {
    constructor(type, title, message, details = null) {
      super(message);
      this.name = "PrInsightsError";
      this.type = type;
      this.title = title;
      this.details = details;
    }
  };
  function createSetupRequiredError() {
    return new PrInsightsError(
      ErrorTypes.SETUP_REQUIRED,
      "Setup Required",
      "No PR Insights pipeline found in this project.",
      {
        instructions: [
          "Create a pipeline from pr-insights-pipeline.yml",
          'Ensure it publishes an "aggregates" artifact',
          "Run it at least once successfully",
          "Return here to view your dashboard"
        ],
        docsUrl: "https://github.com/oddessentials/ado-git-repo-insights#setup"
      }
    );
  }
  function createMultiplePipelinesError(matches) {
    return new PrInsightsError(
      ErrorTypes.MULTIPLE_PIPELINES,
      "Multiple Pipelines Found",
      `Found ${matches.length} pipelines with aggregates. Please specify which one to use.`,
      {
        matches: matches.map((m) => ({ id: m.id, name: m.name })),
        hint: "Add ?pipelineId=<id> to the URL, or configure in Project Settings > PR Insights Settings."
      }
    );
  }
  function createNoSuccessfulBuildsError(pipelineName) {
    return new PrInsightsError(
      ErrorTypes.NO_SUCCESSFUL_BUILDS,
      "No Successful Runs",
      `Pipeline "${pipelineName}" has no successful builds.`,
      {
        instructions: [
          "Check the pipeline for errors",
          "Run it manually and ensure extraction completes",
          'Note: "Partially Succeeded" builds are acceptable - first runs may show this status because no prior database artifact exists yet, but extraction still works',
          "Return here after a successful or partially successful run"
        ]
      }
    );
  }
  function createArtifactsMissingError(pipelineName, buildId) {
    return new PrInsightsError(
      ErrorTypes.ARTIFACTS_MISSING,
      "Aggregates Not Found",
      `Build #${buildId} of "${pipelineName}" does not have an aggregates artifact.`,
      {
        instructions: [
          "Add generateAggregates: true to your ExtractPullRequests task",
          "Add a PublishPipelineArtifact step for the aggregates directory",
          "Re-run the pipeline"
        ]
      }
    );
  }
  function createPermissionDeniedError(operation) {
    return new PrInsightsError(
      ErrorTypes.PERMISSION_DENIED,
      "Permission Denied",
      `You don't have permission to ${operation}.`,
      {
        instructions: [
          'Request "Build (Read)" permission from your project administrator',
          "Ensure you have access to view pipeline artifacts",
          "If using a service account, verify its permissions"
        ],
        permissionNeeded: "Build (Read)"
      }
    );
  }
  function createInvalidConfigError(param, value, reason) {
    let hint;
    if (param === "pipelineId") {
      hint = "pipelineId must be a positive integer (e.g., ?pipelineId=123)";
    } else if (param === "dataset") {
      hint = "dataset must be a valid HTTPS URL";
    } else {
      hint = "Check the parameter value and try again";
    }
    return new PrInsightsError(
      ErrorTypes.INVALID_CONFIG,
      "Invalid Configuration",
      `Invalid value for ${param}: "${value}"`,
      {
        reason,
        hint
      }
    );
  }
  if (typeof window !== "undefined") {
    window.PrInsightsError = PrInsightsError;
  }
  return __toCommonJS(error_types_exports);
})();
// Global exports for browser runtime
if (typeof window !== 'undefined') { Object.assign(window, PRInsightsErrorTypes || {}); }
