"use strict";
/**
 * Filter utilities for dashboard.
 *
 * Pure functions and types for filter state management.
 * DOM-dependent filter UI operations remain in dashboard.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyFilterState = createEmptyFilterState;
exports.hasActiveFilters = hasActiveFilters;
exports.parseFiltersFromUrl = parseFiltersFromUrl;
exports.serializeFiltersToUrl = serializeFiltersToUrl;
exports.createFilterChipHtml = createFilterChipHtml;
exports.renderFilterChipsHtml = renderFilterChipsHtml;
const shared_1 = require("./shared");
/**
 * Create an empty filter state.
 */
function createEmptyFilterState() {
    return { repos: [], teams: [] };
}
/**
 * Check if filter state has any active filters.
 */
function hasActiveFilters(state) {
    return state.repos.length > 0 || state.teams.length > 0;
}
/**
 * Parse filter state from URL search params.
 * @param params - URL search params
 * @returns Parsed filter state
 */
function parseFiltersFromUrl(params) {
    const reposParam = params.get("repos");
    const teamsParam = params.get("teams");
    return {
        repos: reposParam ? reposParam.split(",").filter((v) => v.trim()) : [],
        teams: teamsParam ? teamsParam.split(",").filter((v) => v.trim()) : [],
    };
}
/**
 * Serialize filter state to URL search params.
 * @param state - Filter state
 * @param params - Existing URL search params to update
 */
function serializeFiltersToUrl(state, params) {
    if (state.repos.length > 0) {
        params.set("repos", state.repos.join(","));
    }
    else {
        params.delete("repos");
    }
    if (state.teams.length > 0) {
        params.set("teams", state.teams.join(","));
    }
    else {
        params.delete("teams");
    }
}
/**
 * Create HTML for a filter chip.
 * @param type - Filter type (repo or team)
 * @param value - Filter value
 * @param label - Display label
 * @returns HTML string for the chip
 */
function createFilterChipHtml(type, value, label) {
    const prefix = type === "repo" ? "repo" : "team";
    const escapedLabel = (0, shared_1.escapeHtml)(label);
    const escapedValue = (0, shared_1.escapeHtml)(value);
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
function renderFilterChipsHtml(state, labelFn) {
    const chips = [];
    state.repos.forEach((value) => {
        chips.push(createFilterChipHtml("repo", value, labelFn("repo", value)));
    });
    state.teams.forEach((value) => {
        chips.push(createFilterChipHtml("team", value, labelFn("team", value)));
    });
    return chips.join("");
}
//# sourceMappingURL=filters.js.map