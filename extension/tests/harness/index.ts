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

// VSS SDK mocks
export type {
  MockWebContext,
  MockExtensionDataService,
  MockBuildRestClient,
  VssSdkMocks,
} from "./vss-sdk-mock";

export {
  defaultMockWebContext,
  createMockExtensionDataService,
  createMockBuildRestClient,
  getMockExtensionDataService,
  getMockBuildRestClient,
  setupVssMocks,
  resetVssMocks,
  teardownVssMocks,
  setMockWebContext,
  getMockWebContext,
  setMockSettingValue,
  getMockSettingValue,
  clearMockSettings,
  isVssMocksSetup,
} from "./vss-sdk-mock";
