/**
 * Touch Target Contract Tests
 *
 * Locks rendering constants and verifies CSS touch-target rules via stylesheet text.
 */
import * as _fsOriginal from "fs";
function _loadFs(): typeof _fsOriginal {
  return _fsOriginal;
}
const _fs = _loadFs();
import { resolve } from "path";
import { MAX_VISIBLE_LABELS } from "../../ui/modules/charts/throughput";
import { SCROLL_CANCEL_THRESHOLD } from "../../ui/modules/charts";

const stylesPath = resolve(__dirname, "../../ui/styles.css");
const css = _fs.readFileSync(stylesPath, "utf-8");

describe("Rendering Constants Contract", () => {
  it("MAX_VISIBLE_LABELS is 16", () => {
    expect(MAX_VISIBLE_LABELS).toBe(16);
  });

  it("SCROLL_CANCEL_THRESHOLD is 10", () => {
    expect(SCROLL_CANCEL_THRESHOLD).toBe(10);
  });
});

describe("Touch Target CSS Contract", () => {
  it(".filter-chip-remove has 44px minimum touch target (critical tier)", () => {
    const match = css.match(/\.filter-chip-remove\s*\{[^}]+\}/);
    expect(match).not.toBeNull();
    expect(match![0]).toContain("min-width: 44px");
    expect(match![0]).toContain("min-height: 44px");
  });

  it(".btn-small has increased padding for 36px tier", () => {
    const match = css.match(/\.btn-small\s*\{[^}]+\}/);
    expect(match).not.toBeNull();
    expect(match![0]).toContain("8px 12px");
  });

  it(".export-option has increased padding for 36px tier", () => {
    const match = css.match(/\.export-option\s*\{[^}]+\}/);
    expect(match).not.toBeNull();
    expect(match![0]).toContain("12px 16px");
  });
});
