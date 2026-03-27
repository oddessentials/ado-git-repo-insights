/**
 * Tooltip Manager Tests
 *
 * Verifies cross-system tooltip coordination:
 * - Mutual exclusivity between chart and info tooltips
 * - Lifecycle invariant: dismiss -> create -> position -> append
 * - Viewport boundary detection
 */

import {
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

  describe("Lifecycle invariant", () => {
    it("never allows two tooltips to coexist", () => {
      const target1 = document.createElement("div");
      document.body.appendChild(target1);
      target1.getBoundingClientRect = () => ({
        top: 100, left: 100, bottom: 120, right: 120,
        width: 20, height: 20, x: 100, y: 100, toJSON: () => ({}),
      });

      const target2 = document.createElement("button");
      document.body.appendChild(target2);
      target2.getBoundingClientRect = () => ({
        top: 200, left: 200, bottom: 220, right: 220,
        width: 20, height: 20, x: 200, y: 200, toJSON: () => ({}),
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
        top: 100, left: 100, bottom: 120, right: 120,
        width: 20, height: 20, x: 100, y: 100, toJSON: () => ({}),
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
