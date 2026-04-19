/**
 * Iframe drill-down smoke tests (PR #302 review — feature 059 sentinels).
 *
 * Runs the dashboard inside a parent page that wraps the docs/ build in an
 * iframe so that the cross-frame application contracts can be exercised.
 * Synthetic Jest tests cannot reach this surface — the install / dispose /
 * delegated-listener chain in `installSparklineNavigator` and friends only
 * runs against a real document inside a real iframe.
 *
 * Two iframe topologies are exercised so that any future iframe-origin
 * coupling regression in the navigator is caught:
 *
 *   - Same-origin: parent and iframe both at localhost:3000.
 *   - Cross-origin: parent at `127.0.0.1:3000`, iframe at `localhost:3000`
 *     — same `serve` instance answers both, but browser treats them as
 *     different origins under SOP. This is the closest reproduction of
 *     the production-ADO host topology (dev.azure.com hosting
 *     `*.gallerycdn.vsassets.io`).
 *
 * What these tests assert and what they do NOT assert (FR-050 coverage
 * shape — see `tests/reviews/059/p1b-cross-origin-investigation.md` for
 * the disposition path):
 *
 * - **Asserted (application contract, both halves of FR-050):**
 *   - The navigator calls `Element.prototype.scrollIntoView` on the
 *     correct target chart with `{ block: "center" }` (its documented
 *     scroll intent — verified via an in-frame spy installed before the
 *     dashboard loads).
 *   - The navigator adds the documented `is-sparkline-highlight` class
 *     to the target chart.
 *
 * - **NOT asserted (browser implementation outcome):** whether the host
 *   page or iframe ends up with a different scrollY. The CSSOM-View
 *   `scroll-an-element-into-view` algorithm's iframe-boundary behavior
 *   is ambiguous in spec and varies across browser versions; locking
 *   that here would tie CI to a browser quirk and produce false
 *   regression signals if the engine changes. The navigator's intent
 *   (the scrollIntoView call) is the application contract; the browser
 *   fulfilling that intent is a platform concern.
 *
 * Coverage in Slice 1:
 *   1. Same-origin sparkline tap — scrollIntoView intent + highlight class.
 *   2. Cross-origin sparkline tap — same contract, origin-agnostic.
 *   3. Filter-change dismisses an open detail panel (FR-008 sentinel for
 *      a11y P2-3 — locks current behavior so Slice 2 changes can be
 *      detected).
 *
 * Reserved for Slice 2 (added with the P1.D fix):
 *   4. Tab-reachability of cycle-time `<circle>` dots in real browsers.
 *
 * Contract: Uses data-testid + class selectors only. Screenshots captured
 * on every run per playwright.config.ts.
 */
import { test, expect } from "@playwright/test";
import { SMOKE_TIMEOUT_MS } from "./constants";

const SAME_ORIGIN_HOST = "http://localhost:3000";
const CROSS_ORIGIN_HOST = "http://127.0.0.1:3000";

interface ScrollIntoViewCall {
  id: string;
  className: string;
  opts: unknown;
}

declare global {
  interface Window {
    __sparklineScrollCalls?: ScrollIntoViewCall[];
  }
}

const iframeHostHtml = (iframeSrc: string): string => `
<!doctype html>
<html>
  <head>
    <title>iframe drilldown host</title>
    <style>
      html, body { margin: 0; padding: 0; }
      #scroll-spacer { height: 1500px; background: #f0f0f0; }
      #dashboard-frame { display: block; width: 100%; height: 3000px; border: 0; }
    </style>
  </head>
  <body style="height: 5000px">
    <div id="scroll-spacer">spacer above</div>
    <iframe src="${iframeSrc}" id="dashboard-frame"></iframe>
  </body>
</html>
`;

/**
 * Install a spy on `Element.prototype.scrollIntoView` in every frame. Each
 * call is recorded on `window.__sparklineScrollCalls` with the target's id,
 * className, and opts. The original implementation is preserved so the
 * navigator's runtime behavior is unchanged.
 *
 * Runs via `page.addInitScript`, which fires in the parent AND any child
 * frames including cross-origin iframes — exactly what we need to catch
 * the navigator's call from inside the dashboard frame.
 */
const SPARKLINE_SCROLL_SPY = (): void => {
  window.__sparklineScrollCalls = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (
    this: Element,
    arg?: boolean | ScrollIntoViewOptions,
  ): void {
    window.__sparklineScrollCalls!.push({
      id: this.id,
      className: this.className,
      opts: arg ?? null,
    });
    return original.call(this, arg);
  };
};

test.describe("Iframe drill-down smoke tests", () => {
  test.beforeEach(async ({ page }) => {
    // Inject the scrollIntoView spy into every frame before navigation.
    await page.addInitScript(SPARKLINE_SCROLL_SPY);
  });

  test("(same-origin) sparkline tap calls scrollIntoView on target chart and adds highlight class", async ({
    page,
  }, testInfo) => {
    await page.goto(SAME_ORIGIN_HOST);
    await page.setContent(iframeHostHtml(SAME_ORIGIN_HOST));

    const frame = page.frameLocator("#dashboard-frame");
    const frameBody = frame.locator("body");
    await frame
      .locator("#main-content:not(.hidden)")
      .waitFor({ timeout: SMOKE_TIMEOUT_MS });

    const sparklineTrigger = frame
      .locator(
        '.sparkline-trigger[data-drilldown-target-chart="throughput"]',
      )
      .first();
    await sparklineTrigger.waitFor({ timeout: SMOKE_TIMEOUT_MS });

    const targetChart = frame.locator("#throughput-chart");
    await expect(targetChart).not.toHaveClass(/is-sparkline-highlight/);

    // dispatchEvent('click') bypasses Playwright's auto-scroll-into-view
    // stability behavior — auto-scroll would inject a competing
    // scrollIntoView call and confuse the spy.
    await sparklineTrigger.dispatchEvent("click");

    // FR-050 part 1: navigator called scrollIntoView on the target chart
    // with block:center. Locks application intent; browser response is a
    // separate concern.
    await expect
      .poll(
        () =>
          frameBody.evaluate(
            () => window.__sparklineScrollCalls ?? [],
          ),
        { timeout: SMOKE_TIMEOUT_MS },
      )
      .toContainEqual(
        expect.objectContaining({
          id: "throughput-chart",
          opts: expect.objectContaining({ block: "center" }),
        }),
      );

    // FR-050 part 2: navigator added the documented highlight class.
    await expect(targetChart).toHaveClass(/is-sparkline-highlight/, {
      timeout: SMOKE_TIMEOUT_MS,
    });

    await page.screenshot({
      path: testInfo.outputPath("iframe-sparkline-same-origin.png"),
    });
  });

  test("(cross-origin) sparkline tap calls scrollIntoView and highlights target regardless of iframe origin", async ({
    page,
  }, testInfo) => {
    await page.goto(CROSS_ORIGIN_HOST);
    await page.setContent(iframeHostHtml(SAME_ORIGIN_HOST));

    const frame = page.frameLocator("#dashboard-frame");
    const frameBody = frame.locator("body");
    await frame
      .locator("#main-content:not(.hidden)")
      .waitFor({ timeout: SMOKE_TIMEOUT_MS });

    const sparklineTrigger = frame
      .locator(
        '.sparkline-trigger[data-drilldown-target-chart="throughput"]',
      )
      .first();
    await sparklineTrigger.waitFor({ timeout: SMOKE_TIMEOUT_MS });

    const targetChart = frame.locator("#throughput-chart");
    await expect(targetChart).not.toHaveClass(/is-sparkline-highlight/);

    await sparklineTrigger.dispatchEvent("click");

    // Same FR-050 contract as the same-origin sentinel. Locks that the
    // navigator's documented scroll intent + visual cue are
    // origin-agnostic — if a future change couples either to same-origin
    // DOM access or to a host-specific SDK call, this test fires.
    await expect
      .poll(
        () =>
          frameBody.evaluate(
            () => window.__sparklineScrollCalls ?? [],
          ),
        { timeout: SMOKE_TIMEOUT_MS },
      )
      .toContainEqual(
        expect.objectContaining({
          id: "throughput-chart",
          opts: expect.objectContaining({ block: "center" }),
        }),
      );

    await expect(targetChart).toHaveClass(/is-sparkline-highlight/, {
      timeout: SMOKE_TIMEOUT_MS,
    });

    await page.screenshot({
      path: testInfo.outputPath("iframe-sparkline-cross-origin.png"),
    });
  });

  test("filter change dismisses an open detail panel (FR-008 sentinel)", async ({
    page,
  }, testInfo) => {
    await page.goto(SAME_ORIGIN_HOST);
    await page.setContent(iframeHostHtml(SAME_ORIGIN_HOST));

    const frame = page.frameLocator("#dashboard-frame");
    await frame
      .locator("#main-content:not(.hidden)")
      .waitFor({ timeout: SMOKE_TIMEOUT_MS });

    const throughputBar = frame
      .locator(".bar-container[data-drilldown-week]")
      .first();
    await throughputBar.waitFor({ timeout: SMOKE_TIMEOUT_MS });
    await throughputBar.click();

    const panel = frame.locator(".detail-panel.is-open");
    await expect(panel).toBeVisible({ timeout: SMOKE_TIMEOUT_MS });

    const repoFilter = frame.getByTestId("filter-repository");
    await repoFilter.locator(".typeahead-input").click();
    const options = await repoFilter.locator('[role="option"]').all();
    expect(options.length).toBeGreaterThan(0);
    await options[0]!.click();

    await page.screenshot({
      path: testInfo.outputPath("iframe-filter-change-dismiss.png"),
    });

    // Lifecycle-signals contract: FILTERS_CHANGED_EVENT triggers panel
    // dismiss synchronously. Pure application behavior, no browser
    // implementation dependency.
    await expect(panel).toBeHidden({ timeout: SMOKE_TIMEOUT_MS });
  });
});
