/**
 * Tooltip Tap/Click Interaction Tests
 *
 * Tests that addChartTooltips() supports click-based tooltips
 * with dismiss and scroll-cancellation behavior.
 */
import { addChartTooltips } from "../../../ui/modules/charts";

// Polyfill PointerEvent for JSDOM (not available by default)
if (typeof globalThis.PointerEvent === "undefined") {
  (globalThis as any).PointerEvent = class PointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, params: PointerEventInit & EventInit = {}) {
      super(type, params);
      this.pointerId = (params as any).pointerId ?? 0;
      this.pointerType = (params as any).pointerType ?? "";
    }
  };
}

describe("addChartTooltips click/tap support", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    container.innerHTML = `
      <div data-tooltip="true" data-week="2025-W01" data-count="10">Bar 1</div>
      <div data-tooltip="true" data-week="2025-W02" data-count="20">Bar 2</div>
    `;
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("creates tooltip on click", () => {
    addChartTooltips(container, (el) => {
      return `<div class="chart-tooltip-title">${el.dataset.week}</div>`;
    });

    const dot = container.querySelector("[data-tooltip]") as HTMLElement;

    // Simulate pointerdown + pointerup (no movement = tap)
    dot.dispatchEvent(new PointerEvent("pointerdown", { clientX: 100, clientY: 100, bubbles: true }));
    dot.dispatchEvent(new PointerEvent("pointerup", { clientX: 100, clientY: 100, bubbles: true }));

    const tooltip = document.querySelector(".chart-tooltip");
    expect(tooltip).not.toBeNull();
    expect(tooltip?.innerHTML).toContain("2025-W01");
  });

  it("dismisses tooltip when clicking elsewhere", () => {
    addChartTooltips(container, (el) => {
      return `<div>${el.dataset.week}</div>`;
    });

    const dot = container.querySelector("[data-tooltip]") as HTMLElement;
    dot.dispatchEvent(new PointerEvent("pointerdown", { clientX: 100, clientY: 100, bubbles: true }));
    dot.dispatchEvent(new PointerEvent("pointerup", { clientX: 100, clientY: 100, bubbles: true }));

    expect(document.querySelector(".chart-tooltip")).not.toBeNull();

    // Click on body (outside tooltip)
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector(".chart-tooltip")).toBeNull();
  });

  it("replaces tooltip when clicking different data point", () => {
    addChartTooltips(container, (el) => {
      return `<div>${el.dataset.week}</div>`;
    });

    const dots = container.querySelectorAll("[data-tooltip]");
    const dot1 = dots[0] as HTMLElement;
    const dot2 = dots[1] as HTMLElement;

    // Click first dot
    dot1.dispatchEvent(new PointerEvent("pointerdown", { clientX: 100, clientY: 100, bubbles: true }));
    dot1.dispatchEvent(new PointerEvent("pointerup", { clientX: 100, clientY: 100, bubbles: true }));
    expect(document.querySelector(".chart-tooltip")?.innerHTML).toContain("2025-W01");

    // Click second dot
    dot2.dispatchEvent(new PointerEvent("pointerdown", { clientX: 200, clientY: 100, bubbles: true }));
    dot2.dispatchEvent(new PointerEvent("pointerup", { clientX: 200, clientY: 100, bubbles: true }));

    const tooltips = document.querySelectorAll(".chart-tooltip");
    expect(tooltips.length).toBe(1);
    expect(tooltips[0].innerHTML).toContain("2025-W02");
  });

  it("does not show tooltip when scroll gesture detected (>10px movement)", () => {
    addChartTooltips(container, (el) => {
      return `<div>${el.dataset.week}</div>`;
    });

    const dot = container.querySelector("[data-tooltip]") as HTMLElement;

    // Simulate scroll gesture: pointerdown at (100,100), pointerup at (100,120) = 20px movement
    dot.dispatchEvent(new PointerEvent("pointerdown", { clientX: 100, clientY: 100, bubbles: true }));
    dot.dispatchEvent(new PointerEvent("pointerup", { clientX: 100, clientY: 120, bubbles: true }));

    expect(document.querySelector(".chart-tooltip")).toBeNull();
  });
});
