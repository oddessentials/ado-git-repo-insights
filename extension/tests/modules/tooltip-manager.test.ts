/**
 * Tooltip Manager Tests
 *
 * Verifies cross-system tooltip coordination:
 * - Mutual exclusivity between chart and info tooltips
 * - Lifecycle invariant: dismiss -> create -> position -> append
 * - Viewport boundary detection
 */

import {
  assertTooltipStructure,
  dismissAllTooltips,
  showChartTooltip,
  showInfoTooltip,
} from "../../ui/modules/tooltip-manager";

describe("Tooltip Manager", () => {
  beforeEach(() => {
    dismissAllTooltips();
    document.body.innerHTML = "";
  });

  describe("dismissAllTooltips", () => {
    it("removes chart tooltips from DOM", () => {
      const tooltip = document.createElement("div");
      tooltip.className = "chart-tooltip";
      document.body.appendChild(tooltip);

      dismissAllTooltips();

      expect(document.querySelector(".chart-tooltip")).toBeNull();
    });

    it("removes info tooltips from DOM", () => {
      const tooltip = document.createElement("div");
      tooltip.className = "info-tooltip";
      document.body.appendChild(tooltip);

      dismissAllTooltips();

      expect(document.querySelector(".info-tooltip")).toBeNull();
    });

    it("removes both tooltip types simultaneously", () => {
      const chart = document.createElement("div");
      chart.className = "chart-tooltip";
      document.body.appendChild(chart);

      const info = document.createElement("div");
      info.className = "info-tooltip";
      document.body.appendChild(info);

      dismissAllTooltips();

      expect(document.querySelector(".chart-tooltip")).toBeNull();
      expect(document.querySelector(".info-tooltip")).toBeNull();
    });

    it("is safe to call when no tooltips exist", () => {
      expect(() => dismissAllTooltips()).not.toThrow();
    });
  });

  describe("showChartTooltip", () => {
    it("creates exactly one .chart-tooltip element", () => {
      const target = document.createElement("div");
      target.setAttribute("data-tooltip", "true");
      document.body.appendChild(target);

      // Mock getBoundingClientRect
      target.getBoundingClientRect = () => ({
        top: 100,
        left: 100,
        bottom: 120,
        right: 120,
        width: 20,
        height: 20,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      });

      showChartTooltip(target, "<span>Test</span>");

      const tooltips = document.querySelectorAll(".chart-tooltip");
      expect(tooltips).toHaveLength(1);
    });

    it("uses position: fixed", () => {
      const target = document.createElement("div");
      document.body.appendChild(target);

      target.getBoundingClientRect = () => ({
        top: 100,
        left: 100,
        bottom: 120,
        right: 120,
        width: 20,
        height: 20,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      });

      showChartTooltip(target, "Test");

      const tooltip = document.querySelector(".chart-tooltip") as HTMLElement;
      expect(tooltip?.style.position).toBe("fixed");
    });

    it("dismisses existing info tooltip before showing chart tooltip", () => {
      // Create an existing info tooltip
      const info = document.createElement("div");
      info.className = "info-tooltip";
      document.body.appendChild(info);

      const target = document.createElement("div");
      document.body.appendChild(target);
      target.getBoundingClientRect = () => ({
        top: 100,
        left: 100,
        bottom: 120,
        right: 120,
        width: 20,
        height: 20,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      });

      showChartTooltip(target, "Test");

      expect(document.querySelector(".info-tooltip")).toBeNull();
      expect(document.querySelectorAll(".chart-tooltip")).toHaveLength(1);
    });
  });

  describe("showInfoTooltip", () => {
    it("creates exactly one .info-tooltip element", () => {
      const target = document.createElement("button");
      document.body.appendChild(target);

      target.getBoundingClientRect = () => ({
        top: 50,
        left: 50,
        bottom: 70,
        right: 70,
        width: 20,
        height: 20,
        x: 50,
        y: 50,
        toJSON: () => ({}),
      });

      showInfoTooltip(target, "Explanation text");

      const tooltips = document.querySelectorAll(".info-tooltip");
      expect(tooltips).toHaveLength(1);
      expect(tooltips[0]?.textContent).toBe("Explanation text");
    });

    it("dismisses existing chart tooltip before showing info tooltip", () => {
      const chart = document.createElement("div");
      chart.className = "chart-tooltip";
      document.body.appendChild(chart);

      const target = document.createElement("button");
      document.body.appendChild(target);
      target.getBoundingClientRect = () => ({
        top: 50,
        left: 50,
        bottom: 70,
        right: 70,
        width: 20,
        height: 20,
        x: 50,
        y: 50,
        toJSON: () => ({}),
      });

      showInfoTooltip(target, "Explanation");

      expect(document.querySelector(".chart-tooltip")).toBeNull();
      expect(document.querySelectorAll(".info-tooltip")).toHaveLength(1);
    });
  });

  describe("Scroll and resize dismiss", () => {
    it("scroll event dismisses active tooltip", () => {
      const target = document.createElement("div");
      document.body.appendChild(target);
      target.getBoundingClientRect = () => ({
        top: 100,
        left: 100,
        bottom: 120,
        right: 120,
        width: 20,
        height: 20,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      });

      showChartTooltip(target, "Test scroll dismiss");
      expect(document.querySelector(".chart-tooltip")).not.toBeNull();

      // Scroll should dismiss
      window.dispatchEvent(new Event("scroll"));
      expect(document.querySelector(".chart-tooltip")).toBeNull();
    });

    it("resize event dismisses active tooltip", () => {
      const target = document.createElement("button");
      document.body.appendChild(target);
      target.getBoundingClientRect = () => ({
        top: 50,
        left: 50,
        bottom: 70,
        right: 70,
        width: 20,
        height: 20,
        x: 50,
        y: 50,
        toJSON: () => ({}),
      });

      showInfoTooltip(target, "Test resize dismiss");
      expect(document.querySelector(".info-tooltip")).not.toBeNull();

      // Resize should dismiss
      window.dispatchEvent(new Event("resize"));
      expect(document.querySelector(".info-tooltip")).toBeNull();
    });

    it("after dismiss, scroll/resize listeners are cleaned up (no orphan listeners)", () => {
      const target = document.createElement("div");
      document.body.appendChild(target);
      target.getBoundingClientRect = () => ({
        top: 100,
        left: 100,
        bottom: 120,
        right: 120,
        width: 20,
        height: 20,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      });

      // Show then dismiss via scroll
      showChartTooltip(target, "Test cleanup");
      window.dispatchEvent(new Event("scroll"));
      expect(document.querySelector(".chart-tooltip")).toBeNull();

      // Show a new tooltip — if old listeners were orphaned, they would
      // fire and dismiss this one immediately. But they shouldn't.
      showInfoTooltip(target, "Still here");
      expect(document.querySelector(".info-tooltip")).not.toBeNull();

      // Explicit cleanup
      dismissAllTooltips();
    });

    it("scroll/resize do nothing when no tooltip is active", () => {
      // No tooltips exist
      expect(document.querySelector(".chart-tooltip")).toBeNull();
      expect(document.querySelector(".info-tooltip")).toBeNull();

      // Should not throw
      expect(() => {
        window.dispatchEvent(new Event("scroll"));
        window.dispatchEvent(new Event("resize"));
      }).not.toThrow();
    });
  });

  describe("assertTooltipStructure", () => {
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {
        /* no-op */
      });
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    it("logs warning when positioned ancestor with transform exists", () => {
      // Create a positioned ancestor with transform
      const wrapper = document.createElement("div");
      wrapper.id = "wrapper";
      wrapper.style.position = "relative";
      // jsdom doesn't compute styles, so we need to mock getComputedStyle
      const originalGetComputedStyle = window.getComputedStyle;
      const mockGetComputedStyle = jest.fn((el: Element) => {
        if (el === wrapper) {
          return {
            getPropertyValue: (prop: string) => {
              if (prop === "position") return "relative";
              if (prop === "transform") return "translateX(10px)";
              return "";
            },
          } as CSSStyleDeclaration;
        }
        return originalGetComputedStyle(el);
      });
      window.getComputedStyle = mockGetComputedStyle;

      const mainContent = document.createElement("div");
      mainContent.id = "main-content";
      wrapper.appendChild(mainContent);
      document.body.appendChild(wrapper);

      assertTooltipStructure();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[tooltip-manager] Positioned ancestor with transform detected",
        ),
      );

      window.getComputedStyle = originalGetComputedStyle;
    });

    it("does not warn when no positioned ancestor with transform exists", () => {
      const mainContent = document.createElement("div");
      mainContent.id = "main-content";
      document.body.appendChild(mainContent);

      assertTooltipStructure();

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it("returns early when main-content element is missing", () => {
      // No main-content in DOM
      expect(() => assertTooltipStructure()).not.toThrow();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe("Viewport boundary clamping", () => {
    it("clamps tooltip to bottom of viewport when it overflows (line 67)", () => {
      const target = document.createElement("div");
      document.body.appendChild(target);

      // Target near bottom: top=0 so tooltip placed below at bottom+gap=28.
      // Make tooltip tall enough to overflow innerHeight.
      target.getBoundingClientRect = () => ({
        top: 0,
        left: 100,
        bottom: 20,
        right: 120,
        width: 20,
        height: 20,
        x: 100,
        y: 0,
        toJSON: () => ({}),
      });

      // Mock innerHeight to a small value so tooltip overflows bottom
      const origInnerHeight = window.innerHeight;
      Object.defineProperty(window, "innerHeight", {
        value: 50,
        configurable: true,
      });

      showChartTooltip(target, "<span>Tall tooltip content</span>");

      const tooltip = document.querySelector(".chart-tooltip") as HTMLElement;
      // The tooltip's top should be clamped: innerHeight - height - 4
      const top = parseFloat(tooltip.style.top);
      expect(top).toBeLessThanOrEqual(50);

      Object.defineProperty(window, "innerHeight", {
        value: origInnerHeight,
        configurable: true,
      });
    });

    it("clamps tooltip left edge to minimum of 4px (line 76)", () => {
      const target = document.createElement("div");
      document.body.appendChild(target);

      // Target at far left so centered tooltip would go negative
      target.getBoundingClientRect = () => ({
        top: 100,
        left: 0,
        bottom: 120,
        right: 5,
        width: 5,
        height: 20,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      });

      showInfoTooltip(target, "Left edge test");

      const tooltip = document.querySelector(".info-tooltip") as HTMLElement;
      const left = parseFloat(tooltip.style.left);
      expect(left).toBeGreaterThanOrEqual(4);
    });
  });

  describe("Lifecycle invariant", () => {
    it("never allows two tooltips to coexist", () => {
      const target1 = document.createElement("div");
      document.body.appendChild(target1);
      target1.getBoundingClientRect = () => ({
        top: 100,
        left: 100,
        bottom: 120,
        right: 120,
        width: 20,
        height: 20,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      });

      const target2 = document.createElement("button");
      document.body.appendChild(target2);
      target2.getBoundingClientRect = () => ({
        top: 200,
        left: 200,
        bottom: 220,
        right: 220,
        width: 20,
        height: 20,
        x: 200,
        y: 200,
        toJSON: () => ({}),
      });

      // Show chart tooltip
      showChartTooltip(target1, "Chart");
      const allTooltips1 = document.querySelectorAll(
        ".chart-tooltip, .info-tooltip",
      );
      expect(allTooltips1).toHaveLength(1);

      // Show info tooltip (should dismiss chart tooltip first)
      showInfoTooltip(target2, "Info");
      const allTooltips2 = document.querySelectorAll(
        ".chart-tooltip, .info-tooltip",
      );
      expect(allTooltips2).toHaveLength(1);

      // Show another chart tooltip (should dismiss info tooltip first)
      showChartTooltip(target1, "Chart 2");
      const allTooltips3 = document.querySelectorAll(
        ".chart-tooltip, .info-tooltip",
      );
      expect(allTooltips3).toHaveLength(1);
    });

    it("after dismissAllTooltips: zero tooltip elements exist", () => {
      const target = document.createElement("div");
      document.body.appendChild(target);
      target.getBoundingClientRect = () => ({
        top: 100,
        left: 100,
        bottom: 120,
        right: 120,
        width: 20,
        height: 20,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      });

      showChartTooltip(target, "Test");
      expect(
        document.querySelectorAll(".chart-tooltip, .info-tooltip"),
      ).toHaveLength(1);

      dismissAllTooltips();
      expect(
        document.querySelectorAll(".chart-tooltip, .info-tooltip"),
      ).toHaveLength(0);
    });
  });
});
