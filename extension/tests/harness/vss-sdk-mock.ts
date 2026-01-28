/**
 * VSS SDK Mock Allowlist
 *
 * Enumerated list of exact VSS SDK functions used in the codebase.
 * Only these functions are mocked - additions require explicit approval.
 *
 * Allowlist (6 functions):
 * - VSS.init()
 * - VSS.ready()
 * - VSS.notifyLoadSucceeded()
 * - VSS.getWebContext()
 * - VSS.getService(ServiceIds.ExtensionData)
 * - VSS.require(["TFS/Build/RestClient"])
 *
 * @module tests/harness/vss-sdk-mock
 */

import { jest } from "@jest/globals";

// ============================================================================
// Mock Types
// ============================================================================

/**
 * Mock VSS web context.
 */
export interface MockWebContext {
  account: { name: string; id: string };
  project: { name: string; id: string };
  user: { name: string; id: string; email?: string };
  host?: { name: string; id: string };
  team?: { name: string; id: string };
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
  getDocuments: jest.Mock;
  queryCollections: jest.Mock;
}

/**
 * Mock build REST client.
 */
export interface MockBuildRestClient {
  getBuilds: jest.Mock;
  getBuild: jest.Mock;
  getArtifact: jest.Mock;
  getArtifacts: jest.Mock;
}

/**
 * VSS SDK mock structure.
 */
export interface VssSdkMocks {
  init: jest.Mock;
  ready: jest.Mock;
  notifyLoadSucceeded: jest.Mock;
  getWebContext: jest.Mock;
  getService: jest.Mock;
  require: jest.Mock;
  ServiceIds: { ExtensionData: string };
}

// ============================================================================
// Default Mock Values
// ============================================================================

/**
 * Default mock web context.
 */
export const defaultMockWebContext: MockWebContext = {
  account: { name: "test-org", id: "org-123" },
  project: { name: "test-project", id: "proj-456" },
  user: { name: "Test User", id: "user-789", email: "test@example.com" },
  host: { name: "dev.azure.com", id: "host-001" },
  team: { name: "Test Team", id: "team-001" },
};

/**
 * Current mock web context (can be modified via setMockWebContext).
 */
let currentMockWebContext: MockWebContext = { ...defaultMockWebContext };

/**
 * Mock settings storage (key-value pairs).
 */
const mockSettingsStorage = new Map<string, unknown>();

// ============================================================================
// Mock Implementations
// ============================================================================

/**
 * Create mock extension data service.
 */
export function createMockExtensionDataService(): MockExtensionDataService {
  return {
    getValue: jest.fn((key: string) => Promise.resolve(mockSettingsStorage.get(key) ?? null)),
    setValue: jest.fn((key: string, value: unknown) => {
      mockSettingsStorage.set(key, value);
      return Promise.resolve(value);
    }),
    getDocument: jest.fn((collection: string, id: string) =>
      Promise.resolve(mockSettingsStorage.get(`${collection}:${id}`) ?? null)
    ),
    setDocument: jest.fn((collection: string, doc: { id: string }) => {
      mockSettingsStorage.set(`${collection}:${doc.id}`, doc);
      return Promise.resolve(doc);
    }),
    createDocument: jest.fn((collection: string, doc: { id: string }) => {
      mockSettingsStorage.set(`${collection}:${doc.id}`, doc);
      return Promise.resolve(doc);
    }),
    deleteDocument: jest.fn((collection: string, id: string) => {
      mockSettingsStorage.delete(`${collection}:${id}`);
      return Promise.resolve();
    }),
    getDocuments: jest.fn(() => Promise.resolve([])),
    queryCollections: jest.fn(() => Promise.resolve([])),
  };
}

/**
 * Create mock build REST client.
 */
export function createMockBuildRestClient(): MockBuildRestClient {
  return {
    getBuilds: jest.fn(() => Promise.resolve([])),
    getBuild: jest.fn(() => Promise.resolve(null)),
    getArtifact: jest.fn(() => Promise.resolve(null)),
    getArtifacts: jest.fn(() => Promise.resolve([])),
  };
}

// Singleton instances
let mockExtensionDataService: MockExtensionDataService | null = null;
let mockBuildRestClient: MockBuildRestClient | null = null;

/**
 * Get or create mock extension data service.
 */
export function getMockExtensionDataService(): MockExtensionDataService {
  if (!mockExtensionDataService) {
    mockExtensionDataService = createMockExtensionDataService();
  }
  return mockExtensionDataService;
}

/**
 * Get or create mock build REST client.
 */
export function getMockBuildRestClient(): MockBuildRestClient {
  if (!mockBuildRestClient) {
    mockBuildRestClient = createMockBuildRestClient();
  }
  return mockBuildRestClient;
}

// ============================================================================
// Setup Functions
// ============================================================================

/**
 * Setup VSS SDK mocks with default values.
 * Attaches mocks to global.VSS.
 *
 * @returns The mock object for assertions
 */
export function setupVssMocks(): VssSdkMocks {
  const mocks: VssSdkMocks = {
    init: jest.fn(),
    ready: jest.fn((callback: () => void) => {
      // Execute callback immediately (synchronous for testing)
      callback();
    }),
    notifyLoadSucceeded: jest.fn(),
    getWebContext: jest.fn(() => currentMockWebContext),
    getService: jest.fn(() => Promise.resolve(getMockExtensionDataService())),
    require: jest.fn((deps: string[], callback: (...args: unknown[]) => void) => {
      // Simulate TFS/Build/RestClient require
      if (deps.includes("TFS/Build/RestClient")) {
        callback({ getClient: () => getMockBuildRestClient() });
      } else {
        callback();
      }
    }),
    ServiceIds: { ExtensionData: "ms.vss-features.extension-data-service" },
  };

  // Attach to global
  (global as unknown as { VSS: VssSdkMocks }).VSS = mocks;

  return mocks;
}

/**
 * Reset VSS SDK mocks to default state.
 */
export function resetVssMocks(): void {
  currentMockWebContext = { ...defaultMockWebContext };
  mockSettingsStorage.clear();
  mockExtensionDataService = null;
  mockBuildRestClient = null;

  // Clear mock call histories
  const vss = (global as unknown as { VSS?: VssSdkMocks }).VSS;
  if (vss) {
    vss.init.mockClear();
    vss.ready.mockClear();
    vss.notifyLoadSucceeded.mockClear();
    vss.getWebContext.mockClear();
    vss.getService.mockClear();
    vss.require.mockClear();
  }
}

/**
 * Teardown VSS SDK mocks completely.
 */
export function teardownVssMocks(): void {
  resetVssMocks();
  delete (global as unknown as { VSS?: VssSdkMocks }).VSS;
}

// ============================================================================
// Configuration Helpers
// ============================================================================

/**
 * Configure mock web context for a specific test.
 *
 * @param context - Partial context to merge with defaults
 */
export function setMockWebContext(context: Partial<MockWebContext>): void {
  currentMockWebContext = {
    ...defaultMockWebContext,
    ...context,
    account: { ...defaultMockWebContext.account, ...context.account },
    project: { ...defaultMockWebContext.project, ...context.project },
    user: { ...defaultMockWebContext.user, ...context.user },
  };
}

/**
 * Get the current mock web context.
 */
export function getMockWebContext(): MockWebContext {
  return { ...currentMockWebContext };
}

/**
 * Configure mock extension data service responses.
 *
 * @param key - Setting key
 * @param value - Value to return when getValue is called
 */
export function setMockSettingValue(key: string, value: unknown): void {
  mockSettingsStorage.set(key, value);
}

/**
 * Get a mock setting value (for assertions).
 *
 * @param key - Setting key
 * @returns The stored value or undefined
 */
export function getMockSettingValue(key: string): unknown {
  return mockSettingsStorage.get(key);
}

/**
 * Clear all mock settings.
 */
export function clearMockSettings(): void {
  mockSettingsStorage.clear();
}

/**
 * Check if VSS SDK mocks are set up.
 */
export function isVssMocksSetup(): boolean {
  return !!(global as unknown as { VSS?: VssSdkMocks }).VSS;
}
