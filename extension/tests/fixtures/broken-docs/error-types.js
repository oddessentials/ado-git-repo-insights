"use strict";
// Minimal error types stub for broken-docs fixture
window.ErrorTypes = {
  SETUP_REQUIRED: "setup_required",
  MULTIPLE_PIPELINES: "multiple_pipelines",
  NO_SUCCESSFUL_BUILDS: "no_successful_builds",
  ARTIFACTS_MISSING: "artifacts_missing",
  PERMISSION_DENIED: "permission_denied",
  INVALID_CONFIG: "invalid_config"
};

window.PrInsightsError = class PrInsightsError extends Error {
  constructor(type, title, message, details = null) {
    super(message);
    this.name = "PrInsightsError";
    this.type = type;
    this.title = title;
    this.details = details;
  }
};
