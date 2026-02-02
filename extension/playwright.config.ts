import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for smoke tests.
 *
 * Contract (from specs/021-spec-task-coverage-gaps/contracts/test-contracts.md):
 * - MUST use port 3000 for webServer (positive tests)
 * - MUST use port 3001 for broken-docs webServer (negative tests)
 * - MUST serve `../docs` directory for positive tests
 * - MUST serve `./tests/fixtures/broken-docs` for negative tests
 * - MUST capture screenshots on all runs
 * - MUST NOT retry (deterministic)
 * - MUST NOT run in parallel
 * - MUST output to `test-artifacts/smoke/` with per-project subdirs
 */
export default defineConfig({
  testDir: "./tests/smoke",

  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,

  reporter: [["html", { outputFolder: "playwright-report" }], ["list"]],

  use: {
    baseURL: "http://localhost:3000",
    screenshot: "on",
    trace: "retain-on-failure",
    headless: true,
  },

  outputDir: "test-artifacts/smoke",

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/*.smoke.ts",
      testIgnore: "**/negative-*.smoke.ts",
      outputDir: "test-artifacts/smoke/chromium",
    },
    {
      name: "chromium-negative",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:3001",
      },
      testMatch: "**/negative-*.smoke.ts",
      outputDir: "test-artifacts/smoke/chromium-negative",
    },
  ],

  webServer: [
    {
      command: "pnpm run serve:docs",
      port: 3000,
      reuseExistingServer: !process.env.CI,
      timeout: 10000,
    },
    {
      command: "pnpm run serve:broken",
      port: 3001,
      reuseExistingServer: !process.env.CI,
      timeout: 10000,
    },
  ],
});
