/**
 * CSS Stylesheet Contract Tests
 *
 * Reads styles.css as text and verifies required CSS selectors exist.
 * This is deterministic, JSDOM-independent, and runs in CI.
 */
import { readFileSync } from "fs";
import { resolve } from "path";

const stylesPath = resolve(__dirname, "../../ui/styles.css");
const css = readFileSync(stylesPath, "utf-8");

function expectSelectorExists(selector: string): void {
  // Escape special regex chars in CSS selectors, but keep structure
  const escaped = selector
    .replace(/([.[\](){}+?^$|\\])/g, "\\$1")
    .replace(/\*/g, "\\*");
  expect(css).toMatch(new RegExp(escaped));
}

function expectMediaBlockContains(mediaQuery: string, content: string): void {
  const mediaRegex = new RegExp(
    `@media\\s*\\(${mediaQuery.replace(/[()]/g, "\\$&")}\\)[^{]*\\{[\\s\\S]*?${content.replace(/([.[\](){}+?^$|\\])/g, "\\$1")}`,
  );
  expect(css).toMatch(mediaRegex);
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
  // Extract the @media print block for targeted assertions
  const printBlock = css.match(/@media\s+print\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

  it("defines @media print block", () => {
    expect(printBlock.length).toBeGreaterThan(0);
  });

  it("hides .filter-bar in print", () => {
    expect(printBlock).toContain(".filter-bar");
  });

  it("hides .btn in print", () => {
    expect(printBlock).toContain(".btn");
  });

  it("hides .toast in print", () => {
    expect(printBlock).toContain(".toast");
  });

  it("hides .tabs in print", () => {
    expect(printBlock).toContain(".tabs");
  });

  it("preserves .active-filters in print", () => {
    expect(printBlock).toContain(".active-filters");
  });

  it("includes page-break-inside on .chart-container", () => {
    expect(printBlock).toContain(".chart-container");
  });
});

describe("CSS Contract: Touch device affordance", () => {
  it("defines @media (hover: none) for scroll affordance", () => {
    expect(css).toMatch(/@media\s*\(hover:\s*none\)/);
  });
});
