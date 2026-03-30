/**
 * Test Harness Module
 *
 * Barrel export for shared test harnesses.
 * Provides DOM harness and VSS SDK mocks for extension tests.
 *
 * @module tests/harness
 */

// DOM test harness
export type { DomHarnessOptions } from "./dom-harness";

export {
  setupDomHarness,
  teardownDomHarness,
  isHarnessSetup,
  getElement,
  queryElement,
  waitForDom,
  setupFixtureMocks,
  expectElementText,
  expectElementContainsText,
  expectElementClass,
  expectElementNotClass,
  expectElementVisible,
  expectElementHidden,
  clickElement,
  setInputValue,
} from "./dom-harness";

// Azure DevOps Extension SDK mocks
export type {
  MockWebContext,
  MockExtensionDataManager,
  MockExtensionDataService,
  MockCoreRestClient,
} from "./vss-sdk-mock";

export {
  defaultMockWebContext,
  createMockExtensionDataManager,
  createMockCoreRestClient,
  getMockExtensionDataManager,
  getMockCoreRestClient,
  setupSdkMocks,
  resetSdkMocks,
  teardownSdkMocks,
  setMockWebContext,
  getMockWebContext,
  setMockSettingValue,
  getMockSettingValue,
  clearMockSettings,
  mockSdkModule,
  mockApiModule,
} from "./vss-sdk-mock";
