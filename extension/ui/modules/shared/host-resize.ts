/**
 * Host iframe resize synchronization for Azure DevOps extension pages.
 *
 * Keeps the ADO host iframe height in sync with dynamic content so controls
 * below lazy-loaded sections remain reachable without a host scrollbar.
 *
 * @module ui/modules/shared/host-resize
 */

let pendingHostResize = false;
let rafHandle: ReturnType<typeof requestAnimationFrame> | null = null;
let hostResizeObserver: ResizeObserver | null = null;
let windowListenerAttached = false;
/** Monotonic counter — incremented on teardown so stale rAF callbacks become no-ops. */
let generation = 0;

/**
 * Notify the Azure DevOps host iframe of the current document height.
 */
export function syncHostHeight(): void {
  const resizeFn = (
    globalThis as {
      VSS?: { resize?: (width?: number, height?: number) => void };
    }
  ).VSS?.resize;
  if (typeof resizeFn !== "function") return;

  const bodyHeight = document.body?.scrollHeight ?? 0;
  const docHeight = document.documentElement?.scrollHeight ?? 0;
  const targetHeight = Math.max(bodyHeight, docHeight);
  if (targetHeight > 0) {
    resizeFn(undefined, targetHeight);
  }
}

/**
 * Schedule a host resize on the next animation frame (coalesces rapid calls).
 */
export function scheduleHostResize(): void {
  if (pendingHostResize) return;
  pendingHostResize = true;

  const gen = generation;
  rafHandle = requestAnimationFrame(() => {
    rafHandle = null;
    // If teardown (or re-init) happened since this callback was queued,
    // the generation will have advanced — discard the stale resize.
    if (gen !== generation) return;
    pendingHostResize = false;
    syncHostHeight();
  });
}

/**
 * Wire a ResizeObserver and window resize listener to keep the host frame
 * sized correctly whenever {@link containerSelector} changes dimensions.
 *
 * Safe to call more than once — previous observer and listener are cleaned up.
 */
export function initializeHostResizeSync(containerSelector: string): void {
  // Invalidate any in-flight rAF from a previous initialization.
  generation++;
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  pendingHostResize = false;

  // Always disconnect the previous observer — even if the new selector
  // doesn't match — so stale callbacks never fire on a removed element.
  hostResizeObserver?.disconnect();
  hostResizeObserver = null;

  if (typeof ResizeObserver === "function") {
    const root = document.querySelector(containerSelector);
    if (root) {
      hostResizeObserver = new ResizeObserver(() => {
        scheduleHostResize();
      });
      hostResizeObserver.observe(root);
    }
  }

  if (windowListenerAttached) {
    window.removeEventListener("resize", scheduleHostResize);
  }
  window.addEventListener("resize", scheduleHostResize);
  windowListenerAttached = true;

  scheduleHostResize();
}

/**
 * Tear down the observer and window listener. Intended for test cleanup.
 */
export function teardownHostResizeSync(): void {
  // Bump generation first — any in-flight rAF callback becomes a no-op.
  generation++;

  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }

  hostResizeObserver?.disconnect();
  hostResizeObserver = null;

  if (windowListenerAttached) {
    window.removeEventListener("resize", scheduleHostResize);
    windowListenerAttached = false;
  }

  pendingHostResize = false;
}
