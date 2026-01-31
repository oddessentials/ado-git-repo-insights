"use strict";
var PRInsightsDatasetLoader = (() => {
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

  // ui/dataset-loader.ts
  var dataset_loader_exports = {};
  __export(dataset_loader_exports, {
    DATASET_CANDIDATE_PATHS: () => DATASET_CANDIDATE_PATHS,
    DEPRECATED_LAYOUT_ERROR: () => DEPRECATED_LAYOUT_ERROR,
    DatasetLoader: () => DatasetLoader,
    ROLLUP_FIELD_DEFAULTS: () => ROLLUP_FIELD_DEFAULTS,
    createRollupCache: () => createRollupCache,
    fetchSemaphore: () => fetchSemaphore,
    normalizeRollup: () => normalizeRollup2,
    normalizeRollups: () => normalizeRollups
  });

  // ui/types.ts
  function isErrorWithMessage(error) {
    return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string";
  }
  function getErrorMessage(error) {
    if (isErrorWithMessage(error)) return error.message;
    if (typeof error === "string") return error;
    return "Unknown error";
  }

  // ui/schemas/types.ts
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

  // ui/schemas/errors.ts
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

  // ui/schemas/utils.ts
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

  // ui/schemas/manifest.schema.ts
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
    "features",
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
  var KNOWN_FEATURES_FIELDS = /* @__PURE__ */ new Set([
    "teams",
    "comments",
    "predictions",
    "ai_insights"
  ]);
  var KNOWN_LIMITS_FIELDS = /* @__PURE__ */ new Set([
    "max_weekly_files",
    "max_distribution_files",
    "max_date_range_days_soft"
    // Production field
  ]);
  var KNOWN_DEFAULTS_FIELDS = /* @__PURE__ */ new Set(["default_date_range_days"]);
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
    if ("features" in data && data.features !== void 0) {
      const result = validateFeatures(data.features, "features", strict);
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

  // ui/schemas/rollup.schema.ts
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
    "by_team"
  ]);
  var KNOWN_BREAKDOWN_FIELDS = /* @__PURE__ */ new Set([
    "pr_count",
    "cycle_time_p50",
    "cycle_time_p90",
    "review_time_p50",
    "review_time_p90"
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
        if (fieldValue !== void 0) {
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
        if (fieldValue !== void 0) {
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
    if ("by_team" in data && data.by_team !== void 0) {
      const result = validateBreakdown(data.by_team, "by_team", strict);
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

  // ui/schemas/dimensions.schema.ts
  var KNOWN_ROOT_FIELDS3 = /* @__PURE__ */ new Set([
    "repositories",
    "users",
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

  // ui/schemas/predictions.schema.ts
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

  // ui/dataset-loader.ts
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
  var SUPPORTED_AGGREGATES_VERSION = 1;
  var DATASET_CANDIDATE_PATHS = [
    "",
    // Root of provided base URL (preferred)
    "aggregates"
    // Single nesting (legacy ADO artifact download)
  ];
  var DEPRECATED_LAYOUT_ERROR = "Deprecated dataset layout detected (aggregates/aggregates nesting). This layout is no longer supported. Please re-run the pipeline with the updated YAML configuration and re-stage artifacts.";
  var ROLLUP_FIELD_DEFAULTS = {
    pr_count: 0,
    cycle_time_p50: null,
    cycle_time_p90: null,
    authors_count: 0,
    reviewers_count: 0,
    by_repository: null,
    // null indicates feature not available
    by_team: null
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
      by_team: r.by_team !== void 0 ? r.by_team : null
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
      return manifest;
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
  return __toCommonJS(dataset_loader_exports);
})();
// Global exports for browser runtime
if (typeof window !== 'undefined') { Object.assign(window, PRInsightsDatasetLoader || {}); }
