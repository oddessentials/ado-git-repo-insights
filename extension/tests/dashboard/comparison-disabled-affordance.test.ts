/**
 * Comparison-disabled affordance structural invariants (PR #302 P1.E).
 *
 * Source-parses extension/ui/styles.css to lock the rules that suppress
 * cursor / hover-brightness / focus-visible-brightness on drill-down
 * triggers when comparison mode is active. The behavioral side of this
 * contract is covered by the per-module Jest tests asserting that
 * keyboard activation in comparison mode produces the advisory toast
 * (not the panel) — see the three drilldown test files.
 *
 * jsdom does not apply external CSS, so this can't be verified
 * behaviorally in unit tests. The Playwright iframe smoke could
 * exercise it but the Codex-stop-hook discipline (no browser-quirk
 * locks) means the smoke locks application contracts only — the CSS
 * source-parse here covers the visual override that the design depends
 * on.
 */

import * as _fsOriginal from "fs";
function _loadFs(): typeof _fsOriginal {
  return _fsOriginal;
}
const _fs = _loadFs();
import { resolve } from "path";

const stylesSrcPath = resolve(__dirname, "../../ui/styles.css");
const stylesSrc = _fs.readFileSync(stylesSrcPath, "utf-8");

describe("comparison-disabled-affordance — CSS structural invariants", () => {
  it("comparison-disabled rule subdues drill-down triggers (cursor + opacity)", () => {
    // Original block at styles.css comparison-advisory section.
    expect(stylesSrc).toMatch(
      /\[data-drilldown-disabled="comparison"\] \[data-drilldown-week\][\s\S]{0,400}cursor: default/,
    );
    expect(stylesSrc).toMatch(
      /\[data-drilldown-disabled="comparison"\] \[data-drilldown-week\][\s\S]{0,400}opacity: 0\.75/,
    );
  });

  it("comparison-disabled override suppresses hover brightness on all three trigger types", () => {
    // PR #302 P1.E — must override the new affordance hover rules so
    // comparison-disabled triggers do not falsely flash brightness on
    // hover. Source-order ties; the override block must be later in
    // the file than the affordance block.
    const overrideBlock = stylesSrc.match(
      /\[data-drilldown-disabled="comparison"\][\s\S]{0,1500}filter: none/,
    );
    expect(overrideBlock).not.toBeNull();

    const overrideText = overrideBlock![0];
    expect(overrideText).toContain(".bar-container[data-drilldown-week]:hover");
    expect(overrideText).toContain(
      ".h-bar-row[data-drilldown-reviewer-id]:hover",
    );
    expect(overrideText).toContain('g[role="button"][data-drilldown-week]');
  });

  it("comparison-disabled override also suppresses focus-visible brightness (keyboard parity)", () => {
    const overrideBlock = stylesSrc.match(
      /\[data-drilldown-disabled="comparison"\][\s\S]{0,1500}filter: none/,
    );
    expect(overrideBlock).not.toBeNull();

    const overrideText = overrideBlock![0];
    expect(overrideText).toContain(
      ".bar-container[data-drilldown-week]:focus-visible",
    );
    expect(overrideText).toContain(
      ".h-bar-row[data-drilldown-reviewer-id]:focus-visible",
    );
  });

  it("affordance block precedes comparison-disabled override in source order", () => {
    const affordanceIdx = stylesSrc.indexOf(
      ".bar-container[data-drilldown-week] {",
    );
    expect(affordanceIdx).toBeGreaterThan(-1);

    // Source-order assertion is invariant to selector formatting (prettier
    // may emit the multi-part selector on one line OR split across lines
    // for long selectors). Use a regex that matches the override regardless
    // of whitespace, so the test stays semantic ("which block comes first
    // in source order") rather than coupling to prettier's wrap heuristic.
    const overrideMatch = stylesSrc.match(
      /\[data-drilldown-disabled="comparison"\]\s+\.bar-container\[data-drilldown-week\]:hover/,
    );
    expect(overrideMatch).not.toBeNull();
    expect(overrideMatch!.index).toBeGreaterThan(affordanceIdx);
  });
});
