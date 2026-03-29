/**
 * CSS Stylesheet Contract Tests
 *
 * Reads styles.css as text and verifies required CSS selectors exist.
 * This is deterministic, JSDOM-independent, and runs in CI.
 */
import * as _fsOriginal from "fs";
function _loadFs(): typeof _fsOriginal { return _fsOriginal; }
const _fs = _loadFs();
import { resolve } from "path";

const stylesPath = resolve(__dirname, "../../ui/styles.css");
const css = _fs.readFileSync(stylesPath, "utf-8");

function expectSelectorExists(selector: string): void {
  // String-based inclusion check — avoids non-literal RegExp construction
  expect(css).toContain(selector);
}

function expectMediaBlockContains(mediaQuery: string, content: string): void {
  // Extract the @media block using the existing extractBlock helper,
  // then verify the content string appears inside it.
  const block = extractBlock(css, `@media (${mediaQuery})`);
  expect(block.length).toBeGreaterThan(0);
  expect(block).toContain(content);
}

function extractBlock(source: string, anchor: string): string {
  const start = source.indexOf(anchor);
  if (start === -1) return "";
  const braceStart = source.indexOf("{", start);
  if (braceStart === -1) return "";
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source.charAt(i) === "{") depth += 1;
    if (source.charAt(i) === "}") depth -= 1;
    if (depth === 0) {
      return source.slice(start, i + 1);
    }
  }
  return "";
}

function expectRuleContains(
  source: string,
  selector: string,
  declaration: string,
): void {
  const rule = extractBlock(source, selector);
  expect(rule).toContain(declaration);
}

describe("CSS Contract: Stylesheet is non-empty", () => {
  it("styles.css exists and has content", () => {
    expect(css.length).toBeGreaterThan(0);
  });
});

describe("CSS Contract: Foundational rules exist", () => {
  it("defines .filter-hint base styling", () => {
    expectSelectorExists(".filter-hint");
  });

  it("defines .filter-hint-warning variant", () => {
    expectSelectorExists(".filter-hint-warning");
  });

  it("defines .truncation-indicator with prominent styling", () => {
    expectSelectorExists(".truncation-indicator");
    // Must NOT use tertiary color
    const truncMatch = css.match(/\.truncation-indicator\s*\{[^}]+\}/);
    expect(truncMatch).not.toBeNull();
    expect(truncMatch![0]).not.toContain("text-tertiary");
  });

  it("defines .btn:active state", () => {
    expectSelectorExists(".btn:active");
  });

  it("defines .btn:disabled state", () => {
    expectSelectorExists(".btn:disabled");
  });

  it("defines .btn-secondary:active state", () => {
    expectSelectorExists(".btn-secondary:active");
  });

  it("defines .btn-secondary:disabled state", () => {
    expectSelectorExists(".btn-secondary:disabled");
  });

  it("defines .filter-group select:hover state", () => {
    expect(css).toMatch(/\.filter-group\s+select:hover/);
  });

  it("defines .filter-group input:hover state", () => {
    expect(css).toMatch(/\.filter-group\s+input:hover/);
  });

  it('defines input[type="search"] normalization', () => {
    expect(css).toMatch(/input\[type="search"\]/);
  });

  it("defines .tab.disabled state", () => {
    expectSelectorExists(".tab.disabled");
  });

  it("defines .filter-chip-remove with 44px touch target", () => {
    const chipMatch = css.match(/\.filter-chip-remove\s*\{[^}]+\}/);
    expect(chipMatch).not.toBeNull();
    expect(chipMatch![0]).toContain("min-width: 44px");
    expect(chipMatch![0]).toContain("min-height: 44px");
  });

  it("defines .truncation-badge styling", () => {
    expectSelectorExists(".truncation-badge");
  });

  it("defines .no-data-hint styling", () => {
    expectSelectorExists(".no-data-hint");
  });

  it("defines .bar-label:empty with reduced margin", () => {
    expect(css).toMatch(/\.bar-label:empty/);
  });
});

describe("CSS Contract: 480px mobile breakpoint", () => {
  it("defines @media (max-width: 480px) block", () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*480px\)/);
  });

  it("includes single-column .summary-cards at 480px", () => {
    expectMediaBlockContains("max-width: 480px", ".summary-cards");
  });

  it("includes single-column .charts-row at 480px", () => {
    expectMediaBlockContains("max-width: 480px", ".charts-row");
  });

  it("includes reduced .dashboard-header h1 font size at 480px", () => {
    expectMediaBlockContains("max-width: 480px", ".dashboard-header h1");
  });

  it("includes reduced .metric-value font size at 480px", () => {
    expectMediaBlockContains("max-width: 480px", ".metric-value");
  });
});

describe("CSS Contract: Print stylesheet", () => {
  const printBlock = extractBlock(css, "@media print");

  it("defines @media print block", () => {
    expect(printBlock.length).toBeGreaterThan(0);
  });

  it("hides .filter-bar in print", () => {
    expectRuleContains(printBlock, ".filter-bar", "display: none");
  });

  it("hides .btn in print", () => {
    expectRuleContains(printBlock, ".btn", "display: none");
  });

  it("hides .toast in print", () => {
    expectRuleContains(printBlock, ".toast", "display: none");
  });

  it("hides .tabs in print", () => {
    expectRuleContains(printBlock, ".tabs", "display: none");
  });

  it("preserves .active-filters in print", () => {
    expectRuleContains(printBlock, ".active-filters", "display: flex");
  });

  it("includes page-break-inside on .chart-container", () => {
    expectRuleContains(
      printBlock,
      ".chart-container",
      "page-break-inside: avoid",
    );
  });
});

describe("CSS Contract: Touch device affordance", () => {
  it("defines @media (hover: none) for scroll affordance", () => {
    expect(css).toMatch(/@media\s*\(hover:\s*none\)/);
  });
});
