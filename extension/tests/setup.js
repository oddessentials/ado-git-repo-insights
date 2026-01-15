/**
 * Jest setup file for extension UI tests.
 *
 * Provides global mocks for fetch and other browser APIs.
 */

// Mock fetch globally
global.fetch = jest.fn();

// Polyfill performance API for jsdom (missing mark/measure methods)
const performanceMarks = new Map();
let performanceMeasures = [];

if (!global.performance.mark) {
    global.performance.mark = (name) => {
        performanceMarks.set(name, global.performance.now());
    };
}

if (!global.performance.measure) {
    global.performance.measure = (name, startMark, endMark) => {
        const startTime = performanceMarks.get(startMark) || 0;
        const endTime = performanceMarks.get(endMark) || global.performance.now();
        performanceMeasures.push({ name, duration: endTime - startTime, entryType: 'measure' });
    };
}

if (!global.performance.getEntriesByName) {
    global.performance.getEntriesByName = (name, type) => {
        if (type === 'measure') {
            return performanceMeasures.filter(m => m.name === name);
        }
        return [];
    };
}

if (!global.performance.clearMarks) {
    global.performance.clearMarks = () => {
        performanceMarks.clear();
    };
}

if (!global.performance.clearMeasures) {
    global.performance.clearMeasures = () => {
        performanceMeasures = [];
    };
}

// Expose marks storage for test assertions
global.performance.marks = performanceMarks;

// Reset mocks before each test
beforeEach(() => {
    fetch.mockReset();
    // Reset performance state
    performanceMarks.clear();
    performanceMeasures = [];
});

// Mock console methods to reduce test noise (optional)
// Uncomment if tests are too noisy
// global.console.debug = jest.fn();
// global.console.log = jest.fn();

// Helper to create mock fetch responses
global.mockFetchResponse = (data, options = {}) => {
    const { status = 200, ok = true } = options;
    return Promise.resolve({
        ok,
        status,
        statusText: ok ? 'OK' : 'Error',
        json: () => Promise.resolve(data),
    });
};

// Helper to mock 404 response
global.mockFetch404 = () => {
    return Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
    });
};

// Helper to mock 401 response
global.mockFetch401 = () => {
    return Promise.resolve({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
    });
};

// Helper to mock 403 response
global.mockFetch403 = () => {
    return Promise.resolve({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
    });
};
