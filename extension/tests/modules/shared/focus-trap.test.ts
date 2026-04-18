/**
 * Focus trap tests.
 *
 * Covers the public contract of
 * `extension/ui/modules/shared/focus-trap.ts` per research.md R-03:
 * forward / backward Tab cycling, abort-restores-original-focus,
 * non-focusable descendants are skipped, and empty roots are tolerated.
 */

import { trapFocus, restoreFocus } from "../../../ui/modules/shared/focus-trap";

function makeRoot(): {
  root: HTMLElement;
  first: HTMLButtonElement;
  middle: HTMLButtonElement;
  last: HTMLButtonElement;
  nonFocusable: HTMLDivElement;
} {
  const root = document.createElement("div");
  const first = document.createElement("button");
  first.type = "button";
  first.textContent = "First";
  const middle = document.createElement("button");
  middle.type = "button";
  middle.textContent = "Middle";
  const last = document.createElement("button");
  last.type = "button";
  last.textContent = "Last";
  const nonFocusable = document.createElement("div");
  nonFocusable.textContent = "Not focusable";

  root.appendChild(first);
  root.appendChild(nonFocusable);
  root.appendChild(middle);
  root.appendChild(last);
  document.body.appendChild(root);

  return { root, first, middle, last, nonFocusable };
}

function pressTab(target: HTMLElement, shiftKey = false): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("focus-trap", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("cycles forward with Tab (last → first)", () => {
    const { root, first, last } = makeRoot();
    last.focus();
    const controller = trapFocus(root);

    pressTab(last);

    expect(document.activeElement).toBe(first);
    controller.abort();
  });

  it("cycles backward with Shift+Tab (first → last)", () => {
    const { root, first, last } = makeRoot();
    first.focus();
    const controller = trapFocus(root);

    pressTab(first, true);

    expect(document.activeElement).toBe(last);
    controller.abort();
  });

  it("does not move focus on Tab when not at a boundary", () => {
    const { root, first, middle } = makeRoot();
    first.focus();
    const controller = trapFocus(root);

    // Tab from first is not at the last-element boundary; trap does not
    // intercept, so jsdom leaves focus where it is (jsdom does not
    // natively advance Tab the way a real browser does).
    pressTab(first);

    expect(document.activeElement).not.toBe(middle);
    expect(document.activeElement).toBe(first);
    controller.abort();
  });

  it("restoreFocus returns focus to the originally-focused element", () => {
    const outside = document.createElement("button");
    outside.type = "button";
    outside.textContent = "Outside";
    document.body.appendChild(outside);
    outside.focus();

    const { root, first } = makeRoot();
    const controller = trapFocus(root);

    // trapFocus should have moved focus inside the root (to `first`)
    // since the outside element is not a descendant.
    expect(document.activeElement).toBe(first);

    restoreFocus(controller);
    expect(document.activeElement).toBe(outside);
  });

  it("abort() alone detaches the keydown listener (no focus restore)", () => {
    const { root, last, first } = makeRoot();
    last.focus();
    const controller = trapFocus(root);

    controller.abort();

    // Handler is detached — pressing Tab no longer wraps to first.
    pressTab(last);
    expect(document.activeElement).toBe(last);
    // (first remains focusable; we just assert trap did not intervene)
    expect(document.activeElement).not.toBe(first);
  });

  it("restoreFocus is a no-op when the return target has been removed from the DOM", () => {
    const removable = document.createElement("button");
    removable.type = "button";
    document.body.appendChild(removable);
    removable.focus();

    const { root, first } = makeRoot();
    const controller = trapFocus(root);
    expect(document.activeElement).toBe(first);

    // Detach the original focus target before restoring.
    removable.remove();

    // Should not throw; focus stays where it is (inside the trap root).
    expect(() => restoreFocus(controller)).not.toThrow();
    expect(document.activeElement).toBe(first);
  });

  it("skips non-focusable descendants when selecting first/last focusables", () => {
    const { root, first, last } = makeRoot();
    // middle button is focusable; nonFocusable div is not. first and last
    // should still be the boundary elements regardless of the non-focusable
    // sibling sandwiched between them.
    last.focus();
    const controller = trapFocus(root);

    pressTab(last); // last → first
    expect(document.activeElement).toBe(first);

    pressTab(first, true); // first → last (Shift+Tab)
    expect(document.activeElement).toBe(last);

    controller.abort();
  });

  it("trapFocus on an empty root does not throw and leaves focus unchanged", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const outside = document.createElement("button");
    outside.type = "button";
    document.body.appendChild(outside);
    outside.focus();

    // Direct call — if trapFocus throws, Jest surfaces the failure
    // without needing an expect().not.toThrow() wrapper (which confuses
    // ts-strict flow analysis about assignments inside the callback).
    const controller = trapFocus(root);

    expect(document.activeElement).toBe(outside);
    controller.abort();
  });
});
