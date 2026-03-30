/**
 * Loading State Tests
 *
 * Validates the refresh-cycle state machine for the Metrics tab.
 * Five required behavioral tests per spec, plus edge cases.
 *
 * @see specs/045-professional-loading-feedback/spec.md — Required Test Coverage
 */
import {
  startRefresh,
  endRefresh,
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

    const token = startRefresh(metricsSection, regions);

    expect(token).toBeGreaterThan(0);
    expect(isActive()).toBe(true);

    for (const region of regions) {
      expect(region.classList.contains("metrics-loading")).toBe(true);
    }

    expect(metricsSection.getAttribute("aria-busy")).toBe("true");
  });

  it("returns a monotonically increasing token", () => {
    const metricsSection = createMockElement();
    const regions = createMockRegions(1);

    const token1 = startRefresh(metricsSection, regions);
    // End the first refresh before starting the next (to reset active state cleanly)
    endRefresh(token1, metricsSection, regions, null);

    const token2 = startRefresh(metricsSection, regions);
    expect(token2).toBeGreaterThan(token1);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Superseded request does not render stale results
// ---------------------------------------------------------------------------

describe("Superseded request does not render stale results", () => {
  it("endRefresh returns false for a stale token and keeps loading active", () => {
    const metricsSection = createMockElement();
    const regions = createMockRegions(3);
    const statusEl = createMockElement();

    const token1 = startRefresh(metricsSection, regions);
    const token2 = startRefresh(metricsSection, regions);

    // Stale refresh (token1) tries to end — should be rejected.
    const staleResult = endRefresh(token1, metricsSection, regions, statusEl);
    expect(staleResult).toBe(false);

    // Loading should still be active (token2 is in-flight).
    expect(isActive()).toBe(true);
    for (const region of regions) {
      expect(region.classList.contains("metrics-loading")).toBe(true);
    }
    expect(metricsSection.getAttribute("aria-busy")).toBe("true");
    expect(statusEl.textContent).toBe("");

    // Winning refresh (token2) ends — should succeed.
    const winResult = endRefresh(token2, metricsSection, regions, statusEl);
    expect(winResult).toBe(true);
    expect(isActive()).toBe(false);
    for (const region of regions) {
      expect(region.classList.contains("metrics-loading")).toBe(false);
    }
    expect(metricsSection.getAttribute("aria-busy")).toBeNull();
    expect(statusEl.textContent).toBe("Dashboard updated");
  });

  it("isStale correctly identifies superseded tokens", () => {
    const metricsSection = createMockElement();
    const regions = createMockRegions(1);

    const token1 = startRefresh(metricsSection, regions);
    expect(isStale(token1)).toBe(false);

    const token2 = startRefresh(metricsSection, regions);
    expect(isStale(token1)).toBe(true);
    expect(isStale(token2)).toBe(false);
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

    const token = startRefresh(metricsSection, regions);

    // Verify loading is active.
    expect(isActive()).toBe(true);

    // End the refresh (success).
    const result = endRefresh(token, metricsSection, regions, statusEl);

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

    const token = startRefresh(metricsSection, regions);
    endRefresh(token, metricsSection, regions, statusEl);

    expect(statusEl.textContent).toBe("Dashboard updated");

    jest.advanceTimersByTime(1000);
    expect(statusEl.textContent).toBe("");

    jest.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Test 4: Loading clears on failure
// ---------------------------------------------------------------------------

describe("Loading clears on failure", () => {
  it("endRefresh clears loading state identically to success path", () => {
    const metricsSection = createMockElement();
    const regions = createMockRegions(5);
    const statusEl = createMockElement();

    const token = startRefresh(metricsSection, regions);

    // Simulate failure: caller's catch block calls endRefresh with the same token.
    const result = endRefresh(token, metricsSection, regions, statusEl);

    expect(result).toBe(true);
    expect(isActive()).toBe(false);

    for (const region of regions) {
      expect(region.classList.contains("metrics-loading")).toBe(false);
    }

    expect(metricsSection.getAttribute("aria-busy")).toBeNull();
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
// Edge cases
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
  it("endRefresh handles null statusEl gracefully", () => {
    const metricsSection = createMockElement();
    const regions = createMockRegions(1);

    const token = startRefresh(metricsSection, regions);
    const result = endRefresh(token, metricsSection, regions, null);

    expect(result).toBe(true);
    expect(isActive()).toBe(false);
  });

  it("endRefresh with empty regions array does not throw", () => {
    const metricsSection = createMockElement();
    const regions: HTMLElement[] = [];

    const token = startRefresh(metricsSection, regions);
    expect(() => {
      endRefresh(token, metricsSection, regions, null);
    }).not.toThrow();
  });

  it("multiple rapid starts all increment token", () => {
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
});
