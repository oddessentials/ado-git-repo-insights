/**
 * Test Harness Contract
 *
 * This file defines the TypeScript interface contract for the shared test harness.
 * Implementation will be in extension/tests/harness/
 *
 * Feature: 009-schema-parity-testing
 */

// ============================================================================
// DOM Harness
// ============================================================================

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
 * Setup the shared DOM test harness.
 *
 * Creates a standard DOM structure with common elements:
 * - #app (root container)
 * - #loading-state
 * - #main-content
 * - #error-panel
 *
 * @param options - Configuration options
 */
export declare function setupDomHarness(options?: DomHarnessOptions): void;

/**
 * Teardown the DOM test harness.
 * Clears document.body and resets all mocks.
 */
export declare function teardownDomHarness(): void;

/**
 * Get a DOM element by ID with type assertion.
 * Throws if element not found.
 *
 * @param id - Element ID (without #)
 * @returns The element
 */
export declare function getElement<T extends HTMLElement>(id: string): T;

/**
 * Wait for DOM updates to settle.
 * Useful for testing async rendering.
 *
 * @param ms - Optional delay in milliseconds (default: 0)
 */
export declare function waitForDom(ms?: number): Promise<void>;

// ============================================================================
// VSS SDK Mocks
// ============================================================================

/**
 * Mock VSS web context.
 */
export interface MockWebContext {
  account: { name: string; id: string };
  project: { name: string; id: string };
  user: { name: string; id: string };
}

/**
 * Mock extension data service.
 */
export interface MockExtensionDataService {
  getValue: jest.Mock;
  setValue: jest.Mock;
  getDocument: jest.Mock;
  setDocument: jest.Mock;
  createDocument: jest.Mock;
  deleteDocument: jest.Mock;
}

/**
 * Mock build REST client.
 */
export interface MockBuildRestClient {
  getBuilds: jest.Mock;
  getBuild: jest.Mock;
  getArtifact: jest.Mock;
}

/**
 * VSS SDK mock allowlist.
 * Only these functions are mocked. Adding new mocks requires explicit approval.
 */
export interface VssSdkMocks {
  init: jest.Mock;
  ready: jest.Mock;
  notifyLoadSucceeded: jest.Mock;
  getWebContext: jest.Mock<MockWebContext>;
  getService: jest.Mock<Promise<MockExtensionDataService>>;
  require: jest.Mock;
  ServiceIds: { ExtensionData: string };
}

/**
 * Setup VSS SDK mocks with default values.
 * Attaches mocks to global.VSS.
 *
 * @returns The mock object for assertions
 */
export declare function setupVssMocks(): VssSdkMocks;

/**
 * Reset VSS SDK mocks to default state.
 */
export declare function resetVssMocks(): void;

/**
 * Configure mock web context for a specific test.
 *
 * @param context - Partial context to merge with defaults
 */
export declare function setMockWebContext(context: Partial<MockWebContext>): void;

/**
 * Configure mock extension data service responses.
 *
 * @param key - Setting key
 * @param value - Value to return when getValue is called
 */
export declare function setMockSettingValue(key: string, value: unknown): void;

// ============================================================================
// Fixture Loading
// ============================================================================

/**
 * Load a test fixture by name.
 *
 * @param name - Fixture name ("manifest", "dimensions", "rollup", "predictions")
 * @returns The fixture data
 */
export declare function loadFixture<T>(
  name: "manifest" | "dimensions" | "rollup" | "predictions"
): T;

/**
 * Load an extension artifact fixture (for parity testing).
 *
 * @param name - Artifact name
 * @returns The artifact data
 */
export declare function loadExtensionArtifact<T>(
  name: "manifest" | "dimensions" | "rollup" | "predictions"
): T;

/**
 * Setup fetch mocks for fixture data.
 *
 * @param fixtures - Which fixtures to mock
 */
export declare function setupFixtureMocks(
  fixtures: "manifest" | "dimensions" | "rollup" | "predictions" | "all"
): void;

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert that a DOM element has specific text content.
 *
 * @param id - Element ID
 * @param expected - Expected text content
 */
export declare function expectElementText(id: string, expected: string): void;

/**
 * Assert that a DOM element has specific class.
 *
 * @param id - Element ID
 * @param className - Expected class name
 */
export declare function expectElementClass(id: string, className: string): void;

/**
 * Assert that a DOM element is visible (not display: none).
 *
 * @param id - Element ID
 */
export declare function expectElementVisible(id: string): void;

/**
 * Assert that a DOM element is hidden (display: none).
 *
 * @param id - Element ID
 */
export declare function expectElementHidden(id: string): void;

// ============================================================================
// Skip Reason Tag
// ============================================================================

/**
 * Tag for documenting skip reasons.
 * Required by FR-012: any skipped test must have SKIP_REASON tag.
 *
 * Usage:
 * ```typescript
 * it.skip("test name", () => {
 *   // SKIP_REASON: Description of why this test is skipped
 * });
 * ```
 */
export const SKIP_REASON = Symbol("SKIP_REASON");
