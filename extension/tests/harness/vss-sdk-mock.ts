/**
 * Azure DevOps Extension SDK Mock Harness
 *
 * Provides mock implementations for azure-devops-extension-sdk and
 * azure-devops-extension-api. All mock state is managed here.
 *
 * Test files opt in to mocking by calling jest.mock() with the exported
 * mock module shapes:
 *
 *   jest.mock("azure-devops-extension-sdk",
 *     () => require("../harness/vss-sdk-mock").mockSdkModule);
 *   jest.mock("azure-devops-extension-api",
 *     () => require("../harness/vss-sdk-mock").mockApiModule);
 *
 * Then import configuration helpers:
 *   import { setupSdkMocks, setMockWebContext, ... } from "../harness/vss-sdk-mock";
 *
 * Allowlist (SDK functions mocked):
 * - SDK.init()
 * - SDK.ready()
 * - SDK.notifyLoadSucceeded()
 * - SDK.getWebContext()
 * - SDK.getUser()
 * - SDK.getHost()
 * - SDK.getExtensionContext()
 * - SDK.getAccessToken()
 * - SDK.getAppToken()
 * - SDK.getService(CommonServiceIds.ExtensionDataService)
 * - getClient(CoreRestClient) from azure-devops-extension-api
 *
 * @module tests/harness/vss-sdk-mock
 */

import { jest } from "@jest/globals";

// ============================================================================
// Mock Types
// ============================================================================

export interface MockWebContext {
  project: { name: string; id: string };
  team: { name: string; id: string };
}

export interface MockUserContext {
  id: string;
  name: string;
  displayName: string;
  descriptor: string;
  imageUrl: string;
}

export interface MockHostContext {
  id: string;
  name: string;
  serviceVersion: string;
  type: number;
  isHosted: boolean;
}

export interface MockExtensionContext {
  id: string;
  publisherId: string;
  extensionId: string;
  version: string;
}

export interface MockExtensionDataManager {
  getValue: jest.Mock<(key: string, options?: unknown) => Promise<unknown>>;
  setValue: jest.Mock<(key: string, value: unknown) => Promise<unknown>>;
  getDocument: jest.Mock<
    (collection: string, id: string, options?: unknown) => Promise<unknown>
  >;
  setDocument: jest.Mock<
    (
      collection: string,
      doc: { id: string },
      options?: unknown,
    ) => Promise<{ id: string }>
  >;
  createDocument: jest.Mock<
    (
      collection: string,
      doc: { id: string },
      options?: unknown,
    ) => Promise<{ id: string }>
  >;
  deleteDocument: jest.Mock<
    (collection: string, id: string, options?: unknown) => Promise<void>
  >;
  getDocuments: jest.Mock<
    (collection: string, options?: unknown) => Promise<unknown[]>
  >;
  queryCollectionsByName: jest.Mock<
    (collectionNames: string[]) => Promise<unknown[]>
  >;
  queryCollections: jest.Mock<(collections: unknown[]) => Promise<unknown[]>>;
  updateDocument: jest.Mock<
    (
      collection: string,
      doc: { id: string },
      options?: unknown,
    ) => Promise<unknown>
  >;
}

export interface MockExtensionDataService {
  getExtensionDataManager: jest.Mock<
    (extensionId: string, accessToken: string) => Promise<MockExtensionDataManager>
  >;
}

export interface MockCoreRestClient {
  getProjects: jest.Mock;
}

// ============================================================================
// Deep Freeze Utility
// ============================================================================

function deepFreeze<T extends object>(obj: T): T {
  Object.freeze(obj);
  for (const value of Object.values(obj)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Object.isFrozen(value)
    ) {
      deepFreeze(value);
    }
  }
  return obj;
}

// ============================================================================
// Default Mock Values (immutable)
// ============================================================================

export const defaultMockWebContext: MockWebContext = deepFreeze({
  project: { name: "test-project", id: "proj-456" },
  team: { name: "Test Team", id: "team-001" },
});

export const defaultMockUserContext: MockUserContext = deepFreeze({
  id: "user-789",
  name: "Test User",
  displayName: "Test User",
  descriptor: "aad.dGVzdC11c2Vy",
  imageUrl: "https://dev.azure.com/_api/_common/identityImage?id=user-789",
});

export const defaultMockHostContext: MockHostContext = deepFreeze({
  id: "host-001",
  name: "test-org",
  serviceVersion: "dev",
  type: 4, // Organization
  isHosted: true,
});

export const defaultMockExtensionContext: MockExtensionContext = deepFreeze({
  id: "publisher.extension",
  publisherId: "publisher",
  extensionId: "extension",
  version: "1.0.0",
});

const DEFAULT_MOCK_ACCESS_TOKEN = "mock-access-token-12345";
const DEFAULT_MOCK_SERVICE_LOCATION = "https://dev.azure.com/test-org/";

// ============================================================================
// Mutable Mock State
// ============================================================================

let currentMockWebContext: MockWebContext = { ...defaultMockWebContext };
let currentMockUserContext: MockUserContext = { ...defaultMockUserContext };
let currentMockHostContext: MockHostContext = { ...defaultMockHostContext };
let currentMockExtensionContext: MockExtensionContext = {
  ...defaultMockExtensionContext,
};
let currentMockAccessToken: string = DEFAULT_MOCK_ACCESS_TOKEN;
let currentMockServiceLocation: string = DEFAULT_MOCK_SERVICE_LOCATION;

const mockSettingsStorage = new Map<string, unknown>();

// ============================================================================
// Singleton Mock Instances
// ============================================================================

let mockDataManager: MockExtensionDataManager | null = null;
let mockDataService: MockExtensionDataService | null = null;
let mockCoreClient: MockCoreRestClient | null = null;

export function createMockExtensionDataManager(): MockExtensionDataManager {
  return {
    getValue: jest.fn((key: string, _options?: unknown) =>
      Promise.resolve(mockSettingsStorage.get(key) ?? null),
    ),
    setValue: jest.fn((key: string, value: unknown) => {
      mockSettingsStorage.set(key, value);
      return Promise.resolve(value);
    }),
    getDocument: jest.fn(
      (collection: string, id: string, _options?: unknown) =>
        Promise.resolve(
          mockSettingsStorage.get(`${collection}:${id}`) ?? null,
        ),
    ),
    setDocument: jest.fn(
      (collection: string, doc: { id: string }, _options?: unknown) => {
        mockSettingsStorage.set(`${collection}:${doc.id}`, doc);
        return Promise.resolve(doc);
      },
    ),
    createDocument: jest.fn(
      (collection: string, doc: { id: string }, _options?: unknown) => {
        mockSettingsStorage.set(`${collection}:${doc.id}`, doc);
        return Promise.resolve(doc);
      },
    ),
    deleteDocument: jest.fn(
      (collection: string, id: string, _options?: unknown) => {
        mockSettingsStorage.delete(`${collection}:${id}`);
        return Promise.resolve();
      },
    ),
    getDocuments: jest.fn(
      (_collection: string, _options?: unknown) => Promise.resolve([]),
    ),
    queryCollectionsByName: jest.fn((_collectionNames: string[]) =>
      Promise.resolve([]),
    ),
    queryCollections: jest.fn((_collections: unknown[]) =>
      Promise.resolve([]),
    ),
    updateDocument: jest.fn(
      (collection: string, doc: { id: string }, _options?: unknown) => {
        mockSettingsStorage.set(`${collection}:${doc.id}`, doc);
        return Promise.resolve(doc);
      },
    ),
  };
}

export function getMockExtensionDataManager(): MockExtensionDataManager {
  if (!mockDataManager) {
    mockDataManager = createMockExtensionDataManager();
  }
  return mockDataManager;
}

function createMockExtensionDataService(): MockExtensionDataService {
  return {
    getExtensionDataManager: jest.fn(
      (_extensionId: string, _accessToken: string) =>
        Promise.resolve(getMockExtensionDataManager()),
    ),
  };
}

function getMockExtensionDataService(): MockExtensionDataService {
  if (!mockDataService) {
    mockDataService = createMockExtensionDataService();
  }
  return mockDataService;
}

export function createMockCoreRestClient(): MockCoreRestClient {
  return {
    getProjects: jest.fn(() =>
      Promise.resolve([
        { name: "test-project", id: "proj-456" },
        { name: "other-project", id: "proj-789" },
      ]),
    ),
  };
}

export function getMockCoreRestClient(): MockCoreRestClient {
  if (!mockCoreClient) {
    mockCoreClient = createMockCoreRestClient();
  }
  return mockCoreClient;
}

// ============================================================================
// Mock Location Service
// ============================================================================

export interface MockLocationService {
  getServiceLocation: jest.Mock<
    (serviceInstanceType?: string, hostType?: unknown) => Promise<string>
  >;
  getResourceAreaLocation: jest.Mock<
    (resourceAreaId: string) => Promise<string>
  >;
  routeUrl: jest.Mock<
    (
      routeId: string,
      routeValues?: Record<string, string>,
      hostPath?: string,
    ) => Promise<string>
  >;
}

let mockLocationService: MockLocationService | null = null;

function createMockLocationService(): MockLocationService {
  return {
    getServiceLocation: jest.fn(
      (_serviceInstanceType?: string, _hostType?: unknown) =>
        Promise.resolve(currentMockServiceLocation),
    ),
    getResourceAreaLocation: jest.fn((_resourceAreaId: string) =>
      Promise.resolve(currentMockServiceLocation),
    ),
    routeUrl: jest.fn(
      (
        _routeId: string,
        _routeValues?: Record<string, string>,
        _hostPath?: string,
      ) => Promise.resolve("/"),
    ),
  };
}

function getMockLocationService(): MockLocationService {
  if (!mockLocationService) {
    mockLocationService = createMockLocationService();
  }
  return mockLocationService;
}

// ============================================================================
// Mock Module: azure-devops-extension-sdk
// ============================================================================

/**
 * Use this as the factory for jest.mock("azure-devops-extension-sdk"):
 *
 *   jest.mock("azure-devops-extension-sdk",
 *     () => require("../harness/vss-sdk-mock").mockSdkModule);
 */
export const mockSdkModule = {
  init: jest.fn((_options?: unknown) => Promise.resolve()),
  ready: jest.fn(() => Promise.resolve()),
  notifyLoadSucceeded: jest.fn(() => Promise.resolve()),
  notifyLoadFailed: jest.fn((_e: unknown) => Promise.resolve()),
  getWebContext: jest.fn(() => currentMockWebContext),
  getUser: jest.fn(() => currentMockUserContext),
  getHost: jest.fn(() => currentMockHostContext),
  getExtensionContext: jest.fn(() => currentMockExtensionContext),
  getAccessToken: jest.fn(() => Promise.resolve(currentMockAccessToken)),
  getAppToken: jest.fn(() => Promise.resolve("mock-app-token")),
  getTeamContext: jest.fn(() => currentMockWebContext.team),
  getService: jest.fn((contributionId: string): Promise<unknown> => {
    if (
      contributionId === "ms.vss-features.extension-data-service"
    ) {
      return Promise.resolve(getMockExtensionDataService());
    }
    if (contributionId === "ms.vss-features.location-service") {
      return Promise.resolve(getMockLocationService());
    }
    return Promise.reject(
      new Error(`Unknown service: ${contributionId}`),
    );
  }),
  getConfiguration: jest.fn(() => ({})),
  getContributionId: jest.fn(() => "publisher.extension.contribution"),
  register: jest.fn(),
  unregister: jest.fn(),
  resize: jest.fn(),
  applyTheme: jest.fn(),
  getPageContext: jest.fn(() => ({
    globalization: {},
    timeZonesConfiguration: {},
    webContext: currentMockWebContext,
  })),
  sdkVersion: 4.2,
};

// ============================================================================
// Mock Module: azure-devops-extension-api
// ============================================================================

/**
 * Use this as the factory for jest.mock("azure-devops-extension-api"):
 *
 *   jest.mock("azure-devops-extension-api",
 *     () => require("../harness/vss-sdk-mock").mockApiModule);
 */
export const mockApiModule = {
  CommonServiceIds: {
    ExtensionDataService: "ms.vss-features.extension-data-service",
    LocationService: "ms.vss-features.location-service",
    GlobalMessagesService: "ms.vss-tfs-web.tfs-global-messages-service",
    HostNavigationService: "ms.vss-features.host-navigation-service",
    HostPageLayoutService: "ms.vss-features.host-page-layout-service",
    ProjectPageService: "ms.vss-tfs-web.tfs-page-data-service",
  },
  getClient: jest.fn((_clientClass: unknown) => getMockCoreRestClient()),
};

// ============================================================================
// Setup / Reset / Teardown
// ============================================================================

/**
 * Setup SDK mocks with default values.
 * Call in beforeEach() to ensure clean state.
 */
export function setupSdkMocks(): void {
  resetSdkMocks();
}

/**
 * Reset all mock state to defaults.
 */
export function resetSdkMocks(): void {
  currentMockWebContext = { ...defaultMockWebContext };
  currentMockUserContext = { ...defaultMockUserContext };
  currentMockHostContext = { ...defaultMockHostContext };
  currentMockExtensionContext = { ...defaultMockExtensionContext };
  currentMockAccessToken = DEFAULT_MOCK_ACCESS_TOKEN;
  currentMockServiceLocation = DEFAULT_MOCK_SERVICE_LOCATION;
  mockSettingsStorage.clear();

  // Reset singleton instances
  mockDataManager = null;
  mockDataService = null;
  mockCoreClient = null;
  mockLocationService = null;

  // Clear mock call histories
  for (const fn of Object.values(mockSdkModule)) {
    if (typeof fn === "function" && "mockClear" in fn) {
      (fn as jest.Mock).mockClear();
    }
  }
  for (const fn of Object.values(mockApiModule)) {
    if (typeof fn === "function" && "mockClear" in fn) {
      (fn as jest.Mock).mockClear();
    }
  }

  // Re-wire all mock implementations to use fresh state
  mockSdkModule.init.mockImplementation(
    (_options?: unknown) => Promise.resolve(),
  );
  mockSdkModule.ready.mockImplementation(() => Promise.resolve());
  mockSdkModule.notifyLoadSucceeded.mockImplementation(
    () => Promise.resolve(),
  );
  mockSdkModule.getWebContext.mockImplementation(() => currentMockWebContext);
  mockSdkModule.getUser.mockImplementation(() => currentMockUserContext);
  mockSdkModule.getHost.mockImplementation(() => currentMockHostContext);
  mockSdkModule.getExtensionContext.mockImplementation(
    () => currentMockExtensionContext,
  );
  mockSdkModule.getAccessToken.mockImplementation(() =>
    Promise.resolve(currentMockAccessToken),
  );
  mockSdkModule.getService.mockImplementation(
    (contributionId: string): Promise<unknown> => {
      if (contributionId === "ms.vss-features.extension-data-service") {
        return Promise.resolve(getMockExtensionDataService());
      }
      if (contributionId === "ms.vss-features.location-service") {
        return Promise.resolve(getMockLocationService());
      }
      return Promise.reject(new Error(`Unknown service: ${contributionId}`));
    },
  );
  mockApiModule.getClient.mockImplementation(
    (_clientClass: unknown) => getMockCoreRestClient(),
  );
}

/**
 * Teardown SDK mocks completely.
 */
export function teardownSdkMocks(): void {
  resetSdkMocks();
}

// ============================================================================
// Configuration Helpers
// ============================================================================

export function setMockWebContext(
  context: Partial<{
    project: Partial<{ name: string; id: string }>;
    team: Partial<{ name: string; id: string }>;
  }>,
): void {
  currentMockWebContext = {
    project: {
      ...defaultMockWebContext.project,
      ...context.project,
    },
    team: {
      ...defaultMockWebContext.team,
      ...context.team,
    },
  };
}

export function getMockWebContext(): MockWebContext {
  return { ...currentMockWebContext };
}

export function setMockUserContext(
  context: Partial<MockUserContext>,
): void {
  currentMockUserContext = { ...defaultMockUserContext, ...context };
}

export function setMockHostContext(
  context: Partial<MockHostContext>,
): void {
  currentMockHostContext = { ...defaultMockHostContext, ...context };
}

export function setMockAccessToken(token: string): void {
  currentMockAccessToken = token;
}

export function setMockServiceLocation(location: string): void {
  currentMockServiceLocation = location;
}

export function setMockSettingValue(key: string, value: unknown): void {
  mockSettingsStorage.set(key, value);
}

export function getMockSettingValue(key: string): unknown {
  return mockSettingsStorage.get(key);
}

export function clearMockSettings(): void {
  mockSettingsStorage.clear();
}

// ============================================================================
// Advanced Configuration Helpers
// ============================================================================

export function setMockSettingError(key: string, error: Error): void {
  const manager = getMockExtensionDataManager();
  const originalImpl = manager.getValue.getMockImplementation();

  manager.getValue.mockImplementation(
    ((requestedKey: string, _options?: unknown) => {
      if (requestedKey === key) {
        return Promise.reject(error);
      }
      if (originalImpl) {
        return (originalImpl as (k: string, o?: unknown) => Promise<unknown>)(
          requestedKey,
        );
      }
      return Promise.resolve(mockSettingsStorage.get(requestedKey) ?? null);
    }) as (key: string, options?: unknown) => Promise<unknown>,
  );
}

export function setMockServiceError(
  serviceId: string,
  error: Error,
): void {
  const originalImpl = mockSdkModule.getService.getMockImplementation();

  mockSdkModule.getService.mockImplementation(
    (requestedId: string): Promise<unknown> => {
      if (requestedId === serviceId) {
        return Promise.reject(error);
      }
      if (originalImpl) {
        return originalImpl(requestedId);
      }
      return Promise.resolve(getMockExtensionDataService());
    },
  );
}

export function setMockReadyAsync(delayMs: number): void {
  mockSdkModule.ready.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      }),
  );
}

export function trackMockInitOptions(): () => unknown {
  let lastOptions: unknown = undefined;

  mockSdkModule.init.mockImplementation((options: unknown) => {
    lastOptions = options;
    return Promise.resolve();
  });

  return () => lastOptions;
}

// ============================================================================
// Build Client Helpers (preserved from old mock)
// ============================================================================

export function setMockBuilds(builds: unknown[]): void {
  // For tests that mock the build API via getClient
  const client = getMockCoreRestClient();
  (client as unknown as Record<string, jest.Mock>).getBuilds =
    jest.fn(() => Promise.resolve(builds));
}

export function setMockBuild(build: unknown): void {
  const client = getMockCoreRestClient();
  (client as unknown as Record<string, jest.Mock>).getBuild =
    jest.fn(() => Promise.resolve(build));
}

export function setMockArtifacts(artifacts: unknown[]): void {
  const client = getMockCoreRestClient();
  (client as unknown as Record<string, jest.Mock>).getArtifacts =
    jest.fn(() => Promise.resolve(artifacts));
}

// ============================================================================
// Settings Scenario Presets
// ============================================================================

export interface SettingsScenario {
  values?: Record<string, unknown>;
  missingKeys?: string[];
  errorKeys?: Record<string, Error>;
}

export function configureExtensionDataService(
  scenario: SettingsScenario,
): void {
  const { values = {}, missingKeys = [], errorKeys = {} } = scenario;

  clearMockSettings();

  for (const [key, value] of Object.entries(values)) {
    setMockSettingValue(key, value);
  }

  const manager = getMockExtensionDataManager();
  const errorKeyMap = new Map(Object.entries(errorKeys));

  manager.getValue.mockImplementation(
    ((settingKey: string, _options?: unknown) => {
      if (errorKeyMap.has(settingKey)) {
        return Promise.reject(errorKeyMap.get(settingKey));
      }
      if (missingKeys.includes(settingKey)) {
        return Promise.resolve(undefined);
      }
      const value = mockSettingsStorage.get(settingKey);
      return Promise.resolve(value ?? null);
    }) as (key: string, options?: unknown) => Promise<unknown>,
  );
}

export function mockValidDashboardSettings(): void {
  configureExtensionDataService({
    values: {
      "pr-insights-source-project": "test-project",
      "pr-insights-pipeline-id": 123,
      "pr-insights-artifact-name": "pr-insights-data",
    },
  });
}

export function mockMissingDashboardSettings(): void {
  configureExtensionDataService({
    missingKeys: [
      "pr-insights-source-project",
      "pr-insights-pipeline-id",
      "pr-insights-artifact-name",
    ],
  });
}

export function mockInvalidDashboardSettings(): void {
  configureExtensionDataService({
    values: {
      "pr-insights-source-project": "",
      "pr-insights-pipeline-id": -1,
    },
  });
}

export function mockDashboardSettingsError(
  errorMessage = "ExtensionData service unavailable",
): void {
  configureExtensionDataService({
    errorKeys: {
      "pr-insights-source-project": new Error(errorMessage),
      "pr-insights-pipeline-id": new Error(errorMessage),
      "pr-insights-artifact-name": new Error(errorMessage),
    },
  });
}
