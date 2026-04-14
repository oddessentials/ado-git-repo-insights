/**
 * Behavioral tests for host iframe resize synchronization.
 *
 * Verifies that the shared host-resize module correctly calls
 * SDK.resize via the resizeHost wrapper when observed container
 * dimensions change or the window resizes.
 */

import {
  initializeHostResizeSync,
  teardownHostResizeSync,
  syncHostHeight,
  scheduleHostResize,
} from "../ui/modules/shared/host-resize";

import {
  setupSdkMocks,
  teardownSdkMocks,
  mockSdkModule,
} from "./harness/vss-sdk-mock";

import { initializeAdoSdk } from "../ui/modules/sdk";

// ---------------------------------------------------------------------------
// ResizeObserver mock — jsdom does not provide one
// ---------------------------------------------------------------------------

type ROCallback = (entries: ResizeObserverEntry[]) => void;

let lastObserverCallback: ROCallback | null = null;
let lastObservedElement: Element | null = null;
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
    /* no-op */
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
  if (id >= 1 && id <= rafCallbacks.length) {
    rafCallbacks[id - 1] = () => {};
  }
}

function flushRaf(): void {
  const pending = rafCallbacks.splice(0);
  for (const cb of pending) cb();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("host-resize module", () => {
  beforeEach(async () => {
    // Install mocks
    (globalThis as Record<string, unknown>).ResizeObserver = MockResizeObserver;
    (globalThis as Record<string, unknown>).requestAnimationFrame = mockRaf;
    (globalThis as Record<string, unknown>).cancelAnimationFrame =
      mockCancelRaf;
    rafCallbacks = [];
    lastObserverCallback = null;
    lastObservedElement = null;

    // Setup SDK mocks and initialize so resizeHost guard passes
    setupSdkMocks();
    await initializeAdoSdk();

    // Provide a container for the observer
    document.body.innerHTML = '<div class="settings-container">initial</div>';

    // jsdom has no layout engine — scrollHeight is always 0.
    // Stub a realistic value so syncHostHeight passes the > 0 guard.
    Object.defineProperty(document.body, "scrollHeight", {
      value: 600,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: 600,
      configurable: true,
    });
  });

  afterEach(() => {
    teardownHostResizeSync();
    teardownSdkMocks();
    document.body.innerHTML = "";
    delete (globalThis as Record<string, unknown>).ResizeObserver;
    delete (globalThis as Record<string, unknown>).requestAnimationFrame;
    delete (globalThis as Record<string, unknown>).cancelAnimationFrame;
  });

  it("calls SDK.resize with the document height after initialization", () => {
    initializeHostResizeSync(".settings-container");
    flushRaf();

    expect(mockSdkModule.resize).toHaveBeenCalledTimes(1);
    const height = (mockSdkModule.resize as jest.Mock).mock
      .calls[0][1] as number;
    expect(height).toBeGreaterThan(0);
  });

  it("attaches a ResizeObserver to the specified container", () => {
    initializeHostResizeSync(".settings-container");

    expect(lastObservedElement).toBe(
      document.querySelector(".settings-container"),
    );
  });

  it("calls SDK.resize when the ResizeObserver fires", () => {
    initializeHostResizeSync(".settings-container");
    flushRaf();
    (mockSdkModule.resize as jest.Mock).mockClear();

    lastObserverCallback!([] as ResizeObserverEntry[]);
    flushRaf();

    expect(mockSdkModule.resize).toHaveBeenCalledTimes(1);
  });

  it("calls SDK.resize on window resize events", () => {
    initializeHostResizeSync(".settings-container");
    flushRaf();
    (mockSdkModule.resize as jest.Mock).mockClear();

    window.dispatchEvent(new Event("resize"));
    flushRaf();

    expect(mockSdkModule.resize).toHaveBeenCalledTimes(1);
  });

  it("coalesces rapid calls into a single resize per frame", () => {
    initializeHostResizeSync(".settings-container");
    flushRaf();
    (mockSdkModule.resize as jest.Mock).mockClear();

    scheduleHostResize();
    scheduleHostResize();
    scheduleHostResize();
    flushRaf();

    expect(mockSdkModule.resize).toHaveBeenCalledTimes(1);
  });

  it("is safe to call initializeHostResizeSync twice (idempotent)", () => {
    initializeHostResizeSync(".settings-container");
    flushRaf();
    (mockSdkModule.resize as jest.Mock).mockClear();

    initializeHostResizeSync(".settings-container");
    flushRaf();

    expect(mockSdkModule.resize).toHaveBeenCalledTimes(1);
  });

  it("does not call resize when SDK is not initialized", async () => {
    // Reset SDK state to simulate pre-init
    const { resetSdkState } = await import("../ui/modules/sdk");
    resetSdkState();

    syncHostHeight();

    expect(mockSdkModule.resize).not.toHaveBeenCalled();
  });

  it("does not depend on globalThis.VSS", () => {
    // Ensure no globalThis.VSS is set
    delete (globalThis as Record<string, unknown>).VSS;

    initializeHostResizeSync(".settings-container");
    flushRaf();

    // Resize still works through the SDK mock
    expect(mockSdkModule.resize).toHaveBeenCalledTimes(1);
  });

  it("skips the observer when ResizeObserver is unavailable", () => {
    delete (globalThis as Record<string, unknown>).ResizeObserver;
    (mockSdkModule.resize as jest.Mock).mockClear();

    initializeHostResizeSync(".settings-container");
    flushRaf();

    expect(lastObservedElement).toBeNull();
    expect(mockSdkModule.resize).toHaveBeenCalledTimes(1);
  });

  it("syncHostHeight passes undefined width and computed height", () => {
    syncHostHeight();
    expect(mockSdkModule.resize).toHaveBeenCalledWith(
      undefined,
      expect.any(Number),
    );
  });

  it("does not call resize after teardown", () => {
    initializeHostResizeSync(".settings-container");
    flushRaf();
    (mockSdkModule.resize as jest.Mock).mockClear();

    teardownHostResizeSync();

    // Stale rAF should not fire
    flushRaf();
    expect(mockSdkModule.resize).not.toHaveBeenCalled();
  });

  it("does not call resize when a queued rAF fires after re-initialization", () => {
    initializeHostResizeSync(".settings-container");
    // Don't flush — rAF is pending from first init

    // Re-initialize (bumps generation, stale callback becomes no-op)
    initializeHostResizeSync(".settings-container");
    flushRaf();

    // Only the re-init resize should fire, not the stale one
    expect(mockSdkModule.resize).toHaveBeenCalledTimes(1);
  });

  it("post-SDK-init syncHostHeight triggers resize even when pre-init call no-ops", async () => {
    const { resetSdkState } = await import("../ui/modules/sdk");
    resetSdkState();

    // Pre-init: initializeHostResizeSync schedules a resize, but
    // resizeHost no-ops because SDK isn't callable yet.
    initializeHostResizeSync(".settings-container");
    flushRaf();
    expect(mockSdkModule.resize).not.toHaveBeenCalled();

    // SDK init completes — wrappers now callable.
    await initializeAdoSdk();
    (mockSdkModule.resize as jest.Mock).mockClear();

    // Explicit post-init syncHostHeight (as settings.ts now does).
    syncHostHeight();

    expect(mockSdkModule.resize).toHaveBeenCalledTimes(1);
    expect(mockSdkModule.resize).toHaveBeenCalledWith(
      undefined,
      expect.any(Number),
    );
  });

  it("final resize fires after async settings content renders (no ResizeObserver)", async () => {
    // Remove ResizeObserver to simulate non-supporting host
    delete (globalThis as Record<string, unknown>).ResizeObserver;

    await initializeAdoSdk();
    (mockSdkModule.resize as jest.Mock).mockClear();

    // Simulate the settings init sequence: initial resize, then
    // async content that grows the page, then final resize.
    syncHostHeight(); // post-SDK-init resize (line 104 in settings.ts)

    // Simulate async DOM mutations (dropdown, settings, status)
    document.body.innerHTML +=
      '<div class="settings-content">Project dropdown with many options</div>';
    Object.defineProperty(document.body, "scrollHeight", {
      value: 900,
      configurable: true,
    });

    // Final resize after async content (line 128 in settings.ts)
    syncHostHeight();

    // Must have been called at least twice — once post-init, once post-render
    expect(
      (mockSdkModule.resize as jest.Mock).mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
    // Last call should use the updated height
    const lastCall = (mockSdkModule.resize as jest.Mock).mock.calls.at(-1);
    expect(lastCall?.[1]).toBe(900);
  });

  it("final resize fires after error content renders (no ResizeObserver)", async () => {
    // Remove ResizeObserver to simulate non-supporting host
    delete (globalThis as Record<string, unknown>).ResizeObserver;

    await initializeAdoSdk();
    (mockSdkModule.resize as jest.Mock).mockClear();

    // Simulate error path: error message is added to DOM
    document.body.innerHTML +=
      '<div class="error-state">Failed to initialize settings: Service unavailable</div>';
    Object.defineProperty(document.body, "scrollHeight", {
      value: 700,
      configurable: true,
    });

    // Final resize after error content (catch block in settings.ts)
    syncHostHeight();

    expect(mockSdkModule.resize).toHaveBeenCalledTimes(1);
    const call = (mockSdkModule.resize as jest.Mock).mock.calls[0];
    expect(call?.[1]).toBe(700);
  });
});
