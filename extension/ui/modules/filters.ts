/**
 * Filter utilities for dashboard.
 *
 * Pure functions and types for filter state management.
 * DOM-dependent filter UI operations remain in dashboard.ts.
 */

import { escapeHtml } from "./shared";

/**
 * Filter state interface.
 */
export interface FilterState {
  repos: string[];
  teams: string[];
  reviewers: string[];
  authors: string[];
}

/**
 * Create an empty filter state.
 */
export function createEmptyFilterState(): FilterState {
  return { repos: [], teams: [], reviewers: [], authors: [] };
}

/**
 * Check if filter state has any active filters.
 */
export function hasActiveFilters(state: FilterState): boolean {
  return (
    state.repos.length > 0 ||
    state.teams.length > 0 ||
    state.reviewers.length > 0 ||
    state.authors.length > 0
  );
}

/**
 * Parse filter state from URL search params.
 * @param params - URL search params
 * @returns Parsed filter state
 */
export function parseFiltersFromUrl(params: URLSearchParams): FilterState {
  const reposParam = params.get("repos");
  const teamsParam = params.get("teams");
  const reviewersParam = params.get("reviewers");
  const authorParam = params.get("author");
  const reviewerValues = reviewersParam
    ? reviewersParam.split(",").filter((v) => v.trim())
    : [];
  const firstReviewer = reviewerValues[0];

  return {
    repos: reposParam ? reposParam.split(",").filter((v) => v.trim()) : [],
    teams: teamsParam ? teamsParam.split(",").filter((v) => v.trim()) : [],
    reviewers: firstReviewer ? [firstReviewer] : [],
    authors: authorParam ? [authorParam].filter((v) => v.trim()) : [],
  };
}

/**
 * Serialize filter state to URL search params.
 * @param state - Filter state
 * @param params - Existing URL search params to update
 */
export function serializeFiltersToUrl(
  state: FilterState,
  params: URLSearchParams,
): void {
  if (state.repos.length > 0) {
    params.set("repos", state.repos.join(","));
  } else {
    params.delete("repos");
  }

  if (state.teams.length > 0) {
    params.set("teams", state.teams.join(","));
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

/**
 * Create HTML for a filter chip.
 * @param type - Filter type (repo or team)
 * @param value - Filter value
 * @param label - Display label
 * @returns HTML string for the chip
 */
export function createFilterChipHtml(
  type: "repo" | "team" | "reviewer" | "author",
  value: string,
  label: string,
): string {
  const prefix =
    type === "repo"
      ? "repo"
      : type === "team"
        ? "team"
        : type === "reviewer"
          ? "reviewer"
          : "author";
  const escapedLabel = escapeHtml(label);
  const escapedValue = escapeHtml(value);

  return `
    <span class="filter-chip">
      <span class="filter-chip-label">${prefix}: ${escapedLabel}</span>
      <span class="filter-chip-remove" data-type="${type}" data-value="${escapedValue}">&times;</span>
    </span>
  `;
}

/**
 * Generate all filter chip HTML from state.
 * @param state - Filter state
 * @param labelFn - Function to get display label from type and value
 * @returns Combined HTML string for all chips
 */
export function renderFilterChipsHtml(
  state: FilterState,
  labelFn: (
    type: "repo" | "team" | "reviewer" | "author",
    value: string,
  ) => string,
): string {
  const chips: string[] = [];

  state.repos.forEach((value) => {
    chips.push(createFilterChipHtml("repo", value, labelFn("repo", value)));
  });

  state.teams.forEach((value) => {
    chips.push(createFilterChipHtml("team", value, labelFn("team", value)));
  });

  state.reviewers.forEach((value) => {
    chips.push(
      createFilterChipHtml("reviewer", value, labelFn("reviewer", value)),
    );
  });

  state.authors.forEach((value) => {
    chips.push(createFilterChipHtml("author", value, labelFn("author", value)));
  });

  return chips.join("");
}
