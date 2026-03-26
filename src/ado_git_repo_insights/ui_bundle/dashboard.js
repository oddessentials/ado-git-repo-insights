"use strict";
var PRInsightsDashboard = (() => {
  // ../ui/types.ts
  var ML_SCHEMA_VERSION_RANGE = [1, 1];
  function isErrorWithMessage(error) {
    return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string";
  }
  function getErrorMessage(error) {
    if (isErrorWithMessage(error)) return error.message;
    if (typeof error === "string") return error;
    return "Unknown error";
  }
  function hasMLMethods(loader2) {
    return typeof loader2 === "object" && loader2 !== null && typeof loader2.loadPredictions === "function" && typeof loader2.loadInsights === "function";
  }

  // ../ui/schemas/types.ts
  function validResult(warnings = []) {
    return { valid: true, errors: [], warnings };
  }
  function invalidResult(errors, warnings = []) {
    return { valid: false, errors, warnings };
  }
  function createError(field, expected, actual, message) {
    return {
      field,
      expected,
      actual,
      message: message || `Expected ${expected} at '${field}', got ${actual}`
    };
  }
  function createWarning(field, message) {
    return {
      field,
      message: message || `Unknown field '${field}'`
    };
  }

  // ../ui/schemas/errors.ts
  var SchemaValidationError = class _SchemaValidationError extends Error {
    constructor(errors, artifactType) {
      const errorSummary = errors.slice(0, 3).map((e) => `${e.field}: ${e.message}`).join("; ");
      const moreCount = errors.length > 3 ? ` (+${errors.length - 3} more)` : "";
      super(
        `Schema validation failed for ${artifactType}: ${errorSummary}${moreCount}`
      );
      this.name = "SchemaValidationError";
      this.errors = errors;
      this.artifactType = artifactType;
      if (Error.captureStackTrace) {
        Error.captureStackTrace(this, _SchemaValidationError);
      }
    }
    /**
     * Get a formatted string of all validation errors.
     */
    getDetailedMessage() {
      const lines = [`Schema validation failed for ${this.artifactType}:`];
      for (const error of this.errors) {
        lines.push(`  - ${error.field}: ${error.message}`);
        lines.push(`    Expected: ${error.expected}`);
        lines.push(`    Actual: ${error.actual}`);
      }
      return lines.join("\n");
    }
  };

  // ../ui/schemas/utils.ts
  function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function isString(value) {
    return typeof value === "string";
  }
  function isNumber(value) {
    return typeof value === "number" && !Number.isNaN(value);
  }
  function isBoolean(value) {
    return typeof value === "boolean";
  }
  function isArray(value) {
    return Array.isArray(value);
  }
  function isNullish(value) {
    return value === null || value === void 0;
  }
  function getTypeName(value) {
    if (value === null) return "null";
    if (value === void 0) return "undefined";
    if (Array.isArray(value)) return "array";
    return typeof value;
  }
  function buildPath(parent, key) {
    if (parent === "") {
      return typeof key === "number" ? `[${key}]` : key;
    }
    if (typeof key === "number") {
      return `${parent}[${key}]`;
    }
    return `${parent}.${key}`;
  }
  function validateRequired(data, field, path) {
    const hasField = Object.prototype.hasOwnProperty.call(data, field);
    const fieldValue = hasField ? Object.getOwnPropertyDescriptor(data, field)?.value : void 0;
    if (!hasField || fieldValue === void 0) {
      return createError(
        buildPath(path, field),
        "required field",
        "missing",
        `Missing required field '${field}'`
      );
    }
    return null;
  }
  function validateString(value, path) {
    if (!isString(value)) {
      return createError(path, "string", getTypeName(value));
    }
    return null;
  }
  function validateNumber(value, path) {
    if (!isNumber(value)) {
      return createError(path, "number", getTypeName(value));
    }
    return null;
  }
  function validateNonNegativeNumber(value, path) {
    if (!isNumber(value)) {
      return createError(path, "number", getTypeName(value));
    }
    if (value < 0) {
      return createError(
        path,
        "number >= 0",
        String(value),
        `Expected non-negative number at '${path}'`
      );
    }
    return null;
  }
  function validateBoolean(value, path) {
    if (!isBoolean(value)) {
      return createError(path, "boolean", getTypeName(value));
    }
    return null;
  }
  function validateArray(value, path) {
    if (!isArray(value)) {
      return createError(path, "array", getTypeName(value));
    }
    return null;
  }
  var ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  var ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/;
  var ISO_WEEK_PATTERN = /^\d{4}-W\d{2}$/;
  var YEAR_PATTERN = /^\d{4}$/;
  function validateIsoDate(value, path) {
    if (!isString(value)) {
      return createError(
        path,
        "ISO date string (YYYY-MM-DD)",
        getTypeName(value)
      );
    }
    if (!ISO_DATE_PATTERN.test(value)) {
      return createError(
        path,
        "ISO date format (YYYY-MM-DD)",
        value,
        `Invalid date format at '${path}': expected YYYY-MM-DD`
      );
    }
    return null;
  }
  function validateIsoDatetime(value, path) {
    if (!isString(value)) {
      return createError(path, "ISO datetime string", getTypeName(value));
    }
    if (!ISO_DATETIME_PATTERN.test(value)) {
      return createError(
        path,
        "ISO datetime format",
        value,
        `Invalid datetime format at '${path}'`
      );
    }
    return null;
  }
  function validateIsoWeek(value, path) {
    if (!isString(value)) {
      return createError(path, "ISO week string (YYYY-Www)", getTypeName(value));
    }
    if (!ISO_WEEK_PATTERN.test(value)) {
      return createError(
        path,
        "ISO week format (YYYY-Www)",
        value,
        `Invalid week format at '${path}': expected YYYY-Www`
      );
    }
    return null;
  }
  function validateYear(value, path) {
    if (!isString(value)) {
      return createError(path, "year string (YYYY)", getTypeName(value));
    }
    if (!YEAR_PATTERN.test(value)) {
      return createError(
        path,
        "year format (YYYY)",
        value,
        `Invalid year format at '${path}': expected YYYY`
      );
    }
    return null;
  }
  function findUnknownFields(data, knownFields, path, strict) {
    const errors = [];
    const warnings = [];
    for (const key of Object.keys(data)) {
      if (!knownFields.has(key)) {
        const fieldPath = buildPath(path, key);
        if (strict) {
          errors.push(
            createError(
              fieldPath,
              "known field",
              "unknown",
              `Unknown field '${key}' not allowed in strict mode`
            )
          );
        } else {
          warnings.push(
            createWarning(
              fieldPath,
              `Unknown field '${key}' (ignored in permissive mode)`
            )
          );
        }
      }
    }
    return { errors, warnings };
  }

  // ../ui/schemas/manifest.schema.ts
  var KNOWN_ROOT_FIELDS = /* @__PURE__ */ new Set([
    "manifest_schema_version",
    "dataset_schema_version",
    "aggregates_schema_version",
    "predictions_schema_version",
    "insights_schema_version",
    "generated_at",
    "run_id",
    "defaults",
    "limits",
    "demo_profile",
    "generation_provenance",
    "published_files",
    "features",
    "capabilities",
    "reviewer_fixtures",
    "coverage",
    "aggregate_index",
    "warnings",
    "operational"
    // Production field for operational metadata
  ]);
  var KNOWN_WEEKLY_ROLLUP_FIELDS = /* @__PURE__ */ new Set([
    "week",
    "path",
    "pr_count",
    "size_bytes",
    "start_date",
    // Production field
    "end_date"
    // Production field
  ]);
  var KNOWN_DISTRIBUTION_FIELDS = /* @__PURE__ */ new Set([
    "year",
    "path",
    "total_prs",
    "size_bytes",
    "start_date",
    // Production field
    "end_date"
    // Production field
  ]);
  var KNOWN_COVERAGE_FIELDS = /* @__PURE__ */ new Set([
    "total_prs",
    "date_range",
    "comments",
    "row_counts",
    // Production field
    "teams_count"
    // Production field
  ]);
  var KNOWN_DATE_RANGE_FIELDS = /* @__PURE__ */ new Set(["min", "max"]);
  var KNOWN_COMMENTS_COVERAGE_FIELDS = /* @__PURE__ */ new Set([
    "status",
    "threads_fetched",
    "comments_fetched",
    "prs_with_threads",
    "capped"
  ]);
  var KNOWN_FEATURES_FIELDS = /* @__PURE__ */ new Set([
    "teams",
    "comments",
    "predictions",
    "ai_insights",
    "cross_dimensional"
  ]);
  var KNOWN_CAPABILITIES_FIELDS = /* @__PURE__ */ new Set([
    "author_filters",
    "author_repo_exact",
    "comments_metrics",
    "reviewer_repository_mode",
    "reviewer_team_mode",
    "cross_dimensional_available"
  ]);
  var KNOWN_LIMITS_FIELDS = /* @__PURE__ */ new Set([
    "max_weekly_files",
    "max_distribution_files",
    "max_date_range_days_soft"
    // Production field
  ]);
  var KNOWN_DEFAULTS_FIELDS = /* @__PURE__ */ new Set(["default_date_range_days"]);
  var KNOWN_DEMO_PROFILE_FIELDS = /* @__PURE__ */ new Set([
    "name",
    "version",
    "seed",
    "canonical_output_root"
  ]);
  var KNOWN_GENERATION_PROVENANCE_FIELDS = /* @__PURE__ */ new Set([
    "python_version",
    "python_major_minor",
    "generator_script",
    "generation_mode"
  ]);
  var KNOWN_PUBLISHED_FILES_FIELDS = /* @__PURE__ */ new Set(["direct", "globs"]);
  var KNOWN_REVIEWER_FIXTURES_FIELDS = /* @__PURE__ */ new Set([
    "minimum_active_reviewers",
    "minimum_reviewed_prs_per_reviewer",
    "minimum_review_actions_per_reviewer",
    "minimum_multi_repo_reviewers",
    "reviewer_filter_examples",
    "reviewer_constrained_example",
    "reviewer_team_disallowed_example"
  ]);
  var KNOWN_REVIEWER_FILTER_EXAMPLE_FIELDS = /* @__PURE__ */ new Set([
    "reviewer_id",
    "reviewer_name",
    "week",
    "reviewed_prs",
    "reviews_count",
    "repositories_count"
  ]);
  var KNOWN_REVIEWER_FIXTURE_EXAMPLE_FIELDS = /* @__PURE__ */ new Set([
    "reviewer_id",
    "reviewer_name",
    "week",
    "mode",
    "reason",
    "repository_name",
    "team_name"
  ]);
  function validateWeeklyRollupEntry(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const weekReq = validateRequired(data, "week", path);
    if (weekReq) errors.push(weekReq);
    else {
      const weekErr = validateIsoWeek(data.week, buildPath(path, "week"));
      if (weekErr) errors.push(weekErr);
    }
    const pathReq = validateRequired(data, "path", path);
    if (pathReq) errors.push(pathReq);
    else {
      const pathErr = validateString(data.path, buildPath(path, "path"));
      if (pathErr) errors.push(pathErr);
    }
    if ("size_bytes" in data && data.size_bytes !== void 0) {
      const sizeErr = validateNonNegativeNumber(
        data.size_bytes,
        buildPath(path, "size_bytes")
      );
      if (sizeErr) errors.push(sizeErr);
    }
    if ("pr_count" in data && data.pr_count !== void 0) {
      const prCountErr = validateNonNegativeNumber(
        data.pr_count,
        buildPath(path, "pr_count")
      );
      if (prCountErr) errors.push(prCountErr);
    }
    if ("start_date" in data && data.start_date !== void 0) {
      const err = validateIsoDate(data.start_date, buildPath(path, "start_date"));
      if (err) errors.push(err);
    }
    if ("end_date" in data && data.end_date !== void 0) {
      const err = validateIsoDate(data.end_date, buildPath(path, "end_date"));
      if (err) errors.push(err);
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_WEEKLY_ROLLUP_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateDistributionEntry(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const yearReq = validateRequired(data, "year", path);
    if (yearReq) errors.push(yearReq);
    else {
      const yearErr = validateYear(data.year, buildPath(path, "year"));
      if (yearErr) errors.push(yearErr);
    }
    const pathReq = validateRequired(data, "path", path);
    if (pathReq) errors.push(pathReq);
    else {
      const pathErr = validateString(data.path, buildPath(path, "path"));
      if (pathErr) errors.push(pathErr);
    }
    if ("size_bytes" in data && data.size_bytes !== void 0) {
      const sizeErr = validateNonNegativeNumber(
        data.size_bytes,
        buildPath(path, "size_bytes")
      );
      if (sizeErr) errors.push(sizeErr);
    }
    if ("total_prs" in data && data.total_prs !== void 0) {
      const totalPrsErr = validateNonNegativeNumber(
        data.total_prs,
        buildPath(path, "total_prs")
      );
      if (totalPrsErr) errors.push(totalPrsErr);
    }
    if ("start_date" in data && data.start_date !== void 0) {
      const err = validateIsoDate(data.start_date, buildPath(path, "start_date"));
      if (err) errors.push(err);
    }
    if ("end_date" in data && data.end_date !== void 0) {
      const err = validateIsoDate(data.end_date, buildPath(path, "end_date"));
      if (err) errors.push(err);
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_DISTRIBUTION_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateAggregateIndex(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const weeklyReq = validateRequired(data, "weekly_rollups", path);
    if (weeklyReq) errors.push(weeklyReq);
    else {
      const weeklyArrErr = validateArray(
        data.weekly_rollups,
        buildPath(path, "weekly_rollups")
      );
      if (weeklyArrErr) errors.push(weeklyArrErr);
      else if (isArray(data.weekly_rollups)) {
        data.weekly_rollups.forEach((item, i) => {
          const result = validateWeeklyRollupEntry(
            item,
            buildPath(path, `weekly_rollups[${i}]`),
            strict
          );
          errors.push(...result.errors);
          warnings.push(...result.warnings);
        });
      }
    }
    const distReq = validateRequired(data, "distributions", path);
    if (distReq) errors.push(distReq);
    else {
      const distArrErr = validateArray(
        data.distributions,
        buildPath(path, "distributions")
      );
      if (distArrErr) errors.push(distArrErr);
      else if (isArray(data.distributions)) {
        data.distributions.forEach((item, i) => {
          const result = validateDistributionEntry(
            item,
            buildPath(path, `distributions[${i}]`),
            strict
          );
          errors.push(...result.errors);
          warnings.push(...result.warnings);
        });
      }
    }
    return { errors, warnings };
  }
  function validateDateRange(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const minReq = validateRequired(data, "min", path);
    if (minReq) errors.push(minReq);
    else {
      const minErr = validateIsoDate(data.min, buildPath(path, "min"));
      if (minErr) errors.push(minErr);
    }
    const maxReq = validateRequired(data, "max", path);
    if (maxReq) errors.push(maxReq);
    else {
      const maxErr = validateIsoDate(data.max, buildPath(path, "max"));
      if (maxErr) errors.push(maxErr);
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_DATE_RANGE_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateCoverage(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    if ("total_prs" in data) {
      const prErr = validateNonNegativeNumber(
        data.total_prs,
        buildPath(path, "total_prs")
      );
      if (prErr) errors.push(prErr);
    }
    if ("date_range" in data) {
      const result = validateDateRange(
        data.date_range,
        buildPath(path, "date_range"),
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("comments" in data && data.comments !== void 0) {
      const commentsValue = data.comments;
      if (typeof commentsValue !== "string" && !isObject(commentsValue)) {
        errors.push(
          createError(
            buildPath(path, "comments"),
            "string or object",
            getTypeName(commentsValue),
            `Expected string or object at '${buildPath(path, "comments")}'`
          )
        );
      } else if (isObject(commentsValue)) {
        const commentsPath = buildPath(path, "comments");
        const statusReq = validateRequired(commentsValue, "status", commentsPath);
        if (statusReq) {
          errors.push(statusReq);
        } else {
          const statusPath = buildPath(commentsPath, "status");
          const statusErr = validateString(commentsValue.status, statusPath);
          if (statusErr) {
            errors.push(statusErr);
          } else if (typeof commentsValue.status === "string" && !(/* @__PURE__ */ new Set(["disabled", "full", "partial"])).has(commentsValue.status)) {
            errors.push(
              createError(
                statusPath,
                "disabled | full | partial",
                commentsValue.status
              )
            );
          }
        }
        const numericFields = [
          "threads_fetched",
          "comments_fetched",
          "prs_with_threads"
        ];
        for (const field of numericFields) {
          if (Object.prototype.hasOwnProperty.call(commentsValue, field) && Object.getOwnPropertyDescriptor(commentsValue, field)?.value !== void 0) {
            const fieldValue = Object.getOwnPropertyDescriptor(
              commentsValue,
              field
            )?.value;
            const err = validateNonNegativeNumber(
              fieldValue,
              buildPath(commentsPath, field)
            );
            if (err) errors.push(err);
          }
        }
        if (Object.prototype.hasOwnProperty.call(commentsValue, "capped") && Object.getOwnPropertyDescriptor(commentsValue, "capped")?.value !== void 0) {
          const cappedErr = validateBoolean(
            Object.getOwnPropertyDescriptor(commentsValue, "capped")?.value,
            buildPath(commentsPath, "capped")
          );
          if (cappedErr) errors.push(cappedErr);
        }
        const unknownComments = findUnknownFields(
          commentsValue,
          KNOWN_COMMENTS_COVERAGE_FIELDS,
          commentsPath,
          strict
        );
        errors.push(...unknownComments.errors);
        warnings.push(...unknownComments.warnings);
      }
    }
    if ("row_counts" in data && data.row_counts !== void 0) {
      if (!isObject(data.row_counts)) {
        errors.push(
          createError(
            buildPath(path, "row_counts"),
            "object",
            getTypeName(data.row_counts)
          )
        );
      }
    }
    if ("teams_count" in data && data.teams_count !== void 0) {
      const err = validateNonNegativeNumber(
        data.teams_count,
        buildPath(path, "teams_count")
      );
      if (err) errors.push(err);
    }
    const unknown = findUnknownFields(data, KNOWN_COVERAGE_FIELDS, path, strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateFeatures(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const boolFields = ["teams", "comments", "predictions", "ai_insights"];
    for (const field of boolFields) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        const fieldValue = Object.getOwnPropertyDescriptor(data, field)?.value;
        if (fieldValue !== void 0) {
          const err = validateBoolean(fieldValue, buildPath(path, field));
          if (err) errors.push(err);
        }
      }
    }
    const unknown = findUnknownFields(data, KNOWN_FEATURES_FIELDS, path, strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateCapabilities(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const booleanFields = [
      "author_filters",
      "author_repo_exact",
      "comments_metrics",
      "cross_dimensional_available"
    ];
    for (const field of booleanFields) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        const fieldValue = Object.getOwnPropertyDescriptor(data, field)?.value;
        if (fieldValue !== void 0) {
          const err = validateBoolean(fieldValue, buildPath(path, field));
          if (err) errors.push(err);
        }
      }
    }
    const modeFields = ["reviewer_repository_mode", "reviewer_team_mode"];
    const validModes = /* @__PURE__ */ new Set(["exact", "constrained", "disallowed"]);
    for (const field of modeFields) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        const fieldValue = Object.getOwnPropertyDescriptor(data, field)?.value;
        const err = validateString(fieldValue, buildPath(path, field));
        if (err) {
          errors.push(err);
        } else if (typeof fieldValue === "string" && !validModes.has(fieldValue)) {
          errors.push(
            createError(
              buildPath(path, field),
              "exact | constrained | disallowed",
              fieldValue
            )
          );
        }
      }
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_CAPABILITIES_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateLimits(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    if ("max_weekly_files" in data && data.max_weekly_files !== void 0) {
      const err = validateNonNegativeNumber(
        data.max_weekly_files,
        buildPath(path, "max_weekly_files")
      );
      if (err) errors.push(err);
    }
    if ("max_distribution_files" in data && data.max_distribution_files !== void 0) {
      const err = validateNonNegativeNumber(
        data.max_distribution_files,
        buildPath(path, "max_distribution_files")
      );
      if (err) errors.push(err);
    }
    if ("max_date_range_days_soft" in data && data.max_date_range_days_soft !== void 0) {
      const err = validateNonNegativeNumber(
        data.max_date_range_days_soft,
        buildPath(path, "max_date_range_days_soft")
      );
      if (err) errors.push(err);
    }
    const unknown = findUnknownFields(data, KNOWN_LIMITS_FIELDS, path, strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateDefaults(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    if ("default_date_range_days" in data && data.default_date_range_days !== void 0) {
      const err = validateNonNegativeNumber(
        data.default_date_range_days,
        buildPath(path, "default_date_range_days")
      );
      if (err) errors.push(err);
    }
    const unknown = findUnknownFields(data, KNOWN_DEFAULTS_FIELDS, path, strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateDemoProfile(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const nameReq = validateRequired(data, "name", path);
    if (nameReq) errors.push(nameReq);
    else {
      const err = validateString(data.name, buildPath(path, "name"));
      if (err) errors.push(err);
    }
    const versionReq = validateRequired(data, "version", path);
    if (versionReq) errors.push(versionReq);
    else {
      const err = validateString(data.version, buildPath(path, "version"));
      if (err) errors.push(err);
    }
    if ("seed" in data && data.seed !== void 0) {
      const err = validateNonNegativeNumber(data.seed, buildPath(path, "seed"));
      if (err) errors.push(err);
    }
    if ("canonical_output_root" in data && data.canonical_output_root !== void 0) {
      const err = validateString(
        data.canonical_output_root,
        buildPath(path, "canonical_output_root")
      );
      if (err) errors.push(err);
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_DEMO_PROFILE_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validatePublishedFiles(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    if ("direct" in data && data.direct !== void 0) {
      const err = validateArray(data.direct, buildPath(path, "direct"));
      if (err) {
        errors.push(err);
      } else {
        const directEntries = data.direct;
        for (const [index, item] of directEntries.entries()) {
          const itemError = validateString(
            item,
            buildPath(buildPath(path, "direct"), String(index))
          );
          if (itemError) errors.push(itemError);
        }
      }
    }
    if ("globs" in data && data.globs !== void 0) {
      const err = validateArray(data.globs, buildPath(path, "globs"));
      if (err) {
        errors.push(err);
      } else {
        const globEntries = data.globs;
        for (const [index, item] of globEntries.entries()) {
          const itemError = validateString(
            item,
            buildPath(buildPath(path, "globs"), String(index))
          );
          if (itemError) errors.push(itemError);
        }
      }
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_PUBLISHED_FILES_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateGenerationProvenance(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    for (const field of KNOWN_GENERATION_PROVENANCE_FIELDS) {
      const fieldPath = buildPath(path, field);
      const required = validateRequired(data, field, path);
      if (required) {
        errors.push(required);
        continue;
      }
      const err = validateString(
        Object.getOwnPropertyDescriptor(data, field)?.value,
        fieldPath
      );
      if (err) errors.push(err);
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_GENERATION_PROVENANCE_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateReviewerFilterExample(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const stringFields = ["reviewer_id", "reviewer_name", "week"];
    for (const field of stringFields) {
      const required = validateRequired(data, field, path);
      if (required) {
        errors.push(required);
        continue;
      }
      const err = validateString(
        Object.getOwnPropertyDescriptor(data, field)?.value,
        buildPath(path, field)
      );
      if (err) errors.push(err);
    }
    if ("week" in data) {
      const err = validateIsoWeek(data.week, buildPath(path, "week"));
      if (err) errors.push(err);
    }
    const numericFields = ["reviewed_prs", "reviews_count", "repositories_count"];
    for (const field of numericFields) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        const err = validateNonNegativeNumber(
          Object.getOwnPropertyDescriptor(data, field)?.value,
          buildPath(path, field)
        );
        if (err) errors.push(err);
      }
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_REVIEWER_FILTER_EXAMPLE_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateReviewerFixtureExample(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const requiredStringFields = ["reviewer_id", "reviewer_name", "week", "mode", "reason"];
    for (const field of requiredStringFields) {
      const required = validateRequired(data, field, path);
      if (required) {
        errors.push(required);
        continue;
      }
      const err = validateString(
        Object.getOwnPropertyDescriptor(data, field)?.value,
        buildPath(path, field)
      );
      if (err) errors.push(err);
    }
    if ("week" in data) {
      const err = validateIsoWeek(data.week, buildPath(path, "week"));
      if (err) errors.push(err);
    }
    if ("mode" in data && typeof data.mode === "string") {
      if (!(/* @__PURE__ */ new Set(["constrained", "disallowed"])).has(data.mode)) {
        errors.push(
          createError(
            buildPath(path, "mode"),
            "constrained | disallowed",
            data.mode
          )
        );
      }
    }
    for (const field of ["repository_name", "team_name"]) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        const err = validateString(
          Object.getOwnPropertyDescriptor(data, field)?.value,
          buildPath(path, field)
        );
        if (err) errors.push(err);
      }
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_REVIEWER_FIXTURE_EXAMPLE_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateReviewerFixtures(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const thresholdFields = [
      "minimum_active_reviewers",
      "minimum_reviewed_prs_per_reviewer",
      "minimum_review_actions_per_reviewer",
      "minimum_multi_repo_reviewers"
    ];
    for (const field of thresholdFields) {
      const required = validateRequired(data, field, path);
      if (required) {
        errors.push(required);
        continue;
      }
      const err = validateNonNegativeNumber(
        Object.getOwnPropertyDescriptor(data, field)?.value,
        buildPath(path, field)
      );
      if (err) errors.push(err);
    }
    const filterExamplesRequired = validateRequired(
      data,
      "reviewer_filter_examples",
      path
    );
    if (filterExamplesRequired) {
      errors.push(filterExamplesRequired);
    } else {
      const filterPath = buildPath(path, "reviewer_filter_examples");
      const err = validateArray(data.reviewer_filter_examples, filterPath);
      if (err) {
        errors.push(err);
      } else if (isArray(data.reviewer_filter_examples)) {
        data.reviewer_filter_examples.forEach((item, index) => {
          const result = validateReviewerFilterExample(
            item,
            buildPath(filterPath, String(index)),
            strict
          );
          errors.push(...result.errors);
          warnings.push(...result.warnings);
        });
      }
    }
    const constrainedRequired = validateRequired(
      data,
      "reviewer_constrained_example",
      path
    );
    if (constrainedRequired) {
      errors.push(constrainedRequired);
    } else {
      const result = validateReviewerFixtureExample(
        data.reviewer_constrained_example,
        buildPath(path, "reviewer_constrained_example"),
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    const disallowedRequired = validateRequired(
      data,
      "reviewer_team_disallowed_example",
      path
    );
    if (disallowedRequired) {
      errors.push(disallowedRequired);
    } else {
      const result = validateReviewerFixtureExample(
        data.reviewer_team_disallowed_example,
        buildPath(path, "reviewer_team_disallowed_example"),
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_REVIEWER_FIXTURES_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateManifest(data, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(
        createError(
          "",
          "object",
          getTypeName(data),
          "Manifest must be an object"
        )
      );
      return invalidResult(errors);
    }
    const requiredFields = [
      "manifest_schema_version",
      "dataset_schema_version",
      "aggregates_schema_version",
      "generated_at",
      "run_id",
      "aggregate_index"
    ];
    for (const field of requiredFields) {
      const err = validateRequired(data, field, "");
      if (err) errors.push(err);
    }
    if ("manifest_schema_version" in data) {
      const err = validateNumber(
        data.manifest_schema_version,
        "manifest_schema_version"
      );
      if (err) errors.push(err);
    }
    if ("dataset_schema_version" in data) {
      const err = validateNumber(
        data.dataset_schema_version,
        "dataset_schema_version"
      );
      if (err) errors.push(err);
    }
    if ("aggregates_schema_version" in data) {
      const err = validateNumber(
        data.aggregates_schema_version,
        "aggregates_schema_version"
      );
      if (err) errors.push(err);
    }
    if ("generated_at" in data) {
      const err = validateIsoDatetime(data.generated_at, "generated_at");
      if (err) errors.push(err);
    }
    if ("run_id" in data) {
      const err = validateString(data.run_id, "run_id");
      if (err) errors.push(err);
    }
    if ("aggregate_index" in data) {
      const result = validateAggregateIndex(
        data.aggregate_index,
        "aggregate_index",
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("predictions_schema_version" in data && data.predictions_schema_version !== void 0) {
      const err = validateNumber(
        data.predictions_schema_version,
        "predictions_schema_version"
      );
      if (err) errors.push(err);
    }
    if ("insights_schema_version" in data && data.insights_schema_version !== void 0) {
      const err = validateNumber(
        data.insights_schema_version,
        "insights_schema_version"
      );
      if (err) errors.push(err);
    }
    if ("defaults" in data && data.defaults !== void 0) {
      const result = validateDefaults(data.defaults, "defaults", strict);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("limits" in data && data.limits !== void 0) {
      const result = validateLimits(data.limits, "limits", strict);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("demo_profile" in data && data.demo_profile !== void 0) {
      const result = validateDemoProfile(
        data.demo_profile,
        "demo_profile",
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("generation_provenance" in data && data.generation_provenance !== void 0) {
      const result = validateGenerationProvenance(
        data.generation_provenance,
        "generation_provenance",
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("published_files" in data && data.published_files !== void 0) {
      const result = validatePublishedFiles(
        data.published_files,
        "published_files",
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("features" in data && data.features !== void 0) {
      const result = validateFeatures(data.features, "features", strict);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("capabilities" in data && data.capabilities !== void 0) {
      const result = validateCapabilities(
        data.capabilities,
        "capabilities",
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("reviewer_fixtures" in data && data.reviewer_fixtures !== void 0) {
      const result = validateReviewerFixtures(
        data.reviewer_fixtures,
        "reviewer_fixtures",
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("coverage" in data && data.coverage !== void 0) {
      const result = validateCoverage(data.coverage, "coverage", strict);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("warnings" in data && data.warnings !== void 0) {
      const err = validateArray(data.warnings, "warnings");
      if (err) errors.push(err);
    }
    const unknown = findUnknownFields(data, KNOWN_ROOT_FIELDS, "", strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    if (errors.length > 0) {
      return invalidResult(errors, warnings);
    }
    return validResult(warnings);
  }

  // ../ui/schemas/rollup.schema.ts
  var KNOWN_ROOT_FIELDS2 = /* @__PURE__ */ new Set([
    "week",
    "start_date",
    "end_date",
    "pr_count",
    "cycle_time_p50",
    "cycle_time_p90",
    "review_time_p50",
    "review_time_p90",
    "authors_count",
    "reviewers_count",
    "by_repository",
    "by_author",
    "by_author_and_repo",
    "by_team",
    "by_reviewer",
    "by_team_and_repo"
  ]);
  var KNOWN_BREAKDOWN_FIELDS = /* @__PURE__ */ new Set([
    "pr_count",
    "cycle_time_p50",
    "cycle_time_p90",
    "review_time_p50",
    "review_time_p90",
    "authors_count",
    "reviewers_count"
  ]);
  var KNOWN_REVIEWER_BREAKDOWN_FIELDS = /* @__PURE__ */ new Set([
    "reviewed_prs",
    "reviews_count",
    "approval_rate",
    "authors_count",
    "repositories_count"
  ]);
  function validateBreakdownEntry(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    if ("pr_count" in data) {
      const err = validateNonNegativeNumber(
        data.pr_count,
        buildPath(path, "pr_count")
      );
      if (err) errors.push(err);
    }
    const numericFields = [
      "cycle_time_p50",
      "cycle_time_p90",
      "review_time_p50",
      "review_time_p90"
    ];
    for (const field of numericFields) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        const fieldValue = Object.getOwnPropertyDescriptor(data, field)?.value;
        if (fieldValue != null) {
          const err = validateNumber(fieldValue, buildPath(path, field));
          if (err) errors.push(err);
        }
      }
    }
    const unknown = findUnknownFields(data, KNOWN_BREAKDOWN_FIELDS, path, strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateBreakdown(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    for (const [key, value] of Object.entries(data)) {
      const result = validateBreakdownEntry(value, buildPath(path, key), strict);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    return { errors, warnings };
  }
  function validateReviewerBreakdownEntry(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    if ("reviewed_prs" in data) {
      const err = validateNonNegativeNumber(
        data.reviewed_prs,
        buildPath(path, "reviewed_prs")
      );
      if (err) errors.push(err);
    }
    if ("reviews_count" in data) {
      const err = validateNonNegativeNumber(
        data.reviews_count,
        buildPath(path, "reviews_count")
      );
      if (err) errors.push(err);
    }
    if (Object.prototype.hasOwnProperty.call(data, "approval_rate")) {
      const fieldValue = Object.getOwnPropertyDescriptor(
        data,
        "approval_rate"
      )?.value;
      if (fieldValue != null) {
        const err = validateNumber(fieldValue, buildPath(path, "approval_rate"));
        if (err) {
          errors.push(err);
        } else if (typeof fieldValue === "number" && (fieldValue < 0 || fieldValue > 1)) {
          errors.push(
            createError(
              buildPath(path, "approval_rate"),
              "number between 0 and 1",
              `${fieldValue}`
            )
          );
        }
      }
    }
    const numericFields = ["authors_count", "repositories_count"];
    for (const field of numericFields) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        const fieldValue = Object.getOwnPropertyDescriptor(data, field)?.value;
        if (fieldValue != null) {
          const err = validateNonNegativeNumber(
            fieldValue,
            buildPath(path, field)
          );
          if (err) errors.push(err);
        }
      }
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_REVIEWER_BREAKDOWN_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateReviewerBreakdown(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    for (const [key, value] of Object.entries(data)) {
      const result = validateReviewerBreakdownEntry(
        value,
        buildPath(path, key),
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    return { errors, warnings };
  }
  function validateNestedBreakdown(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    for (const [outerKey, innerValue] of Object.entries(data)) {
      if (outerKey.startsWith("_")) continue;
      const innerPath = buildPath(path, outerKey);
      if (!isObject(innerValue)) {
        errors.push(createError(innerPath, "object", getTypeName(innerValue)));
        continue;
      }
      for (const [innerKey, entryValue] of Object.entries(
        innerValue
      )) {
        const entryResult = validateBreakdownEntry(
          entryValue,
          buildPath(innerPath, innerKey),
          strict
        );
        errors.push(...entryResult.errors);
        warnings.push(...entryResult.warnings);
      }
    }
    return { errors, warnings };
  }
  function validateRollup(data, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(
        createError("", "object", getTypeName(data), "Rollup must be an object")
      );
      return invalidResult(errors);
    }
    const requiredFields = ["week", "pr_count"];
    for (const field of requiredFields) {
      const err = validateRequired(data, field, "");
      if (err) errors.push(err);
    }
    if ("week" in data) {
      const err = validateIsoWeek(data.week, "week");
      if (err) errors.push(err);
    }
    if ("pr_count" in data) {
      const err = validateNonNegativeNumber(data.pr_count, "pr_count");
      if (err) errors.push(err);
    }
    if ("start_date" in data && data.start_date !== void 0) {
      const err = validateIsoDate(data.start_date, "start_date");
      if (err) errors.push(err);
    }
    if ("end_date" in data && data.end_date !== void 0) {
      const err = validateIsoDate(data.end_date, "end_date");
      if (err) errors.push(err);
    }
    const numericFields = [
      "cycle_time_p50",
      "cycle_time_p90",
      "review_time_p50",
      "review_time_p90",
      "authors_count",
      "reviewers_count"
    ];
    for (const field of numericFields) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        const fieldValue = Object.getOwnPropertyDescriptor(data, field)?.value;
        if (fieldValue != null) {
          const err = validateNumber(fieldValue, field);
          if (err) errors.push(err);
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(data, "by_repository") && data.by_repository !== void 0) {
      const result = validateBreakdown(
        data.by_repository,
        "by_repository",
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if (Object.prototype.hasOwnProperty.call(data, "by_author") && data.by_author !== void 0) {
      const result = validateBreakdown(data.by_author, "by_author", strict);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("by_team" in data && data.by_team !== void 0) {
      const result = validateBreakdown(data.by_team, "by_team", strict);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("by_reviewer" in data && data.by_reviewer !== void 0) {
      const result = validateReviewerBreakdown(
        data.by_reviewer,
        "by_reviewer",
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if (Object.prototype.hasOwnProperty.call(data, "by_author_and_repo") && data.by_author_and_repo !== void 0) {
      const result = validateNestedBreakdown(
        data.by_author_and_repo,
        "by_author_and_repo",
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if (Object.prototype.hasOwnProperty.call(data, "by_team_and_repo") && data.by_team_and_repo !== void 0) {
      const result = validateNestedBreakdown(
        data.by_team_and_repo,
        "by_team_and_repo",
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    const unknown = findUnknownFields(data, KNOWN_ROOT_FIELDS2, "", strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    if (errors.length > 0) {
      return invalidResult(errors, warnings);
    }
    return validResult(warnings);
  }

  // ../ui/schemas/dimensions.schema.ts
  var KNOWN_ROOT_FIELDS3 = /* @__PURE__ */ new Set([
    "repositories",
    "users",
    "authors",
    "reviewers",
    "projects",
    "teams",
    "date_range"
  ]);
  var KNOWN_REPOSITORY_FIELDS = /* @__PURE__ */ new Set([
    "repository_id",
    "repository_name",
    "organization_name",
    "project_name",
    // Legacy fields
    "id",
    "name",
    "project"
  ]);
  var KNOWN_USER_FIELDS = /* @__PURE__ */ new Set([
    "user_id",
    "display_name",
    // Legacy fields
    "id",
    "displayName",
    "uniqueName"
  ]);
  var KNOWN_REVIEWER_FIELDS = /* @__PURE__ */ new Set(["reviewer_id", "reviewer_name"]);
  var KNOWN_AUTHOR_FIELDS = /* @__PURE__ */ new Set(["author_id", "author_name"]);
  var KNOWN_PROJECT_FIELDS = /* @__PURE__ */ new Set([
    "organization_name",
    "project_name",
    // Legacy fields
    "id",
    "name"
  ]);
  var KNOWN_TEAM_FIELDS = /* @__PURE__ */ new Set([
    "id",
    "name",
    "projectId",
    "team_id",
    "team_name",
    "project_id",
    // Extended production fields
    "member_count",
    "organization_name",
    "project_name"
  ]);
  var KNOWN_DATE_RANGE_FIELDS2 = /* @__PURE__ */ new Set(["min", "max"]);
  function validateRepositoryEntry(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const isProductionFormat = "repository_id" in data || "repository_name" in data;
    const isLegacyFormat = "id" in data || "name" in data;
    if (isProductionFormat) {
      const idReq = validateRequired(data, "repository_id", path);
      if (idReq) errors.push(idReq);
      else {
        const idErr = validateString(
          data.repository_id,
          buildPath(path, "repository_id")
        );
        if (idErr) errors.push(idErr);
      }
      const nameReq = validateRequired(data, "repository_name", path);
      if (nameReq) errors.push(nameReq);
      else {
        const nameErr = validateString(
          data.repository_name,
          buildPath(path, "repository_name")
        );
        if (nameErr) errors.push(nameErr);
      }
      const orgReq = validateRequired(data, "organization_name", path);
      if (orgReq) errors.push(orgReq);
      else {
        const orgErr = validateString(
          data.organization_name,
          buildPath(path, "organization_name")
        );
        if (orgErr) errors.push(orgErr);
      }
      const projReq = validateRequired(data, "project_name", path);
      if (projReq) errors.push(projReq);
      else {
        const projErr = validateString(
          data.project_name,
          buildPath(path, "project_name")
        );
        if (projErr) errors.push(projErr);
      }
    } else if (isLegacyFormat) {
      const idReq = validateRequired(data, "id", path);
      if (idReq) errors.push(idReq);
      else {
        const idErr = validateString(data.id, buildPath(path, "id"));
        if (idErr) errors.push(idErr);
      }
      const nameReq = validateRequired(data, "name", path);
      if (nameReq) errors.push(nameReq);
      else {
        const nameErr = validateString(data.name, buildPath(path, "name"));
        if (nameErr) errors.push(nameErr);
      }
      if ("project" in data && data.project !== void 0) {
        const projErr = validateString(data.project, buildPath(path, "project"));
        if (projErr) errors.push(projErr);
      }
    } else {
      errors.push(
        createError(
          path,
          "repository with (repository_id, repository_name) or (id, name)",
          "empty object",
          `Repository entry at '${path}' must have required identifier fields`
        )
      );
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_REPOSITORY_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateUserEntry(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const isProductionFormat = "user_id" in data || "display_name" in data;
    const isLegacyFormat = "id" in data || "displayName" in data;
    if (isProductionFormat) {
      const idReq = validateRequired(data, "user_id", path);
      if (idReq) errors.push(idReq);
      else {
        const idErr = validateString(data.user_id, buildPath(path, "user_id"));
        if (idErr) errors.push(idErr);
      }
      const nameReq = validateRequired(data, "display_name", path);
      if (nameReq) errors.push(nameReq);
      else {
        const nameErr = validateString(
          data.display_name,
          buildPath(path, "display_name")
        );
        if (nameErr) errors.push(nameErr);
      }
    } else if (isLegacyFormat) {
      const idReq = validateRequired(data, "id", path);
      if (idReq) errors.push(idReq);
      else {
        const idErr = validateString(data.id, buildPath(path, "id"));
        if (idErr) errors.push(idErr);
      }
      const displayNameReq = validateRequired(data, "displayName", path);
      if (displayNameReq) errors.push(displayNameReq);
      else {
        const nameErr = validateString(
          data.displayName,
          buildPath(path, "displayName")
        );
        if (nameErr) errors.push(nameErr);
      }
      const uniqueNameReq = validateRequired(data, "uniqueName", path);
      if (uniqueNameReq) errors.push(uniqueNameReq);
      else {
        const uNameErr = validateString(
          data.uniqueName,
          buildPath(path, "uniqueName")
        );
        if (uNameErr) errors.push(uNameErr);
      }
    } else {
      errors.push(
        createError(
          path,
          "user with (user_id, display_name) or (id, displayName, uniqueName)",
          "empty object",
          `User entry at '${path}' must have required identifier fields`
        )
      );
    }
    const unknown = findUnknownFields(data, KNOWN_USER_FIELDS, path, strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateProjectEntry(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const isProductionFormat = "organization_name" in data || "project_name" in data;
    const isLegacyFormat = "id" in data || "name" in data;
    if (isProductionFormat) {
      const orgReq = validateRequired(data, "organization_name", path);
      if (orgReq) errors.push(orgReq);
      else {
        const orgErr = validateString(
          data.organization_name,
          buildPath(path, "organization_name")
        );
        if (orgErr) errors.push(orgErr);
      }
      const projReq = validateRequired(data, "project_name", path);
      if (projReq) errors.push(projReq);
      else {
        const projErr = validateString(
          data.project_name,
          buildPath(path, "project_name")
        );
        if (projErr) errors.push(projErr);
      }
    } else if (isLegacyFormat) {
      const idReq = validateRequired(data, "id", path);
      if (idReq) errors.push(idReq);
      else {
        const idErr = validateString(data.id, buildPath(path, "id"));
        if (idErr) errors.push(idErr);
      }
      const nameReq = validateRequired(data, "name", path);
      if (nameReq) errors.push(nameReq);
      else {
        const nameErr = validateString(data.name, buildPath(path, "name"));
        if (nameErr) errors.push(nameErr);
      }
    } else {
      errors.push(
        createError(
          path,
          "project with (organization_name, project_name) or (id, name)",
          "empty object",
          `Project entry at '${path}' must have required identifier fields`
        )
      );
    }
    const unknown = findUnknownFields(data, KNOWN_PROJECT_FIELDS, path, strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateReviewerEntry(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const idReq = validateRequired(data, "reviewer_id", path);
    if (idReq) {
      errors.push(idReq);
    } else {
      const idErr = validateString(
        data.reviewer_id,
        buildPath(path, "reviewer_id")
      );
      if (idErr) errors.push(idErr);
    }
    const nameReq = validateRequired(data, "reviewer_name", path);
    if (nameReq) {
      errors.push(nameReq);
    } else {
      const nameErr = validateString(
        data.reviewer_name,
        buildPath(path, "reviewer_name")
      );
      if (nameErr) errors.push(nameErr);
    }
    const unknown = findUnknownFields(data, KNOWN_REVIEWER_FIELDS, path, strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateAuthorEntry(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const idReq = validateRequired(data, "author_id", path);
    if (idReq) {
      errors.push(idReq);
    } else {
      const idErr = validateString(data.author_id, buildPath(path, "author_id"));
      if (idErr) errors.push(idErr);
    }
    const nameReq = validateRequired(data, "author_name", path);
    if (nameReq) {
      errors.push(nameReq);
    } else {
      const nameErr = validateString(
        data.author_name,
        buildPath(path, "author_name")
      );
      if (nameErr) errors.push(nameErr);
    }
    const unknown = findUnknownFields(data, KNOWN_AUTHOR_FIELDS, path, strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateTeamEntry(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const stringFields = [
      "id",
      "name",
      "projectId",
      "team_id",
      "team_name",
      "project_id"
    ];
    for (const field of stringFields) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        const fieldValue = Object.getOwnPropertyDescriptor(data, field)?.value;
        if (fieldValue !== void 0) {
          const err = validateString(fieldValue, buildPath(path, field));
          if (err) errors.push(err);
        }
      }
    }
    const unknown = findUnknownFields(data, KNOWN_TEAM_FIELDS, path, strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateDateRange2(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const minReq = validateRequired(data, "min", path);
    if (minReq) errors.push(minReq);
    else {
      const minErr = validateIsoDate(data.min, buildPath(path, "min"));
      if (minErr) errors.push(minErr);
    }
    const maxReq = validateRequired(data, "max", path);
    if (maxReq) errors.push(maxReq);
    else {
      const maxErr = validateIsoDate(data.max, buildPath(path, "max"));
      if (maxErr) errors.push(maxErr);
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_DATE_RANGE_FIELDS2,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateDimensions(data, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(
        createError(
          "",
          "object",
          getTypeName(data),
          "Dimensions must be an object"
        )
      );
      return invalidResult(errors);
    }
    const requiredArrays = ["repositories", "users", "projects"];
    for (const field of requiredArrays) {
      const req = validateRequired(data, field, "");
      if (req) {
        errors.push(req);
      } else {
        const fieldValue = Object.getOwnPropertyDescriptor(data, field)?.value;
        const arrErr = validateArray(fieldValue, field);
        if (arrErr) {
          errors.push(arrErr);
        }
      }
    }
    if ("repositories" in data && isArray(data.repositories)) {
      data.repositories.forEach((item, i) => {
        const result = validateRepositoryEntry(
          item,
          buildPath("repositories", i),
          strict
        );
        errors.push(...result.errors);
        warnings.push(...result.warnings);
      });
    }
    if ("users" in data && isArray(data.users)) {
      data.users.forEach((item, i) => {
        const result = validateUserEntry(item, buildPath("users", i), strict);
        errors.push(...result.errors);
        warnings.push(...result.warnings);
      });
    }
    if ("reviewers" in data && data.reviewers !== void 0) {
      const arrErr = validateArray(data.reviewers, "reviewers");
      if (arrErr) {
        errors.push(arrErr);
      } else if (isArray(data.reviewers)) {
        data.reviewers.forEach((item, i) => {
          const result = validateReviewerEntry(
            item,
            buildPath("reviewers", i),
            strict
          );
          errors.push(...result.errors);
          warnings.push(...result.warnings);
        });
      }
    }
    if ("authors" in data && data.authors !== void 0) {
      const arrErr = validateArray(data.authors, "authors");
      if (arrErr) {
        errors.push(arrErr);
      } else if (isArray(data.authors)) {
        data.authors.forEach((item, i) => {
          const result = validateAuthorEntry(
            item,
            buildPath("authors", i),
            strict
          );
          errors.push(...result.errors);
          warnings.push(...result.warnings);
        });
      }
    }
    if ("projects" in data && isArray(data.projects)) {
      data.projects.forEach((item, i) => {
        const result = validateProjectEntry(
          item,
          buildPath("projects", i),
          strict
        );
        errors.push(...result.errors);
        warnings.push(...result.warnings);
      });
    }
    if ("teams" in data && data.teams !== void 0) {
      const arrErr = validateArray(data.teams, "teams");
      if (arrErr) {
        errors.push(arrErr);
      } else if (isArray(data.teams)) {
        data.teams.forEach((item, i) => {
          const result = validateTeamEntry(item, buildPath("teams", i), strict);
          errors.push(...result.errors);
          warnings.push(...result.warnings);
        });
      }
    }
    if ("date_range" in data && data.date_range !== void 0) {
      const result = validateDateRange2(data.date_range, "date_range", strict);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    const unknown = findUnknownFields(data, KNOWN_ROOT_FIELDS3, "", strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    if (errors.length > 0) {
      return invalidResult(errors, warnings);
    }
    return validResult(warnings);
  }

  // ../ui/schemas/predictions.schema.ts
  var KNOWN_ROOT_FIELDS4 = /* @__PURE__ */ new Set([
    "schema_version",
    "generated_at",
    "generated_by",
    "is_stub",
    "forecasts",
    "state"
  ]);
  var KNOWN_FORECAST_FIELDS = /* @__PURE__ */ new Set([
    "metric",
    "unit",
    "horizon_weeks",
    "values"
  ]);
  var KNOWN_FORECAST_VALUE_FIELDS = /* @__PURE__ */ new Set([
    "period_start",
    "predicted",
    "lower_bound",
    "upper_bound"
  ]);
  function validateForecastValue(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const periodReq = validateRequired(data, "period_start", path);
    if (periodReq) errors.push(periodReq);
    else {
      const periodErr = validateIsoDate(
        data.period_start,
        buildPath(path, "period_start")
      );
      if (periodErr) errors.push(periodErr);
    }
    const predictedReq = validateRequired(data, "predicted", path);
    if (predictedReq) errors.push(predictedReq);
    else {
      const predictedErr = validateNumber(
        data.predicted,
        buildPath(path, "predicted")
      );
      if (predictedErr) errors.push(predictedErr);
    }
    if ("lower_bound" in data && data.lower_bound !== void 0) {
      const lowerErr = validateNumber(
        data.lower_bound,
        buildPath(path, "lower_bound")
      );
      if (lowerErr) errors.push(lowerErr);
    }
    if ("upper_bound" in data && data.upper_bound !== void 0) {
      const upperErr = validateNumber(
        data.upper_bound,
        buildPath(path, "upper_bound")
      );
      if (upperErr) errors.push(upperErr);
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_FORECAST_VALUE_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateForecastEntry(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const metricReq = validateRequired(data, "metric", path);
    if (metricReq) errors.push(metricReq);
    else {
      const metricErr = validateString(data.metric, buildPath(path, "metric"));
      if (metricErr) errors.push(metricErr);
    }
    const unitReq = validateRequired(data, "unit", path);
    if (unitReq) errors.push(unitReq);
    else {
      const unitErr = validateString(data.unit, buildPath(path, "unit"));
      if (unitErr) errors.push(unitErr);
    }
    const horizonReq = validateRequired(data, "horizon_weeks", path);
    if (horizonReq) errors.push(horizonReq);
    else {
      const horizonErr = validateNonNegativeNumber(
        data.horizon_weeks,
        buildPath(path, "horizon_weeks")
      );
      if (horizonErr) errors.push(horizonErr);
    }
    const valuesReq = validateRequired(data, "values", path);
    if (valuesReq) errors.push(valuesReq);
    else {
      const valuesArrErr = validateArray(data.values, buildPath(path, "values"));
      if (valuesArrErr) {
        errors.push(valuesArrErr);
      } else if (isArray(data.values)) {
        data.values.forEach((item, i) => {
          const result = validateForecastValue(
            item,
            buildPath(path, `values[${i}]`),
            strict
          );
          errors.push(...result.errors);
          warnings.push(...result.warnings);
        });
      }
    }
    const unknown = findUnknownFields(data, KNOWN_FORECAST_FIELDS, path, strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validatePredictions(data, strict) {
    const errors = [];
    const warnings = [];
    if (isNullish(data)) {
      return validResult();
    }
    if (!isObject(data)) {
      errors.push(
        createError(
          "",
          "object",
          getTypeName(data),
          "Predictions must be an object"
        )
      );
      return invalidResult(errors);
    }
    const requiredFields = ["schema_version", "generated_at", "forecasts"];
    for (const field of requiredFields) {
      const err = validateRequired(data, field, "");
      if (err) errors.push(err);
    }
    if ("schema_version" in data) {
      const err = validateNumber(data.schema_version, "schema_version");
      if (err) errors.push(err);
    }
    if ("generated_at" in data) {
      const err = validateIsoDatetime(data.generated_at, "generated_at");
      if (err) errors.push(err);
    }
    if ("forecasts" in data) {
      const arrErr = validateArray(data.forecasts, "forecasts");
      if (arrErr) {
        errors.push(arrErr);
      } else if (isArray(data.forecasts)) {
        data.forecasts.forEach((item, i) => {
          const result = validateForecastEntry(
            item,
            buildPath("forecasts", i),
            strict
          );
          errors.push(...result.errors);
          warnings.push(...result.warnings);
        });
      }
    }
    if ("generated_by" in data && data.generated_by !== void 0) {
      const err = validateString(data.generated_by, "generated_by");
      if (err) errors.push(err);
    }
    if ("is_stub" in data && data.is_stub !== void 0) {
      const err = validateBoolean(data.is_stub, "is_stub");
      if (err) errors.push(err);
    }
    if ("state" in data && data.state !== void 0) {
      const err = validateString(data.state, "state");
      if (err) errors.push(err);
    }
    const unknown = findUnknownFields(data, KNOWN_ROOT_FIELDS4, "", strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    if (errors.length > 0) {
      return invalidResult(errors, warnings);
    }
    return validResult(warnings);
  }

  // ../ui/dataset-loader.ts
  function validateSchema(data, validator, artifactType, strict, context) {
    const result = validator(data, strict);
    if (!result.valid) {
      throw new SchemaValidationError(result.errors, artifactType);
    }
    if (result.warnings.length > 0) {
      const contextSuffix = context ? ` for ${context}` : "";
      console.warn(
        `[DatasetLoader] ${artifactType} validation warnings${contextSuffix}:`,
        result.warnings.map((w) => w.message).join("; ")
      );
    }
  }
  var SUPPORTED_MANIFEST_VERSION = 1;
  var SUPPORTED_DATASET_VERSION = 1;
  var SUPPORTED_AGGREGATES_VERSION = 2;
  var DEFAULT_CAPABILITY_STATE = {
    authorFiltersAvailable: false,
    authorRepoExactAvailable: false,
    commentsMetricsAvailable: false,
    commentsCoverageStatus: "disabled",
    reviewerRepositoryMode: "constrained",
    reviewerTeamMode: "disallowed",
    crossDimensionalAvailable: false
  };
  var DATASET_CANDIDATE_PATHS = [
    "",
    // Root of provided base URL (preferred)
    "aggregates"
    // Single nesting (legacy ADO artifact download)
  ];
  var ROLLUP_FIELD_DEFAULTS = {
    pr_count: 0,
    cycle_time_p50: null,
    cycle_time_p90: null,
    authors_count: 0,
    reviewers_count: 0,
    by_repository: null,
    // null indicates feature not available
    by_author: null,
    by_team: null,
    // null indicates feature not available
    by_reviewer: null
    // null indicates feature not available
  };
  function normalizeRollup2(rollup) {
    if (!rollup || typeof rollup !== "object") {
      return { week: "unknown", ...ROLLUP_FIELD_DEFAULTS };
    }
    const r = rollup;
    return {
      // Preserve all existing fields
      ...r,
      // Ensure required fields have defaults (don't override if already set)
      pr_count: r.pr_count ?? ROLLUP_FIELD_DEFAULTS.pr_count,
      cycle_time_p50: r.cycle_time_p50 ?? ROLLUP_FIELD_DEFAULTS.cycle_time_p50,
      cycle_time_p90: r.cycle_time_p90 ?? ROLLUP_FIELD_DEFAULTS.cycle_time_p90,
      authors_count: r.authors_count ?? ROLLUP_FIELD_DEFAULTS.authors_count,
      reviewers_count: r.reviewers_count ?? ROLLUP_FIELD_DEFAULTS.reviewers_count,
      // by_repository and by_team are optional features - preserve null if missing
      by_repository: r.by_repository !== void 0 ? r.by_repository : null,
      by_author: r.by_author !== void 0 ? r.by_author : null,
      ...r.by_author_and_repo !== void 0 ? {
        by_author_and_repo: r.by_author_and_repo
      } : {},
      by_team: r.by_team !== void 0 ? r.by_team : null,
      by_reviewer: r.by_reviewer !== void 0 ? r.by_reviewer : null,
      // Cross-dimensional breakdown (v2 schema) — pass through if present
      ...r.by_team_and_repo !== void 0 ? {
        by_team_and_repo: r.by_team_and_repo
      } : {}
    };
  }
  function normalizeRollups(rollups) {
    if (!Array.isArray(rollups)) {
      return [];
    }
    return rollups.map(normalizeRollup2);
  }
  var fetchSemaphore = {
    maxConcurrent: 4,
    maxRetries: 1,
    retryDelayMs: 200,
    active: 0,
    queue: [],
    /**
     * Acquire a semaphore slot. Blocks until slot available.
     * @returns {Promise<void>}
     */
    acquire() {
      return new Promise((resolve) => {
        if (this.active < this.maxConcurrent) {
          this.active++;
          resolve();
        } else {
          this.queue.push(resolve);
        }
      });
    },
    /**
     * Release a semaphore slot. Unblocks next waiter if any.
     */
    release() {
      const next = this.queue.shift();
      if (next) {
        next();
      } else {
        this.active--;
      }
    },
    /**
     * Get current state (for testing).
     * @returns {{ active: number, queued: number }}
     */
    getState() {
      return { active: this.active, queued: this.queue.length };
    },
    /**
     * Reset semaphore state (for testing).
     */
    reset() {
      this.active = 0;
      this.queue = [];
    }
  };
  function createRollupCache(clock = Date.now) {
    const maxSize = 52;
    const ttlMs = 5 * 60 * 1e3;
    const entries = /* @__PURE__ */ new Map();
    const requiredKeyFields = ["week", "org", "project", "repo"];
    return {
      maxSize,
      ttlMs,
      clock,
      /**
       * Build composite cache key. Throws if required params missing.
       */
      makeKey(params) {
        for (const field of requiredKeyFields) {
          if (!params[field]) {
            throw new Error(`Cache key missing required field: ${field}`);
          }
        }
        const {
          week,
          org,
          project,
          repo,
          branch = "",
          apiVersion = "1"
        } = params;
        return `${week}|${org}|${project}|${repo}|${branch}|${apiVersion}`;
      },
      /**
       * Get cached value if valid.
       */
      get(key) {
        const entry = entries.get(key);
        if (!entry) return void 0;
        const now = clock();
        if (now - entry.createdAt > ttlMs) {
          entries.delete(key);
          return void 0;
        }
        entry.touchedAt = now;
        return entry.value;
      },
      /**
       * Set cache value, evicting oldest if at capacity.
       */
      set(key, value) {
        const now = clock();
        if (entries.size >= maxSize && !entries.has(key)) {
          let oldestKey = null;
          let oldestTime = Infinity;
          for (const [k, v] of entries) {
            if (v.touchedAt < oldestTime) {
              oldestTime = v.touchedAt;
              oldestKey = k;
            }
          }
          if (oldestKey) entries.delete(oldestKey);
        }
        entries.set(key, {
          value,
          createdAt: now,
          touchedAt: now
        });
      },
      /**
       * Check if key exists and is not expired.
       */
      has(key) {
        return this.get(key) !== void 0;
      },
      /**
       * Clear all entries.
       */
      clear() {
        entries.clear();
      },
      /**
       * Get cache size.
       */
      size() {
        return entries.size;
      }
    };
  }
  var DatasetLoader = class {
    // year -> data
    constructor(baseUrl) {
      this.effectiveBaseUrl = null;
      // Resolved after probing
      this.manifest = null;
      this.dimensions = null;
      this.capabilityState = null;
      this.rollupCache = /* @__PURE__ */ new Map();
      // week -> data
      this.distributionCache = /* @__PURE__ */ new Map();
      this.baseUrl = baseUrl || "";
      this.effectiveBaseUrl = null;
    }
    /**
     * Resolve the dataset root by probing candidate paths for manifest.
     * Caches the result for subsequent path resolutions.
     * @returns The effective base URL or null if not found
     */
    async resolveDatasetRoot() {
      if (this.effectiveBaseUrl !== null) {
        return this.effectiveBaseUrl || null;
      }
      for (const candidate of DATASET_CANDIDATE_PATHS) {
        const candidateBase = candidate ? `${this.baseUrl}/${candidate}` : this.baseUrl;
        const manifestUrl = candidateBase ? `${candidateBase}/dataset-manifest.json` : "dataset-manifest.json";
        try {
          const response = await fetch(manifestUrl, { method: "HEAD" });
          if (response.ok) {
            console.log("[DatasetLoader] Found manifest at: %s", manifestUrl);
            this.effectiveBaseUrl = candidateBase;
            return candidateBase;
          }
        } catch {
        }
      }
      console.warn(
        "[DatasetLoader] No manifest found in candidate paths, using baseUrl as fallback"
      );
      this.effectiveBaseUrl = this.baseUrl;
      return null;
    }
    /**
     * Load and validate the dataset manifest.
     * Automatically resolves nested dataset root before loading.
     */
    async loadManifest() {
      if (this.manifest) {
        return this.manifest;
      }
      if (this.effectiveBaseUrl === null) {
        await this.resolveDatasetRoot();
      }
      const url = this.resolvePath("dataset-manifest.json");
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(
            "Dataset not found. Ensure the analytics pipeline has run successfully."
          );
        }
        throw new Error(
          `Failed to load manifest: ${response.status} ${response.statusText}`
        );
      }
      const manifest = await response.json();
      this.validateManifestSchema(manifest);
      this.manifest = manifest;
      this.capabilityState = this.normalizeCapabilityState(manifest);
      return manifest;
    }
    normalizeCapabilityState(manifest) {
      const capabilities = manifest.capabilities ?? {};
      const features = manifest.features ?? {};
      const commentsCoverage = manifest.coverage?.comments;
      const commentsCoverageStatus = typeof commentsCoverage === "object" && commentsCoverage !== null && "status" in commentsCoverage && (commentsCoverage.status === "full" || commentsCoverage.status === "partial" || commentsCoverage.status === "disabled") ? commentsCoverage.status : typeof commentsCoverage === "string" && (commentsCoverage === "full" || commentsCoverage === "partial" || commentsCoverage === "disabled") ? commentsCoverage : DEFAULT_CAPABILITY_STATE.commentsCoverageStatus;
      return {
        authorFiltersAvailable: capabilities.author_filters ?? (manifest.aggregates_schema_version ?? 0) >= 3,
        authorRepoExactAvailable: capabilities.author_repo_exact ?? (manifest.aggregates_schema_version ?? 0) >= 3,
        commentsMetricsAvailable: capabilities.comments_metrics ?? features.comments === true,
        commentsCoverageStatus,
        reviewerRepositoryMode: capabilities.reviewer_repository_mode ?? DEFAULT_CAPABILITY_STATE.reviewerRepositoryMode,
        reviewerTeamMode: capabilities.reviewer_team_mode ?? DEFAULT_CAPABILITY_STATE.reviewerTeamMode,
        crossDimensionalAvailable: capabilities.cross_dimensional_available ?? features.cross_dimensional === true
      };
    }
    /**
     * Validate manifest schema using schema validator.
     * Throws SchemaValidationError on invalid data.
     */
    validateManifestSchema(manifest) {
      validateSchema(manifest, validateManifest, "manifest", true);
      const m = manifest;
      if (m.manifest_schema_version !== void 0 && m.manifest_schema_version > SUPPORTED_MANIFEST_VERSION) {
        throw new Error(
          `Manifest version ${m.manifest_schema_version} not supported. Maximum supported: ${SUPPORTED_MANIFEST_VERSION}. Please update the extension.`
        );
      }
      if (m.dataset_schema_version !== void 0 && m.dataset_schema_version > SUPPORTED_DATASET_VERSION) {
        throw new Error(
          `Dataset version ${m.dataset_schema_version} not supported. Please update the extension.`
        );
      }
      if (m.aggregates_schema_version !== void 0 && m.aggregates_schema_version > SUPPORTED_AGGREGATES_VERSION) {
        throw new Error(
          `Aggregates version ${m.aggregates_schema_version} not supported. Please update the extension.`
        );
      }
    }
    /**
     * Load dimensions (filter values).
     * Validates against schema and throws SchemaValidationError on invalid data.
     */
    async loadDimensions() {
      if (this.dimensions) return this.dimensions;
      const url = this.resolvePath("aggregates/dimensions.json");
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load dimensions: ${response.status}`);
      }
      const rawDimensions = await response.json();
      validateSchema(rawDimensions, validateDimensions, "dimensions", true);
      this.dimensions = rawDimensions;
      return this.dimensions;
    }
    /**
     * Get weekly rollups for a date range.
     * Implements lazy loading with caching.
     */
    async getWeeklyRollups(startDate, endDate) {
      if (!this.manifest) {
        throw new Error("Manifest not loaded. Call loadManifest() first.");
      }
      const neededWeeks = this.getWeeksInRange(startDate, endDate);
      const results = [];
      for (const weekStr of neededWeeks) {
        const cached = this.rollupCache.get(weekStr);
        if (cached) {
          results.push(cached);
          continue;
        }
        const indexEntry = this.manifest?.aggregate_index?.weekly_rollups?.find(
          (r) => r.week === weekStr
        );
        if (!indexEntry) {
          continue;
        }
        const url = this.resolvePath(indexEntry.path);
        const response = await fetch(url);
        if (response.ok) {
          const rawData = await response.json();
          validateSchema(rawData, validateRollup, "rollup", false, weekStr);
          const data = normalizeRollup2(rawData);
          this.rollupCache.set(weekStr, data);
          results.push(data);
        }
      }
      return results.sort((a, b) => a.week.localeCompare(b.week));
    }
    /**
     * Get weekly rollups with concurrent fetching, progress reporting, and caching (Phase 4).
     */
    async getWeeklyRollupsWithProgress(startDate, endDate, context, onProgress = () => {
    }, cache = null) {
      if (!this.manifest) {
        throw new Error("Manifest not loaded. Call loadManifest() first.");
      }
      const allWeeks = this.getWeeksInRange(startDate, endDate);
      const data = [];
      const missingWeeks = [];
      const failedWeeks = [];
      let authError = false;
      const useCache = cache || {
        makeKey: (params) => params.week,
        get: (key) => this.rollupCache.get(key),
        set: (key, value) => this.rollupCache.set(key, value),
        has: (key) => this.rollupCache.has(key),
        maxSize: Infinity,
        ttlMs: Infinity,
        clock: Date.now,
        clear: () => this.rollupCache.clear(),
        size: () => this.rollupCache.size
      };
      const cachedResults = [];
      const weeksToFetch = [];
      for (const weekStr of allWeeks) {
        try {
          const cacheKey = useCache.makeKey({ week: weekStr, ...context });
          const cached = useCache.get(cacheKey);
          if (cached !== void 0) {
            cachedResults.push(cached);
          } else {
            weeksToFetch.push(weekStr);
          }
        } catch {
          weeksToFetch.push(weekStr);
        }
      }
      const batches = [];
      for (let i = 0; i < weeksToFetch.length; i += fetchSemaphore.maxConcurrent) {
        batches.push(weeksToFetch.slice(i, i + fetchSemaphore.maxConcurrent));
      }
      let loaded = 0;
      const total = weeksToFetch.length;
      for (const batch of batches) {
        const batchPromises = batch.map(async (weekStr) => {
          onProgress({ loaded, total, currentWeek: weekStr });
          const indexEntry = this.manifest?.aggregate_index?.weekly_rollups?.find(
            (r) => r.week === weekStr
          );
          if (!indexEntry) {
            return { week: weekStr, status: "missing" };
          }
          return await this._fetchWeekWithRetry(
            weekStr,
            indexEntry,
            context,
            useCache
          );
        });
        const results = await Promise.allSettled(batchPromises);
        for (const result of results) {
          loaded++;
          if (result.status === "fulfilled") {
            const outcome = result.value;
            if (outcome.status === "ok") {
              data.push(outcome.data);
            } else if (outcome.status === "missing") {
              missingWeeks.push(outcome.week);
            } else if (outcome.status === "auth") {
              authError = true;
            } else if (outcome.status === "failed") {
              failedWeeks.push(outcome.week);
            }
          } else {
            failedWeeks.push("unknown");
          }
        }
      }
      const allData = [...cachedResults, ...data];
      const partial = missingWeeks.length > 0 || failedWeeks.length > 0;
      const degraded = partial || authError;
      if (authError && allData.length === 0) {
        const error = new Error("Authentication required");
        error.code = "AUTH_REQUIRED";
        throw error;
      }
      onProgress({ loaded: total, total, currentWeek: null });
      return {
        data: allData.sort((a, b) => a.week.localeCompare(b.week)),
        missingWeeks,
        failedWeeks,
        partial,
        authError,
        degraded
      };
    }
    /**
     * Fetch a single week with semaphore control and bounded retry.
     */
    async _fetchWeekWithRetry(weekStr, indexEntry, context, cache) {
      let retries = 0;
      while (retries <= fetchSemaphore.maxRetries) {
        await fetchSemaphore.acquire();
        try {
          const url = this.resolvePath(indexEntry.path);
          const response = await fetch(url);
          if (response.ok) {
            const rawData = await response.json();
            const data = normalizeRollup2(rawData);
            try {
              const cacheKey = cache.makeKey({ week: weekStr, ...context });
              cache.set(cacheKey, data);
            } catch {
            }
            return { week: weekStr, status: "ok", data };
          }
          if (response.status === 401 || response.status === 403) {
            return { week: weekStr, status: "auth" };
          }
          if (response.status === 404) {
            return { week: weekStr, status: "missing" };
          }
          if (response.status >= 500 && retries < fetchSemaphore.maxRetries) {
            retries++;
            await this._delay(fetchSemaphore.retryDelayMs);
            continue;
          }
          return {
            week: weekStr,
            status: "failed",
            error: `HTTP ${response.status}`
          };
        } catch (err) {
          if (retries < fetchSemaphore.maxRetries) {
            retries++;
            await this._delay(fetchSemaphore.retryDelayMs);
            continue;
          }
          return { week: weekStr, status: "failed", error: getErrorMessage(err) };
        } finally {
          fetchSemaphore.release();
        }
      }
      return { week: weekStr, status: "failed", error: "max retries exceeded" };
    }
    /**
     * Delay helper for retry backoff.
     */
    _delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /**
     * Get yearly distributions for a date range.
     */
    async getDistributions(startDate, endDate) {
      if (!this.manifest) {
        throw new Error("Manifest not loaded. Call loadManifest() first.");
      }
      const startYear = startDate.getFullYear();
      const endYear = endDate.getFullYear();
      const results = [];
      for (let year = startYear; year <= endYear; year++) {
        const yearStr = year.toString();
        const cached = this.distributionCache.get(yearStr);
        if (cached) {
          results.push(cached);
          continue;
        }
        const indexEntry = this.manifest?.aggregate_index?.distributions?.find(
          (d) => d.year === yearStr
        );
        if (!indexEntry) continue;
        const url = this.resolvePath(indexEntry.path);
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          this.distributionCache.set(yearStr, data);
          results.push(data);
        }
      }
      return results;
    }
    /**
     * Check if a feature is enabled in the dataset.
     */
    isFeatureEnabled(feature) {
      if (!this.manifest) return false;
      return this.manifest.features?.[feature] === true;
    }
    getCapabilityState() {
      return this.capabilityState ?? DEFAULT_CAPABILITY_STATE;
    }
    /**
     * Get dataset coverage info.
     */
    getCoverage() {
      if (!this.manifest) return null;
      return this.manifest.coverage ?? null;
    }
    /**
     * Get default date range days.
     */
    getDefaultRangeDays() {
      return this.manifest?.defaults?.default_date_range_days || 90;
    }
    /**
     * Load predictions data (Phase 3.5).
     * Validates against schema (permissive mode - unknown fields produce warnings).
     */
    async loadPredictions() {
      if (!this.isFeatureEnabled("predictions")) {
        return { state: "disabled" };
      }
      try {
        const url = this.resolvePath("predictions/trends.json");
        const response = await fetch(url);
        if (!response.ok) {
          if (response.status === 404) {
            return { state: "missing" };
          }
          if (response.status === 401 || response.status === 403) {
            return { state: "auth" };
          }
          return {
            state: "error",
            error: "PRED_003",
            message: `HTTP ${response.status}`
          };
        }
        const predictions = await response.json();
        const schemaResult = validatePredictions(
          predictions,
          false
        );
        if (!schemaResult.valid) {
          console.error(
            "[DatasetLoader] Invalid predictions schema:",
            schemaResult.errors.map((e) => e.message).join("; ")
          );
          return {
            state: "invalid",
            error: "PRED_001",
            message: schemaResult.errors[0]?.message ?? "Schema validation failed"
          };
        }
        if (schemaResult.warnings.length > 0) {
          console.warn(
            "[DatasetLoader] Predictions validation warnings:",
            schemaResult.warnings.map((w) => w.message).join("; ")
          );
        }
        return { state: "ok", data: predictions };
      } catch (err) {
        console.error("[DatasetLoader] Error loading predictions:", err);
        return {
          state: "error",
          error: "PRED_002",
          message: getErrorMessage(err)
        };
      }
    }
    /**
     * Load AI insights data (Phase 3.5).
     */
    async loadInsights() {
      if (!this.isFeatureEnabled("ai_insights")) {
        return { state: "disabled" };
      }
      try {
        const url = this.resolvePath("insights/summary.json");
        const response = await fetch(url);
        if (!response.ok) {
          if (response.status === 404) {
            return { state: "missing" };
          }
          if (response.status === 401 || response.status === 403) {
            return { state: "auth" };
          }
          return {
            state: "error",
            error: "AI_003",
            message: `HTTP ${response.status}`
          };
        }
        const insights = await response.json();
        const validationResult = this.validateInsightsSchema(insights);
        if (!validationResult.valid) {
          console.error(
            "[DatasetLoader] Invalid insights schema:",
            validationResult.error
          );
          return {
            state: "invalid",
            error: "AI_001",
            message: validationResult.error
          };
        }
        return { state: "ok", data: insights };
      } catch (err) {
        console.error("[DatasetLoader] Error loading insights:", err);
        return { state: "error", error: "AI_002", message: getErrorMessage(err) };
      }
    }
    /**
     * Validate predictions schema.
     */
    validatePredictionsSchema(predictions) {
      if (!predictions || typeof predictions !== "object")
        return { valid: false, error: "Missing predictions data" };
      const p = predictions;
      if (typeof p.schema_version !== "number") {
        return { valid: false, error: "Missing schema_version" };
      }
      if (p.schema_version > 1) {
        return {
          valid: false,
          error: `Unsupported schema version: ${p.schema_version}`
        };
      }
      if (!Array.isArray(p.forecasts)) {
        return { valid: false, error: "Missing forecasts array" };
      }
      for (const forecast of p.forecasts) {
        if (!forecast.metric || !forecast.unit || !Array.isArray(forecast.values)) {
          return { valid: false, error: "Invalid forecast structure" };
        }
      }
      return { valid: true };
    }
    /**
     * Validate insights schema.
     */
    validateInsightsSchema(insights) {
      if (!insights || typeof insights !== "object")
        return { valid: false, error: "Missing insights data" };
      const i = insights;
      if (typeof i.schema_version !== "number") {
        return { valid: false, error: "Missing schema_version" };
      }
      if (i.schema_version > 1) {
        return {
          valid: false,
          error: `Unsupported schema version: ${i.schema_version}`
        };
      }
      if (!Array.isArray(i.insights)) {
        return { valid: false, error: "Missing insights array" };
      }
      for (const insight of i.insights) {
        if (!insight.id || !insight.category || !insight.severity || !insight.title) {
          return { valid: false, error: "Invalid insight structure" };
        }
      }
      return { valid: true };
    }
    /**
     * Resolve a relative path to full URL.
     * Uses effectiveBaseUrl if resolved, otherwise falls back to baseUrl.
     */
    resolvePath(relativePath) {
      const base = this.effectiveBaseUrl !== null ? this.effectiveBaseUrl : this.baseUrl;
      if (base) {
        return `${base}/${relativePath}`;
      }
      return relativePath;
    }
    /**
     * Get ISO week strings for a date range.
     */
    getWeeksInRange(start, end) {
      const weeks = [];
      const current = new Date(start);
      while (current <= end) {
        const weekStr = this.getISOWeek(current);
        if (!weeks.includes(weekStr)) {
          weeks.push(weekStr);
        }
        current.setDate(current.getDate() + 7);
      }
      const endWeek = this.getISOWeek(end);
      if (!weeks.includes(endWeek)) {
        weeks.push(endWeek);
      }
      return weeks;
    }
    /**
     * Get ISO week string for a date.
     */
    getISOWeek(date) {
      const d = new Date(
        Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
      );
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(
        ((d.getTime() - yearStart.getTime()) / 864e5 + 1) / 7
      );
      return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, "0")}`;
    }
  };
  if (typeof window !== "undefined") {
    window.DatasetLoader = DatasetLoader;
    window.fetchSemaphore = fetchSemaphore;
    window.createRollupCache = createRollupCache;
    window.normalizeRollup = normalizeRollup2;
    window.normalizeRollups = normalizeRollups;
    window.ROLLUP_FIELD_DEFAULTS = ROLLUP_FIELD_DEFAULTS;
  }

  // ../ui/error-types.ts
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

  // ../ui/artifact-client.ts
  var ArtifactClient = class {
    /**
     * Create a new ArtifactClient.
     *
     * @param projectId - Azure DevOps project ID
     */
    constructor(projectId) {
      this.collectionUri = null;
      this.authToken = null;
      this.initialized = false;
      this.projectId = projectId;
    }
    /**
     * Initialize the client with ADO SDK auth.
     * MUST be called after VSS.ready() and before any other methods.
     *
     * @returns This client instance
     */
    async initialize() {
      if (this.initialized) {
        return this;
      }
      const webContext = VSS.getWebContext();
      this.collectionUri = webContext.collection.uri;
      const tokenResult = await VSS.getAccessToken();
      this.authToken = typeof tokenResult === "string" ? tokenResult : tokenResult.token;
      this.initialized = true;
      return this;
    }
    /**
     * Ensure the client is initialized.
     */
    _ensureInitialized() {
      if (!this.initialized) {
        throw new Error(
          "ArtifactClient not initialized. Call initialize() first."
        );
      }
    }
    /**
     * Fetch a file from a build artifact.
     *
     * @param buildId - Build ID
     * @param artifactName - Artifact name (e.g., 'aggregates')
     * @param filePath - Path within artifact (e.g., 'dataset-manifest.json')
     * @returns Parsed JSON content
     * @throws {PrInsightsError} On permission denied or not found
     */
    async getArtifactFile(buildId, artifactName, filePath) {
      this._ensureInitialized();
      const url = this._buildFileUrl(buildId, artifactName, filePath);
      const response = await this._authenticatedFetch(url);
      if (response.status === 401 || response.status === 403) {
        throw createPermissionDeniedError("read artifact files");
      }
      if (response.status === 404) {
        throw new Error(
          `File '${filePath}' not found in artifact '${artifactName}'`
        );
      }
      if (!response.ok) {
        throw new Error(
          `Failed to fetch artifact file: ${response.status} ${response.statusText}`
        );
      }
      return response.json();
    }
    /**
     * Check if a specific file exists in an artifact.
     */
    async hasArtifactFile(buildId, artifactName, filePath) {
      this._ensureInitialized();
      try {
        const url = this._buildFileUrl(buildId, artifactName, filePath);
        const response = await this._authenticatedFetch(url, { method: "HEAD" });
        return response.ok;
      } catch {
        return false;
      }
    }
    /**
     * Get artifact metadata by looking it up from the artifacts list.
     */
    async getArtifactMetadata(buildId, artifactName) {
      this._ensureInitialized();
      const artifacts = await this.getArtifacts(buildId);
      const artifact = artifacts.find(
        (a) => a.name === artifactName
      );
      if (!artifact) {
        console.log(
          "[getArtifactMetadata] Artifact '%s' not found in build %d",
          artifactName,
          buildId
        );
        return null;
      }
      return artifact;
    }
    /**
     * Get artifact content via SDK approach.
     */
    async getArtifactFileViaSdk(buildId, artifactName, filePath) {
      this._ensureInitialized();
      const artifact = await this.getArtifactMetadata(buildId, artifactName);
      if (!artifact) {
        throw new Error(
          `Artifact '${artifactName}' not found in build ${buildId}`
        );
      }
      const downloadUrl = artifact.resource?.downloadUrl;
      if (!downloadUrl) {
        throw new Error(
          `No downloadUrl available for artifact '${artifactName}'`
        );
      }
      const normalizedPath = filePath.startsWith("/") ? filePath : "/" + filePath;
      let url;
      if (downloadUrl.includes("format=")) {
        url = downloadUrl.replace(/format=\w+/, "format=file");
      } else {
        const separator = downloadUrl.includes("?") ? "&" : "?";
        url = `${downloadUrl}${separator}format=file`;
      }
      url += `&subPath=${encodeURIComponent(normalizedPath)}`;
      const response = await this._authenticatedFetch(url);
      if (response.status === 404) {
        throw new Error(
          `File '${filePath}' not found in artifact '${artifactName}'`
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw createPermissionDeniedError("read artifact file");
      }
      if (!response.ok) {
        throw new Error(
          `Failed to fetch file: ${response.status} ${response.statusText}`
        );
      }
      return response.json();
    }
    /**
     * Get list of artifacts for a build.
     */
    async getArtifacts(buildId) {
      this._ensureInitialized();
      const url = `${this.collectionUri}${this.projectId}/_apis/build/builds/${buildId}/artifacts?api-version=7.1`;
      const response = await this._authenticatedFetch(url);
      if (response.status === 401 || response.status === 403) {
        throw createPermissionDeniedError("list build artifacts");
      }
      if (!response.ok) {
        throw new Error(`Failed to list artifacts: ${response.status}`);
      }
      const data = await response.json();
      return data.value || [];
    }
    /**
     * Get pipeline definitions for the project.
     *
     * @param top - Maximum number of definitions to return (default: 50)
     * @param queryOrder - Sort order (2 = lastModifiedDescending)
     * @returns Array of pipeline definition references
     */
    async getDefinitions(top = 50, queryOrder = 2) {
      this._ensureInitialized();
      const url = `${this.collectionUri}${this.projectId}/_apis/build/definitions?api-version=7.1&$top=${top}&queryOrder=${queryOrder}`;
      const response = await this._authenticatedFetch(url);
      if (response.status === 401 || response.status === 403) {
        throw createPermissionDeniedError("list build definitions");
      }
      if (!response.ok) {
        throw new Error(`Failed to list definitions: ${response.status}`);
      }
      const data = await response.json();
      return data.value || [];
    }
    /**
     * Get builds for a specific pipeline definition.
     *
     * @param definitionId - Pipeline definition ID to filter by
     * @param top - Maximum number of builds to return (default: 1)
     * @returns Array of builds (filtered to completed + succeeded)
     */
    async getBuilds(definitionId, top = 1) {
      this._ensureInitialized();
      const url = `${this.collectionUri}${this.projectId}/_apis/build/builds?api-version=7.1&definitions=${definitionId}&statusFilter=2&resultFilter=6&$top=${top}`;
      const response = await this._authenticatedFetch(url);
      if (response.status === 401 || response.status === 403) {
        throw createPermissionDeniedError("list builds");
      }
      if (!response.ok) {
        throw new Error(`Failed to list builds: ${response.status}`);
      }
      const data = await response.json();
      return data.value || [];
    }
    /**
     * Create a DatasetLoader that uses this client for authenticated requests.
     */
    createDatasetLoader(buildId, artifactName) {
      return new AuthenticatedDatasetLoader(this, buildId, artifactName);
    }
    /**
     * Build the URL for accessing a file within an artifact.
     */
    _buildFileUrl(buildId, artifactName, filePath) {
      const normalizedPath = filePath.startsWith("/") ? filePath : "/" + filePath;
      return `${this.collectionUri}${this.projectId}/_apis/build/builds/${buildId}/artifacts?artifactName=${encodeURIComponent(artifactName)}&%24format=file&subPath=${encodeURIComponent(normalizedPath)}&api-version=7.1`;
    }
    /**
     * Perform an authenticated fetch using the ADO auth token.
     */
    async _authenticatedFetch(url, options = {}) {
      const headers = {
        Authorization: `Bearer ${this.authToken}`,
        Accept: "application/json",
        ...options.headers || {}
      };
      return fetch(url, { ...options, headers });
    }
    /**
     * Public wrapper for authenticated fetch.
     * Use this for external callers (e.g., dashboard raw data download).
     *
     * @param url - URL to fetch
     * @param options - Fetch options
     * @returns Response
     */
    async authenticatedFetch(url, options = {}) {
      this._ensureInitialized();
      return this._authenticatedFetch(url, options);
    }
  };
  var AuthenticatedDatasetLoader = class {
    constructor(artifactClient2, buildId, artifactName) {
      this.manifest = null;
      this.dimensions = null;
      this.rollupCache = /* @__PURE__ */ new Map();
      this.distributionCache = /* @__PURE__ */ new Map();
      this.artifactClient = artifactClient2;
      this.buildId = buildId;
      this.artifactName = artifactName;
    }
    async loadManifest() {
      try {
        this.manifest = await this.artifactClient.getArtifactFileViaSdk(
          this.buildId,
          this.artifactName,
          "dataset-manifest.json"
        );
        if (!this.manifest) {
          throw new Error("Manifest file is empty or invalid");
        }
        this.validateManifest(this.manifest);
        return this.manifest;
      } catch (error) {
        const wrappedError = new Error(
          `Failed to load dataset manifest: ${getErrorMessage(error)}`
        );
        wrappedError.cause = error;
        throw wrappedError;
      }
    }
    validateManifest(manifest) {
      const SUPPORTED_MANIFEST_VERSION2 = 1;
      const SUPPORTED_DATASET_VERSION2 = 1;
      const SUPPORTED_AGGREGATES_VERSION2 = 2;
      if (!manifest.manifest_schema_version) {
        throw new Error("Invalid manifest: missing schema version");
      }
      if (manifest.manifest_schema_version > SUPPORTED_MANIFEST_VERSION2) {
        throw new Error(
          `Manifest version ${manifest.manifest_schema_version} not supported.`
        );
      }
      if (manifest.dataset_schema_version !== void 0 && manifest.dataset_schema_version > SUPPORTED_DATASET_VERSION2) {
        throw new Error(
          `Dataset version ${manifest.dataset_schema_version} not supported.`
        );
      }
      if (manifest.aggregates_schema_version !== void 0 && manifest.aggregates_schema_version > SUPPORTED_AGGREGATES_VERSION2) {
        throw new Error(
          `Aggregates version ${manifest.aggregates_schema_version} not supported.`
        );
      }
    }
    async loadDimensions() {
      if (this.dimensions) return this.dimensions;
      this.dimensions = await this.artifactClient.getArtifactFileViaSdk(
        this.buildId,
        this.artifactName,
        "aggregates/dimensions.json"
      );
      if (!this.dimensions) {
        throw new Error("Dimensions file is empty or invalid");
      }
      return this.dimensions;
    }
    async getWeeklyRollups(startDate, endDate) {
      if (!this.manifest) throw new Error("Manifest not loaded.");
      const neededWeeks = this.getWeeksInRange(startDate, endDate);
      const results = [];
      for (const weekStr of neededWeeks) {
        const cachedRollup = this.rollupCache.get(weekStr);
        if (cachedRollup) {
          results.push(cachedRollup);
          continue;
        }
        const indexEntry = this.manifest?.aggregate_index?.weekly_rollups?.find(
          (r) => r.week === weekStr
        );
        if (!indexEntry) continue;
        try {
          const rollup = await this.artifactClient.getArtifactFileViaSdk(
            this.buildId,
            this.artifactName,
            indexEntry.path
          );
          this.rollupCache.set(weekStr, rollup);
          results.push(rollup);
        } catch (e) {
          console.warn("Failed to load rollup for %s:", weekStr, e);
        }
      }
      return results;
    }
    async getDistributions(startDate, endDate) {
      if (!this.manifest) throw new Error("Manifest not loaded.");
      const startYear = startDate.getFullYear();
      const endYear = endDate.getFullYear();
      const results = [];
      for (let year = startYear; year <= endYear; year++) {
        const yearStr = String(year);
        const cachedDistribution = this.distributionCache.get(yearStr);
        if (cachedDistribution) {
          results.push(cachedDistribution);
          continue;
        }
        const indexEntry = this.manifest?.aggregate_index?.distributions?.find(
          (d) => d.year === yearStr
        );
        if (!indexEntry) continue;
        try {
          const dist = await this.artifactClient.getArtifactFileViaSdk(
            this.buildId,
            this.artifactName,
            indexEntry.path
          );
          this.distributionCache.set(yearStr, dist);
          results.push(dist);
        } catch (e) {
          console.warn("Failed to load distribution for %s:", yearStr, e);
        }
      }
      return results;
    }
    getWeeksInRange(startDate, endDate) {
      const weeks = [];
      const current = new Date(startDate);
      const day = current.getDay();
      const diff = current.getDate() - day + (day === 0 ? -6 : 1);
      current.setDate(diff);
      while (current <= endDate) {
        weeks.push(this.getISOWeek(current));
        current.setDate(current.getDate() + 7);
      }
      return weeks;
    }
    getISOWeek(date) {
      const d = new Date(
        Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
      );
      d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(
        ((d.getTime() - yearStart.getTime()) / 864e5 + 1) / 7
      );
      return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
    }
    getCoverage() {
      return this.manifest?.coverage || null;
    }
    getDefaultRangeDays() {
      return this.manifest?.defaults?.default_date_range_days || 90;
    }
    async loadPredictions() {
      try {
        const indexEntry = this.manifest?.aggregate_index?.predictions;
        if (!indexEntry) return { state: "unavailable" };
        const data = await this.artifactClient.getArtifactFileViaSdk(
          this.buildId,
          this.artifactName,
          indexEntry.path
        );
        return { state: "ok", data };
      } catch (e) {
        console.warn("Failed to load predictions:", e);
        return { state: "unavailable" };
      }
    }
    async loadInsights() {
      try {
        const indexEntry = this.manifest?.aggregate_index?.ai_insights;
        if (!indexEntry) return { state: "unavailable" };
        const data = await this.artifactClient.getArtifactFileViaSdk(
          this.buildId,
          this.artifactName,
          indexEntry.path
        );
        return { state: "ok", data };
      } catch (e) {
        console.warn("Failed to load AI insights:", e);
        return { state: "unavailable" };
      }
    }
  };
  var MockArtifactClient = class {
    constructor(mockData = {}) {
      this.projectId = "mock-project";
      this.initialized = true;
      this.mockData = mockData;
    }
    async initialize() {
      return this;
    }
    async getArtifactFile(buildId, artifactName, filePath) {
      const key = `${buildId}/${artifactName}/${filePath}`;
      if (this.mockData[key]) {
        return JSON.parse(JSON.stringify(this.mockData[key]));
      }
      throw new Error(`Mock: File not found: ${key}`);
    }
    async hasArtifactFile(buildId, artifactName, filePath) {
      const key = `${buildId}/${artifactName}/${filePath}`;
      return !!this.mockData[key];
    }
    async getArtifacts(buildId) {
      return this.mockData[`${buildId}/artifacts`] ?? [];
    }
    async getDefinitions() {
      return this.mockData["definitions"] ?? [];
    }
    async getBuilds(definitionId) {
      return this.mockData[`builds/${definitionId}`] ?? [];
    }
    createDatasetLoader(buildId, artifactName) {
      return new AuthenticatedDatasetLoader(
        this,
        buildId,
        artifactName
      );
    }
  };
  if (typeof window !== "undefined") {
    window.ArtifactClient = ArtifactClient;
    window.AuthenticatedDatasetLoader = AuthenticatedDatasetLoader;
    window.MockArtifactClient = MockArtifactClient;
  }

  // ../ui/modules/shared/format.ts
  function formatDuration(minutes) {
    if (minutes < 60) {
      return `${Math.round(minutes)}m`;
    }
    const hours = minutes / 60;
    if (hours < 24) {
      return `${hours.toFixed(1)}h`;
    }
    const days = hours / 24;
    return `${days.toFixed(1)}d`;
  }
  function median(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? (
      // eslint-disable-next-line security/detect-object-injection -- SECURITY: mid is computed from array length, always valid index
      sorted[mid] ?? 0
    ) : (
      // eslint-disable-next-line security/detect-object-injection -- SECURITY: mid/mid-1 are computed from array length, always valid indices
      ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    );
  }

  // ../ui/modules/shared/security.ts
  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  // ../ui/modules/shared/render.ts
  var NO_DATA_HINTS = {
    WIDEN_FILTERS: "Try widening the date range or adjusting repository/team filters.",
    TREND_MINIMUM: "At least 2 weeks of data are needed to show trends.",
    REVIEWER_NO_ACTIVITY: "No reviewers were active in the selected period.",
    REVIEWER_PIPELINE: "Reviewer data requires the extraction pipeline to capture reviewer details."
  };
  function clearElement(el) {
    if (!el) return;
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }
  function createElement(tag, attributes, textContent) {
    const el = document.createElement(tag);
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        el.setAttribute(key, value);
      }
    }
    if (textContent !== void 0) {
      el.textContent = textContent;
    }
    return el;
  }
  function renderNoData(container, message, hint) {
    if (!container) return;
    clearElement(container);
    const p = createElement("p", { class: "no-data" }, message);
    container.appendChild(p);
    if (hint) {
      const hintEl = createElement("p", { class: "no-data-hint" }, hint);
      container.appendChild(hintEl);
    }
  }
  function renderTrustedHtml(container, trustedHtml) {
    if (!container) return;
    container.innerHTML = trustedHtml;
  }
  function appendTrustedHtml(container, trustedHtml) {
    if (!container) return;
    const temp = document.createElement("div");
    temp.innerHTML = trustedHtml;
    while (temp.firstChild) {
      container.appendChild(temp.firstChild);
    }
  }
  function createOption(value, text, selected = false) {
    const option = createElement("option", { value }, text);
    if (selected) {
      option.selected = true;
    }
    return option;
  }

  // ../ui/modules/metrics.ts
  var HAS_WINDOW = typeof window !== "undefined";
  var IS_PRODUCTION = typeof process !== "undefined" && false;
  var SHOULD_WARN_ON_COERCION = !IS_PRODUCTION && HAS_WINDOW && window.__DASHBOARD_DEBUG__ === true;
  var hasWarnedOnMetricCoercion = false;
  function toFiniteNumber(value) {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n;
    }
    if (SHOULD_WARN_ON_COERCION && !hasWarnedOnMetricCoercion) {
      hasWarnedOnMetricCoercion = true;
      console.warn(
        "metrics.ts coerced a non-finite metric value to 0; verify upstream rollup data if this is unexpected.",
        value
      );
    }
    return 0;
  }
  function getOwnPropertyValue(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : void 0;
  }
  function calculateMetrics(rollups) {
    if (!rollups || !rollups.length) {
      return {
        totalPrs: 0,
        cycleP50: null,
        cycleP90: null,
        avgAuthors: 0,
        avgReviewers: 0
      };
    }
    const totalPrs = rollups.reduce((sum, r) => sum + (r.pr_count || 0), 0);
    const p50Values = rollups.map((r) => r.cycle_time_p50).filter((v) => v !== null && v !== void 0);
    const p90Values = rollups.map((r) => r.cycle_time_p90).filter((v) => v !== null && v !== void 0);
    const authorsSum = rollups.reduce(
      (sum, r) => sum + (r.authors_count || 0),
      0
    );
    const reviewersSum = rollups.reduce(
      (sum, r) => sum + (r.reviewers_count || 0),
      0
    );
    return {
      totalPrs,
      cycleP50: p50Values.length ? median(p50Values) : null,
      cycleP90: p90Values.length ? median(p90Values) : null,
      avgAuthors: rollups.length > 0 ? Math.round(authorsSum / rollups.length) : 0,
      avgReviewers: rollups.length > 0 ? Math.round(reviewersSum / rollups.length) : 0
    };
  }
  function calculatePercentChange(current, previous) {
    if (previous === null || previous === void 0 || previous === 0) {
      return null;
    }
    if (current === null || current === void 0) {
      return null;
    }
    return (current - previous) / previous * 100;
  }
  function getPreviousPeriod(start, end) {
    const MS_PER_DAY = 1e3 * 60 * 60 * 24;
    const rangeDays = Math.ceil((end.getTime() - start.getTime()) / MS_PER_DAY);
    const prevEnd = new Date(start.getTime() - MS_PER_DAY);
    const prevStart = new Date(prevEnd.getTime() - rangeDays * MS_PER_DAY);
    return { start: prevStart, end: prevEnd };
  }
  function aggregateEntries(entries) {
    const totalPrCount = entries.reduce(
      (sum, entry) => sum + toFiniteNumber(entry.pr_count),
      0
    );
    const totalAuthors = entries.reduce(
      (sum, entry) => sum + toFiniteNumber(entry.authors_count),
      0
    );
    const totalReviewers = entries.reduce(
      (sum, entry) => sum + toFiniteNumber(entry.reviewers_count),
      0
    );
    const p50Entries = entries.filter(
      (e) => typeof e.cycle_time_p50 === "number" && Number.isFinite(e.cycle_time_p50)
    );
    const p90Entries = entries.filter(
      (e) => typeof e.cycle_time_p90 === "number" && Number.isFinite(e.cycle_time_p90)
    );
    let cycleP50 = null;
    let cycleP90 = null;
    if (p50Entries.length > 0) {
      const p50PrCount = p50Entries.reduce(
        (sum, e) => sum + toFiniteNumber(e.pr_count),
        0
      );
      if (p50PrCount > 0) {
        cycleP50 = p50Entries.reduce(
          (sum, e) => sum + toFiniteNumber(e.cycle_time_p50) * toFiniteNumber(e.pr_count),
          0
        ) / p50PrCount;
      }
    }
    if (p90Entries.length > 0) {
      const p90PrCount = p90Entries.reduce(
        (sum, e) => sum + toFiniteNumber(e.pr_count),
        0
      );
      if (p90PrCount > 0) {
        cycleP90 = p90Entries.reduce(
          (sum, e) => sum + toFiniteNumber(e.cycle_time_p90) * toFiniteNumber(e.pr_count),
          0
        ) / p90PrCount;
      }
    }
    return {
      pr_count: totalPrCount,
      cycle_time_p50: cycleP50,
      cycle_time_p90: cycleP90,
      authors_count: totalAuthors,
      reviewers_count: totalReviewers
    };
  }
  function resolveBreakdownEntries(breakdown, keys) {
    return keys.map((key) => {
      const direct = getOwnPropertyValue(breakdown, key);
      if (direct) return direct;
      return Object.entries(breakdown).find(([name]) => name === key)?.[1];
    }).filter(
      (entry) => entry !== void 0 && typeof entry?.pr_count === "number"
    );
  }
  function resolveReviewerEntries(breakdown, keys) {
    return keys.map((key) => {
      const direct = getOwnPropertyValue(breakdown, key);
      if (direct) return direct;
      return Object.entries(breakdown).find(([name]) => name === key)?.[1];
    }).filter(
      (entry) => entry !== void 0 && typeof entry?.reviewed_prs === "number"
    );
  }
  function aggregateReviewerEntries(entries) {
    const reviewedPrs = entries.reduce(
      (sum, entry) => sum + toFiniteNumber(entry.reviewed_prs),
      0
    );
    const reviewsCount = entries.reduce(
      (sum, entry) => sum + toFiniteNumber(entry.reviews_count),
      0
    );
    const authorsCount = entries.reduce(
      (sum, entry) => sum + toFiniteNumber(entry.authors_count),
      0
    );
    const repositoriesCount = entries.reduce(
      (sum, entry) => sum + toFiniteNumber(entry.repositories_count),
      0
    );
    const approvalEntries = entries.filter(
      (e) => typeof e.approval_rate === "number" && Number.isFinite(e.approval_rate)
    );
    const approvalDenominator = approvalEntries.reduce(
      (sum, entry) => sum + toFiniteNumber(entry.reviewed_prs),
      0
    );
    const approvalWeightedSum = approvalEntries.reduce(
      (sum, entry) => sum + toFiniteNumber(entry.approval_rate) * toFiniteNumber(entry.reviewed_prs),
      0
    );
    return {
      reviewed_prs: reviewedPrs,
      reviews_count: reviewsCount,
      approval_rate: approvalDenominator > 0 ? approvalWeightedSum / approvalDenominator : null,
      authors_count: authorsCount,
      repositories_count: repositoriesCount
    };
  }
  var ZEROED_ROLLUP_FIELDS = {
    pr_count: 0,
    cycle_time_p50: null,
    cycle_time_p90: null,
    review_time_p50: null,
    review_time_p90: null,
    authors_count: 0,
    reviewers_count: 0
  };
  function buildFilteredRollup(rollup, slice) {
    if (slice.pr_count === 0) {
      return { ...rollup, ...ZEROED_ROLLUP_FIELDS };
    }
    return {
      ...rollup,
      pr_count: slice.pr_count,
      // Always override to prevent global values leaking through the
      // ...rollup spread when the slice legitimately has null/0 values.
      cycle_time_p50: slice.cycle_time_p50,
      cycle_time_p90: slice.cycle_time_p90,
      authors_count: slice.authors_count,
      reviewers_count: slice.reviewers_count
    };
  }
  function applyFiltersToRollups(rollups, filters) {
    const firstAuthor = filters.authors?.[0];
    const authorFilters = firstAuthor ? [firstAuthor] : [];
    const firstReviewer = filters.reviewers?.[0];
    const reviewerFilters = firstReviewer ? [firstReviewer] : [];
    if (!filters.repos.length && !filters.teams.length && !reviewerFilters.length && !authorFilters.length) {
      return rollups;
    }
    return rollups.map((rollup) => {
      const repoBreakdown = filters.repos.length > 0 && rollup.by_repository && typeof rollup.by_repository === "object" ? rollup.by_repository : null;
      const teamBreakdown = filters.teams.length > 0 && rollup.by_team && typeof rollup.by_team === "object" ? rollup.by_team : null;
      const authorBreakdown = authorFilters.length > 0 && rollup.by_author && typeof rollup.by_author === "object" ? rollup.by_author : null;
      const reviewerBreakdown = reviewerFilters.length > 0 && rollup.by_reviewer && typeof rollup.by_reviewer === "object" ? rollup.by_reviewer : null;
      if (reviewerFilters.length > 0 && !reviewerBreakdown) {
        return { ...rollup, ...ZEROED_ROLLUP_FIELDS };
      }
      if (authorFilters.length > 0 && !authorBreakdown) {
        return { ...rollup, ...ZEROED_ROLLUP_FIELDS };
      }
      let repoSlice = null;
      if (repoBreakdown) {
        const entries = resolveBreakdownEntries(repoBreakdown, filters.repos);
        if (entries.length === 0) {
          return { ...rollup, ...ZEROED_ROLLUP_FIELDS };
        }
        repoSlice = aggregateEntries(entries);
      }
      let teamSlice = null;
      if (teamBreakdown) {
        const entries = resolveBreakdownEntries(teamBreakdown, filters.teams);
        if (entries.length === 0) {
          return { ...rollup, ...ZEROED_ROLLUP_FIELDS };
        }
        teamSlice = aggregateEntries(entries);
      }
      let authorSlice = null;
      if (authorBreakdown) {
        const entries = resolveBreakdownEntries(authorBreakdown, authorFilters);
        if (entries.length === 0) {
          return { ...rollup, ...ZEROED_ROLLUP_FIELDS };
        }
        authorSlice = aggregateEntries(entries);
      }
      let reviewerSlice = null;
      if (reviewerBreakdown) {
        const entries = resolveReviewerEntries(
          reviewerBreakdown,
          reviewerFilters
        );
        if (entries.length === 0) {
          return { ...rollup, ...ZEROED_ROLLUP_FIELDS };
        }
        reviewerSlice = aggregateReviewerEntries(entries);
      }
      if (reviewerSlice) {
        if (repoSlice || teamSlice) {
          console.warn(
            "Combined reviewer filtering with repository/team filters is not supported; using reviewer-only filtering"
          );
        }
        return buildFilteredRollup(rollup, {
          pr_count: reviewerSlice.reviewed_prs,
          cycle_time_p50: null,
          cycle_time_p90: null,
          authors_count: reviewerSlice.authors_count,
          // Reuse reviewers_count for review-activity UI surfaces.
          reviewers_count: reviewerSlice.reviews_count
        });
      }
      if (authorSlice && repoSlice && rollup.by_author_and_repo) {
        let cdPr = 0, cdAuthors = 0, cdReviewers = 0;
        let cdP50WSum = 0, cdP50WPr = 0, cdP90WSum = 0, cdP90WPr = 0;
        let cdFound = 0;
        for (const authorId of authorFilters) {
          const authorRepos = getOwnPropertyValue(
            rollup.by_author_and_repo,
            authorId
          );
          if (!authorRepos) continue;
          for (const repo of filters.repos) {
            const e = getOwnPropertyValue(authorRepos, repo);
            if (!e) continue;
            cdFound++;
            const pr = toFiniteNumber(e.pr_count);
            cdPr += pr;
            cdAuthors += toFiniteNumber(e.authors_count);
            cdReviewers += toFiniteNumber(e.reviewers_count);
            const p50 = e.cycle_time_p50;
            if (typeof p50 === "number" && Number.isFinite(p50)) {
              cdP50WSum += p50 * pr;
              cdP50WPr += pr;
            }
            const p90 = e.cycle_time_p90;
            if (typeof p90 === "number" && Number.isFinite(p90)) {
              cdP90WSum += p90 * pr;
              cdP90WPr += pr;
            }
          }
        }
        if (cdFound > 0) {
          const isTruncated = rollup.by_author_and_repo["_truncated"] === true;
          const expectedCount = authorFilters.length * filters.repos.length;
          if (isTruncated && cdFound < expectedCount) {
            console.warn(
              `Author x repo data truncated for week ${rollup.week}: found ${cdFound}/${expectedCount} entries, using proportional estimation`
            );
          } else {
            if (teamSlice) {
              console.warn(
                "Combined author and team filtering is constrained; using author+repository metrics while retaining team UI state"
              );
            }
            return buildFilteredRollup(rollup, {
              pr_count: cdPr,
              cycle_time_p50: cdP50WPr > 0 ? cdP50WSum / cdP50WPr : null,
              cycle_time_p90: cdP90WPr > 0 ? cdP90WSum / cdP90WPr : null,
              authors_count: cdAuthors,
              reviewers_count: cdReviewers
            });
          }
        } else if (rollup.by_author_and_repo["_truncated"] !== true) {
          return { ...rollup, ...ZEROED_ROLLUP_FIELDS };
        }
      }
      if (authorSlice && repoSlice) {
        const total = rollup.pr_count || 1;
        const authorShare = Math.min(1, authorSlice.pr_count / total);
        const repoShare = Math.min(1, repoSlice.pr_count / total);
        const combinedRatio = authorShare * repoShare;
        const combinedPrCount = Math.round(rollup.pr_count * combinedRatio);
        if (combinedPrCount === 0) {
          return { ...rollup, ...ZEROED_ROLLUP_FIELDS };
        }
        const combinedAuthors = Math.round(
          (rollup.authors_count || 0) * combinedRatio
        );
        const combinedReviewers = Math.round(
          (rollup.reviewers_count || 0) * combinedRatio
        );
        const p50s = [
          authorSlice.cycle_time_p50,
          repoSlice.cycle_time_p50
        ].filter((v) => v !== null);
        const p90s = [
          authorSlice.cycle_time_p90,
          repoSlice.cycle_time_p90
        ].filter((v) => v !== null);
        if (teamSlice) {
          console.warn(
            "Combined author and team filtering is constrained; using author+repository metrics while retaining team UI state"
          );
        }
        return {
          ...rollup,
          pr_count: combinedPrCount,
          cycle_time_p50: p50s.length > 0 ? p50s.reduce((a, b) => a + b, 0) / p50s.length : null,
          cycle_time_p90: p90s.length > 0 ? p90s.reduce((a, b) => a + b, 0) / p90s.length : null,
          authors_count: combinedAuthors,
          reviewers_count: combinedReviewers
        };
      }
      if (authorSlice) {
        if (teamSlice) {
          console.warn(
            "Combined author and team filtering is constrained; using author-only metrics while retaining team UI state"
          );
        }
        return buildFilteredRollup(rollup, authorSlice);
      }
      if (repoSlice && teamSlice && rollup.by_team_and_repo) {
        let cdPr = 0, cdAuthors = 0, cdReviewers = 0;
        let cdP50WSum = 0, cdP50WPr = 0, cdP90WSum = 0, cdP90WPr = 0;
        let cdFound = 0;
        for (const team of filters.teams) {
          const teamRepos = getOwnPropertyValue(rollup.by_team_and_repo, team);
          if (!teamRepos) continue;
          for (const repo of filters.repos) {
            const e = getOwnPropertyValue(teamRepos, repo);
            if (!e) continue;
            cdFound++;
            const pr = toFiniteNumber(e.pr_count);
            cdPr += pr;
            cdAuthors += toFiniteNumber(e.authors_count);
            cdReviewers += toFiniteNumber(e.reviewers_count);
            const p50 = e.cycle_time_p50;
            if (typeof p50 === "number" && Number.isFinite(p50)) {
              cdP50WSum += p50 * pr;
              cdP50WPr += pr;
            }
            const p90 = e.cycle_time_p90;
            if (typeof p90 === "number" && Number.isFinite(p90)) {
              cdP90WSum += p90 * pr;
              cdP90WPr += pr;
            }
          }
        }
        if (cdFound > 0) {
          const isTruncated = rollup.by_team_and_repo["_truncated"] === true;
          const expectedCount = filters.teams.length * filters.repos.length;
          if (isTruncated && cdFound < expectedCount) {
            console.warn(
              `Cross-dim data truncated for week ${rollup.week}: found ${cdFound}/${expectedCount} entries, using proportional estimation`
            );
          } else {
            return buildFilteredRollup(rollup, {
              pr_count: cdPr,
              cycle_time_p50: cdP50WPr > 0 ? cdP50WSum / cdP50WPr : null,
              cycle_time_p90: cdP90WPr > 0 ? cdP90WSum / cdP90WPr : null,
              authors_count: cdAuthors,
              reviewers_count: cdReviewers
            });
          }
        } else if (rollup.by_team_and_repo["_truncated"] !== true) {
          return { ...rollup, ...ZEROED_ROLLUP_FIELDS };
        }
      }
      if (repoSlice && teamSlice) {
        const total = rollup.pr_count || 1;
        const repoShare = Math.min(1, repoSlice.pr_count / total);
        const teamShare = Math.min(1, teamSlice.pr_count / total);
        const combinedRatio = repoShare * teamShare;
        const combinedPrCount = Math.round(rollup.pr_count * combinedRatio);
        if (combinedPrCount === 0) {
          return { ...rollup, ...ZEROED_ROLLUP_FIELDS };
        }
        const combinedAuthors = Math.round(
          (rollup.authors_count || 0) * combinedRatio
        );
        const combinedReviewers = Math.round(
          (rollup.reviewers_count || 0) * combinedRatio
        );
        const p50s = [repoSlice.cycle_time_p50, teamSlice.cycle_time_p50].filter(
          (v) => v !== null
        );
        const p90s = [repoSlice.cycle_time_p90, teamSlice.cycle_time_p90].filter(
          (v) => v !== null
        );
        return {
          ...rollup,
          pr_count: combinedPrCount,
          // Always override to prevent global values leaking through the
          // ...rollup spread when proportional estimates are null/0.
          cycle_time_p50: p50s.length > 0 ? p50s.reduce((a, b) => a + b, 0) / p50s.length : null,
          cycle_time_p90: p90s.length > 0 ? p90s.reduce((a, b) => a + b, 0) / p90s.length : null,
          authors_count: combinedAuthors,
          reviewers_count: combinedReviewers
        };
      }
      if (repoSlice && !teamSlice) {
        return buildFilteredRollup(rollup, repoSlice);
      }
      if (teamSlice && !repoSlice) {
        return buildFilteredRollup(rollup, teamSlice);
      }
      return rollup;
    });
  }
  function extractSparklineData(rollups) {
    return {
      prCounts: rollups.map((r) => r.pr_count ?? 0),
      p50s: rollups.map((r) => r.cycle_time_p50 ?? null),
      p90s: rollups.map((r) => r.cycle_time_p90 ?? null),
      authors: rollups.map((r) => r.authors_count ?? 0),
      reviewers: rollups.map((r) => r.reviewers_count ?? 0)
    };
  }
  function calculateMovingAverage(values, window2 = 4) {
    return values.map((_, i) => {
      if (i < window2 - 1) return null;
      const slice = values.slice(i - window2 + 1, i + 1);
      const sum = slice.reduce((a, b) => a + b, 0);
      return sum / window2;
    });
  }

  // ../ui/modules/errors.ts
  var PANEL_IDS = [
    "setup-required",
    "multiple-pipelines",
    "artifacts-missing",
    "permission-denied",
    "error-state",
    "loading-state",
    "main-content"
  ];
  function handleError(error) {
    hideAllPanels();
    if (error instanceof PrInsightsError) {
      switch (error.type) {
        case ErrorTypes.SETUP_REQUIRED:
          showSetupRequired(error);
          break;
        case ErrorTypes.MULTIPLE_PIPELINES:
          showMultiplePipelines(error);
          break;
        case ErrorTypes.ARTIFACTS_MISSING:
          showArtifactsMissing(error);
          break;
        case ErrorTypes.PERMISSION_DENIED:
          showPermissionDenied(error);
          break;
        default:
          showGenericError(error.title, error.message);
          break;
      }
    } else {
      showGenericError(
        "Error",
        getErrorMessage(error) || "An unexpected error occurred"
      );
    }
  }
  function hideAllPanels() {
    PANEL_IDS.forEach((id) => {
      document.getElementById(id)?.classList.add("hidden");
    });
  }
  function showSetupRequired(error) {
    const panel = document.getElementById("setup-required");
    if (!panel) return showGenericError(error.title, error.message);
    const messageEl = document.getElementById("setup-message");
    if (messageEl) messageEl.textContent = error.message;
    const details = error.details;
    if (details?.instructions && Array.isArray(details.instructions)) {
      const stepsList = document.getElementById("setup-steps");
      if (stepsList) {
        clearElement(stepsList);
        details.instructions.forEach((s) => {
          const li = createElement("li", {}, s);
          stepsList.appendChild(li);
        });
      }
    }
    if (details?.docsUrl) {
      const docsLink = document.getElementById(
        "docs-link"
      );
      if (docsLink) docsLink.href = String(details.docsUrl);
    }
    panel.classList.remove("hidden");
  }
  function showMultiplePipelines(error) {
    const panel = document.getElementById("multiple-pipelines");
    if (!panel) return showGenericError(error.title, error.message);
    const messageEl = document.getElementById("multiple-message");
    if (messageEl) messageEl.textContent = error.message;
    const listEl = document.getElementById("pipeline-list");
    const details = error.details;
    if (listEl && details?.matches && Array.isArray(details.matches)) {
      const html = details.matches.map(
        (m) => `
                <a href="?pipelineId=${escapeHtml(String(m.id))}" class="pipeline-option">
                    <strong>${escapeHtml(m.name)}</strong>
                    <span class="pipeline-id">ID: ${escapeHtml(String(m.id))}</span>
                </a>
            `
      ).join("");
      renderTrustedHtml(listEl, html);
    }
    panel.classList.remove("hidden");
  }
  function showPermissionDenied(error) {
    const panel = document.getElementById("permission-denied");
    if (!panel) return showGenericError(error.title, error.message);
    const messageEl = document.getElementById("permission-message");
    if (messageEl) messageEl.textContent = error.message;
    panel.classList.remove("hidden");
  }
  function showGenericError(title, message) {
    const panel = document.getElementById("error-state");
    if (!panel) return;
    const titleEl = document.getElementById("error-title");
    const messageEl = document.getElementById("error-message");
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    panel.classList.remove("hidden");
  }
  function showArtifactsMissing(error) {
    const panel = document.getElementById("artifacts-missing");
    if (!panel) return showGenericError(error.title, error.message);
    const messageEl = document.getElementById("missing-message");
    if (messageEl) messageEl.textContent = error.message;
    const details = error.details;
    if (details?.instructions && Array.isArray(details.instructions)) {
      const stepsList = document.getElementById("missing-steps");
      if (stepsList) {
        clearElement(stepsList);
        details.instructions.forEach((s) => {
          const li = createElement("li", {}, s);
          stepsList.appendChild(li);
        });
      }
    }
    panel.classList.remove("hidden");
  }

  // ../ui/modules/charts/predictions.ts
  var MAX_CHART_POINTS = 200;
  var FORECASTER_LABELS = {
    linear: "Linear Forecast",
    prophet: "Prophet Forecast"
  };
  var DATA_QUALITY_MESSAGES = {
    normal: { label: "High Confidence", cssClass: "quality-normal" },
    low_confidence: {
      label: "Low Confidence - More data recommended",
      cssClass: "quality-low"
    },
    insufficient: {
      label: "Insufficient Data",
      cssClass: "quality-insufficient"
    }
  };
  function renderForecasterIndicator(forecaster) {
    const label = FORECASTER_LABELS[forecaster || "linear"] || "Forecast";
    const cssClass = forecaster === "prophet" ? "forecaster-prophet" : "forecaster-linear";
    return `<span class="forecaster-badge ${cssClass}">${escapeHtml(label)}</span>`;
  }
  function renderDataQualityBanner(dataQuality) {
    if (!dataQuality || dataQuality === "normal") return "";
    const quality = DATA_QUALITY_MESSAGES[dataQuality];
    if (!quality) return "";
    return `
    <div class="data-quality-banner ${quality.cssClass}">
      <span class="quality-icon">&#x26A0;</span>
      <span class="quality-label">${escapeHtml(quality.label)}</span>
    </div>
  `;
  }
  function sanitizeForId(str) {
    return str.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  }
  function calculateLinePath(values) {
    if (values.length === 0) return "";
    return values.map(
      (pt, i) => `${i === 0 ? "M" : "L"} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`
    ).join(" ");
  }
  function calculateBandPath(upperValues, lowerValues) {
    if (upperValues.length === 0 || lowerValues.length === 0) return "";
    const upperPath = upperValues.map(
      (pt, i) => `${i === 0 ? "M" : "L"} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`
    ).join(" ");
    const lowerReversed = [...lowerValues].reverse();
    const lowerPath = lowerReversed.map((pt) => `L ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`).join(" ");
    return `${upperPath} ${lowerPath} Z`;
  }
  function renderForecastChart(forecast, historicalData, chartHeight = 200) {
    const rawValues = forecast.values;
    if (!rawValues || rawValues.length === 0) {
      return `<div class="forecast-chart-empty">No forecast data available</div>`;
    }
    const values = [...rawValues].sort(
      (a, b) => a.period_start.localeCompare(b.period_start)
    );
    const allValues = [];
    if (historicalData) {
      historicalData.forEach((h) => allValues.push(h.value));
    }
    values.forEach((v) => {
      allValues.push(v.predicted);
      if (v.lower_bound != null) allValues.push(v.lower_bound);
      if (v.upper_bound != null) allValues.push(v.upper_bound);
    });
    const maxValue = Math.max(...allValues, 1);
    const minValue = Math.min(...allValues, 0);
    const range = maxValue - minValue || 1;
    const padding = 10;
    const effectiveHeight = chartHeight - padding * 2;
    const getY = (val) => {
      const normalized = (val - minValue) / range;
      return padding + (1 - normalized) * effectiveHeight;
    };
    const forecastPoints = [];
    const upperPoints = [];
    const lowerPoints = [];
    const historicalCount = historicalData?.length || 0;
    const totalPoints = historicalCount + values.length;
    const getX = (index) => {
      return (index + 0.5) / totalPoints * 100;
    };
    values.forEach((v, i) => {
      const x = getX(historicalCount + i);
      forecastPoints.push({ x, y: getY(v.predicted) });
      if (v.upper_bound != null) upperPoints.push({ x, y: getY(v.upper_bound) });
      if (v.lower_bound != null) lowerPoints.push({ x, y: getY(v.lower_bound) });
    });
    const historicalPoints = [];
    if (historicalData) {
      historicalData.forEach((h, i) => {
        historicalPoints.push({ x: getX(i), y: getY(h.value) });
      });
    }
    const historicalPath = calculateLinePath(historicalPoints);
    const forecastPath = calculateLinePath(forecastPoints);
    const bandPath = calculateBandPath(upperPoints, lowerPoints);
    const metricLabel = forecast.metric.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const allWeeks = [];
    if (historicalData) {
      historicalData.forEach((h) => allWeeks.push(h.week));
    }
    values.forEach((v) => allWeeks.push(v.period_start));
    const labelStep = Math.ceil(allWeeks.length / 6);
    const xAxisLabels = allWeeks.filter((_, i) => i % labelStep === 0).map((week, i) => {
      const x = getX(i * labelStep);
      const formatted = formatWeekLabel(week);
      return `<text x="${x}%" y="${chartHeight - 2}" class="axis-label">${escapeHtml(formatted)}</text>`;
    }).join("");
    const latestValue = values[values.length - 1];
    const accessibleSummary = latestValue ? `${metricLabel} forecast: ${latestValue.predicted.toFixed(1)} ${forecast.unit}${latestValue.lower_bound != null && latestValue.upper_bound != null ? ` (range ${latestValue.lower_bound.toFixed(1)} to ${latestValue.upper_bound.toFixed(1)})` : ""}` : `${metricLabel} forecast chart`;
    const safeMetricId = sanitizeForId(forecast.metric);
    return `
    <div class="forecast-chart" role="region" aria-label="${escapeHtml(metricLabel)} forecast">
      <div class="chart-header">
        <h4 id="chart-${safeMetricId}">${escapeHtml(metricLabel)}</h4>
        <span class="chart-unit">(${escapeHtml(forecast.unit)})</span>
      </div>
      <div class="chart-svg-container">
        <svg viewBox="0 0 100 ${chartHeight}" preserveAspectRatio="none" class="forecast-svg"
             role="img" aria-labelledby="chart-${safeMetricId}"
             aria-describedby="chart-desc-${safeMetricId}">
          <desc id="chart-desc-${safeMetricId}">${escapeHtml(accessibleSummary)}</desc>
          <!-- Confidence band fill -->
          ${bandPath ? `<path class="confidence-band" d="${bandPath}" />` : ""}
          <!-- Historical data line (solid) -->
          ${historicalPath ? `<path class="historical-line" d="${historicalPath}" vector-effect="non-scaling-stroke" />` : ""}
          <!-- Forecast line (dashed) -->
          ${forecastPath ? `<path class="forecast-line" d="${forecastPath}" vector-effect="non-scaling-stroke" />` : ""}
        </svg>
        <svg viewBox="0 0 100 ${chartHeight}" preserveAspectRatio="xMidYMax meet" class="axis-svg" aria-hidden="true">
          ${xAxisLabels}
        </svg>
      </div>
      <div class="chart-legend" role="list" aria-label="Chart legend">
        <div class="legend-item" role="listitem">
          <span class="legend-line historical" aria-hidden="true"></span>
          <span>Historical</span>
        </div>
        <div class="legend-item" role="listitem">
          <span class="legend-line forecast" aria-hidden="true"></span>
          <span>Forecast</span>
        </div>
        <div class="legend-item" role="listitem">
          <span class="legend-band" aria-hidden="true"></span>
          <span>Confidence</span>
        </div>
      </div>
    </div>
  `;
  }
  function formatWeekLabel(weekStr) {
    try {
      const date = new Date(weekStr);
      if (isNaN(date.getTime())) return weekStr;
      const month = date.toLocaleString("en-US", { month: "short" });
      const day = date.getDate();
      return `${month} ${day}`;
    } catch {
      return weekStr;
    }
  }
  function isoWeekToDate(isoWeek) {
    const match = isoWeek.match(/^(\d{4})-W(\d{2})$/);
    if (!match || !match[1] || !match[2]) return isoWeek;
    const year = parseInt(match[1], 10);
    const week = parseInt(match[2], 10);
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const firstMonday = new Date(jan4);
    firstMonday.setDate(jan4.getDate() - dayOfWeek + 1);
    const targetDate = new Date(firstMonday);
    targetDate.setDate(firstMonday.getDate() + (week - 1) * 7);
    const isoString = targetDate.toISOString().split("T")[0];
    return isoString || isoWeek;
  }
  function extractHistoricalDataResult(rollups, metric) {
    if (!rollups || rollups.length === 0) {
      return { data: [], wasTruncated: false };
    }
    const metricFieldMap = {
      pr_throughput: "pr_count",
      cycle_time_minutes: "cycle_time_p50"
    };
    const field = metricFieldMap[metric];
    if (!field) {
      return { data: [], wasTruncated: false };
    }
    const data = rollups.filter((r) => r[field] !== null && r[field] !== void 0).map((r) => ({
      // Convert ISO week format to date if needed
      week: r.week.includes("-W") ? isoWeekToDate(r.week) : r.week,
      // eslint-disable-next-line security/detect-object-injection -- SECURITY: field is from local const metricFieldMap, typed as keyof RollupForChart
      value: Number(r[field])
    })).sort((a, b) => a.week.localeCompare(b.week));
    const wasTruncated = data.length > MAX_CHART_POINTS;
    return {
      data: wasTruncated ? data.slice(-MAX_CHART_POINTS) : data,
      wasTruncated
    };
  }
  function renderPredictionsWithCharts(container, predictions, rollups) {
    if (!container) return;
    if (!predictions) return;
    const content = document.createElement("div");
    content.className = "predictions-charts-content";
    const headerHtml = `
    <div class="predictions-header">
      ${renderForecasterIndicator(predictions.forecaster)}
      ${renderDataQualityBanner(predictions.data_quality)}
    </div>
  `;
    appendTrustedHtml(content, headerHtml);
    if (predictions.is_stub) {
      appendTrustedHtml(
        content,
        `<div class="preview-banner">
        <span class="preview-icon">&#x26A0;</span>
        <div class="preview-text">
          <strong>PREVIEW - Demo Data</strong>
          <span>This is synthetic data for preview purposes only. Run the analytics pipeline to see real metrics.</span>
        </div>
      </div>`
      );
    }
    if (!predictions.forecasts || predictions.forecasts.length === 0) {
      appendTrustedHtml(
        content,
        `<div class="predictions-empty-message">
        <p>No forecast data available.</p>
        <p>Run the analytics pipeline with predictions enabled to generate forecasts.</p>
      </div>`
      );
      container.appendChild(content);
      return;
    }
    predictions.forecasts.forEach((forecast) => {
      const historicalResult = rollups ? extractHistoricalDataResult(rollups, forecast.metric) : void 0;
      const historicalData = historicalResult?.data;
      const wasTruncated = historicalResult?.wasTruncated === true;
      const chartHtml = renderForecastChart(forecast, historicalData);
      appendTrustedHtml(content, chartHtml);
      if (wasTruncated) {
        const badge = document.createElement("span");
        badge.className = "truncation-badge";
        badge.title = `Showing last ${MAX_CHART_POINTS} data points`;
        badge.textContent = "Partial history";
        const lastHeader = content.querySelector(
          ".forecast-chart:last-child .chart-header"
        );
        if (lastHeader) lastHeader.appendChild(badge);
      }
    });
    const hasReviewTime = predictions.forecasts.some(
      (f) => f.metric === "review_time_minutes"
    );
    if (!hasReviewTime && predictions.forecasts.length > 0) {
      appendTrustedHtml(
        content,
        `<div class="metric-unavailable">
        <span class="info-icon">&#x2139;</span>
        <span class="info-text">Review time forecasts require dedicated review duration data collection, which is not currently available.</span>
      </div>`
      );
    }
    const unavailable = container.querySelector(".feature-unavailable");
    if (unavailable) unavailable.classList.add("hidden");
    container.appendChild(content);
  }

  // ../ui/modules/ml/setup-guides.ts
  var yamlStore = /* @__PURE__ */ new Map();
  var delegatedContainers = /* @__PURE__ */ new WeakSet();
  var PREDICTIONS_YAML = `build-aggregates:
  run-predictions: true`;
  var INSIGHTS_YAML = `build-aggregates:
  run-insights: true
  openai-api-key: $(OPENAI_API_KEY)`;
  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  }
  function createCopyButton(yaml, buttonId) {
    yamlStore.set(buttonId, yaml);
    return `
    <button class="copy-yaml-btn" id="${buttonId}"
            type="button" aria-label="Copy YAML snippet to clipboard">
      <span class="copy-icon" aria-hidden="true">\u{1F4CB}</span>
      <span class="copy-text">Copy</span>
    </button>
  `;
  }
  function attachCopyHandlers(container) {
    if (delegatedContainers.has(container)) return;
    delegatedContainers.add(container);
    let liveRegion = document.getElementById("copy-status-live");
    if (!liveRegion) {
      liveRegion = document.createElement("div");
      liveRegion.id = "copy-status-live";
      liveRegion.setAttribute("role", "status");
      liveRegion.setAttribute("aria-live", "polite");
      liveRegion.className = "visually-hidden";
      document.body.appendChild(liveRegion);
    }
    container.addEventListener("click", async (e) => {
      const button = e.target.closest(
        ".copy-yaml-btn"
      );
      if (!button) return;
      const yaml = yamlStore.get(button.id) ?? button.dataset.yaml;
      if (!yaml) return;
      button.disabled = true;
      const copyText = button.querySelector(".copy-text");
      const originalText = copyText?.textContent || "Copy";
      try {
        await copyToClipboard(yaml);
        if (copyText) copyText.textContent = "Copied!";
        button.classList.add("copied");
        button.setAttribute("aria-label", "YAML snippet copied to clipboard");
        if (liveRegion)
          liveRegion.textContent = "YAML snippet copied to clipboard";
        setTimeout(() => {
          if (copyText) copyText.textContent = originalText;
          button.classList.remove("copied");
          button.disabled = false;
          button.setAttribute("aria-label", "Copy YAML snippet to clipboard");
        }, 2e3);
      } catch {
        if (copyText) copyText.textContent = "Failed";
        button.setAttribute("aria-label", "Failed to copy YAML snippet");
        if (liveRegion) liveRegion.textContent = "Failed to copy YAML snippet";
        setTimeout(() => {
          if (copyText) copyText.textContent = originalText;
          button.disabled = false;
          button.setAttribute("aria-label", "Copy YAML snippet to clipboard");
        }, 2e3);
      }
    });
  }
  function renderPredictionsSetupGuide() {
    return `
    <div class="setup-guide predictions-setup">
      <div class="setup-guide-header">
        <span class="setup-icon">\u{1F4C8}</span>
        <h4>Enable Predictions</h4>
      </div>
      <p class="setup-description">
        Add time-series forecasting to your pipeline.
        <strong>Zero-config</strong> - no API key required.
      </p>
      <div class="setup-steps">
        <div class="setup-step">
          <span class="step-number">1</span>
          <span class="step-text">Add this to your pipeline YAML:</span>
        </div>
        <div class="yaml-snippet">
          <pre><code>${escapeHtml(PREDICTIONS_YAML)}</code></pre>
          ${createCopyButton(PREDICTIONS_YAML, "copy-predictions-yaml")}
        </div>
        <div class="setup-step">
          <span class="step-number">2</span>
          <span class="step-text">Run your pipeline to generate forecasts</span>
        </div>
      </div>
      <div class="setup-note">
        <span class="note-icon">\u{1F4A1}</span>
        <span>Uses NumPy-based linear regression. For Prophet support, install the optional dependency.</span>
      </div>
    </div>
  `;
  }
  function renderInsightsSetupGuide() {
    return `
    <div class="setup-guide insights-setup">
      <div class="setup-guide-header">
        <span class="setup-icon">\u{1F916}</span>
        <h4>Enable AI Insights</h4>
      </div>
      <p class="setup-description">
        Get actionable insights powered by OpenAI.
      </p>
      <div class="cost-estimate">
        <span class="cost-icon">\u{1F4B0}</span>
        <span class="cost-text">Estimated cost: <strong>~$0.001-0.01</strong> per pipeline run</span>
      </div>
      <div class="setup-steps">
        <div class="setup-step">
          <span class="step-number">1</span>
          <span class="step-text">Get an OpenAI API key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com</a></span>
        </div>
        <div class="setup-step">
          <span class="step-number">2</span>
          <span class="step-text">Add <code>OPENAI_API_KEY</code> as a secret variable in your ADO pipeline or variable group</span>
        </div>
        <div class="setup-step">
          <span class="step-number">3</span>
          <span class="step-text">Add this to your pipeline YAML:</span>
        </div>
        <div class="yaml-snippet">
          <pre><code>${escapeHtml(INSIGHTS_YAML)}</code></pre>
          ${createCopyButton(INSIGHTS_YAML, "copy-insights-yaml")}
        </div>
        <div class="setup-step">
          <span class="step-number">4</span>
          <span class="step-text">Run your pipeline to generate insights</span>
        </div>
      </div>
      <div class="setup-note">
        <span class="note-icon">\u{1F512}</span>
        <span>Your API key is stored securely in ADO and never logged or exposed.</span>
      </div>
    </div>
  `;
  }
  function renderPredictionsEmptyWithGuide(container) {
    const content = document.createElement("div");
    content.className = "ml-empty-state with-guide";
    appendTrustedHtml(
      content,
      `
    <div class="empty-state-message">
      <h3>No Prediction Data Available</h3>
      <p>Enable predictions in your pipeline to see time-series forecasts.</p>
    </div>
    ${renderPredictionsSetupGuide()}
  `
    );
    const unavailable = container.querySelector(".feature-unavailable");
    if (unavailable) unavailable.classList.add("hidden");
    container.appendChild(content);
    attachCopyHandlers(content);
  }
  function renderInsightsEmptyWithGuide(container) {
    const content = document.createElement("div");
    content.className = "ml-empty-state with-guide";
    appendTrustedHtml(
      content,
      `
    <div class="empty-state-message">
      <h3>No AI Insights Available</h3>
      <p>Enable AI insights in your pipeline to get actionable recommendations.</p>
    </div>
    ${renderInsightsSetupGuide()}
  `
    );
    const unavailable = container.querySelector(".feature-unavailable");
    if (unavailable) unavailable.classList.add("hidden");
    container.appendChild(content);
    attachCopyHandlers(content);
  }

  // ../ui/modules/ml/state-machine.ts
  function isSchemaVersionSupported(version) {
    if (typeof version !== "number") return false;
    const [min, max] = ML_SCHEMA_VERSION_RANGE;
    return version >= min && version <= max;
  }
  function hasPredictionsRequiredFields(data) {
    if (typeof data !== "object" || data === null) return false;
    const obj = data;
    return "schema_version" in obj && "generated_at" in obj && "forecasts" in obj && Array.isArray(obj.forecasts);
  }
  function hasInsightsRequiredFields(data) {
    if (typeof data !== "object" || data === null) return false;
    const obj = data;
    return "schema_version" in obj && "generated_at" in obj && "insights" in obj && Array.isArray(obj.insights);
  }
  function isPredictionsNoData(data) {
    if (data.data_quality === "insufficient") return true;
    if (!data.forecasts || data.forecasts.length === 0) return true;
    return false;
  }
  function isInsightsNoData(data) {
    if (!data.insights || data.insights.length === 0) return true;
    return false;
  }
  function resolvePredictionsState(result) {
    if (!result.exists) {
      return { type: "setup-required" };
    }
    if (result.parseError) {
      return {
        type: "invalid-artifact",
        error: result.parseError,
        path: result.path
      };
    }
    if (!hasPredictionsRequiredFields(result.data)) {
      return {
        type: "invalid-artifact",
        error: "Missing required fields: schema_version, generated_at, or forecasts",
        path: result.path
      };
    }
    const data = result.data;
    if (!isSchemaVersionSupported(data.schema_version)) {
      return {
        type: "unsupported-schema",
        version: typeof data.schema_version === "number" ? data.schema_version : -1,
        supported: ML_SCHEMA_VERSION_RANGE
      };
    }
    const renderData = data;
    if (isPredictionsNoData(renderData)) {
      return {
        type: "no-data",
        quality: renderData.data_quality === "insufficient" ? "insufficient" : void 0
      };
    }
    return {
      type: "ready",
      data: renderData
    };
  }
  function resolveInsightsState(result) {
    if (!result.exists) {
      return { type: "setup-required" };
    }
    if (result.parseError) {
      return {
        type: "invalid-artifact",
        error: result.parseError,
        path: result.path
      };
    }
    if (!hasInsightsRequiredFields(result.data)) {
      return {
        type: "invalid-artifact",
        error: "Missing required fields: schema_version, generated_at, or insights",
        path: result.path
      };
    }
    const data = result.data;
    if (!isSchemaVersionSupported(data.schema_version)) {
      return {
        type: "unsupported-schema",
        version: typeof data.schema_version === "number" ? data.schema_version : -1,
        supported: ML_SCHEMA_VERSION_RANGE
      };
    }
    const renderData = data;
    if (isInsightsNoData(renderData)) {
      return { type: "no-data" };
    }
    return {
      type: "ready",
      data: renderData
    };
  }

  // ../ui/modules/ml.ts
  function isPredictionsRenderData(data) {
    return typeof data === "object" && data !== null && "forecasts" in data && Array.isArray(data.forecasts);
  }
  function isInsightsRenderData(data) {
    return typeof data === "object" && data !== null && "insights" in data && Array.isArray(data.insights);
  }
  var MAX_SPARKLINE_POINTS = 200;
  var SEVERITY_ICONS = {
    critical: { icon: "\u{1F534}", label: "Critical" },
    warning: { icon: "\u{1F7E1}", label: "Warning" },
    info: { icon: "\u{1F535}", label: "Informational" }
  };
  var PRIORITY_BADGES = {
    high: { label: "High Priority", cssClass: "priority-high" },
    medium: { label: "Medium Priority", cssClass: "priority-medium" },
    low: { label: "Low Priority", cssClass: "priority-low" }
  };
  var EFFORT_BADGES = {
    high: { label: "High Effort", cssClass: "effort-high" },
    medium: { label: "Medium Effort", cssClass: "effort-medium" },
    low: { label: "Low Effort", cssClass: "effort-low" }
  };
  var TREND_ICONS = {
    up: "\u2197",
    down: "\u2198",
    stable: "\u2192"
  };
  var SEVERITY_PRIORITY = {
    critical: 3,
    warning: 2,
    info: 1
  };
  function sortInsights(insights) {
    return [...insights].sort((a, b) => {
      const severityA = SEVERITY_PRIORITY[a.severity] ?? 0;
      const severityB = SEVERITY_PRIORITY[b.severity] ?? 0;
      if (severityB !== severityA) {
        return severityB - severityA;
      }
      const categoryCompare = String(a.category).localeCompare(
        String(b.category)
      );
      if (categoryCompare !== 0) {
        return categoryCompare;
      }
      if (typeof a.id === "number" && typeof b.id === "number") {
        return a.id - b.id;
      }
      return String(a.id).localeCompare(String(b.id));
    });
  }
  function renderInsightSparkline(values, width = 60, height = 20) {
    if (!values || values.length < 2) {
      return `<span class="sparkline-empty" aria-label="No trend data available">\u2014</span>`;
    }
    const limitedValues = values.length > MAX_SPARKLINE_POINTS ? values.slice(-MAX_SPARKLINE_POINTS) : values;
    const cleanValues = limitedValues.filter(
      (v) => typeof v === "number" && Number.isFinite(v)
    );
    if (cleanValues.length < 2) {
      return `<span class="sparkline-empty" aria-label="No trend data available">\u2014</span>`;
    }
    const minVal = Math.min(...cleanValues);
    const maxVal = Math.max(...cleanValues);
    const range = maxVal - minVal || 1;
    const padding = 2;
    const effectiveHeight = height - padding * 2;
    const effectiveWidth = width - padding * 2;
    const points = cleanValues.map((val, i) => {
      const x = padding + i / (cleanValues.length - 1) * effectiveWidth;
      const y = padding + (1 - (val - minVal) / range) * effectiveHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const firstVal = cleanValues[0];
    const lastVal = cleanValues[cleanValues.length - 1];
    const trendDescription = lastVal > firstVal ? "upward trend" : lastVal < firstVal ? "downward trend" : "stable trend";
    const truncatedBadge = values.length > MAX_SPARKLINE_POINTS ? `<span class="truncation-badge" title="Showing last ${MAX_SPARKLINE_POINTS} of ${values.length} data points">*</span>` : "";
    return `
    <svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
         role="img" aria-label="Sparkline showing ${trendDescription} over ${cleanValues.length} data points">
      <polyline
        points="${points}"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>${truncatedBadge}
  `;
  }
  function renderInsightDataSection(data) {
    if (!data) return "";
    const metricLabel = data.metric.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const trendIcon = TREND_ICONS[data.trend_direction] || "";
    const trendClass = `trend-${data.trend_direction}`;
    const changeDisplay = data.change_percent !== void 0 ? `${data.change_percent > 0 ? "+" : ""}${data.change_percent.toFixed(1)}%` : "";
    return `
    <div class="insight-data-section">
      <div class="insight-metric">
        <span class="metric-label">${escapeHtml(metricLabel)}</span>
        <span class="metric-value">${escapeHtml(String(data.current_value))}</span>
        ${changeDisplay ? `<span class="metric-change ${trendClass}">${trendIcon} ${escapeHtml(changeDisplay)}</span>` : ""}
      </div>
      <div class="insight-sparkline">
        ${renderInsightSparkline(data.sparkline)}
      </div>
    </div>
  `;
  }
  function renderRecommendationSection(recommendation) {
    if (!recommendation) return "";
    const priorityBadge = PRIORITY_BADGES[recommendation.priority] ?? {
      label: "Medium Priority",
      cssClass: "priority-medium"
    };
    const effortBadge = EFFORT_BADGES[recommendation.effort] ?? {
      label: "Medium Effort",
      cssClass: "effort-medium"
    };
    return `
    <div class="insight-recommendation">
      <div class="recommendation-header">
        <span class="recommendation-label">Recommendation</span>
        <div class="recommendation-badges">
          <span class="badge ${priorityBadge.cssClass}">${escapeHtml(priorityBadge.label)}</span>
          <span class="badge ${effortBadge.cssClass}">${escapeHtml(effortBadge.label)}</span>
        </div>
      </div>
      <p class="recommendation-action">${escapeHtml(recommendation.action)}</p>
    </div>
  `;
  }
  function renderAffectedEntities(entities) {
    if (!entities || entities.length === 0) return "";
    const entityItems = entities.map((entity) => {
      const memberCount = entity.member_count !== void 0 ? `<span class="entity-count">(${entity.member_count})</span>` : "";
      const entityIcon = entity.type === "team" ? "\u{1F465}" : entity.type === "repository" ? "\u{1F4C1}" : "\u{1F464}";
      return `
        <span class="entity-item ${escapeHtml(entity.type)}">
          <span class="entity-icon">${entityIcon}</span>
          <span class="entity-name">${escapeHtml(entity.name)}</span>
          ${memberCount}
        </span>
      `;
    }).join("");
    return `
    <div class="insight-affected-entities">
      <span class="entities-label">Affects:</span>
      <div class="entities-list">${entityItems}</div>
    </div>
  `;
  }
  function renderRichInsightCard(insight) {
    const defaultSeverity = { icon: "\u{1F535}", label: "Informational" };
    const severityInfo = SEVERITY_ICONS[insight.severity] ?? defaultSeverity;
    return `
    <article class="insight-card rich-card ${escapeHtml(String(insight.severity))}"
             role="article" aria-labelledby="insight-title-${escapeHtml(String(insight.id))}">
      <div class="insight-header">
        <span class="severity-icon" role="img" aria-label="${severityInfo.label} severity">${severityInfo.icon}</span>
        <span class="insight-category">${escapeHtml(String(insight.category))}</span>
      </div>
      <h5 class="insight-title" id="insight-title-${escapeHtml(String(insight.id))}">${escapeHtml(String(insight.title))}</h5>
      <p class="insight-description">${escapeHtml(String(insight.description))}</p>
      ${renderInsightDataSection(insight.data)}
      ${renderAffectedEntities(insight.affected_entities)}
      ${renderRecommendationSection(insight.recommendation)}
    </article>
  `;
  }
  function renderPreviewBanner() {
    return `
    <div class="preview-banner">
      <span class="preview-icon">&#x26A0;</span>
      <div class="preview-text">
        <strong>PREVIEW - Demo Data</strong>
        <span>This is synthetic data for preview purposes only. Run the analytics pipeline to see real metrics.</span>
      </div>
    </div>
  `;
  }
  function renderStaleDataBanner(generatedAt) {
    const formattedDate = generatedAt ? new Date(generatedAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }) : "unknown date";
    return `
    <div class="stale-data-banner">
      <span class="stale-icon">&#x1F551;</span>
      <div class="stale-text">
        <strong>Stale Data</strong>
        <span>Showing cached data from ${escapeHtml(formattedDate)}. Latest data could not be loaded.</span>
      </div>
    </div>
  `;
  }
  function renderPredictions(container, predictions, rollups) {
    renderPredictionsWithCharts(container, predictions, rollups);
  }
  function renderAIInsights(container, insights, isStale) {
    if (!container) return;
    if (!insights) return;
    const content = document.createElement("div");
    content.className = "insights-content";
    if (isStale && insights.generated_at) {
      appendTrustedHtml(content, renderStaleDataBanner(insights.generated_at));
    }
    if (insights.is_stub) {
      appendTrustedHtml(content, renderPreviewBanner());
    }
    const sortedInsights = sortInsights(insights.insights);
    const defaultSeverityInfo = { icon: "\u{1F535}", label: "Informational" };
    ["critical", "warning", "info"].forEach((severity) => {
      const items = sortedInsights.filter(
        (i) => i.severity === severity
      );
      if (!items.length) return;
      const severityInfo = SEVERITY_ICONS[severity] ?? defaultSeverityInfo;
      const sectionLabel = `${severity.charAt(0).toUpperCase() + severity.slice(1)} insights`;
      appendTrustedHtml(
        content,
        `
        <section class="severity-section" role="region" aria-label="${sectionLabel}">
          <h4>
            <span role="img" aria-hidden="true">${severityInfo.icon}</span>
            <span>${severity.charAt(0).toUpperCase() + severity.slice(1)}</span>
            <span class="visually-hidden">(${items.length} ${items.length === 1 ? "item" : "items"})</span>
          </h4>
          <div class="insight-cards" role="feed" aria-label="${sectionLabel} list">
            ${items.map((i) => renderRichInsightCard(i)).join("")}
          </div>
        </section>
      `
      );
    });
    const unavailable = container.querySelector(".feature-unavailable");
    if (unavailable) unavailable.classList.add("hidden");
    container.appendChild(content);
  }
  function renderPredictionsEmpty(container) {
    if (!container) return;
    renderPredictionsEmptyWithGuide(container);
  }
  function renderInsightsEmpty(container) {
    if (!container) return;
    renderInsightsEmptyWithGuide(container);
  }
  function renderInvalidArtifactBanner(container, error, path) {
    if (!container) return;
    const content = document.createElement("div");
    content.className = "artifact-error-banner invalid-artifact";
    renderTrustedHtml(
      content,
      `
    <div class="error-banner">
      <div class="error-icon">\u26A0\uFE0F</div>
      <div class="error-content">
        <h4>Invalid Data Format</h4>
        <p>${escapeHtml(error)}</p>
        ${path ? `<code class="file-path">${escapeHtml(path)}</code>` : ""}
      </div>
    </div>
  `
    );
    const unavailable = container.querySelector(".feature-unavailable");
    if (unavailable) unavailable.classList.add("hidden");
    container.appendChild(content);
  }
  function renderUnsupportedSchemaBanner(container, version, supported) {
    if (!container) return;
    const content = document.createElement("div");
    content.className = "artifact-error-banner unsupported-schema";
    renderTrustedHtml(
      content,
      `
    <div class="error-banner">
      <div class="error-icon">\u{1F504}</div>
      <div class="error-content">
        <h4>Unsupported Schema Version</h4>
        <p>Found schema version <strong>${escapeHtml(String(version))}</strong>, but this dashboard supports versions <strong>${supported[0]}</strong> to <strong>${supported[1]}</strong>.</p>
        <p class="hint">Please update your pipeline or dashboard to use a compatible version.</p>
      </div>
    </div>
  `
    );
    const unavailable = container.querySelector(".feature-unavailable");
    if (unavailable) unavailable.classList.add("hidden");
    container.appendChild(content);
  }
  function renderNoDataState(container, quality, featureType) {
    if (!container) return;
    const content = document.createElement("div");
    content.className = "artifact-state no-data";
    const message = quality === "insufficient" ? "Not enough historical data to generate meaningful results." : featureType === "predictions" ? "The predictions artifact exists but contains no forecast data." : "The insights artifact exists but contains no insights.";
    const suggestion = quality === "insufficient" ? "Continue running your pipeline to accumulate more data points." : "Check that your pipeline is configured correctly to generate this data.";
    renderTrustedHtml(
      content,
      `
    <div class="no-data-message">
      <div class="state-icon">\u{1F4CA}</div>
      <h4>${quality === "insufficient" ? "Insufficient Data" : "No Data Available"}</h4>
      <p>${escapeHtml(message)}</p>
      <p class="hint">${escapeHtml(suggestion)}</p>
    </div>
  `
    );
    const unavailable = container.querySelector(".feature-unavailable");
    if (unavailable) unavailable.classList.add("hidden");
    container.appendChild(content);
  }
  function renderPredictionsForState(container, state, rollups) {
    if (!container) return;
    const existingContent = container.querySelectorAll(
      ".predictions-content, .ml-empty-state, .artifact-error-banner, .artifact-state, .predictions-error"
    );
    existingContent.forEach((el) => el.remove());
    switch (state.type) {
      case "setup-required":
        renderPredictionsEmpty(container);
        break;
      case "no-data":
        renderNoDataState(container, state.quality, "predictions");
        break;
      case "invalid-artifact":
        renderInvalidArtifactBanner(container, state.error, state.path);
        break;
      case "unsupported-schema":
        renderUnsupportedSchemaBanner(container, state.version, state.supported);
        break;
      case "ready":
        if (isPredictionsRenderData(state.data)) {
          renderPredictions(container, state.data, rollups);
        }
        break;
    }
  }
  function renderInsightsForState(container, state) {
    if (!container) return;
    const existingContent = container.querySelectorAll(
      ".insights-content, .ml-empty-state, .artifact-error-banner, .artifact-state, .insights-error"
    );
    existingContent.forEach((el) => el.remove());
    switch (state.type) {
      case "setup-required":
        renderInsightsEmpty(container);
        break;
      case "no-data":
        renderNoDataState(container, state.quality, "insights");
        break;
      case "invalid-artifact":
        renderInvalidArtifactBanner(container, state.error, state.path);
        break;
      case "unsupported-schema":
        renderUnsupportedSchemaBanner(container, state.version, state.supported);
        break;
      case "ready":
        if (isInsightsRenderData(state.data)) {
          renderAIInsights(container, state.data);
        }
        break;
    }
  }

  // ../ui/modules/charts.ts
  var SCROLL_CANCEL_THRESHOLD = 10;
  function renderDelta(element, percentChange, inverse = false) {
    if (!element) return;
    if (percentChange === null) {
      clearElement(element);
      element.className = "metric-delta";
      return;
    }
    const isNeutral = Math.abs(percentChange) < 2;
    const isPositive = percentChange > 0;
    const absChange = Math.abs(percentChange);
    const cssClass = isNeutral ? "metric-delta delta-neutral" : isPositive ? `metric-delta ${inverse ? "delta-negative-inverse" : "delta-positive"}` : `metric-delta ${inverse ? "delta-positive-inverse" : "delta-negative"}`;
    const arrow = isNeutral ? "~" : isPositive ? "&#9650;" : "&#9660;";
    const sign = isPositive ? "+" : "";
    element.className = cssClass;
    renderTrustedHtml(
      element,
      `<span class="delta-arrow">${arrow}</span> ${sign}${absChange.toFixed(0)}% <span class="delta-label">vs prev</span>`
    );
  }
  function renderSparkline(element, values) {
    if (!element || !values) {
      if (element) clearElement(element);
      return;
    }
    const nonNull = values.filter((v) => v !== null);
    if (nonNull.length < 2) {
      clearElement(element);
      return;
    }
    const data = nonNull.slice(-8);
    const width = 60;
    const height = 24;
    const padding = 2;
    const minVal = Math.min(...data);
    const maxVal = Math.max(...data);
    const range = maxVal - minVal || 1;
    const points = data.map((val, i) => {
      const x = padding + i / (data.length - 1) * (width - padding * 2);
      const y = height - padding - (val - minVal) / range * (height - padding * 2);
      return { x, y };
    });
    const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];
    if (!firstPoint || !lastPoint) return;
    const areaD = pathD + ` L ${lastPoint.x.toFixed(1)} ${height - padding} L ${firstPoint.x.toFixed(1)} ${height - padding} Z`;
    renderTrustedHtml(
      element,
      `
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
            <path class="sparkline-area" d="${areaD}"/>
            <path class="sparkline-line" d="${pathD}"/>
            <circle class="sparkline-dot" cx="${lastPoint.x.toFixed(1)}" cy="${lastPoint.y.toFixed(1)}" r="2"/>
        </svg>
    `
    );
  }
  var containerControllers = /* @__PURE__ */ new WeakMap();
  var activeTooltipContainers = /* @__PURE__ */ new WeakSet();
  var dismissListenerController = null;
  var activeTooltipContainerCount = 0;
  function dismissActiveTooltip() {
    const existing = document.querySelector(".chart-tooltip");
    if (existing) existing.remove();
  }
  function ensureDismissListener() {
    if (dismissListenerController) return;
    dismissListenerController = new AbortController();
    const { signal } = dismissListenerController;
    document.addEventListener(
      "click",
      (e) => {
        if (!document.querySelector(".chart-tooltip")) return;
        const target = e.target;
        if (!target.closest("[data-tooltip]") && !target.closest(".chart-tooltip")) {
          dismissActiveTooltip();
        }
      },
      { signal }
    );
  }
  function releaseDismissListenerIfUnused() {
    if (activeTooltipContainerCount > 0) return;
    dismissListenerController?.abort();
    dismissListenerController = null;
  }
  function clearChartTooltips(container) {
    if (!container) return;
    containerControllers.get(container)?.abort();
    containerControllers.delete(container);
    if (activeTooltipContainers.delete(container)) {
      activeTooltipContainerCount = Math.max(0, activeTooltipContainerCount - 1);
    }
    dismissActiveTooltip();
    releaseDismissListenerIfUnused();
  }
  function addChartTooltips(container, contentFn) {
    clearChartTooltips(container);
    const dots = container.querySelectorAll("[data-tooltip]");
    const controller = new AbortController();
    containerControllers.set(container, controller);
    activeTooltipContainers.add(container);
    activeTooltipContainerCount += 1;
    ensureDismissListener();
    const { signal } = controller;
    function showTooltip(dot) {
      dismissActiveTooltip();
      const content = contentFn(dot);
      const tooltip = document.createElement("div");
      tooltip.className = "chart-tooltip";
      renderTrustedHtml(tooltip, content);
      tooltip.style.position = "absolute";
      const rect = dot.getBoundingClientRect();
      tooltip.style.left = `${rect.left + rect.width / 2}px`;
      tooltip.style.top = `${rect.top - 8}px`;
      tooltip.style.transform = "translateX(-50%) translateY(-100%)";
      document.body.appendChild(tooltip);
    }
    dots.forEach((dot) => {
      const el = dot;
      let pointerOrigin = null;
      el.addEventListener("mouseenter", () => showTooltip(el), { signal });
      el.addEventListener("mouseleave", () => dismissActiveTooltip(), { signal });
      el.addEventListener(
        "pointerdown",
        (e) => {
          pointerOrigin = { x: e.clientX, y: e.clientY };
        },
        { signal }
      );
      el.addEventListener(
        "pointerup",
        (e) => {
          if (!pointerOrigin) return;
          const dx = e.clientX - pointerOrigin.x;
          const dy = e.clientY - pointerOrigin.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          pointerOrigin = null;
          if (distance < SCROLL_CANCEL_THRESHOLD) {
            e.preventDefault();
            showTooltip(el);
          }
        },
        { signal }
      );
    });
  }

  // ../ui/modules/charts/summary-cards.ts
  function renderSummaryCards(options) {
    const { rollups, prevRollups = [], containers, metricsCollector: metricsCollector2 } = options;
    if (metricsCollector2) metricsCollector2.mark("render-summary-cards-start");
    const current = calculateMetrics(rollups);
    const previous = calculateMetrics(prevRollups);
    renderMetricValues(containers, current);
    const sparklineData = extractSparklineData(rollups);
    renderSparklines(containers, sparklineData);
    if (prevRollups && prevRollups.length > 0) {
      renderDeltas(containers, current, previous);
    } else {
      clearDeltas(containers);
    }
    if (metricsCollector2) {
      metricsCollector2.mark("render-summary-cards-end");
      metricsCollector2.mark("first-meaningful-paint");
      metricsCollector2.measure(
        "init-to-fmp",
        "dashboard-init",
        "first-meaningful-paint"
      );
    }
  }
  function renderMetricValues(containers, metrics) {
    if (containers.totalPrs) {
      containers.totalPrs.textContent = metrics.totalPrs.toLocaleString();
    }
    if (containers.cycleP50) {
      containers.cycleP50.textContent = metrics.cycleP50 !== null ? formatDuration(metrics.cycleP50) : "-";
    }
    if (containers.cycleP90) {
      containers.cycleP90.textContent = metrics.cycleP90 !== null ? formatDuration(metrics.cycleP90) : "-";
    }
    if (containers.authorsCount) {
      containers.authorsCount.textContent = metrics.avgAuthors.toLocaleString();
    }
    if (containers.reviewersCount) {
      containers.reviewersCount.textContent = metrics.avgReviewers.toLocaleString();
    }
  }
  function renderSparklines(containers, data) {
    renderSparkline(containers.totalPrsSparkline, data.prCounts);
    renderSparkline(containers.cycleP50Sparkline, data.p50s);
    renderSparkline(containers.cycleP90Sparkline, data.p90s);
    renderSparkline(containers.authorsSparkline, data.authors);
    renderSparkline(containers.reviewersSparkline, data.reviewers);
  }
  function renderDeltas(containers, current, previous) {
    renderDelta(
      containers.totalPrsDelta,
      calculatePercentChange(current.totalPrs, previous.totalPrs),
      false
    );
    renderDelta(
      containers.cycleP50Delta,
      calculatePercentChange(current.cycleP50, previous.cycleP50),
      true
      // Inverse: lower is better
    );
    renderDelta(
      containers.cycleP90Delta,
      calculatePercentChange(current.cycleP90, previous.cycleP90),
      true
      // Inverse: lower is better
    );
    renderDelta(
      containers.authorsDelta,
      calculatePercentChange(current.avgAuthors, previous.avgAuthors),
      false
    );
    renderDelta(
      containers.reviewersDelta,
      calculatePercentChange(current.avgReviewers, previous.avgReviewers),
      false
    );
  }
  function clearDeltas(containers) {
    const deltaElements = [
      containers.totalPrsDelta,
      containers.cycleP50Delta,
      containers.cycleP90Delta,
      containers.authorsDelta,
      containers.reviewersDelta
    ];
    deltaElements.forEach((el) => {
      if (el) {
        clearElement(el);
        el.className = "metric-delta";
      }
    });
  }

  // ../ui/modules/charts/throughput.ts
  var MAX_THROUGHPUT_POINTS = 104;
  var MAX_VISIBLE_LABELS = 16;
  function renderThroughputChart(container, rollups) {
    if (!container) return;
    clearChartTooltips(container);
    if (!rollups || !rollups.length) {
      renderNoData(
        container,
        "No data for selected range",
        NO_DATA_HINTS.WIDEN_FILTERS
      );
      return;
    }
    const truncated = rollups.length > MAX_THROUGHPUT_POINTS;
    const displayRollups = truncated ? rollups.slice(-MAX_THROUGHPUT_POINTS) : rollups;
    const prCounts = displayRollups.map((r) => r.pr_count || 0);
    const maxCount = Math.max(...prCounts);
    const movingAvg = calculateMovingAverage(prCounts, 4);
    const labelStep = Math.ceil(displayRollups.length / MAX_VISIBLE_LABELS);
    const barsHtml = displayRollups.map((r, index) => {
      const height = maxCount > 0 ? (r.pr_count || 0) / maxCount * 100 : 0;
      const wParts = r.week.split("-W");
      const weekLabel = wParts[1] ?? r.week;
      const showLabel = index % labelStep === 0;
      return `
            <div class="bar-container" data-tooltip="true" data-week="${escapeHtml(r.week)}" data-count="${r.pr_count || 0}">
                <div class="bar" style="height: ${height}%"></div>
                <div class="bar-label">${showLabel ? escapeHtml(weekLabel) : ""}</div>
            </div>
        `;
    }).join("");
    const trendResult = renderTrendLine(displayRollups, movingAvg, maxCount);
    const truncationHtml = truncated ? `<div class="truncation-indicator">Showing last ${MAX_THROUGHPUT_POINTS} weeks</div>` : "";
    const trendLegendItem = trendResult.rendered ? `<div class="legend-item"><span class="legend-line"></span><span>4-week avg</span></div>` : `<div class="legend-item legend-insufficient"><span class="legend-line dimmed"></span><span>4-week avg \u2014 needs 4+ weeks</span></div>`;
    const legendHtml = `
        <div class="chart-legend">
            <div class="legend-item">
                <span class="legend-bar"></span>
                <span>Weekly PRs</span>
            </div>
            ${trendLegendItem}
        </div>
    `;
    renderTrustedHtml(
      container,
      `
        ${truncationHtml}
        <div class="chart-with-trend" style="--chart-surface: var(--bg-primary);">
            <div class="bar-chart">${barsHtml}</div>
            ${trendResult.html}
        </div>
        ${legendHtml}
    `
    );
    addChartTooltips(container, (bar) => {
      const week = bar.dataset.week ?? "";
      const count = bar.dataset.count ?? "0";
      return `<div class="chart-tooltip-title">${escapeHtml(week)}</div>
            <div class="chart-tooltip-row">
              <span class="chart-tooltip-label">PRs</span>
              <span>${escapeHtml(count)}</span>
            </div>`;
    });
  }
  function renderTrendLine(rollups, movingAvg, maxCount) {
    if (rollups.length < 4) return { html: "", rendered: false };
    const validPoints = movingAvg.map((val, i) => ({ val, i })).filter((p) => p.val !== null);
    if (validPoints.length < 2) return { html: "", rendered: false };
    const chartHeight = 200;
    const chartPadding = 8;
    const points = validPoints.map((p) => {
      const x = p.i / (rollups.length - 1) * 100;
      const y = maxCount > 0 ? chartHeight - chartPadding - p.val / maxCount * (chartHeight - chartPadding * 2) : chartHeight / 2;
      return { x, y };
    });
    const pathD = points.map(
      (pt, i) => `${i === 0 ? "M" : "L"} ${pt.x.toFixed(1)}% ${pt.y.toFixed(1)}`
    ).join(" ");
    return {
      html: `<div class="trend-line-overlay"><svg viewBox="0 0 100 ${chartHeight}" preserveAspectRatio="none"><path class="trend-line" d="${pathD}" vector-effect="non-scaling-stroke"/></svg></div>`,
      rendered: true
    };
  }

  // ../ui/modules/charts/cycle-time.ts
  var MAX_CYCLE_TIME_POINTS = 104;
  function renderCycleDistribution(container, distributions) {
    if (!container) return;
    if (!distributions || !distributions.length) {
      renderNoData(
        container,
        "No data for selected range",
        NO_DATA_HINTS.WIDEN_FILTERS
      );
      return;
    }
    const buckets = {
      "0-1h": 0,
      "1-4h": 0,
      "4-24h": 0,
      "1-3d": 0,
      "3-7d": 0,
      "7d+": 0
    };
    distributions.forEach((d) => {
      Object.entries(d.cycle_time_buckets || {}).forEach(([key, val]) => {
        buckets[key] = (buckets[key] || 0) + val;
      });
    });
    const total = Object.values(buckets).reduce((a, b) => a + b, 0);
    if (total === 0) {
      renderNoData(container, "No cycle time data", NO_DATA_HINTS.WIDEN_FILTERS);
      return;
    }
    const html = Object.entries(buckets).map(([label, count]) => {
      const pct = (count / total * 100).toFixed(1);
      return `
            <div class="dist-row">
                <span class="dist-label">${label}</span>
                <div class="dist-bar-bg">
                    <div class="dist-bar" style="width: ${pct}%"></div>
                </div>
                <span class="dist-value">${count} (${pct}%)</span>
            </div>
        `;
    }).join("");
    renderTrustedHtml(container, html);
  }
  function renderCycleTimeTrend(container, rollups) {
    if (!container) return;
    clearChartTooltips(container);
    if (!rollups || rollups.length < 2) {
      renderNoData(
        container,
        "Not enough data for trend",
        NO_DATA_HINTS.TREND_MINIMUM
      );
      return;
    }
    const truncated = rollups.length > MAX_CYCLE_TIME_POINTS;
    const displayRollups = truncated ? rollups.slice(-MAX_CYCLE_TIME_POINTS) : rollups;
    const p50Data = displayRollups.map((r) => ({ week: r.week, value: r.cycle_time_p50 })).filter((d) => d.value !== null);
    const p90Data = displayRollups.map((r) => ({ week: r.week, value: r.cycle_time_p90 })).filter((d) => d.value !== null);
    if (p50Data.length < 2 && p90Data.length < 2) {
      renderNoData(
        container,
        "No cycle time data available",
        NO_DATA_HINTS.WIDEN_FILTERS
      );
      return;
    }
    const allValues = [
      ...p50Data.map((d) => d.value),
      ...p90Data.map((d) => d.value)
    ];
    const maxVal = Math.max(...allValues);
    const minVal = Math.min(...allValues);
    const range = maxVal - minVal || 1;
    const height = 180;
    const padding = { top: 10, right: 10, bottom: 25, left: 40 };
    const width = Math.max(
      500,
      padding.left + padding.right + displayRollups.length * 6
    );
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const dotRadius = Math.max(1.5, Math.min(4, 200 / displayRollups.length));
    const generatePath = (data) => {
      if (displayRollups.length < 2) return { pathD: "", points: [] };
      const points = data.map((d) => {
        const dataIndex = displayRollups.findIndex((r) => r.week === d.week);
        if (dataIndex === -1) return null;
        const x = padding.left + dataIndex / (displayRollups.length - 1) * chartWidth;
        const y = padding.top + chartHeight - (d.value - minVal) / range * chartHeight;
        return { x, y, week: d.week, value: d.value };
      }).filter(
        (p) => p !== null
      );
      const pathD = points.map(
        (p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
      ).join(" ");
      return { pathD, points };
    };
    const p50Path = p50Data.length >= 2 ? generatePath(p50Data) : null;
    const p90Path = p90Data.length >= 2 ? generatePath(p90Data) : null;
    const yLabels = [minVal, (minVal + maxVal) / 2, maxVal];
    const svgContent = `
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMid meet">
            <!-- Grid lines -->
            ${yLabels.map((_, i) => {
      const y = padding.top + chartHeight - i / (yLabels.length - 1) * chartHeight;
      return `<line class="line-chart-grid" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"/>`;
    }).join("")}

            <!-- Y-axis labels -->
            ${yLabels.map((val, i) => {
      const y = padding.top + chartHeight - i / (yLabels.length - 1) * chartHeight;
      return `<text class="line-chart-axis" x="${padding.left - 4}" y="${y + 3}" text-anchor="end">${formatDuration(val)}</text>`;
    }).join("")}

            <!-- Lines -->
            ${p90Path ? `<path class="line-chart-p90" d="${p90Path.pathD}" vector-effect="non-scaling-stroke"/>` : ""}
            ${p50Path ? `<path class="line-chart-p50" d="${p50Path.pathD}" vector-effect="non-scaling-stroke"/>` : ""}

            <!-- Dots -->
            ${p90Path ? p90Path.points.map((p) => `<circle class="line-chart-dot" cx="${p.x}" cy="${p.y}" r="${dotRadius}" fill="var(--warning)" data-week="${escapeHtml(p.week)}" data-value="${escapeHtml(String(p.value))}" data-metric="P90"/>`).join("") : ""}
            ${p50Path ? p50Path.points.map((p) => `<circle class="line-chart-dot" cx="${p.x}" cy="${p.y}" r="${dotRadius}" fill="var(--primary)" data-week="${escapeHtml(p.week)}" data-value="${escapeHtml(String(p.value))}" data-metric="P50"/>`).join("") : ""}
        </svg>
    `;
    const legendItems = [];
    if (p50Path) {
      legendItems.push(`<div class="legend-item"><span class="chart-tooltip-dot legend-p50"></span><span>P50 (Median)</span></div>`);
    } else if (p50Data.length > 0) {
      legendItems.push(`<div class="legend-item legend-insufficient"><span class="chart-tooltip-dot legend-p50 dimmed"></span><span>P50 (Median) \u2014 insufficient points</span></div>`);
    }
    if (p90Path) {
      legendItems.push(`<div class="legend-item"><span class="chart-tooltip-dot legend-p90"></span><span>P90</span></div>`);
    } else if (p90Data.length > 0) {
      legendItems.push(`<div class="legend-item legend-insufficient"><span class="chart-tooltip-dot legend-p90 dimmed"></span><span>P90 \u2014 insufficient points</span></div>`);
    }
    const legendHtml = `<div class="chart-legend">${legendItems.join("")}</div>`;
    const truncationHtml = truncated ? `<div class="truncation-indicator">Showing last ${MAX_CYCLE_TIME_POINTS} weeks</div>` : "";
    renderTrustedHtml(
      container,
      `${truncationHtml}<div class="line-chart">${svgContent}</div>${legendHtml}`
    );
    addChartTooltips(container, (dot) => {
      const week = dot.dataset["week"] || "";
      const value = parseFloat(dot.dataset["value"] || "0");
      const metric = dot.dataset["metric"] || "";
      return `
            <div class="chart-tooltip-title">${escapeHtml(week)}</div>
            <div class="chart-tooltip-row">
                <span class="chart-tooltip-label">
                    <span class="chart-tooltip-dot ${metric === "P50" ? "legend-p50" : "legend-p90"}"></span>
                    ${escapeHtml(metric)}
                </span>
                <span>${formatDuration(value)}</span>
            </div>
        `;
    });
  }

  // ../ui/modules/charts/reviewer-activity.ts
  var MAX_REVIEWER_WEEKS = 8;
  function getReviewerNoDataHint(reviewerFilterActive, hasRollups) {
    return reviewerFilterActive ? "Try widening the date range or adjusting reviewer filters." : hasRollups ? NO_DATA_HINTS.REVIEWER_PIPELINE : NO_DATA_HINTS.WIDEN_FILTERS;
  }
  function renderReviewerActivity(container, rollups, options = {}) {
    if (!container) return;
    const { reviewerFilterActive = false } = options;
    const noun = reviewerFilterActive ? "reviews" : "reviewers";
    const subtitle = reviewerFilterActive ? `Review activity per week (last ${Math.min(rollups.length, MAX_REVIEWER_WEEKS)} weeks)` : `Active reviewers per week (last ${Math.min(rollups.length, MAX_REVIEWER_WEEKS)} weeks)`;
    if (!rollups || !rollups.length) {
      renderNoData(
        container,
        reviewerFilterActive ? "No review activity available" : "No reviewer data available",
        getReviewerNoDataHint(reviewerFilterActive, false)
      );
      return;
    }
    const truncated = rollups.length > MAX_REVIEWER_WEEKS;
    const recentRollups = rollups.slice(-MAX_REVIEWER_WEEKS);
    const maxReviewers = Math.max(
      ...recentRollups.map((r) => r.reviewers_count || 0)
    );
    if (maxReviewers === 0) {
      renderNoData(
        container,
        reviewerFilterActive ? "No review activity available" : "No reviewer data available",
        getReviewerNoDataHint(reviewerFilterActive, true)
      );
      return;
    }
    const barsHtml = recentRollups.map((r) => {
      const count = r.reviewers_count || 0;
      const pct = count / maxReviewers * 100;
      const wParts = r.week.split("-W");
      const weekLabel = wParts[1] ?? r.week;
      return `
            <div class="h-bar-row" title="${escapeHtml(r.week)}: ${count} ${noun}">
                <span class="h-bar-label">W${escapeHtml(weekLabel)}</span>
                <div class="h-bar-container">
                    <div class="h-bar" style="width: ${pct}%"></div>
                </div>
                <span class="h-bar-value">${count}</span>
            </div>
        `;
    }).join("");
    const truncationHtml = truncated ? `<div class="truncation-indicator">Showing last ${MAX_REVIEWER_WEEKS} weeks</div>` : "";
    renderTrustedHtml(
      container,
      `${truncationHtml}<p class="chart-subtitle">${escapeHtml(subtitle)}</p><div class="horizontal-bar-chart">${barsHtml}</div>`
    );
  }

  // ../ui/modules/export.ts
  var CSV_HEADERS = [
    "Week",
    "Start Date",
    "End Date",
    "PR Count",
    "Cycle Time P50 (min)",
    "Cycle Time P90 (min)",
    "Authors",
    "Reviewers"
  ];
  function rollupsToCsv(rollups) {
    if (!rollups || rollups.length === 0) {
      return "";
    }
    const rows = rollups.map((r) => [
      r.week,
      r.start_date || "",
      r.end_date || "",
      r.pr_count || 0,
      r.cycle_time_p50 != null ? r.cycle_time_p50.toFixed(1) : "",
      r.cycle_time_p90 != null ? r.cycle_time_p90.toFixed(1) : "",
      r.authors_count || 0,
      r.reviewers_count || 0
    ]);
    const headerRow = CSV_HEADERS.map((h) => h);
    return [headerRow, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
  }
  function generateExportFilename(prefix, extension) {
    const dateStr = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    return `${prefix}-${dateStr}.${extension}`;
  }
  function triggerDownload(content, filename, mimeType = "text/csv;charset=utf-8;") {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
  function showToast(message, type = "success", durationMs = 3e3) {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, durationMs);
  }

  // ../ui/modules/sdk.ts
  var sdkInitialized = false;
  async function initializeAdoSdk(options = {}) {
    if (sdkInitialized) {
      return;
    }
    const { timeout = 1e4, onReady } = options;
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Azure DevOps SDK initialization timed out"));
      }, timeout);
      VSS.init({
        explicitNotifyLoaded: true,
        usePlatformScripts: true,
        usePlatformStyles: true
      });
      VSS.ready(() => {
        clearTimeout(timeoutId);
        sdkInitialized = true;
        if (onReady) {
          onReady();
        }
        VSS.notifyLoadSucceeded();
        resolve();
      });
    });
  }
  function isLocalMode() {
    return typeof window !== "undefined" && window.LOCAL_DASHBOARD_MODE === true;
  }
  function getLocalDatasetPath() {
    return typeof window !== "undefined" && window.DATASET_PATH || "./dataset";
  }

  // ../ui/dashboard.ts
  var loader = null;
  var artifactClient = null;
  var currentDateRange = {
    start: null,
    end: null
  };
  var currentDimensions = null;
  var currentFilters = {
    repos: [],
    teams: [],
    reviewers: [],
    authors: []
  };
  var reviewerFilterNoticeMessage = null;
  var comparisonMode = false;
  var cachedRollups = [];
  var currentBuildId = null;
  var chipsDelegatedElement = null;
  var SETTINGS_KEY_PROJECT = "pr-insights-source-project";
  var SETTINGS_KEY_PIPELINE = "pr-insights-pipeline-id";
  var elements = {};
  var elementLists = {};
  function getOwnRecordValue(record, key) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor?.value;
  }
  function getElement(id) {
    const el = elements[id];
    if (el instanceof HTMLElement) {
      return el;
    }
    return null;
  }
  var IS_PRODUCTION2 = typeof window !== "undefined" && window.process?.env?.NODE_ENV === "production";
  var DEBUG_ENABLED = !IS_PRODUCTION2 && (typeof window !== "undefined" && window.__DASHBOARD_DEBUG__ || typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug"));
  var metricsCollector = DEBUG_ENABLED ? {
    marks: /* @__PURE__ */ new Map(),
    measures: [],
    mark(name) {
      if (!performance || !performance.mark) return;
      try {
        performance.mark(name);
        this.marks.set(name, performance.now());
      } catch (_e) {
      }
    },
    measure(name, startMark, endMark) {
      if (!performance || !performance.measure) return;
      try {
        performance.measure(name, startMark, endMark);
        const entries = performance.getEntriesByName(name, "measure");
        if (entries.length > 0) {
          const lastEntry = entries[entries.length - 1];
          if (lastEntry) {
            this.measures.push({
              name,
              duration: lastEntry.duration,
              timestamp: Date.now()
            });
          }
        }
      } catch (_e) {
      }
    },
    getMetrics() {
      return {
        marks: Array.from(this.marks.entries()).map(([name, time]) => ({
          name,
          time
        })),
        measures: [...this.measures]
      };
    },
    reset() {
      this.marks.clear();
      this.measures = [];
      if (performance && performance.clearMarks) performance.clearMarks();
      if (performance && performance.clearMeasures)
        performance.clearMeasures();
    }
  } : null;
  if (DEBUG_ENABLED && typeof window !== "undefined") {
    window.__dashboardMetrics = metricsCollector;
  }
  function parseQueryParams() {
    const params = new URLSearchParams(window.location.search);
    const datasetUrl = params.get("dataset");
    const pipelineIdStr = params.get("pipelineId");
    if (datasetUrl) {
      if (!datasetUrl.startsWith("https://")) {
        return createInvalidConfigError(
          "dataset",
          datasetUrl,
          "Must be a valid HTTPS URL"
        );
      }
      const IS_DEV = window.location.hostname === "localhost" || params.has("devMode");
      if (!IS_DEV) {
        try {
          const urlHost = new URL(datasetUrl).hostname;
          const isAdoDomain = urlHost.endsWith("dev.azure.com") || urlHost.endsWith(".visualstudio.com") || urlHost.endsWith(".azure.com");
          if (!isAdoDomain) {
            console.warn(
              "SECURITY: ?dataset= URL %s is not an Azure DevOps domain. This parameter is intended for development only.",
              urlHost
            );
          }
        } catch (_e) {
          return createInvalidConfigError(
            "dataset",
            datasetUrl,
            "Invalid URL format"
          );
        }
      }
      let warning = null;
      if (pipelineIdStr) {
        warning = "Both dataset and pipelineId specified; using dataset";
        console.warn(warning);
      }
      return { mode: "direct", value: datasetUrl, warning };
    }
    if (pipelineIdStr) {
      const pipelineId = parseInt(pipelineIdStr, 10);
      if (isNaN(pipelineId) || pipelineId <= 0) {
        return createInvalidConfigError(
          "pipelineId",
          pipelineIdStr,
          "Must be a positive integer"
        );
      }
      return { mode: "explicit", value: pipelineId };
    }
    return { mode: "discover", value: null };
  }
  async function getSourceConfig() {
    const result = {
      projectId: null,
      pipelineId: null
    };
    try {
      const dataService = await VSS.getService(
        VSS.ServiceIds.ExtensionData
      );
      const savedProjectId = await dataService.getValue(
        SETTINGS_KEY_PROJECT,
        { scopeType: "User" }
      );
      if (savedProjectId && typeof savedProjectId === "string" && savedProjectId.trim()) {
        result.projectId = savedProjectId.trim();
      }
      const savedPipelineId = await dataService.getValue(
        SETTINGS_KEY_PIPELINE,
        { scopeType: "User" }
      );
      if (savedPipelineId && typeof savedPipelineId === "number" && savedPipelineId > 0) {
        result.pipelineId = savedPipelineId;
      }
    } catch (e) {
      console.log("Could not read extension settings:", e);
    }
    return result;
  }
  async function clearStalePipelineSetting() {
    try {
      const dataService = await VSS.getService(
        VSS.ServiceIds.ExtensionData
      );
      await dataService.setValue(SETTINGS_KEY_PIPELINE, null, {
        scopeType: "User"
      });
      console.log("Cleared stale pipeline setting to re-enable auto-discovery");
    } catch (e) {
      console.warn("Could not clear stale pipeline setting:", e);
    }
  }
  async function resolveConfiguration() {
    const queryResult = parseQueryParams();
    if (queryResult instanceof PrInsightsError) {
      throw queryResult;
    }
    if (queryResult.mode === "direct") {
      return { directUrl: queryResult.value };
    }
    const webContext = VSS.getWebContext();
    const currentProjectId = webContext.project?.id;
    if (!currentProjectId) {
      throw new Error("No project context available");
    }
    const sourceConfig = await getSourceConfig();
    const targetProjectId = sourceConfig.projectId || currentProjectId;
    console.log(
      "Source project: %s%s",
      targetProjectId,
      sourceConfig.projectId ? " (from settings)" : " (current context)"
    );
    artifactClient = new ArtifactClient(targetProjectId);
    await artifactClient.initialize();
    if (queryResult.mode === "explicit") {
      return await resolveFromPipelineId(
        queryResult.value,
        targetProjectId
      );
    }
    if (sourceConfig.pipelineId) {
      console.log(
        "Using pipeline definition ID from settings: %d",
        sourceConfig.pipelineId
      );
      try {
        return await resolveFromPipelineId(
          sourceConfig.pipelineId,
          targetProjectId
        );
      } catch (error) {
        console.warn(
          `Saved pipeline ${sourceConfig.pipelineId} is invalid, falling back to auto-discovery:`,
          getErrorMessage(error)
        );
        await clearStalePipelineSetting();
      }
    }
    return await discoverAndResolve(targetProjectId);
  }
  async function resolveFromPipelineId(pipelineId, _projectId) {
    if (!artifactClient) throw new Error("ArtifactClient not initialized");
    const builds = await artifactClient.getBuilds(pipelineId);
    if (!builds || builds.length === 0) {
      throw createNoSuccessfulBuildsError(`ID ${pipelineId}`);
    }
    const latestBuild = builds[0];
    if (!latestBuild) throw new Error("Failed to retrieve latest build");
    const artifacts = await artifactClient.getArtifacts(latestBuild.id);
    const hasAggregates = artifacts.some((a) => a.name === "aggregates");
    if (!hasAggregates) {
      const name = latestBuild.definition?.name || `ID ${pipelineId}`;
      throw createArtifactsMissingError(name, latestBuild.id);
    }
    return { buildId: latestBuild.id, artifactName: "aggregates" };
  }
  async function discoverAndResolve(projectId) {
    const matches = await discoverInsightsPipelines(projectId);
    if (matches.length === 0) {
      throw createSetupRequiredError();
    }
    const firstMatch = matches[0];
    if (!firstMatch) throw createSetupRequiredError();
    return { buildId: firstMatch.buildId, artifactName: "aggregates" };
  }
  async function discoverInsightsPipelines(_projectId) {
    if (!artifactClient) throw new Error("ArtifactClient not initialized");
    const matches = [];
    const definitions = await artifactClient.getDefinitions();
    for (const def of definitions) {
      try {
        const builds = await artifactClient.getBuilds(def.id);
        if (!builds || builds.length === 0) continue;
        const latestBuild = builds[0];
        if (!latestBuild) continue;
        const artifacts = await artifactClient.getArtifacts(latestBuild.id);
        if (!artifacts.some((a) => a.name === "aggregates")) continue;
        matches.push({
          id: def.id,
          name: def.name,
          buildId: latestBuild.id
        });
      } catch (e) {
        console.debug(`Skipping pipeline ${def.name}:`, e);
      }
    }
    return matches;
  }
  async function init() {
    if (metricsCollector) metricsCollector.mark("dashboard-init");
    cacheElements();
    setupEventListeners();
    initializePhase5Features();
    try {
      if (isLocalMode()) {
        console.log("[Dashboard] Running in local mode");
        const datasetPath = getLocalDatasetPath();
        loader = new DatasetLoader(datasetPath);
        currentBuildId = null;
        const projectNameEl = document.getElementById("current-project-name");
        if (projectNameEl) {
          projectNameEl.textContent = "Local Dashboard";
        }
        const exportRawZip = document.getElementById("export-raw-zip");
        if (exportRawZip) {
          exportRawZip.style.display = "none";
        }
        await loadDataset();
        return;
      }
      await initializeAdoSdk({
        onReady: () => {
          const webContext = VSS.getWebContext();
          const projectNameEl = document.getElementById("current-project-name");
          if (projectNameEl && webContext?.project?.name) {
            projectNameEl.textContent = webContext.project.name;
          }
        }
      });
      const config = await resolveConfiguration();
      if (config.directUrl) {
        loader = new DatasetLoader(config.directUrl);
        currentBuildId = null;
      } else if (config.buildId && config.artifactName && artifactClient) {
        loader = artifactClient.createDatasetLoader(
          config.buildId,
          config.artifactName
        );
        currentBuildId = config.buildId;
      } else {
        throw new Error("Failed to resolve configuration");
      }
      await loadDataset();
    } catch (error) {
      console.error("Dashboard initialization failed:", error);
      handleError(error);
    }
  }
  function cacheElements() {
    const ids = [
      "app",
      "loading-state",
      "error-state",
      "main-content",
      "error-title",
      "error-message",
      "run-info",
      "date-range",
      "custom-dates",
      "comments-coverage-banner",
      "start-date",
      "end-date",
      "retry-btn",
      "total-prs",
      "cycle-p50",
      "cycle-p90",
      "authors-count",
      "reviewers-count",
      "throughput-chart",
      "cycle-distribution",
      "total-prs-delta",
      "cycle-p50-delta",
      "cycle-p90-delta",
      "authors-delta",
      "reviewers-delta",
      "repo-filter",
      "team-filter",
      "reviewer-filter",
      "reviewer-filter-notice",
      "author-filter",
      "author-filter-options",
      "repo-filter-group",
      "team-filter-group",
      "reviewer-filter-group",
      "author-filter-group",
      "author-filter-notice",
      "clear-filters",
      "active-filters",
      "filter-chips",
      "total-prs-sparkline",
      "cycle-p50-sparkline",
      "cycle-p90-sparkline",
      "authors-sparkline",
      "reviewers-sparkline",
      "cycle-time-trend",
      "reviewer-activity",
      "compare-toggle",
      "comparison-banner",
      "current-period-dates",
      "previous-period-dates",
      "exit-compare",
      "export-btn",
      "export-menu",
      "export-csv",
      "export-link",
      "export-raw-zip",
      "total-prs-label",
      "authors-count-label",
      "reviewers-count-label",
      "reviewer-activity-label"
    ];
    ids.forEach((id) => {
      elements[id] = document.getElementById(id);
    });
    elementLists.tabs = document.querySelectorAll(".tab");
  }
  function initializePhase5Features() {
    console.log("Phase 5 ML features initialized - tabs visible by default");
  }
  function setupEventListeners() {
    elements["date-range"]?.addEventListener("change", handleDateRangeChange);
    document.getElementById("apply-dates")?.addEventListener("click", applyCustomDates);
    elementLists.tabs?.forEach((tab) => {
      const htmlTab = tab;
      htmlTab.addEventListener("click", () => {
        const tabId = htmlTab.dataset["tab"];
        if (tabId) switchTab(tabId);
      });
    });
    elements["retry-btn"]?.addEventListener("click", () => init());
    document.getElementById("setup-retry-btn")?.addEventListener("click", () => init());
    document.getElementById("permission-retry-btn")?.addEventListener("click", () => init());
    elements["repo-filter"]?.addEventListener("change", handleFilterChange);
    elements["team-filter"]?.addEventListener("change", handleFilterChange);
    elements["reviewer-filter"]?.addEventListener("change", handleFilterChange);
    elements["author-filter"]?.addEventListener("change", handleFilterChange);
    elements["clear-filters"]?.addEventListener("click", clearAllFilters);
    elements["compare-toggle"]?.addEventListener("click", toggleComparisonMode);
    elements["exit-compare"]?.addEventListener("click", exitComparisonMode);
    elements["export-btn"]?.addEventListener("click", toggleExportMenu);
    elements["export-csv"]?.addEventListener("click", exportToCsv);
    elements["export-link"]?.addEventListener("click", copyShareableLink);
    elements["export-raw-zip"]?.addEventListener("click", downloadRawDataZip);
    document.addEventListener("click", (e) => {
      const target = e.target;
      if (!target.closest(".export-dropdown")) {
        elements["export-menu"]?.classList.add("hidden");
      }
    });
  }
  async function loadDataset() {
    showLoading();
    try {
      if (!loader) throw new Error("Loader not initialized");
      const manifest = await loader.loadManifest();
      const dimensions = await loader.loadDimensions();
      currentDimensions = dimensions;
      populateFilterDropdowns(dimensions);
      updateDatasetInfo(manifest);
      restoreStateFromUrl();
      setInitialDateRange();
      await refreshMetrics();
      await updateFeatureTabs();
      showContent();
    } catch (error) {
      console.error("Failed to load dataset:", error);
      handleError(error);
    }
  }
  function setInitialDateRange() {
    if (currentDateRange.start && currentDateRange.end) return;
    if (!loader) return;
    const coverage = loader.getCoverage() || null;
    const defaultDays = loader.getDefaultRangeDays() || 90;
    if (coverage?.date_range?.max) {
      const endDate = new Date(coverage.date_range.max);
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - defaultDays);
      currentDateRange = { start: startDate, end: endDate };
      const startDateEl = elements["start-date"];
      const endDateEl = elements["end-date"];
      if (startDateEl) {
        startDateEl.value = startDate.toISOString().split("T")[0] ?? "";
      }
      if (endDateEl) {
        endDateEl.value = endDate.toISOString().split("T")[0] ?? "";
      }
    }
  }
  async function refreshMetrics() {
    if (!currentDateRange.start || !currentDateRange.end || !loader) return;
    const rawRollups = await loader.getWeeklyRollups(
      currentDateRange.start,
      currentDateRange.end
    );
    const distributions = await loader.getDistributions(
      currentDateRange.start,
      currentDateRange.end
    );
    const rollups = applyFiltersToRollups(rawRollups, currentFilters);
    const prevPeriod = getPreviousPeriod(
      currentDateRange.start,
      currentDateRange.end
    );
    let prevRollups = [];
    try {
      const rawPrevRollups = await loader.getWeeklyRollups(
        prevPeriod.start,
        prevPeriod.end
      );
      prevRollups = applyFiltersToRollups(rawPrevRollups, currentFilters);
    } catch (e) {
      console.debug("Previous period data not available:", e);
    }
    cachedRollups = rollups;
    updateAccuracyIndicator(rawRollups, currentFilters);
    updateOverlapIndicator(rawRollups, currentFilters);
    renderSummaryCards2(rollups, prevRollups);
    renderThroughputChart2(rollups);
    renderCycleTimeTrend2(rollups);
    renderReviewerActivity2(rollups);
    renderCycleDistribution2(distributions);
    if (comparisonMode) {
      updateComparisonBanner();
    }
  }
  function updateAccuracyIndicator(rawRollups, filters) {
    const summarySection = document.querySelector(".summary-cards");
    if (!summarySection) return;
    const isTeamRepoFilter = filters.repos.length > 0 && filters.teams.length > 0;
    const isAuthorRepoFilter = filters.repos.length > 0 && filters.authors.length > 0;
    if (!isTeamRepoFilter && !isAuthorRepoFilter) {
      summarySection.removeAttribute("data-accuracy");
      return;
    }
    const isEstimated = (r) => {
      if (isTeamRepoFilter) {
        return r.by_team_and_repo == null || r.by_team_and_repo["_truncated"] === true;
      }
      return r.by_author_and_repo == null || r.by_author_and_repo["_truncated"] === true;
    };
    const hasEstimatedWeeks = rawRollups.some(isEstimated);
    if (hasEstimatedWeeks) {
      const allEstimated = rawRollups.every(isEstimated);
      summarySection.setAttribute(
        "data-accuracy",
        allEstimated ? "approximate" : "mixed"
      );
    } else {
      summarySection.removeAttribute("data-accuracy");
    }
  }
  function updateOverlapIndicator(rawRollups, filters) {
    const summarySection = document.querySelector(".summary-cards");
    if (!summarySection) return;
    const hasMultipleTeams = filters.teams.length > 1;
    const hasRepoFilter = filters.repos.length > 0;
    if (!hasMultipleTeams || !hasRepoFilter) {
      summarySection.removeAttribute("data-overlap");
      return;
    }
    let hasOverlap = false;
    for (const rollup of rawRollups) {
      if (!rollup.by_team_and_repo || !rollup.by_repository) continue;
      if (rollup.by_team_and_repo["_truncated"] === true)
        continue;
      for (const repo of filters.repos) {
        const repoEntry = getOwnRecordValue(rollup.by_repository, repo);
        if (!repoEntry) continue;
        let crossDimSum = 0;
        for (const team of filters.teams) {
          const teamRepos = getOwnRecordValue(rollup.by_team_and_repo, team);
          if (!teamRepos) continue;
          const entry = getOwnRecordValue(teamRepos, repo);
          if (entry) crossDimSum += entry.pr_count;
        }
        if (crossDimSum > repoEntry.pr_count) {
          hasOverlap = true;
          break;
        }
      }
      if (hasOverlap) break;
    }
    if (hasOverlap) {
      summarySection.setAttribute("data-overlap", "true");
    } else {
      summarySection.removeAttribute("data-overlap");
    }
  }
  function renderSummaryCards2(rollups, prevRollups = []) {
    const containers = {
      totalPrs: elements["total-prs"] ?? null,
      cycleP50: elements["cycle-p50"] ?? null,
      cycleP90: elements["cycle-p90"] ?? null,
      authorsCount: elements["authors-count"] ?? null,
      reviewersCount: elements["reviewers-count"] ?? null,
      totalPrsSparkline: elements["total-prs-sparkline"] ?? null,
      cycleP50Sparkline: elements["cycle-p50-sparkline"] ?? null,
      cycleP90Sparkline: elements["cycle-p90-sparkline"] ?? null,
      authorsSparkline: elements["authors-sparkline"] ?? null,
      reviewersSparkline: elements["reviewers-sparkline"] ?? null,
      totalPrsDelta: elements["total-prs-delta"] ?? null,
      cycleP50Delta: elements["cycle-p50-delta"] ?? null,
      cycleP90Delta: elements["cycle-p90-delta"] ?? null,
      authorsDelta: elements["authors-delta"] ?? null,
      reviewersDelta: elements["reviewers-delta"] ?? null
    };
    renderSummaryCards({
      rollups,
      prevRollups,
      containers,
      metricsCollector
    });
  }
  function renderThroughputChart2(rollups) {
    renderThroughputChart(elements["throughput-chart"] ?? null, rollups);
  }
  function renderCycleDistribution2(distributions) {
    renderCycleDistribution(
      elements["cycle-distribution"] ?? null,
      distributions
    );
  }
  function renderCycleTimeTrend2(rollups) {
    renderCycleTimeTrend(elements["cycle-time-trend"] ?? null, rollups);
  }
  function renderReviewerActivity2(rollups) {
    renderReviewerActivity(elements["reviewer-activity"] ?? null, rollups, {
      reviewerFilterActive: currentFilters.reviewers.length > 0
    });
  }
  function toArtifactLoadResult(loaderResult, artifactPath) {
    if (!loaderResult) {
      return { exists: false, data: null, path: artifactPath };
    }
    switch (loaderResult.state) {
      case "missing":
      case "disabled":
      case "unavailable":
        return { exists: false, data: null, path: artifactPath };
      case "invalid":
        return {
          exists: true,
          data: loaderResult.data,
          parseError: loaderResult.message || loaderResult.error || "Schema validation failed",
          path: artifactPath
        };
      case "error":
      case "auth":
      case "auth_required":
        return {
          exists: true,
          data: null,
          parseError: loaderResult.message || loaderResult.error || "Failed to load artifact",
          path: artifactPath
        };
      case "ok":
        return {
          exists: true,
          data: loaderResult.data,
          path: artifactPath
        };
      default:
        return { exists: false, data: null, path: artifactPath };
    }
  }
  async function updateFeatureTabs() {
    if (!loader) return;
    if (!hasMLMethods(loader)) return;
    const predictionsContent = document.getElementById("tab-predictions");
    if (predictionsContent) {
      const predictionsResult = await loader.loadPredictions();
      const loadResult = toArtifactLoadResult(
        predictionsResult,
        "predictions/trends.json"
      );
      const state = resolvePredictionsState(loadResult);
      renderPredictionsForState(predictionsContent, state, cachedRollups);
    }
    const aiContent = document.getElementById("tab-ai-insights");
    if (aiContent) {
      const insightsResult = await loader.loadInsights();
      const loadResult = toArtifactLoadResult(
        insightsResult,
        "insights/summary.json"
      );
      const state = resolveInsightsState(loadResult);
      renderInsightsForState(aiContent, state);
    }
  }
  function handleDateRangeChange(e) {
    const target = e.target;
    const value = target.value;
    if (value === "custom") {
      elements["custom-dates"]?.classList.remove("hidden");
      return;
    }
    elements["custom-dates"]?.classList.add("hidden");
    const days = parseInt(value, 10);
    const coverage = loader?.getCoverage() || null;
    const endDate = coverage?.date_range?.max ? new Date(coverage.date_range.max) : /* @__PURE__ */ new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days);
    currentDateRange = { start: startDate, end: endDate };
    updateUrlState();
    void refreshMetrics();
  }
  function applyCustomDates() {
    const start = elements["start-date"]?.value;
    const end = elements["end-date"]?.value;
    if (!start || !end) return;
    currentDateRange = { start: new Date(start), end: new Date(end) };
    updateUrlState();
    void refreshMetrics();
  }
  function switchTab(tabId) {
    elementLists.tabs?.forEach((tab) => {
      const htmlTab = tab;
      const isActive = htmlTab.dataset["tab"] === tabId;
      htmlTab.classList.toggle("active", isActive);
      htmlTab.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    document.querySelectorAll(".tab-content").forEach((content) => {
      content.classList.toggle("active", content.id === `tab-${tabId}`);
      content.classList.toggle("hidden", content.id !== `tab-${tabId}`);
    });
    updateUrlState();
  }
  function populateFilterDropdowns(dimensions) {
    if (!dimensions) return;
    const repoFilter = getElement("repo-filter");
    if (repoFilter && dimensions.repositories && dimensions.repositories.length > 0) {
      clearElement(repoFilter);
      repoFilter.appendChild(createOption("", "All"));
      dimensions.repositories.forEach((repo) => {
        const option = document.createElement("option");
        option.value = repo.repository_name;
        option.textContent = repo.repository_name;
        repoFilter.appendChild(option);
      });
      elements["repo-filter-group"]?.classList.remove("hidden");
    } else {
      elements["repo-filter-group"]?.classList.add("hidden");
    }
    const teamFilter = getElement("team-filter");
    if (teamFilter && dimensions.teams && dimensions.teams.length > 0) {
      clearElement(teamFilter);
      teamFilter.appendChild(createOption("", "All"));
      dimensions.teams.forEach((team) => {
        const option = document.createElement("option");
        option.value = team.team_name;
        option.textContent = team.team_name;
        teamFilter.appendChild(option);
      });
      elements["team-filter-group"]?.classList.remove("hidden");
    } else {
      elements["team-filter-group"]?.classList.add("hidden");
    }
    const reviewerFilter = getElement("reviewer-filter");
    if (reviewerFilter && dimensions.reviewers && dimensions.reviewers.length > 0) {
      clearElement(reviewerFilter);
      reviewerFilter.appendChild(createOption("", "All"));
      dimensions.reviewers.forEach((reviewer) => {
        const option = document.createElement("option");
        option.value = reviewer.reviewer_id;
        option.textContent = reviewer.reviewer_name;
        reviewerFilter.appendChild(option);
      });
      elements["reviewer-filter-group"]?.classList.remove("hidden");
    } else {
      elements["reviewer-filter-group"]?.classList.add("hidden");
    }
    const authorFilter = getElement("author-filter");
    const authorFilterOptions = getElement(
      "author-filter-options"
    );
    if (authorFilter && authorFilterOptions && dimensions.authors && dimensions.authors.length > 0) {
      clearElement(authorFilterOptions);
      dimensions.authors.forEach((author) => {
        const option = document.createElement("option");
        option.value = author.author_name;
        option.label = author.author_id;
        option.dataset["authorId"] = author.author_id;
        authorFilterOptions.appendChild(option);
      });
      elements["author-filter-group"]?.classList.remove("hidden");
    } else {
      elements["author-filter-group"]?.classList.add("hidden");
    }
    restoreFiltersFromUrl();
  }
  function clearSelectToAll(select) {
    if (!select) return;
    Array.from(select.options).forEach((o) => {
      o.selected = o.value === "";
    });
  }
  function normalizeReviewerSelection(reviewerValues, source) {
    if (reviewerValues.length <= 1) {
      return reviewerValues;
    }
    const ignored = reviewerValues.slice(1);
    console.warn(
      `Reviewer Phase 1 supports a single exact reviewer filter; ignoring additional ${source} values:`,
      ignored
    );
    return reviewerValues[0] ? [reviewerValues[0]] : [];
  }
  function normalizeAuthorSelection(authorValues, dimensions) {
    const firstValue = authorValues[0];
    if (!firstValue) {
      return [];
    }
    const matchedAuthor = dimensions?.authors?.find(
      (author) => author.author_id === firstValue || author.author_name === firstValue
    );
    if (!matchedAuthor) {
      console.warn("Ignoring invalid author filter value:", firstValue);
      return [];
    }
    return [matchedAuthor.author_id];
  }
  function clearAuthorInput() {
    const authorFilter = elements["author-filter"];
    if (authorFilter) {
      authorFilter.value = "";
    }
  }
  function applyAuthorFilterCompatibility(sourceId, filters) {
    if (filters.authors.length === 0) {
      return filters;
    }
    const reviewerFilter = elements["reviewer-filter"];
    if (filters.reviewers.length > 0) {
      if (sourceId === "author-filter") {
        clearSelectToAll(reviewerFilter);
        return { ...filters, reviewers: [] };
      }
      if (sourceId === "reviewer-filter") {
        clearAuthorInput();
        return { ...filters, authors: [] };
      }
      console.warn(
        "Author filters cannot be combined with reviewer filters in the current schema; keeping reviewer filters only"
      );
      clearAuthorInput();
      return { ...filters, authors: [] };
    }
    return filters;
  }
  function applyReviewerFilterCompatibility(sourceId, repoValues, teamValues, reviewerValues) {
    const normalizedReviewers = normalizeReviewerSelection(reviewerValues, "ui");
    const reviewerRepoNotice = "Reviewer + repository uses reviewer-only metrics while retaining repository state.";
    const reviewerTeamNotice = "Reviewer + team is not supported in the current schema. Team selection was cleared.";
    reviewerFilterNoticeMessage = null;
    if (normalizedReviewers.length === 0 || repoValues.length === 0 && teamValues.length === 0) {
      return {
        repos: repoValues,
        teams: teamValues,
        reviewers: normalizedReviewers
      };
    }
    const teamFilter = elements["team-filter"];
    if (teamValues.length > 0) {
      reviewerFilterNoticeMessage = reviewerTeamNotice;
      clearSelectToAll(teamFilter);
      return { repos: repoValues, teams: [], reviewers: normalizedReviewers };
    }
    if (repoValues.length > 0) {
      reviewerFilterNoticeMessage = reviewerRepoNotice;
      if (sourceId !== "reviewer-filter") {
        console.warn(reviewerRepoNotice);
      }
    }
    return { repos: repoValues, teams: [], reviewers: normalizedReviewers };
  }
  function handleFilterChange(event) {
    const repoFilter = elements["repo-filter"];
    const teamFilter = elements["team-filter"];
    const reviewerFilter = elements["reviewer-filter"];
    const authorFilter = elements["author-filter"];
    const repoValues = repoFilter ? Array.from(repoFilter.selectedOptions).map((o) => o.value).filter((v) => v) : [];
    const teamValues = teamFilter ? Array.from(teamFilter.selectedOptions).map((o) => o.value).filter((v) => v) : [];
    const reviewerValues = reviewerFilter ? [reviewerFilter.value].filter((v) => v) : [];
    const authorValues = authorFilter ? [authorFilter.value].filter((v) => v) : [];
    const sourceId = event.currentTarget instanceof HTMLElement ? event.currentTarget.id : null;
    const reviewerCompatibleFilters = applyReviewerFilterCompatibility(
      sourceId,
      repoValues,
      teamValues,
      reviewerValues
    );
    const normalizedFilters = {
      ...reviewerCompatibleFilters,
      authors: normalizeAuthorSelection(authorValues, currentDimensions)
    };
    currentFilters = applyAuthorFilterCompatibility(sourceId, normalizedFilters);
    updateFilterUI();
    updateUrlState();
    void refreshMetrics();
  }
  function clearAllFilters() {
    currentFilters = { repos: [], teams: [], reviewers: [], authors: [] };
    reviewerFilterNoticeMessage = null;
    const repoFilter = elements["repo-filter"];
    const teamFilter = elements["team-filter"];
    const reviewerFilter = elements["reviewer-filter"];
    const authorFilter = elements["author-filter"];
    clearSelectToAll(repoFilter);
    clearSelectToAll(teamFilter);
    clearSelectToAll(reviewerFilter);
    if (authorFilter) {
      authorFilter.value = "";
    }
    updateFilterUI();
    updateUrlState();
    void refreshMetrics();
  }
  function findOptionByValue(select, value) {
    return select?.querySelector(
      `option[value="${CSS.escape(value)}"]`
    );
  }
  function removeFilter(type, value) {
    if (type === "repo") {
      currentFilters.repos = currentFilters.repos.filter((v) => v !== value);
      const repoFilter = elements["repo-filter"];
      const option = findOptionByValue(repoFilter, value);
      if (option) option.selected = false;
    } else if (type === "team") {
      currentFilters.teams = currentFilters.teams.filter((v) => v !== value);
      const teamFilter = elements["team-filter"];
      const option = findOptionByValue(teamFilter, value);
      if (option) option.selected = false;
    } else if (type === "reviewer") {
      currentFilters.reviewers = currentFilters.reviewers.filter(
        (v) => v !== value
      );
      const reviewerFilter = elements["reviewer-filter"];
      const option = findOptionByValue(reviewerFilter, value);
      if (option) option.selected = false;
    } else if (type === "author") {
      currentFilters.authors = currentFilters.authors.filter((v) => v !== value);
      const authorFilter = elements["author-filter"];
      if (authorFilter) authorFilter.value = "";
    }
    updateFilterUI();
    updateUrlState();
    void refreshMetrics();
  }
  function updateFilterUI() {
    const hasFilters = currentFilters.repos.length > 0 || currentFilters.teams.length > 0 || currentFilters.reviewers.length > 0 || currentFilters.authors.length > 0;
    if (elements["clear-filters"]) {
      elements["clear-filters"].classList.toggle("hidden", !hasFilters);
    }
    if (elements["active-filters"] && elements["filter-chips"]) {
      elements["active-filters"].classList.toggle("hidden", !hasFilters);
      if (hasFilters) {
        renderFilterChips();
      } else {
        clearElement(elements["filter-chips"]);
      }
    }
    updateMetricLabels();
  }
  function renderFilterChips() {
    const chipsEl = elements["filter-chips"];
    if (!chipsEl) return;
    const chips = [];
    currentFilters.repos.forEach((value) => {
      const label = getFilterLabel("repo", value);
      chips.push(createFilterChip("repo", value, label));
    });
    currentFilters.teams.forEach((value) => {
      const label = getFilterLabel("team", value);
      chips.push(createFilterChip("team", value, label));
    });
    currentFilters.reviewers.forEach((value) => {
      const label = getFilterLabel("reviewer", value);
      chips.push(createFilterChip("reviewer", value, label));
    });
    currentFilters.authors.forEach((value) => {
      const label = getFilterLabel("author", value);
      chips.push(createFilterChip("author", value, label));
    });
    renderTrustedHtml(chipsEl, chips.join(""));
    if (chipsDelegatedElement !== chipsEl) {
      chipsDelegatedElement = chipsEl;
      chipsEl.addEventListener("click", (e) => {
        const btn = e.target.closest(
          ".filter-chip-remove"
        );
        if (!btn) return;
        const type = btn.dataset["type"];
        const val = btn.dataset["value"];
        if (type && val) removeFilter(type, val);
      });
    }
  }
  function getFilterLabel(type, value) {
    if (type === "repo") {
      const repoFilter = elements["repo-filter"];
      return findOptionByValue(repoFilter, value)?.textContent ?? value;
    }
    if (type === "team") {
      const teamFilter = elements["team-filter"];
      return findOptionByValue(teamFilter, value)?.textContent ?? value;
    }
    if (type === "reviewer") {
      const reviewerFilter = elements["reviewer-filter"];
      return findOptionByValue(reviewerFilter, value)?.textContent ?? value;
    }
    if (type === "author") {
      const authorFilterOptions = elements["author-filter-options"];
      const option = authorFilterOptions?.querySelector(
        `option[data-author-id="${CSS.escape(value)}"]`
      );
      return option?.value ?? value;
    }
    return value;
  }
  function createFilterChip(type, value, label) {
    const prefix = type === "repo" ? "repo" : type === "team" ? "team" : type === "reviewer" ? "reviewer" : "author";
    return `
        <span class="filter-chip">
            <span class="filter-chip-label">${prefix}: ${escapeHtml(label)}</span>
            <span class="filter-chip-remove" data-type="${escapeHtml(type)}" data-value="${escapeHtml(value)}">&times;</span>
        </span>
    `;
  }
  function updateMetricLabels() {
    const reviewerMode = currentFilters.reviewers.length > 0;
    const authorTeamConstrained = currentFilters.authors.length > 0 && currentFilters.teams.length > 0;
    elements["author-filter-notice"]?.classList.toggle(
      "hidden",
      !authorTeamConstrained
    );
    const reviewerNotice = elements["reviewer-filter-notice"];
    if (reviewerNotice) {
      if (reviewerFilterNoticeMessage) {
        reviewerNotice.textContent = reviewerFilterNoticeMessage;
        reviewerNotice.classList.remove("hidden");
        reviewerNotice.classList.add("filter-hint-warning");
      } else {
        reviewerNotice.textContent = "";
        reviewerNotice.classList.add("hidden");
        reviewerNotice.classList.remove("filter-hint-warning");
      }
    }
    if (elements["total-prs-label"]) {
      elements["total-prs-label"].textContent = reviewerMode ? "Reviewed PRs" : "Total PRs";
    }
    if (elements["authors-count-label"]) {
      elements["authors-count-label"].textContent = reviewerMode ? "Reviewed Authors" : "Contributors";
    }
    if (elements["reviewers-count-label"]) {
      elements["reviewers-count-label"].textContent = reviewerMode ? "Reviews" : "Reviewers";
    }
    if (elements["reviewer-activity-label"]) {
      elements["reviewer-activity-label"].textContent = reviewerMode ? "Review Activity" : "Reviewer Activity";
    }
  }
  function restoreFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const reposParam = params.get("repos");
    const teamsParam = params.get("teams");
    const reviewersParam = params.get("reviewers");
    if (reposParam) {
      currentFilters.repos = reposParam.split(",").filter((v) => v);
      const repoFilter = elements["repo-filter"];
      if (repoFilter) {
        const valid = currentFilters.repos.filter(
          (v) => findOptionByValue(repoFilter, v) !== null
        );
        if (valid.length < currentFilters.repos.length) {
          console.warn(
            "Ignoring invalid repo filters from URL:",
            currentFilters.repos.filter((v) => !valid.includes(v))
          );
        }
        currentFilters.repos = valid;
        currentFilters.repos.forEach((value) => {
          const option = findOptionByValue(repoFilter, value);
          if (option) option.selected = true;
        });
      }
    }
    if (teamsParam) {
      currentFilters.teams = teamsParam.split(",").filter((v) => v);
      const teamFilter = elements["team-filter"];
      if (teamFilter) {
        const valid = currentFilters.teams.filter(
          (v) => findOptionByValue(teamFilter, v) !== null
        );
        if (valid.length < currentFilters.teams.length) {
          console.warn(
            "Ignoring invalid team filters from URL:",
            currentFilters.teams.filter((v) => !valid.includes(v))
          );
        }
        currentFilters.teams = valid;
        currentFilters.teams.forEach((value) => {
          const option = findOptionByValue(teamFilter, value);
          if (option) option.selected = true;
        });
      }
    }
    if (reviewersParam) {
      currentFilters.reviewers = normalizeReviewerSelection(
        reviewersParam.split(",").filter((v) => v),
        "url"
      );
      const reviewerFilter = elements["reviewer-filter"];
      if (reviewerFilter) {
        const valid = currentFilters.reviewers.filter(
          (v) => findOptionByValue(reviewerFilter, v) !== null
        );
        if (valid.length < currentFilters.reviewers.length) {
          console.warn(
            "Ignoring invalid reviewer filters from URL:",
            currentFilters.reviewers.filter((v) => !valid.includes(v))
          );
        }
        currentFilters.reviewers = valid;
        reviewerFilter.value = currentFilters.reviewers[0] ?? "";
      }
    }
    const authorParam = params.get("author");
    if (authorParam) {
      currentFilters.authors = normalizeAuthorSelection(
        [authorParam],
        currentDimensions
      );
      const authorFilter = elements["author-filter"];
      if (authorFilter) {
        if (currentFilters.authors.length > 0) {
          const label = getFilterLabel("author", currentFilters.authors[0] ?? "");
          authorFilter.value = label;
        } else {
          authorFilter.value = "";
        }
      }
    }
    currentFilters = applyAuthorFilterCompatibility(null, {
      ...applyReviewerFilterCompatibility(
        null,
        currentFilters.repos,
        currentFilters.teams,
        currentFilters.reviewers
      ),
      authors: currentFilters.authors
    });
    if (currentFilters.authors.length === 0 && authorParam) {
      console.warn("Ignoring invalid author filter from URL:", authorParam);
    }
    updateFilterUI();
  }
  function restoreStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const startParam = params.get("start");
    const endParam = params.get("end");
    if (startParam && endParam) {
      currentDateRange = { start: new Date(startParam), end: new Date(endParam) };
      const dateRangeEl = elements["date-range"];
      if (dateRangeEl) {
        dateRangeEl.value = "custom";
        elements["custom-dates"]?.classList.remove("hidden");
      }
      const startEl = elements["start-date"];
      const endEl = elements["end-date"];
      if (startEl) startEl.value = startParam;
      if (endEl) endEl.value = endParam;
    }
    const tabParam = params.get("tab");
    if (tabParam) {
      setTimeout(() => switchTab(tabParam), 0);
    }
    const compareParam = params.get("compare");
    if (compareParam === "1") {
      comparisonMode = true;
      elements["compare-toggle"]?.classList.add("active");
      elements["comparison-banner"]?.classList.remove("hidden");
    }
  }
  function toggleComparisonMode() {
    comparisonMode = !comparisonMode;
    elements["compare-toggle"]?.classList.toggle("active", comparisonMode);
    elements["comparison-banner"]?.classList.toggle("hidden", !comparisonMode);
    if (comparisonMode) {
      updateComparisonBanner();
    }
    updateUrlState();
    void refreshMetrics();
  }
  function exitComparisonMode() {
    comparisonMode = false;
    elements["compare-toggle"]?.classList.remove("active");
    elements["comparison-banner"]?.classList.add("hidden");
    updateUrlState();
    void refreshMetrics();
  }
  function updateComparisonBanner() {
    if (!currentDateRange.start || !currentDateRange.end) return;
    const formatDate = (date) => date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
    const currentStart = formatDate(currentDateRange.start);
    const currentEnd = formatDate(currentDateRange.end);
    if (elements["current-period-dates"]) {
      elements["current-period-dates"].textContent = `${currentStart} - ${currentEnd}`;
    }
    const prevPeriod = getPreviousPeriod(
      currentDateRange.start,
      currentDateRange.end
    );
    const prevStart = formatDate(prevPeriod.start);
    const prevEnd = formatDate(prevPeriod.end);
    if (elements["previous-period-dates"]) {
      elements["previous-period-dates"].textContent = `${prevStart} - ${prevEnd}`;
    }
    const banner = elements["comparison-banner"];
    if (banner) {
      const hasFilters = currentFilters.repos.length > 0 || currentFilters.teams.length > 0 || currentFilters.reviewers.length > 0 || currentFilters.authors.length > 0;
      banner.setAttribute("data-filtered", hasFilters ? "true" : "false");
    }
  }
  function toggleExportMenu(e) {
    e.stopPropagation();
    elements["export-menu"]?.classList.toggle("hidden");
  }
  function exportToCsv() {
    elements["export-menu"]?.classList.add("hidden");
    if (!cachedRollups || cachedRollups.length === 0) {
      showToast("No data to export", "error");
      return;
    }
    const csvContent = rollupsToCsv(cachedRollups);
    const filename = generateExportFilename("pr-insights", "csv");
    triggerDownload(csvContent, filename);
    showToast("CSV exported successfully", "success");
  }
  async function copyShareableLink() {
    elements["export-menu"]?.classList.add("hidden");
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("Link copied to clipboard", "success");
    } catch (_err) {
      const textArea = document.createElement("textarea");
      textArea.value = window.location.href;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      showToast("Link copied to clipboard", "success");
    }
  }
  async function downloadRawDataZip() {
    elements["export-menu"]?.classList.add("hidden");
    if (!currentBuildId || !artifactClient) {
      showToast("Raw data not available in direct URL mode", "error");
      return;
    }
    try {
      showToast("Preparing download...", "success");
      const artifact = await artifactClient.getArtifactMetadata(
        currentBuildId,
        "csv-output"
      );
      if (!artifact) {
        showToast("Raw CSV artifact not found in this pipeline run", "error");
        return;
      }
      const downloadUrl = artifact.resource?.downloadUrl;
      if (!downloadUrl) {
        showToast("Download URL not available", "error");
        return;
      }
      let zipUrl = downloadUrl;
      if (!zipUrl.includes("format=zip")) {
        const separator = zipUrl.includes("?") ? "&" : "?";
        zipUrl = `${zipUrl}${separator}format=zip`;
      }
      const response = await artifactClient.authenticatedFetch(zipUrl);
      if (!response.ok) {
        if (response.status === 403 || response.status === 401) {
          showToast("Permission denied to download artifacts", "error");
        } else {
          showToast(`Download failed: ${response.statusText}`, "error");
        }
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const dateStr = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      link.download = `pr-insights-raw-data-${dateStr}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast("Download started", "success");
    } catch (err) {
      console.error("Failed to download raw data:", err);
      showToast("Failed to download raw data", "error");
    }
  }
  function showLoading() {
    hideAllPanels();
    elements["loading-state"]?.classList.remove("hidden");
  }
  function showContent() {
    hideAllPanels();
    elements["main-content"]?.classList.remove("hidden");
  }
  function updateDatasetInfo(manifest) {
    const generatedAt = manifest?.generated_at ? new Date(manifest.generated_at).toLocaleString() : "Unknown";
    const runId = manifest?.run_id || "";
    const capabilityState = loader?.getCapabilityState?.() ?? null;
    const commentsCoverage = manifest?.coverage?.comments;
    const commentsBanner = elements["comments-coverage-banner"];
    let commentsSummary = null;
    if (capabilityState?.commentsMetricsAvailable) {
      if (capabilityState.commentsCoverageStatus === "partial") {
        commentsSummary = "Comments coverage: partial";
        if (typeof commentsCoverage === "object" && commentsCoverage !== null && commentsCoverage.capped === true) {
          commentsSummary += " (capped during extraction)";
        }
      } else if (capabilityState.commentsCoverageStatus === "full") {
        commentsSummary = "Comments coverage: full";
      }
    }
    const runInfo = elements["run-info"];
    if (runInfo) {
      runInfo.textContent = `Generated: ${generatedAt}`;
      if (runId) runInfo.textContent += ` | Run: ${runId.slice(0, 8)}`;
      if (commentsSummary) runInfo.textContent += ` | ${commentsSummary}`;
    }
    if (commentsBanner) {
      if (commentsSummary) {
        commentsBanner.textContent = commentsSummary;
        commentsBanner.classList.remove("hidden");
      } else {
        commentsBanner.textContent = "";
        commentsBanner.classList.add("hidden");
      }
    }
  }
  function updateUrlState() {
    const params = new URLSearchParams(window.location.search);
    const newParams = new URLSearchParams();
    const datasetParam = params.get("dataset");
    if (datasetParam) newParams.set("dataset", datasetParam);
    const pipelineIdParam = params.get("pipelineId");
    if (pipelineIdParam) newParams.set("pipelineId", pipelineIdParam);
    if (currentDateRange.start) {
      newParams.set(
        "start",
        currentDateRange.start.toISOString().substring(0, 10)
      );
    }
    if (currentDateRange.end) {
      newParams.set("end", currentDateRange.end.toISOString().substring(0, 10));
    }
    const activeTab = document.querySelector(".tab.active");
    const tabValue = activeTab?.dataset["tab"];
    if (tabValue && tabValue !== "metrics") {
      newParams.set("tab", tabValue);
    }
    if (currentFilters.repos.length > 0) {
      newParams.set("repos", currentFilters.repos.join(","));
    }
    if (currentFilters.teams.length > 0) {
      newParams.set("teams", currentFilters.teams.join(","));
    }
    if (currentFilters.reviewers.length > 0) {
      newParams.set("reviewers", currentFilters.reviewers.join(","));
    }
    if (currentFilters.authors.length > 0) {
      newParams.set("author", currentFilters.authors[0] ?? "");
    }
    if (comparisonMode) {
      newParams.set("compare", "1");
    }
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}?${newParams.toString()}`
    );
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void init());
  } else {
    void init();
  }
})();
// Global exports for browser runtime\nif (typeof window !== 'undefined') { Object.assign(window, PRInsightsDashboard || {}); }
