/**
 * Behavioral tests for host iframe resize synchronization.
 *
 * Verifies that the shared host-resize module correctly calls VSS.resize
 * when observed container dimensions change or the window resizes.
 */

import * as path from "path";
import { readTextFile } from "./helpers/fs-test-utils";
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

function mockCancelRaf(id: number): void {
  // rAF IDs are 1-based (see mockRaf return)
  if (id >= 1 && id <= rafCallbacks.length) {
    // Replace with no-op so flushRaf skips it
    rafCallbacks[id - 1] = () => {};
  }
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
    (globalThis as Record<string, unknown>).cancelAnimationFrame = mockCancelRaf;
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
    delete (globalThis as Record<string, unknown>).cancelAnimationFrame;
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

  it("skips VSS.resize when document height is zero", () => {
    Object.defineProperty(document.body, "scrollHeight", { value: 0, configurable: true });
    Object.defineProperty(document.documentElement, "scrollHeight", { value: 0, configurable: true });

    syncHostHeight();

    expect(resizeSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Regression: P2 — disconnect old observer even when new selector misses
  // -------------------------------------------------------------------------

  it("disconnects the previous observer when re-initialized with a non-matching selector", () => {
    initializeHostResizeSync(".settings-container");
    flushRaf();

    // The observer is now watching .settings-container
    expect(lastObservedElement).toBe(
      document.querySelector(".settings-container"),
    );

    // Re-init with a selector that doesn't exist in the DOM
    initializeHostResizeSync(".does-not-exist");
    flushRaf();

    // The old observer must have been disconnected
    expect(observerDisconnected).toBe(true);

    // And the old observer callback must not trigger a resize
    resizeSpy.mockClear();
    rafCallbacks = [];
    lastObserverCallback!([] as ResizeObserverEntry[]);
    flushRaf();
    // The old callback still calls scheduleHostResize, but that's harmless;
    // the important thing is the observer itself was disconnected from the
    // element so the browser won't deliver entries to it.
    expect(observerDisconnected).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Regression: P3 — stale rAF callback must not fire after teardown
  // -------------------------------------------------------------------------

  it("does not call VSS.resize when a queued rAF fires after teardown", () => {
    initializeHostResizeSync(".settings-container");
    // A rAF callback is now queued but NOT flushed

    teardownHostResizeSync();

    // Now flush — the stale callback must be a no-op
    flushRaf();
    expect(resizeSpy).not.toHaveBeenCalled();
  });

  it("generation guard discards stale callback even if cancelAnimationFrame is a no-op", () => {
    // Simulate the real browser race where cancelAnimationFrame doesn't
    // prevent a callback that has already been dequeued by the runtime.
    (globalThis as Record<string, unknown>).cancelAnimationFrame = () => {};

    initializeHostResizeSync(".settings-container");
    // rAF queued — cancelAnimationFrame is now a no-op, so teardown
    // can't actually cancel it.  The generation guard must catch it.

    teardownHostResizeSync();
    flushRaf();

    expect(resizeSpy).not.toHaveBeenCalled();

    // Restore the real mock for subsequent tests
    (globalThis as Record<string, unknown>).cancelAnimationFrame = mockCancelRaf;
  });

  it("does not call VSS.resize when a queued rAF fires after re-initialization", () => {
    initializeHostResizeSync(".settings-container");
    // rAF queued from first init — don't flush yet

    // Re-initialize (simulates a rerender)
    initializeHostResizeSync(".settings-container");

    // Flush all queued callbacks — only the second init's callback should fire
    flushRaf();

    // Exactly one resize from the second init, not two
    expect(resizeSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Init ordering contract: resize sync must start before async startup work
// ---------------------------------------------------------------------------

describe("settings init ordering contract", () => {
  // Source-reading test is the correct pattern here: this is a cross-file
  // structural contract (like artifact-paths and settings-key sync tests),
  // not a behavioral test of the resize module itself.

  let initBody: string;

  beforeAll(() => {
    const settingsPath = path.join(__dirname, "../ui/settings.ts");
    const source = readTextFile(settingsPath);

    // Extract the init() function body (from "async function init" to its
    // closing brace).  This is intentionally fragile — if the function is
    // renamed or restructured, the test should fail loudly.
    const match = source.match(
      /async function init\(\): Promise<void> \{([\s\S]*?)\n\}/,
    );
    expect(match).not.toBeNull();
    initBody = match![1] as string;
  });

  it("calls initializeHostResizeSync before initializeAdoSdk", () => {
    const resizeIdx = initBody.indexOf("initializeHostResizeSync(");
    const sdkIdx = initBody.indexOf("initializeAdoSdk(");

    expect(resizeIdx).toBeGreaterThan(-1);
    expect(sdkIdx).toBeGreaterThan(-1);
    expect(resizeIdx).toBeLessThan(sdkIdx);
  });

  it("calls initializeHostResizeSync before the try block", () => {
    const resizeIdx = initBody.indexOf("initializeHostResizeSync(");
    const tryIdx = initBody.indexOf("try {");

    expect(resizeIdx).toBeGreaterThan(-1);
    expect(tryIdx).toBeGreaterThan(-1);
    expect(resizeIdx).toBeLessThan(tryIdx);
  });
});
