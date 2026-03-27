/**
 * Filter Constraint Resolver — Single Authority
 *
 * Sole authority for resolving filter dimension conflicts.
 * ALL consumers (UI, metrics, URL serialization, URL deserialization)
 * MUST call this resolver before acting on filter state.
 *
 * No consumer may implement its own constraint logic (FR-010).
 *
 * Constraint rules (applied in order):
 * 1. Author + Reviewer: Clear author (reviewer takes precedence, matching legacy behavior)
 * 2. Author + Team: Clear teams, use author-only metrics
 * 3. Reviewer + Team: Clear teams
 * 4. Reviewer + Repo: Keep both in state, but metrics use reviewer-only
 */

import type { FilterState } from "./filters";

/** Notice about a constraint that was applied. */
export interface ConstraintNotice {
  type: "author_reviewer" | "author_team" | "reviewer_repo" | "reviewer_team";
  message: string;
}

/** Result of constraint resolution. */
export interface FilterConstraintResult {
  effectiveState: FilterState;
  constraintsApplied: ConstraintNotice[];
}

/**
 * Resolve filter constraints to produce a canonical effective state.
 *
 * Applies constraint rules in deterministic order:
 * 1. Author + Team → clear teams
 * 2. Reviewer + Team → clear teams
 * 3. Reviewer + Repo → notice only (both retained)
 *
 * @param raw - Raw filter state after all-selected normalization
 * @returns Effective filter state and any constraint notices
 */
export function resolveFilterConstraints(
  raw: FilterState,
): FilterConstraintResult {
  const notices: ConstraintNotice[] = [];
  const effective: FilterState = {
    repos: [...raw.repos],
    teams: [...raw.teams],
    reviewers: [...raw.reviewers],
    authors: [...raw.authors],
  };

  // Single-select enforcement
  if (effective.reviewers.length > 1) {
    effective.reviewers = effective.reviewers[0]
      ? [effective.reviewers[0]]
      : [];
  }
  if (effective.authors.length > 1) {
    effective.authors = effective.authors[0] ? [effective.authors[0]] : [];
  }

  const hasAuthor = effective.authors.length > 0;
  const hasTeam = effective.teams.length > 0;
  const hasReviewer = effective.reviewers.length > 0;
  const hasRepo = effective.repos.length > 0;

  // Rule 1: Author + Reviewer → clear author (reviewer takes precedence)
  // The metrics layer short-circuits to reviewer-only when a reviewer is
  // present, so allowing both would silently ignore the author selection.
  if (hasAuthor && hasReviewer) {
    effective.authors = [];
    notices.push({
      type: "author_reviewer",
      message:
        "Author and reviewer filters cannot be combined; using reviewer filter.",
    });
  }

  // Rule 2: Author + Team → clear teams, use author-only metrics
  if (effective.authors.length > 0 && hasTeam) {
    effective.teams = [];
    notices.push({
      type: "author_team",
      message:
        "Using author-only metrics; team selection cleared.",
    });
  }

  // Rule 3: Reviewer + Team → clear teams
  if (hasReviewer && hasTeam) {
    effective.teams = [];
    notices.push({
      type: "reviewer_team",
      message:
        "Reviewer and team filtering cannot be combined; team selection cleared.",
    });
  }

  // Rule 4: Reviewer + Repo → notice only, both retained in state
  if (hasReviewer && hasRepo) {
    notices.push({
      type: "reviewer_repo",
      message:
        "Using reviewer-only metrics; repository selection retained for display.",
    });
  }

  return { effectiveState: effective, constraintsApplied: notices };
}
