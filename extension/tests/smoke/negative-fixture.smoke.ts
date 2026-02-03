/**
 * Negative smoke test: Verifies error handling for broken fixtures.
 *
 * This test PASSES when error UI is correctly displayed.
 * It FAILS (non-zero exit) when app does NOT show error state.
 *
 * The test is designed to be a gate: if error handling regresses,
 * the test fails and blocks the build.
 *
 * Contract: Uses data-testid selectors only (FR-022)
 * Fixture: ./tests/fixtures/broken-docs with malformed dataset-manifest.json
 */
import { test, expect } from "@playwright/test";
import { SMOKE_TIMEOUT_MS } from "./constants";

test.describe("Negative Smoke Tests - Error State Gate", () => {
  /**
   * Test that verifies error state is shown for malformed manifest.
   *
   * This test validates the error handling path:
   * 1. Dashboard loads with malformed JSON in dataset-manifest.json
   * 2. Error is caught and error state UI is displayed
   * 3. No "[object Object]" is shown (proper error message rendering)
   */
  test("shows error state for malformed manifest", async ({
    page,
  }, testInfo) => {
    await page.goto("/");

    // Gate assertion: Error state MUST be visible
    // Wait for either error panel to be visible (condition-based, not time-based)
    const errorSetup = page.getByTestId("error-setup-required");
    const errorGeneric = page.getByTestId("error-generic");

    // Wait for either error panel to become visible
    // Poll until one is visible rather than using .or() which has strict mode issues
    await expect
      .poll(
        async () => {
          const setupVis = await errorSetup.isVisible().catch(() => false);
          const genericVis = await errorGeneric.isVisible().catch(() => false);
          return setupVis || genericVis;
        },
        { timeout: SMOKE_TIMEOUT_MS },
      )
      .toBe(true);

    // At least one error panel must be visible
    const setupVisible = await errorSetup.isVisible().catch(() => false);
    const genericVisible = await errorGeneric.isVisible().catch(() => false);

    // Screenshot always captured (artifact on all paths)
    await page.screenshot({
      path: testInfo.outputPath("negative-malformed-manifest.png"),
    });

    // FAIL if no error state shown (regression in error handling)
    expect(
      setupVisible || genericVisible,
      "Expected error state to be visible for malformed manifest. " +
        "Neither error-setup-required nor error-generic panels are visible.",
    ).toBe(true);

    // FAIL if [object Object] displayed (regression in error message)
    const pageContent = await page.textContent("body");
    expect(pageContent).not.toContain("[object Object]");

    // Verify loading state is hidden (error state should replace it)
    const loadingState = page.locator("#loading-state");
    const loadingVisible = await loadingState.isVisible().catch(() => false);
    expect(
      loadingVisible,
      "Loading state should be hidden when error state is shown",
    ).toBe(false);
  });

  /**
   * Test that verifies error message is human-readable.
   *
   * The error message should not be empty and should provide
   * useful information about the failure.
   */
  test("error message is human-readable", async ({ page }, testInfo) => {
    await page.goto("/");

    // Find the error message element
    const errorGeneric = page.getByTestId("error-generic");
    const errorSetup = page.getByTestId("error-setup-required");

    // Wait for either error panel to become visible
    // Poll until one is visible rather than using .or() which has strict mode issues
    await expect
      .poll(
        async () => {
          const setupVis = await errorSetup.isVisible().catch(() => false);
          const genericVis = await errorGeneric.isVisible().catch(() => false);
          return setupVis || genericVis;
        },
        { timeout: SMOKE_TIMEOUT_MS },
      )
      .toBe(true);

    // Screenshot for debugging
    await page.screenshot({
      path: testInfo.outputPath("negative-error-message.png"),
    });

    // Check which error panel is visible
    const genericVisible = await errorGeneric.isVisible().catch(() => false);
    const setupVisible = await errorSetup.isVisible().catch(() => false);

    if (genericVisible) {
      // Check generic error message
      const errorMessage = page.locator("#error-message");
      const messageText = await errorMessage.textContent();

      expect(messageText).toBeTruthy();
      expect(messageText?.length).toBeGreaterThan(5);
      expect(messageText).not.toContain("[object Object]");
      expect(messageText).not.toContain("undefined");
    } else if (setupVisible) {
      // Check setup required message
      const setupMessage = page.locator("#setup-message");
      const messageText = await setupMessage.textContent();

      expect(messageText).toBeTruthy();
      expect(messageText?.length).toBeGreaterThan(5);
    } else {
      // Neither panel visible - fail the test
      expect.fail(
        "Expected either error-generic or error-setup-required to be visible",
      );
    }
  });
});
