/**
 * Rollup Schema Validator
 *
 * Validates weekly rollup JSON files.
 * Uses PERMISSIVE mode by default - unknown fields cause warnings, not errors.
 *
 * @module schemas/rollup.schema
 */

import type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
  SchemaValidator,
} from "./types";
import {
  validResult,
  invalidResult,
  createError,
  createWarning,
} from "./types";
import {
  isObject,
  isArray,
  isString,
  isNumber,
  isBoolean,
  getTypeName,
  buildPath,
  validateRequired,
  validateNumber,
  validateIsoDate,
  validateIsoWeek,
  validateNonNegativeNumber,
  findUnknownFields,
} from "./utils";

// ============================================================================
// Types
// ============================================================================

/**
 * Breakdown by repository or team.
 */
export interface BreakdownEntry {
  pr_count: number;
  cycle_time_p50?: number | null;
  cycle_time_p90?: number | null;
  review_time_p50?: number | null;
  review_time_p90?: number | null;
  authors_count?: number;
  reviewers_count?: number;
}

/**
 * Reviewer-specific breakdown entry.
 */
export interface ReviewerBreakdownEntry {
  reviewed_prs: number;
  reviews_count: number;
  approval_rate?: number | null;
  authors_count?: number;
  repositories_count?: number;
}

/**
 * Individual PR record element of the weekly rollup `prs` array (feature 060).
 *
 * The five presence-required fields are locked by feature 060
 * (FR-001, data-model §1, specs/060-throughput-pr-drilldown/contracts/pr-record.md).
 * Feature 310 extends the contract with three presence-optional comments-metrics
 * fields (`thread_count` / `comment_count` / `active_thread_count`); the
 * authoritative declaration for the extended shape is
 * specs/310-comments-visualization/contracts/pr-record-comments-fields.md §1.
 *
 * Presence semantics:
 *   - The five feature-060 fields are always emitted on every PrRecord.
 *   - The three feature-310 fields are emitted together (all three or none)
 *     per INV-08, gated at emission time by
 *     `capabilities.comments_metrics`.  Each is `?: number | null`: absent
 *     entirely when the capability is off, a number when covered, or `null`
 *     when the per-PR `comments_extracted_at` is NULL (partial coverage
 *     sentinel per INV-10 / FR-3-05).
 *
 * Expansion requires a fresh scoping round — do not add fields
 * opportunistically.  Drift between this interface, the Python `PrRecord`
 * TypedDict, `PR_RECORD_REQUIRED_FIELDS`, and the 310 §1 table is detected
 * by `scripts/check_pr_record_schema_parity.py`.
 */
export interface PrRecord {
  id: number;
  title: string;
  author_id: string;
  repository_id: string;
  cycle_time: number;
  thread_count?: number | null;
  comment_count?: number | null;
  active_thread_count?: number | null;
}

/**
 * Weekly rollup structure.
 */
export interface WeeklyRollup {
  week: string;
  start_date?: string;
  end_date?: string;
  pr_count: number;
  cycle_time_p50?: number | null;
  cycle_time_p90?: number | null;
  review_time_p50?: number | null;
  review_time_p90?: number | null;
  authors_count?: number;
  reviewers_count?: number;
  by_repository?: Record<string, BreakdownEntry>;
  by_author?: Record<string, BreakdownEntry>;
  by_author_and_repo?: Record<string, Record<string, BreakdownEntry>>;
  by_team?: Record<string, BreakdownEntry>;
  by_reviewer?: Record<string, ReviewerBreakdownEntry>;
  by_team_and_repo?: Record<string, Record<string, BreakdownEntry>>;
  // Feature 060 PR-level detail (present on private tenant artifacts only;
  // stripped from public/demo artifacts per the privacy-posture contract).
  prs?: readonly PrRecord[];
  _prs_truncated?: boolean;
  _prs_cap?: number;
}

// ============================================================================
// Known Fields
// ============================================================================

const KNOWN_ROOT_FIELDS = new Set([
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
]);

const PR_RECORD_REQUIRED_FIELDS: readonly (keyof PrRecord)[] = [
  "id",
  "title",
  "author_id",
  "repository_id",
  "cycle_time",
];

const KNOWN_BREAKDOWN_FIELDS = new Set([
  "pr_count",
  "cycle_time_p50",
  "cycle_time_p90",
  "review_time_p50",
  "review_time_p90",
  "authors_count",
  "reviewers_count",
]);

const KNOWN_REVIEWER_BREAKDOWN_FIELDS = new Set([
  "reviewed_prs",
  "reviews_count",
  "approval_rate",
  "authors_count",
  "repositories_count",
]);

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a breakdown entry (by_repository or by_team item).
 */
function validateBreakdownEntry(
  data: unknown,
  path: string,
  strict: boolean,
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!isObject(data)) {
    errors.push(createError(path, "object", getTypeName(data)));
    return { errors, warnings };
  }

  // pr_count is typically present but not strictly required in breakdowns
  if ("pr_count" in data) {
    const err = validateNonNegativeNumber(
      data.pr_count,
      buildPath(path, "pr_count"),
    );
    if (err) errors.push(err);
  }

  // Optional numeric fields
  // Use hasOwnProperty.call for safe property check (avoids prototype pollution)
  const numericFields = [
    "cycle_time_p50",
    "cycle_time_p90",
    "review_time_p50",
    "review_time_p90",
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

/**
 * Validate a breakdown object (by_repository or by_team).
 */
function validateBreakdown(
  data: unknown,
  path: string,
  strict: boolean,
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!isObject(data)) {
    errors.push(createError(path, "object", getTypeName(data)));
    return { errors, warnings };
  }

  // Each key is a repository/team name, value is a breakdown entry
  for (const [key, value] of Object.entries(data)) {
    const result = validateBreakdownEntry(value, buildPath(path, key), strict);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  return { errors, warnings };
}

/**
 * Validate a reviewer breakdown entry (by_reviewer item).
 */
function validateReviewerBreakdownEntry(
  data: unknown,
  path: string,
  strict: boolean,
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!isObject(data)) {
    errors.push(createError(path, "object", getTypeName(data)));
    return { errors, warnings };
  }

  if ("reviewed_prs" in data) {
    const err = validateNonNegativeNumber(
      data.reviewed_prs,
      buildPath(path, "reviewed_prs"),
    );
    if (err) errors.push(err);
  }

  if ("reviews_count" in data) {
    const err = validateNonNegativeNumber(
      data.reviews_count,
      buildPath(path, "reviews_count"),
    );
    if (err) errors.push(err);
  }

  if (Object.prototype.hasOwnProperty.call(data, "approval_rate")) {
    const fieldValue = Object.getOwnPropertyDescriptor(
      data,
      "approval_rate",
    )?.value;
    if (fieldValue != null) {
      const err = validateNumber(fieldValue, buildPath(path, "approval_rate"));
      if (err) {
        errors.push(err);
      } else if (
        typeof fieldValue === "number" &&
        (fieldValue < 0 || fieldValue > 1)
      ) {
        errors.push(
          createError(
            buildPath(path, "approval_rate"),
            "number between 0 and 1",
            `${fieldValue}`,
          ),
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
          buildPath(path, field),
        );
        if (err) errors.push(err);
      }
    }
  }

  const unknown = findUnknownFields(
    data,
    KNOWN_REVIEWER_BREAKDOWN_FIELDS,
    path,
    strict,
  );
  errors.push(...unknown.errors);
  warnings.push(...unknown.warnings);

  return { errors, warnings };
}

/**
 * Validate a reviewer breakdown object (by_reviewer).
 */
function validateReviewerBreakdown(
  data: unknown,
  path: string,
  strict: boolean,
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!isObject(data)) {
    errors.push(createError(path, "object", getTypeName(data)));
    return { errors, warnings };
  }

  for (const [key, value] of Object.entries(data)) {
    const result = validateReviewerBreakdownEntry(
      value,
      buildPath(path, key),
      strict,
    );
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  return { errors, warnings };
}

/**
 * Validate a nested breakdown (e.g., by_team_and_repo: team -> repo -> entry).
 * Outer keys map to inner breakdown objects (dict of dict of BreakdownEntry).
 */
function validateNestedBreakdown(
  data: unknown,
  path: string,
  strict: boolean,
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!isObject(data)) {
    errors.push(createError(path, "object", getTypeName(data)));
    return { errors, warnings };
  }

  // Each key is an outer dimension (e.g., team name), value is a breakdown (repo -> entry).
  // Keys starting with "_" are metadata (e.g., _truncated) and must be skipped.
  for (const [outerKey, innerValue] of Object.entries(data)) {
    if (outerKey.startsWith("_")) continue;
    const innerPath = buildPath(path, outerKey);
    if (!isObject(innerValue)) {
      errors.push(createError(innerPath, "object", getTypeName(innerValue)));
      continue;
    }
    // Each key in the inner object is a second dimension (e.g., repo name)
    for (const [innerKey, entryValue] of Object.entries(
      innerValue as Record<string, unknown>,
    )) {
      const entryResult = validateBreakdownEntry(
        entryValue,
        buildPath(innerPath, innerKey),
        strict,
      );
      errors.push(...entryResult.errors);
      warnings.push(...entryResult.warnings);
    }
  }

  return { errors, warnings };
}

/**
 * Validate the `prs` array (feature 060). Permissive: malformed elements and
 * missing required fields produce warnings, never errors — matches the
 * schema-validator convention for new optional fields. The UI treats warned
 * elements as absent (no partial render).
 */
function validatePrRecordArray(
  data: unknown,
  path: string,
): { warnings: ValidationWarning[] } {
  const warnings: ValidationWarning[] = [];

  if (!isArray(data)) {
    warnings.push(
      createWarning(
        path,
        `'prs' present but not an array (got ${getTypeName(data)}); ignored`,
      ),
    );
    return { warnings };
  }

  for (const [i, pr] of data.entries()) {
    const prPath = buildPath(path, i);
    if (!isObject(pr)) {
      warnings.push(
        createWarning(
          prPath,
          `'prs[${i}]' is not an object (got ${getTypeName(pr)}); element ignored`,
        ),
      );
      continue;
    }
    for (const field of PR_RECORD_REQUIRED_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(pr, field)) {
        warnings.push(
          createWarning(
            buildPath(prPath, field),
            `missing required PR field '${field}'; element will be treated as absent`,
          ),
        );
      }
    }
    // Per-field type checks. Literal-key direct access is safe here because
    // `pr` has already been narrowed to Record<string, unknown> via isObject,
    // and the keys are compile-time constants. Missing fields surface as
    // `undefined` and skip the type warning cleanly (the missing-required
    // warning fires separately in the loop above).
    if (pr.id !== undefined && !isNumber(pr.id)) {
      warnings.push(
        createWarning(
          buildPath(prPath, "id"),
          `expected number, got ${getTypeName(pr.id)}`,
        ),
      );
    }
    if (pr.title !== undefined && !isString(pr.title)) {
      warnings.push(
        createWarning(
          buildPath(prPath, "title"),
          `expected string, got ${getTypeName(pr.title)}`,
        ),
      );
    }
    if (pr.author_id !== undefined && !isString(pr.author_id)) {
      warnings.push(
        createWarning(
          buildPath(prPath, "author_id"),
          `expected string, got ${getTypeName(pr.author_id)}`,
        ),
      );
    }
    if (pr.repository_id !== undefined && !isString(pr.repository_id)) {
      warnings.push(
        createWarning(
          buildPath(prPath, "repository_id"),
          `expected string, got ${getTypeName(pr.repository_id)}`,
        ),
      );
    }
    if (pr.cycle_time !== undefined && !isNumber(pr.cycle_time)) {
      warnings.push(
        createWarning(
          buildPath(prPath, "cycle_time"),
          `expected number, got ${getTypeName(pr.cycle_time)}`,
        ),
      );
    }
    // Feature 310 — comments-metrics triplet validation.  All three fields
    // are presence-optional (absent entirely when capabilities.comments_metrics
    // is off) and value-nullable (null = per-PR coverage-partial sentinel).
    // The validator is permissive: every violation below surfaces as a warning
    // with a path and a specific message — it never rejects the element.
    // Runtime enforcement of the same invariants on production builds lives in
    // tests/unit/test_aggregators_pr_records_comments.py (producer) and
    // extension/tests/schema/pr-record-comments-fields.test.ts (consumer).
    //
    // Static field-by-field access mirrors the feature-060 pattern above;
    // dynamic key access (``pr[field]``) trips eslint security rules and
    // would add no brevity to three cases.
    const threadCount = pr.thread_count;
    const commentCount = pr.comment_count;
    const activeThreadCount = pr.active_thread_count;
    if (
      threadCount !== undefined &&
      threadCount !== null &&
      !isNumber(threadCount)
    ) {
      warnings.push(
        createWarning(
          buildPath(prPath, "thread_count"),
          `expected number or null, got ${getTypeName(threadCount)}`,
        ),
      );
    }
    if (
      commentCount !== undefined &&
      commentCount !== null &&
      !isNumber(commentCount)
    ) {
      warnings.push(
        createWarning(
          buildPath(prPath, "comment_count"),
          `expected number or null, got ${getTypeName(commentCount)}`,
        ),
      );
    }
    if (
      activeThreadCount !== undefined &&
      activeThreadCount !== null &&
      !isNumber(activeThreadCount)
    ) {
      warnings.push(
        createWarning(
          buildPath(prPath, "active_thread_count"),
          `expected number or null, got ${getTypeName(activeThreadCount)}`,
        ),
      );
    }
    // INV-08 atomicity: all three fields present together, or all absent.
    const presentCount =
      (threadCount !== undefined ? 1 : 0) +
      (commentCount !== undefined ? 1 : 0) +
      (activeThreadCount !== undefined ? 1 : 0);
    if (presentCount !== 0 && presentCount !== 3) {
      warnings.push(
        createWarning(
          prPath,
          `comments-metrics atomicity violated (INV-08): expected all three of thread_count / comment_count / active_thread_count to be present together, or all absent; got ${presentCount} of 3 present`,
        ),
      );
    }
    // INV-10 coverage-partial consistency: when all three are present, they
    // must be all numeric or all null.  Mixed null/numeric is a producer bug.
    if (presentCount === 3) {
      const nullCount =
        (threadCount === null ? 1 : 0) +
        (commentCount === null ? 1 : 0) +
        (activeThreadCount === null ? 1 : 0);
      if (nullCount !== 0 && nullCount !== 3) {
        warnings.push(
          createWarning(
            prPath,
            `comments-metrics coverage-partial consistency violated (INV-10): expected thread_count / comment_count / active_thread_count to be all numeric or all null; got ${nullCount} of 3 null`,
          ),
        );
      }
      // INV-09 ordering: active_thread_count <= thread_count when both numeric.
      if (
        isNumber(threadCount) &&
        isNumber(activeThreadCount) &&
        activeThreadCount > threadCount
      ) {
        warnings.push(
          createWarning(
            prPath,
            `comments-metrics ordering violated (INV-09): active_thread_count (${activeThreadCount}) MUST NOT exceed thread_count (${threadCount})`,
          ),
        );
      }
    }
  }

  return { warnings };
}

// ============================================================================
// Main Validator
// ============================================================================

/**
 * Validate a weekly rollup.
 *
 * @param data - Unknown data to validate
 * @param strict - If true, unknown fields cause errors; if false, they cause warnings
 * @returns ValidationResult
 */
export function validateRollup(
  data: unknown,
  strict: boolean,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Must be an object
  if (!isObject(data)) {
    errors.push(
      createError("", "object", getTypeName(data), "Rollup must be an object"),
    );
    return invalidResult(errors);
  }

  // Required fields
  const requiredFields = ["week", "pr_count"];

  for (const field of requiredFields) {
    const err = validateRequired(data, field, "");
    if (err) errors.push(err);
  }

  // Type validations for required fields
  if ("week" in data) {
    const err = validateIsoWeek(data.week, "week");
    if (err) errors.push(err);
  }

  if ("pr_count" in data) {
    const err = validateNonNegativeNumber(data.pr_count, "pr_count");
    if (err) errors.push(err);
  }

  // Optional date fields (may not be present in legacy rollups)
  if ("start_date" in data && data.start_date !== undefined) {
    const err = validateIsoDate(data.start_date, "start_date");
    if (err) errors.push(err);
  }

  if ("end_date" in data && data.end_date !== undefined) {
    const err = validateIsoDate(data.end_date, "end_date");
    if (err) errors.push(err);
  }

  // Optional numeric fields
  const numericFields = [
    "cycle_time_p50",
    "cycle_time_p90",
    "review_time_p50",
    "review_time_p90",
    "authors_count",
    "reviewers_count",
  ];

  // Use hasOwnProperty.call for safe property check (avoids prototype pollution)
  for (const field of numericFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      const fieldValue = Object.getOwnPropertyDescriptor(data, field)?.value;
      if (fieldValue != null) {
        const err = validateNumber(fieldValue, field);
        if (err) errors.push(err);
      }
    }
  }

  // Optional breakdown objects
  if (
    Object.prototype.hasOwnProperty.call(data, "by_repository") &&
    data.by_repository !== undefined
  ) {
    const result = validateBreakdown(
      data.by_repository,
      "by_repository",
      strict,
    );
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  if (
    Object.prototype.hasOwnProperty.call(data, "by_author") &&
    data.by_author !== undefined
  ) {
    const result = validateBreakdown(data.by_author, "by_author", strict);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  if ("by_team" in data && data.by_team !== undefined) {
    const result = validateBreakdown(data.by_team, "by_team", strict);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  if ("by_reviewer" in data && data.by_reviewer !== undefined) {
    const result = validateReviewerBreakdown(
      data.by_reviewer,
      "by_reviewer",
      strict,
    );
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  if (
    Object.prototype.hasOwnProperty.call(data, "by_author_and_repo") &&
    data.by_author_and_repo !== undefined
  ) {
    const result = validateNestedBreakdown(
      data.by_author_and_repo,
      "by_author_and_repo",
      strict,
    );
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  if (
    Object.prototype.hasOwnProperty.call(data, "by_team_and_repo") &&
    data.by_team_and_repo !== undefined
  ) {
    const result = validateNestedBreakdown(
      data.by_team_and_repo,
      "by_team_and_repo",
      strict,
    );
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  // Feature 060: PR-level detail (`prs` + `_prs_truncated` + `_prs_cap`).
  // All three are optional. When `prs` is present, markers are expected; when
  // markers appear without `prs`, they are ignored. Permissive throughout —
  // warnings only, never errors. Matches pr-record.md validator contract.
  // Literal-key direct access on the already-narrowed data object. Missing
  // or explicitly-undefined keys both surface as `undefined`, matching the
  // "absent" semantics the permissive validator needs.
  const prsValue = data.prs;
  const truncatedValue = data._prs_truncated;
  const capValue = data._prs_cap;
  const hasPrs = prsValue !== undefined;
  const hasTruncated = truncatedValue !== undefined;
  const hasCap = capValue !== undefined;

  if (hasPrs) {
    const prsResult = validatePrRecordArray(prsValue, "prs");
    warnings.push(...prsResult.warnings);
    if (!hasTruncated) {
      warnings.push(
        createWarning(
          "_prs_truncated",
          "'prs' present but '_prs_truncated' absent; treated as false",
        ),
      );
    } else if (!isBoolean(truncatedValue)) {
      warnings.push(
        createWarning(
          "_prs_truncated",
          `expected boolean, got ${getTypeName(truncatedValue)}`,
        ),
      );
    }
    if (!hasCap) {
      warnings.push(
        createWarning(
          "_prs_cap",
          "'prs' present but '_prs_cap' absent; truncation-indicator math will be skipped",
        ),
      );
    } else if (!isNumber(capValue)) {
      warnings.push(
        createWarning(
          "_prs_cap",
          `expected number, got ${getTypeName(capValue)}`,
        ),
      );
    }
  } else {
    if (hasTruncated) {
      warnings.push(
        createWarning(
          "_prs_truncated",
          "'_prs_truncated' present without 'prs'; ignored",
        ),
      );
    }
    if (hasCap) {
      warnings.push(
        createWarning("_prs_cap", "'_prs_cap' present without 'prs'; ignored"),
      );
    }
  }

  // Check for unknown fields at root
  const unknown = findUnknownFields(data, KNOWN_ROOT_FIELDS, "", strict);
  errors.push(...unknown.errors);
  warnings.push(...unknown.warnings);

  if (errors.length > 0) {
    return invalidResult(errors, warnings);
  }

  return validResult(warnings);
}

/**
 * Default values for rollup fields.
 */
const ROLLUP_FIELD_DEFAULTS = {
  cycle_time_p50: null as number | null,
  cycle_time_p90: null as number | null,
  review_time_p50: null as number | null,
  review_time_p90: null as number | null,
  authors_count: 0,
  reviewers_count: 0,
  by_repository: {},
  by_author: {},
  by_team: {},
  by_reviewer: {},
};

/**
 * Normalize a validated rollup to ensure all optional fields have defaults.
 *
 * @param data - Validated rollup data
 * @returns Normalized WeeklyRollup
 */
export function normalizeRollup(data: unknown): WeeklyRollup {
  const obj = data as Record<string, unknown>;

  return {
    week: obj.week as string,
    start_date: obj.start_date as string,
    end_date: obj.end_date as string,
    pr_count: obj.pr_count as number,
    cycle_time_p50: isNumber(obj.cycle_time_p50)
      ? obj.cycle_time_p50
      : ROLLUP_FIELD_DEFAULTS.cycle_time_p50,
    cycle_time_p90: isNumber(obj.cycle_time_p90)
      ? obj.cycle_time_p90
      : ROLLUP_FIELD_DEFAULTS.cycle_time_p90,
    review_time_p50: isNumber(obj.review_time_p50)
      ? obj.review_time_p50
      : ROLLUP_FIELD_DEFAULTS.review_time_p50,
    review_time_p90: isNumber(obj.review_time_p90)
      ? obj.review_time_p90
      : ROLLUP_FIELD_DEFAULTS.review_time_p90,
    authors_count: isNumber(obj.authors_count)
      ? obj.authors_count
      : ROLLUP_FIELD_DEFAULTS.authors_count,
    reviewers_count: isNumber(obj.reviewers_count)
      ? obj.reviewers_count
      : ROLLUP_FIELD_DEFAULTS.reviewers_count,
    by_repository:
      (obj.by_repository as Record<string, BreakdownEntry>) ??
      ROLLUP_FIELD_DEFAULTS.by_repository,
    by_author:
      (obj.by_author as Record<string, BreakdownEntry>) ??
      ROLLUP_FIELD_DEFAULTS.by_author,
    ...(obj.by_author_and_repo !== undefined
      ? {
          by_author_and_repo: obj.by_author_and_repo as Record<
            string,
            Record<string, BreakdownEntry>
          >,
        }
      : {}),
    by_team:
      (obj.by_team as Record<string, BreakdownEntry>) ??
      ROLLUP_FIELD_DEFAULTS.by_team,
    by_reviewer:
      (obj.by_reviewer as Record<string, ReviewerBreakdownEntry>) ??
      ROLLUP_FIELD_DEFAULTS.by_reviewer,
    // Pass through cross-dimensional breakdown if present (v2 schema)
    ...(obj.by_team_and_repo !== undefined
      ? {
          by_team_and_repo: obj.by_team_and_repo as Record<
            string,
            Record<string, BreakdownEntry>
          >,
        }
      : {}),
  };
}

/**
 * Rollup schema validator object implementing SchemaValidator interface.
 */
export const RollupSchema: SchemaValidator<WeeklyRollup> = {
  validate: validateRollup,
  normalize: normalizeRollup,
};
