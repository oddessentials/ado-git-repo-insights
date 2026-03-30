/**
 * Behavioral tests for host iframe resize synchronization.
 *
 * Verifies that the shared host-resize module correctly calls VSS.resize
 * when observed container dimensions change or the window resizes.
 */

import {
  initializeHostResizeSync,
  teardownHostResizeSync,
  syncHostHeight,
  scheduleHostResize,
} from "../ui/modules/shared/host-resize";

// ---------------------------------------------------------------------------
// ResizeObserver mock — jsdom does not provide one
// ---------------------------------------------------------------------------

type ROCallback = (entries: ResizeObserverEntry[]) => void;

let lastObserverCallback: ROCallback | null = null;
let lastObservedElement: Element | null = null;
let observerDisconnected = false;

class MockResizeObserver {
  constructor(callback: ROCallback) {
    lastObserverCallback = callback;
  }
  observe(target: Element): void {
    lastObservedElement = target;
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    observerDisconnected = true;
  }
}

// ---------------------------------------------------------------------------
// requestAnimationFrame mock — jsdom does not provide one
// ---------------------------------------------------------------------------

let rafCallbacks: Array<() => void> = [];

function mockRaf(cb: () => void): number {
  rafCallbacks.push(cb);
  return rafCallbacks.length;
}

function flushRaf(): void {
  const pending = rafCallbacks.splice(0);
  for (const cb of pending) cb();
}

// ---------------------------------------------------------------------------
// VSS.resize mock
// ---------------------------------------------------------------------------

let resizeSpy: jest.Mock<(width?: number, height?: number) => void>;

function setupVssResize(): void {
  resizeSpy = jest.fn();
  (globalThis as Record<string, unknown>).VSS = { resize: resizeSpy };
}

function teardownVssResize(): void {
  delete (globalThis as Record<string, unknown>).VSS;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("host-resize module", () => {
  beforeEach(() => {
    // Install mocks
    (globalThis as Record<string, unknown>).ResizeObserver = MockResizeObserver;
    (globalThis as Record<string, unknown>).requestAnimationFrame = mockRaf;
    rafCallbacks = [];
    lastObserverCallback = null;
    lastObservedElement = null;
    observerDisconnected = false;
    setupVssResize();

    // Provide a container for the observer
    document.body.innerHTML = '<div class="settings-container">initial</div>';

    // jsdom has no layout engine — scrollHeight is always 0.
    // Stub a realistic value so syncHostHeight passes the > 0 guard.
    Object.defineProperty(document.body, "scrollHeight", { value: 600, configurable: true });
    Object.defineProperty(document.documentElement, "scrollHeight", { value: 600, configurable: true });
  });

  afterEach(() => {
    teardownHostResizeSync();
    teardownVssResize();
    document.body.innerHTML = "";
    delete (globalThis as Record<string, unknown>).ResizeObserver;
    delete (globalThis as Record<string, unknown>).requestAnimationFrame;
  });

  it("calls VSS.resize with the document height after initialization", () => {
    initializeHostResizeSync(".settings-container");
    flushRaf();

    expect(resizeSpy).toHaveBeenCalledTimes(1);
    const height = resizeSpy.mock.calls[0][1] as number;
    expect(height).toBeGreaterThan(0);
  });

  it("attaches a ResizeObserver to the specified container", () => {
    initializeHostResizeSync(".settings-container");

    expect(lastObservedElement).toBe(
      document.querySelector(".settings-container"),
    );
  });

  it("calls VSS.resize when the ResizeObserver fires", () => {
    initializeHostResizeSync(".settings-container");
    flushRaf(); // flush the init resize
    resizeSpy.mockClear();

    // Simulate observer callback (content grew)
    lastObserverCallback!([] as ResizeObserverEntry[]);
    flushRaf();

    expect(resizeSpy).toHaveBeenCalledTimes(1);
  });

  it("calls VSS.resize on window resize events", () => {
    initializeHostResizeSync(".settings-container");
    flushRaf();
    resizeSpy.mockClear();

    window.dispatchEvent(new Event("resize"));
    flushRaf();

    expect(resizeSpy).toHaveBeenCalledTimes(1);
  });

  it("coalesces rapid calls into a single resize per frame", () => {
    initializeHostResizeSync(".settings-container");
    flushRaf();
    resizeSpy.mockClear();

    // Three rapid triggers before the frame flushes
    scheduleHostResize();
    scheduleHostResize();
    scheduleHostResize();
    flushRaf();

    expect(resizeSpy).toHaveBeenCalledTimes(1);
  });

  it("is safe to call initializeHostResizeSync twice (idempotent)", () => {
    initializeHostResizeSync(".settings-container");
    initializeHostResizeSync(".settings-container");
    flushRaf();

    // Should have disconnected the first observer
    expect(observerDisconnected).toBe(true);
    // And only one pending resize flushed
    expect(resizeSpy).toHaveBeenCalledTimes(1);
  });

  it("skips VSS.resize when VSS is not available", () => {
    teardownVssResize(); // remove VSS from globalThis

    initializeHostResizeSync(".settings-container");
    flushRaf();

    // No error thrown, no calls made
    expect(resizeSpy).not.toHaveBeenCalled();
  });

  it("skips the observer when ResizeObserver is unavailable", () => {
    delete (globalThis as Record<string, unknown>).ResizeObserver;

    initializeHostResizeSync(".settings-container");
    flushRaf();

    // Observer was never created, but resize still fires via initial call
    expect(lastObservedElement).toBeNull();
    expect(resizeSpy).toHaveBeenCalledTimes(1);
  });

  it("cleans up observer and listener on teardown", () => {
    initializeHostResizeSync(".settings-container");
    teardownHostResizeSync();

    // Observer disconnected
    expect(observerDisconnected).toBe(true);

    // Window resize no longer triggers anything
    resizeSpy.mockClear();
    rafCallbacks = [];
    window.dispatchEvent(new Event("resize"));
    flushRaf();
    expect(resizeSpy).not.toHaveBeenCalled();
  });

  it("syncHostHeight passes undefined width and computed height", () => {
    syncHostHeight();

    expect(resizeSpy).toHaveBeenCalledWith(undefined, expect.any(Number));
    expect(resizeSpy.mock.calls[0][0]).toBeUndefined();
  });
});
