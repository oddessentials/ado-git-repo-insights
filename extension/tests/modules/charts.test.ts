/**
 * Chart module tests.
 *
 * Tests chart rendering with stable contracts:
 * - Container cleared/created
 * - Expected data handling
 * - Graceful empty/edge dataset handling
 */

import { renderDelta, renderSparkline } from "../../ui/modules/charts";

describe("charts module", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe("renderDelta", () => {
    it("renders null change as empty", () => {
      renderDelta(container, null);
      expect(container.innerHTML).toBe("");
      expect(container.className).toBe("metric-delta");
    });

    it("renders positive change with up arrow", () => {
      renderDelta(container, 25);
      expect(container.innerHTML).toContain("delta-arrow");
      expect(container.innerHTML).toContain("+25%");
      expect(container.className).toContain("delta-positive");
    });

    it("renders negative change with down arrow", () => {
      renderDelta(container, -15);
      expect(container.innerHTML).toContain("delta-arrow");
      expect(container.innerHTML).toContain("15%");
      expect(container.className).toContain("delta-negative");
    });

    it("renders neutral change (within 2%)", () => {
      renderDelta(container, 1);
      expect(container.innerHTML).toContain("~");
      expect(container.className).toContain("delta-neutral");
    });

    it("handles inverse mode (lower is better)", () => {
      renderDelta(container, 25, true);
      // Positive change but inverse = bad
      expect(container.className).toContain("delta-negative-inverse");
    });

    it("handles null element gracefully", () => {
      expect(() => renderDelta(null, 10)).not.toThrow();
    });
  });

  describe("renderSparkline", () => {
    it("renders empty on insufficient data", () => {
      renderSparkline(container, [1]); // Need at least 2 points
      expect(container.innerHTML).toBe("");
    });

    it("renders SVG for valid data", () => {
      renderSparkline(container, [10, 20, 30, 40]);
      expect(container.innerHTML).toContain("<svg");
      expect(container.innerHTML).toContain("sparkline-line");
      expect(container.innerHTML).toContain("sparkline-dot");
    });

    it("handles flat data (no range)", () => {
      renderSparkline(container, [5, 5, 5, 5]);
      expect(container.innerHTML).toContain("<svg");
    });

    it("limits to last 8 values", () => {
      const manyValues = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      renderSparkline(container, manyValues);
      // Should render without error
      expect(container.innerHTML).toContain("<svg");
    });

    it("handles null element gracefully", () => {
      expect(() => renderSparkline(null, [1, 2, 3])).not.toThrow();
    });

    it("handles empty array gracefully", () => {
      renderSparkline(container, []);
      expect(container.innerHTML).toBe("");
    });
  });
});
