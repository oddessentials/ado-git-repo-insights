import type { Config } from "jest";

/**
 * Jest configuration for ADO Git Repo Insights Extension UI tests.
 *
 * Configured for jsdom environment to test browser-based code.
 * Uses ts-jest for TypeScript support with relaxed settings for tests.
 */
const config: Config = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  testMatch: ["**/tests/**/*.test.ts"],
  verbose: true,
  collectCoverageFrom: ["ui/**/*.ts", "!ui/**/*.test.ts"],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov"],
  // Coverage thresholds - incremental progress toward 70% target
  // See: specs/009-enterprise-coverage-upgrade for coverage target plan
  // Current: ~44%, Target: 70% (requires DOM mocking for 0% coverage modules)
  coverageThreshold: {
    global: {
      statements: 43,
      branches: 38,
      functions: 50,
      lines: 44,
    },
  },
  // Mock fetch globally
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
  // Module name mapping for paths
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  // Transform TypeScript files with relaxed test config
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.test.json",
        useESM: false,
      },
    ],
  },
  // Ignore compiled output
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
};

export default config;
