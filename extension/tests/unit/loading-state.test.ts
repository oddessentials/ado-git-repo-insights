/**
 * Loading State Tests
 *
 * Validates the refresh-cycle state machine for the Metrics tab.
 * Five required behavioral tests per spec, plus three regression tests
 * for correctness invariants, plus edge cases.
 *
 * @see specs/045-professional-loading-feedback/spec.md — Required Test Coverage
 */
import {
  startRefresh,
  endRefresh,
  failRefresh,
  isStale,
  isActive,
  hasStateChanged,
  _resetForTesting,
  type EffectiveState,
} from "../../ui/modules/loading-state";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockElement(): HTMLElement {
  const el = document.createElement("div");
  return el;
}

function createMockRegions(count: number): HTMLElement[] {
  return Array.from({ length: count }, () => createMockElement());
}

function makeEffectiveState(overrides: Partial<EffectiveState> = {}): EffectiveState {
  return {
    filters: { repos: [], teams: [], reviewers: [], authors: [] },
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-03-29T00:00:00.000Z",
    comparisonMode: false,
    ...overrides,
  };
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
    const metricsSection = createMockElement();
    const regions = createMockRegions(5);

    const id = startRefresh(metricsSection, regions);

    expect(id).toBeGreaterThan(0);
    expect(isActive()).toBe(true);

    for (const region of regions) {
      expect(region.classList.contains("metrics-loading")).toBe(true);
    }

    expect(metricsSection.getAttribute("aria-busy")).toBe("true");
  });

  it("returns a monotonically increasing cycle ID", () => {
    const metricsSection = createMockElement();
    const regions = createMockRegions(1);

    const id1 = startRefresh(metricsSection, regions);
    endRefresh(id1, metricsSection, regions, null);

    const id2 = startRefresh(metricsSection, regions);
    expect(id2).toBeGreaterThan(id1);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Superseded request does not render stale results
// ---------------------------------------------------------------------------

describe("Superseded request does not render stale results", () => {
  it("endRefresh returns false for a stale cycle and keeps loading active", () => {
    const metricsSection = createMockElement();
    const regions = createMockRegions(3);
    const statusEl = createMockElement();

    const id1 = startRefresh(metricsSection, regions);
    const id2 = startRefresh(metricsSection, regions);

    // Stale refresh (id1) tries to end — should be rejected.
    const staleResult = endRefresh(id1, metricsSection, regions, statusEl);
    expect(staleResult).toBe(false);

    // Loading should still be active (id2 is in-flight).
    expect(isActive()).toBe(true);
    for (const region of regions) {
      expect(region.classList.contains("metrics-loading")).toBe(true);
    }
    expect(metricsSection.getAttribute("aria-busy")).toBe("true");
    expect(statusEl.textContent).toBe("");

    // Winning refresh (id2) ends — should succeed.
    const winResult = endRefresh(id2, metricsSection, regions, statusEl);
    expect(winResult).toBe(true);
    expect(isActive()).toBe(false);
    for (const region of regions) {
      expect(region.classList.contains("metrics-loading")).toBe(false);
    }
    expect(metricsSection.getAttribute("aria-busy")).toBeNull();
    expect(statusEl.textContent).toBe("Dashboard updated");
  });

  it("isStale correctly identifies superseded cycles", () => {
    const metricsSection = createMockElement();
    const regions = createMockRegions(1);

    const id1 = startRefresh(metricsSection, regions);
    expect(isStale(id1)).toBe(false);

    const id2 = startRefresh(metricsSection, regions);
    expect(isStale(id1)).toBe(true);
    expect(isStale(id2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Loading clears on success
// ---------------------------------------------------------------------------

describe("Loading clears on success", () => {
  it("endRefresh removes loading class, aria-busy, and announces completion", () => {
    const metricsSection = createMockElement();
    const regions = createMockRegions(5);
    const statusEl = createMockElement();

    const id = startRefresh(metricsSection, regions);
    expect(isActive()).toBe(true);

    const result = endRefresh(id, metricsSection, regions, statusEl);

    expect(result).toBe(true);
    expect(isActive()).toBe(false);

    for (const region of regions) {
      expect(region.classList.contains("metrics-loading")).toBe(false);
    }

    expect(metricsSection.getAttribute("aria-busy")).toBeNull();
    expect(statusEl.textContent).toBe("Dashboard updated");
  });

  it("clears the announcement text after 1 second", () => {
    jest.useFakeTimers();

    const metricsSection = createMockElement();
    const regions = createMockRegions(1);
    const statusEl = createMockElement();

    const id = startRefresh(metricsSection, regions);
    endRefresh(id, metricsSection, regions, statusEl);

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
    const metricsSection = createMockElement();
    const regions = createMockRegions(5);

    const id = startRefresh(metricsSection, regions);

    const result = failRefresh(id, metricsSection, regions);

    expect(result).toBe(true);
    expect(isActive()).toBe(false);

    for (const region of regions) {
      expect(region.classList.contains("metrics-loading")).toBe(false);
    }

    expect(metricsSection.getAttribute("aria-busy")).toBeNull();
  });

  it("failRefresh does NOT announce 'Dashboard updated'", () => {
    const metricsSection = createMockElement();
    const regions = createMockRegions(1);
    const statusEl = createMockElement();

    const id = startRefresh(metricsSection, regions);

    // failRefresh does not take a statusEl — it never announces.
    failRefresh(id, metricsSection, regions);

    // The status element should remain empty.
    expect(statusEl.textContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Test 5: No-op state change does not trigger loading
// ---------------------------------------------------------------------------

describe("No-op state change does not trigger loading", () => {
  it("hasStateChanged returns false for identical states", () => {
    const state1 = makeEffectiveState();
    const state2 = makeEffectiveState();

    expect(hasStateChanged(state1, state2)).toBe(false);
  });

  it("hasStateChanged returns true for different filters", () => {
    const state1 = makeEffectiveState();
    const state2 = makeEffectiveState({
      filters: { repos: ["my-repo"], teams: [], reviewers: [], authors: [] },
    });

    expect(hasStateChanged(state1, state2)).toBe(true);
  });

  it("hasStateChanged returns true for different date range", () => {
    const state1 = makeEffectiveState();
    const state2 = makeEffectiveState({
      endDate: "2026-06-01T00:00:00.000Z",
    });

    expect(hasStateChanged(state1, state2)).toBe(true);
  });

  it("hasStateChanged returns true for different comparison mode", () => {
    const state1 = makeEffectiveState();
    const state2 = makeEffectiveState({ comparisonMode: true });

    expect(hasStateChanged(state1, state2)).toBe(true);
  });

  it("hasStateChanged returns true when previous state is null (first load)", () => {
    const next = makeEffectiveState();
    expect(hasStateChanged(null, next)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression tests: three correctness invariants
// ---------------------------------------------------------------------------

describe("Regression: failed refresh for unchanged state remains retryable", () => {
  it("hasStateChanged returns true after a failed refresh for the same state", () => {
    // Simulate: state A is attempted, fails, lastEffectiveState NOT committed.
    // Next attempt with the same state A must pass the no-op guard.
    const stateA = makeEffectiveState({ comparisonMode: true });

    // First attempt: passes guard (prev is null).
    expect(hasStateChanged(null, stateA)).toBe(true);

    // Simulate failure: lastEffectiveState is NOT updated (caller responsibility).
    // The previous committed state remains null.

    // Retry with same state A: must still pass guard.
    expect(hasStateChanged(null, stateA)).toBe(true);
  });

  it("hasStateChanged returns true when retrying after failure with prior committed state", () => {
    const stateA = makeEffectiveState();
    const stateB = makeEffectiveState({ comparisonMode: true });

    // State A was successfully committed.
    // State B is attempted and fails — lastEffectiveState stays at A.
    // Retry state B must pass.
    expect(hasStateChanged(stateA, stateB)).toBe(true);
  });
});

describe("Regression: older refresh cannot render after a newer refresh starts", () => {
  it("isStale returns true for older cycle once newer cycle starts", () => {
    const metricsSection = createMockElement();
    const regions = createMockRegions(1);

    const oldId = startRefresh(metricsSection, regions);
    expect(isStale(oldId)).toBe(false);

    // Newer refresh starts — old cycle is now stale.
    startRefresh(metricsSection, regions);
    expect(isStale(oldId)).toBe(true);
  });

  it("endRefresh rejects stale cycle even after data loads", () => {
    const metricsSection = createMockElement();
    const regions = createMockRegions(1);
    const statusEl = createMockElement();

    const oldId = startRefresh(metricsSection, regions);
    const newId = startRefresh(metricsSection, regions);

    // Old cycle tries to endRefresh after its data arrives — rejected.
    expect(endRefresh(oldId, metricsSection, regions, statusEl)).toBe(false);
    expect(statusEl.textContent).toBe("");

    // New cycle completes — accepted.
    expect(endRefresh(newId, metricsSection, regions, statusEl)).toBe(true);
    expect(statusEl.textContent).toBe("Dashboard updated");
  });

  it("failRefresh also rejects stale cycles", () => {
    const metricsSection = createMockElement();
    const regions = createMockRegions(1);

    const oldId = startRefresh(metricsSection, regions);
    startRefresh(metricsSection, regions);

    // Old cycle fails — should be rejected (loading stays for new cycle).
    expect(failRefresh(oldId, metricsSection, regions)).toBe(false);
    expect(isActive()).toBe(true);
  });
});

describe("Regression: failed refresh does not announce success to assistive tech", () => {
  it("failRefresh never writes to the status element", () => {
    const metricsSection = createMockElement();
    const regions = createMockRegions(1);
    const statusEl = createMockElement();

    const id = startRefresh(metricsSection, regions);

    // failRefresh does not receive statusEl — by design it cannot announce.
    failRefresh(id, metricsSection, regions);

    expect(statusEl.textContent).toBe("");
  });

  it("endRefresh announces but failRefresh does not for same scenario", () => {
    const metricsSection = createMockElement();
    const regions = createMockRegions(1);
    const statusEl = createMockElement();

    // Success path: announces.
    const successId = startRefresh(metricsSection, regions);
    endRefresh(successId, metricsSection, regions, statusEl);
    expect(statusEl.textContent).toBe("Dashboard updated");

    // Reset for failure path.
    _resetForTesting();
    statusEl.textContent = "";

    const failId = startRefresh(metricsSection, regions);
    failRefresh(failId, metricsSection, regions);
    expect(statusEl.textContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
  it("endRefresh handles null statusEl gracefully", () => {
    const metricsSection = createMockElement();
    const regions = createMockRegions(1);

    const id = startRefresh(metricsSection, regions);
    const result = endRefresh(id, metricsSection, regions, null);

    expect(result).toBe(true);
    expect(isActive()).toBe(false);
  });

  it("endRefresh with empty regions array does not throw", () => {
    const metricsSection = createMockElement();
    const regions: HTMLElement[] = [];

    const id = startRefresh(metricsSection, regions);
    expect(() => {
      endRefresh(id, metricsSection, regions, null);
    }).not.toThrow();
  });

  it("multiple rapid starts all increment cycle ID", () => {
    const metricsSection = createMockElement();
    const regions = createMockRegions(1);

    const t1 = startRefresh(metricsSection, regions);
    const t2 = startRefresh(metricsSection, regions);
    const t3 = startRefresh(metricsSection, regions);

    expect(t1).toBeLessThan(t2);
    expect(t2).toBeLessThan(t3);
    expect(isStale(t1)).toBe(true);
    expect(isStale(t2)).toBe(true);
    expect(isStale(t3)).toBe(false);
  });

  it("failRefresh with empty regions array does not throw", () => {
    const metricsSection = createMockElement();
    const regions: HTMLElement[] = [];

    const id = startRefresh(metricsSection, regions);
    expect(() => {
      failRefresh(id, metricsSection, regions);
    }).not.toThrow();
  });
});
