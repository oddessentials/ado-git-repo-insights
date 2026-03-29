/**
 * Chart Layout Utility Tests
 *
 * Tests for renderTruncationIndicator.
 */

import { renderTruncationIndicator } from "../../../ui/modules/shared/chart-layout";

describe("renderTruncationIndicator", () => {
  it("returns empty string when not truncated", () => {
    expect(renderTruncationIndicator(false, 104)).toBe("");
  });

  it("renders badge HTML when truncated", () => {
    const html = renderTruncationIndicator(true, 104);
    expect(html).toContain("truncation-indicator");
    expect(html).toContain("truncation-badge");
    expect(html).toContain("Showing last 104 weeks");
  });

  it("uses custom noun", () => {
    const html = renderTruncationIndicator(true, 50, "items");
    expect(html).toContain("Showing last 50 items");
  });

  it("defaults noun to 'weeks'", () => {
    const html = renderTruncationIndicator(true, 8);
    expect(html).toContain("Showing last 8 weeks");
  });

  it("includes both CSS classes for selector specificity", () => {
    const html = renderTruncationIndicator(true, 104);
    expect(html).toContain('class="truncation-indicator truncation-badge"');
  });
});
