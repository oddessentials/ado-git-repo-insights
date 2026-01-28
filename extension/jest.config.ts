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
  // Coverage thresholds - start at current levels, plan to increase to 70%
  // See: specs/007-repo-standards-v7-compliance/plan.md for coverage gap analysis
  coverageThreshold: {
    global: {
      statements: 42,
      branches: 36,
      functions: 47,
      lines: 43,
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
