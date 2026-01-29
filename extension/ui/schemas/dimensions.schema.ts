/**
 * Dimensions Schema Validator
 *
 * Validates dimensions.json files containing lookup data for repositories, users, projects, and teams.
 * Uses STRICT mode by default - unknown fields cause errors.
 *
 * Supports both production format (snake_case fields) and legacy format (camelCase fields).
 *
 * @module schemas/dimensions.schema
 */

import type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
  SchemaValidator,
} from "./types";
import { validResult, invalidResult, createError } from "./types";
import {
  isObject,
  isArray,
  getTypeName,
  buildPath,
  validateRequired,
  validateString,
  validateIsoDate,
  validateArray,
  findUnknownFields,
} from "./utils";

// ============================================================================
// Types
// ============================================================================

/**
 * Repository dimension entry (production format).
 */
export interface RepositoryEntry {
  repository_id: string;
  repository_name: string;
  organization_name: string;
  project_name: string;
}

/**
 * Repository dimension entry (legacy format for test fixtures).
 */
export interface LegacyRepositoryEntry {
  id: string;
  name: string;
  project?: string;
}

/**
 * User dimension entry (production format).
 */
export interface UserEntry {
  user_id: string;
  display_name: string;
}

/**
 * User dimension entry (legacy format for test fixtures).
 */
export interface LegacyUserEntry {
  id: string;
  displayName: string;
  uniqueName: string;
}

/**
 * Project dimension entry (production format).
 */
export interface ProjectEntry {
  organization_name: string;
  project_name: string;
}

/**
 * Project dimension entry (legacy format for test fixtures).
 */
export interface LegacyProjectEntry {
  id: string;
  name: string;
}

/**
 * Team dimension entry.
 */
export interface TeamEntry {
  id?: string;
  name?: string;
  projectId?: string;
  team_id?: string;
  team_name?: string;
}

/**
 * Date range structure.
 */
export interface DateRange {
  min: string;
  max: string;
}

/**
 * Dimensions structure (normalized).
 */
export interface Dimensions {
  repositories: (RepositoryEntry | LegacyRepositoryEntry)[];
  users: (UserEntry | LegacyUserEntry)[];
  projects: (ProjectEntry | LegacyProjectEntry)[];
  teams?: TeamEntry[];
  date_range?: DateRange;
}

// ============================================================================
// Known Fields
// ============================================================================

const KNOWN_ROOT_FIELDS = new Set([
  "repositories",
  "users",
  "projects",
  "teams",
  "date_range",
]);

// Production format fields
const KNOWN_REPOSITORY_FIELDS = new Set([
  "repository_id",
  "repository_name",
  "organization_name",
  "project_name",
  // Legacy fields
  "id",
  "name",
  "project",
]);

const KNOWN_USER_FIELDS = new Set([
  "user_id",
  "display_name",
  // Legacy fields
  "id",
  "displayName",
  "uniqueName",
]);

const KNOWN_PROJECT_FIELDS = new Set([
  "organization_name",
  "project_name",
  // Legacy fields
  "id",
  "name",
]);

const KNOWN_TEAM_FIELDS = new Set([
  "id",
  "name",
  "projectId",
  "team_id",
  "team_name",
  "project_id",
  // Extended production fields
  "member_count",
  "organization_name",
  "project_name",
]);

const KNOWN_DATE_RANGE_FIELDS = new Set(["min", "max"]);

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a repository entry (supports both production and legacy formats).
 */
function validateRepositoryEntry(
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

  // Check which format is being used
  const isProductionFormat =
    "repository_id" in data || "repository_name" in data;
  const isLegacyFormat = "id" in data || "name" in data;

  if (isProductionFormat) {
    // Production format: repository_id, repository_name, organization_name, project_name
    const idReq = validateRequired(data, "repository_id", path);
    if (idReq) errors.push(idReq);
    else {
      const idErr = validateString(
        data.repository_id,
        buildPath(path, "repository_id"),
      );
      if (idErr) errors.push(idErr);
    }

    const nameReq = validateRequired(data, "repository_name", path);
    if (nameReq) errors.push(nameReq);
    else {
      const nameErr = validateString(
        data.repository_name,
        buildPath(path, "repository_name"),
      );
      if (nameErr) errors.push(nameErr);
    }

    const orgReq = validateRequired(data, "organization_name", path);
    if (orgReq) errors.push(orgReq);
    else {
      const orgErr = validateString(
        data.organization_name,
        buildPath(path, "organization_name"),
      );
      if (orgErr) errors.push(orgErr);
    }

    const projReq = validateRequired(data, "project_name", path);
    if (projReq) errors.push(projReq);
    else {
      const projErr = validateString(
        data.project_name,
        buildPath(path, "project_name"),
      );
      if (projErr) errors.push(projErr);
    }
  } else if (isLegacyFormat) {
    // Legacy format: id, name, project
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

    if ("project" in data && data.project !== undefined) {
      const projErr = validateString(data.project, buildPath(path, "project"));
      if (projErr) errors.push(projErr);
    }
  } else {
    errors.push(
      createError(
        path,
        "repository with (repository_id, repository_name) or (id, name)",
        "empty object",
        `Repository entry at '${path}' must have required identifier fields`,
      ),
    );
  }

  const unknown = findUnknownFields(
    data,
    KNOWN_REPOSITORY_FIELDS,
    path,
    strict,
  );
  errors.push(...unknown.errors);
  warnings.push(...unknown.warnings);

  return { errors, warnings };
}

/**
 * Validate a user entry (supports both production and legacy formats).
 */
function validateUserEntry(
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

  // Check which format is being used
  const isProductionFormat = "user_id" in data || "display_name" in data;
  const isLegacyFormat = "id" in data || "displayName" in data;

  if (isProductionFormat) {
    // Production format: user_id, display_name
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
        buildPath(path, "display_name"),
      );
      if (nameErr) errors.push(nameErr);
    }
  } else if (isLegacyFormat) {
    // Legacy format: id, displayName, uniqueName
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
        buildPath(path, "displayName"),
      );
      if (nameErr) errors.push(nameErr);
    }

    const uniqueNameReq = validateRequired(data, "uniqueName", path);
    if (uniqueNameReq) errors.push(uniqueNameReq);
    else {
      const uNameErr = validateString(
        data.uniqueName,
        buildPath(path, "uniqueName"),
      );
      if (uNameErr) errors.push(uNameErr);
    }
  } else {
    errors.push(
      createError(
        path,
        "user with (user_id, display_name) or (id, displayName, uniqueName)",
        "empty object",
        `User entry at '${path}' must have required identifier fields`,
      ),
    );
  }

  const unknown = findUnknownFields(data, KNOWN_USER_FIELDS, path, strict);
  errors.push(...unknown.errors);
  warnings.push(...unknown.warnings);

  return { errors, warnings };
}

/**
 * Validate a project entry (supports both production and legacy formats).
 */
function validateProjectEntry(
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

  // Check which format is being used
  const isProductionFormat =
    "organization_name" in data || "project_name" in data;
  const isLegacyFormat = "id" in data || "name" in data;

  if (isProductionFormat) {
    // Production format: organization_name, project_name
    const orgReq = validateRequired(data, "organization_name", path);
    if (orgReq) errors.push(orgReq);
    else {
      const orgErr = validateString(
        data.organization_name,
        buildPath(path, "organization_name"),
      );
      if (orgErr) errors.push(orgErr);
    }

    const projReq = validateRequired(data, "project_name", path);
    if (projReq) errors.push(projReq);
    else {
      const projErr = validateString(
        data.project_name,
        buildPath(path, "project_name"),
      );
      if (projErr) errors.push(projErr);
    }
  } else if (isLegacyFormat) {
    // Legacy format: id, name
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
        `Project entry at '${path}' must have required identifier fields`,
      ),
    );
  }

  const unknown = findUnknownFields(data, KNOWN_PROJECT_FIELDS, path, strict);
  errors.push(...unknown.errors);
  warnings.push(...unknown.warnings);

  return { errors, warnings };
}

/**
 * Validate a team entry.
 */
function validateTeamEntry(
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

  // Team entries are flexible - validate any string fields present
  // Use hasOwnProperty.call for safe property check (avoids prototype pollution)
  const stringFields = [
    "id",
    "name",
    "projectId",
    "team_id",
    "team_name",
    "project_id",
  ];
  for (const field of stringFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      const fieldValue = Object.getOwnPropertyDescriptor(data, field)?.value;
      if (fieldValue !== undefined) {
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

/**
 * Validate date range.
 */
function validateDateRange(
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
    strict,
  );
  errors.push(...unknown.errors);
  warnings.push(...unknown.warnings);

  return { errors, warnings };
}

// ============================================================================
// Main Validator
// ============================================================================

/**
 * Validate dimensions data.
 *
 * @param data - Unknown data to validate
 * @param strict - If true, unknown fields cause errors; if false, they cause warnings
 * @returns ValidationResult
 */
export function validateDimensions(
  data: unknown,
  strict: boolean,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Must be an object
  if (!isObject(data)) {
    errors.push(
      createError(
        "",
        "object",
        getTypeName(data),
        "Dimensions must be an object",
      ),
    );
    return invalidResult(errors);
  }

  // Required arrays
  // Use Object.getOwnPropertyDescriptor for safe property access (avoids prototype pollution)
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

  // Validate repository entries
  if ("repositories" in data && isArray(data.repositories)) {
    data.repositories.forEach((item, i) => {
      const result = validateRepositoryEntry(
        item,
        buildPath("repositories", i),
        strict,
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    });
  }

  // Validate user entries
  if ("users" in data && isArray(data.users)) {
    data.users.forEach((item, i) => {
      const result = validateUserEntry(item, buildPath("users", i), strict);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    });
  }

  // Validate project entries
  if ("projects" in data && isArray(data.projects)) {
    data.projects.forEach((item, i) => {
      const result = validateProjectEntry(
        item,
        buildPath("projects", i),
        strict,
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    });
  }

  // Optional: teams
  if ("teams" in data && data.teams !== undefined) {
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

  // Optional: date_range
  if ("date_range" in data && data.date_range !== undefined) {
    const result = validateDateRange(data.date_range, "date_range", strict);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
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
 * Normalize validated dimensions to ensure all optional fields have defaults.
 *
 * @param data - Validated dimensions data
 * @returns Normalized Dimensions
 */
export function normalizeDimensions(data: unknown): Dimensions {
  const obj = data as Record<string, unknown>;

  return {
    repositories: obj.repositories as (
      | RepositoryEntry
      | LegacyRepositoryEntry
    )[],
    users: obj.users as (UserEntry | LegacyUserEntry)[],
    projects: obj.projects as (ProjectEntry | LegacyProjectEntry)[],
    teams: (obj.teams as TeamEntry[]) ?? [],
    date_range: obj.date_range as DateRange | undefined,
  };
}

/**
 * Dimensions schema validator object implementing SchemaValidator interface.
 */
export const DimensionsSchema: SchemaValidator<Dimensions> = {
  validate: validateDimensions,
  normalize: normalizeDimensions,
};
