/**
 * Reusable keyboard focus trap.
 *
 * `trapFocus(root)` records the currently focused element as the return
 * target, moves focus into `root` (to the first focusable descendant if
 * none is already inside), and cycles Tab / Shift+Tab through the
 * focusable descendants without leaking focus to the document behind.
 *
 * `restoreFocus(controller)` aborts the trap and returns focus to the
 * recorded element.
 *
 * Matches the AbortController cleanup idiom used in
 * `extension/ui/modules/tooltip-manager.ts` and
 * `extension/ui/modules/typeahead-dropdown.ts`.
 *
 * Designed for the drill-down DetailPanel but carries no drill-down
 * knowledge so any future overlay can reuse it.
 */

// Standard focusable selector. Mirrors accepted a11y guidance for
// focus-trap implementations.
const FOCUSABLE_SELECTOR =
  '[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

interface FocusTrapState {
  readonly root: HTMLElement;
  readonly returnTarget: HTMLElement | null;
}

// WeakMap keyed by the AbortController so restoreFocus can recover the
// recorded return target without exposing state globally.
const trapStates = new WeakMap<AbortController, FocusTrapState>();

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  return Array.from(nodes).filter(
    (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
  );
}

/**
 * Install a focus trap on `root`. Returns an AbortController; calling
 * `abort()` detaches the Tab-cycling keydown listener. Use
 * `restoreFocus(controller)` to both abort and return focus to the
 * previously-focused element.
 */
export function trapFocus(root: HTMLElement): AbortController {
  const controller = new AbortController();
  const returnTarget =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  trapStates.set(controller, { root, returnTarget });

  // Move focus into the trap if nothing inside root is already focused.
  if (!root.contains(document.activeElement)) {
    const first = getFocusableElements(root)[0];
    first?.focus();
  }

  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Tab") return;
    const focusables = getFocusableElements(root);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) {
      // Empty trap — swallow Tab so focus does not leak behind.
      event.preventDefault();
      return;
    }
    const active = document.activeElement;

    if (event.shiftKey) {
      if (active === first || !root.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (active === last || !root.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  root.addEventListener("keydown", handleKeydown, {
    signal: controller.signal,
  });

  return controller;
}

/**
 * Abort an active focus trap and restore focus to the element that was
 * focused when `trapFocus` was called. Safe to call on an already-aborted
 * controller (no-op in that case).
 */
export function restoreFocus(controller: AbortController): void {
  const state = trapStates.get(controller);
  controller.abort();
  if (state && state.returnTarget && !state.returnTarget.isConnected) {
    // Return target was removed from the DOM while the trap was active;
    // nothing sensible to restore to. Leave focus where it is.
    return;
  }
  state?.returnTarget?.focus();
}
