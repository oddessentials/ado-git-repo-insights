/**
 * Loading State Tests
 *
 * Validates the refresh-cycle state machine for the Metrics tab.
 * Five required behavioral tests per spec, plus regression tests
 * for correctness invariants, plus edge cases.
 */
import {
  startRefresh,
  endRefresh,
  failRefresh,
  isStale,
  isActive,
  getInFlightState,
  hasStateChanged,
  _resetForTesting,
  type EffectiveState,
} from "../../ui/modules/loading-state";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockElement(): HTMLElement {
  return document.createElement("div");
}

function createMockRegions(count: number): HTMLElement[] {
  return Array.from({ length: count }, () => createMockElement());
}

function makeState(overrides: Partial<EffectiveState> = {}): EffectiveState {
  return {
    filters: { repos: [], teams: [], reviewers: [], authors: [] },
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-03-29T00:00:00.000Z",
    comparisonMode: false,
    ...overrides,
  };
}

/** Flush the microtask queue so announce() writes to the live region. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetForTesting();
});

// ---------------------------------------------------------------------------
// Test 1: Loading starts on filter-triggered refresh
// ---------------------------------------------------------------------------

describe("Loading starts on filter-triggered refresh", () => {
  it("adds .metrics-loading to all regions and sets aria-busy", () => {
    const ms = createMockElement();
    const regions = createMockRegions(5);

    const id = startRefresh(ms, regions, makeState());

    expect(id).toBeGreaterThan(0);
    expect(isActive()).toBe(true);

    for (const region of regions) {
      expect(region.classList.contains("metrics-loading")).toBe(true);
    }

    expect(ms.getAttribute("aria-busy")).toBe("true");
  });

  it("returns a monotonically increasing cycle ID", () => {
    const ms = createMockElement();
    const regions = createMockRegions(1);

    const id1 = startRefresh(ms, regions, makeState());
    endRefresh(id1, ms, regions, null);

    const id2 = startRefresh(ms, regions, makeState());
    expect(id2).toBeGreaterThan(id1);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Superseded request does not render stale results
// ---------------------------------------------------------------------------

describe("Superseded request does not render stale results", () => {
  it("endRefresh returns false for a stale cycle and keeps loading active", async () => {
    const ms = createMockElement();
    const regions = createMockRegions(3);
    const statusEl = createMockElement();
    const stateA = makeState();
    const stateB = makeState({ comparisonMode: true });

    const id1 = startRefresh(ms, regions, stateA);
    const id2 = startRefresh(ms, regions, stateB);

    // Stale refresh (id1) tries to end — should be rejected.
    expect(endRefresh(id1, ms, regions, statusEl)).toBe(false);

    // Loading should still be active (id2 is in-flight).
    expect(isActive()).toBe(true);
    for (const region of regions) {
      expect(region.classList.contains("metrics-loading")).toBe(true);
    }
    expect(ms.getAttribute("aria-busy")).toBe("true");
    await flushMicrotasks();
    expect(statusEl.textContent).toBe("");

    // Winning refresh (id2) ends — should succeed.
    expect(endRefresh(id2, ms, regions, statusEl)).toBe(true);
    expect(isActive()).toBe(false);
    for (const region of regions) {
      expect(region.classList.contains("metrics-loading")).toBe(false);
    }
    expect(ms.getAttribute("aria-busy")).toBeNull();
    await flushMicrotasks();
    expect(statusEl.textContent).toBe("Dashboard updated");
  });

  it("isStale correctly identifies superseded cycles", () => {
    const ms = createMockElement();
    const regions = createMockRegions(1);

    const id1 = startRefresh(ms, regions, makeState());
    expect(isStale(id1)).toBe(false);

    const id2 = startRefresh(ms, regions, makeState({ comparisonMode: true }));
    expect(isStale(id1)).toBe(true);
    expect(isStale(id2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Loading clears on success
// ---------------------------------------------------------------------------

describe("Loading clears on success", () => {
  it("endRefresh removes loading class, aria-busy, and announces completion", async () => {
    const ms = createMockElement();
    const regions = createMockRegions(5);
    const statusEl = createMockElement();

    const id = startRefresh(ms, regions, makeState());
    expect(isActive()).toBe(true);

    const result = endRefresh(id, ms, regions, statusEl);

    expect(result).toBe(true);
    expect(isActive()).toBe(false);

    for (const region of regions) {
      expect(region.classList.contains("metrics-loading")).toBe(false);
    }

    expect(ms.getAttribute("aria-busy")).toBeNull();
    await flushMicrotasks();
    expect(statusEl.textContent).toBe("Dashboard updated");
  });

  it("clears the announcement text after 1 second", async () => {
    jest.useFakeTimers();

    const ms = createMockElement();
    const regions = createMockRegions(1);
    const statusEl = createMockElement();

    const id = startRefresh(ms, regions, makeState());
    endRefresh(id, ms, regions, statusEl);

    // Flush the microtask that writes the announcement.
    await flushMicrotasks();
    expect(statusEl.textContent).toBe("Dashboard updated");

    jest.advanceTimersByTime(1000);
    expect(statusEl.textContent).toBe("");

    jest.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Test 4: Loading clears on failure (via failRefresh)
// ---------------------------------------------------------------------------

describe("Loading clears on failure", () => {
  it("failRefresh clears loading class and aria-busy", () => {
    const ms = createMockElement();
    const regions = createMockRegions(5);

    const id = startRefresh(ms, regions, makeState());
    const result = failRefresh(id, ms, regions, null);

    expect(result).toBe(true);
    expect(isActive()).toBe(false);

    for (const region of regions) {
      expect(region.classList.contains("metrics-loading")).toBe(false);
    }

    expect(ms.getAttribute("aria-busy")).toBeNull();
  });

  it("failRefresh does NOT announce 'Dashboard updated'", async () => {
    const ms = createMockElement();
    const regions = createMockRegions(1);
    const statusEl = createMockElement();

    const id = startRefresh(ms, regions, makeState());
    failRefresh(id, ms, regions, statusEl);

    await flushMicrotasks();
    expect(statusEl.textContent).toBe("");
  });

  it("failRefresh clears stale success text from a prior endRefresh", async () => {
    jest.useFakeTimers();
    const ms = createMockElement();
    const regions = createMockRegions(1);
    const statusEl = createMockElement();

    // First refresh succeeds — "Dashboard updated" in live region.
    const id1 = startRefresh(ms, regions, makeState());
    endRefresh(id1, ms, regions, statusEl);
    await flushMicrotasks();
    expect(statusEl.textContent).toBe("Dashboard updated");

    // Second refresh fails within the 1s window.
    const id2 = startRefresh(ms, regions, makeState({ comparisonMode: true }));
    failRefresh(id2, ms, regions, statusEl);

    // Stale success text must be cleared.
    expect(statusEl.textContent).toBe("");

    // The first timer must also be cancelled — no wipe of later messages.
    jest.advanceTimersByTime(2000);
    expect(statusEl.textContent).toBe("");

    jest.useRealTimers();
  });

  it("queued success microtask does not write after a later failure", async () => {
    const ms = createMockElement();
    const regions = createMockRegions(1);
    const statusEl = createMockElement();

    // Refresh A succeeds — endRefresh queues microtask to write "Dashboard updated".
    const idA = startRefresh(ms, regions, makeState());
    endRefresh(idA, ms, regions, statusEl);
    // Do NOT flush microtasks yet — the write is still pending.

    // Refresh B starts and fails BEFORE A's microtask runs.
    const idB = startRefresh(ms, regions, makeState({ comparisonMode: true }));
    failRefresh(idB, ms, regions, statusEl);
    expect(statusEl.textContent).toBe("");

    // Now flush: A's microtask runs but must be a no-op (generation invalidated).
    await flushMicrotasks();
    expect(statusEl.textContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Test 5: No-op state change does not trigger loading
// ---------------------------------------------------------------------------

describe("No-op state change does not trigger loading", () => {
  it("hasStateChanged returns false for identical states", () => {
    expect(hasStateChanged(makeState(), makeState())).toBe(false);
  });

  it("hasStateChanged returns true for different filters", () => {
    const s2 = makeState({
      filters: { repos: ["my-repo"], teams: [], reviewers: [], authors: [] },
    });
    expect(hasStateChanged(makeState(), s2)).toBe(true);
  });

  it("hasStateChanged returns true for different date range", () => {
    expect(
      hasStateChanged(
        makeState(),
        makeState({ endDate: "2026-06-01T00:00:00.000Z" }),
      ),
    ).toBe(true);
  });

  it("hasStateChanged returns true for different comparison mode", () => {
    expect(
      hasStateChanged(makeState(), makeState({ comparisonMode: true })),
    ).toBe(true);
  });

  it("hasStateChanged returns true when previous state is null (first load)", () => {
    expect(hasStateChanged(null, makeState())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression: correctness invariants
// ---------------------------------------------------------------------------

describe("Regression: failed refresh for unchanged state remains retryable", () => {
  it("hasStateChanged returns true after a failed refresh for the same state", () => {
    const stateA = makeState({ comparisonMode: true });
    expect(hasStateChanged(null, stateA)).toBe(true);
    // Simulate failure: lastEffectiveState NOT updated. Retry must pass.
    expect(hasStateChanged(null, stateA)).toBe(true);
  });

  it("hasStateChanged returns true when retrying after failure with prior committed state", () => {
    const stateA = makeState();
    const stateB = makeState({ comparisonMode: true });
    expect(hasStateChanged(stateA, stateB)).toBe(true);
  });
});

describe("Regression: older refresh cannot render after a newer refresh starts", () => {
  it("isStale returns true for older cycle once newer cycle starts", () => {
    const ms = createMockElement();
    const regions = createMockRegions(1);

    const oldId = startRefresh(ms, regions, makeState());
    expect(isStale(oldId)).toBe(false);

    startRefresh(ms, regions, makeState({ comparisonMode: true }));
    expect(isStale(oldId)).toBe(true);
  });

  it("endRefresh rejects stale cycle even after data loads", async () => {
    const ms = createMockElement();
    const regions = createMockRegions(1);
    const statusEl = createMockElement();

    const oldId = startRefresh(ms, regions, makeState());
    const newId = startRefresh(
      ms,
      regions,
      makeState({ comparisonMode: true }),
    );

    expect(endRefresh(oldId, ms, regions, statusEl)).toBe(false);
    await flushMicrotasks();
    expect(statusEl.textContent).toBe("");

    expect(endRefresh(newId, ms, regions, statusEl)).toBe(true);
    await flushMicrotasks();
    expect(statusEl.textContent).toBe("Dashboard updated");
  });

  it("failRefresh also rejects stale cycles", () => {
    const ms = createMockElement();
    const regions = createMockRegions(1);

    const oldId = startRefresh(ms, regions, makeState());
    startRefresh(ms, regions, makeState({ comparisonMode: true }));

    expect(failRefresh(oldId, ms, regions, null)).toBe(false);
    expect(isActive()).toBe(true);
  });
});

describe("Regression: failed refresh does not announce success to assistive tech", () => {
  it("failRefresh clears status text instead of announcing", () => {
    const ms = createMockElement();
    const regions = createMockRegions(1);
    const statusEl = createMockElement();
    statusEl.textContent = "leftover text";

    const id = startRefresh(ms, regions, makeState());
    failRefresh(id, ms, regions, statusEl);

    expect(statusEl.textContent).toBe("");
  });

  it("endRefresh announces but failRefresh does not for same scenario", async () => {
    const ms = createMockElement();
    const regions = createMockRegions(1);
    const statusEl = createMockElement();

    const successId = startRefresh(ms, regions, makeState());
    endRefresh(successId, ms, regions, statusEl);
    await flushMicrotasks();
    expect(statusEl.textContent).toBe("Dashboard updated");

    _resetForTesting();
    statusEl.textContent = "";

    const failId = startRefresh(ms, regions, makeState());
    failRefresh(failId, ms, regions, statusEl);
    expect(statusEl.textContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// In-flight state tracking (A→B→A revert)
// ---------------------------------------------------------------------------

describe("In-flight state tracking", () => {
  it("getInFlightState returns the target state of the active refresh", () => {
    const ms = createMockElement();
    const regions = createMockRegions(1);
    const stateB = makeState({ comparisonMode: true });

    expect(getInFlightState()).toBeNull();

    startRefresh(ms, regions, stateB);
    expect(getInFlightState()).toEqual(stateB);
  });

  it("getInFlightState returns null after refresh completes", () => {
    const ms = createMockElement();
    const regions = createMockRegions(1);

    const id = startRefresh(ms, regions, makeState());
    endRefresh(id, ms, regions, null);

    expect(getInFlightState()).toBeNull();
  });

  it("A→B→A: in-flight B is superseded because A differs from B", () => {
    const ms = createMockElement();
    const regions = createMockRegions(1);
    const stateA = makeState();
    const stateB = makeState({ comparisonMode: true });

    // Refresh for B starts.
    startRefresh(ms, regions, stateB);
    expect(getInFlightState()).toEqual(stateB);

    // User reverts to A — differs from in-flight B, so must start new cycle.
    expect(hasStateChanged(getInFlightState(), stateA)).toBe(true);

    // New cycle supersedes B.
    const newId = startRefresh(ms, regions, stateA);
    expect(getInFlightState()).toEqual(stateA);
    expect(isStale(newId)).toBe(false);
  });

  it("B→B: in-flight B matches new B, so no new cycle needed", () => {
    const ms = createMockElement();
    const regions = createMockRegions(1);
    const stateB = makeState({ comparisonMode: true });

    startRefresh(ms, regions, stateB);

    // Same state B again — should be a no-op (caller checks this).
    expect(hasStateChanged(getInFlightState(), stateB)).toBe(false);
  });

  it("getInFlightState returns null after failRefresh", () => {
    const ms = createMockElement();
    const regions = createMockRegions(1);

    const id = startRefresh(ms, regions, makeState());
    failRefresh(id, ms, regions, null);

    expect(getInFlightState()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Announcement: back-to-back and failure paths
// ---------------------------------------------------------------------------

describe("Back-to-back success announcements", () => {
  it("second announcement is a distinct DOM mutation via microtask clear", async () => {
    const ms = createMockElement();
    const regions = createMockRegions(1);
    const statusEl = createMockElement();

    // First success.
    const id1 = startRefresh(ms, regions, makeState());
    endRefresh(id1, ms, regions, statusEl);
    await flushMicrotasks();
    expect(statusEl.textContent).toBe("Dashboard updated");

    // Second success — text is cleared synchronously, then rewritten in microtask.
    const id2 = startRefresh(ms, regions, makeState({ comparisonMode: true }));
    endRefresh(id2, ms, regions, statusEl);

    // After endRefresh but before microtask: text was cleared to force mutation.
    expect(statusEl.textContent).toBe("");

    // After microtask: rewritten.
    await flushMicrotasks();
    expect(statusEl.textContent).toBe("Dashboard updated");
  });
});

describe("Announcement timer cancellation", () => {
  it("second completion announcement survives the first timer", async () => {
    jest.useFakeTimers();

    const ms = createMockElement();
    const regions = createMockRegions(1);
    const statusEl = createMockElement();

    // First refresh completes.
    const id1 = startRefresh(ms, regions, makeState());
    endRefresh(id1, ms, regions, statusEl);
    await flushMicrotasks();
    expect(statusEl.textContent).toBe("Dashboard updated");

    // 500ms later, second refresh completes.
    jest.advanceTimersByTime(500);
    const id2 = startRefresh(ms, regions, makeState({ comparisonMode: true }));
    endRefresh(id2, ms, regions, statusEl);
    await flushMicrotasks();
    expect(statusEl.textContent).toBe("Dashboard updated");

    // At 1000ms total — first timer would have fired. Must still be present.
    jest.advanceTimersByTime(500);
    expect(statusEl.textContent).toBe("Dashboard updated");

    // At 1500ms — second timer fires.
    jest.advanceTimersByTime(500);
    expect(statusEl.textContent).toBe("");

    jest.useRealTimers();
  });

  it("_resetForTesting clears pending timer state", async () => {
    jest.useFakeTimers();

    const ms = createMockElement();
    const regions = createMockRegions(1);
    const statusEl = createMockElement();

    const id = startRefresh(ms, regions, makeState());
    endRefresh(id, ms, regions, statusEl);
    await flushMicrotasks();
    expect(statusEl.textContent).toBe("Dashboard updated");

    _resetForTesting();

    jest.advanceTimersByTime(2000);
    expect(statusEl.textContent).toBe("Dashboard updated");

    jest.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Spinner DOM lifecycle
// ---------------------------------------------------------------------------

describe("Spinner DOM lifecycle", () => {
  it("startRefresh appends a .metrics-loading-spinner to each region", () => {
    const ms = createMockElement();
    const regions = createMockRegions(3);

    startRefresh(ms, regions, makeState());

    for (const region of regions) {
      const spinner = region.querySelector(".metrics-loading-spinner");
      expect(spinner).not.toBeNull();
      expect(spinner?.tagName).toBe("DIV");
    }
  });

  it("startRefresh twice does NOT create duplicate spinner elements", () => {
    const ms = createMockElement();
    const regions = createMockRegions(2);

    startRefresh(ms, regions, makeState());
    startRefresh(ms, regions, makeState({ comparisonMode: true }));

    for (const region of regions) {
      const spinners = region.querySelectorAll(".metrics-loading-spinner");
      expect(spinners.length).toBe(1);
    }
  });

  it("spinner removed on success (endRefresh)", () => {
    const ms = createMockElement();
    const regions = createMockRegions(2);

    const id = startRefresh(ms, regions, makeState());
    for (const region of regions) {
      expect(region.querySelector(".metrics-loading-spinner")).not.toBeNull();
    }

    endRefresh(id, ms, regions, null);

    for (const region of regions) {
      expect(region.querySelector(".metrics-loading-spinner")).toBeNull();
    }
  });

  it("spinner removed on failure (failRefresh)", () => {
    const ms = createMockElement();
    const regions = createMockRegions(2);

    const id = startRefresh(ms, regions, makeState());
    failRefresh(id, ms, regions, null);

    for (const region of regions) {
      expect(region.querySelector(".metrics-loading-spinner")).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
  it("endRefresh handles null statusEl gracefully", () => {
    const ms = createMockElement();
    const regions = createMockRegions(1);

    const id = startRefresh(ms, regions, makeState());
    expect(endRefresh(id, ms, regions, null)).toBe(true);
    expect(isActive()).toBe(false);
  });

  it("endRefresh with empty regions array does not throw", () => {
    const ms = createMockElement();
    const id = startRefresh(ms, [], makeState());
    expect(() => {
      endRefresh(id, ms, [], null);
    }).not.toThrow();
  });

  it("failRefresh with empty regions array does not throw", () => {
    const ms = createMockElement();
    const id = startRefresh(ms, [], makeState());
    expect(() => {
      failRefresh(id, ms, [], null);
    }).not.toThrow();
  });

  it("multiple rapid starts all increment cycle ID", () => {
    const ms = createMockElement();
    const regions = createMockRegions(1);

    const t1 = startRefresh(ms, regions, makeState());
    const t2 = startRefresh(ms, regions, makeState({ comparisonMode: true }));
    const t3 = startRefresh(
      ms,
      regions,
      makeState({ endDate: "2027-01-01T00:00:00.000Z" }),
    );

    expect(t1).toBeLessThan(t2);
    expect(t2).toBeLessThan(t3);
    expect(isStale(t1)).toBe(true);
    expect(isStale(t2)).toBe(true);
    expect(isStale(t3)).toBe(false);
  });
});
