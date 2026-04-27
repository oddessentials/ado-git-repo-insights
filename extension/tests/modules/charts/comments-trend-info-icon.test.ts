/**
 * Comments-Trend Info Icon Tests (Feature 333 — chart-level disclosure).
 *
 * Verifies `attachCommentsTrendInfoIcon` / `detachCommentsTrendInfoIcon`
 * surface FR-1-04 explanatory disclosure on the chart's `<h3>` heading via
 * the canonical `info-icon-btn` controller-tracked pattern (peer:
 * `summary-cards.ts::attachInfoIcons`). All assertions exercise the real
 * `showInfoTooltip` / `dismissAllTooltips` mechanism in `tooltip-manager.ts`
 * — no mocks beyond the standard `getBoundingClientRect` polyfill jsdom
 * needs for tooltip positioning.
 */

// jsdom lacks PointerEvent — polyfill mirrors `summary-cards-info.test.ts`.
if (typeof PointerEvent === "undefined") {
  (globalThis as Record<string, unknown>).PointerEvent =
    class PointerEvent extends MouseEvent {
      constructor(type: string, init?: PointerEventInit) {
        super(type, init);
      }
    };
}

import {
  attachCommentsTrendInfoIcon,
  detachCommentsTrendInfoIcon,
  COMMENTS_TREND_TOOLTIP,
} from "../../../ui/modules/charts/comments-trend";

function buildHeading(): HTMLHeadingElement {
  const heading = document.createElement("h3");
  heading.textContent = "Comments Trend";
  document.body.appendChild(heading);
  return heading;
}

function pinRect(target: HTMLElement): void {
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
}

describe("Comments-Trend Info Icon (attachCommentsTrendInfoIcon)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document
      .querySelectorAll(".info-tooltip, .chart-tooltip")
      .forEach((el) => el.remove());
  });

  it("attaches a single info-icon-btn with the canonical attributes", () => {
    const heading = buildHeading();

    attachCommentsTrendInfoIcon(heading);

    const icons = heading.querySelectorAll(".info-icon-btn");
    expect(icons).toHaveLength(1);

    const btn = icons[0] as HTMLButtonElement;
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.getAttribute("aria-label")).toBe("About this chart");
    expect(btn.getAttribute("data-info-tooltip")).toBe("comments-trend");
    expect(btn.textContent).toBe("ℹ");
    // The button is a child of the heading (parity with summary-cards.ts:717).
    expect(btn.parentElement).toBe(heading);
  });

  it("pointerenter shows .info-tooltip with COMMENTS_TREND_TOOLTIP content", () => {
    const heading = buildHeading();
    attachCommentsTrendInfoIcon(heading);

    const btn = heading.querySelector(".info-icon-btn") as HTMLElement;
    pinRect(btn);

    btn.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));

    const tooltip = document.querySelector(".info-tooltip");
    expect(tooltip).not.toBeNull();
    expect(tooltip?.textContent).toBe(COMMENTS_TREND_TOOLTIP);
  });

  it("pointerleave dismisses any open tooltip", () => {
    const heading = buildHeading();
    attachCommentsTrendInfoIcon(heading);

    const btn = heading.querySelector(".info-icon-btn") as HTMLElement;
    pinRect(btn);

    btn.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    expect(document.querySelector(".info-tooltip")).not.toBeNull();

    btn.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    expect(document.querySelector(".info-tooltip")).toBeNull();
  });

  it("click toggles tooltip visibility (show then dismiss)", () => {
    const heading = buildHeading();
    attachCommentsTrendInfoIcon(heading);

    const btn = heading.querySelector(".info-icon-btn") as HTMLElement;
    pinRect(btn);

    btn.click();
    expect(document.querySelector(".info-tooltip")).not.toBeNull();

    btn.click();
    expect(document.querySelector(".info-tooltip")).toBeNull();
  });

  it("detach is a no-op when the heading carries no info-icon-btn", () => {
    const heading = buildHeading();
    // The early-return guard handles the legitimate public-API case where
    // a caller passes an iconless heading (e.g., the dashboard's
    // `removeCommentsTrendContainer` after a manual DOM cleanup, or a
    // capability flip on a heading where attach was never reached).
    expect(() => detachCommentsTrendInfoIcon(heading)).not.toThrow();
    expect(heading.querySelector(".info-icon-btn")).toBeNull();
  });

  it("detach dismisses any open info-tooltip so it cannot outlive the heading", () => {
    const heading = buildHeading();
    attachCommentsTrendInfoIcon(heading);

    const btn = heading.querySelector(".info-icon-btn") as HTMLElement;
    pinRect(btn);

    // Open the tooltip via the canonical hover path.
    btn.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    expect(document.querySelector(".info-tooltip")).not.toBeNull();

    // Detaching MUST clean up not just the button but the document-rooted
    // tooltip too. Otherwise the tooltip persists against an orphaned
    // anchor when the chart container is torn down on a capability flip.
    detachCommentsTrendInfoIcon(heading);
    expect(heading.querySelector(".info-icon-btn")).toBeNull();
    expect(document.querySelector(".info-tooltip")).toBeNull();
  });

  it("detach removes the button and aborts its listeners", () => {
    const heading = buildHeading();
    attachCommentsTrendInfoIcon(heading);

    const btn = heading.querySelector(".info-icon-btn") as HTMLElement;
    pinRect(btn);

    detachCommentsTrendInfoIcon(heading);
    expect(heading.querySelector(".info-icon-btn")).toBeNull();

    // After detach, the prior button's listeners are aborted — pointerenter
    // on the (now-orphaned) reference must not produce a tooltip.
    btn.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    expect(document.querySelector(".info-tooltip")).toBeNull();
  });

  it("re-attach on the same heading replaces the button without duplicating", () => {
    const heading = buildHeading();
    attachCommentsTrendInfoIcon(heading);

    const firstBtn = heading.querySelector(".info-icon-btn") as HTMLElement;
    pinRect(firstBtn);

    // Re-attach: the prior button is aborted + removed, a fresh one mounted.
    attachCommentsTrendInfoIcon(heading);
    expect(heading.querySelectorAll(".info-icon-btn")).toHaveLength(1);

    // The orphaned reference's listeners are aborted — pointerenter is a
    // no-op (controller-tracked cleanup, mirrors summary-cards behavior).
    firstBtn.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    expect(document.querySelector(".info-tooltip")).toBeNull();
  });
});
