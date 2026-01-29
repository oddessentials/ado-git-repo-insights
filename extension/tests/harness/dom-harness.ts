/**
 * DOM Test Harness
 *
 * Single shared DOM test harness for testing modules that manipulate the DOM.
 * Per-test bespoke mocks are prohibited - use this shared harness instead.
 *
 * @module tests/harness/dom-harness
 */

import { jest } from "@jest/globals";

// ============================================================================
// Fixture Types
// ============================================================================

/**
 * Loaded fixture data structure.
 */
export interface LoadedFixtures {
  manifest?: unknown;
  dimensions?: unknown;
  rollup?: unknown;
  predictions?: unknown;
  legacyRollups?: Record<string, unknown>;
}

/**
 * Options for setting up the DOM test harness.
 */
export interface DomHarnessOptions {
  /**
   * Which fixture data to pre-load.
   * - "manifest": Load dataset-manifest.json
   * - "dimensions": Load dimensions.json
   * - "rollup": Load sample rollup
   * - "predictions": Load predictions.json
   * - "all": Load all fixtures
   * - undefined: No fixtures pre-loaded
   */
  fixtures?: "manifest" | "dimensions" | "rollup" | "predictions" | "all";

  /**
   * Whether to setup VSS SDK mocks.
   * Default: false
   */
  withVssSdk?: boolean;

  /**
   * Custom DOM structure override.
   * If not provided, uses default dashboard structure.
   */
  customDom?: string;
}

/**
 * Default dashboard DOM structure.
 */
const DEFAULT_DOM = `
<div id="app">
  <div id="loading-state" class="loading"></div>
  <div id="main-content" style="display: none;"></div>
  <div id="error-panel" style="display: none;"></div>
  <div id="date-range"></div>
  <div id="charts-container"></div>
  <div id="filters-container"></div>
  <div id="comparison-banner" style="display: none;"></div>
  <div id="export-menu" style="display: none;"></div>
</div>
`;

// Track harness state
let harnessSetup = false;

/**
 * Setup the shared DOM test harness.
 *
 * Creates a standard DOM structure with common elements:
 * - #app (root container)
 * - #loading-state
 * - #main-content
 * - #error-panel
 * - And other dashboard elements
 *
 * @param options - Configuration options
 */
export function setupDomHarness(options: DomHarnessOptions = {}): void {
  const { customDom, withVssSdk = false, fixtures } = options;

  // Set up DOM structure
  document.body.innerHTML = customDom || DEFAULT_DOM;

  // Setup VSS SDK mocks if requested
  if (withVssSdk) {
    // Lazy import to avoid circular dependencies
    const { setupVssMocks } = require("./vss-sdk-mock");
    setupVssMocks();
  }

  // Setup fixture mocks if requested
  if (fixtures) {
    setupFixtureMocks(fixtures);
  }

  harnessSetup = true;
}

/**
 * Teardown the DOM test harness.
 * Clears document.body and resets all mocks.
 */
export function teardownDomHarness(): void {
  document.body.innerHTML = "";
  jest.clearAllMocks();
  harnessSetup = false;
}

/**
 * Check if the harness is currently set up.
 */
export function isHarnessSetup(): boolean {
  return harnessSetup;
}

/**
 * Get a DOM element by ID with type assertion.
 * Throws if element not found.
 *
 * @param id - Element ID (without #)
 * @returns The element
 */
export function getElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(
      `Element with id '${id}' not found. Is the DOM harness set up?`,
    );
  }
  return element as T;
}

/**
 * Get a DOM element by ID, returning null if not found.
 *
 * @param id - Element ID (without #)
 * @returns The element or null
 */
export function queryElement<T extends HTMLElement = HTMLElement>(
  id: string,
): T | null {
  return document.getElementById(id) as T | null;
}

/**
 * Wait for DOM updates to settle.
 * Useful for testing async rendering.
 *
 * @param ms - Optional delay in milliseconds (default: 0)
 */
export function waitForDom(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Setup fetch mocks for fixture data.
 *
 * @param fixtures - Which fixtures to mock
 */
export function setupFixtureMocks(
  fixtures: "manifest" | "dimensions" | "rollup" | "predictions" | "all",
): void {
  const mockFetch = (global as unknown as { fetch: jest.Mock }).fetch;

  if (!mockFetch || typeof mockFetch.mockImplementation !== "function") {
    console.warn(
      "Fetch mock not available. Ensure tests/setup.ts is configured.",
    );
    return;
  }

  // Load fixture data
  const fixtureMap: Record<string, unknown> = {};

  if (fixtures === "manifest" || fixtures === "all") {
    try {
      fixtureMap[
        "dataset-manifest.json"
      ] = require("../fixtures/dataset-manifest.json");
    } catch {
      // Fixture not available
    }
  }

  if (fixtures === "dimensions" || fixtures === "all") {
    try {
      fixtureMap[
        "aggregates/dimensions.json"
      ] = require("../fixtures/aggregates/dimensions.json");
    } catch {
      // Fixture not available
    }
  }

  if (fixtures === "rollup" || fixtures === "all") {
    try {
      fixtureMap[
        "aggregates/weekly_rollups/2026-W02.json"
      ] = require("../fixtures/aggregates/weekly_rollups/2026-W02.json");
    } catch {
      // Fixture not available
    }
  }

  if (fixtures === "predictions" || fixtures === "all") {
    try {
      fixtureMap[
        "predictions/trends.json"
      ] = require("../fixtures/predictions/trends.json");
    } catch {
      // Fixture not available
    }
  }

  // Configure fetch mock to return fixtures
  mockFetch.mockImplementation((url: string) => {
    const filename = url.split("/").pop() || "";
    const matchingKey = Object.keys(fixtureMap).find(
      (key) => url.includes(key) || key.endsWith(filename),
    );

    if (matchingKey && fixtureMap[matchingKey]) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(fixtureMap[matchingKey]),
      } as Response);
    }

    return Promise.resolve({
      ok: false,
      status: 404,
      statusText: "Not Found",
    } as Response);
  });
}

// ============================================================================
// Direct Fixture Loading
// ============================================================================

/**
 * Load manifest fixture data directly.
 *
 * @param variant - "default" or "extension-artifacts"
 * @returns Manifest data or null if not found
 */
export function loadManifestFixture(
  variant: "default" | "extension-artifacts" = "default",
): unknown {
  try {
    if (variant === "extension-artifacts") {
      return require("../fixtures/extension-artifacts/dataset-manifest.json");
    }
    return require("../fixtures/dataset-manifest.json");
  } catch {
    return null;
  }
}

/**
 * Load dimensions fixture data directly.
 *
 * @param variant - "default" or "extension-artifacts"
 * @returns Dimensions data or null if not found
 */
export function loadDimensionsFixture(
  variant: "default" | "extension-artifacts" = "default",
): unknown {
  try {
    if (variant === "extension-artifacts") {
      return require("../fixtures/extension-artifacts/dimensions.json");
    }
    return require("../fixtures/aggregates/dimensions.json");
  } catch {
    return null;
  }
}

/**
 * Load weekly rollup fixture data directly.
 *
 * @param week - ISO week string (e.g., "2026-W02") or "default"
 * @returns Rollup data or null if not found
 */
export function loadRollupFixture(week: string = "2026-W02"): unknown {
  try {
    if (week === "2026-W03") {
      return require("../fixtures/extension-artifacts/2026-W03.json");
    }
    return require("../fixtures/aggregates/weekly_rollups/2026-W02.json");
  } catch {
    return null;
  }
}

/**
 * Load predictions fixture data directly.
 *
 * @param variant - "default" or "extension-artifacts"
 * @returns Predictions data or null if not found
 */
export function loadPredictionsFixture(
  variant: "default" | "extension-artifacts" = "default",
): unknown {
  try {
    if (variant === "extension-artifacts") {
      return require("../fixtures/extension-artifacts/predictions.json");
    }
    return require("../fixtures/predictions/trends.json");
  } catch {
    return null;
  }
}

/**
 * Load legacy rollup fixture data for backward compatibility testing.
 *
 * @param version - Legacy version ("v1.0", "v1.1", "v1.2")
 * @returns Legacy rollup data or null if not found
 */
export function loadLegacyRollupFixture(
  version: "v1.0" | "v1.1" | "v1.2",
): unknown {
  try {
    return require(`../fixtures/legacy-datasets/${version}-rollup.json`);
  } catch {
    return null;
  }
}

/**
 * Load all fixtures as a bundle.
 *
 * @returns Object containing all loaded fixtures
 */
export function loadAllFixtures(): LoadedFixtures {
  return {
    manifest: loadManifestFixture(),
    dimensions: loadDimensionsFixture(),
    rollup: loadRollupFixture(),
    predictions: loadPredictionsFixture(),
    legacyRollups: {
      "v1.0": loadLegacyRollupFixture("v1.0"),
      "v1.1": loadLegacyRollupFixture("v1.1"),
      "v1.2": loadLegacyRollupFixture("v1.2"),
    },
  };
}

/**
 * Create a mock fetch response for fixture data.
 *
 * @param data - Data to return
 * @param options - Response options
 * @returns Mock Response object
 */
export function createMockResponse(
  data: unknown,
  options: { ok?: boolean; status?: number; statusText?: string } = {},
): Response {
  const { ok = true, status = 200, statusText = "OK" } = options;
  return {
    ok,
    status,
    statusText,
    json: () => Promise.resolve(data),
  } as Response;
}

/**
 * Create a mock fetch error response.
 *
 * @param status - HTTP status code
 * @param statusText - Status text
 * @returns Mock Response object
 */
export function createMockErrorResponse(
  status: number,
  statusText: string,
): Response {
  return {
    ok: false,
    status,
    statusText,
    json: () => Promise.reject(new Error(`HTTP ${status}: ${statusText}`)),
  } as Response;
}

/**
 * Assert that a DOM element has specific text content.
 *
 * @param id - Element ID
 * @param expected - Expected text content
 */
export function expectElementText(id: string, expected: string): void {
  const element = getElement(id);
  expect(element.textContent).toBe(expected);
}

/**
 * Assert that a DOM element contains specific text.
 *
 * @param id - Element ID
 * @param expected - Expected text to contain
 */
export function expectElementContainsText(id: string, expected: string): void {
  const element = getElement(id);
  expect(element.textContent).toContain(expected);
}

/**
 * Assert that a DOM element has specific class.
 *
 * @param id - Element ID
 * @param className - Expected class name
 */
export function expectElementClass(id: string, className: string): void {
  const element = getElement(id);
  expect(element.classList.contains(className)).toBe(true);
}

/**
 * Assert that a DOM element does not have specific class.
 *
 * @param id - Element ID
 * @param className - Class name that should not be present
 */
export function expectElementNotClass(id: string, className: string): void {
  const element = getElement(id);
  expect(element.classList.contains(className)).toBe(false);
}

/**
 * Assert that a DOM element is visible (not display: none).
 *
 * @param id - Element ID
 */
export function expectElementVisible(id: string): void {
  const element = getElement(id);
  expect(element.style.display).not.toBe("none");
}

/**
 * Assert that a DOM element is hidden (display: none).
 *
 * @param id - Element ID
 */
export function expectElementHidden(id: string): void {
  const element = getElement(id);
  expect(element.style.display).toBe("none");
}

/**
 * Simulate a click event on an element.
 *
 * @param id - Element ID
 */
export function clickElement(id: string): void {
  const element = getElement(id);
  element.click();
}

/**
 * Set the value of an input element and dispatch change event.
 *
 * @param id - Element ID
 * @param value - Value to set
 */
export function setInputValue(id: string, value: string): void {
  const element = getElement<HTMLInputElement>(id);
  element.value = value;
  element.dispatchEvent(new Event("change", { bubbles: true }));
}
