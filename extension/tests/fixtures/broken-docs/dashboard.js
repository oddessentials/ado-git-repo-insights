"use strict";
var PRInsightsDashboard = (() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

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
      const errorSummary = errors.slice(0, 3).map((e2) => `${e2.field}: ${e2.message}`).join("; ");
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
  function isValidIsoDatetime(input) {
    if (input.length < 19) {
      return false;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.substring(0, 10))) {
      return false;
    }
    if (input.charAt(10) !== "T") {
      return false;
    }
    if (!/^\d{2}:\d{2}:\d{2}$/.test(input.substring(11, 19))) {
      return false;
    }
    let pos = 19;
    if (pos < input.length && input.charAt(pos) === ".") {
      pos++;
      const fracStart = pos;
      while (pos < input.length && /^\d$/.test(input.charAt(pos))) {
        pos++;
      }
      const fracLen = pos - fracStart;
      if (fracLen < 1 || fracLen > 6) {
        return false;
      }
    }
    if (pos < input.length) {
      const tail = input.substring(pos);
      if (tail === "Z") {
        return true;
      }
      if (!/^[+-]\d{2}:\d{2}$/.test(tail)) {
        return false;
      }
    }
    return true;
  }
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
    if (!isValidIsoDatetime(value)) {
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
        data.weekly_rollups.forEach((item, i2) => {
          const result = validateWeeklyRollupEntry(
            item,
            buildPath(path, `weekly_rollups[${i2}]`),
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
        data.distributions.forEach((item, i2) => {
          const result = validateDistributionEntry(
            item,
            buildPath(path, `distributions[${i2}]`),
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
    const requiredStringFields = [
      "reviewer_id",
      "reviewer_name",
      "week",
      "mode",
      "reason"
    ];
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
    "by_team_and_repo",
    // Feature 060 PR-level detail fields (optional on tenant rollups,
    // absent from demo-surface rollups).
    "prs",
    "_prs_truncated",
    "_prs_cap",
    // Feature 333 weekly comments-aggregate (gated on capabilities.comments_metrics).
    // Atomic when present per INV-1-08; absent entirely when capability-off (FR-3-03).
    "comments"
  ]);
  var PR_RECORD_REQUIRED_FIELDS = [
    "id",
    "title",
    "author_id",
    "repository_id",
    "cycle_time"
  ];
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
  function validatePrRecordArray(data, path) {
    const warnings = [];
    if (!isArray(data)) {
      warnings.push(
        createWarning(
          path,
          `'prs' present but not an array (got ${getTypeName(data)}); ignored`
        )
      );
      return { warnings };
    }
    for (const [i2, pr] of data.entries()) {
      const prPath = buildPath(path, i2);
      if (!isObject(pr)) {
        warnings.push(
          createWarning(
            prPath,
            `'prs[${i2}]' is not an object (got ${getTypeName(pr)}); element ignored`
          )
        );
        continue;
      }
      for (const field of PR_RECORD_REQUIRED_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(pr, field)) {
          warnings.push(
            createWarning(
              buildPath(prPath, field),
              `missing required PR field '${field}'; element will be treated as absent`
            )
          );
        }
      }
      if (pr.id !== void 0 && !isNumber(pr.id)) {
        warnings.push(
          createWarning(
            buildPath(prPath, "id"),
            `expected number, got ${getTypeName(pr.id)}`
          )
        );
      }
      if (pr.title !== void 0 && !isString(pr.title)) {
        warnings.push(
          createWarning(
            buildPath(prPath, "title"),
            `expected string, got ${getTypeName(pr.title)}`
          )
        );
      }
      if (pr.author_id !== void 0 && !isString(pr.author_id)) {
        warnings.push(
          createWarning(
            buildPath(prPath, "author_id"),
            `expected string, got ${getTypeName(pr.author_id)}`
          )
        );
      }
      if (pr.repository_id !== void 0 && !isString(pr.repository_id)) {
        warnings.push(
          createWarning(
            buildPath(prPath, "repository_id"),
            `expected string, got ${getTypeName(pr.repository_id)}`
          )
        );
      }
      if (pr.cycle_time !== void 0 && !isNumber(pr.cycle_time)) {
        warnings.push(
          createWarning(
            buildPath(prPath, "cycle_time"),
            `expected number, got ${getTypeName(pr.cycle_time)}`
          )
        );
      }
      const threadCount = pr.thread_count;
      const commentCount = pr.comment_count;
      const activeThreadCount = pr.active_thread_count;
      if (threadCount !== void 0 && threadCount !== null && !isNumber(threadCount)) {
        warnings.push(
          createWarning(
            buildPath(prPath, "thread_count"),
            `expected number or null, got ${getTypeName(threadCount)}`
          )
        );
      }
      if (commentCount !== void 0 && commentCount !== null && !isNumber(commentCount)) {
        warnings.push(
          createWarning(
            buildPath(prPath, "comment_count"),
            `expected number or null, got ${getTypeName(commentCount)}`
          )
        );
      }
      if (activeThreadCount !== void 0 && activeThreadCount !== null && !isNumber(activeThreadCount)) {
        warnings.push(
          createWarning(
            buildPath(prPath, "active_thread_count"),
            `expected number or null, got ${getTypeName(activeThreadCount)}`
          )
        );
      }
      const presentCount = (threadCount !== void 0 ? 1 : 0) + (commentCount !== void 0 ? 1 : 0) + (activeThreadCount !== void 0 ? 1 : 0);
      if (presentCount !== 0 && presentCount !== 3) {
        warnings.push(
          createWarning(
            prPath,
            `comments-metrics atomicity violated (INV-08): expected all three of thread_count / comment_count / active_thread_count to be present together, or all absent; got ${presentCount} of 3 present`
          )
        );
      }
      if (presentCount === 3) {
        const nullCount = (threadCount === null ? 1 : 0) + (commentCount === null ? 1 : 0) + (activeThreadCount === null ? 1 : 0);
        if (nullCount !== 0 && nullCount !== 3) {
          warnings.push(
            createWarning(
              prPath,
              `comments-metrics coverage-partial consistency violated (INV-10): expected thread_count / comment_count / active_thread_count to be all numeric or all null; got ${nullCount} of 3 null`
            )
          );
        }
        if (isNumber(threadCount) && isNumber(activeThreadCount) && activeThreadCount > threadCount) {
          warnings.push(
            createWarning(
              prPath,
              `comments-metrics ordering violated (INV-09): active_thread_count (${activeThreadCount}) MUST NOT exceed thread_count (${threadCount})`
            )
          );
        }
      }
    }
    return { warnings };
  }
  function validateCommentsAggregate(data, path) {
    const errors = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors };
    }
    const requiredFields = [
      "thread_count",
      "comment_count",
      "active_thread_count",
      "coverage_partial"
    ];
    const missing = requiredFields.filter(
      (field) => !Object.prototype.hasOwnProperty.call(data, field)
    );
    if (missing.length > 0) {
      errors.push(
        createError(
          path,
          "all four of thread_count / comment_count / active_thread_count / coverage_partial",
          `missing: ${missing.join(", ")}`,
          `comments-aggregate atomicity violated (INV-1-08): expected all four of thread_count / comment_count / active_thread_count / coverage_partial; missing: ${missing.join(", ")}`
        )
      );
    }
    const numericFieldChecks = [
      { name: "thread_count", value: data.thread_count },
      { name: "comment_count", value: data.comment_count },
      { name: "active_thread_count", value: data.active_thread_count }
    ];
    for (const { name, value } of numericFieldChecks) {
      if (!Object.prototype.hasOwnProperty.call(data, name)) {
        continue;
      }
      if (value === null) {
        errors.push(
          createError(
            buildPath(path, name),
            "number (non-null per INV-1-08; zero is the valid sum over an empty extracted-subset)",
            "null",
            `comments.${name} MUST be a non-null number (INV-1-08); null is not a valid sentinel \u2014 use 0 for an empty extracted-subset`
          )
        );
      } else if (!isNumber(value)) {
        errors.push(
          createError(
            buildPath(path, name),
            "number",
            getTypeName(value),
            `expected number at 'comments.${name}', got ${getTypeName(value)}`
          )
        );
      }
    }
    if (Object.prototype.hasOwnProperty.call(data, "coverage_partial")) {
      const coveragePartial = data.coverage_partial;
      if (!isBoolean(coveragePartial)) {
        errors.push(
          createError(
            buildPath(path, "coverage_partial"),
            "boolean",
            getTypeName(coveragePartial),
            `expected boolean at 'comments.coverage_partial', got ${getTypeName(coveragePartial)}`
          )
        );
      }
    }
    return { errors };
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
    const prsValue = data.prs;
    const truncatedValue = data._prs_truncated;
    const capValue = data._prs_cap;
    const hasPrs = prsValue !== void 0;
    const hasTruncated = truncatedValue !== void 0;
    const hasCap = capValue !== void 0;
    if (hasPrs) {
      const prsResult = validatePrRecordArray(prsValue, "prs");
      warnings.push(...prsResult.warnings);
      if (!hasTruncated) {
        warnings.push(
          createWarning(
            "_prs_truncated",
            "'prs' present but '_prs_truncated' absent; treated as false"
          )
        );
      } else if (!isBoolean(truncatedValue)) {
        warnings.push(
          createWarning(
            "_prs_truncated",
            `expected boolean, got ${getTypeName(truncatedValue)}`
          )
        );
      }
      if (!hasCap) {
        warnings.push(
          createWarning(
            "_prs_cap",
            "'prs' present but '_prs_cap' absent; truncation-indicator math will be skipped"
          )
        );
      } else if (!isNumber(capValue)) {
        warnings.push(
          createWarning(
            "_prs_cap",
            `expected number, got ${getTypeName(capValue)}`
          )
        );
      }
    } else {
      if (hasTruncated) {
        warnings.push(
          createWarning(
            "_prs_truncated",
            "'_prs_truncated' present without 'prs'; ignored"
          )
        );
      }
      if (hasCap) {
        warnings.push(
          createWarning("_prs_cap", "'_prs_cap' present without 'prs'; ignored")
        );
      }
    }
    if (Object.prototype.hasOwnProperty.call(data, "comments") && data.comments !== void 0) {
      const commentsResult = validateCommentsAggregate(data.comments, "comments");
      errors.push(...commentsResult.errors);
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
      data.repositories.forEach((item, i2) => {
        const result = validateRepositoryEntry(
          item,
          buildPath("repositories", i2),
          strict
        );
        errors.push(...result.errors);
        warnings.push(...result.warnings);
      });
    }
    if ("users" in data && isArray(data.users)) {
      data.users.forEach((item, i2) => {
        const result = validateUserEntry(item, buildPath("users", i2), strict);
        errors.push(...result.errors);
        warnings.push(...result.warnings);
      });
    }
    if ("reviewers" in data && data.reviewers !== void 0) {
      const arrErr = validateArray(data.reviewers, "reviewers");
      if (arrErr) {
        errors.push(arrErr);
      } else if (isArray(data.reviewers)) {
        data.reviewers.forEach((item, i2) => {
          const result = validateReviewerEntry(
            item,
            buildPath("reviewers", i2),
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
        data.authors.forEach((item, i2) => {
          const result = validateAuthorEntry(
            item,
            buildPath("authors", i2),
            strict
          );
          errors.push(...result.errors);
          warnings.push(...result.warnings);
        });
      }
    }
    if ("projects" in data && isArray(data.projects)) {
      data.projects.forEach((item, i2) => {
        const result = validateProjectEntry(
          item,
          buildPath("projects", i2),
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
        data.teams.forEach((item, i2) => {
          const result = validateTeamEntry(item, buildPath("teams", i2), strict);
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
        data.values.forEach((item, i2) => {
          const result = validateForecastValue(
            item,
            buildPath(path, `values[${i2}]`),
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
        data.forecasts.forEach((item, i2) => {
          const result = validateForecastEntry(
            item,
            buildPath("forecasts", i2),
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
        result.warnings.map((w2) => w2.message).join("; ")
      );
    }
  }
  var SUPPORTED_MANIFEST_VERSION = 1;
  var SUPPORTED_DATASET_VERSION = 1;
  var SUPPORTED_AGGREGATES_VERSION = 3;
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
    const r2 = rollup;
    return {
      // Preserve all existing fields
      ...r2,
      // Ensure required fields have defaults (don't override if already set)
      pr_count: r2.pr_count ?? ROLLUP_FIELD_DEFAULTS.pr_count,
      cycle_time_p50: r2.cycle_time_p50 ?? ROLLUP_FIELD_DEFAULTS.cycle_time_p50,
      cycle_time_p90: r2.cycle_time_p90 ?? ROLLUP_FIELD_DEFAULTS.cycle_time_p90,
      authors_count: r2.authors_count ?? ROLLUP_FIELD_DEFAULTS.authors_count,
      reviewers_count: r2.reviewers_count ?? ROLLUP_FIELD_DEFAULTS.reviewers_count,
      // by_repository and by_team are optional features - preserve null if missing
      by_repository: r2.by_repository !== void 0 ? r2.by_repository : null,
      by_author: r2.by_author !== void 0 ? r2.by_author : null,
      ...r2.by_author_and_repo !== void 0 ? {
        by_author_and_repo: r2.by_author_and_repo
      } : {},
      by_team: r2.by_team !== void 0 ? r2.by_team : null,
      by_reviewer: r2.by_reviewer !== void 0 ? r2.by_reviewer : null,
      // Cross-dimensional breakdown (v2 schema) — pass through if present
      ...r2.by_team_and_repo !== void 0 ? {
        by_team_and_repo: r2.by_team_and_repo
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
        const paramsMap = new Map(Object.entries(params));
        for (const field of requiredKeyFields) {
          if (!paramsMap.get(field)) {
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
          for (const [k2, v2] of entries) {
            if (v2.touchedAt < oldestTime) {
              oldestTime = v2.touchedAt;
              oldestKey = k2;
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
      const m2 = manifest;
      if (m2.manifest_schema_version !== void 0 && m2.manifest_schema_version > SUPPORTED_MANIFEST_VERSION) {
        throw new Error(
          `Manifest version ${m2.manifest_schema_version} not supported. Maximum supported: ${SUPPORTED_MANIFEST_VERSION}. Please update the extension.`
        );
      }
      if (m2.dataset_schema_version !== void 0 && m2.dataset_schema_version > SUPPORTED_DATASET_VERSION) {
        throw new Error(
          `Dataset version ${m2.dataset_schema_version} not supported. Please update the extension.`
        );
      }
      if (m2.aggregates_schema_version !== void 0 && m2.aggregates_schema_version > SUPPORTED_AGGREGATES_VERSION) {
        throw new Error(
          `Aggregates version ${m2.aggregates_schema_version} not supported. Please update the extension.`
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
          (r2) => r2.week === weekStr
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
      return results.sort((a2, b2) => a2.week.localeCompare(b2.week));
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
      for (let i2 = 0; i2 < weeksToFetch.length; i2 += fetchSemaphore.maxConcurrent) {
        batches.push(weeksToFetch.slice(i2, i2 + fetchSemaphore.maxConcurrent));
      }
      let loaded = 0;
      const total = weeksToFetch.length;
      for (const batch of batches) {
        const batchPromises = batch.map(async (weekStr) => {
          onProgress({ loaded, total, currentWeek: weekStr });
          const indexEntry = this.manifest?.aggregate_index?.weekly_rollups?.find(
            (r2) => r2.week === weekStr
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
        data: allData.sort((a2, b2) => a2.week.localeCompare(b2.week)),
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
          (d2) => d2.year === yearStr
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
      const featuresMap = new Map(Object.entries(this.manifest.features ?? {}));
      return featuresMap.get(feature) === true;
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
            schemaResult.errors.map((e2) => e2.message).join("; ")
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
            schemaResult.warnings.map((w2) => w2.message).join("; ")
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
      const p2 = predictions;
      if (typeof p2.schema_version !== "number") {
        return { valid: false, error: "Missing schema_version" };
      }
      if (p2.schema_version > 1) {
        return {
          valid: false,
          error: `Unsupported schema version: ${p2.schema_version}`
        };
      }
      if (!Array.isArray(p2.forecasts)) {
        return { valid: false, error: "Missing forecasts array" };
      }
      for (const forecast of p2.forecasts) {
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
      const i2 = insights;
      if (typeof i2.schema_version !== "number") {
        return { valid: false, error: "Missing schema_version" };
      }
      if (i2.schema_version > 1) {
        return {
          valid: false,
          error: `Unsupported schema version: ${i2.schema_version}`
        };
      }
      if (!Array.isArray(i2.insights)) {
        return { valid: false, error: "Missing insights array" };
      }
      for (const insight of i2.insights) {
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
      const d2 = new Date(
        Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
      );
      const dayNum = d2.getUTCDay() || 7;
      d2.setUTCDate(d2.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d2.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(
        ((d2.getTime() - yearStart.getTime()) / 864e5 + 1) / 7
      );
      return `${d2.getUTCFullYear()}-W${weekNo.toString().padStart(2, "0")}`;
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

  // ../ui/modules/api-versions.ts
  var ADO_REST_API_VERSIONS = ["7.1", "6.0", "5.1"];
  var EXTENSION_DATA_API_VERSION = "7.1-preview.1";
  async function fetchWithVersionFallback(buildUrl, fetchFn, options) {
    let lastError = null;
    for (const version of ADO_REST_API_VERSIONS) {
      const response = await fetchFn(buildUrl(version));
      if (response.status === 401 || response.status === 403) {
        return { response, version };
      }
      if (response.status === 400 || options.isListEndpoint && response.status === 404) {
        lastError = new Error(`API api-version=${version}: ${response.status}`);
        continue;
      }
      return { response, version };
    }
    throw lastError ?? new Error("No compatible API version found");
  }

  // ../ui/artifact-client.ts
  var LIST_ENDPOINT_FAMILIES = /* @__PURE__ */ new Set([
    "definitions",
    "builds",
    "artifacts"
  ]);
  var ArtifactClient = class {
    /**
     * Create a new ArtifactClient.
     *
     * @param projectId - Azure DevOps project ID
     */
    constructor(projectId) {
      this.collectionUri = null;
      this.tokenProvider = null;
      this.initialized = false;
      /** Per-family API version cache. Scoped to this client instance,
       *  which is bound to a single collectionUri + projectId by
       *  initialize(). A new context requires a new client instance. */
      this.resolvedApiVersions = /* @__PURE__ */ new Map();
      this.projectId = projectId;
    }
    /**
     * Initialize the client with authentication credentials.
     * MUST be called after SDK initialization and before any other methods.
     *
     * @param collectionUri - Azure DevOps collection/organization base URI
     * @param tokenProvider - Async function that returns a fresh Bearer token
     *   per request. The host manages token lifecycle; callers should pass
     *   the SDK's getAccessToken function directly.
     * @returns This client instance
     */
    async initialize(collectionUri, tokenProvider) {
      if (this.initialized) {
        return this;
      }
      this.collectionUri = collectionUri;
      this.tokenProvider = tokenProvider;
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
      const response = await this._fetchWithVersionFallback(
        "artifact-file",
        (v2) => this._buildFileUrl(buildId, artifactName, filePath, v2)
      );
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
        const response = await this._fetchWithVersionFallback(
          "artifact-file",
          (v2) => this._buildFileUrl(buildId, artifactName, filePath, v2),
          { method: "HEAD" }
        );
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
        (a2) => a2.name === artifactName
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
     * Fetch a URL with API version fallback. If the version is already
     * cached, uses it directly. Otherwise delegates to the shared
     * fetchWithVersionFallback probe and caches on success.
     *
     * @param family Endpoint family for per-route version caching
     * @param buildUrl Function that builds the URL for a given api-version
     * @param options Optional fetch options (e.g., { method: "HEAD" })
     */
    async _fetchWithVersionFallback(family, buildUrl, options) {
      this._ensureInitialized();
      const cachedVersion = this.resolvedApiVersions.get(family);
      if (cachedVersion) {
        return this._authenticatedFetch(buildUrl(cachedVersion), options);
      }
      const isListEndpoint = LIST_ENDPOINT_FAMILIES.has(family);
      const { response, version } = await fetchWithVersionFallback(
        buildUrl,
        (url) => this._authenticatedFetch(url, options),
        { isListEndpoint }
      );
      if (response.ok) {
        this.resolvedApiVersions.set(family, version);
      }
      return response;
    }
    /**
     * Get list of artifacts for a build.
     */
    async getArtifacts(buildId) {
      this._ensureInitialized();
      const response = await this._fetchWithVersionFallback(
        "artifacts",
        (v2) => `${this.collectionUri}${this.projectId}/_apis/build/builds/${buildId}/artifacts?api-version=${v2}`
      );
      if (response.status === 401 || response.status === 403) {
        throw createPermissionDeniedError("list build artifacts");
      }
      if (response.status === 404) {
        throw new Error(`Build ${buildId} not found or has been deleted`);
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
      const response = await this._fetchWithVersionFallback(
        "definitions",
        (v2) => `${this.collectionUri}${this.projectId}/_apis/build/definitions?api-version=${v2}&$top=${top}&queryOrder=${queryOrder}`
      );
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
      const response = await this._fetchWithVersionFallback(
        "builds",
        (v2) => `${this.collectionUri}${this.projectId}/_apis/build/builds?api-version=${v2}&definitions=${definitionId}&statusFilter=2&resultFilter=6&$top=${top}`
      );
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
     * Takes an explicit API version — callers route through
     * _fetchWithVersionFallback which provides the version.
     */
    _buildFileUrl(buildId, artifactName, filePath, apiVersion) {
      const normalizedPath = filePath.startsWith("/") ? filePath : "/" + filePath;
      return `${this.collectionUri}${this.projectId}/_apis/build/builds/${buildId}/artifacts?artifactName=${encodeURIComponent(artifactName)}&%24format=file&subPath=${encodeURIComponent(normalizedPath)}&api-version=${apiVersion}`;
    }
    /**
     * Perform an authenticated fetch using the ADO auth token.
     */
    async _authenticatedFetch(url, options = {}) {
      if (!this.tokenProvider) {
        throw new Error(
          "ArtifactClient not initialized. Call initialize() first."
        );
      }
      const token = await this.tokenProvider();
      const headers = {
        Authorization: `Bearer ${token}`,
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
      const SUPPORTED_AGGREGATES_VERSION2 = 3;
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
          (r2) => r2.week === weekStr
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
        } catch (e2) {
          console.warn("Failed to load rollup for %s:", weekStr, e2);
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
          (d2) => d2.year === yearStr
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
        } catch (e2) {
          console.warn("Failed to load distribution for %s:", yearStr, e2);
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
      const d2 = new Date(
        Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
      );
      d2.setUTCDate(d2.getUTCDate() + 4 - (d2.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(d2.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(
        ((d2.getTime() - yearStart.getTime()) / 864e5 + 1) / 7
      );
      return `${d2.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
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
      } catch (e2) {
        console.warn("Failed to load predictions:", e2);
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
      } catch (e2) {
        console.warn("Failed to load AI insights:", e2);
        return { state: "unavailable" };
      }
    }
  };
  var MockArtifactClient = class {
    constructor(mockData = {}) {
      this.projectId = "mock-project";
      this.initialized = true;
      this.mockData = new Map(Object.entries(mockData));
    }
    async initialize() {
      return this;
    }
    async getArtifactFile(buildId, artifactName, filePath) {
      const key = `${buildId}/${artifactName}/${filePath}`;
      if (this.mockData.has(key)) {
        return JSON.parse(JSON.stringify(this.mockData.get(key)));
      }
      throw new Error(`Mock: File not found: ${key}`);
    }
    async hasArtifactFile(buildId, artifactName, filePath) {
      const key = `${buildId}/${artifactName}/${filePath}`;
      return this.mockData.has(key);
    }
    async getArtifacts(buildId) {
      return this.mockData.get(`${buildId}/artifacts`) ?? [];
    }
    async getDefinitions() {
      return this.mockData.get("definitions") ?? [];
    }
    async getBuilds(definitionId) {
      return this.mockData.get(`builds/${definitionId}`) ?? [];
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

  // ../ui/modules/shared/chart-layout.ts
  function renderTruncationIndicator(truncated, maxPoints, noun = "weeks") {
    if (!truncated) return "";
    return `<div class="truncation-indicator truncation-badge">Showing last ${maxPoints} ${noun}</div>`;
  }

  // ../ui/modules/shared/constants.ts
  var LOW_SAMPLE_THRESHOLD = 10;
  var MODERATE_SAMPLE_THRESHOLD = 30;
  var LOW_WEEK_THRESHOLD = 3;
  var MODERATE_WEEK_THRESHOLD = 8;
  var SPARKLINE_HIGHLIGHT_MS = 1500;
  var COMPARISON_ADVISORY_TOAST_MS = 4e3;

  // ../ui/modules/shared/security.ts
  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  // ../ui/modules/shared/render.ts
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
  function appendText(parent, text) {
    const textNode = document.createTextNode(text);
    parent.appendChild(textNode);
    return textNode;
  }
  function renderNoData(container, message, hint) {
    if (!container) return;
    clearElement(container);
    const p2 = createElement("p", { class: "no-data" }, message);
    container.appendChild(p2);
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
  function formatWeekLabel(week) {
    const match = week.match(/(\d{4})-W(\d{2})/);
    if (!match) return week;
    return `W${match[2]}`;
  }
  function median(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return 0;
    const sorted = [...arr].sort((a2, b2) => a2 - b2);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted.at(mid) ?? 0 : ((sorted.at(mid - 1) ?? 0) + (sorted.at(mid) ?? 0)) / 2;
  }

  // ../ui/modules/shared/focus-trap.ts
  var FOCUSABLE_SELECTOR = '[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';
  var trapStates = /* @__PURE__ */ new WeakMap();
  function getFocusableElements(root) {
    const nodes = root.querySelectorAll(FOCUSABLE_SELECTOR);
    return Array.from(nodes).filter(
      (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1
    );
  }
  function trapFocus(root) {
    const controller = new AbortController();
    const returnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    trapStates.set(controller, { root, returnTarget });
    if (!root.contains(document.activeElement)) {
      const first = getFocusableElements(root)[0];
      first?.focus();
    }
    const handleKeydown = (event) => {
      if (event.key !== "Tab") return;
      const focusables = getFocusableElements(root);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const active2 = document.activeElement;
      if (event.shiftKey) {
        if (active2 === first || !root.contains(active2)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (active2 === last || !root.contains(active2)) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    root.addEventListener("keydown", handleKeydown, {
      signal: controller.signal
    });
    return controller;
  }
  function restoreFocus(controller) {
    const state = trapStates.get(controller);
    controller.abort();
    if (state && state.returnTarget && !state.returnTarget.isConnected) {
      return;
    }
    state?.returnTarget?.focus();
  }

  // ../ui/modules/drilldown/lifecycle-signals.ts
  var FILTERS_CHANGED_EVENT = "drilldown:filters-changed";
  var TAB_CHANGED_EVENT = "drilldown:tab-changed";
  var COMPARISON_TOGGLED_EVENT = "drilldown:comparison-toggled";
  function publishFiltersChanged(detail) {
    window.dispatchEvent(
      new CustomEvent(FILTERS_CHANGED_EVENT, { detail })
    );
  }
  function publishTabChanged(detail) {
    window.dispatchEvent(
      new CustomEvent(TAB_CHANGED_EVENT, { detail })
    );
  }
  function publishComparisonToggled(detail) {
    window.dispatchEvent(
      new CustomEvent(COMPARISON_TOGGLED_EVENT, {
        detail
      })
    );
  }

  // ../ui/modules/tooltip-manager.ts
  var scrollDismissController = null;
  function ensureScrollDismissListener() {
    if (scrollDismissController) return;
    scrollDismissController = new AbortController();
    const { signal } = scrollDismissController;
    const dismiss = () => dismissAllTooltips();
    window.addEventListener("scroll", dismiss, { signal, passive: true });
    window.addEventListener("resize", dismiss, { signal, passive: true });
  }
  function releaseScrollDismissListener() {
    scrollDismissController?.abort();
    scrollDismissController = null;
  }
  function dismissAllTooltips() {
    const chartTooltip = document.querySelector(".chart-tooltip");
    if (chartTooltip) chartTooltip.remove();
    const infoTooltip = document.querySelector(".info-tooltip");
    if (infoTooltip) infoTooltip.remove();
    releaseScrollDismissListener();
  }
  function positionTooltip(tooltip, targetRect) {
    tooltip.style.visibility = "hidden";
    tooltip.style.position = "fixed";
    document.body.appendChild(tooltip);
    const tooltipRect = tooltip.getBoundingClientRect();
    const gap = 8;
    let top = targetRect.top - tooltipRect.height - gap;
    if (top < 0) {
      top = targetRect.bottom + gap;
    }
    if (top + tooltipRect.height > window.innerHeight) {
      top = window.innerHeight - tooltipRect.height - 4;
    }
    let left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
    if (left < 4) {
      left = 4;
    }
    if (left + tooltipRect.width > window.innerWidth - 4) {
      left = window.innerWidth - tooltipRect.width - 4;
    }
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
    tooltip.style.visibility = "";
  }
  function showChartTooltip(target, content) {
    dismissAllTooltips();
    const tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip";
    renderTrustedHtml(tooltip, content);
    tooltip.style.position = "fixed";
    const rect = target.getBoundingClientRect();
    positionTooltip(tooltip, rect);
    ensureScrollDismissListener();
  }
  function showInfoTooltip(target, content) {
    dismissAllTooltips();
    const tooltip = document.createElement("div");
    tooltip.className = "info-tooltip";
    tooltip.textContent = content;
    tooltip.style.position = "fixed";
    const rect = target.getBoundingClientRect();
    positionTooltip(tooltip, rect);
    ensureScrollDismissListener();
  }

  // ../ui/modules/shared/detail-panel.ts
  function isPartialPrRow(row) {
    return row.threadCount === null || row.threadCount === void 0;
  }
  function makePanelContent(title, subtitle, sections) {
    if (title.length === 0) {
      throw new TypeError("PanelContent.title MUST be non-empty");
    }
    if (sections.length === 0) {
      throw new TypeError(
        "PanelContent.sections MUST contain at least one section"
      );
    }
    return { title, subtitle, sections };
  }
  function makeBreakdownTable(title, columns, rows) {
    const expectedValues = columns.length - 1;
    for (const row of rows) {
      if (row.values.length !== expectedValues) {
        throw new TypeError(
          `BreakdownTableSection row has ${row.values.length} values but expected ${expectedValues} (columns.length - 1)`
        );
      }
    }
    return { type: "breakdown-table", title, columns, rows };
  }
  function makeStatRow(stats) {
    return { type: "stat-row", stats };
  }
  function makeEmptyState(title, detail) {
    return { type: "empty-state", title, detail };
  }
  function makePrListSection(input) {
    if (input.contentState === "pr-list") {
      return {
        type: "pr-list",
        contentState: "pr-list",
        rows: input.rows,
        renderedCount: input.renderedCount,
        actualFilteredCount: input.actualFilteredCount,
        capValue: input.capValue,
        commentsMetricsAvailable: input.commentsMetricsAvailable
      };
    }
    return { type: "pr-list", contentState: input.contentState };
  }
  var panelEls = null;
  var panelState = "closed";
  var activeContext = null;
  var focusTrapController = null;
  var openScopedController = null;
  var comparisonActive = false;
  {
    const lifetimeComparisonListener = (evt) => {
      const e2 = evt;
      comparisonActive = e2.detail.enabled;
    };
    window.addEventListener(COMPARISON_TOGGLED_EVENT, lifetimeComparisonListener);
  }
  var outsideClickAbort = null;
  var outsideClickFrame = null;
  function clearOutsideClickListener() {
    outsideClickAbort?.abort();
    outsideClickAbort = null;
    if (outsideClickFrame !== null) {
      cancelAnimationFrame(outsideClickFrame);
      outsideClickFrame = null;
    }
  }
  function ensurePanelEls() {
    if (panelEls && !panelEls.root.isConnected) {
      panelEls = null;
      panelState = "closed";
      activeContext = null;
      openScopedController?.abort();
      openScopedController = null;
      focusTrapController?.abort();
      focusTrapController = null;
    }
    if (panelEls) return panelEls;
    const root = document.createElement("aside");
    root.className = "detail-panel";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "detail-panel-title");
    const header = createElement("div", { class: "detail-panel-header" });
    const titleEl = createElement("h2", { id: "detail-panel-title" });
    header.appendChild(titleEl);
    const subtitleEl = createElement("p", { class: "detail-panel-subtitle" });
    header.appendChild(subtitleEl);
    const closeBtn = createElement(
      "button",
      {
        type: "button",
        class: "detail-panel-close",
        "aria-label": "Close detail panel"
      },
      "\xD7"
    );
    closeBtn.addEventListener("click", () => {
      dismissDetailPanel("explicit-close-button");
    });
    header.appendChild(closeBtn);
    root.appendChild(header);
    const sectionsRoot = createElement("div", {
      class: "detail-panel-sections"
    });
    root.appendChild(sectionsRoot);
    document.body.appendChild(root);
    panelEls = { root, sectionsRoot, titleEl, subtitleEl, closeBtn };
    return panelEls;
  }
  function renderContent(els, content) {
    clearElement(els.titleEl);
    appendText(els.titleEl, content.title);
    clearElement(els.subtitleEl);
    if (content.subtitle !== null) {
      appendText(els.subtitleEl, content.subtitle);
      els.subtitleEl.style.display = "";
    } else {
      els.subtitleEl.style.display = "none";
    }
    clearElement(els.sectionsRoot);
    for (const section of content.sections) {
      els.sectionsRoot.appendChild(renderSection(section));
    }
  }
  function renderSection(section) {
    switch (section.type) {
      case "breakdown-table":
        return renderBreakdownTable(section);
      case "stat-row":
        return renderStatRow(section);
      case "empty-state":
        return renderEmptyState(section);
      case "pr-list":
        return renderPrListSection(section);
    }
  }
  function renderBreakdownTable(section) {
    const wrapper = createElement("section", {
      class: "detail-panel-section detail-panel-section--breakdown-table"
    });
    const heading = createElement("h3", {}, section.title);
    wrapper.appendChild(heading);
    const table = createElement("table", { class: "detail-panel-table" });
    const thead = createElement("thead");
    const headerRow = createElement("tr");
    for (const col of section.columns) {
      const th = createElement("th", { scope: "col" }, col);
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = createElement("tbody");
    for (const row of section.rows) {
      const tr = createElement("tr");
      const firstCell = createElement("th", { scope: "row" }, row.label);
      tr.appendChild(firstCell);
      for (const value of row.values) {
        tr.appendChild(createElement("td", {}, value));
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrapper.appendChild(table);
    return wrapper;
  }
  function renderStatRow(section) {
    const wrapper = createElement("section", {
      class: "detail-panel-section detail-panel-section--stat-row"
    });
    const list = createElement("dl", { class: "detail-panel-stats" });
    for (const stat of section.stats) {
      const dt = createElement("dt", {}, stat.label);
      const ddAttrs = {};
      if (stat.tone !== void 0) {
        ddAttrs["data-tone"] = stat.tone;
      }
      const dd = createElement("dd", ddAttrs, stat.value);
      list.appendChild(dt);
      list.appendChild(dd);
    }
    wrapper.appendChild(list);
    return wrapper;
  }
  function renderEmptyState(section) {
    const wrapper = createElement("section", {
      class: "detail-panel-section detail-panel-section--empty-state"
    });
    wrapper.appendChild(createElement("h3", {}, section.title));
    wrapper.appendChild(
      createElement("p", { class: "detail-panel-empty-detail" }, section.detail)
    );
    return wrapper;
  }
  var COMMENTS_METRICS_AXES = [
    {
      key: "threads",
      label: "Threads",
      headerLabel: "Threads",
      dataAttr: "data-threads"
    },
    {
      key: "comments",
      label: "Comments",
      headerLabel: "Comments",
      dataAttr: "data-comments"
    },
    {
      key: "unresolved",
      label: "Unresolved threads",
      headerLabel: "Unresolved",
      dataAttr: "data-unresolved"
    }
  ];
  function readMetricValue(li, dataAttr) {
    const raw = li.getAttribute(dataAttr);
    if (raw === null) return null;
    return Number.parseInt(raw, 10);
  }
  function buildPrListHeader(list, options) {
    const { commentsMetricsAvailable, sortRowElements } = options;
    const withSortButtons = sortRowElements !== null;
    const header = createElement("div", {
      class: commentsMetricsAvailable ? "detail-panel-pr-list-header detail-panel-pr-list-header--with-comments" : "detail-panel-pr-list-header",
      role: "row"
    });
    header.appendChild(
      createElement(
        "div",
        {
          class: "detail-panel-pr-list-header-cell detail-panel-pr-list-header-cell--pr",
          role: "columnheader"
        },
        "PR"
      )
    );
    header.appendChild(
      createElement(
        "div",
        {
          class: "detail-panel-pr-list-header-cell detail-panel-pr-list-header-cell--cycle",
          role: "columnheader"
        },
        "Cycle"
      )
    );
    if (!commentsMetricsAvailable) return header;
    const records = [];
    const sortAnnouncer = createElement("div", {
      role: "status",
      "aria-live": "polite",
      class: "visually-hidden detail-panel-pr-list-sort-announcer"
    });
    for (const axis of COMMENTS_METRICS_AXES) {
      const cellAttrs = {
        class: `detail-panel-pr-list-header-cell detail-panel-pr-list-header-cell--${axis.key}`,
        role: "columnheader"
      };
      if (withSortButtons) {
        cellAttrs["aria-sort"] = "none";
      }
      const cell = createElement("div", cellAttrs);
      if (!withSortButtons) {
        if (axis.headerLabel !== axis.label) {
          cell.setAttribute("title", axis.label);
          cell.setAttribute("aria-label", axis.label);
        }
        appendText(cell, axis.headerLabel);
        header.appendChild(cell);
        continue;
      }
      const button = createElement("button", {
        type: "button",
        class: "detail-panel-pr-list-header-sort",
        "data-sort-key": axis.key,
        "aria-label": `Sort by ${axis.label.toLowerCase()}`
      });
      if (axis.headerLabel !== axis.label) {
        button.setAttribute("title", axis.label);
      }
      appendText(button, axis.headerLabel);
      cell.appendChild(button);
      header.appendChild(cell);
      const record = { axis, cell, state: "none" };
      records.push(record);
      const originalOrder = sortRowElements;
      button.addEventListener("click", () => {
        const nextDirection = advanceSortDirection(record.state);
        for (const peer of records) {
          if (peer === record) continue;
          peer.state = "none";
          peer.cell.setAttribute("aria-sort", "none");
        }
        record.state = nextDirection;
        record.cell.setAttribute("aria-sort", nextDirection);
        applySort(list, axis.dataAttr, nextDirection, originalOrder);
        sortAnnouncer.textContent = "";
        sortAnnouncer.textContent = nextDirection === "none" ? "Sort cleared." : `Sorted by ${axis.label.toLowerCase()}, ${nextDirection}.`;
      });
    }
    if (withSortButtons) {
      header.appendChild(sortAnnouncer);
    }
    return header;
  }
  function advanceSortDirection(current) {
    if (current === "none") return "descending";
    if (current === "descending") return "ascending";
    return "none";
  }
  var COMMENTS_METRICS_C1_TOOLTIP = "How counts are tallied: The Threads count includes every review thread on this PR, including threads with no recorded status. The Comments count includes every comment, including automated build or CI notifications. The Unresolved count includes only threads currently in the Active state. Deleted threads and comments are not counted. Comments and threads from users who have left the organization are still counted.";
  function formatFilterSummary(context, hasActiveThreshold, visibleNumeric) {
    if (!hasActiveThreshold) {
      return `Showing all ${context.totalRows} PRs.`;
    }
    if (context.partialRowCount === 0) {
      return `Showing ${visibleNumeric} of ${context.numericTotal} PRs.`;
    }
    const noun = context.partialRowCount === 1 ? "row" : "rows";
    return `Showing ${visibleNumeric} of ${context.numericTotal} PRs. ${context.partialRowCount} partial ${noun} hidden by filter.`;
  }
  function buildCommentsMetricsFilter(list, context) {
    const filterGroup = createElement("div", {
      class: "detail-panel-pr-list-filter",
      role: "group",
      "aria-label": "Filter by minimum comments metric"
    });
    filterGroup.appendChild(
      createElement(
        "span",
        { class: "detail-panel-pr-list-controls-label" },
        "Min:"
      )
    );
    const infoIcon = createElement("button", {
      type: "button",
      class: "info-icon-btn",
      "data-info-tooltip": "comments-metrics-c1",
      "aria-label": "About these counts"
    });
    appendText(infoIcon, "\u2139");
    infoIcon.addEventListener("pointerenter", () => {
      showInfoTooltip(infoIcon, COMMENTS_METRICS_C1_TOOLTIP);
    });
    infoIcon.addEventListener("pointerleave", () => {
      dismissAllTooltips();
      clearOutsideClickListener();
    });
    infoIcon.addEventListener("click", (event) => {
      event.stopPropagation();
      if (document.querySelector(".info-tooltip") !== null) {
        dismissAllTooltips();
        clearOutsideClickListener();
        return;
      }
      showInfoTooltip(infoIcon, COMMENTS_METRICS_C1_TOOLTIP);
      clearOutsideClickListener();
      outsideClickFrame = requestAnimationFrame(() => {
        outsideClickFrame = null;
        outsideClickAbort = new AbortController();
        document.addEventListener(
          "click",
          () => {
            dismissAllTooltips();
            clearOutsideClickListener();
          },
          { signal: outsideClickAbort.signal, once: true }
        );
      });
    });
    filterGroup.appendChild(infoIcon);
    const summary = createElement("p", {
      class: "detail-panel-pr-list-filter-summary",
      role: "status",
      "aria-live": "polite"
    });
    appendText(summary, formatFilterSummary(context, false, 0));
    const filterDescriptors = [];
    for (const axis of COMMENTS_METRICS_AXES) {
      const label = createElement("label", {
        class: "detail-panel-pr-list-filter-label"
      });
      appendText(label, `${axis.label} \u2265 `);
      const input = createElement("input", {
        type: "number",
        min: "0",
        class: "detail-panel-pr-list-filter-input",
        "data-filter-key": axis.key,
        "aria-label": `Minimum ${axis.label.toLowerCase()}`
      });
      const descriptor = { input, dataAttr: axis.dataAttr };
      input.addEventListener(
        "input",
        () => applyFilters(list, filterDescriptors, summary, context)
      );
      label.appendChild(input);
      filterGroup.appendChild(label);
      filterDescriptors.push(descriptor);
    }
    return { filterGroup, summary };
  }
  function applySort(list, dataAttr, direction, originalOrder) {
    if (direction === "none") {
      for (const item of originalOrder) list.appendChild(item);
      return;
    }
    const items = Array.from(list.querySelectorAll("li"));
    items.sort((a2, b2) => {
      const aValue = readMetricValue(a2, dataAttr);
      const bValue = readMetricValue(b2, dataAttr);
      if (aValue === null) {
        if (bValue === null) return 0;
        return 1;
      }
      if (bValue === null) return -1;
      return direction === "descending" ? bValue - aValue : aValue - bValue;
    });
    for (const item of items) list.appendChild(item);
  }
  function applyFilters(list, descriptors, summary, context) {
    const thresholds = [];
    for (const desc of descriptors) {
      const raw = desc.input.value.trim();
      if (raw === "") continue;
      const parsed = Number.parseInt(raw, 10);
      if (parsed < 0) continue;
      thresholds.push([desc.dataAttr, parsed]);
    }
    const hasActiveThreshold = thresholds.length > 0;
    let visibleNumeric = 0;
    for (const child of list.querySelectorAll("li")) {
      let hidden = false;
      for (const [dataAttr, threshold] of thresholds) {
        const value = readMetricValue(child, dataAttr);
        if (value === null) {
          hidden = true;
          break;
        }
        if (value < threshold) {
          hidden = true;
          break;
        }
      }
      if (hidden) {
        child.setAttribute("hidden", "");
      } else {
        child.removeAttribute("hidden");
        if (!child.hasAttribute("data-partial")) {
          visibleNumeric++;
        }
      }
    }
    const nextText = formatFilterSummary(
      context,
      hasActiveThreshold,
      visibleNumeric
    );
    summary.textContent = "";
    summary.textContent = nextText;
  }
  function renderPrListSection(section) {
    const wrapper = createElement("section", {
      id: "pr-detail",
      class: "detail-panel-section detail-panel-section--pr-detail",
      role: "region",
      "aria-labelledby": "pr-detail-heading",
      "data-content-state": section.contentState
    });
    wrapper.appendChild(
      createElement("h3", { id: "pr-detail-heading" }, "Pull requests")
    );
    switch (section.contentState) {
      case "pr-list": {
        const {
          rows,
          renderedCount,
          actualFilteredCount,
          capValue,
          commentsMetricsAvailable
        } = section;
        const partialRowCount = commentsMetricsAvailable ? rows.filter(isPartialPrRow).length : 0;
        const allRowsPartial = partialRowCount > 0 && partialRowCount === rows.length;
        if (renderedCount < actualFilteredCount) {
          const indicator = createElement("div", {
            class: "truncation-indicator truncation-badge"
          });
          const base = `Showing ${renderedCount} of ${actualFilteredCount} matching PRs (top ${capValue} by cycle time)`;
          appendText(
            indicator,
            commentsMetricsAvailable && !allRowsPartial ? `${base}. Sort and filter operate within this slice.` : base
          );
          wrapper.appendChild(indicator);
        }
        const list = createElement("ol", {
          class: commentsMetricsAvailable ? "detail-panel-pr-list detail-panel-pr-list--with-comments" : "detail-panel-pr-list"
        });
        const rowElements = [];
        for (const row of rows) {
          const li = createElement("li", { class: "detail-panel-pr-row" });
          const link = createElement("a", {
            href: row.url,
            target: "_blank",
            rel: "noopener noreferrer",
            class: "detail-panel-pr-link"
          });
          appendText(link, `#${row.id} \u2014 ${row.title}`);
          li.appendChild(link);
          const cycle = createElement("span", { class: "cycle-time" });
          appendText(cycle, formatDuration(row.cycleTimeMinutes));
          li.appendChild(cycle);
          if (commentsMetricsAvailable) {
            const triplet = [
              ["threads", "threads", row.threadCount],
              ["comments", "comments", row.commentCount],
              ["unresolved", "unresolved", row.activeThreadCount]
            ];
            const allPartial = isPartialPrRow(row);
            if (allPartial) {
              li.setAttribute("data-partial", "true");
            }
            for (const [key, cls, value] of triplet) {
              const span = createElement("span", {
                class: `comments-metric comments-metric--${cls}`
              });
              if (value === null || value === void 0) {
                span.setAttribute("data-partial", "true");
                span.setAttribute("aria-hidden", "true");
                appendText(span, "\u2014");
              } else {
                span.setAttribute("data-partial", "false");
                li.setAttribute(`data-${key}`, String(value));
                appendText(span, String(value));
              }
              li.appendChild(span);
            }
            if (allPartial) {
              const srNote = createElement("span", {
                class: "visually-hidden"
              });
              appendText(srNote, "Coverage pending");
              li.appendChild(srNote);
            }
          }
          rowElements.push(li);
        }
        if (commentsMetricsAvailable && partialRowCount > 0) {
          const notice = createElement("p", {
            class: allRowsPartial ? "detail-panel-pr-list-coverage-notice detail-panel-pr-list-coverage-notice--all-partial" : "detail-panel-pr-list-coverage-notice",
            role: "status",
            "aria-live": "polite"
          });
          appendText(
            notice,
            allRowsPartial ? "Comments coverage: pending \u2014 none of these PRs have comment data yet." : `Comments coverage: partial \u2014 ${partialRowCount} of ${rows.length} PRs are missing comment data.`
          );
          wrapper.appendChild(notice);
        }
        const sortRowElements = commentsMetricsAvailable && rowElements.length > 1 && !allRowsPartial ? rowElements : null;
        wrapper.appendChild(
          buildPrListHeader(list, {
            commentsMetricsAvailable,
            sortRowElements
          })
        );
        if (sortRowElements !== null) {
          const filterControls = buildCommentsMetricsFilter(list, {
            totalRows: rows.length,
            numericTotal: rows.length - partialRowCount,
            partialRowCount
          });
          wrapper.appendChild(filterControls.filterGroup);
          wrapper.appendChild(filterControls.summary);
        }
        for (const li of rowElements) {
          list.appendChild(li);
        }
        wrapper.appendChild(list);
        break;
      }
      case "supported-empty": {
        wrapper.appendChild(
          createElement(
            "p",
            { class: "detail-panel-empty-detail" },
            "No PRs match the active filter in this week."
          )
        );
        break;
      }
      case "team-inline": {
        wrapper.appendChild(
          createElement(
            "p",
            {
              class: "pr-detail-gated",
              "aria-live": "polite"
            },
            "Clear the team filter to view PR-level detail."
          )
        );
        break;
      }
      case "reviewer-inline": {
        wrapper.appendChild(
          createElement(
            "p",
            {
              class: "pr-detail-gated",
              "aria-live": "polite"
            },
            "Clear the reviewer filter to view PR-level detail."
          )
        );
        break;
      }
    }
    return wrapper;
  }
  var TOP_OFFSET_MOBILE_MEDIA_QUERY = "(max-width: 768px)";
  var TOP_OFFSET_FILTER_BAR_SELECTOR = ".filter-bar";
  var TOP_OFFSET_GAP_PX = 12;
  var TOP_OFFSET_CSS_VAR = "--detail-panel-top";
  function applyTopOffset(rootEl, signal) {
    rootEl.style.removeProperty(TOP_OFFSET_CSS_VAR);
    if (window.matchMedia?.(TOP_OFFSET_MOBILE_MEDIA_QUERY).matches === true) {
      return;
    }
    const filterBar = document.querySelector(
      TOP_OFFSET_FILTER_BAR_SELECTOR
    );
    if (filterBar === null) return;
    const writeOffset = () => {
      const bottom = filterBar.getBoundingClientRect().bottom;
      if (bottom <= 0) {
        rootEl.style.removeProperty(TOP_OFFSET_CSS_VAR);
        return;
      }
      rootEl.style.setProperty(
        TOP_OFFSET_CSS_VAR,
        `${Math.round(bottom + TOP_OFFSET_GAP_PX)}px`
      );
    };
    writeOffset();
    const observer = new ResizeObserver(() => {
      writeOffset();
    });
    observer.observe(filterBar);
    signal.addEventListener("abort", () => observer.disconnect(), { once: true });
  }
  function installOpenScopedListeners(els) {
    const controller = new AbortController();
    const { signal } = controller;
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape" && panelState === "open") {
          event.preventDefault();
          dismissDetailPanel("escape-key");
        }
      },
      { signal }
    );
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (panelState !== "open") return;
        const target = event.target;
        if (target instanceof Node && !els.root.contains(target)) {
          dismissDetailPanel("outside-click");
        }
      },
      { signal }
    );
    window.addEventListener(
      FILTERS_CHANGED_EVENT,
      () => {
        if (panelState === "open" || panelState === "opening") {
          dismissDetailPanel("filters-changed");
        }
      },
      { signal }
    );
    window.addEventListener(
      TAB_CHANGED_EVENT,
      (evt) => {
        const e2 = evt;
        if (e2.detail.activeTabId !== "metrics" && panelState === "open") {
          dismissDetailPanel("tab-changed");
        }
      },
      { signal }
    );
    window.addEventListener(
      COMPARISON_TOGGLED_EVENT,
      (evt) => {
        const e2 = evt;
        if (e2.detail.enabled && panelState === "open") {
          dismissDetailPanel("comparison-toggled");
        }
      },
      { signal }
    );
    return controller;
  }
  function isDetailPanelOpen() {
    return panelState === "opening" || panelState === "open";
  }
  function openDetailPanel(context) {
    if (context.content.title.length === 0) {
      throw new TypeError("PanelContent.title MUST be non-empty");
    }
    if (context.content.sections.length === 0) {
      throw new TypeError(
        "PanelContent.sections MUST contain at least one section"
      );
    }
    if (comparisonActive) {
      console.warn(
        "[detail-panel] openDetailPanel called while comparison mode is active; no-op. Callers should route to comparison-advisory.showComparisonAdvisoryToast in that case."
      );
      return;
    }
    if (panelState === "closing") {
      finalizeClose();
    }
    const els = ensurePanelEls();
    const wasOpen = isDetailPanelOpen();
    activeContext = context;
    if (wasOpen) {
      dismissAllTooltips();
      clearOutsideClickListener();
    }
    if (!wasOpen) {
      openScopedController = installOpenScopedListeners(els);
      applyTopOffset(els.root, openScopedController.signal);
    }
    renderContent(els, context.content);
    if (!wasOpen) {
      els.root.classList.add("is-open");
      panelState = "opening";
      panelState = "open";
      focusTrapController = trapFocus(els.root);
    }
  }
  function dismissDetailPanel(reason) {
    if (!isDetailPanelOpen()) return;
    panelState = "closing";
    openScopedController?.abort();
    openScopedController = null;
    dismissAllTooltips();
    clearOutsideClickListener();
    const trigger = activeContext?.triggerElement ?? null;
    if (focusTrapController) {
      if (trigger && trigger.isConnected) {
        restoreFocus(focusTrapController);
        trigger.focus();
      } else {
        restoreFocus(focusTrapController);
      }
      focusTrapController = null;
    }
    finalizeClose();
    void reason;
  }
  function finalizeClose() {
    if (panelEls) {
      panelEls.root.classList.remove("is-open");
    }
    activeContext = null;
    panelState = "closed";
  }

  // ../node_modules/.pnpm/azure-devops-extension-sdk@4.2.0/node_modules/azure-devops-extension-sdk/esm/SDK.min.js
  var e = parseInt("10000000000", 36);
  var t = Number.MAX_SAFE_INTEGER || 9007199254740991;
  var n = class {
    constructor() {
      __publicField(this, "objects", {});
    }
    register(e2, t2) {
      this.objects[e2] = t2;
    }
    unregister(e2) {
      delete this.objects[e2];
    }
    getInstance(e2, t2) {
      var n2 = this.objects[e2];
      if (n2) return "function" == typeof n2 ? n2(t2) : n2;
    }
  };
  var o = 1;
  var r = class {
    constructor(r2, i2) {
      __publicField(this, "promises", {});
      __publicField(this, "postToWindow");
      __publicField(this, "targetOrigin");
      __publicField(this, "handshakeToken");
      __publicField(this, "registry");
      __publicField(this, "channelId");
      __publicField(this, "nextMessageId", 1);
      __publicField(this, "nextProxyId", 1);
      __publicField(this, "proxyFunctions", {});
      this.postToWindow = r2, this.targetOrigin = i2, this.registry = new n(), this.channelId = o++, this.targetOrigin || (this.handshakeToken = Math.floor(Math.random() * (t - e) + e).toString(36) + Math.floor(Math.random() * (t - e) + e).toString(36));
    }
    getObjectRegistry() {
      return this.registry;
    }
    async invokeRemoteMethod(e2, t2, n2, o2, r2) {
      const i2 = { id: this.nextMessageId++, methodName: e2, instanceId: t2, instanceContext: o2, params: this._customSerializeObject(n2, r2), serializationSettings: r2 };
      this.targetOrigin || (i2.handshakeToken = this.handshakeToken);
      const s2 = new Promise(((e3, t3) => {
        this.promises[i2.id] = { resolve: e3, reject: t3 };
      }));
      return this._sendRpcMessage(i2), s2;
    }
    getRemoteObjectProxy(e2, t2) {
      return this.invokeRemoteMethod("", e2, void 0, t2);
    }
    invokeMethod(e2, t2) {
      if (t2.methodName) {
        var n2 = e2[t2.methodName];
        if ("function" == typeof n2) try {
          var o2 = [];
          t2.params && (o2 = this._customDeserializeObject(t2.params, {}));
          var r2 = n2.apply(e2, o2);
          r2 && r2.then && "function" == typeof r2.then ? r2.then(((e3) => {
            this._success(t2, e3, t2.handshakeToken);
          }), ((e3) => {
            this.error(t2, e3);
          })) : this._success(t2, r2, t2.handshakeToken);
        } catch (e3) {
          this.error(t2, e3);
        }
        else this.error(t2, new Error("RPC method not found: " + t2.methodName));
      } else this._success(t2, e2, t2.handshakeToken);
    }
    getRegisteredObject(e2, t2) {
      if ("__proxyFunctions" === e2) return this.proxyFunctions;
      var n2 = this.registry.getInstance(e2, t2);
      return n2 || (n2 = i.getInstance(e2, t2)), n2;
    }
    onMessage(e2) {
      if (e2.instanceId) {
        const t2 = this.getRegisteredObject(e2.instanceId, e2.instanceContext);
        if (!t2) return false;
        "function" == typeof t2.then ? t2.then(((t3) => {
          this.invokeMethod(t3, e2);
        }), ((t3) => {
          this.error(e2, t3);
        })) : this.invokeMethod(t2, e2);
      } else {
        const t2 = this.promises[e2.id];
        if (!t2) return false;
        e2.error ? t2.reject(this._customDeserializeObject([e2.error], {})[0]) : t2.resolve(this._customDeserializeObject([e2.result], {})[0]), delete this.promises[e2.id];
      }
      return true;
    }
    owns(e2, t2, n2) {
      if (this.postToWindow === e2) {
        if (this.targetOrigin) return !!t2 && ("null" === t2.toLowerCase() || 0 === this.targetOrigin.toLowerCase().indexOf(t2.toLowerCase()));
        if (n2.handshakeToken && n2.handshakeToken === this.handshakeToken) return this.targetOrigin = t2, true;
      }
      return false;
    }
    error(e2, t2) {
      this._sendRpcMessage({ id: e2.id, error: this._customSerializeObject([t2], e2.serializationSettings)[0], handshakeToken: e2.handshakeToken });
    }
    _success(e2, t2, n2) {
      this._sendRpcMessage({ id: e2.id, result: this._customSerializeObject([t2], e2.serializationSettings)[0], handshakeToken: n2 });
    }
    _sendRpcMessage(e2) {
      this.postToWindow.postMessage(JSON.stringify(e2), "*");
    }
    _customSerializeObject(e2, t2, n2, o2 = 1, r2 = 1) {
      if (!e2 || r2 > 100) return;
      if (e2 instanceof Node || e2 instanceof Window || e2 instanceof Event) return;
      var i2;
      let s2;
      s2 = n2 || { newObjects: [], originalObjects: [] }, s2.originalObjects.push(e2);
      var c = (n3, i3, c2) => {
        var a3;
        try {
          a3 = n3[c2];
        } catch (e3) {
        }
        var h3 = typeof a3;
        if ("undefined" !== h3) {
          var d3 = -1;
          if ("object" === h3 && (d3 = s2.originalObjects.indexOf(a3)), d3 >= 0) {
            var u2 = s2.newObjects[d3];
            u2.__circularReferenceId || (u2.__circularReferenceId = o2++), i3[c2] = { __circularReference: u2.__circularReferenceId };
          } else "function" === h3 ? (this.nextProxyId++, i3[c2] = { __proxyFunctionId: this._registerProxyFunction(a3, e2), _channelId: this.channelId }) : "object" === h3 ? a3 && a3 instanceof Date ? i3[c2] = { __proxyDate: a3.getTime() } : i3[c2] = this._customSerializeObject(a3, t2, s2, o2, r2 + 1) : "__proxyFunctionId" !== c2 && (i3[c2] = a3);
        }
      };
      if (e2 instanceof Array) {
        i2 = [], s2.newObjects.push(i2);
        for (var a2 = 0, h2 = e2.length; a2 < h2; a2++) c(e2, i2, a2);
      } else {
        i2 = {}, s2.newObjects.push(i2);
        let n3 = {};
        try {
          n3 = (function(e3) {
            const t3 = {};
            for (; e3 && e3 !== Object.prototype; ) {
              const n4 = Object.getOwnPropertyNames(e3);
              for (const e4 of n4) "constructor" !== e4 && (t3[e4] = true);
              e3 = Object.getPrototypeOf(e3);
            }
            return t3;
          })(e2);
        } catch (e3) {
        }
        for (var d2 in n3) (d2 && "_" !== d2[0] || t2 && t2.includeUnderscoreProperties) && c(e2, i2, d2);
      }
      return s2.originalObjects.pop(), s2.newObjects.pop(), i2;
    }
    _registerProxyFunction(e2, t2) {
      var n2 = this.nextProxyId++;
      return this.proxyFunctions["proxy" + n2] = function() {
        return e2.apply(t2, Array.prototype.slice.call(arguments, 0));
      }, n2;
    }
    _customDeserializeObject(e2, t2) {
      var n2 = this;
      if (!e2) return null;
      var o2 = (e3, o3) => {
        var r3 = e3[o3], i3 = typeof r3;
        "__circularReferenceId" === o3 && "number" === i3 ? (t2[r3] = e3, delete e3[o3]) : "object" === i3 && r3 && (r3.__proxyFunctionId ? e3[o3] = function() {
          return n2.invokeRemoteMethod("proxy" + r3.__proxyFunctionId, "__proxyFunctions", Array.prototype.slice.call(arguments, 0), {}, { includeUnderscoreProperties: true });
        } : r3.__proxyDate ? e3[o3] = new Date(r3.__proxyDate) : r3.__circularReference ? e3[o3] = t2[r3.__circularReference] : this._customDeserializeObject(r3, t2));
      };
      if (e2 instanceof Array) for (var r2 = 0, i2 = e2.length; r2 < i2; r2++) o2(e2, r2);
      else if ("object" == typeof e2) for (var s2 in e2) o2(e2, s2);
      return e2;
    }
  };
  var i = new n();
  var s = new class {
    constructor() {
      __publicField(this, "_channels", []);
      __publicField(this, "_handleMessageReceived", (e2) => {
        let t2;
        if ("string" == typeof e2.data) try {
          t2 = JSON.parse(e2.data);
        } catch (e3) {
        }
        if (t2) {
          let n2, o2 = false;
          for (const r2 of this._channels) r2.owns(e2.source, e2.origin, t2) && (n2 = r2, o2 = r2.onMessage(t2) || o2);
          n2 && !o2 && (window.console && console.error(`No handler found on any channel for message: ${JSON.stringify(t2)}`), t2.instanceId && n2.error(t2, new Error(`The registered object ${t2.instanceId} could not be found.`)));
        }
      });
      window.addEventListener("message", this._handleMessageReceived);
    }
    addChannel(e2, t2) {
      const n2 = new r(e2, t2);
      return this._channels.push(n2), n2;
    }
    removeChannel(e2) {
      this._channels = this._channels.filter(((t2) => t2 !== e2));
    }
  }();
  var a = window;
  var h;
  a._AzureDevOpsSDKVersion && console.error("The AzureDevOps SDK is already loaded. Only one version of this module can be loaded in a given document."), a._AzureDevOpsSDKVersion = 4.2, (function(e2) {
    e2[e2.Unknown = 0] = "Unknown", e2[e2.Deployment = 1] = "Deployment", e2[e2.Enterprise = 2] = "Enterprise", e2[e2.Organization = 4] = "Organization";
  })(h || (h = {}));
  var d = "DevOps.HostControl";
  var u = s.addChannel(window.parent);
  var l;
  var f;
  var g;
  var p;
  var m;
  var y;
  var v;
  var _;
  var b;
  var w;
  var O = new Promise(((e2) => {
    w = e2;
  }));
  function x(e2, t2) {
    const n2 = window;
    let o2;
    "function" == typeof n2.CustomEvent ? o2 = new n2.CustomEvent(e2, t2) : (t2 = t2 || { bubbles: false, cancelable: false }, o2 = document.createEvent("CustomEvent"), o2.initCustomEvent(e2, t2.bubbles, t2.cancelable, t2.detail)), window.dispatchEvent(o2);
  }
  function k(e2) {
    return new Promise(((t2) => {
      const n2 = { ...e2, sdkVersion: 4.2 };
      u.invokeRemoteMethod("initialHandshake", d, [n2]).then(((e3) => {
        if ("pageContext" in e3) {
          const t3 = e3;
          if (g = t3.pageContext, f = g ? g.webContext : void 0, l = f ? f.team : void 0, m = t3.initialConfig || {}, y = t3.contribution.id, p = t3.extensionContext, p.id = p.publisherId + "." + p.extensionId, "context" in e3) {
            const t4 = e3.context;
            v = t4.user, _ = t4.host;
          }
        } else {
          const t3 = e3, n3 = t3.context;
          g = n3.pageContext, f = g ? g.webContext : void 0, l = f ? f.team : void 0, m = t3.initialConfig || {}, y = t3.contributionId, p = n3.extension, v = n3.user, _ = n3.host;
        }
        e3.themeData && (J(e3.themeData), window.addEventListener("themeChanged", ((e4) => {
          J(e4.detail.data);
        }))), w(), t2();
      }));
    }));
  }
  async function j() {
    return O;
  }
  function R() {
    return u.invokeRemoteMethod("notifyLoadSucceeded", d);
  }
  function I(e2) {
    return `Attempted to call ${e2}() before init() was complete. Wait for init to complete or place within a ready() callback.`;
  }
  function T() {
    if (!v) throw new Error(I("getUser"));
    return v;
  }
  function D() {
    if (!_) throw new Error(I("getHost"));
    return _;
  }
  function S() {
    if (!p) throw new Error(I("getExtensionContext"));
    return p;
  }
  function A() {
    if (!f) throw new Error(I("getWebContext"));
    return f;
  }
  async function F(e2) {
    return j().then((() => u.invokeRemoteMethod("getService", "DevOps.ServiceManager", [e2])));
  }
  async function L() {
    return u.invokeRemoteMethod("getAccessToken", d).then(((e2) => e2.token));
  }
  function J(e2) {
    b || (b = document.createElement("style"), b.type = "text/css", document.head.appendChild(b));
    const t2 = [];
    if (e2) for (const n2 in e2) t2.push("--" + n2 + ": " + e2[n2]);
    b.innerText = ":root { " + t2.join("; ") + " } body { color: var(--text-primary-color) }", x("themeApplied", { detail: e2 });
  }
  u.getObjectRegistry().register("DevOps.SdkClient", { dispatchEvent: x });

  // ../ui/modules/sdk.ts
  var LocationServiceId = "ms.vss-features.location-service";
  var CORE_RESOURCE_AREA_ID = "79134c72-4a58-4b42-976c-04e7115f32bf";
  var sdkInitialized = false;
  var sdkReadyForCalls = false;
  var initAttemptId = 0;
  var initPromise = null;
  var cachedCollectionUri = null;
  var tokenInflight = null;
  var DEFAULT_TIMEOUT_MS = 1e4;
  function isSdkCallable() {
    return sdkInitialized || sdkReadyForCalls;
  }
  async function initializeAdoSdk(options) {
    if (sdkInitialized) return;
    if (initPromise) return initPromise;
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
    const attemptId = ++initAttemptId;
    const initSequence = async () => {
      await k({ loaded: false });
      await j();
      if (attemptId !== initAttemptId) return;
      sdkReadyForCalls = true;
      try {
        if (options?.onReady) {
          options.onReady();
        }
        if (attemptId !== initAttemptId) return;
        await R();
      } finally {
        sdkReadyForCalls = false;
      }
      if (attemptId !== initAttemptId) return;
      sdkInitialized = true;
    };
    let timeoutId;
    const timeoutPromise = new Promise((_2, reject) => {
      timeoutId = setTimeout(() => {
        initAttemptId++;
        reject(new Error("Azure DevOps SDK initialization timed out"));
      }, timeout);
    });
    initPromise = Promise.race([initSequence(), timeoutPromise]).finally(() => {
      clearTimeout(timeoutId);
      initPromise = null;
    });
    return initPromise;
  }
  async function getExtensionDataService() {
    const collectionUri = await getCollectionUri();
    const ctx = S();
    function buildUrl(key, scopeType) {
      const scope = scopeType === "User" ? "User" : "Default";
      const scopeValue = scopeType === "User" ? "Me" : "Current";
      return `${collectionUri}_apis/ExtensionManagement/InstalledExtensions/${encodeURIComponent(ctx.publisherId)}/${encodeURIComponent(ctx.extensionId)}/Data/Scopes/${scope}/${scopeValue}/Collections/%24settings/Documents/${encodeURIComponent(key)}?api-version=${EXTENSION_DATA_API_VERSION}`;
    }
    return {
      async getValue(key, options) {
        const accessToken = await getAccessToken();
        const headers = {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json"
        };
        const url = buildUrl(key, options?.scopeType);
        const response = await fetch(url, { headers });
        if (response.status === 404) {
          return options?.defaultValue ?? void 0;
        }
        if (!response.ok) {
          throw new Error(
            `Extension data GET failed: ${response.status} ${response.statusText}`
          );
        }
        const doc = await response.json();
        if (doc !== null && typeof doc === "object" && "value" in doc) {
          return doc.value;
        }
        return doc;
      },
      async setValue(key, value, options) {
        const accessToken = await getAccessToken();
        const headers = {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json"
        };
        const url = buildUrl(key, options?.scopeType);
        const body = JSON.stringify({ id: key, value });
        const response = await fetch(url, { method: "PUT", headers, body });
        if (!response.ok) {
          throw new Error(
            `Extension data PUT failed: ${response.status} ${response.statusText}`
          );
        }
        const doc = await response.json();
        if (doc !== null && typeof doc === "object" && "value" in doc) {
          return doc.value;
        }
        return doc;
      }
    };
  }
  function getWebContext() {
    if (!isSdkCallable()) return void 0;
    const webCtx = A();
    const user = T();
    const host = D();
    return {
      project: webCtx.project ? { id: webCtx.project.id, name: webCtx.project.name } : void 0,
      team: webCtx.team ? { id: webCtx.team.id, name: webCtx.team.name } : void 0,
      user: { id: user.id, name: user.name, displayName: user.displayName },
      host: { id: host.id, name: host.name }
    };
  }
  async function getCollectionUri() {
    if (cachedCollectionUri) return cachedCollectionUri;
    const locationService = await F(LocationServiceId);
    const raw = await locationService.getResourceAreaLocation(
      CORE_RESOURCE_AREA_ID
    );
    cachedCollectionUri = raw.endsWith("/") ? raw : `${raw}/`;
    return cachedCollectionUri;
  }
  async function getAccessToken() {
    if (tokenInflight) return tokenInflight;
    tokenInflight = L();
    try {
      return await tokenInflight;
    } finally {
      tokenInflight = null;
    }
  }
  function isLocalMode() {
    return typeof LOCAL_DASHBOARD_MODE !== "undefined" && LOCAL_DASHBOARD_MODE === true;
  }
  function getLocalDatasetPath() {
    if (typeof DATASET_PATH !== "undefined" && DATASET_PATH !== "") {
      return DATASET_PATH;
    }
    return "./dataset";
  }
  var LOCAL_DASHBOARD_COLLECTION_URI = "https://dev.azure.com/oddessentials/";
  function getLocalCollectionUri() {
    return LOCAL_DASHBOARD_COLLECTION_URI;
  }

  // ../ui/modules/shared/svg-path.ts
  function buildLinePath(points) {
    if (points.length < 2) return "";
    return points.map((p2, i2) => `${i2 === 0 ? "M" : "L"} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`).join(" ");
  }

  // ../ui/modules/metrics.ts
  function toFiniteNumber(value) {
    const n2 = Number(value);
    return Number.isFinite(n2) ? n2 : 0;
  }
  function getOwnPropertyValue(obj, key) {
    return new Map(Object.entries(obj)).get(key);
  }
  function calculateMetrics(rollups) {
    if (!rollups || !rollups.length) {
      return {
        totalPrs: 0,
        cycleP50: null,
        cycleP90: null,
        reviewTimeP50: null,
        reviewTimeP90: null,
        avgAuthors: 0,
        avgReviewers: 0,
        weekCount: 0,
        cycleP50WeekCount: 0,
        cycleP90WeekCount: 0,
        reviewTimeP50WeekCount: 0,
        reviewTimeP90WeekCount: 0
      };
    }
    const totalPrs = rollups.reduce((sum, r2) => sum + (r2.pr_count || 0), 0);
    const p50Values = rollups.map((r2) => r2.cycle_time_p50).filter((v2) => v2 !== null && v2 !== void 0);
    const p90Values = rollups.map((r2) => r2.cycle_time_p90).filter((v2) => v2 !== null && v2 !== void 0);
    const reviewTimeP50Values = rollups.map((r2) => r2.review_time_p50).filter((v2) => v2 !== null && v2 !== void 0);
    const reviewTimeP90Values = rollups.map((r2) => r2.review_time_p90).filter((v2) => v2 !== null && v2 !== void 0);
    const authorsSum = rollups.reduce(
      (sum, r2) => sum + (r2.authors_count || 0),
      0
    );
    const reviewersSum = rollups.reduce(
      (sum, r2) => sum + (r2.reviewers_count || 0),
      0
    );
    return {
      totalPrs,
      cycleP50: p50Values.length ? median(p50Values) : null,
      cycleP90: p90Values.length ? median(p90Values) : null,
      reviewTimeP50: reviewTimeP50Values.length ? median(reviewTimeP50Values) : null,
      reviewTimeP90: reviewTimeP90Values.length ? median(reviewTimeP90Values) : null,
      avgAuthors: Math.round(authorsSum / rollups.length),
      avgReviewers: Math.round(reviewersSum / rollups.length),
      weekCount: rollups.length,
      cycleP50WeekCount: p50Values.length,
      cycleP90WeekCount: p90Values.length,
      reviewTimeP50WeekCount: reviewTimeP50Values.length,
      reviewTimeP90WeekCount: reviewTimeP90Values.length
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
      (e2) => typeof e2.cycle_time_p50 === "number" && Number.isFinite(e2.cycle_time_p50)
    );
    const p90Entries = entries.filter(
      (e2) => typeof e2.cycle_time_p90 === "number" && Number.isFinite(e2.cycle_time_p90)
    );
    let cycleP50 = null;
    let cycleP90 = null;
    if (p50Entries.length > 0) {
      const p50PrCount = p50Entries.reduce(
        (sum, e2) => sum + toFiniteNumber(e2.pr_count),
        0
      );
      if (p50PrCount > 0) {
        cycleP50 = p50Entries.reduce(
          (sum, e2) => sum + toFiniteNumber(e2.cycle_time_p50) * toFiniteNumber(e2.pr_count),
          0
        ) / p50PrCount;
      }
    }
    if (p90Entries.length > 0) {
      const p90PrCount = p90Entries.reduce(
        (sum, e2) => sum + toFiniteNumber(e2.pr_count),
        0
      );
      if (p90PrCount > 0) {
        cycleP90 = p90Entries.reduce(
          (sum, e2) => sum + toFiniteNumber(e2.cycle_time_p90) * toFiniteNumber(e2.pr_count),
          0
        ) / p90PrCount;
      }
    }
    const rtP50Entries = entries.filter(
      (e2) => typeof e2.review_time_p50 === "number" && Number.isFinite(e2.review_time_p50)
    );
    const rtP90Entries = entries.filter(
      (e2) => typeof e2.review_time_p90 === "number" && Number.isFinite(e2.review_time_p90)
    );
    let reviewTimeP50 = null;
    let reviewTimeP90 = null;
    if (rtP50Entries.length > 0) {
      const rtP50PrCount = rtP50Entries.reduce(
        (sum, e2) => sum + toFiniteNumber(e2.pr_count),
        0
      );
      if (rtP50PrCount > 0) {
        reviewTimeP50 = rtP50Entries.reduce(
          (sum, e2) => sum + toFiniteNumber(e2.review_time_p50) * toFiniteNumber(e2.pr_count),
          0
        ) / rtP50PrCount;
      }
    }
    if (rtP90Entries.length > 0) {
      const rtP90PrCount = rtP90Entries.reduce(
        (sum, e2) => sum + toFiniteNumber(e2.pr_count),
        0
      );
      if (rtP90PrCount > 0) {
        reviewTimeP90 = rtP90Entries.reduce(
          (sum, e2) => sum + toFiniteNumber(e2.review_time_p90) * toFiniteNumber(e2.pr_count),
          0
        ) / rtP90PrCount;
      }
    }
    return {
      pr_count: totalPrCount,
      cycle_time_p50: cycleP50,
      cycle_time_p90: cycleP90,
      review_time_p50: reviewTimeP50,
      review_time_p90: reviewTimeP90,
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
      (e2) => typeof e2.approval_rate === "number" && Number.isFinite(e2.approval_rate)
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
      review_time_p50: slice.review_time_p50,
      review_time_p90: slice.review_time_p90,
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
      const filteredRollup = (() => {
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
            review_time_p50: null,
            review_time_p90: null,
            authors_count: reviewerSlice.authors_count,
            // Reuse reviewers_count for review-activity UI surfaces.
            reviewers_count: reviewerSlice.reviews_count
          });
        }
        if (authorSlice && repoSlice && rollup.by_author_and_repo) {
          let cdPr = 0, cdAuthors = 0, cdReviewers = 0;
          let cdP50WSum = 0, cdP50WPr = 0, cdP90WSum = 0, cdP90WPr = 0;
          let cdRtP50WSum = 0, cdRtP50WPr = 0, cdRtP90WSum = 0, cdRtP90WPr = 0;
          let cdFound = 0;
          for (const authorId of authorFilters) {
            const authorRepos = getOwnPropertyValue(
              rollup.by_author_and_repo,
              authorId
            );
            if (!authorRepos) continue;
            for (const repo of filters.repos) {
              const e2 = getOwnPropertyValue(authorRepos, repo);
              if (!e2) continue;
              cdFound++;
              const pr = toFiniteNumber(e2.pr_count);
              cdPr += pr;
              cdAuthors += toFiniteNumber(e2.authors_count);
              cdReviewers += toFiniteNumber(e2.reviewers_count);
              const p50 = e2.cycle_time_p50;
              if (typeof p50 === "number" && Number.isFinite(p50)) {
                cdP50WSum += p50 * pr;
                cdP50WPr += pr;
              }
              const p90 = e2.cycle_time_p90;
              if (typeof p90 === "number" && Number.isFinite(p90)) {
                cdP90WSum += p90 * pr;
                cdP90WPr += pr;
              }
              const rtP50 = e2.review_time_p50;
              if (typeof rtP50 === "number" && Number.isFinite(rtP50)) {
                cdRtP50WSum += rtP50 * pr;
                cdRtP50WPr += pr;
              }
              const rtP90 = e2.review_time_p90;
              if (typeof rtP90 === "number" && Number.isFinite(rtP90)) {
                cdRtP90WSum += rtP90 * pr;
                cdRtP90WPr += pr;
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
                review_time_p50: cdRtP50WPr > 0 ? cdRtP50WSum / cdRtP50WPr : null,
                review_time_p90: cdRtP90WPr > 0 ? cdRtP90WSum / cdRtP90WPr : null,
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
          ].filter((v2) => v2 !== null);
          const p90s = [
            authorSlice.cycle_time_p90,
            repoSlice.cycle_time_p90
          ].filter((v2) => v2 !== null);
          const rtP50s = [
            authorSlice.review_time_p50,
            repoSlice.review_time_p50
          ].filter((v2) => v2 !== null);
          const rtP90s = [
            authorSlice.review_time_p90,
            repoSlice.review_time_p90
          ].filter((v2) => v2 !== null);
          if (teamSlice) {
            console.warn(
              "Combined author and team filtering is constrained; using author+repository metrics while retaining team UI state"
            );
          }
          return {
            ...rollup,
            pr_count: combinedPrCount,
            cycle_time_p50: p50s.length > 0 ? p50s.reduce((a2, b2) => a2 + b2, 0) / p50s.length : null,
            cycle_time_p90: p90s.length > 0 ? p90s.reduce((a2, b2) => a2 + b2, 0) / p90s.length : null,
            review_time_p50: rtP50s.length > 0 ? rtP50s.reduce((a2, b2) => a2 + b2, 0) / rtP50s.length : null,
            review_time_p90: rtP90s.length > 0 ? rtP90s.reduce((a2, b2) => a2 + b2, 0) / rtP90s.length : null,
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
          let cdRtP50WSum = 0, cdRtP50WPr = 0, cdRtP90WSum = 0, cdRtP90WPr = 0;
          let cdFound = 0;
          for (const team of filters.teams) {
            const teamRepos = getOwnPropertyValue(rollup.by_team_and_repo, team);
            if (!teamRepos) continue;
            for (const repo of filters.repos) {
              const e2 = getOwnPropertyValue(teamRepos, repo);
              if (!e2) continue;
              cdFound++;
              const pr = toFiniteNumber(e2.pr_count);
              cdPr += pr;
              cdAuthors += toFiniteNumber(e2.authors_count);
              cdReviewers += toFiniteNumber(e2.reviewers_count);
              const p50 = e2.cycle_time_p50;
              if (typeof p50 === "number" && Number.isFinite(p50)) {
                cdP50WSum += p50 * pr;
                cdP50WPr += pr;
              }
              const p90 = e2.cycle_time_p90;
              if (typeof p90 === "number" && Number.isFinite(p90)) {
                cdP90WSum += p90 * pr;
                cdP90WPr += pr;
              }
              const rtP50 = e2.review_time_p50;
              if (typeof rtP50 === "number" && Number.isFinite(rtP50)) {
                cdRtP50WSum += rtP50 * pr;
                cdRtP50WPr += pr;
              }
              const rtP90 = e2.review_time_p90;
              if (typeof rtP90 === "number" && Number.isFinite(rtP90)) {
                cdRtP90WSum += rtP90 * pr;
                cdRtP90WPr += pr;
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
                review_time_p50: cdRtP50WPr > 0 ? cdRtP50WSum / cdRtP50WPr : null,
                review_time_p90: cdRtP90WPr > 0 ? cdRtP90WSum / cdRtP90WPr : null,
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
          const p50s = [
            repoSlice.cycle_time_p50,
            teamSlice.cycle_time_p50
          ].filter((v2) => v2 !== null);
          const p90s = [
            repoSlice.cycle_time_p90,
            teamSlice.cycle_time_p90
          ].filter((v2) => v2 !== null);
          const rtP50s = [
            repoSlice.review_time_p50,
            teamSlice.review_time_p50
          ].filter((v2) => v2 !== null);
          const rtP90s = [
            repoSlice.review_time_p90,
            teamSlice.review_time_p90
          ].filter((v2) => v2 !== null);
          return {
            ...rollup,
            pr_count: combinedPrCount,
            // Always override to prevent global values leaking through the
            // ...rollup spread when proportional estimates are null/0.
            cycle_time_p50: p50s.length > 0 ? p50s.reduce((a2, b2) => a2 + b2, 0) / p50s.length : null,
            cycle_time_p90: p90s.length > 0 ? p90s.reduce((a2, b2) => a2 + b2, 0) / p90s.length : null,
            review_time_p50: rtP50s.length > 0 ? rtP50s.reduce((a2, b2) => a2 + b2, 0) / rtP50s.length : null,
            review_time_p90: rtP90s.length > 0 ? rtP90s.reduce((a2, b2) => a2 + b2, 0) / rtP90s.length : null,
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
      })();
      if (!Array.isArray(rollup.prs)) return filteredRollup;
      const rawPrs = rollup.prs;
      const filteredPrs = [];
      for (const candidate of rawPrs) {
        if (typeof candidate !== "object" || candidate === null) continue;
        const pr = candidate;
        const authorId = pr.author_id;
        const repoId = pr.repository_id;
        if (typeof authorId !== "string" || typeof repoId !== "string") continue;
        if (authorFilters.length > 0 && !authorFilters.includes(authorId)) {
          continue;
        }
        if (filters.repos.length > 0 && !filters.repos.includes(repoId)) {
          continue;
        }
        filteredPrs.push(candidate);
      }
      return {
        ...filteredRollup,
        prs: filteredPrs,
        _prs_truncated: rollup._prs_truncated,
        _prs_cap: rollup._prs_cap
      };
    });
  }
  function extractSparklineData(rollups) {
    return {
      prCounts: rollups.map((r2) => r2.pr_count ?? 0),
      p50s: rollups.map((r2) => r2.cycle_time_p50 ?? null),
      p90s: rollups.map((r2) => r2.cycle_time_p90 ?? null),
      reviewTimeP50s: rollups.map((r2) => r2.review_time_p50 ?? null),
      reviewTimeP90s: rollups.map((r2) => r2.review_time_p90 ?? null),
      authors: rollups.map((r2) => r2.authors_count ?? 0),
      reviewers: rollups.map((r2) => r2.reviewers_count ?? 0)
    };
  }
  function calculateMovingAverage(values, window2) {
    return values.map((_2, i2) => {
      if (i2 < window2 - 1) return null;
      const slice = values.slice(i2 - window2 + 1, i2 + 1);
      const sum = slice.reduce((a2, b2) => a2 + b2, 0);
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
        details.instructions.forEach((s2) => {
          const li = createElement("li", {}, s2);
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
        (m2) => `
                <a href="?pipelineId=${escapeHtml(String(m2.id))}" class="pipeline-option">
                    <strong>${escapeHtml(m2.name)}</strong>
                    <span class="pipeline-id">ID: ${escapeHtml(String(m2.id))}</span>
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
        details.instructions.forEach((s2) => {
          const li = createElement("li", {}, s2);
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
  var DATA_QUALITY_MESSAGES = /* @__PURE__ */ new Map([
    ["normal", { label: "High Confidence", cssClass: "quality-normal" }],
    [
      "low_confidence",
      {
        label: "Low Confidence - More data recommended",
        cssClass: "quality-low"
      }
    ],
    [
      "insufficient",
      {
        label: "Insufficient Data",
        cssClass: "quality-insufficient"
      }
    ]
  ]);
  function renderForecasterIndicator(forecaster) {
    const label = FORECASTER_LABELS[forecaster || "linear"] || "Forecast";
    const cssClass = forecaster === "prophet" ? "forecaster-prophet" : "forecaster-linear";
    return `<span class="forecaster-badge ${cssClass}">${escapeHtml(label)}</span>`;
  }
  function renderDataQualityBanner(dataQuality) {
    if (!dataQuality || dataQuality === "normal") return "";
    const quality = DATA_QUALITY_MESSAGES.get(dataQuality);
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
      (pt, i2) => `${i2 === 0 ? "M" : "L"} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`
    ).join(" ");
  }
  function calculateBandPath(upperValues, lowerValues) {
    if (upperValues.length === 0 || lowerValues.length === 0) return "";
    const upperPath = upperValues.map(
      (pt, i2) => `${i2 === 0 ? "M" : "L"} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`
    ).join(" ");
    const lowerReversed = [...lowerValues].reverse();
    const lowerPath = lowerReversed.map((pt) => `L ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`).join(" ");
    return `${upperPath} ${lowerPath} Z`;
  }
  function renderForecastChart(forecast, historicalData, chartHeight = 200, wasTruncated = false) {
    const rawValues = forecast.values;
    if (!rawValues || rawValues.length === 0) {
      return `<div class="forecast-chart-empty">No forecast data available</div>`;
    }
    const values = [...rawValues].sort(
      (a2, b2) => a2.period_start.localeCompare(b2.period_start)
    );
    const allValues = [];
    if (historicalData) {
      historicalData.forEach((h2) => allValues.push(h2.value));
    }
    values.forEach((v2) => {
      allValues.push(v2.predicted);
      if (v2.lower_bound != null) allValues.push(v2.lower_bound);
      if (v2.upper_bound != null) allValues.push(v2.upper_bound);
    });
    const maxValue = Math.max(...allValues, 1);
    const minValue = Math.min(...allValues, 0);
    const range = maxValue - minValue;
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
    values.forEach((v2, i2) => {
      const x2 = getX(historicalCount + i2);
      forecastPoints.push({ x: x2, y: getY(v2.predicted) });
      if (v2.upper_bound != null) upperPoints.push({ x: x2, y: getY(v2.upper_bound) });
      if (v2.lower_bound != null) lowerPoints.push({ x: x2, y: getY(v2.lower_bound) });
    });
    const historicalPoints = [];
    if (historicalData) {
      historicalData.forEach((h2, i2) => {
        historicalPoints.push({ x: getX(i2), y: getY(h2.value) });
      });
    }
    const historicalPath = calculateLinePath(historicalPoints);
    const forecastPath = calculateLinePath(forecastPoints);
    const bandPath = calculateBandPath(upperPoints, lowerPoints);
    const metricLabel = forecast.metric.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const allWeeks = [];
    if (historicalData) {
      historicalData.forEach((h2) => allWeeks.push(h2.week));
    }
    values.forEach((v2) => allWeeks.push(v2.period_start));
    const labelStep = Math.ceil(allWeeks.length / 6);
    const xAxisLabels = allWeeks.filter((_2, i2) => i2 % labelStep === 0).map((week, i2) => {
      const x2 = getX(i2 * labelStep);
      const formatted = formatWeekLabel2(week);
      return `<text x="${x2}%" y="${chartHeight - 2}" class="axis-label">${escapeHtml(formatted)}</text>`;
    }).join("");
    const latestValue = values[values.length - 1];
    const rangeClause = latestValue.lower_bound != null && latestValue.upper_bound != null ? ` (range ${latestValue.lower_bound.toFixed(1)} to ${latestValue.upper_bound.toFixed(1)})` : "";
    const accessibleSummary = `${metricLabel} forecast: ${latestValue.predicted.toFixed(1)} ${forecast.unit}${rangeClause}`;
    const safeMetricId = sanitizeForId(forecast.metric);
    return `
    <div class="forecast-chart" role="region" aria-label="${escapeHtml(metricLabel)} forecast">
      <div class="chart-header">
        <h4 id="chart-${safeMetricId}">${escapeHtml(metricLabel)}</h4>
        <span class="chart-unit">(${escapeHtml(forecast.unit)})</span>
        ${wasTruncated ? `<span class="truncation-badge" title="Showing last ${MAX_CHART_POINTS} data points">Partial history</span>` : ""}
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
          <!-- Forecast line (dashed). forecastPoints is non-empty whenever we reach
               this render (values.length >= 1 guaranteed by the early return above),
               so forecastPath is always truthy \u2014 no conditional needed. -->
          <path class="forecast-line" d="${forecastPath}" vector-effect="non-scaling-stroke" />
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
  function formatWeekLabel2(weekStr) {
    const date = new Date(weekStr);
    if (isNaN(date.getTime())) return weekStr;
    const month = date.toLocaleString("en-US", { month: "short" });
    const day = date.getDate();
    return `${month} ${day}`;
  }
  function isoWeekToDate(isoWeek) {
    const match = isoWeek.match(/^(\d{4})-W(\d{2})$/);
    if (!match) return isoWeek;
    const year = parseInt(match[1], 10);
    const week = parseInt(match[2], 10);
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const firstMonday = new Date(jan4);
    firstMonday.setDate(jan4.getDate() - dayOfWeek + 1);
    const targetDate = new Date(firstMonday);
    targetDate.setDate(firstMonday.getDate() + (week - 1) * 7);
    return targetDate.toISOString().substring(0, 10);
  }
  function extractHistoricalDataResult(rollups, metric) {
    if (!rollups || rollups.length === 0) {
      return { data: [], wasTruncated: false };
    }
    const metricFieldMap = /* @__PURE__ */ new Map([
      ["pr_throughput", (r2) => r2.pr_count],
      ["cycle_time_minutes", (r2) => r2.cycle_time_p50]
    ]);
    const getter = metricFieldMap.get(metric);
    if (!getter) {
      return { data: [], wasTruncated: false };
    }
    const data = rollups.filter((r2) => getter(r2) !== null && getter(r2) !== void 0).map((r2) => ({
      // Convert ISO week format to date. isoWeekToDate handles non-ISO
      // inputs internally by returning them unchanged, so we can funnel
      // every week string through it without a preliminary format check.
      week: isoWeekToDate(r2.week),
      value: Number(getter(r2))
    })).sort((a2, b2) => a2.week.localeCompare(b2.week));
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
      const chartHtml = renderForecastChart(
        forecast,
        historicalData,
        200,
        wasTruncated
      );
      appendTrustedHtml(content, chartHtml);
    });
    const hasReviewTime = predictions.forecasts.some(
      (f2) => f2.metric === "review_time_minutes"
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
  var PREDICTIONS_YAML = `- task: ExtractPullRequests@2
  inputs:
    generateAggregates: true
    enablePredictions: true`;
  var INSIGHTS_YAML = `- task: ExtractPullRequests@2
  inputs:
    generateAggregates: true
    enableInsights: true
    openaiApiKey: $(OPENAI_API_KEY)`;
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
    container.addEventListener("click", async (e2) => {
      const button = e2.target.closest(
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
        <span>Uses NumPy-based linear regression. For Prophet (seasonality detection), install <code>pip install "ado-git-repo-insights[ml]"</code>. See <a href="https://github.com/oddessentials/ado-git-repo-insights/blob/main/docs/user-guide/enable-ml-features.md#for-predictions" target="_blank" rel="noopener">platform prerequisites</a>.</span>
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
  var SEVERITY_ICONS = /* @__PURE__ */ new Map([
    ["critical", { icon: "\u{1F534}", label: "Critical" }],
    ["warning", { icon: "\u{1F7E1}", label: "Warning" }],
    ["info", { icon: "\u{1F535}", label: "Informational" }]
  ]);
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
    return [...insights].sort((a2, b2) => {
      const severityA = SEVERITY_PRIORITY[a2.severity] ?? 0;
      const severityB = SEVERITY_PRIORITY[b2.severity] ?? 0;
      if (severityB !== severityA) {
        return severityB - severityA;
      }
      const categoryCompare = String(a2.category).localeCompare(
        String(b2.category)
      );
      if (categoryCompare !== 0) {
        return categoryCompare;
      }
      if (typeof a2.id === "number" && typeof b2.id === "number") {
        return a2.id - b2.id;
      }
      return String(a2.id).localeCompare(String(b2.id));
    });
  }
  function renderInsightSparkline(values, width = 60, height = 20) {
    if (!values || values.length < 2) {
      return `<span class="sparkline-empty" aria-label="No trend data available">\u2014</span>`;
    }
    const limitedValues = values.length > MAX_SPARKLINE_POINTS ? values.slice(-MAX_SPARKLINE_POINTS) : values;
    const cleanValues = limitedValues.filter(
      (v2) => typeof v2 === "number" && Number.isFinite(v2)
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
    const points = cleanValues.map((val, i2) => {
      const x2 = padding + i2 / (cleanValues.length - 1) * effectiveWidth;
      const y2 = padding + (1 - (val - minVal) / range) * effectiveHeight;
      return `${x2.toFixed(1)},${y2.toFixed(1)}`;
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
    const severityInfo = SEVERITY_ICONS.get(insight.severity) ?? defaultSeverity;
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
  function renderAIInsights(container, insights, isStale2) {
    if (!container) return;
    if (!insights) return;
    const content = document.createElement("div");
    content.className = "insights-content";
    if (isStale2 && insights.generated_at) {
      appendTrustedHtml(content, renderStaleDataBanner(insights.generated_at));
    }
    if (insights.is_stub) {
      appendTrustedHtml(content, renderPreviewBanner());
    }
    const sortedInsights = sortInsights(insights.insights);
    const defaultSeverityInfo = { icon: "\u{1F535}", label: "Informational" };
    ["critical", "warning", "info"].forEach((severity) => {
      const items = sortedInsights.filter(
        (i2) => i2.severity === severity
      );
      if (!items.length) return;
      const severityInfo = SEVERITY_ICONS.get(severity) ?? defaultSeverityInfo;
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
            ${items.map((i2) => renderRichInsightCard(i2)).join("")}
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
  var SPARKLINE_LOOKBACK_WEEKS = 8;
  function getLookbackWeekCount(rollupCount) {
    return Math.min(rollupCount, SPARKLINE_LOOKBACK_WEEKS);
  }
  function renderDelta(element, percentChange, inverse = false, periodLabel = "vs prev") {
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
      `<span class="delta-arrow">${arrow}</span> ${sign}${absChange.toFixed(0)}% <span class="delta-label">${periodLabel}</span>`
    );
  }
  function renderSparkline(element, values) {
    if (!element || !values) {
      if (element) clearElement(element);
      return;
    }
    const nonNull = values.filter((v2) => v2 !== null);
    if (nonNull.length < 2) {
      clearElement(element);
      return;
    }
    const data = nonNull.slice(-SPARKLINE_LOOKBACK_WEEKS);
    const width = 60;
    const height = 24;
    const padding = 2;
    const minVal = Math.min(...data);
    const maxVal = Math.max(...data);
    const range = maxVal - minVal || 1;
    const points = data.map((val, i2) => {
      const x2 = padding + i2 / (data.length - 1) * (width - padding * 2);
      const y2 = height - padding - (val - minVal) / range * (height - padding * 2);
      return { x: x2, y: y2 };
    });
    const pathD = buildLinePath(points);
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
    dismissAllTooltips();
  }
  function ensureDismissListener() {
    if (dismissListenerController) return;
    dismissListenerController = new AbortController();
    const { signal } = dismissListenerController;
    document.addEventListener(
      "click",
      (e2) => {
        if (!document.querySelector(".chart-tooltip")) return;
        const target = e2.target;
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
      const content = contentFn(dot);
      showChartTooltip(dot, content);
    }
    dots.forEach((dot) => {
      const el = dot;
      let pointerOrigin = null;
      el.addEventListener("mouseenter", () => showTooltip(el), { signal });
      el.addEventListener("mouseleave", () => dismissActiveTooltip(), { signal });
      el.addEventListener(
        "pointerdown",
        (e2) => {
          pointerOrigin = { x: e2.clientX, y: e2.clientY };
        },
        { signal }
      );
      el.addEventListener(
        "pointerup",
        (e2) => {
          if (!pointerOrigin) return;
          const dx = e2.clientX - pointerOrigin.x;
          const dy = e2.clientY - pointerOrigin.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          pointerOrigin = null;
          if (distance < SCROLL_CANCEL_THRESHOLD) {
            showTooltip(el);
          }
        },
        { signal }
      );
    });
  }

  // ../ui/modules/charts/summary-cards.ts
  var METRIC_EXPLANATIONS = /* @__PURE__ */ new Map([
    [
      "totalPrs",
      "Total merged pull requests in the selected period and filters."
    ],
    [
      "cycleP50",
      "Median time from PR creation to merge. Half of all PRs completed faster than this. Calculated from weekly summaries."
    ],
    [
      "cycleP90",
      "90th percentile cycle time. 90% of PRs completed faster. High values may indicate bottlenecks. Calculated from weekly summaries."
    ],
    [
      "authorsCount",
      "Average number of unique PR authors per week in this period."
    ],
    [
      "reviewersCount",
      "Average number of unique reviewers per week in this period."
    ],
    [
      "reviewTimeP50",
      "Median time from first review request to review completion. Half of all reviews completed faster than this. Calculated from weekly summaries."
    ],
    [
      "reviewTimeP90",
      "90th percentile review time. 90% of reviews completed faster. High values may indicate review bottlenecks. Calculated from weekly summaries."
    ]
  ]);
  function renderSummaryCards(options) {
    const { rollups, prevRollups = [], containers, metricsCollector: metricsCollector2 } = options;
    if (metricsCollector2) metricsCollector2.mark("render-summary-cards-start");
    const current = calculateMetrics(rollups);
    const previous = calculateMetrics(prevRollups);
    renderMetricValues(containers, current);
    renderSampleSize(containers, current);
    attachInfoIcons(containers, options.reviewerFilterActive ?? false);
    const sparklineData = extractSparklineData(rollups);
    renderSparklines(containers, sparklineData);
    wrapSparklineTrigger(containers.totalPrsSparkline, "throughput");
    wrapSparklineTrigger(containers.cycleP50Sparkline, "cycle-time");
    wrapSparklineTrigger(containers.cycleP90Sparkline, "cycle-time");
    wrapSparklineTrigger(containers.reviewersSparkline, "reviewer");
    renderSparklineLabels(containers, current);
    if (prevRollups && prevRollups.length > 0) {
      renderDeltas(containers, current, previous);
    } else {
      clearDeltas(containers);
    }
    toggleReviewTimeCard(
      containers.reviewTimeP50,
      current.reviewTimeP50WeekCount > 0
    );
    toggleReviewTimeCard(
      containers.reviewTimeP90,
      current.reviewTimeP90WeekCount > 0
    );
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
  function metricWeekCount(metrics, key) {
    switch (key) {
      case "cycleP50":
        return metrics.cycleP50WeekCount;
      case "cycleP90":
        return metrics.cycleP90WeekCount;
      case "reviewTimeP50":
        return metrics.reviewTimeP50WeekCount;
      case "reviewTimeP90":
        return metrics.reviewTimeP90WeekCount;
      default:
        return metrics.weekCount;
    }
  }
  function isSparseMetric(key) {
    return key === "cycleP50" || key === "cycleP90" || key === "reviewTimeP50" || key === "reviewTimeP90";
  }
  function sampleTierClass(count, low, moderate) {
    if (count < low) return "metric-sample-size low-sample";
    if (count < moderate) return "metric-sample-size moderate-sample";
    return "metric-sample-size";
  }
  function renderSampleSize(containers, metrics) {
    const weekLabel = (n2) => `From ${n2} ${n2 === 1 ? "week" : "weeks"} of data`;
    const pointLabel = (n2) => `From ${n2} data ${n2 === 1 ? "point" : "points"}`;
    const config = [
      {
        el: containers.totalPrs,
        count: metrics.totalPrs,
        label: `Based on ${metrics.totalPrs.toLocaleString()} ${metrics.totalPrs === 1 ? "PR" : "PRs"}`,
        low: LOW_SAMPLE_THRESHOLD,
        moderate: MODERATE_SAMPLE_THRESHOLD
      },
      {
        el: containers.cycleP50,
        count: metrics.cycleP50WeekCount,
        label: pointLabel(metrics.cycleP50WeekCount),
        low: LOW_WEEK_THRESHOLD,
        moderate: MODERATE_WEEK_THRESHOLD
      },
      {
        el: containers.cycleP90,
        count: metrics.cycleP90WeekCount,
        label: pointLabel(metrics.cycleP90WeekCount),
        low: LOW_WEEK_THRESHOLD,
        moderate: MODERATE_WEEK_THRESHOLD
      },
      {
        el: containers.reviewTimeP50,
        count: metrics.reviewTimeP50WeekCount,
        label: pointLabel(metrics.reviewTimeP50WeekCount),
        low: LOW_WEEK_THRESHOLD,
        moderate: MODERATE_WEEK_THRESHOLD
      },
      {
        el: containers.reviewTimeP90,
        count: metrics.reviewTimeP90WeekCount,
        label: pointLabel(metrics.reviewTimeP90WeekCount),
        low: LOW_WEEK_THRESHOLD,
        moderate: MODERATE_WEEK_THRESHOLD
      },
      {
        el: containers.authorsCount,
        count: metrics.weekCount,
        label: weekLabel(metrics.weekCount),
        low: LOW_WEEK_THRESHOLD,
        moderate: MODERATE_WEEK_THRESHOLD
      },
      {
        el: containers.reviewersCount,
        count: metrics.weekCount,
        label: weekLabel(metrics.weekCount),
        low: LOW_WEEK_THRESHOLD,
        moderate: MODERATE_WEEK_THRESHOLD
      }
    ];
    for (const { el, count, label, low, moderate } of config) {
      const card = el?.closest(".card");
      if (!card) continue;
      const existing = card.querySelector(".metric-sample-size");
      if (existing) existing.remove();
      if (count === 0) continue;
      const subtitle = document.createElement("p");
      subtitle.className = sampleTierClass(count, low, moderate);
      subtitle.textContent = label;
      const title = card.querySelector("h3");
      if (title?.nextSibling) {
        card.insertBefore(subtitle, title.nextSibling);
      } else {
        card.appendChild(subtitle);
      }
    }
  }
  function renderSparklineLabels(containers, metrics) {
    const sparklineConfig = [
      { el: containers.totalPrsSparkline, key: "totalPrs" },
      { el: containers.cycleP50Sparkline, key: "cycleP50" },
      { el: containers.cycleP90Sparkline, key: "cycleP90" },
      { el: containers.reviewTimeP50Sparkline, key: "reviewTimeP50" },
      { el: containers.reviewTimeP90Sparkline, key: "reviewTimeP90" },
      { el: containers.authorsSparkline, key: "authorsCount" },
      { el: containers.reviewersSparkline, key: "reviewersCount" }
    ];
    for (const { el, key } of sparklineConfig) {
      if (!el) continue;
      const card = el.closest(".card");
      if (!card) continue;
      const existing = card.querySelector(".sparkline-label");
      if (existing) existing.remove();
      const count = getLookbackWeekCount(metricWeekCount(metrics, key));
      if (count < 1) continue;
      const text = isSparseMetric(key) ? `${count} data ${count === 1 ? "point" : "points"}` : `Last ${count} ${count === 1 ? "week" : "weeks"}`;
      const label = document.createElement("p");
      label.className = "sparkline-label";
      label.textContent = text;
      const metricRow = el.closest(".metric-row");
      const insertTarget = metricRow ?? el;
      if (insertTarget.nextSibling) {
        card.insertBefore(label, insertTarget.nextSibling);
      } else {
        card.appendChild(label);
      }
    }
  }
  function toggleReviewTimeCard(el, visible) {
    const card = el?.closest(".card");
    if (!card) return;
    card.style.display = visible ? "" : "none";
    if (!visible && el) el.textContent = "";
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
    if (containers.reviewTimeP50) {
      containers.reviewTimeP50.textContent = metrics.reviewTimeP50 !== null ? formatDuration(metrics.reviewTimeP50) : "-";
    }
    if (containers.reviewTimeP90) {
      containers.reviewTimeP90.textContent = metrics.reviewTimeP90 !== null ? formatDuration(metrics.reviewTimeP90) : "-";
    }
    if (containers.authorsCount) {
      containers.authorsCount.textContent = metrics.avgAuthors.toLocaleString();
    }
    if (containers.reviewersCount) {
      containers.reviewersCount.textContent = metrics.avgReviewers.toLocaleString();
    }
  }
  function wrapSparklineTrigger(container, targetChart) {
    const svg = container?.querySelector("svg");
    if (!svg) return;
    const label = targetChart === "cycle-time" ? "cycle time" : targetChart;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sparkline-trigger";
    button.setAttribute("data-drilldown-target-chart", targetChart);
    button.setAttribute("aria-label", `Open full ${label} chart`);
    svg.before(button);
    button.appendChild(svg);
  }
  function renderSparklines(containers, data) {
    renderSparkline(containers.totalPrsSparkline, data.prCounts);
    renderSparkline(containers.cycleP50Sparkline, data.p50s);
    renderSparkline(containers.cycleP90Sparkline, data.p90s);
    renderSparkline(containers.reviewTimeP50Sparkline, data.reviewTimeP50s);
    renderSparkline(containers.reviewTimeP90Sparkline, data.reviewTimeP90s);
    renderSparkline(containers.authorsSparkline, data.authors);
    renderSparkline(containers.reviewersSparkline, data.reviewers);
  }
  function deltaPeriodLabel(current, previous, key) {
    if (isSparseMetric(key)) return "vs prior period";
    const cur = metricWeekCount(current, key);
    const prev = metricWeekCount(previous, key);
    if (prev !== cur) return "vs prior period";
    return `vs prior ${prev} ${prev === 1 ? "week" : "weeks"}`;
  }
  function renderDeltas(containers, current, previous) {
    renderDelta(
      containers.totalPrsDelta,
      calculatePercentChange(current.totalPrs, previous.totalPrs),
      false,
      deltaPeriodLabel(current, previous, "totalPrs")
    );
    renderDelta(
      containers.cycleP50Delta,
      calculatePercentChange(current.cycleP50, previous.cycleP50),
      true,
      // Inverse: lower is better
      deltaPeriodLabel(current, previous, "cycleP50")
    );
    renderDelta(
      containers.cycleP90Delta,
      calculatePercentChange(current.cycleP90, previous.cycleP90),
      true,
      // Inverse: lower is better
      deltaPeriodLabel(current, previous, "cycleP90")
    );
    renderDelta(
      containers.reviewTimeP50Delta,
      calculatePercentChange(current.reviewTimeP50, previous.reviewTimeP50),
      true,
      // Inverse: lower review time is better
      deltaPeriodLabel(current, previous, "reviewTimeP50")
    );
    renderDelta(
      containers.reviewTimeP90Delta,
      calculatePercentChange(current.reviewTimeP90, previous.reviewTimeP90),
      true,
      // Inverse: lower review time is better
      deltaPeriodLabel(current, previous, "reviewTimeP90")
    );
    renderDelta(
      containers.authorsDelta,
      calculatePercentChange(current.avgAuthors, previous.avgAuthors),
      false,
      deltaPeriodLabel(current, previous, "authorsCount")
    );
    renderDelta(
      containers.reviewersDelta,
      calculatePercentChange(current.avgReviewers, previous.avgReviewers),
      false,
      deltaPeriodLabel(current, previous, "reviewersCount")
    );
  }
  function clearDeltas(containers) {
    const deltaElements = [
      containers.totalPrsDelta,
      containers.cycleP50Delta,
      containers.cycleP90Delta,
      containers.reviewTimeP50Delta,
      containers.reviewTimeP90Delta,
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
  var METRIC_TO_CONTAINER_KEY = [
    { metricId: "totalPrs", containerKey: "totalPrs" },
    { metricId: "cycleP50", containerKey: "cycleP50" },
    { metricId: "cycleP90", containerKey: "cycleP90" },
    { metricId: "reviewTimeP50", containerKey: "reviewTimeP50" },
    { metricId: "reviewTimeP90", containerKey: "reviewTimeP90" },
    { metricId: "authorsCount", containerKey: "authorsCount" },
    { metricId: "reviewersCount", containerKey: "reviewersCount" }
  ];
  var infoIconControllers = /* @__PURE__ */ new WeakMap();
  function attachInfoIcons(containers, reviewerFilterActive) {
    const containerMap = new Map(
      Object.entries(containers)
    );
    for (const { metricId, containerKey } of METRIC_TO_CONTAINER_KEY) {
      const valueEl = containerMap.get(containerKey) ?? null;
      if (!valueEl) continue;
      const card = valueEl.closest(".card");
      if (!card) continue;
      const title = card.querySelector("h3");
      if (!title) continue;
      const existing = title.querySelector(
        ".info-icon-btn"
      );
      if (existing) {
        infoIconControllers.get(existing)?.abort();
        infoIconControllers.delete(existing);
        existing.remove();
      }
      let explanation = METRIC_EXPLANATIONS.get(metricId);
      if (metricId === "reviewersCount" && reviewerFilterActive) {
        explanation = "Average number of reviews per week in this period.";
      }
      const controller = new AbortController();
      const { signal } = controller;
      const btn = document.createElement("button");
      btn.className = "info-icon-btn";
      btn.setAttribute("type", "button");
      btn.setAttribute("aria-label", `About this metric`);
      btn.setAttribute("data-info-tooltip", metricId);
      btn.textContent = "\u2139";
      btn.addEventListener(
        "pointerenter",
        () => {
          showInfoTooltip(btn, explanation);
        },
        { signal }
      );
      btn.addEventListener(
        "pointerleave",
        () => {
          dismissAllTooltips();
        },
        { signal }
      );
      btn.addEventListener(
        "click",
        (e2) => {
          e2.stopPropagation();
          const existing2 = document.querySelector(".info-tooltip");
          if (existing2) {
            dismissAllTooltips();
          } else {
            showInfoTooltip(btn, explanation);
            requestAnimationFrame(() => {
              const dismissOnce = () => {
                dismissAllTooltips();
                document.removeEventListener("click", dismissOnce);
              };
              document.addEventListener("click", dismissOnce);
            });
          }
        },
        { signal }
      );
      infoIconControllers.set(btn, controller);
      title.appendChild(btn);
    }
  }

  // ../ui/modules/empty-state-classifier.ts
  var EMPTY_STATE_MESSAGES = {
    NOT_EXTRACTED: "This data is not yet available.",
    FILTER_CAUSED: "No data matches your current filters.",
    MINIMUM_DATA_TREND: "Not enough data for trend analysis.",
    MINIMUM_DATA_GENERIC: "Insufficient data for this view.",
    DATE_RANGE_EMPTY: "No data in this period."
  };
  var EMPTY_STATE_HINTS = {
    NOT_EXTRACTED_REVIEWER: "Ensure the data pipeline is configured to capture reviewer information.",
    NOT_EXTRACTED_CYCLE_TIME: "Cycle time data requires PR completion timestamps in the extraction pipeline.",
    FILTER_CAUSED: "Try removing some filters or widening the date range.",
    MINIMUM_TREND: "At least 2 weeks of data are needed to show trends.",
    MINIMUM_GENERIC: "Try widening the date range.",
    DATE_RANGE: "Try widening the date range or selecting a different period."
  };
  function hasActiveFilters(filters) {
    return filters.repos.length > 0 || filters.teams.length > 0 || filters.reviewers.length > 0 || filters.authors.length > 0;
  }
  function checkNotExtracted(ctx) {
    const { chartType, availability } = ctx;
    if (chartType === "reviewer_activity" && !availability.reviewerDataPresent) {
      return {
        reason: "not_extracted",
        message: EMPTY_STATE_MESSAGES.NOT_EXTRACTED,
        hint: EMPTY_STATE_HINTS.NOT_EXTRACTED_REVIEWER
      };
    }
    if ((chartType === "cycle_time_trend" || chartType === "cycle_time_distribution") && !availability.cycleTimePresent) {
      return {
        reason: "not_extracted",
        message: EMPTY_STATE_MESSAGES.NOT_EXTRACTED,
        hint: EMPTY_STATE_HINTS.NOT_EXTRACTED_CYCLE_TIME
      };
    }
    return null;
  }
  function allMetricsZeroed(rollups) {
    if (rollups.length === 0) return true;
    return rollups.every((r2) => r2.pr_count === 0);
  }
  function checkFilterCaused(ctx) {
    if (hasActiveFilters(ctx.filters) && ctx.unfilteredRollups.length > 0 && !allMetricsZeroed(ctx.unfilteredRollups) && (ctx.filteredRollups.length === 0 || allMetricsZeroed(ctx.filteredRollups))) {
      return {
        reason: "filter_caused",
        message: EMPTY_STATE_MESSAGES.FILTER_CAUSED,
        hint: EMPTY_STATE_HINTS.FILTER_CAUSED
      };
    }
    return null;
  }
  function checkMinimumData(ctx) {
    if (ctx.filteredRollups.length > 0 && ctx.filteredRollups.length < ctx.minimumDataPoints) {
      const isTrend = ctx.chartType === "cycle_time_trend";
      return {
        reason: "minimum_data",
        message: isTrend ? EMPTY_STATE_MESSAGES.MINIMUM_DATA_TREND : EMPTY_STATE_MESSAGES.MINIMUM_DATA_GENERIC,
        hint: isTrend ? EMPTY_STATE_HINTS.MINIMUM_TREND : EMPTY_STATE_HINTS.MINIMUM_GENERIC
      };
    }
    return null;
  }
  function checkDateRangeEmpty(ctx) {
    if (ctx.unfilteredRollups.length === 0) {
      return {
        reason: "date_range_empty",
        message: EMPTY_STATE_MESSAGES.DATE_RANGE_EMPTY,
        hint: EMPTY_STATE_HINTS.DATE_RANGE
      };
    }
    return null;
  }
  function classifyEmptyState(ctx) {
    return checkNotExtracted(ctx) ?? checkFilterCaused(ctx) ?? checkMinimumData(ctx) ?? checkDateRangeEmpty(ctx);
  }

  // ../ui/modules/drilldown/week-range.ts
  function parseIsoLocalDate(iso) {
    const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m2) return null;
    const year = Number(m2[1]);
    const month = Number(m2[2]);
    const day = Number(m2[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return null;
    }
    return date;
  }
  function isoWeekRange(week) {
    const match = /^(\d{4})-W(\d{1,2})$/.exec(week);
    if (!match) return null;
    const year = Number(match[1]);
    const weekNum = Number(match[2]);
    if (weekNum < 1 || weekNum > 53) return null;
    const jan4 = new Date(year, 0, 4);
    const mondayOffset = (jan4.getDay() + 6) % 7;
    const start = new Date(jan4);
    start.setDate(jan4.getDate() - mondayOffset + (weekNum - 1) * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start, end };
  }
  function formatWeekRangeTitle(start, end) {
    const startMonth = start.toLocaleDateString("en-US", { month: "short" });
    const endMonth = end.toLocaleDateString("en-US", { month: "short" });
    const startYear = start.getFullYear();
    const endYear = end.getFullYear();
    if (startYear !== endYear) {
      return `${startMonth} ${start.getDate()}, ${startYear} \u2013 ${endMonth} ${end.getDate()}, ${endYear}`;
    }
    if (startMonth === endMonth) {
      return `${startMonth} ${start.getDate()} \u2013 ${end.getDate()}, ${startYear}`;
    }
    return `${startMonth} ${start.getDate()} \u2013 ${endMonth} ${end.getDate()}, ${startYear}`;
  }
  function formatWeekTitle(rollup) {
    const start = rollup.start_date ? parseIsoLocalDate(rollup.start_date) : null;
    const end = rollup.end_date ? parseIsoLocalDate(rollup.end_date) : null;
    if (start && end) {
      return `Week of ${formatWeekRangeTitle(start, end)}`;
    }
    const range = isoWeekRange(rollup.week);
    if (!range) return `Week ${rollup.week}`;
    return `Week of ${formatWeekRangeTitle(range.start, range.end)}`;
  }
  function weekRangeForAria(rollup) {
    const start = rollup.start_date ? parseIsoLocalDate(rollup.start_date) : null;
    const end = rollup.end_date ? parseIsoLocalDate(rollup.end_date) : null;
    if (start && end) {
      return formatWeekRangeTitle(start, end);
    }
    const range = isoWeekRange(rollup.week);
    if (!range) return rollup.week;
    return formatWeekRangeTitle(range.start, range.end);
  }

  // ../ui/modules/charts/throughput.ts
  var MAX_THROUGHPUT_POINTS = 104;
  var MAX_VISIBLE_LABELS = 16;
  function renderThroughputChart(container, rollups, options) {
    if (!container) return;
    clearChartTooltips(container);
    if (!rollups || !rollups.length) {
      const classification = options ? classifyEmptyState({
        chartType: "throughput",
        filters: options.filters ?? {
          repos: [],
          teams: [],
          reviewers: [],
          authors: []
        },
        unfilteredRollups: options.unfilteredRollups ?? [],
        filteredRollups: rollups,
        availability: options.availability ?? {
          reviewerDataPresent: false,
          reviewerDataEmpty: false,
          cycleTimePresent: false,
          reviewerRepoMode: "constrained",
          commentsStatus: "disabled"
        },
        minimumDataPoints: 0
      }) : null;
      renderNoData(
        container,
        classification?.message ?? "No data for selected range",
        classification?.hint ?? "Try widening the date range or adjusting repository/team filters."
      );
      return;
    }
    const truncated = rollups.length > MAX_THROUGHPUT_POINTS;
    const displayRollups = truncated ? rollups.slice(-MAX_THROUGHPUT_POINTS) : rollups;
    const prCounts = displayRollups.map((r2) => r2.pr_count || 0);
    const maxCount = Math.max(...prCounts);
    const movingAvg = calculateMovingAverage(prCounts, 4);
    const labelStep = Math.ceil(displayRollups.length / MAX_VISIBLE_LABELS);
    const barsHtml = displayRollups.map((r2, index) => {
      const count = r2.pr_count || 0;
      const height = maxCount > 0 ? count / maxCount * 100 : 0;
      const wParts = r2.week.split("-W");
      const weekLabel = wParts[1] ?? r2.week;
      const showLabel = index % labelStep === 0;
      const ariaLabel = `Drill into week of ${weekRangeForAria(r2)}, ${count} PR${count === 1 ? "" : "s"}`;
      return `
            <div class="bar-container" data-tooltip="true" data-week="${escapeHtml(r2.week)}" data-count="${count}" data-drilldown-week="${escapeHtml(r2.week)}" tabindex="0" role="button" aria-expanded="false" aria-label="${escapeHtml(ariaLabel)}">
                <div class="bar" style="height: ${height}%"></div>
                <div class="bar-label">${showLabel ? escapeHtml(weekLabel) : ""}</div>
            </div>
        `;
    }).join("");
    const trendResult = renderTrendLine(displayRollups, movingAvg, maxCount);
    const truncationHtml = renderTruncationIndicator(
      truncated,
      MAX_THROUGHPUT_POINTS
    );
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
      const week = bar.dataset.week;
      const count = bar.dataset.count;
      return `<div class="chart-tooltip-title">${escapeHtml(week)}</div>
            <div class="chart-tooltip-row">
              <span class="chart-tooltip-label">PRs</span>
              <span>${escapeHtml(count)}</span>
            </div>`;
    });
  }
  function renderTrendLine(rollups, movingAvg, maxCount) {
    if (rollups.length < 4) return { html: "", rendered: false };
    const validPoints = movingAvg.map((val, i2) => ({ val, i: i2 })).filter((p2) => p2.val !== null);
    if (validPoints.length < 2) return { html: "", rendered: false };
    const chartHeight = 200;
    const chartPadding = 8;
    const points = validPoints.map((p2) => {
      const x2 = p2.i / (rollups.length - 1) * 100;
      const y2 = maxCount > 0 ? chartHeight - chartPadding - p2.val / maxCount * (chartHeight - chartPadding * 2) : chartHeight / 2;
      return { x: x2, y: y2 };
    });
    const pathD = points.map(
      (pt, i2) => `${i2 === 0 ? "M" : "L"} ${pt.x.toFixed(1)}% ${pt.y.toFixed(1)}`
    ).join(" ");
    return {
      html: `<div class="trend-line-overlay"><svg viewBox="0 0 100 ${chartHeight}" preserveAspectRatio="none"><path class="trend-line" d="${pathD}" vector-effect="non-scaling-stroke"/></svg></div>`,
      rendered: true
    };
  }

  // ../ui/modules/charts/cycle-time.ts
  var MAX_CYCLE_TIME_POINTS = 104;
  var BUCKET_COLOR_MAP = /* @__PURE__ */ new Map([
    ["0-1h", "fast"],
    ["1-4h", "fast"],
    ["4-24h", "moderate"],
    ["1-3d", "moderate"],
    ["3-7d", "slow"],
    ["7d+", "slow"]
  ]);
  function renderCycleDistribution(container, distributions, options) {
    if (!container) return;
    if (!distributions || !distributions.length) {
      const classification = options ? classifyEmptyState({
        chartType: "cycle_time_distribution",
        filters: options.filters ?? {
          repos: [],
          teams: [],
          reviewers: [],
          authors: []
        },
        unfilteredRollups: options.unfilteredRollups ?? [],
        filteredRollups: options.unfilteredRollups ?? [],
        // Use unfiltered as proxy — distribution data is not dimension-filtered
        availability: options.availability ?? {
          reviewerDataPresent: false,
          reviewerDataEmpty: false,
          cycleTimePresent: false,
          reviewerRepoMode: "constrained",
          commentsStatus: "disabled"
        },
        minimumDataPoints: 1
        // Requires at least 1 distribution to render
      }) : null;
      renderNoData(
        container,
        classification?.message ?? "No data for selected range",
        classification?.hint ?? "Try widening the date range or adjusting repository/team filters."
      );
      return;
    }
    const buckets = /* @__PURE__ */ new Map([
      ["0-1h", 0],
      ["1-4h", 0],
      ["4-24h", 0],
      ["1-3d", 0],
      ["3-7d", 0],
      ["7d+", 0]
    ]);
    distributions.forEach((d2) => {
      Object.entries(d2.cycle_time_buckets || {}).forEach(([key, val]) => {
        buckets.set(key, (buckets.get(key) ?? 0) + val);
      });
    });
    const total = Array.from(buckets.values()).reduce((a2, b2) => a2 + b2, 0);
    if (total === 0) {
      renderNoData(
        container,
        "No cycle time data",
        "Try widening the date range or adjusting repository/team filters."
      );
      return;
    }
    const html = Array.from(buckets.entries()).map(([label, count]) => {
      const pct = (count / total * 100).toFixed(1);
      const category = BUCKET_COLOR_MAP.get(label);
      const categoryClass = category ? ` bucket-${category}` : "";
      return `
            <div class="dist-row${categoryClass}">
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
  function renderCycleTimeTrend(container, rollups, options) {
    if (!container) return;
    clearChartTooltips(container);
    if (!rollups || rollups.length < 2) {
      const classification = options ? classifyEmptyState({
        chartType: "cycle_time_trend",
        filters: options.filters ?? {
          repos: [],
          teams: [],
          reviewers: [],
          authors: []
        },
        unfilteredRollups: options.unfilteredRollups ?? [],
        filteredRollups: rollups ?? [],
        availability: options.availability ?? {
          reviewerDataPresent: false,
          reviewerDataEmpty: false,
          cycleTimePresent: false,
          reviewerRepoMode: "constrained",
          commentsStatus: "disabled"
        },
        minimumDataPoints: 2
      }) : null;
      renderNoData(
        container,
        classification?.message ?? "Not enough data for trend",
        classification?.hint ?? "At least 2 weeks of data are needed to show trends."
      );
      return;
    }
    const truncated = rollups.length > MAX_CYCLE_TIME_POINTS;
    const displayRollups = truncated ? rollups.slice(-MAX_CYCLE_TIME_POINTS) : rollups;
    const p50Data = displayRollups.map((r2) => ({
      week: r2.week,
      value: r2.cycle_time_p50,
      ariaRange: weekRangeForAria(r2)
    })).filter((d2) => d2.value !== null);
    const p90Data = displayRollups.map((r2) => ({
      week: r2.week,
      value: r2.cycle_time_p90,
      ariaRange: weekRangeForAria(r2)
    })).filter((d2) => d2.value !== null);
    if (p50Data.length < 2 && p90Data.length < 2) {
      renderNoData(
        container,
        "No cycle time data available",
        "Try widening the date range or adjusting repository/team filters."
      );
      return;
    }
    const allValues = [
      ...p50Data.map((d2) => d2.value),
      ...p90Data.map((d2) => d2.value)
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
      const points = data.map((d2) => {
        const dataIndex = displayRollups.findIndex((r2) => r2.week === d2.week);
        const x2 = padding.left + dataIndex / (displayRollups.length - 1) * chartWidth;
        const y2 = padding.top + chartHeight - (d2.value - minVal) / range * chartHeight;
        return { x: x2, y: y2, week: d2.week, value: d2.value, ariaRange: d2.ariaRange };
      });
      const pathD = buildLinePath(points);
      return { pathD, points };
    };
    const p50Path = p50Data.length >= 2 ? generatePath(p50Data) : null;
    const p90Path = p90Data.length >= 2 ? generatePath(p90Data) : null;
    const HIT_HALF = 12;
    const yLabels = [minVal, (minVal + maxVal) / 2, maxVal];
    const svgContent = `
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMid meet">
            <!-- Grid lines -->
            ${yLabels.map((_2, i2) => {
      const y2 = padding.top + chartHeight - i2 / (yLabels.length - 1) * chartHeight;
      return `<line class="line-chart-grid" x1="${padding.left}" y1="${y2}" x2="${width - padding.right}" y2="${y2}"/>`;
    }).join("")}

            <!-- Y-axis labels -->
            ${yLabels.map((val, i2) => {
      const y2 = padding.top + chartHeight - i2 / (yLabels.length - 1) * chartHeight;
      return `<text class="line-chart-axis" x="${padding.left - 4}" y="${y2 + 3}" text-anchor="end">${formatDuration(val)}</text>`;
    }).join("")}

            <!-- Lines -->
            ${p90Path ? `<path class="line-chart-p90" d="${p90Path.pathD}" vector-effect="non-scaling-stroke"/>` : ""}
            ${p50Path ? `<path class="line-chart-p50" d="${p50Path.pathD}" vector-effect="non-scaling-stroke"/>` : ""}

            <!-- Dot triggers. Keyboard + click activation lives on the
                 <g> wrapper (drill-down attrs + role/tabindex/aria-* +
                 invisible 24x24 hit <rect>). The visible <circle> keeps
                 the data-tooltip surface so addChartTooltips's pointer
                 listeners stay anchored to the small visible dot \u2014 moving
                 data-tooltip onto the <g> would shift the tooltip anchor
                 onto the larger hit-rect bounding box.
                 See specs/059-chart-drill-down + PR #302 review P1.D. -->
            ${p90Path ? p90Path.points.map((p2) => `<g role="button" tabindex="0" data-drilldown-week="${escapeHtml(p2.week)}" data-drilldown-metric="p90" aria-expanded="false" aria-label="${escapeHtml(`Drill into P90 for week of ${p2.ariaRange}`)}"><rect class="line-chart-dot-hit" x="${p2.x - HIT_HALF}" y="${p2.y - HIT_HALF}" width="${HIT_HALF * 2}" height="${HIT_HALF * 2}" fill="transparent" pointer-events="all"/><circle class="line-chart-dot" data-tooltip="true" cx="${p2.x}" cy="${p2.y}" r="${dotRadius}" fill="var(--warning)" data-week="${escapeHtml(p2.week)}" data-value="${escapeHtml(String(p2.value))}" data-metric="P90"/></g>`).join("") : ""}
            ${p50Path ? p50Path.points.map((p2) => `<g role="button" tabindex="0" data-drilldown-week="${escapeHtml(p2.week)}" data-drilldown-metric="p50" aria-expanded="false" aria-label="${escapeHtml(`Drill into P50 for week of ${p2.ariaRange}`)}"><rect class="line-chart-dot-hit" x="${p2.x - HIT_HALF}" y="${p2.y - HIT_HALF}" width="${HIT_HALF * 2}" height="${HIT_HALF * 2}" fill="transparent" pointer-events="all"/><circle class="line-chart-dot" data-tooltip="true" cx="${p2.x}" cy="${p2.y}" r="${dotRadius}" fill="var(--primary)" data-week="${escapeHtml(p2.week)}" data-value="${escapeHtml(String(p2.value))}" data-metric="P50"/></g>`).join("") : ""}
        </svg>
    `;
    const legendItems = [];
    if (p50Path) {
      legendItems.push(
        `<div class="legend-item"><span class="chart-tooltip-dot legend-p50"></span><span>P50 (Median)</span></div>`
      );
    } else if (p50Data.length > 0) {
      legendItems.push(
        `<div class="legend-item legend-insufficient"><span class="chart-tooltip-dot legend-p50 dimmed"></span><span>P50 (Median) \u2014 insufficient points</span></div>`
      );
    }
    if (p90Path) {
      legendItems.push(
        `<div class="legend-item"><span class="chart-tooltip-dot legend-p90"></span><span>P90</span></div>`
      );
    } else if (p90Data.length > 0) {
      legendItems.push(
        `<div class="legend-item legend-insufficient"><span class="chart-tooltip-dot legend-p90 dimmed"></span><span>P90 \u2014 insufficient points</span></div>`
      );
    }
    const legendHtml = `<div class="chart-legend">${legendItems.join("")}</div>`;
    const truncationHtml = renderTruncationIndicator(
      truncated,
      MAX_CYCLE_TIME_POINTS
    );
    renderTrustedHtml(
      container,
      `${truncationHtml}<div class="line-chart">${svgContent}</div>${legendHtml}`
    );
    addChartTooltips(container, (dot) => {
      const week = dot.dataset["week"];
      const value = parseFloat(dot.dataset["value"]);
      const metric = dot.dataset["metric"];
      const legendClass = metric === "P50" ? "legend-p50" : "legend-p90";
      return `<div class="chart-tooltip-title">${escapeHtml(week)}</div>
            <div class="chart-tooltip-row">
              <span class="chart-tooltip-label">
                <span class="chart-tooltip-dot ${legendClass}"></span>
                ${escapeHtml(metric)}
              </span>
              <span>${formatDuration(value)}</span>
            </div>`;
    });
  }

  // ../ui/modules/charts/reviewer-activity.ts
  var MAX_REVIEWER_WEEKS = 8;
  function computeApprovalRate(rollups, reviewerIds) {
    let weightedSum = 0;
    let totalPrs = 0;
    let weeksWithData = 0;
    for (const rollup of rollups) {
      if (!rollup.by_reviewer || typeof rollup.by_reviewer !== "object") continue;
      const reviewerMap = new Map(
        Object.entries(
          rollup.by_reviewer
        )
      );
      let weekContributed = false;
      for (const id of reviewerIds) {
        const entry = reviewerMap.get(id);
        if (!entry) continue;
        const rate = entry.approval_rate;
        if (typeof rate !== "number" || !Number.isFinite(rate)) continue;
        const prs = entry.reviewed_prs ?? 0;
        if (prs <= 0) continue;
        weightedSum += rate * prs;
        totalPrs += prs;
        weekContributed = true;
      }
      if (weekContributed) weeksWithData++;
    }
    return {
      rate: totalPrs > 0 ? weightedSum / totalPrs : null,
      weeksWithData
    };
  }
  function renderReviewerActivity(container, rollups, options = {}) {
    if (!container) return;
    const { reviewerFilterActive = false } = options;
    if (!rollups || !rollups.length) {
      const classification = options.availability ? classifyEmptyState({
        chartType: "reviewer_activity",
        filters: options.filters ?? {
          repos: [],
          teams: [],
          reviewers: [],
          authors: []
        },
        unfilteredRollups: options.unfilteredRollups ?? [],
        filteredRollups: [],
        availability: options.availability,
        minimumDataPoints: 0
      }) : null;
      const fallbackHint = reviewerFilterActive ? "Try widening the date range or adjusting reviewer filters." : "Try widening the date range or adjusting repository/team filters.";
      renderNoData(
        container,
        classification?.message ?? (reviewerFilterActive ? "No review activity available" : "No reviewer data available"),
        classification?.hint ?? fallbackHint
      );
      return;
    }
    const noun = reviewerFilterActive ? "reviews" : "reviewers";
    const subtitle = reviewerFilterActive ? `Review activity per week (last ${Math.min(rollups.length, MAX_REVIEWER_WEEKS)} weeks)` : `Active reviewers per week (last ${Math.min(rollups.length, MAX_REVIEWER_WEEKS)} weeks)`;
    const truncated = rollups.length > MAX_REVIEWER_WEEKS;
    const recentRollups = rollups.slice(-MAX_REVIEWER_WEEKS);
    const maxReviewers = Math.max(
      ...recentRollups.map((r2) => r2.reviewers_count || 0)
    );
    if (maxReviewers === 0) {
      const classification = options.availability ? classifyEmptyState({
        chartType: "reviewer_activity",
        filters: options.filters ?? {
          repos: [],
          teams: [],
          reviewers: [],
          authors: []
        },
        unfilteredRollups: options.unfilteredRollups ?? [],
        filteredRollups: rollups,
        availability: options.availability,
        minimumDataPoints: 1
        // Requires at least 1 reviewer to render
      }) : null;
      const fallbackHint = reviewerFilterActive ? "Try widening the date range or adjusting reviewer filters." : "Reviewer data requires the extraction pipeline to capture reviewer details.";
      renderNoData(
        container,
        classification?.message ?? (reviewerFilterActive ? "No review activity available" : "No reviewer data available"),
        classification?.hint ?? fallbackHint
      );
      return;
    }
    const filterReviewerId = options.filters?.reviewers?.[0] ?? null;
    const filterReviewerAriaName = options.filterReviewerName ?? filterReviewerId ?? "";
    const barsHtml = recentRollups.map((r2) => {
      const count = r2.reviewers_count || 0;
      const pct = count / maxReviewers * 100;
      const wParts = r2.week.split("-W");
      const weekLabel = wParts[1] ?? r2.week;
      const drilldownAttrsForRow = filterReviewerId ? ` data-drilldown-reviewer-id="${escapeHtml(filterReviewerId)}" tabindex="0" role="button" aria-expanded="false" aria-label="${escapeHtml(`Drill into ${filterReviewerAriaName} for week of ${weekRangeForAria(r2)}`)}"` : "";
      return `
            <div class="h-bar-row" title="${escapeHtml(r2.week)}: ${count} ${noun}"${drilldownAttrsForRow}>
                <span class="h-bar-label">W${escapeHtml(weekLabel)}</span>
                <div class="h-bar-container">
                    <div class="h-bar" style="width: ${pct}%"></div>
                </div>
                <span class="h-bar-value">${count}</span>
            </div>
        `;
    }).join("");
    const truncationHtml = renderTruncationIndicator(
      truncated,
      MAX_REVIEWER_WEEKS
    );
    let approvalHtml = "";
    if (reviewerFilterActive) {
      const firstReviewer = options.filters?.reviewers?.[0];
      const reviewerIds = firstReviewer ? [firstReviewer] : [];
      const { rate: approvalRate, weeksWithData } = computeApprovalRate(
        recentRollups,
        reviewerIds
      );
      const coverageLabel = weeksWithData > 0 ? `(from ${weeksWithData} ${weeksWithData === 1 ? "week" : "weeks"} of data)` : "";
      if (approvalRate !== null) {
        const pct = Math.round(approvalRate * 100);
        approvalHtml = `<p class="approval-rate" data-weeks="${weeksWithData}">Approval Rate: ${pct}% ${escapeHtml(coverageLabel)}</p>`;
      } else {
        approvalHtml = `<p class="approval-rate approval-rate-no-data" data-weeks="${weeksWithData}">Approval Rate: No data</p>`;
      }
    }
    const gatingNoteHtml = !reviewerFilterActive ? `<p class="reviewer-gating-note">Filter to a reviewer to drill into weekly activity.</p>` : "";
    renderTrustedHtml(
      container,
      `${truncationHtml}<p class="chart-subtitle">${escapeHtml(subtitle)}</p>${gatingNoteHtml}<div class="horizontal-bar-chart">${barsHtml}</div>${approvalHtml}`
    );
  }

  // ../ui/modules/charts/comments-trend.ts
  var MAX_COMMENTS_TREND_POINTS = 104;
  var MAX_VISIBLE_LABELS2 = 16;
  var CHART_HEIGHT_PX = 200;
  var CHART_PADDING_PX = 8;
  function hasComments(rollup) {
    return rollup.comments !== void 0;
  }
  function renderCommentsTrendChart(container, rollups, options) {
    if (!container) return;
    void options;
    clearChartTooltips(container);
    const withComments = rollups.filter(hasComments);
    if (withComments.length === 0) {
      renderNoData(
        container,
        "No comments data for selected range",
        "Try widening the date range, or confirm comments extraction is enabled for this dataset."
      );
      return;
    }
    const truncated = withComments.length > MAX_COMMENTS_TREND_POINTS;
    const display = truncated ? withComments.slice(-MAX_COMMENTS_TREND_POINTS) : withComments;
    const maxValue = Math.max(
      1,
      ...display.map(
        (r2) => Math.max(r2.comments.thread_count, r2.comments.comment_count)
      )
    );
    const labelStep = Math.max(1, Math.ceil(display.length / MAX_VISIBLE_LABELS2));
    const barsHtml = display.map((r2, i2) => renderBar(r2, i2, labelStep, maxValue)).join("");
    const lineHtml = renderCommentsLine(display, maxValue);
    const truncationHtml = renderTruncationIndicator(
      truncated,
      MAX_COMMENTS_TREND_POINTS
    );
    const anyPartial = display.some((r2) => r2.comments.coverage_partial);
    const partialLegendItem = anyPartial ? `<div class="legend-item legend-coverage-partial-item"><span class="legend-bar legend-bar-coverage-partial"></span><span>Partial coverage</span></div>` : "";
    const legendHtml = `
    <div class="chart-legend">
      <div class="legend-item">
        <span class="legend-bar legend-bar-resolved"></span>
        <span>Resolved threads</span>
      </div>
      <div class="legend-item">
        <span class="legend-bar legend-bar-unresolved"></span>
        <span>Unresolved threads</span>
      </div>
      <div class="legend-item">
        <span class="legend-line legend-line-comments"></span>
        <span>Comments</span>
      </div>
      ${partialLegendItem}
    </div>
  `;
    renderTrustedHtml(
      container,
      `
      ${truncationHtml}
      <div class="chart-with-trend comments-trend-chart" style="--chart-surface: var(--bg-primary);">
        <div class="bar-chart comments-trend-bars">${barsHtml}</div>
        ${lineHtml}
      </div>
      ${legendHtml}
    `
    );
    addChartTooltips(container, buildTooltipHtml);
  }
  function renderBar(rollup, index, labelStep, maxValue) {
    const c = rollup.comments;
    const resolvedCount = c.thread_count - c.active_thread_count;
    const resolvedHeightPct = resolvedCount / maxValue * 100;
    const unresolvedHeightPct = c.active_thread_count / maxValue * 100;
    const weekLabel = rollup.week.split("-W")[1];
    const showLabel = index % labelStep === 0;
    const partialClass = c.coverage_partial ? " coverage-partial" : "";
    const partialAttr = c.coverage_partial ? ' data-coverage-partial="true"' : "";
    const resolvedNoun = c.thread_count === 1 ? "thread" : "threads";
    const commentNoun = c.comment_count === 1 ? "comment" : "comments";
    const partialNote = c.coverage_partial ? " \u2014 partial coverage" : "";
    const ariaLabel = `Drill into week of ${weekRangeForAria(rollup)}, ${c.thread_count} ${resolvedNoun} (${c.active_thread_count} unresolved), ${c.comment_count} ${commentNoun}${partialNote}`;
    return `
    <div class="bar-container${partialClass}" data-tooltip="true" data-week="${escapeHtml(rollup.week)}" data-thread-count="${c.thread_count}" data-active-thread-count="${c.active_thread_count}" data-comment-count="${c.comment_count}" data-drilldown-week="${escapeHtml(rollup.week)}"${partialAttr} tabindex="0" role="button" aria-expanded="false" aria-label="${escapeHtml(ariaLabel)}">
      <div class="bar-segment-unresolved" style="height: ${unresolvedHeightPct.toFixed(1)}%"></div>
      <div class="bar-segment-resolved" style="height: ${resolvedHeightPct.toFixed(1)}%"></div>
      <div class="bar-label">${showLabel ? escapeHtml(weekLabel) : ""}</div>
    </div>
  `;
  }
  function renderCommentsLine(rollups, maxValue) {
    const points = rollups.map((r2, i2) => {
      const x2 = rollups.length > 1 ? i2 / (rollups.length - 1) * 100 : 50;
      const innerHeight = CHART_HEIGHT_PX - CHART_PADDING_PX * 2;
      const ratio = r2.comments.comment_count / maxValue;
      const y2 = CHART_HEIGHT_PX - CHART_PADDING_PX - ratio * innerHeight;
      return { x: x2, y: y2 };
    });
    const pathD = points.map((p2, i2) => `${i2 === 0 ? "M" : "L"} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`).join(" ");
    const dotsHtml = points.map(
      (p2) => `<circle class="comments-line-dot" cx="${p2.x.toFixed(1)}" cy="${p2.y.toFixed(1)}" r="2" vector-effect="non-scaling-stroke"/>`
    ).join("");
    return `<div class="comments-line-overlay"><svg viewBox="0 0 100 ${CHART_HEIGHT_PX}" preserveAspectRatio="none"><path class="comments-line" d="${pathD}" vector-effect="non-scaling-stroke"/>${dotsHtml}</svg></div>`;
  }
  function buildTooltipHtml(bar) {
    const week = bar.dataset.week;
    const threads = bar.dataset.threadCount;
    const active2 = bar.dataset.activeThreadCount;
    const comments = bar.dataset.commentCount;
    const partial = bar.dataset.coveragePartial === "true";
    const partialNote = partial ? `<div class="chart-tooltip-row chart-tooltip-note">Some PRs in this week aren't yet extracted \u2014 values shown are partial totals; the full number may be higher.</div>` : "";
    return `<div class="chart-tooltip-title">${escapeHtml(week)}</div>
          <div class="chart-tooltip-row">
            <span class="chart-tooltip-label">Threads</span>
            <span>${escapeHtml(threads)} (${escapeHtml(active2)} unresolved)</span>
          </div>
          <div class="chart-tooltip-row">
            <span class="chart-tooltip-label">Comments</span>
            <span>${escapeHtml(comments)}</span>
          </div>
          ${partialNote}`;
  }

  // ../ui/modules/filters.ts
  function createEmptyFilterState() {
    return { repos: [], teams: [], reviewers: [], authors: [] };
  }
  function parseCommaSeparated(raw) {
    if (!raw) return [];
    return raw.split(",").map((v2) => v2.trim()).filter((v2) => v2.length > 0);
  }
  function parseFiltersFromUrl(params) {
    const repos = parseCommaSeparated(params.get("repos"));
    const teams = parseCommaSeparated(params.get("teams"));
    const reviewerRaw = params.get("reviewers")?.trim() ?? "";
    const authorRaw = params.get("author")?.trim() ?? "";
    return {
      repos,
      teams,
      reviewers: reviewerRaw ? [reviewerRaw] : [],
      authors: authorRaw ? [authorRaw] : []
    };
  }
  function serializeFiltersToUrl(state, params) {
    if (state.repos.length > 0) {
      const sorted = [...state.repos].sort();
      params.set("repos", sorted.join(","));
    } else {
      params.delete("repos");
    }
    if (state.teams.length > 0) {
      const sorted = [...state.teams].sort();
      params.set("teams", sorted.join(","));
    } else {
      params.delete("teams");
    }
    if (state.reviewers.length > 0) {
      const firstReviewer = state.reviewers[0];
      if (firstReviewer) {
        params.set("reviewers", firstReviewer);
      } else {
        params.delete("reviewers");
      }
    } else {
      params.delete("reviewers");
    }
    if (state.authors.length > 0) {
      const firstAuthor = state.authors[0];
      if (firstAuthor) {
        params.set("author", firstAuthor);
      } else {
        params.delete("author");
      }
    } else {
      params.delete("author");
    }
  }

  // ../ui/modules/filter-constraint-resolver.ts
  function resolveFilterConstraints(raw, lastChanged) {
    const notices = [];
    const effective = {
      repos: [...raw.repos],
      teams: [...raw.teams],
      reviewers: [...raw.reviewers],
      authors: [...raw.authors]
    };
    if (effective.reviewers.length > 1) {
      effective.reviewers = effective.reviewers[0] ? [effective.reviewers[0]] : [];
    }
    if (effective.authors.length > 1) {
      effective.authors = effective.authors[0] ? [effective.authors[0]] : [];
    }
    if (effective.authors.length > 0 && effective.reviewers.length > 0) {
      if (lastChanged === "authors") {
        effective.reviewers = [];
      } else {
        effective.authors = [];
      }
      notices.push({
        type: "author_reviewer",
        message: lastChanged === "authors" ? "Author and reviewer filters cannot be combined; reviewer filter cleared." : "Author and reviewer filters cannot be combined; using reviewer filter."
      });
    }
    if (effective.authors.length > 0 && effective.teams.length > 0) {
      notices.push({
        type: "author_team",
        message: "Author filter active; showing author-only metrics. Team selection retained for display."
      });
    }
    if (effective.reviewers.length > 0 && effective.teams.length > 0) {
      effective.teams = [];
      notices.push({
        type: "reviewer_team",
        message: "Reviewer and team filtering cannot be combined; team selection cleared."
      });
    }
    if (effective.reviewers.length > 0 && effective.repos.length > 0) {
      notices.push({
        type: "reviewer_repo",
        message: "Using reviewer-only metrics; repository selection retained for display."
      });
    }
    return { effectiveState: effective, constraintsApplied: notices };
  }

  // ../ui/modules/data-availability.ts
  var DEFAULT_CAPABILITIES = {
    authorFiltersAvailable: false,
    authorRepoExactAvailable: false,
    commentsMetricsAvailable: false,
    commentsCoverageStatus: "disabled",
    reviewerRepositoryMode: "constrained",
    reviewerTeamMode: "disallowed",
    crossDimensionalAvailable: false
  };
  function deriveAvailabilitySignal(rollups, capabilities) {
    const caps = capabilities ?? DEFAULT_CAPABILITIES;
    const hasAnyReviewerField = rollups.some(
      (r2) => r2.by_reviewer != null
      // intentional loose equality to cover both null and undefined
    );
    const allReviewerFieldsEmpty = hasAnyReviewerField && rollups.every((r2) => {
      if (r2.by_reviewer == null) return true;
      return Object.keys(r2.by_reviewer).length === 0;
    });
    const hasAnyCycleTime = rollups.some((r2) => r2.cycle_time_p50 !== null);
    return {
      reviewerDataPresent: hasAnyReviewerField,
      reviewerDataEmpty: hasAnyReviewerField && allReviewerFieldsEmpty,
      cycleTimePresent: hasAnyCycleTime,
      reviewerRepoMode: caps.reviewerRepositoryMode,
      commentsStatus: caps.commentsCoverageStatus
    };
  }

  // ../ui/modules/typeahead-dropdown.ts
  var DEBOUNCE_MS = 200;
  function initTypeaheadDropdown(config) {
    const container = document.getElementById(config.containerId);
    if (!container) return null;
    let options = [...config.options];
    let selected = [...config.initialSelection];
    let filteredOptions = [];
    let highlightIndex = -1;
    let isOpen = false;
    let debounceTimer = null;
    const controller = new AbortController();
    const { signal } = controller;
    container.innerHTML = "";
    container.classList.add("typeahead-container");
    const wrapper = document.createElement("div");
    wrapper.className = "typeahead-wrapper";
    const chipsArea = document.createElement("div");
    chipsArea.className = "typeahead-chips";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "typeahead-input";
    input.placeholder = config.placeholder;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("autocomplete", "off");
    const dropdown = document.createElement("div");
    dropdown.className = "typeahead-dropdown";
    dropdown.setAttribute("role", "listbox");
    dropdown.style.display = "none";
    wrapper.appendChild(chipsArea);
    wrapper.appendChild(input);
    container.appendChild(wrapper);
    container.appendChild(dropdown);
    function isAllSelected() {
      return config.mode === "multi" && selected.length > 0 && selected.length === options.length;
    }
    function renderChips() {
      chipsArea.innerHTML = "";
      if (config.mode !== "multi") return;
      if (isAllSelected()) return;
      selected.forEach((id) => {
        const opt = options.find((o2) => o2.id === id);
        if (!opt) return;
        const chip = document.createElement("span");
        chip.className = "typeahead-chip";
        const label = document.createElement("span");
        label.className = "typeahead-chip-label";
        label.textContent = opt.displayName;
        const remove = document.createElement("button");
        remove.className = "typeahead-chip-remove";
        remove.type = "button";
        remove.setAttribute("aria-label", `Remove ${opt.displayName}`);
        remove.textContent = "\xD7";
        remove.addEventListener(
          "click",
          (e2) => {
            e2.stopPropagation();
            deselectOption(id);
          },
          { signal }
        );
        chip.appendChild(label);
        chip.appendChild(remove);
        chipsArea.appendChild(chip);
      });
    }
    function renderDropdown() {
      dropdown.innerHTML = "";
      highlightIndex = -1;
      if (filteredOptions.length === 0) {
        const empty = document.createElement("div");
        empty.className = "typeahead-empty";
        empty.textContent = "No matching options";
        dropdown.appendChild(empty);
        return;
      }
      filteredOptions.forEach((opt) => {
        const item = document.createElement("div");
        item.className = "typeahead-option";
        item.setAttribute("role", "option");
        item.setAttribute(
          "aria-selected",
          selected.includes(opt.id) ? "true" : "false"
        );
        item.setAttribute("data-testid", `typeahead-option-${opt.id}`);
        item.dataset.optionId = opt.id;
        if (selected.includes(opt.id)) {
          item.classList.add("typeahead-option-selected");
        }
        const searchVal = input.value.toLowerCase().trim();
        if (searchVal) {
          const idx = opt.displayName.toLowerCase().indexOf(searchVal);
          item.appendChild(
            document.createTextNode(opt.displayName.substring(0, idx))
          );
          const strong = document.createElement("strong");
          strong.textContent = opt.displayName.substring(
            idx,
            idx + searchVal.length
          );
          item.appendChild(strong);
          item.appendChild(
            document.createTextNode(
              opt.displayName.substring(idx + searchVal.length)
            )
          );
        } else {
          item.textContent = opt.displayName;
        }
        item.addEventListener(
          "pointerdown",
          (e2) => {
            e2.preventDefault();
            toggleOption(opt.id);
          },
          { signal }
        );
        dropdown.appendChild(item);
      });
    }
    function updateInputDisplay() {
      if (config.mode === "single") {
        if (selected.length > 0) {
          const opt = options.find((o2) => o2.id === selected[0]);
          input.value = opt?.displayName ?? "";
        } else {
          input.value = "";
        }
        input.placeholder = selected.length > 0 ? "" : config.placeholder;
      } else {
        input.value = "";
        if (isAllSelected()) {
          input.placeholder = "All selected";
        } else if (selected.length === 0) {
          input.placeholder = config.placeholder;
        } else {
          input.placeholder = "Search...";
        }
      }
    }
    function filterOptions(query) {
      const q = query.toLowerCase().trim();
      if (!q) {
        filteredOptions = [...options];
      } else {
        filteredOptions = options.filter(
          (o2) => o2.displayName.toLowerCase().includes(q)
        );
      }
      renderDropdown();
    }
    function normalizeAndEmit() {
      const emitted = isAllSelected() ? [] : [...selected];
      config.onChange(emitted);
    }
    function selectOption(id) {
      selected.push(id);
      input.value = "";
      filterOptions("");
      renderChips();
      updateInputDisplay();
      normalizeAndEmit();
    }
    function deselectOption(id) {
      selected = selected.filter((s2) => s2 !== id);
      renderChips();
      if (isOpen) renderDropdown();
      updateInputDisplay();
      normalizeAndEmit();
    }
    function toggleOption(id) {
      if (config.mode === "single") {
        if (selected[0] === id) {
          selected = [];
          updateInputDisplay();
        } else {
          selected = [id];
          updateInputDisplay();
          closeDropdown();
        }
        normalizeAndEmit();
        return;
      }
      if (selected.includes(id)) {
        deselectOption(id);
        return;
      }
      selectOption(id);
    }
    function openDropdown() {
      isOpen = true;
      dropdown.style.display = "";
      input.setAttribute("aria-expanded", "true");
      filterOptions(config.mode === "single" ? "" : input.value);
    }
    function closeDropdown() {
      if (!isOpen) return;
      isOpen = false;
      dropdown.style.display = "none";
      input.setAttribute("aria-expanded", "false");
      highlightIndex = -1;
      if (config.mode === "single") {
        updateInputDisplay();
      }
    }
    input.addEventListener(
      "focus",
      () => {
        if (config.mode === "single") {
          input.value = "";
        }
        openDropdown();
      },
      { signal }
    );
    input.addEventListener(
      "blur",
      () => {
        requestAnimationFrame(() => {
          closeDropdown();
        });
      },
      { signal }
    );
    input.addEventListener(
      "input",
      () => {
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          filterOptions(input.value);
          if (!isOpen) openDropdown();
        }, DEBOUNCE_MS);
      },
      { signal }
    );
    input.addEventListener(
      "keydown",
      (e2) => {
        const items = dropdown.querySelectorAll(".typeahead-option");
        if (e2.key === "ArrowDown") {
          e2.preventDefault();
          highlightIndex = Math.min(highlightIndex + 1, items.length - 1);
          updateHighlight(items);
        } else if (e2.key === "ArrowUp") {
          e2.preventDefault();
          highlightIndex = Math.max(highlightIndex - 1, 0);
          updateHighlight(items);
        } else if (e2.key === "Enter") {
          e2.preventDefault();
          if (debounceTimer !== null) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
            filterOptions(input.value);
          }
          if (highlightIndex >= 0 && highlightIndex < filteredOptions.length) {
            const opt = filteredOptions.at(highlightIndex);
            toggleOption(opt.id);
          }
        } else if (e2.key === "Escape") {
          closeDropdown();
          input.blur();
        } else if (e2.key === "Backspace" && input.value === "" && config.mode === "multi" && selected.length > 0) {
          deselectOption(selected.at(-1));
        }
      },
      { signal }
    );
    document.addEventListener(
      "pointerdown",
      (e2) => {
        if (!container.contains(e2.target)) {
          closeDropdown();
        }
      },
      { signal }
    );
    function updateHighlight(items) {
      items.forEach((item, i2) => {
        item.classList.toggle(
          "typeahead-option-highlighted",
          i2 === highlightIndex
        );
      });
      const highlighted = Array.from(items).at(highlightIndex);
      highlighted?.scrollIntoView({ block: "nearest" });
    }
    filteredOptions = [...options];
    renderChips();
    updateInputDisplay();
    const instance = {
      getSelected() {
        return isAllSelected() ? [] : [...selected];
      },
      setSelected(ids) {
        selected = ids.filter((id) => options.some((o2) => o2.id === id));
        renderChips();
        if (isOpen) renderDropdown();
        updateInputDisplay();
      },
      setOptions(newOptions) {
        options = [...newOptions];
        selected = selected.filter((id) => options.some((o2) => o2.id === id));
        renderChips();
        updateInputDisplay();
        filterOptions(input.value);
      },
      clear() {
        selected = [];
        input.value = "";
        renderChips();
        updateInputDisplay();
        normalizeAndEmit();
      },
      destroy() {
        if (debounceTimer !== null) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        controller.abort();
        container.innerHTML = "";
        container.classList.remove("typeahead-container");
      }
    };
    return instance;
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
    const rows = rollups.map((r2) => [
      r2.week,
      r2.start_date || "",
      r2.end_date || "",
      r2.pr_count || 0,
      r2.cycle_time_p50 != null ? r2.cycle_time_p50.toFixed(1) : "",
      r2.cycle_time_p90 != null ? r2.cycle_time_p90.toFixed(1) : "",
      r2.authors_count || 0,
      r2.reviewers_count || 0
    ]);
    const headerRow = CSV_HEADERS.map((h2) => h2);
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

  // ../ui/modules/loading-state.ts
  var SPINNER_CLASS = "metrics-loading-spinner";
  var LOADING_CLASS = "metrics-loading";
  var currentCycleId = 0;
  var active = false;
  var inFlightState = null;
  var announcementTimerId = null;
  var announceGeneration = 0;
  function addSpinner(region) {
    if (region.querySelector(`.${SPINNER_CLASS}`)) return;
    const spinner = document.createElement("div");
    spinner.className = SPINNER_CLASS;
    region.appendChild(spinner);
  }
  function removeSpinner(region) {
    const spinner = region.querySelector(`.${SPINNER_CLASS}`);
    if (spinner) {
      spinner.remove();
    }
  }
  function cancelAnnouncementTimer() {
    if (announcementTimerId !== null) {
      clearTimeout(announcementTimerId);
      announcementTimerId = null;
    }
  }
  function announce(statusEl, message) {
    cancelAnnouncementTimer();
    announceGeneration += 1;
    const gen = announceGeneration;
    statusEl.textContent = "";
    void Promise.resolve().then(() => {
      if (gen - announceGeneration !== 0) return;
      statusEl.textContent = message;
      announcementTimerId = setTimeout(() => {
        statusEl.textContent = "";
        announcementTimerId = null;
      }, 1e3);
    });
  }
  function clearAnnouncement(statusEl) {
    cancelAnnouncementTimer();
    announceGeneration += 1;
    if (statusEl) {
      statusEl.textContent = "";
    }
  }
  function startRefresh(metricsSection2, regions, targetState) {
    currentCycleId += 1;
    active = true;
    inFlightState = targetState;
    for (const region of regions) {
      region.classList.add(LOADING_CLASS);
      addSpinner(region);
    }
    metricsSection2.setAttribute("aria-busy", "true");
    return currentCycleId;
  }
  function clearLoading(cycleId, metricsSection2, regions) {
    if (cycleId - currentCycleId !== 0) {
      return false;
    }
    active = false;
    inFlightState = null;
    for (const region of regions) {
      region.classList.remove(LOADING_CLASS);
      removeSpinner(region);
    }
    metricsSection2.removeAttribute("aria-busy");
    return true;
  }
  function endRefresh(cycleId, metricsSection2, regions, statusEl) {
    if (!clearLoading(cycleId, metricsSection2, regions)) {
      return false;
    }
    if (statusEl) {
      announce(statusEl, "Dashboard updated");
    }
    return true;
  }
  function failRefresh(cycleId, metricsSection2, regions, statusEl) {
    const cleared = clearLoading(cycleId, metricsSection2, regions);
    if (cleared) {
      clearAnnouncement(statusEl);
    }
    return cleared;
  }
  function isStale(cycleId) {
    return cycleId - currentCycleId !== 0;
  }
  function isActive() {
    return active;
  }
  function getInFlightState() {
    return inFlightState;
  }
  function hasStateChanged(prev, next) {
    if (prev === null) return true;
    return JSON.stringify(prev) !== JSON.stringify(next);
  }

  // ../ui/modules/drilldown/comparison-advisory.ts
  var CHART_CONTAINER_IDS = [
    "throughput-chart",
    "cycle-time-trend",
    "reviewer-activity"
  ];
  var SUMMARY_CARDS_SELECTOR = ".summary-cards";
  var COMPARISON_BANNER_ID = "comparison-banner";
  var BANNER_NOTE_CLASS = "comparison-advisory-banner";
  var TOAST_CLASS = "comparison-advisory-toast";
  var DISABLED_ATTR = "data-drilldown-disabled";
  var DISABLED_VALUE = "comparison";
  var BANNER_MESSAGE = "Chart details are unavailable during comparison.";
  var TOAST_MESSAGE = "Exit comparison to open chart details.";
  var isActive2 = false;
  var activeToast = null;
  var activeToastTimer = null;
  function isDrilldownDisabledByComparison() {
    return isActive2;
  }
  function showComparisonAdvisoryToast(target) {
    dismissActiveToast();
    const toast = createElement(
      "div",
      {
        class: TOAST_CLASS,
        role: "alert",
        "aria-live": "assertive"
      },
      TOAST_MESSAGE
    );
    document.body.appendChild(toast);
    positionToastNear(toast, target);
    activeToast = toast;
    activeToastTimer = setTimeout(() => {
      if (activeToast === toast) {
        dismissActiveToast();
      }
    }, COMPARISON_ADVISORY_TOAST_MS);
  }
  function dismissActiveToast() {
    if (activeToastTimer !== null) {
      clearTimeout(activeToastTimer);
      activeToastTimer = null;
    }
    if (activeToast && activeToast.isConnected) {
      activeToast.remove();
    }
    activeToast = null;
  }
  function positionToastNear(toast, target) {
    const rect = target.getBoundingClientRect();
    toast.style.position = "fixed";
    toast.style.visibility = "hidden";
    const toastRect = toast.getBoundingClientRect();
    const gap = 8;
    let top = rect.top - toastRect.height - gap;
    if (top < 0) top = rect.bottom + gap;
    if (top + toastRect.height > window.innerHeight) {
      top = Math.max(4, window.innerHeight - toastRect.height - 4);
    }
    let left = rect.left + rect.width / 2 - toastRect.width / 2;
    if (left < 4) left = 4;
    if (left + toastRect.width > window.innerWidth - 4) {
      left = Math.max(4, window.innerWidth - toastRect.width - 4);
    }
    toast.style.top = `${top}px`;
    toast.style.left = `${left}px`;
    toast.style.visibility = "";
  }
  function getChartContainers() {
    const out = [];
    for (const id of CHART_CONTAINER_IDS) {
      const el = document.getElementById(id);
      if (el) out.push(el);
    }
    const summary = document.querySelector(SUMMARY_CARDS_SELECTOR);
    if (summary) out.push(summary);
    return out;
  }
  function mountBanner() {
    const banner = document.getElementById(COMPARISON_BANNER_ID);
    if (!banner) return;
    if (banner.querySelector(`.${BANNER_NOTE_CLASS}`)) return;
    const note = createElement(
      "div",
      { class: BANNER_NOTE_CLASS, role: "status", "aria-live": "polite" },
      BANNER_MESSAGE
    );
    banner.appendChild(note);
  }
  function unmountBanner() {
    const banner = document.getElementById(COMPARISON_BANNER_ID);
    if (!banner) return;
    const note = banner.querySelector(`.${BANNER_NOTE_CLASS}`);
    if (note) {
      note.remove();
    }
  }
  function setChartDisabled(enabled) {
    for (const el of getChartContainers()) {
      if (enabled) {
        el.setAttribute(DISABLED_ATTR, DISABLED_VALUE);
      } else {
        el.removeAttribute(DISABLED_ATTR);
      }
    }
  }
  var comparisonListener = (evt) => {
    const e2 = evt;
    if (e2.detail.enabled) {
      isActive2 = true;
      mountBanner();
      setChartDisabled(true);
      if (isDetailPanelOpen()) {
        dismissDetailPanel("comparison-toggled");
      }
    } else {
      isActive2 = false;
      unmountBanner();
      setChartDisabled(false);
      dismissActiveToast();
    }
  };
  window.addEventListener(COMPARISON_TOGGLED_EVENT, comparisonListener);

  // ../ui/modules/shared/identity-fallback.ts
  function resolveDisplayName(id, map) {
    const mapped = map.get(id);
    return mapped !== void 0 ? mapped : id;
  }

  // ../ui/modules/shared/pr-url.ts
  function ensureTrailingSlash(uri) {
    return uri.endsWith("/") ? uri : `${uri}/`;
  }
  function resolvePrUrl(pr, repositories, webContext) {
    const base = ensureTrailingSlash(webContext.collectionUri);
    const repo = repositories?.find((r2) => r2.repository_id === pr.repository_id);
    if (repo && repo.repository_name.length > 0 && repo.project_name.length > 0) {
      return `${base}${encodeURIComponent(repo.project_name)}/_git/${encodeURIComponent(repo.repository_name)}/pullrequest/${pr.id}`;
    }
    return `${base}_git/${encodeURIComponent(pr.repository_id)}/pullrequest/${pr.id}`;
  }

  // ../ui/modules/drilldown/filter-support.ts
  function classifyFilterState(filters, comparisonActive2) {
    if (comparisonActive2) {
      return { classification: "comparison" };
    }
    if (filters.teams.length > 0) {
      return { classification: "team" };
    }
    if (filters.reviewers.length > 0) {
      return { classification: "reviewer" };
    }
    return { classification: "supported" };
  }

  // ../ui/modules/drilldown/throughput-drilldown.ts
  var ACTIVE_CLASS = "is-drilldown-active";
  function breakdownSection(title, columns, entries, emptyDetail, nameByKey) {
    if (!entries || Object.keys(entries).length === 0) {
      return makeEmptyState(title, emptyDetail);
    }
    const rows = Object.entries(entries).sort((a2, b2) => b2[1].pr_count - a2[1].pr_count).map(([key, entry]) => ({
      label: nameByKey ? resolveDisplayName(key, nameByKey) : key,
      values: [String(entry.pr_count)]
    }));
    return makeBreakdownTable(title, columns, rows);
  }
  function buildPrListSection(rollup, options) {
    const filters = options.filters ?? createEmptyFilterState();
    const { classification } = classifyFilterState(filters, false);
    switch (classification) {
      case "team":
        return makePrListSection({ contentState: "team-inline" });
      case "reviewer":
        return makePrListSection({ contentState: "reviewer-inline" });
      case "supported": {
        const rawPrs = rollup.prs ?? [];
        const webContext = options.webContext;
        const capValue = rollup._prs_cap;
        if (rawPrs.length === 0 || !webContext || capValue === void 0) {
          return makePrListSection({ contentState: "supported-empty" });
        }
        const commentsMetricsAvailable = options.commentsMetricsAvailable ?? false;
        const rows = rawPrs.map((pr) => {
          if (!commentsMetricsAvailable) {
            return {
              id: pr.id,
              title: pr.title,
              cycleTimeMinutes: pr.cycle_time,
              url: resolvePrUrl(pr, options.repositoriesDimension, webContext)
            };
          }
          return {
            id: pr.id,
            title: pr.title,
            cycleTimeMinutes: pr.cycle_time,
            url: resolvePrUrl(pr, options.repositoriesDimension, webContext),
            threadCount: pr.thread_count,
            commentCount: pr.comment_count,
            activeThreadCount: pr.active_thread_count
          };
        });
        return makePrListSection({
          contentState: "pr-list",
          rows,
          renderedCount: rows.length,
          actualFilteredCount: rollup.pr_count,
          capValue,
          commentsMetricsAvailable
        });
      }
    }
  }
  function buildPanelContent(rollup, options) {
    const count = rollup.pr_count;
    const subtitle = `${count} ${count === 1 ? "PR" : "PRs"}`;
    const authorNameByKey = buildAuthorNameMap(options.authorsDimension);
    const byAuthor = breakdownSection(
      "By author",
      ["Author", "PRs"],
      rollup.by_author,
      "No author-level activity for this week.",
      authorNameByKey
    );
    const byRepository = breakdownSection(
      "By repository",
      ["Repository", "PRs"],
      rollup.by_repository,
      "No repository-level activity for this week."
    );
    const prList = buildPrListSection(rollup, options);
    const sections = [];
    const commentsMetricsAvailable = options.commentsMetricsAvailable ?? false;
    if (commentsMetricsAvailable && prList.contentState === "pr-list") {
      sections.push(buildCommentsStatRow(prList.rows));
    }
    sections.push(byAuthor, byRepository, prList);
    return makePanelContent(formatWeekTitle(rollup), subtitle, sections);
  }
  function buildCommentsStatRow(rows) {
    let threadsSum = 0;
    let commentsSum = 0;
    let unresolvedSum = 0;
    let partialCount = 0;
    for (const row of rows) {
      threadsSum += row.threadCount ?? 0;
      commentsSum += row.commentCount ?? 0;
      unresolvedSum += row.activeThreadCount ?? 0;
      if (isPartialPrRow(row)) partialCount += 1;
    }
    const allRowsPartial = partialCount > 0 && partialCount === rows.length;
    function statValue(numericTotal) {
      if (allRowsPartial) return `Pending (${partialCount})`;
      if (partialCount > 0) return `${numericTotal} (+${partialCount} partial)`;
      return String(numericTotal);
    }
    return makeStatRow([
      { label: "Threads", value: statValue(threadsSum) },
      { label: "Comments", value: statValue(commentsSum) },
      { label: "Unresolved threads", value: statValue(unresolvedSum) }
    ]);
  }
  function buildAuthorNameMap(dim) {
    if (!dim || dim.length === 0) return /* @__PURE__ */ new Map();
    return new Map(dim.map((a2) => [a2.author_id, a2.author_name]));
  }
  function installThroughputDrilldown(container, rollups, options = {}) {
    const controller = new AbortController();
    const { signal } = controller;
    const observers = /* @__PURE__ */ new Set();
    let activeTrigger = null;
    function resolveTrigger(evt) {
      const target = evt.target;
      if (!(target instanceof Element)) return null;
      return target.closest("[data-drilldown-week]");
    }
    function clearActive() {
      if (activeTrigger) {
        activeTrigger.classList.remove(ACTIVE_CLASS);
        activeTrigger.setAttribute("aria-expanded", "false");
        activeTrigger = null;
      }
    }
    function registerPanelObserver() {
      const panel = document.querySelector("aside.detail-panel");
      if (!panel) return;
      const observer = new MutationObserver(() => {
        if (!panel.classList.contains("is-open")) {
          observer.disconnect();
          observers.delete(observer);
          clearActive();
        }
      });
      observer.observe(panel, { attributes: true, attributeFilter: ["class"] });
      observers.add(observer);
    }
    function activate(trigger) {
      const weekIso = trigger.getAttribute("data-drilldown-week");
      if (!weekIso) return;
      dismissAllTooltips();
      if (isDrilldownDisabledByComparison()) {
        showComparisonAdvisoryToast(trigger);
        return;
      }
      const rollup = rollups.find((r2) => r2.week === weekIso);
      if (!rollup) return;
      const context = {
        sourceChart: "throughput",
        focusedData: { kind: "throughput", weekIso },
        triggerElement: trigger,
        content: buildPanelContent(rollup, options)
      };
      openDetailPanel(context);
      clearActive();
      activeTrigger = trigger;
      trigger.classList.add(ACTIVE_CLASS);
      trigger.setAttribute("aria-expanded", "true");
      registerPanelObserver();
    }
    container.addEventListener(
      "click",
      (event) => {
        const trigger = resolveTrigger(event);
        if (!trigger) return;
        activate(trigger);
      },
      { signal }
    );
    container.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const trigger = resolveTrigger(event);
        if (!trigger) return;
        if (event.key === " ") event.preventDefault();
        activate(trigger);
      },
      { signal }
    );
    return {
      dispose() {
        controller.abort();
        for (const observer of observers) {
          observer.disconnect();
        }
        observers.clear();
        clearActive();
      }
    };
  }

  // ../ui/modules/drilldown/cycle-time-drilldown.ts
  var ACTIVE_CLASS2 = "is-drilldown-active";
  function formatDurationOrDash(value) {
    if (value === null || value === void 0) return "\u2014";
    return formatDuration(value);
  }
  function buildRepositoryBreakdown(entries) {
    if (!entries || Object.keys(entries).length === 0) {
      return makeEmptyState(
        "By repository",
        "No repository-level cycle-time data for this week."
      );
    }
    const rows = Object.entries(entries).sort((a2, b2) => b2[1].pr_count - a2[1].pr_count).map(([label, entry]) => ({
      label,
      values: [
        formatDurationOrDash(entry.cycle_time_p50),
        formatDurationOrDash(entry.cycle_time_p90)
      ]
    }));
    return makeBreakdownTable(
      "By repository",
      ["Repository", "P50", "P90"],
      rows
    );
  }
  function buildPanelContent2(rollup, metric) {
    const count = rollup.pr_count;
    const weekTitle = formatWeekTitle(rollup);
    const title = `${weekTitle} \u2014 ${metric.toUpperCase()}`;
    const subtitle = `${count} ${count === 1 ? "PR" : "PRs"}`;
    const stats = makeStatRow([
      { label: "P50", value: formatDurationOrDash(rollup.cycle_time_p50) },
      { label: "P90", value: formatDurationOrDash(rollup.cycle_time_p90) }
    ]);
    return makePanelContent(title, subtitle, [
      stats,
      buildRepositoryBreakdown(rollup.by_repository)
    ]);
  }
  function installCycleTimeDrilldown(container, rollups) {
    const controller = new AbortController();
    const { signal } = controller;
    const observers = /* @__PURE__ */ new Set();
    let activeTrigger = null;
    function resolveTrigger(evt) {
      const target = evt.target;
      if (!(target instanceof Element)) return null;
      return target.closest("[data-drilldown-metric]");
    }
    function clearActive() {
      if (activeTrigger) {
        activeTrigger.classList.remove(ACTIVE_CLASS2);
        activeTrigger.setAttribute("aria-expanded", "false");
        activeTrigger = null;
      }
    }
    function registerPanelObserver() {
      const panel = document.querySelector("aside.detail-panel");
      if (!panel) return;
      const observer = new MutationObserver(() => {
        if (!panel.classList.contains("is-open")) {
          observer.disconnect();
          observers.delete(observer);
          clearActive();
        }
      });
      observer.observe(panel, { attributes: true, attributeFilter: ["class"] });
      observers.add(observer);
    }
    function activate(trigger) {
      const weekIso = trigger.getAttribute("data-drilldown-week");
      const metricAttr = trigger.getAttribute("data-drilldown-metric");
      if (!weekIso) return;
      if (metricAttr !== "p50" && metricAttr !== "p90") return;
      dismissAllTooltips();
      if (isDrilldownDisabledByComparison()) {
        showComparisonAdvisoryToast(trigger);
        return;
      }
      const rollup = rollups.find((r2) => r2.week === weekIso);
      if (!rollup) return;
      const metric = metricAttr;
      const context = {
        sourceChart: "cycle-time",
        focusedData: { kind: "cycle-time", weekIso, metric },
        triggerElement: trigger,
        content: buildPanelContent2(rollup, metric)
      };
      openDetailPanel(context);
      clearActive();
      activeTrigger = trigger;
      trigger.classList.add(ACTIVE_CLASS2);
      trigger.setAttribute("aria-expanded", "true");
      registerPanelObserver();
    }
    container.addEventListener(
      "click",
      (event) => {
        const trigger = resolveTrigger(event);
        if (!trigger) return;
        activate(trigger);
      },
      { signal }
    );
    container.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const trigger = resolveTrigger(event);
        if (!trigger) return;
        if (event.key === " ") event.preventDefault();
        activate(trigger);
      },
      { signal }
    );
    return {
      dispose() {
        controller.abort();
        for (const observer of observers) {
          observer.disconnect();
        }
        observers.clear();
        clearActive();
      }
    };
  }

  // ../ui/modules/drilldown/reviewer-drilldown.ts
  var ACTIVE_CLASS3 = "is-drilldown-active";
  function reviewerEntry(rollup, reviewerId) {
    const map = rollup.by_reviewer;
    if (!map) return void 0;
    return new Map(Object.entries(map)).get(reviewerId);
  }
  function buildStatRow(rollups, reviewerId) {
    let totalReviews = 0;
    let totalPrs = 0;
    let peakRepos = 0;
    let peakWeek = null;
    for (const rollup of rollups) {
      const entry = reviewerEntry(rollup, reviewerId);
      if (!entry) continue;
      totalReviews += entry.reviews_count;
      totalPrs += entry.reviewed_prs;
      const repos = entry.repositories_count ?? 0;
      if (repos > peakRepos) {
        peakRepos = repos;
        peakWeek = rollup.week;
      }
    }
    const approval = computeApprovalRate([...rollups], [reviewerId]);
    const approvalLabel = approval.rate === null ? "Approval rate (no data)" : "Approval rate";
    const approvalValue = approval.rate === null ? "\u2014" : `${Math.round(approval.rate * 100)}%`;
    const peakValue = peakWeek !== null ? `${peakRepos} (${formatWeekLabel(peakWeek)})` : "0";
    return {
      section: makeStatRow([
        { label: "Total reviews", value: String(totalReviews) },
        { label: "PRs reviewed", value: String(totalPrs) },
        { label: approvalLabel, value: approvalValue },
        { label: "Peak repositories", value: peakValue }
      ]),
      totalPrs
    };
  }
  function buildWeeklyTable(rollups, reviewerId) {
    const rows = [];
    for (const rollup of rollups) {
      const entry = reviewerEntry(rollup, reviewerId);
      if (!entry) continue;
      const rate = entry.approval_rate;
      const rateCell = typeof rate === "number" && Number.isFinite(rate) ? `${Math.round(rate * 100)}%` : "";
      rows.push({
        label: formatWeekLabel(rollup.week),
        values: [
          String(entry.reviews_count),
          String(entry.reviewed_prs),
          rateCell
        ]
      });
    }
    if (rows.length === 0) {
      return makeEmptyState(
        "Weekly activity",
        "No review activity recorded for this reviewer in this period."
      );
    }
    return makeBreakdownTable(
      "Weekly activity",
      ["Week", "Reviews", "PRs reviewed", "Approval rate"],
      rows
    );
  }
  function buildPanelContent3(rollups, reviewerId, reviewerNameByKey) {
    const stats = buildStatRow(rollups, reviewerId);
    const subtitle = `${stats.totalPrs} ${stats.totalPrs === 1 ? "PR" : "PRs"} reviewed`;
    const displayName = resolveDisplayName(reviewerId, reviewerNameByKey);
    return makePanelContent(displayName, subtitle, [
      stats.section,
      buildWeeklyTable(rollups, reviewerId)
    ]);
  }
  function buildReviewerNameMap(dim) {
    if (!dim || dim.length === 0) return /* @__PURE__ */ new Map();
    return new Map(dim.map((r2) => [r2.reviewer_id, r2.reviewer_name]));
  }
  function installReviewerDrilldown(container, rollups, options = {}) {
    const controller = new AbortController();
    const { signal } = controller;
    const observers = /* @__PURE__ */ new Set();
    let activeTrigger = null;
    const reviewerNameByKey = buildReviewerNameMap(options.reviewersDimension);
    function resolveTrigger(evt) {
      const target = evt.target;
      if (!(target instanceof Element)) return null;
      return target.closest("[data-drilldown-reviewer-id]");
    }
    function clearActive() {
      if (activeTrigger) {
        activeTrigger.classList.remove(ACTIVE_CLASS3);
        activeTrigger.setAttribute("aria-expanded", "false");
        activeTrigger = null;
      }
    }
    function registerPanelObserver() {
      const panel = document.querySelector("aside.detail-panel");
      if (!panel) return;
      const observer = new MutationObserver(() => {
        if (!panel.classList.contains("is-open")) {
          observer.disconnect();
          observers.delete(observer);
          clearActive();
        }
      });
      observer.observe(panel, { attributes: true, attributeFilter: ["class"] });
      observers.add(observer);
    }
    function activate(trigger) {
      const reviewerId = trigger.getAttribute("data-drilldown-reviewer-id");
      if (!reviewerId) return;
      dismissAllTooltips();
      if (isDrilldownDisabledByComparison()) {
        showComparisonAdvisoryToast(trigger);
        return;
      }
      const context = {
        sourceChart: "reviewer",
        focusedData: { kind: "reviewer", reviewerId },
        triggerElement: trigger,
        content: buildPanelContent3(rollups, reviewerId, reviewerNameByKey)
      };
      openDetailPanel(context);
      clearActive();
      activeTrigger = trigger;
      trigger.classList.add(ACTIVE_CLASS3);
      trigger.setAttribute("aria-expanded", "true");
      registerPanelObserver();
    }
    container.addEventListener(
      "click",
      (event) => {
        const trigger = resolveTrigger(event);
        if (!trigger) return;
        activate(trigger);
      },
      { signal }
    );
    container.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const trigger = resolveTrigger(event);
        if (!trigger) return;
        if (event.key === " ") event.preventDefault();
        activate(trigger);
      },
      { signal }
    );
    return {
      dispose() {
        controller.abort();
        for (const observer of observers) {
          observer.disconnect();
        }
        observers.clear();
        clearActive();
      }
    };
  }

  // ../ui/modules/drilldown/sparkline-navigator.ts
  var HIGHLIGHT_CLASS = "is-sparkline-highlight";
  var ADVISORY_CLASS = "sparkline-advisory";
  var TARGET_ID_BY_CHART = {
    throughput: "throughput-chart",
    "cycle-time": "cycle-time-trend",
    reviewer: "reviewer-activity"
  };
  function targetIdFor(chart) {
    if (chart === "throughput") return TARGET_ID_BY_CHART.throughput;
    if (chart === "cycle-time") return TARGET_ID_BY_CHART["cycle-time"];
    return TARGET_ID_BY_CHART.reviewer;
  }
  function chartLabel(chart) {
    if (chart === "cycle-time") return "cycle time";
    return chart;
  }
  function installSparklineNavigator(container) {
    const controller = new AbortController();
    const { signal } = controller;
    const highlightTimers = /* @__PURE__ */ new Set();
    function resolveTrigger(evt) {
      const target = evt.target;
      if (!(target instanceof Element)) return null;
      return target.closest("[data-drilldown-target-chart]");
    }
    function clearAdvisoryIn(parent) {
      const existing = parent.querySelector(`.${ADVISORY_CLASS}`);
      if (existing) existing.remove();
    }
    function showAdvisoryIn(parent, label) {
      clearAdvisoryIn(parent);
      const slot = document.createElement("div");
      slot.className = ADVISORY_CLASS;
      parent.appendChild(slot);
      renderNoData(
        slot,
        `No full ${label} chart available on this page.`,
        "The detailed view is gated by a data-availability check."
      );
    }
    function prefersReducedMotion() {
      const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
      return mq ? mq.matches : false;
    }
    function activate(trigger) {
      dismissAllTooltips();
      if (isDrilldownDisabledByComparison()) {
        showComparisonAdvisoryToast(trigger);
        return;
      }
      const chart = trigger.getAttribute("data-drilldown-target-chart");
      if (chart !== "throughput" && chart !== "cycle-time" && chart !== "reviewer") {
        return;
      }
      const parent = trigger.parentElement;
      if (!parent) return;
      const targetEl = document.getElementById(targetIdFor(chart));
      if (!targetEl) {
        showAdvisoryIn(parent, chartLabel(chart));
        return;
      }
      clearAdvisoryIn(parent);
      const behavior = prefersReducedMotion() ? "auto" : "smooth";
      targetEl.scrollIntoView({ behavior, block: "center" });
      targetEl.classList.remove(HIGHLIGHT_CLASS);
      void targetEl.offsetWidth;
      targetEl.classList.add(HIGHLIGHT_CLASS);
      const timer = setTimeout(() => {
        targetEl.classList.remove(HIGHLIGHT_CLASS);
        highlightTimers.delete(timer);
      }, SPARKLINE_HIGHLIGHT_MS);
      highlightTimers.add(timer);
    }
    container.addEventListener(
      "click",
      (event) => {
        const trigger = resolveTrigger(event);
        if (!trigger) return;
        activate(trigger);
      },
      { signal }
    );
    container.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const trigger = resolveTrigger(event);
        if (!trigger) return;
        if (event.key === " ") event.preventDefault();
        activate(trigger);
      },
      { signal }
    );
    return {
      dispose() {
        controller.abort();
        for (const timer of highlightTimers) {
          clearTimeout(timer);
        }
        highlightTimers.clear();
      }
    };
  }

  // ../ui/dashboard.ts
  var loader = null;
  var artifactClient = null;
  var currentDateRange = {
    start: null,
    end: null
  };
  var currentDimensions = null;
  var currentCollectionUri = null;
  var currentFilters = {
    repos: [],
    teams: [],
    reviewers: [],
    authors: []
  };
  var reviewerFilterNoticeMessage = null;
  var typeaheadRepo = null;
  var typeaheadTeam = null;
  var typeaheadReviewer = null;
  var typeaheadAuthor = null;
  var comparisonMode = false;
  var previousActiveTabId = "metrics";
  var cachedRollups = [];
  var activeDrilldownHandles = [];
  var currentBuildId = null;
  var chipsDelegatedElement = null;
  var metricsSection = null;
  var metricsStatusEl = null;
  var loadingRegions = [];
  var lastEffectiveState = null;
  var SETTINGS_KEY_PROJECT = "pr-insights-source-project";
  var SETTINGS_KEY_PIPELINE = "pr-insights-pipeline-id";
  var cachedDataService = null;
  async function getDataService() {
    if (!cachedDataService) {
      cachedDataService = await getExtensionDataService();
    }
    return cachedDataService;
  }
  var elements = /* @__PURE__ */ new Map();
  var elementLists = {};
  function getOwnRecordValue(record, key) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor?.value;
  }
  var IS_PRODUCTION = typeof window !== "undefined" && window.process?.env?.NODE_ENV === "production";
  var DEBUG_ENABLED = !IS_PRODUCTION && (typeof window !== "undefined" && window.__DASHBOARD_DEBUG__ || typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug"));
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
      const dataService = await getDataService();
      const savedProjectId = await dataService.getValue(
        SETTINGS_KEY_PROJECT,
        { scopeType: "User", defaultValue: "" }
      );
      if (savedProjectId && typeof savedProjectId === "string" && savedProjectId.trim()) {
        result.projectId = savedProjectId.trim();
      }
      const savedPipelineId = await dataService.getValue(
        SETTINGS_KEY_PIPELINE,
        { scopeType: "User", defaultValue: 0 }
      );
      if (savedPipelineId && typeof savedPipelineId === "number" && savedPipelineId > 0) {
        result.pipelineId = savedPipelineId;
      }
    } catch (e2) {
      console.log("Could not read extension settings:", e2);
    }
    return result;
  }
  async function clearStalePipelineSetting() {
    try {
      const dataService = await getDataService();
      await dataService.setValue(SETTINGS_KEY_PIPELINE, null, {
        scopeType: "User"
      });
      console.log("Cleared stale pipeline setting to re-enable auto-discovery");
    } catch (e2) {
      console.warn("Could not clear stale pipeline setting:", e2);
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
    const webCtx = getWebContext();
    const currentProjectId = webCtx?.project?.id;
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
    const collectionUri = await getCollectionUri();
    currentCollectionUri = collectionUri;
    artifactClient = new ArtifactClient(targetProjectId);
    await artifactClient.initialize(collectionUri, getAccessToken);
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
    const hasAggregates = artifacts.some((a2) => a2.name === "aggregates");
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
        if (!artifacts.some((a2) => a2.name === "aggregates")) continue;
        matches.push({
          id: def.id,
          name: def.name,
          buildId: latestBuild.id
        });
      } catch (e2) {
        console.debug(`Skipping pipeline ${def.name}:`, e2);
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
        currentCollectionUri = getLocalCollectionUri();
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
          const webCtx = getWebContext();
          const projectNameEl = document.getElementById("current-project-name");
          if (projectNameEl && webCtx?.project?.name) {
            projectNameEl.textContent = webCtx.project.name;
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
      "review-time-p50",
      "review-time-p90",
      "authors-count",
      "reviewers-count",
      "throughput-chart",
      "cycle-distribution",
      "total-prs-delta",
      "cycle-p50-delta",
      "cycle-p90-delta",
      "review-time-p50-delta",
      "review-time-p90-delta",
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
      "review-time-p50-sparkline",
      "review-time-p90-sparkline",
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
      elements.set(id, document.getElementById(id));
    });
    elementLists.tabs = document.querySelectorAll(".tab");
    metricsSection = document.getElementById("tab-metrics");
    metricsStatusEl = document.getElementById("metrics-status");
    const summaryCards = document.querySelector(
      ".summary-cards"
    );
    const chartContainers = Array.from(
      document.querySelectorAll(".chart-container")
    );
    loadingRegions = summaryCards ? [summaryCards, ...chartContainers] : chartContainers;
  }
  function initializePhase5Features() {
    console.log("Phase 5 ML features initialized - tabs visible by default");
  }
  function setupEventListeners() {
    elements.get("date-range")?.addEventListener("change", handleDateRangeChange);
    document.getElementById("apply-dates")?.addEventListener("click", applyCustomDates);
    elementLists.tabs?.forEach((tab) => {
      const htmlTab = tab;
      htmlTab.addEventListener("click", () => {
        const tabId = htmlTab.dataset["tab"];
        if (tabId) switchTab(tabId);
      });
    });
    elements.get("retry-btn")?.addEventListener("click", () => init());
    document.getElementById("setup-retry-btn")?.addEventListener("click", () => init());
    document.getElementById("permission-retry-btn")?.addEventListener("click", () => init());
    elements.get("clear-filters")?.addEventListener("click", clearAllFilters);
    elements.get("compare-toggle")?.addEventListener("click", toggleComparisonMode);
    elements.get("exit-compare")?.addEventListener("click", exitComparisonMode);
    elements.get("export-btn")?.addEventListener("click", toggleExportMenu);
    elements.get("export-csv")?.addEventListener("click", exportToCsv);
    elements.get("export-link")?.addEventListener("click", copyShareableLink);
    elements.get("export-raw-zip")?.addEventListener("click", downloadRawDataZip);
    document.addEventListener("click", (e2) => {
      const target = e2.target;
      if (!target.closest(".export-dropdown")) {
        elements.get("export-menu")?.classList.add("hidden");
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
      const startDateEl = elements.get("start-date");
      const endDateEl = elements.get("end-date");
      if (startDateEl) {
        startDateEl.value = startDate.toISOString().split("T")[0] ?? "";
      }
      if (endDateEl) {
        endDateEl.value = endDate.toISOString().split("T")[0] ?? "";
      }
    }
  }
  function safeDateString(date) {
    if (!date || isNaN(date.getTime())) return "";
    return date.toISOString();
  }
  function buildEffectiveState() {
    return {
      filters: { ...currentFilters },
      startDate: safeDateString(currentDateRange.start),
      endDate: safeDateString(currentDateRange.end),
      comparisonMode
    };
  }
  function setChartContainersInert(value) {
    const containerIds = [
      "throughput-chart",
      "cycle-time-trend",
      "reviewer-activity"
    ];
    for (const id of containerIds) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (value) {
        el.setAttribute("inert", "");
      } else {
        el.removeAttribute("inert");
      }
    }
    const summaryCards = document.querySelector(".summary-cards");
    if (summaryCards) {
      if (value) {
        summaryCards.setAttribute("inert", "");
      } else {
        summaryCards.removeAttribute("inert");
      }
    }
  }
  async function refreshMetrics() {
    if (!currentDateRange.start || !currentDateRange.end || !loader) return;
    const candidateState = buildEffectiveState();
    if (isActive()) {
      if (!hasStateChanged(getInFlightState(), candidateState)) return;
    } else {
      if (!hasStateChanged(lastEffectiveState, candidateState)) return;
    }
    publishFiltersChanged({ reason: "user-change" });
    setChartContainersInert(true);
    let cycleId = 0;
    if (metricsSection && loadingRegions.length > 0) {
      cycleId = startRefresh(metricsSection, loadingRegions, candidateState);
    }
    try {
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
      } catch (e2) {
        console.debug("Previous period data not available:", e2);
      }
      if (cycleId > 0 && isStale(cycleId)) {
        return;
      }
      cachedRollups = rollups;
      updateAccuracyIndicator(rawRollups, currentFilters);
      updateOverlapIndicator(rawRollups, currentFilters);
      const availability = deriveAvailabilitySignal(
        rawRollups,
        loader?.getCapabilityState?.() ?? null
      );
      if (cycleId > 0 && isStale(cycleId)) {
        return;
      }
      for (const handle of activeDrilldownHandles) handle.dispose();
      activeDrilldownHandles = [];
      renderSummaryCards2(rollups, prevRollups, rawRollups);
      renderThroughputChart2(rollups, rawRollups, availability);
      renderCycleTimeTrend2(rollups, rawRollups, availability);
      renderReviewerActivity2(rollups, rawRollups, availability);
      renderCycleDistribution2(distributions, rawRollups, availability);
      if (loader?.getCapabilityState?.()?.commentsMetricsAvailable === true) {
        const ctsContainer = ensureCommentsTrendContainer();
        if (ctsContainer) {
          renderCommentsTrendChart(ctsContainer, rollups, {
            filters: currentFilters
          });
        }
      } else {
        removeCommentsTrendContainer();
      }
      const throughputContainer = document.getElementById("throughput-chart");
      if (throughputContainer) {
        activeDrilldownHandles.push(
          installThroughputDrilldown(throughputContainer, rollups, {
            filters: {
              repos: [...currentFilters.repos],
              teams: [...currentFilters.teams],
              reviewers: [...currentFilters.reviewers],
              authors: [...currentFilters.authors]
            },
            repositoriesDimension: currentDimensions?.repositories?.map((r2) => ({
              repository_id: r2.repository_id,
              repository_name: r2.repository_name,
              project_name: r2.project_name ?? "",
              organization_name: r2.organization_name
            })),
            webContext: currentCollectionUri ? { collectionUri: currentCollectionUri } : void 0,
            authorsDimension: currentDimensions?.authors,
            // Feature 310: gate the three comments-metrics columns on the
            // single-source-of-truth ``DatasetCapabilityState``
            // (``commentsMetricsAvailable`` is normalized at
            // ``dataset-loader.ts::getCapabilityState`` — same value the
            // dashboard's comments-coverage banner reads at line 2334).
            // Default ``false`` when the loader has not produced a state
            // yet (first render / dataset-less bootstrap).
            commentsMetricsAvailable: loader?.getCapabilityState?.()?.commentsMetricsAvailable ?? false
          })
        );
      }
      const commentsTrendDrillContainer = document.getElementById("comments-trend");
      if (commentsTrendDrillContainer) {
        activeDrilldownHandles.push(
          installThroughputDrilldown(commentsTrendDrillContainer, rollups, {
            filters: {
              repos: [...currentFilters.repos],
              teams: [...currentFilters.teams],
              reviewers: [...currentFilters.reviewers],
              authors: [...currentFilters.authors]
            },
            repositoriesDimension: currentDimensions?.repositories?.map((r2) => ({
              repository_id: r2.repository_id,
              repository_name: r2.repository_name,
              project_name: r2.project_name ?? "",
              organization_name: r2.organization_name
            })),
            webContext: currentCollectionUri ? { collectionUri: currentCollectionUri } : void 0,
            authorsDimension: currentDimensions?.authors,
            commentsMetricsAvailable: loader?.getCapabilityState?.()?.commentsMetricsAvailable ?? false
          })
        );
      }
      const cycleTimeContainer = document.getElementById("cycle-time-trend");
      if (cycleTimeContainer) {
        activeDrilldownHandles.push(
          installCycleTimeDrilldown(cycleTimeContainer, rollups)
        );
      }
      const reviewerContainer = document.getElementById("reviewer-activity");
      if (reviewerContainer) {
        activeDrilldownHandles.push(
          installReviewerDrilldown(reviewerContainer, rollups, {
            reviewersDimension: currentDimensions?.reviewers
          })
        );
      }
      const summaryCardsContainer = document.querySelector(".summary-cards");
      if (summaryCardsContainer) {
        activeDrilldownHandles.push(
          installSparklineNavigator(summaryCardsContainer)
        );
      }
      if (comparisonMode) {
        updateComparisonBanner();
      }
      if (cycleId > 0 && metricsSection) {
        endRefresh(cycleId, metricsSection, loadingRegions, metricsStatusEl);
      }
      lastEffectiveState = candidateState;
    } catch (err) {
      if (cycleId > 0 && metricsSection) {
        failRefresh(cycleId, metricsSection, loadingRegions, metricsStatusEl);
      }
      throw err;
    } finally {
      if (cycleId === 0 || !isStale(cycleId)) {
        setChartContainersInert(false);
      }
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
    const isEstimated = (r2) => {
      if (isTeamRepoFilter) {
        return r2.by_team_and_repo == null || r2.by_team_and_repo["_truncated"] === true;
      }
      return r2.by_author_and_repo == null || r2.by_author_and_repo["_truncated"] === true;
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
  function renderSummaryCards2(rollups, prevRollups = [], unfilteredRollups) {
    const containers = {
      totalPrs: elements.get("total-prs") ?? null,
      cycleP50: elements.get("cycle-p50") ?? null,
      cycleP90: elements.get("cycle-p90") ?? null,
      reviewTimeP50: elements.get("review-time-p50") ?? null,
      reviewTimeP90: elements.get("review-time-p90") ?? null,
      authorsCount: elements.get("authors-count") ?? null,
      reviewersCount: elements.get("reviewers-count") ?? null,
      totalPrsSparkline: elements.get("total-prs-sparkline") ?? null,
      cycleP50Sparkline: elements.get("cycle-p50-sparkline") ?? null,
      cycleP90Sparkline: elements.get("cycle-p90-sparkline") ?? null,
      reviewTimeP50Sparkline: elements.get("review-time-p50-sparkline") ?? null,
      reviewTimeP90Sparkline: elements.get("review-time-p90-sparkline") ?? null,
      authorsSparkline: elements.get("authors-sparkline") ?? null,
      reviewersSparkline: elements.get("reviewers-sparkline") ?? null,
      totalPrsDelta: elements.get("total-prs-delta") ?? null,
      cycleP50Delta: elements.get("cycle-p50-delta") ?? null,
      cycleP90Delta: elements.get("cycle-p90-delta") ?? null,
      reviewTimeP50Delta: elements.get("review-time-p50-delta") ?? null,
      reviewTimeP90Delta: elements.get("review-time-p90-delta") ?? null,
      authorsDelta: elements.get("authors-delta") ?? null,
      reviewersDelta: elements.get("reviewers-delta") ?? null
    };
    renderSummaryCards({
      rollups,
      prevRollups,
      containers,
      metricsCollector,
      unfilteredRollups,
      reviewerFilterActive: currentFilters.reviewers.length > 0
    });
  }
  function renderThroughputChart2(rollups, unfilteredRollups, availability) {
    renderThroughputChart(
      elements.get("throughput-chart") ?? null,
      rollups,
      {
        filters: currentFilters,
        unfilteredRollups,
        availability
      }
    );
  }
  function renderCycleDistribution2(distributions, unfilteredRollups, availability) {
    renderCycleDistribution(
      elements.get("cycle-distribution") ?? null,
      distributions,
      {
        filters: currentFilters,
        unfilteredRollups,
        availability
      }
    );
  }
  function renderCycleTimeTrend2(rollups, unfilteredRollups, availability) {
    renderCycleTimeTrend(
      elements.get("cycle-time-trend") ?? null,
      rollups,
      {
        filters: currentFilters,
        unfilteredRollups,
        availability
      }
    );
  }
  function renderReviewerActivity2(rollups, unfilteredRollups, availability) {
    const filterReviewerId = currentFilters.reviewers[0];
    const reviewerNameByKey = new Map(
      (currentDimensions?.reviewers ?? []).map((r2) => [
        r2.reviewer_id,
        r2.reviewer_name
      ])
    );
    const filterReviewerName = filterReviewerId !== void 0 ? resolveDisplayName(filterReviewerId, reviewerNameByKey) : void 0;
    renderReviewerActivity(
      elements.get("reviewer-activity") ?? null,
      rollups,
      {
        reviewerFilterActive: currentFilters.reviewers.length > 0,
        filters: currentFilters,
        unfilteredRollups,
        availability,
        filterReviewerName
      }
    );
  }
  function ensureCommentsTrendContainer() {
    const existing = document.getElementById("comments-trend");
    if (existing) return existing;
    const cycleDist = document.getElementById("cycle-distribution");
    const anchorRow = cycleDist?.closest(".charts-row") ?? null;
    if (!anchorRow || !anchorRow.parentElement) return null;
    const row = document.createElement("div");
    row.className = "charts-row";
    row.setAttribute("data-comments-trend-row", "true");
    const containerCell = document.createElement("div");
    containerCell.className = "chart-container";
    const chart = document.createElement("div");
    chart.id = "comments-trend";
    chart.className = "chart";
    containerCell.appendChild(chart);
    row.appendChild(containerCell);
    anchorRow.parentElement.insertBefore(row, anchorRow.nextSibling);
    return chart;
  }
  function removeCommentsTrendContainer() {
    const row = document.querySelector('[data-comments-trend-row="true"]');
    row?.parentElement?.removeChild(row);
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
  function handleDateRangeChange(e2) {
    const target = e2.target;
    const value = target.value;
    if (value === "custom") {
      elements.get("custom-dates")?.classList.remove("hidden");
      return;
    }
    elements.get("custom-dates")?.classList.add("hidden");
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
    const start = elements.get("start-date")?.value;
    const end = elements.get("end-date")?.value;
    if (!start || !end) return;
    currentDateRange = { start: new Date(start), end: new Date(end) };
    updateUrlState();
    void refreshMetrics();
  }
  function switchTab(tabId) {
    elementLists.tabs?.forEach((tab) => {
      const htmlTab = tab;
      const isActive3 = htmlTab.dataset["tab"] === tabId;
      htmlTab.classList.toggle("active", isActive3);
      htmlTab.setAttribute("aria-selected", isActive3 ? "true" : "false");
    });
    document.querySelectorAll(".tab-content").forEach((content) => {
      content.classList.toggle("active", content.id === `tab-${tabId}`);
      content.classList.toggle("hidden", content.id !== `tab-${tabId}`);
    });
    if (tabId !== previousActiveTabId) {
      publishTabChanged({
        activeTabId: tabId,
        previousTabId: previousActiveTabId
      });
      previousActiveTabId = tabId;
    }
    updateUrlState();
  }
  function populateFilterDropdowns(dimensions) {
    if (!dimensions) return;
    typeaheadRepo?.destroy();
    typeaheadTeam?.destroy();
    typeaheadReviewer?.destroy();
    typeaheadAuthor?.destroy();
    if (dimensions.repositories && dimensions.repositories.length > 0) {
      typeaheadRepo = initTypeaheadDropdown({
        containerId: "repo-filter",
        options: dimensions.repositories.map((r2) => ({
          id: r2.repository_name,
          displayName: r2.repository_name
        })),
        mode: "multi",
        placeholder: "Search repositories...",
        initialSelection: [],
        onChange: () => handleTypeaheadFilterChange("repos")
      });
      elements.get("repo-filter-group")?.classList.remove("hidden");
    } else {
      typeaheadRepo = null;
      elements.get("repo-filter-group")?.classList.add("hidden");
    }
    if (dimensions.teams && dimensions.teams.length > 0) {
      typeaheadTeam = initTypeaheadDropdown({
        containerId: "team-filter",
        options: dimensions.teams.map((t2) => ({
          id: t2.team_name,
          displayName: t2.team_name
        })),
        mode: "multi",
        placeholder: "Search teams...",
        initialSelection: [],
        onChange: () => handleTypeaheadFilterChange("teams")
      });
      elements.get("team-filter-group")?.classList.remove("hidden");
    } else {
      typeaheadTeam = null;
      elements.get("team-filter-group")?.classList.add("hidden");
    }
    if (dimensions.reviewers && dimensions.reviewers.length > 0) {
      typeaheadReviewer = initTypeaheadDropdown({
        containerId: "reviewer-filter",
        options: dimensions.reviewers.map((r2) => ({
          id: r2.reviewer_id,
          displayName: r2.reviewer_name
        })),
        mode: "single",
        placeholder: "Search reviewers...",
        initialSelection: [],
        onChange: () => handleTypeaheadFilterChange("reviewers")
      });
      elements.get("reviewer-filter-group")?.classList.remove("hidden");
    } else {
      typeaheadReviewer = null;
      elements.get("reviewer-filter-group")?.classList.add("hidden");
    }
    if (dimensions.authors && dimensions.authors.length > 0) {
      typeaheadAuthor = initTypeaheadDropdown({
        containerId: "author-filter",
        options: dimensions.authors.map((a2) => ({
          id: a2.author_id,
          displayName: a2.author_name
        })),
        mode: "single",
        placeholder: "Search authors...",
        initialSelection: [],
        onChange: () => handleTypeaheadFilterChange("authors")
      });
      elements.get("author-filter-group")?.classList.remove("hidden");
    } else {
      typeaheadAuthor = null;
      elements.get("author-filter-group")?.classList.add("hidden");
    }
    restoreFiltersFromUrl();
  }
  function applyFilterState(raw, lastChanged) {
    const { effectiveState, constraintsApplied } = resolveFilterConstraints(
      raw,
      lastChanged
    );
    const reviewerNotice = constraintsApplied.find(
      (n2) => n2.type === "author_reviewer" || n2.type === "reviewer_team" || n2.type === "reviewer_repo"
    );
    reviewerFilterNoticeMessage = reviewerNotice?.message ?? null;
    currentFilters = effectiveState;
    typeaheadRepo?.setSelected(effectiveState.repos);
    typeaheadTeam?.setSelected(effectiveState.teams);
    typeaheadReviewer?.setSelected(effectiveState.reviewers);
    typeaheadAuthor?.setSelected(effectiveState.authors);
    updateFilterUI();
    updateUrlState();
    void refreshMetrics();
  }
  function handleTypeaheadFilterChange(lastChanged) {
    applyFilterState(
      {
        repos: typeaheadRepo?.getSelected() ?? [],
        teams: typeaheadTeam?.getSelected() ?? [],
        reviewers: typeaheadReviewer?.getSelected() ?? [],
        authors: typeaheadAuthor?.getSelected() ?? []
      },
      lastChanged
    );
  }
  function clearAllFilters() {
    applyFilterState({ repos: [], teams: [], reviewers: [], authors: [] });
  }
  function removeFilter(type, value) {
    const next = {
      repos: [...currentFilters.repos],
      teams: [...currentFilters.teams],
      reviewers: [...currentFilters.reviewers],
      authors: [...currentFilters.authors]
    };
    if (type === "repo") {
      next.repos = next.repos.filter((v2) => v2 !== value);
    } else if (type === "team") {
      next.teams = next.teams.filter((v2) => v2 !== value);
    } else if (type === "reviewer") {
      next.reviewers = next.reviewers.filter((v2) => v2 !== value);
    } else if (type === "author") {
      next.authors = next.authors.filter((v2) => v2 !== value);
    }
    applyFilterState(next);
  }
  function updateFilterUI() {
    const hasFilters = currentFilters.repos.length > 0 || currentFilters.teams.length > 0 || currentFilters.reviewers.length > 0 || currentFilters.authors.length > 0;
    const clearFiltersEl = elements.get("clear-filters");
    if (clearFiltersEl) {
      clearFiltersEl.classList.toggle("hidden", !hasFilters);
    }
    const activeFiltersEl = elements.get("active-filters");
    const filterChipsEl = elements.get("filter-chips");
    if (activeFiltersEl && filterChipsEl) {
      activeFiltersEl.classList.toggle("hidden", !hasFilters);
      if (hasFilters) {
        renderFilterChips();
      } else {
        clearElement(filterChipsEl);
      }
    }
    updateMetricLabels();
  }
  function renderFilterChips() {
    const chipsEl = elements.get("filter-chips");
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
      chipsEl.addEventListener("click", (e2) => {
        const btn = e2.target.closest(
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
      return currentDimensions?.repositories?.find((r2) => r2.repository_name === value)?.repository_name ?? value;
    }
    if (type === "team") {
      return currentDimensions?.teams?.find((t2) => t2.team_name === value)?.team_name ?? value;
    }
    if (type === "reviewer") {
      return currentDimensions?.reviewers?.find((r2) => r2.reviewer_id === value)?.reviewer_name ?? value;
    }
    if (type === "author") {
      return currentDimensions?.authors?.find((a2) => a2.author_id === value)?.author_name ?? value;
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
    elements.get("author-filter-notice")?.classList.toggle("hidden", !authorTeamConstrained);
    const reviewerNotice = elements.get("reviewer-filter-notice");
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
    const totalPrsLabel = elements.get("total-prs-label");
    if (totalPrsLabel) {
      totalPrsLabel.textContent = reviewerMode ? "Reviewed PRs" : "Total PRs";
    }
    const authorsLabel = elements.get("authors-count-label");
    if (authorsLabel) {
      authorsLabel.textContent = reviewerMode ? "Reviewed Authors" : "Contributors";
    }
    const reviewersLabel = elements.get("reviewers-count-label");
    if (reviewersLabel) {
      reviewersLabel.textContent = reviewerMode ? "Reviews" : "Reviewers";
    }
    const activityLabel = elements.get("reviewer-activity-label");
    if (activityLabel) {
      activityLabel.textContent = reviewerMode ? "Review Activity" : "Reviewer Activity";
    }
  }
  function restoreFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const parsed = parseFiltersFromUrl(params);
    const validRepos = parsed.repos.filter(
      (v2) => currentDimensions?.repositories?.some((r2) => r2.repository_name === v2)
    );
    if (validRepos.length < parsed.repos.length) {
      console.warn(
        "Ignoring invalid repo filters from URL:",
        parsed.repos.filter((v2) => !validRepos.includes(v2))
      );
    }
    const validTeams = parsed.teams.filter(
      (v2) => currentDimensions?.teams?.some((t2) => t2.team_name === v2)
    );
    if (validTeams.length < parsed.teams.length) {
      console.warn(
        "Ignoring invalid team filters from URL:",
        parsed.teams.filter((v2) => !validTeams.includes(v2))
      );
    }
    const validReviewers = parsed.reviewers.filter(
      (v2) => currentDimensions?.reviewers?.some((r2) => r2.reviewer_id === v2)
    );
    if (validReviewers.length < parsed.reviewers.length) {
      console.warn(
        "Ignoring invalid reviewer filters from URL:",
        parsed.reviewers.filter((v2) => !validReviewers.includes(v2))
      );
    }
    const validAuthors = parsed.authors.filter(
      (v2) => currentDimensions?.authors?.some(
        (a2) => a2.author_id === v2 || a2.author_name === v2
      )
    );
    const normalizedAuthors = validAuthors.map((v2) => {
      const match = currentDimensions?.authors?.find(
        (a2) => a2.author_id === v2 || a2.author_name === v2
      );
      return match?.author_id ?? v2;
    });
    if (normalizedAuthors.length < parsed.authors.length) {
      console.warn(
        "Ignoring invalid author filters from URL:",
        parsed.authors.filter((v2) => !validAuthors.includes(v2))
      );
    }
    applyFilterState({
      repos: validRepos,
      teams: validTeams,
      reviewers: validReviewers,
      authors: normalizedAuthors
    });
  }
  function restoreStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const startParam = params.get("start");
    const endParam = params.get("end");
    if (startParam && endParam) {
      const parsedStart = new Date(startParam);
      const parsedEnd = new Date(endParam);
      if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
        console.debug(
          "Invalid date params in URL, ignoring:",
          startParam,
          endParam
        );
      } else {
        currentDateRange = { start: parsedStart, end: parsedEnd };
        const dateRangeEl = elements.get(
          "date-range"
        );
        if (dateRangeEl) {
          dateRangeEl.value = "custom";
          elements.get("custom-dates")?.classList.remove("hidden");
        }
        const startEl = elements.get("start-date");
        const endEl = elements.get("end-date");
        if (startEl) startEl.value = startParam;
        if (endEl) endEl.value = endParam;
      }
    }
    const tabParam = params.get("tab");
    if (tabParam) {
      setTimeout(() => switchTab(tabParam), 0);
    }
    const compareParam = params.get("compare");
    if (compareParam === "1") {
      comparisonMode = true;
      elements.get("compare-toggle")?.classList.add("active");
      elements.get("comparison-banner")?.classList.remove("hidden");
      publishComparisonToggled({ enabled: true });
    }
  }
  function toggleComparisonMode() {
    comparisonMode = !comparisonMode;
    elements.get("compare-toggle")?.classList.toggle("active", comparisonMode);
    elements.get("comparison-banner")?.classList.toggle("hidden", !comparisonMode);
    if (comparisonMode) {
      updateComparisonBanner();
    }
    publishComparisonToggled({ enabled: comparisonMode });
    updateUrlState();
    void refreshMetrics();
  }
  function exitComparisonMode() {
    comparisonMode = false;
    elements.get("compare-toggle")?.classList.remove("active");
    elements.get("comparison-banner")?.classList.add("hidden");
    publishComparisonToggled({ enabled: false });
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
    const currentDatesEl = elements.get("current-period-dates");
    if (currentDatesEl) {
      currentDatesEl.textContent = `${currentStart} - ${currentEnd}`;
    }
    const prevPeriod = getPreviousPeriod(
      currentDateRange.start,
      currentDateRange.end
    );
    const prevStart = formatDate(prevPeriod.start);
    const prevEnd = formatDate(prevPeriod.end);
    const prevDatesEl = elements.get("previous-period-dates");
    if (prevDatesEl) {
      prevDatesEl.textContent = `${prevStart} - ${prevEnd}`;
    }
    const banner = elements.get("comparison-banner");
    if (banner) {
      const hasFilters = currentFilters.repos.length > 0 || currentFilters.teams.length > 0 || currentFilters.reviewers.length > 0 || currentFilters.authors.length > 0;
      banner.setAttribute("data-filtered", hasFilters ? "true" : "false");
    }
  }
  function toggleExportMenu(e2) {
    e2.stopPropagation();
    elements.get("export-menu")?.classList.toggle("hidden");
  }
  function exportToCsv() {
    elements.get("export-menu")?.classList.add("hidden");
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
    elements.get("export-menu")?.classList.add("hidden");
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
    elements.get("export-menu")?.classList.add("hidden");
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
    elements.get("loading-state")?.classList.remove("hidden");
  }
  function showContent() {
    hideAllPanels();
    elements.get("main-content")?.classList.remove("hidden");
  }
  function updateDatasetInfo(manifest) {
    const generatedAt = manifest?.generated_at ? new Date(manifest.generated_at).toLocaleString() : "Unknown";
    const runId = manifest?.run_id || "";
    const capabilityState = loader?.getCapabilityState?.() ?? null;
    const commentsCoverage = manifest?.coverage?.comments;
    const commentsBanner = elements.get("comments-coverage-banner");
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
    const runInfo = elements.get("run-info");
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
    serializeFiltersToUrl(currentFilters, newParams);
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
