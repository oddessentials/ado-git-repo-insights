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
  // ============================================================================
  // Coverage Thresholds - Tiered Configuration
  // ============================================================================
  // Tier 1: Global baseline (relaxed for DOM-heavy modules without mocks)
  // Tier 2: Critical paths require higher coverage (schemas, core logic)
  //
  // IMPORTANT: Thresholds are set 1-2% below current coverage to prevent
  // regression while allowing for minor fluctuations. See COVERAGE_RATCHET.md
  // for the plan to incrementally increase these thresholds.
  //
  // See: specs/009-enterprise-coverage-upgrade for coverage target plan
  // See: COVERAGE_RATCHET.md for ratchet-up plan
  // Current global: ~55%, Target: 70% (Phase 6)
  // ============================================================================
  coverageThreshold: {
    // Tier 1: Global baseline - allows modules without DOM mocking
    // Current: ~50% stmts, ~45% branches, ~48% funcs, ~51% lines
    // Thresholds set 2% below current to prevent regression
    // Note: Global coverage differs from "All files" due to Jest calculation
    global: {
      statements: 48,
      branches: 43,
      functions: 46,
      lines: 49,
    },

    // Tier 2: Schema validators - core validation logic
    // Current lowest: 83% stmts, 76% branches, 12% funcs (index.ts), 84% lines
    // Note: index.ts is barrel file with low function coverage (re-exports)
    "ui/schemas/types.ts": {
      statements: 98,
      branches: 80,
      functions: 98,
      lines: 98,
    },
    "ui/schemas/errors.ts": {
      statements: 98,
      branches: 70,
      functions: 98,
      lines: 98,
    },
    "ui/schemas/rollup.schema.ts": {
      statements: 90,
      branches: 80,
      functions: 98,
      lines: 92,
    },

    // Tier 2: Dataset loader - core data loading logic
    // Current: 82% stmts, 80% branches, 75% funcs, 83% lines
    "ui/dataset-loader.ts": {
      statements: 80,
      branches: 78,
      functions: 73,
      lines: 81,
    },

    // Tier 2: Error handling utilities
    "ui/error-codes.ts": {
      statements: 98,
      branches: 85,
      functions: 98,
      lines: 98,
    },
    "ui/error-types.ts": {
      statements: 98,
      branches: 82,
      functions: 98,
      lines: 98,
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
