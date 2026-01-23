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
declare global {
  var mockFetchResponse: (
    data: any,
    options?: { status?: number; ok?: boolean },
  ) => Promise<any>;
  var mockFetch404: () => Promise<any>;
  var mockFetch401: () => Promise<any>;
  var mockFetch403: () => Promise<any>;

  interface Performance {
    marks?: Map<string, number>;
  }
}

// Mock fetch globally
(global as any).fetch = jest.fn();

// Polyfill performance API for jsdom (missing mark/measure methods)
const performanceMarks = new Map<string, number>();
let performanceMeasures: Array<{
  name: string;
  duration: number;
  entryType: string;
}> = [];

if (!(global.performance as any).mark) {
  (global.performance as any).mark = (name: string) => {
    performanceMarks.set(name, global.performance.now());
  };
}

if (!(global.performance as any).measure) {
  (global.performance as any).measure = (
    name: string,
    startMark: string,
    endMark: string,
  ) => {
    const startTime = performanceMarks.get(startMark) || 0;
    const endTime = performanceMarks.get(endMark) || global.performance.now();
    performanceMeasures.push({
      name,
      duration: endTime - startTime,
      entryType: "measure",
    });
  };
}

if (!(global.performance as any).getEntriesByName) {
  (global.performance as any).getEntriesByName = (
    name: string,
    type: string,
  ) => {
    if (type === "measure") {
      return performanceMeasures.filter((m) => m.name === name);
    }
    return [];
  };
}

if (!(global.performance as any).clearMarks) {
  (global.performance as any).clearMarks = () => {
    performanceMarks.clear();
  };
}

if (!(global.performance as any).clearMeasures) {
  (global.performance as any).clearMeasures = () => {
    performanceMeasures = [];
  };
}

// Expose marks storage for test assertions
(global.performance as any).marks = performanceMarks;

// Reset mocks before each test
beforeEach(() => {
  ((global as any).fetch as jest.Mock).mockReset();
  // Reset performance state
  performanceMarks.clear();
  performanceMeasures = [];
});

// Helper to create mock fetch responses
global.mockFetchResponse = (
  data: any,
  options: { status?: number; ok?: boolean } = {},
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
