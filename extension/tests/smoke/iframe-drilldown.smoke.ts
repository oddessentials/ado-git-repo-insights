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
 * Coverage:
 *   Slice 1:
 *     1. Same-origin sparkline tap — scrollIntoView intent + highlight class.
 *     2. Cross-origin sparkline tap — same contract, origin-agnostic.
 *     3. Filter-change dismisses an open detail panel (FR-008 sentinel for
 *        a11y P2-3 — locks current behavior so Slice 2 changes can be
 *        detected).
 *   Slice 2a (PR #302 P1.D + P1.E):
 *     4. Cycle-time `<g>` dot triggers accept programmatic focus in a real
 *        browser — covers WCAG 2.1.1 (Keyboard) for SVG triggers, where
 *        jsdom is structurally unable to verify SVG focusability.
 *     5. Bar / row / dot triggers carry parameterized aria-label content
 *        via the shared weekRangeForAria helper — locks the
 *        application-contract label shape.
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

  test("(same-origin) reviewer sparkline tap calls scrollIntoView on #reviewer-activity and adds highlight class", async ({
    page,
  }, testInfo) => {
    // Pivoted from throughput → reviewer post-#363 (LD-2 / FR-002 /
    // SC-005). The reviewer card is the only sparkline that still
    // preserves scroll-and-highlight; the other three (totalPrs,
    // cycleP50, cycleP90) open the period-scoped DetailPanel —
    // covered by the throughput-panel-open test below. The iframe
    // origin-coupling invariant the FR-050 tests originally guarded
    // is preserved on the reviewer surface, which is the only one
    // that still scrolls.
    await page.goto(SAME_ORIGIN_HOST);
    await page.setContent(iframeHostHtml(SAME_ORIGIN_HOST));

    const frame = page.frameLocator("#dashboard-frame");
    const frameBody = frame.locator("body");
    await frame
      .locator("#main-content:not(.hidden)")
      .waitFor({ timeout: SMOKE_TIMEOUT_MS });

    const sparklineTrigger = frame
      .locator('.sparkline-trigger[data-drilldown-target-chart="reviewer"]')
      .first();
    await sparklineTrigger.waitFor({ timeout: SMOKE_TIMEOUT_MS });

    const targetChart = frame.locator("#reviewer-activity");
    await expect(targetChart).not.toHaveClass(/is-sparkline-highlight/);

    // dispatchEvent('click') bypasses Playwright's auto-scroll-into-view
    // stability behavior — auto-scroll would inject a competing
    // scrollIntoView call and confuse the spy.
    await sparklineTrigger.dispatchEvent("click");

    // FR-002 / SC-005: reviewer-card scroll-and-highlight is the
    // post-#363 regression-lock contract. Locks application intent;
    // browser response is a separate concern.
    await expect
      .poll(
        () => frameBody.evaluate(() => window.__sparklineScrollCalls ?? []),
        { timeout: SMOKE_TIMEOUT_MS },
      )
      .toContainEqual(
        expect.objectContaining({
          id: "reviewer-activity",
          opts: expect.objectContaining({ block: "center" }),
        }),
      );

    // The documented highlight class lands on the reviewer-activity
    // chart container.
    await expect(targetChart).toHaveClass(/is-sparkline-highlight/, {
      timeout: SMOKE_TIMEOUT_MS,
    });

    await page.screenshot({
      path: testInfo.outputPath("iframe-sparkline-reviewer-same-origin.png"),
    });
  });

  test("(cross-origin) reviewer sparkline tap calls scrollIntoView and highlights target regardless of iframe origin", async ({
    page,
  }, testInfo) => {
    // Cross-origin variant of the reviewer-card scroll-and-highlight
    // contract. Locks that the navigator's documented scroll intent +
    // visual cue stay origin-agnostic on the surface that still
    // scrolls. If a future change couples scroll behavior to same-
    // origin DOM access or to a host-specific SDK call, this test
    // fires.
    await page.goto(CROSS_ORIGIN_HOST);
    await page.setContent(iframeHostHtml(SAME_ORIGIN_HOST));

    const frame = page.frameLocator("#dashboard-frame");
    const frameBody = frame.locator("body");
    await frame
      .locator("#main-content:not(.hidden)")
      .waitFor({ timeout: SMOKE_TIMEOUT_MS });

    const sparklineTrigger = frame
      .locator('.sparkline-trigger[data-drilldown-target-chart="reviewer"]')
      .first();
    await sparklineTrigger.waitFor({ timeout: SMOKE_TIMEOUT_MS });

    const targetChart = frame.locator("#reviewer-activity");
    await expect(targetChart).not.toHaveClass(/is-sparkline-highlight/);

    await sparklineTrigger.dispatchEvent("click");

    await expect
      .poll(
        () => frameBody.evaluate(() => window.__sparklineScrollCalls ?? []),
        { timeout: SMOKE_TIMEOUT_MS },
      )
      .toContainEqual(
        expect.objectContaining({
          id: "reviewer-activity",
          opts: expect.objectContaining({ block: "center" }),
        }),
      );

    await expect(targetChart).toHaveClass(/is-sparkline-highlight/, {
      timeout: SMOKE_TIMEOUT_MS,
    });

    await page.screenshot({
      path: testInfo.outputPath("iframe-sparkline-reviewer-cross-origin.png"),
    });
  });

  test("(post-#363) totalPrs sparkline tap opens the period-scoped DetailPanel and does NOT scroll the throughput chart", async ({
    page,
  }, testInfo) => {
    // FR-001 / LD-2 in-browser sentinel for the new behavior:
    // throughput / cycleP50 / cycleP90 sparkline taps open the shared
    // DetailPanel with a period-scoped PR list. They do NOT scroll
    // the target chart into view — that path is reserved for the
    // reviewer card (covered above). Companion to the unit-level
    // tests in tests/modules/drilldown/sparkline-navigator.test.ts;
    // this one runs in a real iframe + browser.
    await page.goto(SAME_ORIGIN_HOST);
    await page.setContent(iframeHostHtml(SAME_ORIGIN_HOST));

    const frame = page.frameLocator("#dashboard-frame");
    const frameBody = frame.locator("body");
    await frame
      .locator("#main-content:not(.hidden)")
      .waitFor({ timeout: SMOKE_TIMEOUT_MS });

    const throughputSparkline = frame
      .locator('.sparkline-trigger[data-drilldown-target-chart="throughput"]')
      .first();
    await throughputSparkline.waitFor({ timeout: SMOKE_TIMEOUT_MS });

    // No panel open before activation.
    const panel = frame.locator(".detail-panel.is-open");
    await expect(panel).toHaveCount(0);

    await throughputSparkline.dispatchEvent("click");

    // Panel opens with the period-scoped PR list (LD-1 union over the
    // active rollup window).
    await expect(panel).toBeVisible({ timeout: SMOKE_TIMEOUT_MS });

    // The navigator MUST NOT have scrolled the throughput chart on
    // this path — locks the LD-2 split that throughput / cycle-time
    // sparklines stop calling scrollIntoView post-#363.
    const scrollCalls = await frameBody.evaluate(
      () => window.__sparklineScrollCalls ?? [],
    );
    expect(
      scrollCalls.find((call) => call.id === "throughput-chart"),
    ).toBeUndefined();

    await page.screenshot({
      path: testInfo.outputPath("iframe-sparkline-totalprs-panel-open.png"),
    });
  });

  test("cycle-time <g> dot trigger accepts focus in a real browser (P1.D)", async ({
    page,
  }, testInfo) => {
    await page.goto(SAME_ORIGIN_HOST);
    await page.setContent(iframeHostHtml(SAME_ORIGIN_HOST));

    const frame = page.frameLocator("#dashboard-frame");
    await frame
      .locator("#main-content:not(.hidden)")
      .waitFor({ timeout: SMOKE_TIMEOUT_MS });

    // jsdom does not focus SVG elements regardless of tabindex. This
    // assertion is the load-bearing P1.D acceptance: the new <g
    // role="button" tabindex="0"> wrapper IS focusable in a real
    // browser. If a future browser quirk regresses this, the user can
    // no longer keyboard-reach cycle-time dots and SC-006 fails.
    const dot = frame
      .locator('g[role="button"][data-drilldown-metric="p50"]')
      .first();
    await dot.waitFor({ timeout: SMOKE_TIMEOUT_MS });
    await dot.focus();

    const isFocused = await dot.evaluate((el) => document.activeElement === el);
    expect(isFocused).toBe(true);

    await page.screenshot({
      path: testInfo.outputPath("iframe-cycle-time-g-focus.png"),
    });
  });

  test("trigger aria-labels carry weekRangeForAria-derived content (P1.E)", async ({
    page,
  }) => {
    await page.goto(SAME_ORIGIN_HOST);
    await page.setContent(iframeHostHtml(SAME_ORIGIN_HOST));

    const frame = page.frameLocator("#dashboard-frame");
    await frame
      .locator("#main-content:not(.hidden)")
      .waitFor({ timeout: SMOKE_TIMEOUT_MS });

    // Bar trigger: "Drill into week of <range>, <count> PR(s)".
    const barLabel = await frame
      .locator(".bar-container[data-drilldown-week]")
      .first()
      .getAttribute("aria-label");
    expect(barLabel).toMatch(/^Drill into week of .+ \d+ PR(s)?$/);

    // Cycle-time dot trigger: "Drill into P50 for week of <range>".
    const dotLabel = await frame
      .locator('g[role="button"][data-drilldown-metric="p50"]')
      .first()
      .getAttribute("aria-label");
    expect(dotLabel).toMatch(/^Drill into P50 for week of /);
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

    // Trigger the filter change via the Date Range <select> rather than
    // the Repository typeahead. Test intent is the FR-008 dismiss-path
    // invariant (FILTERS_CHANGED_EVENT closes an open panel), not
    // typeahead-click ergonomics. Date Range sits in the top-left of
    // the filter bar — a stable uncovered control at every supported
    // viewport, unlike the right-side filters whose typeahead inputs
    // can sit under the position:fixed detail panel when it is open
    // (the underlying geometric-cover concern is tracked in #303, out
    // of scope for #205 per maintainer call). The same signal path
    // fires via handleDateRangeChange → refreshMetrics →
    // publishFiltersChanged.
    const dateRange = frame.locator("#date-range");
    await dateRange.selectOption("30");

    await page.screenshot({
      path: testInfo.outputPath("iframe-filter-change-dismiss.png"),
    });

    // Lifecycle-signals contract: FILTERS_CHANGED_EVENT triggers panel
    // dismiss synchronously. Pure application behavior, no browser
    // implementation dependency.
    await expect(panel).toBeHidden({ timeout: SMOKE_TIMEOUT_MS });
  });

  test("panel offset lets a right-side filter stay actionable while open (#303)", async ({
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

    // Actionability BEFORE click — ties the test to the #303 geometry fix.
    // The Repository typeahead input sits in the right portion of the filter
    // bar and was previously covered by the panel at desktop viewports.
    // `click({ trial: true })` runs Playwright's full actionability chain
    // (visible, enabled, stable, receives events — i.e. not occluded) WITHOUT
    // performing the click. Trial-click succeeds only when the element is
    // actually reachable at the hit-point; a regression in the top-offset
    // would fail here.
    const repoTypeahead = frame
      .locator("#repo-filter input.typeahead-input")
      .first();
    await repoTypeahead.waitFor({ timeout: SMOKE_TIMEOUT_MS });
    await repoTypeahead.click({ trial: true, timeout: SMOKE_TIMEOUT_MS });

    await page.screenshot({
      path: testInfo.outputPath("iframe-panel-offset-actionable.png"),
    });

    // Real click now that actionability has been proven. This dismisses the
    // panel via the outside-click path (the typeahead is geometrically
    // outside the panel after the #303 fix).
    await repoTypeahead.click();
    await expect(panel).toBeHidden({ timeout: SMOKE_TIMEOUT_MS });
  });
});
