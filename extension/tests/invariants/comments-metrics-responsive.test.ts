/**
 * Issue #330 / C4 — comments-metrics grid CSS contract (desktop + narrow).
 *
 * The Feature 310 drill-down header + row grid is header-driven: track
 * widths are sized by the uppercase header-button content, not the
 * 1–3-digit count content.  At the original ``5ch / 6ch / 9ch``
 * measurements the proportional header labels overflowed their tracks
 * leftward and visually crashed into adjacent columns on the desktop
 * panel (not just at narrow viewports).  detail-panel.ts owns the DOM;
 * styles.css owns the layout; this test locks BOTH the desktop grid
 * template and the ``@media (max-width: 480px)`` override so any drift
 * on either side fails CI before it can ship.
 *
 * The second assertion block pins every selector inside the 480px
 * media blocks to the capability-on-only classes emitted by
 * renderPrListSection when commentsMetricsAvailable===true — capability-
 * off DOM has no comments-metrics header or numeric columns at all, so
 * this guard preserves SC-03 / INV-01 byte-identity by construction.
 *
 * Note: ``extension/tests/invariants/mobile-layout.test.ts`` extracts
 * only the FIRST ``@media (max-width: 480px)`` block via ``indexOf``;
 * the Feature 310 override lives in a later 480px block that helper
 * cannot see, which is why the narrow-viewport lock lives here.
 *
 * @module tests/invariants/comments-metrics-responsive.test.ts
 */

import { resolve } from "node:path";

import { readTextFile } from "../helpers/fs-test-utils";

const stylesPath = resolve(__dirname, "..", "..", "ui", "styles.css");
const stylesContent = readTextFile(stylesPath);

/**
 * Walk the CSS text and return the body of the first TOP-LEVEL rule
 * whose selector list contains ``selectorSubstring``.  "Top-level"
 * means the rule is NOT nested inside an @media / @supports / other
 * at-rule.  Uses a simple brace-depth walker — no complex regex — so
 * the implementation is safe under ``eslint-plugin-security``'s
 * detect-unsafe-regex rule and deterministic on arbitrary input.
 *
 * Returns ``null`` when no matching rule is found.
 */
function findTopLevelRuleBody(
  css: string,
  selectorSubstring: string,
): string | null {
  let i = 0;
  while (i < css.length) {
    const ch = css.charAt(i);
    // Skip whitespace cheaply — char-code comparison is both faster
    // and safe under security/detect-unsafe-regex.
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    // At-rule — fast-forward past its block so we never peek inside.
    if (ch === "@") {
      const braceStart = css.indexOf("{", i);
      if (braceStart === -1) return null;
      let depth = 1;
      let j = braceStart + 1;
      while (j < css.length && depth > 0) {
        const c = css.charAt(j);
        if (c === "{") depth++;
        else if (c === "}") depth--;
        j++;
      }
      i = j;
      continue;
    }
    // Regular rule: [selector-list] { [body] }.
    const braceStart = css.indexOf("{", i);
    if (braceStart === -1) return null;
    const selectorList = css.slice(i, braceStart);
    const braceEnd = css.indexOf("}", braceStart);
    if (braceEnd === -1) return null;
    if (selectorList.includes(selectorSubstring)) {
      return css.slice(braceStart + 1, braceEnd);
    }
    i = braceEnd + 1;
  }
  return null;
}

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

describe("issue #330 / C4 — comments-metrics grid CSS contract (desktop + narrow)", () => {
  const mobileBlocks = extractAllMobileMediaBlocks(stylesContent);

  it("locks the desktop and 480px comments-metrics grid templates under capability-on selectors", () => {
    // The header rule and the row rule MUST both declare the same
    // header-driven desktop track widths so header cells and their
    // count cells line up to the same column edges across the 12px-
    // header / 13px-row font-size gap.  rem is used instead of em so
    // both grid containers resolve to the same pixel widths regardless
    // of their own font-size.  The @media (max-width: 480px) override
    // narrows the same three tracks proportionally for narrow viewports;
    // all three sites move in lockstep.
    //
    // Current values (post-2026-04-25 PR #342 Ubuntu-fallback widening):
    // the prior ``3.5rem 4.25rem 5rem`` template was sized to the label
    // text alone, ignoring the button's ``::after`` sort indicator + gap
    // overhead — Codex caught this when reviewing a meaningless runtime
    // guard, and the corrected geometric guard
    // (extension/tests/smoke/comments-metrics-header-fit.smoke.ts) then
    // exposed 8–14 px overflow on every axis at the slimmed widths.
    // After re-fit on Windows Segoe UI ((4.25 / 5.125 / 5.625) rem), CI
    // on Ubuntu surfaced a second gap: Linux Chromium falls back to
    // DejaVu Sans / Liberation Sans, which renders "UNRESOLVED" ~1 px
    // wider than Windows Segoe UI — putting the desktop button 0.86 px
    // and narrow button 1.09 px past their cell rights.  The third
    // track on each rule was widened by ~4 px (0.25 rem) to fit the
    // wider Ubuntu-fallback rendering with a ≥3 px buffer.  See the
    // CSS comments on .detail-panel-pr-list-header for the full
    // cross-platform-fallback rationale.
    const desktopTemplatePattern =
      /grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+auto\s+4\.25rem\s+5\.125rem\s+5\.875rem/;

    // Desktop header rule.
    const headerBody = findTopLevelRuleBody(
      stylesContent,
      ".detail-panel-pr-list-header",
    );
    expect(headerBody).not.toBeNull();
    expect(desktopTemplatePattern.test(headerBody ?? "")).toBe(true);

    // Desktop row rule (scoped under the --with-comments modifier).
    const rowBody = findTopLevelRuleBody(
      stylesContent,
      ".detail-panel-pr-list--with-comments .detail-panel-pr-row",
    );
    expect(rowBody).not.toBeNull();
    expect(desktopTemplatePattern.test(rowBody ?? "")).toBe(true);

    // Narrow-viewport override: an @media (max-width: 480px) block
    // that includes BOTH the header selector and the row selector and
    // carries the proportionally-narrowed rem template.
    const narrowMatch = mobileBlocks.find(
      (body) =>
        body.includes(".detail-panel-pr-list-header") &&
        body.includes(".detail-panel-pr-list--with-comments") &&
        body.includes(".detail-panel-pr-row") &&
        /grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+auto\s+3\.75rem\s+4\.625rem\s+5\.25rem/.test(
          body,
        ),
    );
    expect(narrowMatch).toBeDefined();
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
