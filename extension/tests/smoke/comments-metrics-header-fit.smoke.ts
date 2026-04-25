/**
 * Comments-metrics header overflow runtime invariant
 * (#330 follow-up; lands together with the layout fix that recovers a
 * real ≥5px buffer between header buttons and their grid cells).
 *
 * The Feature 310 drill-down header uses fixed rem-based grid tracks sized
 * to the uppercase header-button content (THREADS / COMMENTS / UNRESOLVED).
 * The CSS-text invariant test
 * (`extension/tests/invariants/comments-metrics-responsive.test.ts`) locks
 * the desktop and 480px track template VALUES, but it is structurally
 * blind to font / letter-spacing / font-stack drift that would produce
 * overflow at those same nominal track widths.  jsdom cannot fill that
 * gap because it performs no layout — `getBoundingClientRect()` returns
 * a zero-rect there — so this guard MUST run in a real browser.
 *
 * Assertion (per axis: threads / comments / unresolved): the sort
 * `<button>` rect is geometrically contained within its `<div
 * role="columnheader">` grid-cell rect at desktop AND 480px-override
 * viewports — i.e. the button's left edge ≥ the cell's left edge AND
 * the button's right edge ≤ the cell's right edge (with a 0.5px
 * sub-pixel tolerance).
 *
 * Why containment, not `scrollWidth <= clientWidth` on the button: the
 * sort button is `display: inline-flex` and content-sized (no width:
 * 100%), so its `scrollWidth` and `clientWidth` are both equal to its
 * natural content width regardless of grid-cell width — that pair is
 * trivially satisfied even when the button visibly spills out of its
 * column.  The right-hand contract is geometric: the button's outer
 * rect must sit inside the cell's outer rect.  Codex stop-time review
 * caught the meaningless-assertion bug on 2026-04-25 and surfaced the
 * underlying overflow that this guard now locks against regression.
 *
 * If this test fails, the desktop or 480px grid template
 * (`extension/ui/styles.css` Feature 310 block) needs to be re-fitted
 * to its header-button content with a ≥5px buffer.  Do NOT relax this
 * assertion or change the header label text / casing.
 */
import { test, expect } from "@playwright/test";

import { SMOKE_TIMEOUT_MS } from "./constants";

const SAME_ORIGIN_HOST = "http://localhost:3000";

/** Sub-pixel tolerance for fractional layout pixel rounding in Chromium. */
const SUBPIXEL_TOLERANCE = 0.5;

interface HeaderFitMetric {
  readonly key: string;
  readonly text: string;
  readonly buttonLeft: number;
  readonly buttonRight: number;
  readonly cellLeft: number;
  readonly cellRight: number;
  readonly buttonWidth: number;
  readonly cellWidth: number;
}

const VIEWPORTS = [
  // Desktop: panel resolves to min(420px, 90vw) = 420px.  Engages the
  // top-level `.detail-panel-pr-list-header` rule with the desktop
  // numeric tracks at 12px font + 0.02em letter-spacing.
  { label: "desktop", width: 1280, height: 800 },
  // Narrow viewport: ≤480px engages the `@media (max-width: 480px)`
  // override at 11px font + no letter-spacing.  444px (90vw of ~493px)
  // ensures the panel itself narrows below 420px so the narrow override
  // carries the layout.
  { label: "narrow", width: 444, height: 800 },
] as const;

test.describe("comments-metrics header overflow runtime invariant", () => {
  for (const { label, width, height } of VIEWPORTS) {
    test(`sort buttons fit their grid cells at ${label} (${width}x${height})`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height });
      await page.goto(SAME_ORIGIN_HOST);

      await page
        .locator("#main-content:not(.hidden)")
        .waitFor({ timeout: SMOKE_TIMEOUT_MS });

      // The docs demo manifest at docs/data/dataset-manifest.json carries
      // `capabilities.comments_metrics: true` — opening any throughput
      // drill-down whose week has pr_count > 1 (the C5 single-row guard
      // from #330) renders the comments-metrics header.  The first bar
      // in the throughput chart is a stable target across demo
      // regenerations and is asserted to produce the header below.
      const bar = page.locator(".bar-container[data-drilldown-week]").first();
      await bar.waitFor({ timeout: SMOKE_TIMEOUT_MS });
      await bar.click();

      const panel = page.locator(".detail-panel.is-open");
      await expect(panel).toBeVisible({ timeout: SMOKE_TIMEOUT_MS });

      const header = page.locator(".detail-panel-pr-list-header");
      await expect(
        header,
        "comments-metrics header must render — if this fails, the demo's first throughput bar may have collapsed to a single-row week and a different fixture target is needed",
      ).toBeVisible({ timeout: SMOKE_TIMEOUT_MS });

      // Read button + cell rects atomically inside the page so both come
      // from a single layout pass.  Returning a small POJO array keeps
      // the failure output readable (label + measurements per axis)
      // instead of three independent assertions with no context.
      const metrics: HeaderFitMetric[] = await page.$$eval(
        "button.detail-panel-pr-list-header-sort",
        (btns) =>
          btns.map((b): HeaderFitMetric => {
            const cell = b.closest<HTMLElement>('[role="columnheader"]');
            if (cell === null) {
              throw new Error(
                "header sort button has no enclosing role=columnheader cell",
              );
            }
            const bRect = b.getBoundingClientRect();
            const cRect = cell.getBoundingClientRect();
            return {
              key: b.getAttribute("data-sort-key") ?? "",
              text: (b.textContent ?? "").trim(),
              buttonLeft: bRect.left,
              buttonRight: bRect.right,
              cellLeft: cRect.left,
              cellRight: cRect.right,
              buttonWidth: bRect.width,
              cellWidth: cRect.width,
            };
          }),
      );

      expect(
        metrics,
        "exactly three sort buttons (threads / comments / unresolved)",
      ).toHaveLength(3);

      // Sanity: a zero-rect would silently satisfy both edge checks.
      // Asserting positive widths up front makes a hidden / collapsed
      // header surface as a clear failure rather than a fake green.
      for (const m of metrics) {
        expect(
          m.cellWidth,
          `${m.key} cell has zero width — header may be hidden or collapsed`,
        ).toBeGreaterThan(0);
        expect(
          m.buttonWidth,
          `${m.key} button has zero width — sort button may not be rendered`,
        ).toBeGreaterThan(0);
      }

      // Geometric containment: the button's bounding rect must fit
      // within its grid-cell's bounding rect (with sub-pixel tolerance
      // for fractional rounding).  Two soft assertions per axis so a
      // single failure reports BOTH the left-edge and right-edge state
      // for that axis, plus the measurements for the other two.
      for (const m of metrics) {
        expect
          .soft(
            m.buttonRight,
            `${m.key} ("${m.text}") right-edge overflows cell: button=${m.buttonLeft.toFixed(2)}…${m.buttonRight.toFixed(2)} (w=${m.buttonWidth.toFixed(2)}) cell=${m.cellLeft.toFixed(2)}…${m.cellRight.toFixed(2)} (w=${m.cellWidth.toFixed(2)})`,
          )
          .toBeLessThanOrEqual(m.cellRight + SUBPIXEL_TOLERANCE);
        expect
          .soft(
            m.buttonLeft,
            `${m.key} ("${m.text}") left-edge spills before cell: button=${m.buttonLeft.toFixed(2)}…${m.buttonRight.toFixed(2)} (w=${m.buttonWidth.toFixed(2)}) cell=${m.cellLeft.toFixed(2)}…${m.cellRight.toFixed(2)} (w=${m.cellWidth.toFixed(2)})`,
          )
          .toBeGreaterThanOrEqual(m.cellLeft - SUBPIXEL_TOLERANCE);
      }

      await page.screenshot({
        path: testInfo.outputPath(`comments-metrics-header-fit-${label}.png`),
      });
    });
  }
});
