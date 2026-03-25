/**
 * Jest setup file for extension UI tests.
 *
 * Provides global mocks for fetch and other browser APIs.
 */

import { jest } from "@jest/globals";
import { TextEncoder, TextDecoder } from "util";

// Polyfill TextEncoder/TextDecoder for jsdom (required by whatwg-url)
if (typeof global.TextEncoder === "undefined") {
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === "undefined") {
  global.TextDecoder = TextDecoder as typeof global.TextDecoder;
}

// Define types for global helpers
// Note: fetch is not re-declared here since it's now a built-in global in Node.js 18+
type MockFetchOptions = { status?: number; ok?: boolean };
type MockedFetch = jest.MockedFunction<typeof fetch>;
type MutablePerformance = Performance & {
  mark?: typeof performance.mark;
  measure?: typeof performance.measure;
  getEntriesByName?: typeof performance.getEntriesByName;
  clearMarks?: () => void;
  clearMeasures?: () => void;
  marks?: Map<string, number>;
};
type MeasureEntry = PerformanceEntry & {
  name: string;
  duration: number;
  entryType: string;
  startTime: number;
  toJSON: () => Record<string, unknown>;
};

declare global {
  var mockFetchResponse: (
    data: unknown,
    options?: MockFetchOptions,
  ) => Promise<Response>;
  var mockFetch404: () => Promise<Response>;
  var mockFetch401: () => Promise<Response>;
  var mockFetch403: () => Promise<Response>;

  interface Performance {
    marks?: Map<string, number>;
  }
}

const globalScope = global as typeof globalThis & {
  fetch: MockedFetch;
  performance: MutablePerformance;
};
const performanceScope = globalScope.performance as MutablePerformance;

// Mock fetch globally
globalScope.fetch = jest.fn() as unknown as MockedFetch;

// Polyfill performance API for jsdom (missing mark/measure methods)
const performanceMarks = new Map<string, number>();
let performanceMeasures: Array<{
  name: string;
  duration: number;
  entryType: string;
  startTime: number;
  toJSON: () => Record<string, unknown>;
}> = [];

if (!performanceScope.mark) {
  performanceScope.mark = ((name: string) => {
    const startTime = performanceScope.now();
    performanceMarks.set(name, startTime);
    return {
      name,
      entryType: "mark",
      startTime,
      duration: 0,
      toJSON: () => ({ name, entryType: "mark", startTime, duration: 0 }),
    } as PerformanceMark;
  }) as typeof performance.mark;
}

if (!performanceScope.measure) {
  performanceScope.measure = ((
    name: string,
    startMark: string,
    endMark: string,
  ) => {
    const startTime = performanceMarks.get(startMark) || 0;
    const endTime =
      performanceMarks.get(endMark) || performanceScope.now();
    const entry: MeasureEntry = {
      name,
      duration: endTime - startTime,
      entryType: "measure",
      startTime,
      toJSON: () => ({
        name,
        duration: endTime - startTime,
        entryType: "measure",
        startTime,
      }),
    };
    performanceMeasures.push(entry);
    return entry as PerformanceMeasure;
  }) as typeof performance.measure;
}

if (!performanceScope.getEntriesByName) {
  performanceScope.getEntriesByName = ((
    name: string,
    type: string,
  ) => {
    if (type === "measure") {
      return performanceMeasures.filter(
        (entry) => entry.name === name,
      ) as PerformanceEntryList;
    }
    return [] as PerformanceEntryList;
  }) as typeof performance.getEntriesByName;
}

if (!performanceScope.clearMarks) {
  performanceScope.clearMarks = () => {
    performanceMarks.clear();
  };
}

if (!performanceScope.clearMeasures) {
  performanceScope.clearMeasures = () => {
    performanceMeasures = [];
  };
}

// Expose marks storage for test assertions
performanceScope.marks = performanceMarks;

// Reset mocks before each test
beforeEach(() => {
  globalScope.fetch.mockReset();
  // Reset performance state
  performanceMarks.clear();
  performanceMeasures = [];
});

// Helper to create mock fetch responses
global.mockFetchResponse = (
  data: unknown,
  options: MockFetchOptions = {},
) => {
  const { status = 200, ok = true } = options;
  return Promise.resolve({
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: () => Promise.resolve(data),
  } as Response);
};

// Helper to mock 404 response
global.mockFetch404 = () => {
  return Promise.resolve({
    ok: false,
    status: 404,
    statusText: "Not Found",
  } as Response);
};

// Helper to mock 401 response
global.mockFetch401 = () => {
  return Promise.resolve({
    ok: false,
    status: 401,
    statusText: "Unauthorized",
  } as Response);
};

// Helper to mock 403 response
global.mockFetch403 = () => {
  return Promise.resolve({
    ok: false,
    status: 403,
    statusText: "Forbidden",
  } as Response);
};
