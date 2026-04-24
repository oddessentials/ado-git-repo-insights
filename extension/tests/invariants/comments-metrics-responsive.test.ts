/**
 * Issue #330 / C4 — comments-metrics responsive CSS contract.
 *
 * The Feature 310 drill-down header + row grid is sized for the desktop
 * detail-panel (min(420px, 90vw)); below roughly 468px viewport width
 * the panel narrows and the 5ch / 6ch / 9ch numeric tracks start to
 * crowd the PR-link track.  detail-panel.ts owns the DOM; styles.css
 * owns the layout; this test asserts that styles.css carries a
 * narrow-viewport fallback scoped strictly to the capability-on-only
 * selectors so SC-03 / INV-01 capability-off byte-identity is preserved
 * by construction.
 *
 * The existing ``extension/tests/invariants/mobile-layout.test.ts``
 * extracts only the FIRST ``@media (max-width: 480px)`` block in
 * styles.css, so a new block appended after the Feature 310 section
 * would be invisible to that helper.  This file scans every 480px
 * block and locks the rules that belong to the comments-metrics grid.
 *
 * @module tests/invariants/comments-metrics-responsive.test.ts
 */

import { resolve } from "node:path";

import { readTextFile } from "../helpers/fs-test-utils";

const stylesPath = resolve(__dirname, "..", "..", "ui", "styles.css");
const stylesContent = readTextFile(stylesPath);

/**
 * Extract every ``@media (max-width: 480px)`` block body from CSS.
 * Returns the text between each block's opening and closing braces,
 * tracking nesting so a nested at-rule (if any) does not terminate the
 * scan early.
 */
function extractAllMobileMediaBlocks(css: string): string[] {
  const marker = "@media (max-width: 480px)";
  const blocks: string[] = [];
  let cursor = 0;
  while (cursor < css.length) {
    const start = css.indexOf(marker, cursor);
    if (start === -1) break;
    const braceStart = css.indexOf("{", start);
    if (braceStart === -1) break;
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
    blocks.push(css.slice(braceStart + 1, end));
    cursor = end + 1;
  }
  return blocks;
}

describe("issue #330 / C4 — comments-metrics narrow-viewport CSS contract", () => {
  const mobileBlocks = extractAllMobileMediaBlocks(stylesContent);

  it("one @media (max-width: 480px) block narrows the comments-metrics grid under capability-on selectors", () => {
    // At least one 480px block must carry the narrowed 5-track grid
    // template scoped under ``.detail-panel-pr-list-header`` AND the
    // ``.detail-panel-pr-list--with-comments .detail-panel-pr-row``
    // pair.  The exact narrowed template is locked so an accidental
    // revert to the desktop ``5ch 6ch 9ch`` template (or a drift to an
    // incompatible track set) fails CI.
    const match = mobileBlocks.find(
      (body) =>
        body.includes(".detail-panel-pr-list-header") &&
        body.includes(".detail-panel-pr-list--with-comments") &&
        body.includes(".detail-panel-pr-row") &&
        /grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+auto\s+4ch\s+5ch\s+7ch/.test(
          body,
        ),
    );
    expect(match).toBeDefined();
  });

  it("the comments-metrics 480px rules are scoped strictly to capability-on selectors (SC-03 byte-identity guard)", () => {
    // Gather every selector inside a 480px block that touches a
    // ``detail-panel-pr-*`` identifier; each such selector MUST include
    // one of the two capability-on-only classes emitted by
    // renderPrListSection when commentsMetricsAvailable===true.  A bare
    // ``.detail-panel-pr-row`` or ``.detail-panel-pr-list`` selector
    // would reach the capability-off DOM and break the committed
    // byte-identical baseline.
    for (const body of mobileBlocks) {
      // Iterate over selector lists (comma-separated, terminated by the
      // opening brace of a declaration block).  A minimal tokenizer
      // suffices: strip comments, then split on ``}`` to get each
      // rule, then take the selector list before the ``{``.
      const commentStripped = body.replace(/\/\*[\s\S]*?\*\//g, "");
      const rules = commentStripped.split("}");
      for (const rule of rules) {
        const braceIdx = rule.indexOf("{");
        if (braceIdx === -1) continue;
        const selectorList = rule.slice(0, braceIdx);
        for (const rawSelector of selectorList.split(",")) {
          const selector = rawSelector.trim();
          if (selector === "") continue;
          if (!selector.includes("detail-panel-pr")) continue;
          const isCapabilityOnScoped =
            selector.includes(".detail-panel-pr-list-header") ||
            selector.includes(".detail-panel-pr-list-filter") ||
            selector.includes(".detail-panel-pr-list--with-comments");
          expect({ selector, isCapabilityOnScoped }).toEqual({
            selector,
            isCapabilityOnScoped: true,
          });
        }
      }
    }
  });
});
