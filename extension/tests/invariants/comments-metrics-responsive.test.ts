/**
 * Issue #330 / C4 + issue #342 — PR-list grid CSS contract (desktop + narrow).
 *
 * The drill-down PR list is a header-driven grid in two flavours:
 *
 *   - SHARED (capability-off + capability-on): a base 2-col template
 *     ``minmax(0, 1fr) auto`` on the bare ``.detail-panel-pr-list-header``
 *     and the bare ``.detail-panel-pr-list .detail-panel-pr-row`` selectors.
 *     This is what the post-#342 capability-off path renders — labels the
 *     previously-bare cycle-time span and aligns rows under the shared
 *     header.
 *   - CAPABILITY-ON ONLY: the 5-col template
 *     ``minmax(0, 1fr) auto 4.25rem 5.125rem 5.875rem`` (desktop) and
 *     ``minmax(0, 1fr) auto 3.75rem 4.625rem 5.25rem`` (480px override)
 *     on the ``--with-comments`` modifier selectors.  Track widths are
 *     sized by the uppercase header-button content (not the 1–3-digit
 *     count content) on the WIDER of Windows Segoe UI / Ubuntu Chromium
 *     fallback; the Playwright smoke runs on the CI Ubuntu runner.
 *
 * Reframed SC-03 contract (post-#342): capability-off carries the
 * shared header + bare row grid AND no comments-metrics surface — no
 * sort buttons, no comments-metric spans, no filter bar, no
 * ``--with-comments`` modifier classes anywhere.  The 5-column TRACK
 * TEMPLATE must therefore appear only under ``--with-comments``-scoped
 * selectors so capability-off rows never get the wrong column count;
 * other narrow-viewport tweaks (gap, padding, font-size) are shared.
 *
 * Note: ``extension/tests/invariants/mobile-layout.test.ts`` extracts
 * only the FIRST ``@media (max-width: 480px)`` block via ``indexOf``;
 * the PR-list override lives in a later 480px block that helper
 * cannot see, which is why the narrow-viewport lock lives here.
 *
 * @module tests/invariants/comments-metrics-responsive.test.ts
 */

import { resolve } from "node:path";

import { readTextFile } from "../helpers/fs-test-utils";

const stylesPath = resolve(__dirname, "..", "..", "ui", "styles.css");
// Strip CSS comments before walking — the selector-list slice in
// ``findTopLevelRuleBody`` would otherwise include the section's
// banner comment, which legitimately spells out class names like
// ``.detail-panel-pr-list-header--with-comments`` for documentation
// purposes.  Stripping at parse time keeps the walker's substring
// match anchored to actual selectors.
const stylesContent = readTextFile(stylesPath).replace(/\/\*[\s\S]*?\*\//g, "");

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

describe("issue #330 / C4 + issue #342 — PR-list grid CSS contract (desktop + narrow)", () => {
  const mobileBlocks = extractAllMobileMediaBlocks(stylesContent);

  it("locks the desktop 2-col base template on the shared header rule (capability-off + capability-on)", () => {
    // Issue #342: the shared ``.detail-panel-pr-list-header`` rule
    // declares the 2-col base template (``PR | Cycle``) so capability-
    // off renders aligned columns under the new always-emitted header.
    // Capability-on overrides this to 5-col via the
    // ``--with-comments`` modifier (next test).  Locking the base
    // template prevents accidental drift back to the unlabeled pre-
    // 310 capability-off shape.
    const headerBody = findTopLevelRuleBody(
      stylesContent,
      ".detail-panel-pr-list-header",
    );
    expect(headerBody).not.toBeNull();
    expect(
      /grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+auto\s*;/.test(
        headerBody ?? "",
      ),
    ).toBe(true);
  });

  it("locks the desktop 5-col capability-on template on both header modifier and row modifier", () => {
    // The capability-on header modifier and the row modifier MUST
    // declare the same header-driven desktop track widths so the
    // header cells and their count cells line up across the 12px-
    // header / 13px-row font-size gap.  rem (not em) keeps both
    // grids resolving to identical pixel widths regardless of their
    // own font-size.
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
    // CSS comments on .detail-panel-pr-list-header--with-comments for
    // the full cross-platform-fallback rationale.
    const desktopTemplatePattern =
      /grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+auto\s+4\.25rem\s+5\.125rem\s+5\.875rem/;

    // Capability-on header rule.
    const headerModifierBody = findTopLevelRuleBody(
      stylesContent,
      ".detail-panel-pr-list-header--with-comments",
    );
    expect(headerModifierBody).not.toBeNull();
    expect(desktopTemplatePattern.test(headerModifierBody ?? "")).toBe(true);

    // Capability-on row rule (scoped under the --with-comments modifier).
    const rowBody = findTopLevelRuleBody(
      stylesContent,
      ".detail-panel-pr-list--with-comments .detail-panel-pr-row",
    );
    expect(rowBody).not.toBeNull();
    expect(desktopTemplatePattern.test(rowBody ?? "")).toBe(true);
  });

  it("locks the 480px narrow capability-on template on a --with-comments-scoped selector", () => {
    // Narrow-viewport override for capability-on: the 5-col template
    // must appear inside an @media (max-width: 480px) block under a
    // selector that includes a ``--with-comments`` modifier (header
    // OR row).  Capability-off keeps its 2-col base at every
    // viewport — naturally responsive without a fixed-track override.
    const narrowMatch = mobileBlocks.find(
      (body) =>
        body.includes("--with-comments") &&
        /grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+auto\s+3\.75rem\s+4\.625rem\s+5\.25rem/.test(
          body,
        ),
    );
    expect(narrowMatch).toBeDefined();
  });

  it("the 5-col grid-template-columns declaration NEVER appears on a non-`--with-comments` selector inside 480px blocks (SC-03 capability-off no-comments-metrics-surface guard)", () => {
    // Reframed SC-03 contract (issue #342): capability-off CAN carry
    // the shared bare row + bare header layout (so the cycle-time gets
    // labeled), but MUST NOT carry any comments-metrics surface — and
    // the multi-column TRACK TEMPLATE is the canonical comments-
    // metrics surface in CSS terms.  This guard scans every 480px
    // block and asserts: any rule whose body declares a 5-col
    // ``grid-template-columns`` MUST be reached only via a selector
    // that includes ``--with-comments`` (the capability-on modifier).
    // Other narrow-viewport tweaks (gap, padding, font-size) are
    // intentionally shared and don't trip this guard.
    const fiveColTemplatePattern =
      /grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+auto\s+\d/;
    for (const body of mobileBlocks) {
      const commentStripped = body.replace(/\/\*[\s\S]*?\*\//g, "");
      const rules = commentStripped.split("}");
      for (const rule of rules) {
        const braceIdx = rule.indexOf("{");
        if (braceIdx === -1) continue;
        const selectorList = rule.slice(0, braceIdx);
        const ruleBody = rule.slice(braceIdx + 1);
        if (!fiveColTemplatePattern.test(ruleBody)) continue;
        // Every selector in the comma-separated list MUST be capability-
        // on scoped.  Splitting on commas and asserting per-selector
        // gives a precise failure message if any selector slips.
        for (const rawSelector of selectorList.split(",")) {
          const selector = rawSelector.trim();
          if (selector === "") continue;
          expect({
            selector,
            isCapabilityOnScoped: selector.includes("--with-comments"),
          }).toEqual({ selector, isCapabilityOnScoped: true });
        }
      }
    }
  });
});
