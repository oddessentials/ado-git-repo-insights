/**
 * Jest setup file for extension UI tests.
 *
 * Provides global mocks for fetch and other browser APIs.
 */

// Mock fetch globally
global.fetch = jest.fn();

// Reset mocks before each test
beforeEach(() => {
    fetch.mockReset();
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
