/**
 * Jest configuration for ADO Git Repo Insights Extension UI tests.
 *
 * Configured for jsdom environment to test browser-based code.
 */
module.exports = {
    testEnvironment: 'jsdom',
    testMatch: ['**/tests/**/*.test.js'],
    verbose: true,
    collectCoverageFrom: [
        'ui/**/*.js',
        '!ui/**/*.test.js',
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov'],
    // Mock fetch globally
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
};
