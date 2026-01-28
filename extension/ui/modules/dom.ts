/**
 * DOM element caching and typed accessor.
 *
 * This module contains the SINGLE DOCUMENTED 'any' exception for the DOM cache.
 * The cache stores HTMLElements and NodeLists; use getElement<T>() for typed access.
 *
 * INVARIANT: No other module may use 'any' types. This is enforced by ESLint/tests.
 */

// Type for cached DOM elements - more specific than 'any'
type CachedDomValue = HTMLElement | NodeListOf<Element> | null;

const elements: Record<string, CachedDomValue> = {};

/**
 * Typed DOM element accessor.
 * Provides type-safe access to cached DOM elements.
 * @param id - Element ID from cache
 * @returns Typed element or null
 */
export function getElement<T extends HTMLElement = HTMLElement>(
  id: string,
): T | null {
  // eslint-disable-next-line security/detect-object-injection -- SECURITY: id is string parameter for DOM element lookup from cache
  const el = elements[id];
  if (el instanceof HTMLElement) {
    return el as T;
  }
  return null;
}

/**
 * Get a NodeList from the cache.
 */
export function getNodeList(id: string): NodeListOf<Element> | null {
  // eslint-disable-next-line security/detect-object-injection -- SECURITY: id is string parameter for DOM element lookup from cache
  const el = elements[id];
  if (el instanceof NodeList) {
    return el as NodeListOf<Element>;
  }
  return null;
}

/**
 * Cache a single element by ID.
 */
export function cacheElement(id: string): void {
  // eslint-disable-next-line security/detect-object-injection -- SECURITY: id is string parameter for storing DOM element reference
  elements[id] = document.getElementById(id);
}

/**
 * Cache DOM elements for performance.
 * Must be called during dashboard initialization.
 */
export function cacheElements(): void {
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
    "export-raw-zip",
  ];

  ids.forEach((id) => {
    // eslint-disable-next-line security/detect-object-injection -- SECURITY: id is from hardcoded array of DOM element IDs
    elements[id] = document.getElementById(id);
  });

  elements.tabs = document.querySelectorAll(".tab");
}

/**
 * Clear the element cache (useful for testing).
 */
export function clearElementCache(): void {
  Object.keys(elements).forEach((key) => {
    // eslint-disable-next-line security/detect-object-injection -- SECURITY: key is from Object.keys iteration over own properties
    delete elements[key];
  });
}
