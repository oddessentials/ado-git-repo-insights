/**
 * Tooltip Tap/Click Interaction Tests
 *
 * Tests that addChartTooltips() supports click-based tooltips
 * with dismiss and scroll-cancellation behavior.
 */
import {
  addChartTooltips,
  clearChartTooltips,
  SCROLL_CANCEL_THRESHOLD,
} from "../../../ui/modules/charts";

// Polyfill PointerEvent for JSDOM (not available by default)
if (typeof globalThis.PointerEvent === "undefined") {
  (globalThis as unknown as Record<string, unknown>).PointerEvent =
    class PointerEvent extends MouseEvent {
      readonly pointerId: number;
      readonly pointerType: string;
      constructor(type: string, params: PointerEventInit & EventInit = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 0;
        this.pointerType = params.pointerType ?? "";
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
    dot.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }),
    );
    dot.dispatchEvent(
      new PointerEvent("pointerup", {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }),
    );

    const tooltip = document.querySelector(".chart-tooltip");
    expect(tooltip).not.toBeNull();
    expect(tooltip?.innerHTML).toContain("2025-W01");
  });

  it("dismisses tooltip when clicking elsewhere", () => {
    addChartTooltips(container, (el) => {
      return `<div>${el.dataset.week}</div>`;
    });

    const dot = container.querySelector("[data-tooltip]") as HTMLElement;
    dot.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }),
    );
    dot.dispatchEvent(
      new PointerEvent("pointerup", {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }),
    );

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
    dot1.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }),
    );
    dot1.dispatchEvent(
      new PointerEvent("pointerup", {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }),
    );
    expect(document.querySelector(".chart-tooltip")?.innerHTML).toContain(
      "2025-W01",
    );

    // Click second dot
    dot2.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 200,
        clientY: 100,
        bubbles: true,
      }),
    );
    dot2.dispatchEvent(
      new PointerEvent("pointerup", {
        clientX: 200,
        clientY: 100,
        bubbles: true,
      }),
    );

    const tooltips = document.querySelectorAll(".chart-tooltip");
    expect(tooltips.length).toBe(1);
    expect(tooltips[0]!.innerHTML).toContain("2025-W02");
  });

  it("preserves tooltip interactivity on first chart after second chart is rendered", () => {
    // Regression test: rendering a second chart must NOT kill the first chart's listeners.
    // The dashboard renders throughput then cycle-time sequentially.
    const chart1 = document.createElement("div");
    chart1.innerHTML = `<div data-tooltip="true" data-week="chart1-W01">C1</div>`;
    document.body.appendChild(chart1);

    const chart2 = document.createElement("div");
    chart2.innerHTML = `<div data-tooltip="true" data-week="chart2-W01">C2</div>`;
    document.body.appendChild(chart2);

    // Attach tooltips to both charts sequentially (as dashboard does)
    addChartTooltips(chart1, (el) => `<div>${el.dataset.week}</div>`);
    addChartTooltips(chart2, (el) => `<div>${el.dataset.week}</div>`);

    // Hover on the FIRST chart — its listeners must still be active
    const dot1 = chart1.querySelector("[data-tooltip]") as HTMLElement;
    dot1.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    const tooltip = document.querySelector(".chart-tooltip");
    expect(tooltip).not.toBeNull();
    expect(tooltip?.innerHTML).toContain("chart1-W01");

    // Clean up
    chart1.remove();
    chart2.remove();
  });

  it("re-rendering same chart replaces its listeners without affecting others", () => {
    const chart1 = document.createElement("div");
    chart1.innerHTML = `<div data-tooltip="true" data-week="old-W01">Old</div>`;
    document.body.appendChild(chart1);

    const chart2 = document.createElement("div");
    chart2.innerHTML = `<div data-tooltip="true" data-week="chart2-W01">C2</div>`;
    document.body.appendChild(chart2);

    addChartTooltips(chart1, (el) => `<div>${el.dataset.week}</div>`);
    addChartTooltips(chart2, (el) => `<div>${el.dataset.week}</div>`);

    // Re-render chart1 with new content (simulates filter change)
    chart1.innerHTML = `<div data-tooltip="true" data-week="new-W01">New</div>`;
    addChartTooltips(chart1, (el) => `<div>${el.dataset.week}</div>`);

    // Chart2 listeners must still work
    const dot2 = chart2.querySelector("[data-tooltip]") as HTMLElement;
    dot2.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    const tooltip = document.querySelector(".chart-tooltip");
    expect(tooltip).not.toBeNull();
    expect(tooltip?.innerHTML).toContain("chart2-W01");

    // Chart1's new content must also work
    dot2.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    const dot1New = chart1.querySelector("[data-tooltip]") as HTMLElement;
    dot1New.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    const tooltip2 = document.querySelector(".chart-tooltip");
    expect(tooltip2).not.toBeNull();
    expect(tooltip2?.innerHTML).toContain("new-W01");

    chart1.remove();
    chart2.remove();
  });

  it("dismisses the active tooltip when the same chart is re-rendered", () => {
    addChartTooltips(container, (el) => `<div>${el.dataset.week}</div>`);

    const dot = container.querySelector("[data-tooltip]") as HTMLElement;
    dot.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    expect(document.querySelector(".chart-tooltip")?.innerHTML).toContain(
      "2025-W01",
    );

    container.innerHTML = `
      <div data-tooltip="true" data-week="2025-W03" data-count="30">Bar 3</div>
    `;
    addChartTooltips(container, (el) => `<div>${el.dataset.week}</div>`);

    expect(document.querySelector(".chart-tooltip")).toBeNull();
  });

  it("ignores pointerup without preceding pointerdown", () => {
    addChartTooltips(container, (el) => `<div>${el.dataset.week}</div>`);

    const dot = container.querySelector("[data-tooltip]") as HTMLElement;
    dot.dispatchEvent(
      new PointerEvent("pointerup", {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }),
    );

    expect(document.querySelector(".chart-tooltip")).toBeNull();
  });

  it("does not dismiss tooltip when clicking on the tooltip itself", () => {
    addChartTooltips(container, (el) => `<div>${el.dataset.week}</div>`);

    const dot = container.querySelector("[data-tooltip]") as HTMLElement;
    dot.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }),
    );
    dot.dispatchEvent(
      new PointerEvent("pointerup", {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }),
    );

    const tooltip = document.querySelector(".chart-tooltip") as HTMLElement;
    expect(tooltip).not.toBeNull();

    tooltip.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector(".chart-tooltip")).not.toBeNull();
  });

  it("does not dismiss tooltip when clicking on a data-tooltip element", () => {
    addChartTooltips(container, (el) => `<div>${el.dataset.week}</div>`);

    const dot = container.querySelector("[data-tooltip]") as HTMLElement;
    dot.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(document.querySelector(".chart-tooltip")).not.toBeNull();

    dot.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector(".chart-tooltip")).not.toBeNull();
  });

  it("does NOT preventDefault on tap pointerup — downstream click handlers must still fire", () => {
    // Invariant: the per-bar pointerup handler must not cancel the
    // synthesized click event. Feature 059 drill-down relies on a
    // delegated click listener on the chart container; a call to
    // preventDefault() on this event would suppress touch-tap
    // activation of drill-down.
    addChartTooltips(container, (el) => `<div>${el.dataset.week}</div>`);

    const dot = container.querySelector("[data-tooltip]") as HTMLElement;
    dot.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }),
    );
    const pointerUp = new PointerEvent("pointerup", {
      clientX: 100,
      clientY: 100,
      bubbles: true,
      cancelable: true,
    });
    dot.dispatchEvent(pointerUp);

    expect(pointerUp.defaultPrevented).toBe(false);
    // And the tap still shows the tooltip (behavior preserved).
    expect(document.querySelector(".chart-tooltip")).not.toBeNull();
  });

  it("does not show tooltip when scroll gesture detected (>10px movement)", () => {
    addChartTooltips(container, (el) => {
      return `<div>${el.dataset.week}</div>`;
    });

    const dot = container.querySelector("[data-tooltip]") as HTMLElement;

    // Simulate scroll gesture: pointerdown at (100,100), pointerup at (100,120) = 20px movement
    dot.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }),
    );
    dot.dispatchEvent(
      new PointerEvent("pointerup", {
        clientX: 100,
        clientY: 120,
        bubbles: true,
      }),
    );

    expect(document.querySelector(".chart-tooltip")).toBeNull();
  });

  it("shows tooltip when movement stays below the scroll threshold", () => {
    addChartTooltips(container, (el) => `<div>${el.dataset.week}</div>`);

    const dot = container.querySelector("[data-tooltip]") as HTMLElement;
    dot.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }),
    );
    dot.dispatchEvent(
      new PointerEvent("pointerup", {
        clientX: 100,
        clientY: 100 + SCROLL_CANCEL_THRESHOLD - 1,
        bubbles: true,
      }),
    );

    expect(document.querySelector(".chart-tooltip")).not.toBeNull();
  });

  it("does not show tooltip when movement reaches the scroll threshold", () => {
    addChartTooltips(container, (el) => `<div>${el.dataset.week}</div>`);

    const dot = container.querySelector("[data-tooltip]") as HTMLElement;
    dot.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }),
    );
    dot.dispatchEvent(
      new PointerEvent("pointerup", {
        clientX: 100,
        clientY: 100 + SCROLL_CANCEL_THRESHOLD,
        bubbles: true,
      }),
    );

    expect(document.querySelector(".chart-tooltip")).toBeNull();
  });

  it("does not show tooltip when diagonal movement exceeds the threshold", () => {
    addChartTooltips(container, (el) => `<div>${el.dataset.week}</div>`);

    const dot = container.querySelector("[data-tooltip]") as HTMLElement;
    dot.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }),
    );
    dot.dispatchEvent(
      new PointerEvent("pointerup", {
        clientX: 108,
        clientY: 108,
        bubbles: true,
      }),
    );

    expect(document.querySelector(".chart-tooltip")).toBeNull();
  });

  it("removes the shared dismiss listener when all chart tooltips are cleared", () => {
    addChartTooltips(container, (el) => `<div>${el.dataset.week}</div>`);

    const dot = container.querySelector("[data-tooltip]") as HTMLElement;
    dot.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(document.querySelector(".chart-tooltip")).not.toBeNull();

    clearChartTooltips(container);
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector(".chart-tooltip")).toBeNull();
  });
});
