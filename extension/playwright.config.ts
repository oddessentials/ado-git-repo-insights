import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for smoke tests.
 *
 * Contract (from specs/021-spec-task-coverage-gaps/contracts/test-contracts.md):
 * - MUST use port 3000 for webServer
 * - MUST serve `../docs` directory
 * - MUST capture screenshots on all runs
 * - MUST NOT retry (deterministic)
 * - MUST NOT run in parallel
 * - MUST output to `test-artifacts/smoke/`
 */
export default defineConfig({
  testDir: "./tests/smoke",
  testMatch: "**/*.smoke.ts",

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

  webServer: {
    command: "npx serve ../docs -l 3000 --no-clipboard",
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
