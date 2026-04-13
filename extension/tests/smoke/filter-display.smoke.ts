/**
 * Smoke tests for filter display functionality.
 *
 * These tests validate that:
 * - The demo dashboard loads successfully
 * - Filters can be interacted with
 * - Total PRs displays a finite number after filtering
 *
 * Contract: Uses data-testid selectors only (FR-033, FR-034)
 * Artifact: Screenshots captured to test-artifacts/smoke/
 */
import { test, expect } from "@playwright/test";
import * as _fsOriginal from "fs";
function _loadFs(): typeof _fsOriginal {
  return _fsOriginal;
}
const _fs = _loadFs();
import * as path from "path";
import { SMOKE_TIMEOUT_MS } from "./constants";

/**
 * Minimum fixture schema contract (FR-006):
 * The dataset-manifest.json must have:
 * - aggregate_index.weekly_rollups array with at least 1 element
 * - Each element must have path and pr_count
 */
interface ManifestFixture {
  aggregate_index: {
    weekly_rollups: Array<{
      path: string;
      pr_count: number;
      week: string;
    }>;
  };
  aggregates_schema_version: number;
  coverage: {
    total_prs: number;
  };
}

test.describe("Filter Display Smoke Tests", () => {
  /**
   * T038: Fixture validation (FR-035)
   * Validates dataset-manifest.json exists and matches minimum schema before browser tests run.
   */
  test.beforeAll(async () => {
    const fixturePath = path.resolve(
      __dirname,
      "../../../docs/data/dataset-manifest.json",
    );

    // Validate fixture exists
    expect(
      _fs.existsSync(fixturePath),
      `Fixture not found at ${fixturePath}. Ensure docs/data/dataset-manifest.json exists.`,
    ).toBe(true);

    // Parse and validate minimum schema
    const content = _fs.readFileSync(fixturePath, "utf-8");
    let manifest: ManifestFixture;
    try {
      manifest = JSON.parse(content);
    } catch (error) {
      const wrappedError = new Error(`Invalid JSON in fixture: ${error}`);
      (wrappedError as Error & { cause?: unknown }).cause = error;
      throw wrappedError;
    }

    // Validate required fields
    expect(
      manifest.aggregate_index,
      "Fixture missing aggregate_index",
    ).toBeDefined();

    expect(
      manifest.aggregate_index.weekly_rollups,
      "Fixture missing aggregate_index.weekly_rollups",
    ).toBeDefined();

    expect(
      Array.isArray(manifest.aggregate_index.weekly_rollups),
      "aggregate_index.weekly_rollups must be an array",
    ).toBe(true);

    expect(
      manifest.aggregate_index.weekly_rollups.length,
      "aggregate_index.weekly_rollups must have at least 1 element",
    ).toBeGreaterThan(0);

    // Validate first weekly rollup has required fields
    const firstRollup = manifest.aggregate_index.weekly_rollups[0]!;
    expect(firstRollup.path, "First weekly rollup missing path").toBeDefined();

    expect(
      typeof firstRollup.pr_count,
      "First weekly rollup pr_count must be a number",
    ).toBe("number");

    expect(firstRollup.week, "First weekly rollup missing week").toBeDefined();

    // Validate coverage
    expect(
      manifest.coverage?.total_prs,
      "Fixture missing coverage.total_prs",
    ).toBeDefined();

    expect(
      typeof manifest.coverage.total_prs,
      "coverage.total_prs must be a number",
    ).toBe("number");
  });

  /**
   * T039: Repository filter smoke test (FR-009, FR-022)
   * Validates that selecting a repository filter updates the Total PRs display.
   */
  test("repository filter shows numeric Total PRs", async ({
    page,
  }, testInfo) => {
    // Navigate to the demo dashboard
    await page.goto("/");

    // Wait for the dashboard to load (main content visible, loading state hidden)
    await page.waitForSelector("#main-content:not(.hidden)", {
      timeout: SMOKE_TIMEOUT_MS,
    });

    // Verify the Total PRs element exists and shows a number
    const totalPrsElement = page.getByTestId("total-prs");
    await expect(totalPrsElement).toBeVisible();

    // Get the initial value
    const initialText = await totalPrsElement.textContent();
    expect(initialText).not.toBe("-");
    expect(initialText).not.toBe("");

    // Verify it's a finite number
    const initialValue = parseInt(initialText?.replace(/,/g, "") || "0", 10);
    expect(Number.isFinite(initialValue)).toBe(true);
    expect(initialValue).toBeGreaterThan(0);

    // Interact with the repository filter (typeahead dropdown component)
    const repoFilter = page.getByTestId("filter-repository");
    await expect(repoFilter).toBeVisible();

    // Open the typeahead dropdown by clicking the input
    const repoInput = repoFilter.locator(".typeahead-input");
    await repoInput.click();

    // Get available options using stable role-based selectors (not DOM tag names)
    const options = await repoFilter.locator('[role="option"]').all();
    expect(options.length).toBeGreaterThan(0); // At least one repo option

    // Select a specific repository by clicking the first option
    if (options.length > 0) {
      // Capture prior text for change detection
      const priorText = await totalPrsElement.textContent();

      await options[0]!.click();

      // Wait for Total PRs to change from prior value (condition-based, not network-based)
      await expect(totalPrsElement).not.toHaveText(priorText ?? "", {
        timeout: SMOKE_TIMEOUT_MS,
      });

      // Wait for Total PRs to match digit pattern (settled state)
      await expect(totalPrsElement).toHaveText(/^\d[\d,]*$/, {
        timeout: SMOKE_TIMEOUT_MS,
      });

      // Capture screenshot after filter selection
      await page.screenshot({
        path: testInfo.outputPath("repository-filter.png"),
      });

      // Verify Total PRs is still a finite number after filtering
      const filteredText = await totalPrsElement.textContent();
      expect(filteredText).not.toBe("-");
      expect(filteredText).not.toBe("");

      const filteredValue = parseInt(
        filteredText?.replace(/,/g, "") || "0",
        10,
      );
      expect(Number.isFinite(filteredValue)).toBe(true);
    }
  });

  /**
   * T040: Team filter smoke test (FR-009, FR-022) [P - parallel]
   * Validates that selecting a team filter updates the Total PRs display.
   *
   * Note: The team filter may be hidden if the 'teams' feature is disabled
   * in the dataset-manifest.json (features.teams: false). In that case,
   * this test validates the feature flag behavior and skips filter interaction.
   */
  test("team filter shows numeric Total PRs", async ({ page }, testInfo) => {
    // Navigate to the demo dashboard
    await page.goto("/");

    // Wait for the dashboard to load
    await page.waitForSelector("#main-content:not(.hidden)", {
      timeout: SMOKE_TIMEOUT_MS,
    });

    // Verify the Total PRs element exists and shows a number
    const totalPrsElement = page.getByTestId("total-prs");
    await expect(totalPrsElement).toBeVisible();

    // Get the initial value
    const initialText = await totalPrsElement.textContent();
    expect(initialText).not.toBe("-");
    expect(initialText).not.toBe("");

    // Verify it's a finite number
    const initialValue = parseInt(initialText?.replace(/,/g, "") || "0", 10);
    expect(Number.isFinite(initialValue)).toBe(true);
    expect(initialValue).toBeGreaterThan(0);

    // Check if team filter is visible (depends on features.teams in manifest)
    // The team filter's parent container (#team-filter-group) may have .hidden class
    const teamFilterGroup = page.locator("#team-filter-group");
    const isTeamFilterVisible = await teamFilterGroup.evaluate((el) => {
      return (
        !el.classList.contains("hidden") &&
        window.getComputedStyle(el).display !== "none"
      );
    });

    if (!isTeamFilterVisible) {
      // Team filter is hidden due to feature flag - this is expected behavior
      // Capture screenshot showing the dashboard without team filter
      await page.screenshot({
        path: testInfo.outputPath("team-filter-disabled.png"),
      });

      // Verify the Total PRs is still valid (test passes - feature flag working correctly)
      expect(Number.isFinite(initialValue)).toBe(true);
      return;
    }

    // Team filter is visible - proceed with filter interaction test (typeahead)
    const teamFilter = page.getByTestId("filter-team");
    await expect(teamFilter).toBeVisible();

    // Open the typeahead dropdown by clicking the input
    const teamInput = teamFilter.locator(".typeahead-input");
    await teamInput.click();

    // Get available options using stable role-based selectors
    const options = await teamFilter.locator('[role="option"]').all();
    expect(options.length).toBeGreaterThanOrEqual(1); // At least one team

    // Select a specific team by clicking the first option
    if (options.length > 0) {
      // Capture prior text for change detection
      const priorText = await totalPrsElement.textContent();

      await options[0]!.click();

      // Wait for Total PRs to change from prior value (condition-based, not network-based)
      await expect(totalPrsElement).not.toHaveText(priorText ?? "", {
        timeout: SMOKE_TIMEOUT_MS,
      });

      // Wait for Total PRs to match digit pattern (settled state)
      await expect(totalPrsElement).toHaveText(/^\d[\d,]*$/, {
        timeout: SMOKE_TIMEOUT_MS,
      });

      // Capture screenshot after filter selection
      await page.screenshot({
        path: testInfo.outputPath("team-filter.png"),
      });

      // Verify Total PRs is still a finite number after filtering
      const filteredText = await totalPrsElement.textContent();
      expect(filteredText).not.toBe("-");
      expect(filteredText).not.toBe("");

      const filteredValue = parseInt(
        filteredText?.replace(/,/g, "") || "0",
        10,
      );
      expect(Number.isFinite(filteredValue)).toBe(true);
    } else {
      // If no team options, just verify the current state
      await page.screenshot({
        path: testInfo.outputPath("team-filter-default.png"),
      });
    }
  });
});
