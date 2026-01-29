"use strict";
var PRInsightsDashboard = (() => {
  // ui/types.ts
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

  // ui/error-types.ts
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

  // ui/artifact-client.ts
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
        console.log("[getArtifactMetadata] Artifact '%s' not found in build %d", artifactName, buildId);
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
        throw new Error(
          `Failed to load dataset manifest: ${getErrorMessage(error)}`
        );
      }
    }
    validateManifest(manifest) {
      const SUPPORTED_MANIFEST_VERSION2 = 1;
      const SUPPORTED_DATASET_VERSION2 = 1;
      const SUPPORTED_AGGREGATES_VERSION2 = 1;
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

  // ui/modules/shared/format.ts
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

  // ui/modules/shared/security.ts
  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  // ui/modules/shared/render.ts
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
  function renderNoData(container, message) {
    if (!container) return;
    clearElement(container);
    const p = createElement("p", { class: "no-data" }, message);
    container.appendChild(p);
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

  // ui/modules/metrics.ts
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
    const rangeDays = Math.ceil(
      (end.getTime() - start.getTime()) / (1e3 * 60 * 60 * 24)
    );
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(
      prevEnd.getTime() - rangeDays * 24 * 60 * 60 * 1e3
    );
    return { start: prevStart, end: prevEnd };
  }
  function applyFiltersToRollups(rollups, filters) {
    if (!filters.repos.length && !filters.teams.length) {
      return rollups;
    }
    return rollups.map((rollup) => {
      if (filters.repos.length && rollup.by_repository && typeof rollup.by_repository === "object") {
        const byRepository = rollup.by_repository;
        const selectedRepos = filters.repos.map((repoId) => {
          const repoData = byRepository[repoId];
          if (repoData) return repoData;
          return Object.entries(byRepository).find(
            ([name]) => name === repoId
          )?.[1];
        }).filter((r) => r !== void 0);
        if (selectedRepos.length === 0) {
          return {
            ...rollup,
            pr_count: 0,
            cycle_time_p50: null,
            cycle_time_p90: null,
            authors_count: 0,
            reviewers_count: 0
          };
        }
        const totalPrCount = selectedRepos.reduce((sum, count) => sum + count, 0);
        return {
          ...rollup,
          pr_count: totalPrCount
          // NOTE: cycle_time/authors/reviewers preserved from unfiltered rollup
          // as we don't have per-repo breakdown for these metrics
        };
      }
      if (filters.teams.length && rollup.by_team && typeof rollup.by_team === "object") {
        const byTeam = rollup.by_team;
        const selectedTeams = filters.teams.map((teamId) => byTeam[teamId]).filter((t) => t !== void 0);
        if (selectedTeams.length === 0) {
          return {
            ...rollup,
            pr_count: 0,
            cycle_time_p50: null,
            cycle_time_p90: null,
            authors_count: 0,
            reviewers_count: 0
          };
        }
        const totalPrCount = selectedTeams.reduce((sum, count) => sum + count, 0);
        return {
          ...rollup,
          pr_count: totalPrCount
          // NOTE: cycle_time/authors/reviewers preserved from unfiltered rollup
          // as we don't have per-team breakdown for these metrics
        };
      }
      return rollup;
    });
  }
  function extractSparklineData(rollups) {
    return {
      prCounts: rollups.map((r) => r.pr_count || 0),
      p50s: rollups.map((r) => r.cycle_time_p50 || 0),
      p90s: rollups.map((r) => r.cycle_time_p90 || 0),
      authors: rollups.map((r) => r.authors_count || 0),
      reviewers: rollups.map((r) => r.reviewers_count || 0)
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

  // ui/modules/errors.ts
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

  // ui/modules/charts/predictions.ts
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
      allValues.push(v.lower_bound);
      allValues.push(v.upper_bound);
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
      upperPoints.push({ x, y: getY(v.upper_bound) });
      lowerPoints.push({ x, y: getY(v.lower_bound) });
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
    const accessibleSummary = latestValue ? `${metricLabel} forecast: ${latestValue.predicted.toFixed(1)} ${forecast.unit} (range ${latestValue.lower_bound.toFixed(1)} to ${latestValue.upper_bound.toFixed(1)})` : `${metricLabel} forecast chart`;
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
  function extractHistoricalData(rollups, metric) {
    if (!rollups || rollups.length === 0) return [];
    const metricFieldMap = {
      pr_throughput: "pr_count",
      cycle_time_minutes: "cycle_time_p50"
    };
    const field = metricFieldMap[metric];
    if (!field) return [];
    const data = rollups.filter((r) => r[field] !== null && r[field] !== void 0).map((r) => ({
      // Convert ISO week format to date if needed
      week: r.week.includes("-W") ? isoWeekToDate(r.week) : r.week,
      // eslint-disable-next-line security/detect-object-injection -- SECURITY: field is from local const metricFieldMap, typed as keyof RollupForChart
      value: Number(r[field])
    })).sort((a, b) => a.week.localeCompare(b.week));
    if (data.length > MAX_CHART_POINTS) {
      return data.slice(-MAX_CHART_POINTS);
    }
    return data;
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
      const historicalData = rollups ? extractHistoricalData(rollups, forecast.metric) : void 0;
      const chartHtml = renderForecastChart(forecast, historicalData);
      appendTrustedHtml(content, chartHtml);
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

  // ui/modules/ml/setup-guides.ts
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
    return `
    <button class="copy-yaml-btn" id="${buttonId}" data-yaml="${escapeHtml(yaml)}"
            type="button" aria-label="Copy YAML snippet to clipboard">
      <span class="copy-icon" aria-hidden="true">\u{1F4CB}</span>
      <span class="copy-text">Copy</span>
    </button>
  `;
  }
  function attachCopyHandlers(container) {
    const buttons = container.querySelectorAll(".copy-yaml-btn");
    let liveRegion = document.getElementById("copy-status-live");
    if (!liveRegion) {
      liveRegion = document.createElement("div");
      liveRegion.id = "copy-status-live";
      liveRegion.setAttribute("role", "status");
      liveRegion.setAttribute("aria-live", "polite");
      liveRegion.className = "visually-hidden";
      document.body.appendChild(liveRegion);
    }
    buttons.forEach((button) => {
      button.addEventListener("click", async () => {
        const yaml = button.dataset.yaml;
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

  // ui/modules/ml/state-machine.ts
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

  // ui/modules/ml.ts
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
    const minVal = Math.min(...limitedValues);
    const maxVal = Math.max(...limitedValues);
    const range = maxVal - minVal || 1;
    const padding = 2;
    const effectiveHeight = height - padding * 2;
    const effectiveWidth = width - padding * 2;
    const points = limitedValues.map((val, i) => {
      const x = padding + i / (limitedValues.length - 1) * effectiveWidth;
      const y = padding + (1 - (val - minVal) / range) * effectiveHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const firstVal = limitedValues[0] ?? 0;
    const lastVal = limitedValues[limitedValues.length - 1] ?? 0;
    const trendDescription = lastVal > firstVal ? "upward trend" : lastVal < firstVal ? "downward trend" : "stable trend";
    return `
    <svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
         role="img" aria-label="Sparkline showing ${trendDescription} over ${limitedValues.length} data points">
      <polyline
        points="${points}"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
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

  // ui/modules/charts.ts
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
    let cssClass = "metric-delta ";
    let arrow = "";
    if (isNeutral) {
      cssClass += "delta-neutral";
      arrow = "~";
    } else if (isPositive) {
      cssClass += inverse ? "delta-negative-inverse" : "delta-positive";
      arrow = "&#9650;";
    } else {
      cssClass += inverse ? "delta-positive-inverse" : "delta-negative";
      arrow = "&#9660;";
    }
    const sign = isPositive ? "+" : "";
    element.className = cssClass;
    renderTrustedHtml(
      element,
      `<span class="delta-arrow">${arrow}</span> ${sign}${absChange.toFixed(0)}% <span class="delta-label">vs prev</span>`
    );
  }
  function renderSparkline(element, values) {
    if (!element || !values || values.length < 2) {
      if (element) clearElement(element);
      return;
    }
    const data = values.slice(-8);
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
  function addChartTooltips(container, contentFn) {
    const dots = container.querySelectorAll("[data-tooltip]");
    dots.forEach((dot) => {
      dot.addEventListener("mouseenter", () => {
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
        dot.dataset.tooltipId = tooltip.id = `tooltip-${Date.now()}`;
      });
      dot.addEventListener("mouseleave", () => {
        const tooltipId = dot.dataset.tooltipId;
        if (tooltipId) {
          document.getElementById(tooltipId)?.remove();
        }
      });
    });
  }

  // ui/modules/charts/summary-cards.ts
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

  // ui/modules/charts/throughput.ts
  function renderThroughputChart(container, rollups) {
    if (!container) return;
    if (!rollups || !rollups.length) {
      renderNoData(container, "No data for selected range");
      return;
    }
    const prCounts = rollups.map((r) => r.pr_count || 0);
    const maxCount = Math.max(...prCounts);
    const movingAvg = calculateMovingAverage(prCounts, 4);
    const barsHtml = rollups.map((r) => {
      const height = maxCount > 0 ? (r.pr_count || 0) / maxCount * 100 : 0;
      const weekLabel = r.week.split("-W")[1] || "";
      return `
            <div class="bar-container" title="${escapeHtml(r.week)}: ${r.pr_count || 0} PRs">
                <div class="bar" style="height: ${height}%"></div>
                <div class="bar-label">${escapeHtml(weekLabel)}</div>
            </div>
        `;
    }).join("");
    const trendLineHtml = renderTrendLine(rollups, movingAvg, maxCount);
    const legendHtml = `
        <div class="chart-legend">
            <div class="legend-item">
                <span class="legend-bar"></span>
                <span>Weekly PRs</span>
            </div>
            <div class="legend-item">
                <span class="legend-line"></span>
                <span>4-week avg</span>
            </div>
        </div>
    `;
    renderTrustedHtml(
      container,
      `
        <div class="chart-with-trend">
            <div class="bar-chart">${barsHtml}</div>
            ${trendLineHtml}
        </div>
        ${legendHtml}
    `
    );
  }
  function renderTrendLine(rollups, movingAvg, maxCount) {
    if (rollups.length < 4) return "";
    const validPoints = movingAvg.map((val, i) => ({ val, i })).filter((p) => p.val !== null);
    if (validPoints.length < 2) return "";
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
    return `
        <div class="trend-line-overlay">
            <svg viewBox="0 0 100 ${chartHeight}" preserveAspectRatio="none">
                <path class="trend-line" d="${pathD}" vector-effect="non-scaling-stroke"/>
            </svg>
        </div>
    `;
  }

  // ui/modules/charts/cycle-time.ts
  function renderCycleDistribution(container, distributions) {
    if (!container) return;
    if (!distributions || !distributions.length) {
      renderNoData(container, "No data for selected range");
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
      renderNoData(container, "No cycle time data");
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
    if (!rollups || rollups.length < 2) {
      renderNoData(container, "Not enough data for trend");
      return;
    }
    const p50Data = rollups.map((r) => ({ week: r.week, value: r.cycle_time_p50 })).filter((d) => d.value !== null);
    const p90Data = rollups.map((r) => ({ week: r.week, value: r.cycle_time_p90 })).filter((d) => d.value !== null);
    if (p50Data.length < 2 && p90Data.length < 2) {
      renderNoData(container, "No cycle time data available");
      return;
    }
    const allValues = [
      ...p50Data.map((d) => d.value),
      ...p90Data.map((d) => d.value)
    ];
    const maxVal = Math.max(...allValues);
    const minVal = Math.min(...allValues);
    const range = maxVal - minVal || 1;
    const width = 100;
    const height = 180;
    const padding = { top: 10, right: 10, bottom: 25, left: 40 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const generatePath = (data) => {
      const points = data.map((d) => {
        const dataIndex = rollups.findIndex((r) => r.week === d.week);
        const x = padding.left + dataIndex / (rollups.length - 1) * chartWidth;
        const y = padding.top + chartHeight - (d.value - minVal) / range * chartHeight;
        return { x, y, week: d.week, value: d.value };
      });
      const pathD = points.map(
        (p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
      ).join(" ");
      return { pathD, points };
    };
    const p50Path = p50Data.length >= 2 ? generatePath(p50Data) : null;
    const p90Path = p90Data.length >= 2 ? generatePath(p90Data) : null;
    const yLabels = [minVal, (minVal + maxVal) / 2, maxVal];
    const svgContent = `
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
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
            ${p90Path ? p90Path.points.map((p) => `<circle class="line-chart-dot" cx="${p.x}" cy="${p.y}" r="3" fill="var(--warning)" data-week="${escapeHtml(p.week)}" data-value="${p.value}" data-metric="P90"/>`).join("") : ""}
            ${p50Path ? p50Path.points.map((p) => `<circle class="line-chart-dot" cx="${p.x}" cy="${p.y}" r="3" fill="var(--primary)" data-week="${escapeHtml(p.week)}" data-value="${p.value}" data-metric="P50"/>`).join("") : ""}
        </svg>
    `;
    const legendHtml = `
        <div class="chart-legend">
            <div class="legend-item">
                <span class="chart-tooltip-dot legend-p50"></span>
                <span>P50 (Median)</span>
            </div>
            <div class="legend-item">
                <span class="chart-tooltip-dot legend-p90"></span>
                <span>P90</span>
            </div>
        </div>
    `;
    renderTrustedHtml(
      container,
      `<div class="line-chart">${svgContent}</div>${legendHtml}`
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

  // ui/modules/charts/reviewer-activity.ts
  function renderReviewerActivity(container, rollups) {
    if (!container) return;
    if (!rollups || !rollups.length) {
      renderNoData(container, "No reviewer data available");
      return;
    }
    const recentRollups = rollups.slice(-8);
    const maxReviewers = Math.max(
      ...recentRollups.map((r) => r.reviewers_count || 0)
    );
    if (maxReviewers === 0) {
      renderNoData(container, "No reviewer data available");
      return;
    }
    const barsHtml = recentRollups.map((r) => {
      const count = r.reviewers_count || 0;
      const pct = count / maxReviewers * 100;
      const weekLabel = r.week.split("-W")[1] || "";
      return `
            <div class="h-bar-row" title="${escapeHtml(r.week)}: ${count} reviewers">
                <span class="h-bar-label">W${escapeHtml(weekLabel)}</span>
                <div class="h-bar-container">
                    <div class="h-bar" style="width: ${pct}%"></div>
                </div>
                <span class="h-bar-value">${count}</span>
            </div>
        `;
    }).join("");
    renderTrustedHtml(
      container,
      `<div class="horizontal-bar-chart">${barsHtml}</div>`
    );
  }

  // ui/modules/export.ts
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

  // ui/modules/sdk.ts
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
  async function getBuildClient() {
    return new Promise((resolve) => {
      VSS.require(["TFS/Build/RestClient"], (...args) => {
        const BuildRestClient = args[0];
        resolve(BuildRestClient.getClient());
      });
    });
  }
  function isLocalMode() {
    return typeof window !== "undefined" && window.LOCAL_DASHBOARD_MODE === true;
  }
  function getLocalDatasetPath() {
    return typeof window !== "undefined" && window.DATASET_PATH || "./dataset";
  }

  // ui/dashboard.ts
  var loader = null;
  var artifactClient = null;
  var currentDateRange = {
    start: null,
    end: null
  };
  var currentFilters = {
    repos: [],
    teams: []
  };
  var comparisonMode = false;
  var cachedRollups = [];
  var currentBuildId = null;
  var SETTINGS_KEY_PROJECT = "pr-insights-source-project";
  var SETTINGS_KEY_PIPELINE = "pr-insights-pipeline-id";
  var elements = {};
  var elementLists = {};
  function getElement(id) {
    const el = elements[id];
    if (el instanceof HTMLElement) {
      return el;
    }
    return null;
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
      console.log("Using pipeline definition ID from settings: %d", sourceConfig.pipelineId);
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
  async function resolveFromPipelineId(pipelineId, projectId) {
    const buildClient = await getBuildClient();
    const builds = await buildClient.getBuilds(
      projectId,
      [pipelineId],
      void 0,
      void 0,
      void 0,
      void 0,
      void 0,
      void 0,
      // reasonFilter
      2,
      // statusFilter: Completed
      6,
      // resultFilter: Succeeded (2) | PartiallySucceeded (4)
      void 0,
      void 0,
      1
      // top
    );
    if (!builds || builds.length === 0) {
      const definitions = await buildClient.getDefinitions(
        projectId,
        void 0,
        void 0,
        void 0,
        2,
        void 0,
        void 0,
        void 0,
        [pipelineId]
      );
      const name = definitions?.[0]?.name || `ID ${pipelineId}`;
      throw createNoSuccessfulBuildsError(name);
    }
    const latestBuild = builds[0];
    if (!latestBuild) throw new Error("Failed to retrieve latest build");
    if (!artifactClient) throw new Error("ArtifactClient not initialized");
    const artifacts = await artifactClient.getArtifacts(latestBuild.id);
    const hasAggregates = artifacts.some((a) => a.name === "aggregates");
    if (!hasAggregates) {
      const definitions = await buildClient.getDefinitions(
        projectId,
        void 0,
        void 0,
        void 0,
        2,
        void 0,
        void 0,
        void 0,
        [pipelineId]
      );
      const name = definitions?.[0]?.name || `ID ${pipelineId}`;
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
  async function discoverInsightsPipelines(projectId) {
    const buildClient = await getBuildClient();
    const matches = [];
    const definitions = await buildClient.getDefinitions(
      projectId,
      void 0,
      void 0,
      void 0,
      2,
      50
    );
    for (const def of definitions) {
      const builds = await buildClient.getBuilds(
        projectId,
        [def.id],
        void 0,
        void 0,
        void 0,
        void 0,
        void 0,
        void 0,
        2,
        6,
        void 0,
        void 0,
        1
      );
      if (!builds || builds.length === 0) continue;
      const latestBuild = builds[0];
      if (!latestBuild) continue;
      try {
        if (!artifactClient) throw new Error("ArtifactClient not initialized");
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
      "repo-filter-group",
      "team-filter-group",
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
      "export-raw-zip"
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
    renderSummaryCards2(rollups, prevRollups);
    renderThroughputChart2(rollups);
    renderCycleTimeTrend2(rollups);
    renderReviewerActivity2(rollups);
    renderCycleDistribution2(distributions);
    if (comparisonMode) {
      updateComparisonBanner();
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
    renderReviewerActivity(elements["reviewer-activity"] ?? null, rollups);
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
      htmlTab.classList.toggle("active", htmlTab.dataset["tab"] === tabId);
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
    restoreFiltersFromUrl();
  }
  function handleFilterChange() {
    const repoFilter = elements["repo-filter"];
    const teamFilter = elements["team-filter"];
    const repoValues = repoFilter ? Array.from(repoFilter.selectedOptions).map((o) => o.value).filter((v) => v) : [];
    const teamValues = teamFilter ? Array.from(teamFilter.selectedOptions).map((o) => o.value).filter((v) => v) : [];
    currentFilters = { repos: repoValues, teams: teamValues };
    updateFilterUI();
    updateUrlState();
    void refreshMetrics();
  }
  function clearAllFilters() {
    currentFilters = { repos: [], teams: [] };
    const repoFilter = elements["repo-filter"];
    const teamFilter = elements["team-filter"];
    if (repoFilter) {
      Array.from(repoFilter.options).forEach(
        (o) => o.selected = o.value === ""
      );
    }
    if (teamFilter) {
      Array.from(teamFilter.options).forEach(
        (o) => o.selected = o.value === ""
      );
    }
    updateFilterUI();
    updateUrlState();
    void refreshMetrics();
  }
  function removeFilter(type, value) {
    if (type === "repo") {
      currentFilters.repos = currentFilters.repos.filter((v) => v !== value);
      const repoFilter = elements["repo-filter"];
      if (repoFilter) {
        const option = repoFilter.querySelector(
          `option[value="${value}"]`
        );
        if (option) option.selected = false;
      }
    } else if (type === "team") {
      currentFilters.teams = currentFilters.teams.filter((v) => v !== value);
      const teamFilter = elements["team-filter"];
      if (teamFilter) {
        const option = teamFilter.querySelector(
          `option[value="${value}"]`
        );
        if (option) option.selected = false;
      }
    }
    updateFilterUI();
    updateUrlState();
    void refreshMetrics();
  }
  function updateFilterUI() {
    const hasFilters = currentFilters.repos.length > 0 || currentFilters.teams.length > 0;
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
    renderTrustedHtml(chipsEl, chips.join(""));
    chipsEl.querySelectorAll(".filter-chip-remove").forEach((btnNode) => {
      const btn = btnNode;
      btn.addEventListener("click", () => {
        const type = btn.dataset["type"];
        const val = btn.dataset["value"];
        if (type && val) removeFilter(type, val);
      });
    });
  }
  function getFilterLabel(type, value) {
    if (type === "repo") {
      const repoFilter = elements["repo-filter"];
      const option = repoFilter?.querySelector(`option[value="${value}"]`);
      return option?.textContent || value;
    }
    if (type === "team") {
      const teamFilter = elements["team-filter"];
      const option = teamFilter?.querySelector(`option[value="${value}"]`);
      return option?.textContent || value;
    }
    return value;
  }
  function createFilterChip(type, value, label) {
    const prefix = type === "repo" ? "repo" : "team";
    return `
        <span class="filter-chip">
            <span class="filter-chip-label">${prefix}: ${escapeHtml(label)}</span>
            <span class="filter-chip-remove" data-type="${escapeHtml(type)}" data-value="${escapeHtml(value)}">&times;</span>
        </span>
    `;
  }
  function restoreFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const reposParam = params.get("repos");
    const teamsParam = params.get("teams");
    if (reposParam) {
      currentFilters.repos = reposParam.split(",").filter((v) => v);
      const repoFilter = elements["repo-filter"];
      if (repoFilter) {
        currentFilters.repos.forEach((value) => {
          const option = repoFilter.querySelector(
            `option[value="${value}"]`
          );
          if (option) option.selected = true;
        });
      }
    }
    if (teamsParam) {
      currentFilters.teams = teamsParam.split(",").filter((v) => v);
      const teamFilter = elements["team-filter"];
      if (teamFilter) {
        currentFilters.teams.forEach((value) => {
          const option = teamFilter.querySelector(
            `option[value="${value}"]`
          );
          if (option) option.selected = true;
        });
      }
    }
    updateFilterUI();
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
    const runInfo = elements["run-info"];
    if (runInfo) {
      runInfo.textContent = `Generated: ${generatedAt}`;
      if (runId) runInfo.textContent += ` | Run: ${runId.slice(0, 8)}`;
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
      newParams.set("start", currentDateRange.start.toISOString().substring(0, 10));
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
    if (comparisonMode) {
      newParams.set("compare", "1");
    }
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}?${newParams.toString()}`
    );
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
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void init());
  } else {
    void init();
  }
})();
// Global exports for browser runtime
if (typeof window !== 'undefined') { Object.assign(window, PRInsightsDashboard || {}); }
