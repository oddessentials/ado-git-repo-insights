/**
 * Mobile Layout Invariant Tests (FR-014, FR-030)
 *
 * Verifies that the JS MOBILE_BREAKPOINT constant stays coordinated
 * with CSS @media breakpoints in styles.css, and that DOM elements
 * produced by chart modules carry the classes targeted by mobile rules.
 */

import { resolve } from "node:path";
import { readTextFile } from "../helpers/fs-test-utils";
import { MOBILE_BREAKPOINT } from "../../ui/modules/shared/constants";
import { renderCycleDistribution } from "../../ui/modules/charts/cycle-time";
import { renderTruncationIndicator } from "../../ui/modules/shared/chart-layout";
import type { DistributionData } from "../../ui/types";

const stylesPath = resolve(__dirname, "..", "..", "ui", "styles.css");
const stylesContent = readTextFile(stylesPath);

/**
 * Extract the content of the @media (max-width: 480px) block from CSS.
 * Returns the text between the opening and closing braces (with nesting awareness).
 */
function extractMobileMediaBlock(css: string): string {
  const marker = `@media (max-width: ${MOBILE_BREAKPOINT}px)`;
  const start = css.indexOf(marker);
  if (start === -1) return "";
  const braceStart = css.indexOf("{", start);
  if (braceStart === -1) return "";
  let depth = 0;
  let end = braceStart;
  for (let i = braceStart; i < css.length; i++) {
    const ch = css.charAt(i);
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth === 0) {
      end = i;
      break;
    }
  }
  return css.slice(braceStart + 1, end);
}

describe("MOBILE_BREAKPOINT parity (FR-014)", () => {
  it("JS constant matches CSS @media max-width breakpoint", () => {
    const expected = `max-width: ${String(MOBILE_BREAKPOINT)}px`;
    expect(stylesContent).toContain(expected);
  });

  it("no stray 480px magic numbers outside @media rules", () => {
    const allMatches = stylesContent.match(/480px/g) ?? [];
    const mediaMatches = stylesContent.match(/@media[^{]*480px/g) ?? [];
    expect(allMatches.length).toBe(mediaMatches.length);
  });
});

describe("T042: Mobile distribution row stacking", () => {
  const mobileBlock = extractMobileMediaBlock(stylesContent);

  it("mobile CSS targets .dist-row with flex-direction: column", () => {
    expect(mobileBlock).toContain(".dist-row");
    expect(mobileBlock).toMatch(/\.dist-row[^}]*flex-direction:\s*column/);
  });

  it("rendered distribution rows have correct structure and classes", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const distributions: DistributionData[] = [
      {
        year: "2025",
        cycle_time_buckets: {
          "0-1h": 5,
          "1-4h": 10,
          "4-24h": 8,
          "1-3d": 3,
          "3-7d": 2,
          "7d+": 1,
        },
      },
    ];

    renderCycleDistribution(container, distributions);

    const rows = container.querySelectorAll(".dist-row");
    expect(rows.length).toBeGreaterThanOrEqual(1);

    // Verify each .dist-row has the expected child structure
    for (const row of rows) {
      expect(row.querySelector(".dist-label")).not.toBeNull();
      expect(row.querySelector(".dist-bar-bg")).not.toBeNull();
      expect(row.querySelector(".dist-value")).not.toBeNull();
    }

    // At least one row has a speed-category class (proves BUCKET_COLOR_MAP wiring)
    const coloredRows = container.querySelectorAll(
      ".dist-row.bucket-fast, .dist-row.bucket-moderate, .dist-row.bucket-slow",
    );
    expect(coloredRows.length).toBeGreaterThanOrEqual(1);

    document.body.removeChild(container);
  });
});

describe("T050: Mobile truncation banner", () => {
  const mobileBlock = extractMobileMediaBlock(stylesContent);

  it("mobile CSS targets .truncation-badge with block display and full width", () => {
    expect(mobileBlock).toContain(".truncation-badge");
    expect(mobileBlock).toMatch(/\.truncation[^}]*display:\s*block/);
    expect(mobileBlock).toMatch(/\.truncation[^}]*width:\s*100%/);
  });

  it("rendered truncation indicator has compound class and correct text", () => {
    const html = renderTruncationIndicator(true, 104);

    // Parse into DOM to verify structure
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const indicator = wrapper.querySelector(
      ".truncation-indicator.truncation-badge",
    );

    expect(indicator).not.toBeNull();
    expect(indicator!.textContent).toBe("Showing last 104 weeks");
  });

  it("no indicator rendered when not truncated", () => {
    const html = renderTruncationIndicator(false, 104);
    expect(html).toBe("");
  });
});
