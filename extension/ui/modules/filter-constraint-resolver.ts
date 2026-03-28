/**
 * Filter Constraint Resolver — Single Authority
 *
 * Sole authority for resolving filter dimension conflicts.
 * ALL consumers (UI, metrics, URL serialization, URL deserialization)
 * MUST call this resolver before acting on filter state.
 *
 * No consumer may implement its own constraint logic (FR-010).
 *
 * Constraint rules (applied in locked sequential order 1→4):
 *
 *   Rule 1: Author ↔ Reviewer  — mutual exclusion, direction from lastChanged
 *   Rule 2: Author + Team      — notice only, teams retained in state
 *   Rule 3: Reviewer + Team    — clear teams
 *   Rule 4: Reviewer + Repo    — notice only, both retained
 *
 * The evaluation order is a tested invariant. Rules execute sequentially
 * and each rule reads the effective state as mutated by prior rules.
 * No stale boolean captures — every rule checks effective.*.length > 0
 * directly on the mutating clone.
 *
 * When lastChanged is undefined (URL restore, programmatic calls),
 * reviewer takes precedence over author. This matches the legacy
 * sourceId=null default from main.
 */

import type { FilterState } from "./filters";

/** Filter dimension identifier for last-interaction-wins resolution. */
export type FilterDimension = "repos" | "teams" | "reviewers" | "authors";

/** Notice about a constraint that was applied. */
export interface ConstraintNotice {
  type: "author_reviewer" | "author_team" | "reviewer_repo" | "reviewer_team";
  message: string;
}

/** Result of constraint resolution. */
export interface FilterConstraintResult {
  /** The single source of truth for filter state. All consumers use this directly. */
  effectiveState: FilterState;
  /** Ordered list of notices for display purposes only. Never used to determine state. */
  constraintsApplied: ConstraintNotice[];
}

/**
 * Resolve filter constraints to produce a canonical effective state.
 *
 * Clones input state once at entry. Each rule reads and mutates the clone.
 * No rule re-reads the input. No stale boolean captures.
 *
 * @param raw - Raw filter state after all-selected normalization
 * @param lastChanged - Which dimension the user last interacted with.
 *   Only {@code "authors"} causes reviewer to be cleared (Rule 1).
 *   All other values (including undefined) clear author when both are present.
 * @returns Effective filter state and constraint notices
 */
export function resolveFilterConstraints(
  raw: FilterState,
  lastChanged?: FilterDimension,
): FilterConstraintResult {
  const notices: ConstraintNotice[] = [];

  // Single clone at entry — all rules mutate this, never the input
  const effective: FilterState = {
    repos: [...raw.repos],
    teams: [...raw.teams],
    reviewers: [...raw.reviewers],
    authors: [...raw.authors],
  };

  // Single-select enforcement (pre-rules)
  if (effective.reviewers.length > 1) {
    effective.reviewers = effective.reviewers[0]
      ? [effective.reviewers[0]]
      : [];
  }
  if (effective.authors.length > 1) {
    effective.authors = effective.authors[0] ? [effective.authors[0]] : [];
  }

  // ── Rule 1: Author ↔ Reviewer mutual exclusion ──────────────────────
  // The metrics layer short-circuits to reviewer-only when a reviewer is
  // present. Allowing both would silently ignore the author selection.
  // Direction: lastChanged === "authors" → clear reviewer (author wins).
  //            All other values (including undefined) → clear author.
  if (effective.authors.length > 0 && effective.reviewers.length > 0) {
    if (lastChanged === "authors") {
      effective.reviewers = [];
    } else {
      effective.authors = [];
    }
    notices.push({
      type: "author_reviewer",
      message:
        lastChanged === "authors"
          ? "Author and reviewer filters cannot be combined; reviewer filter cleared."
          : "Author and reviewer filters cannot be combined; using reviewer filter.",
    });
  }

  // ── Rule 2: Author + Team → notice only (teams retained) ────────────
  // The data layer uses author-only metrics when both are present
  // (metrics.ts:597-603). Teams are retained in state for display,
  // URL sharing, and chip visibility. The author-filter-notice HTML
  // element is toggled by updateMetricLabels() based on effectiveState.
  if (effective.authors.length > 0 && effective.teams.length > 0) {
    notices.push({
      type: "author_team",
      message:
        "Author filter active; showing author-only metrics. Team selection retained for display.",
    });
  }

  // ── Rule 3: Reviewer + Team → clear teams ───────────────────────────
  if (effective.reviewers.length > 0 && effective.teams.length > 0) {
    effective.teams = [];
    notices.push({
      type: "reviewer_team",
      message:
        "Reviewer and team filtering cannot be combined; team selection cleared.",
    });
  }

  // ── Rule 4: Reviewer + Repo → notice only, both retained ────────────
  if (effective.reviewers.length > 0 && effective.repos.length > 0) {
    notices.push({
      type: "reviewer_repo",
      message:
        "Using reviewer-only metrics; repository selection retained for display.",
    });
  }

  return { effectiveState: effective, constraintsApplied: notices };
}
