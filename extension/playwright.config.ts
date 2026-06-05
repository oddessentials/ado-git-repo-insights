import { defineConfig, devices } from "@playwright/test";

const smokeOutputDir =
  process.env["PLAYWRIGHT_OUTPUT_DIR"] ?? "test-artifacts/smoke";
const smokeReportDir =
  process.env["PLAYWRIGHT_REPORT_DIR"] ?? "playwright-report";

// Negative-test webServer port. Defaults to 3001 to preserve the original
// contract; overridable via PLAYWRIGHT_NEGATIVE_PORT for contributor hosts
// where 3001 is held by observability tooling (uptime-kuma etc.). Because
// `reuseExistingServer: !process.env.CI` is true locally, Playwright would
// otherwise silently bind tests against whatever owns localhost:3001 — a
// real defect surfaced during PR #416 preflight. CI never sets this env
// var, so the upstream contract (port 3001) is unchanged in CI.
const NEGATIVE_PORT_RAW = process.env["PLAYWRIGHT_NEGATIVE_PORT"];
const negativePort = Number(NEGATIVE_PORT_RAW ?? 3001);
if (
  !Number.isInteger(negativePort) ||
  negativePort <= 0 ||
  negativePort > 65535
) {
  throw new Error(
    `PLAYWRIGHT_NEGATIVE_PORT must be a TCP port in [1, 65535]; got ${JSON.stringify(NEGATIVE_PORT_RAW)}`,
  );
}

/**
 * Playwright configuration for smoke tests.
 *
 * Contract:
 * - MUST use port 3000 for webServer (positive tests)
 * - MUST use port 3001 for broken-docs webServer by default (negative tests);
 *   overridable on contributor machines via PLAYWRIGHT_NEGATIVE_PORT so the
 *   parity gate is reachable when 3001 is held by host observability tooling.
 *   CI does not set this env var; the 3001 default holds upstream.
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

  reporter: [["html", { outputFolder: smokeReportDir }], ["list"]],

  use: {
    baseURL: "http://localhost:3000",
    screenshot: "on",
    trace: "retain-on-failure",
    headless: true,
  },

  outputDir: smokeOutputDir,

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/*.smoke.ts",
      testIgnore: "**/negative-*.smoke.ts",
      outputDir: `${smokeOutputDir}/chromium`,
    },
    {
      name: "chromium-negative",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://localhost:${negativePort}`,
      },
      testMatch: "**/negative-*.smoke.ts",
      outputDir: `${smokeOutputDir}/chromium-negative`,
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
      // Direct `serve` invocation (not `pnpm run serve:broken`) so the
      // port is driven by the same `negativePort` resolution above. The
      // `serve:broken` package.json script is preserved unchanged as a
      // 3001-hardcoded manual-run alias.
      command: `pnpm exec serve ./tests/fixtures/broken-docs -l ${negativePort} --no-clipboard`,
      port: negativePort,
      reuseExistingServer: !process.env.CI,
      timeout: 10000,
    },
  ],
});
