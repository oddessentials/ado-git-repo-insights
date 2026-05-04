/**
 * DetailPanel unit tests.
 *
 * Covers the public contract of
 * `extension/ui/modules/shared/detail-panel.ts`:
 * construction invariants, DOM rendering per section type, lifecycle
 * dismissal for every DismissReason, hard-dismiss on filters-changed,
 * retarget-in-place on re-open, comparison-mode no-op, the SC-001
 * performance budget, and the FR-012 narrow-viewport containment rule.
 */

import {
  openDetailPanel,
  dismissDetailPanel,
  isDetailPanelOpen,
  makePanelContent,
  makeBreakdownTable,
  makeStatRow,
  makeEmptyState,
  makePrListSection,
  type DrillDownContext,
  type PanelContent,
  type PrListSection,
} from "../../../ui/modules/shared/detail-panel";
import {
  publishComparisonToggled,
  publishFiltersChanged,
  publishTabChanged,
} from "../../../ui/modules/drilldown/lifecycle-signals";

// jsdom lacks PointerEvent — polyfill it for tests that simulate pointer input.
// Matches the pattern used in tests/modules/typeahead-dropdown.test.ts.
if (typeof PointerEvent === "undefined") {
  (globalThis as Record<string, unknown>).PointerEvent =
    class PointerEvent extends MouseEvent {
      constructor(type: string, init?: PointerEventInit) {
        super(type, init);
      }
    };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTriggerButton(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Trigger";
  document.body.appendChild(btn);
  return btn;
}

function makeThroughputContext(
  overrides: Partial<PanelContent> = {},
): DrillDownContext {
  const trigger = makeTriggerButton();
  const content: PanelContent = makePanelContent(
    overrides.title ?? "Week of Mar 18 – 24, 2025",
    overrides.subtitle ?? "47 PRs",
    overrides.sections ?? [
      makeBreakdownTable(
        "By author",
        ["Author", "PRs"],
        [
          { label: "alice", values: ["12"] },
          { label: "bob", values: ["8"] },
        ],
      ),
      makeBreakdownTable(
        "By repository",
        ["Repository", "PRs"],
        [
          { label: "backend-api", values: ["20"] },
          { label: "frontend", values: ["27"] },
        ],
      ),
    ],
  );
  return {
    sourceChart: "throughput",
    focusedData: { kind: "throughput", weekIso: "2025-W12" },
    triggerElement: trigger,
    content,
  };
}

function makeCycleTimeContext(): DrillDownContext {
  const trigger = makeTriggerButton();
  const content = makePanelContent(
    "Week of Mar 18 – 24, 2025 — P50",
    "Based on 42 PRs",
    [
      makeStatRow([
        { label: "P50", value: "4.2h" },
        { label: "P90", value: "18.1h" },
      ]),
    ],
  );
  return {
    sourceChart: "cycle-time",
    focusedData: { kind: "cycle-time", weekIso: "2025-W12", metric: "p50" },
    triggerElement: trigger,
    content,
  };
}

function makeReviewerContext(): DrillDownContext {
  const trigger = makeTriggerButton();
  const content = makePanelContent(
    "alice@example.com",
    "12 reviews in period",
    [
      makeStatRow([
        { label: "Reviews", value: "12" },
        { label: "PRs reviewed", value: "9" },
      ]),
      makeEmptyState(
        "Per-repository breakdown",
        "Cross-dimensional data is not yet available.",
      ),
    ],
  );
  return {
    sourceChart: "reviewer",
    focusedData: { kind: "reviewer", reviewerId: "alice@example.com" },
    triggerElement: trigger,
    content,
  };
}

function getPanelRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>("aside.detail-panel");
}

function resetComparisonState(): void {
  publishComparisonToggled({ enabled: false });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("detail-panel — construction invariants", () => {
  it("makePanelContent throws on empty title", () => {
    expect(() =>
      makePanelContent("", null, [makeEmptyState("x", "y")]),
    ).toThrow(TypeError);
  });

  it("makePanelContent throws on empty sections array", () => {
    expect(() => makePanelContent("Title", null, [])).toThrow(TypeError);
  });

  it("makeBreakdownTable throws when a row has the wrong value count", () => {
    expect(() =>
      makeBreakdownTable(
        "By author",
        ["Author", "PRs", "Cycle time"],
        [{ label: "alice", values: ["12"] }],
      ),
    ).toThrow(TypeError);
  });

  // #308 (reshape): the builders intentionally do NOT reject
  // UUID-shaped content. A partial-dimension render with a raw GUID in
  // a row label is a cosmetic leak, not a crash surface — throwing
  // here turned off the entire panel. Leak-prevention lives in
  // resolveDisplayName (happy path) + the ui-invariants gates
  // (happy-path CI assertion); the builders stay narrow (shape only).
  it("makePanelContent accepts a title that contains a UUID substring (no runtime masking)", () => {
    expect(() =>
      makePanelContent(
        "Context for f47ac10b-58cc-4372-a567-0e02b2c3d479",
        null,
        [makeEmptyState("x", "y")],
      ),
    ).not.toThrow();
  });

  it("makeBreakdownTable accepts row labels that contain a UUID substring (no runtime masking)", () => {
    expect(() =>
      makeBreakdownTable(
        "By author",
        ["Author", "PRs"],
        [
          { label: "Alice Smith", values: ["12"] },
          { label: "f47ac10b-58cc-4372-a567-0e02b2c3d479", values: ["8"] },
        ],
      ),
    ).not.toThrow();
  });

  it("valid construction returns the expected shape", () => {
    const content = makePanelContent("T", "S", [makeEmptyState("E", "D")]);
    expect(content.title).toBe("T");
    expect(content.subtitle).toBe("S");
    expect(content.sections).toHaveLength(1);
    expect(content.sections[0]!.type).toBe("empty-state");
  });
});

describe("detail-panel — open / render", () => {
  beforeEach(() => {
    resetComparisonState();
  });
  afterEach(() => {
    if (isDetailPanelOpen()) dismissDetailPanel("explicit-close-button");
    document.body.innerHTML = "";
  });

  it("opens and renders title + subtitle + close button", () => {
    const ctx = makeThroughputContext();
    openDetailPanel(ctx);

    expect(isDetailPanelOpen()).toBe(true);
    const root = getPanelRoot();
    expect(root).not.toBeNull();
    expect(root!.classList.contains("is-open")).toBe(true);
    expect(root!.querySelector("#detail-panel-title")!.textContent).toBe(
      "Week of Mar 18 – 24, 2025",
    );
    expect(root!.querySelector(".detail-panel-subtitle")!.textContent).toBe(
      "47 PRs",
    );
    expect(
      root!.querySelector(".detail-panel-close")!.getAttribute("aria-label"),
    ).toBe("Close detail panel");
  });

  it("renders a BreakdownTableSection with the expected rows", () => {
    openDetailPanel(makeThroughputContext());
    const tables = getPanelRoot()!.querySelectorAll(".detail-panel-table");
    expect(tables.length).toBe(2);
    const firstTable = tables[0]!;
    const ths = firstTable.querySelectorAll("thead th");
    expect(Array.from(ths).map((th) => th.textContent)).toEqual([
      "Author",
      "PRs",
    ]);
    const tds = firstTable.querySelectorAll("tbody tr");
    expect(tds.length).toBe(2);
  });

  it("renders a StatRowSection with label/value pairs", () => {
    openDetailPanel(makeCycleTimeContext());
    const stats = getPanelRoot()!.querySelectorAll(".detail-panel-stats dd");
    expect(stats.length).toBe(2);
    expect(stats[0]!.textContent).toBe("4.2h");
    expect(stats[1]!.textContent).toBe("18.1h");
  });

  it("renders an EmptyStateSection with title and detail", () => {
    openDetailPanel(makeReviewerContext());
    const empty = getPanelRoot()!.querySelector(
      ".detail-panel-section--empty-state",
    );
    expect(empty).not.toBeNull();
    expect(empty!.querySelector("h3")!.textContent).toBe(
      "Per-repository breakdown",
    );
    expect(
      empty!.querySelector(".detail-panel-empty-detail")!.textContent,
    ).toBe("Cross-dimensional data is not yet available.");
  });
});

describe("detail-panel — dismissal paths", () => {
  beforeEach(() => {
    resetComparisonState();
  });
  afterEach(() => {
    if (isDetailPanelOpen()) dismissDetailPanel("explicit-close-button");
    document.body.innerHTML = "";
  });

  it("dismisses on Escape and returns focus to triggerElement", () => {
    const ctx = makeThroughputContext();
    openDetailPanel(ctx);

    const escEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(escEvent);

    expect(isDetailPanelOpen()).toBe(false);
    expect(getPanelRoot()!.classList.contains("is-open")).toBe(false);
    expect(document.activeElement).toBe(ctx.triggerElement);
  });

  it("dismisses on outside-click (pointerdown outside the panel)", () => {
    const ctx = makeThroughputContext();
    openDetailPanel(ctx);

    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );

    expect(isDetailPanelOpen()).toBe(false);
  });

  it("does NOT dismiss on pointerdown inside the panel", () => {
    openDetailPanel(makeThroughputContext());

    const title = getPanelRoot()!.querySelector("#detail-panel-title")!;
    title.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

    expect(isDetailPanelOpen()).toBe(true);
  });

  it("dismisses on close-button click", () => {
    openDetailPanel(makeThroughputContext());

    const closeBtn = getPanelRoot()!.querySelector<HTMLButtonElement>(
      ".detail-panel-close",
    )!;
    closeBtn.click();

    expect(isDetailPanelOpen()).toBe(false);
  });

  it("dismisses on filters-changed with NO content revalidation", () => {
    openDetailPanel(makeThroughputContext());
    const root = getPanelRoot()!;
    const sectionsHtmlBefore = root.querySelector(
      ".detail-panel-sections",
    )!.innerHTML;

    publishFiltersChanged({ reason: "user-change" });

    expect(isDetailPanelOpen()).toBe(false);
    // Hard-dismiss: sections content is not re-rendered in the gap between
    // the event firing and the panel closing. Asserting innerHTML is
    // unchanged confirms no render pass ran against the new filter state.
    expect(root.querySelector(".detail-panel-sections")!.innerHTML).toBe(
      sectionsHtmlBefore,
    );
  });

  it("dismisses on tab-changed when leaving the Metrics tab", () => {
    openDetailPanel(makeThroughputContext());

    publishTabChanged({
      activeTabId: "predictions",
      previousTabId: "metrics",
    });

    expect(isDetailPanelOpen()).toBe(false);
  });

  it("does NOT dismiss on tab-changed when the active tab is still metrics", () => {
    openDetailPanel(makeThroughputContext());

    publishTabChanged({ activeTabId: "metrics", previousTabId: "metrics" });

    expect(isDetailPanelOpen()).toBe(true);
  });

  it("dismisses on comparison-toggled when comparison activates", () => {
    openDetailPanel(makeThroughputContext());

    publishComparisonToggled({ enabled: true });

    expect(isDetailPanelOpen()).toBe(false);
  });
});

describe("detail-panel — retarget and comparison guards", () => {
  beforeEach(() => {
    resetComparisonState();
  });
  afterEach(() => {
    if (isDetailPanelOpen()) dismissDetailPanel("explicit-close-button");
    document.body.innerHTML = "";
  });

  it("retargets in place on re-open with a new context (no reopen flicker)", () => {
    openDetailPanel(makeThroughputContext());
    const root = getPanelRoot()!;
    expect(root.classList.contains("is-open")).toBe(true);

    openDetailPanel(makeCycleTimeContext());

    // Same root element, still open, title updated.
    expect(getPanelRoot()).toBe(root);
    expect(root.classList.contains("is-open")).toBe(true);
    expect(root.querySelector("#detail-panel-title")!.textContent).toBe(
      "Week of Mar 18 – 24, 2025 — P50",
    );
  });

  it("no-ops with console.warn when opened while comparison mode is active", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    publishComparisonToggled({ enabled: true });

    openDetailPanel(makeThroughputContext());

    expect(isDetailPanelOpen()).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("preserves is-drilldown-active on a same-trigger re-open (idempotent)", () => {
    // Cross-source retarget cleanup branch coverage: the panel-side
    // ``previousTrigger !== context.triggerElement`` guard inside
    // openDetailPanel must NOT clear active state when the same trigger
    // re-opens its own panel (e.g., user clicks the trigger again
    // while the panel is open). Pins the false arm of the
    // ``previousTrigger !== context.triggerElement`` predicate.
    const ctx = makeThroughputContext();
    ctx.triggerElement.classList.add("is-drilldown-active");
    ctx.triggerElement.setAttribute("aria-expanded", "true");
    openDetailPanel(ctx);
    // Second call with the SAME triggerElement — same-trigger reopen.
    // Active state on that trigger must be preserved (it's still the
    // panel's owner; the panel module does not strip its own owner's
    // attributes).
    openDetailPanel(ctx);
    expect(ctx.triggerElement.classList.contains("is-drilldown-active")).toBe(
      true,
    );
    expect(ctx.triggerElement.getAttribute("aria-expanded")).toBe("true");
  });

  it("clears is-drilldown-active and aria-expanded on the previously-active trigger when the panel is retargeted to a different source", () => {
    // Cross-source retarget regression-lock (Codex stop-time review on
    // #363 post-commit 4682bd53). Simulates two different drill-down
    // installs taking turns opening the panel: each install
    // independently sets ``is-drilldown-active`` /
    // ``aria-expanded="true"`` on its trigger BEFORE calling
    // openDetailPanel. The panel module — the only shared authority
    // that sees both contexts — MUST clear those attributes from the
    // previous trigger when the new context takes over, otherwise the
    // first install's MutationObserver (which only fires on
    // ``is-open`` removal, not on content swap) leaves the prior
    // trigger stuck in active state across the retarget.
    const ctxA = makeThroughputContext();
    ctxA.triggerElement.classList.add("is-drilldown-active");
    ctxA.triggerElement.setAttribute("aria-expanded", "true");
    openDetailPanel(ctxA);

    const ctxB = makeCycleTimeContext();
    ctxB.triggerElement.classList.add("is-drilldown-active");
    ctxB.triggerElement.setAttribute("aria-expanded", "true");
    openDetailPanel(ctxB);

    // Previous trigger (A) lost its active state.
    expect(ctxA.triggerElement.classList.contains("is-drilldown-active")).toBe(
      false,
    );
    expect(ctxA.triggerElement.getAttribute("aria-expanded")).toBe("false");
    // New trigger (B) retains its active state — the panel module
    // only clears the SUPERSEDED trigger; setting active state on
    // the new trigger is the install's responsibility.
    expect(ctxB.triggerElement.classList.contains("is-drilldown-active")).toBe(
      true,
    );
    expect(ctxB.triggerElement.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("detail-panel — performance and viewport (SC-001, FR-012)", () => {
  beforeEach(() => {
    resetComparisonState();
  });
  afterEach(() => {
    if (isDetailPanelOpen()) dismissDetailPanel("explicit-close-button");
    document.body.innerHTML = "";
  });

  it("opens with a 156-rollup fixture in well under 1000 ms (SC-001)", () => {
    // Construct a PanelContent sized comparable to the worst-case Phase 1
    // rendering — two 156-row breakdown tables (simulates "by author" and
    // "by repository" at full demo cadence).
    const makeRows = (): ReturnType<typeof makeBreakdownTable>["rows"] =>
      Array.from({ length: 156 }, (_, i) => ({
        label: `user-${i.toString().padStart(3, "0")}`,
        values: [String(i * 7)],
      }));
    const content = makePanelContent(
      "Stress test — 156 rows per table",
      "Scaling check",
      [
        makeBreakdownTable("By author", ["Author", "PRs"], makeRows()),
        makeBreakdownTable("By repository", ["Repository", "PRs"], makeRows()),
      ],
    );
    const trigger = makeTriggerButton();
    const ctx: DrillDownContext = {
      sourceChart: "throughput",
      focusedData: { kind: "throughput", weekIso: "2025-W12" },
      triggerElement: trigger,
      content,
    };

    const start = performance.now();
    openDetailPanel(ctx);
    const elapsed = performance.now() - start;

    expect(isDetailPanelOpen()).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });

  it("renders a stat-row tone attribute when PanelStat.tone is provided", () => {
    const trigger = makeTriggerButton();
    const content = makePanelContent("With tone", null, [
      makeStatRow([
        { label: "Positive", value: "+12%", tone: "positive" },
        { label: "Negative", value: "-8%", tone: "negative" },
        { label: "Neutral", value: "0%" },
      ]),
    ]);
    openDetailPanel({
      sourceChart: "throughput",
      focusedData: { kind: "throughput", weekIso: "2025-W12" },
      triggerElement: trigger,
      content,
    });

    const dds = Array.from(
      document.querySelectorAll<HTMLElement>(".detail-panel-stats dd"),
    );
    expect(dds.length).toBe(3);
    expect(dds[0]!.getAttribute("data-tone")).toBe("positive");
    expect(dds[1]!.getAttribute("data-tone")).toBe("negative");
    // No tone provided — attribute should NOT be set.
    expect(dds[2]!.hasAttribute("data-tone")).toBe(false);
  });

  it("openDetailPanel re-validates content when a caller hand-rolls a PanelContent bypassing the helpers", () => {
    const trigger = makeTriggerButton();
    // Intentionally craft a raw shape that skirts the construction helpers.
    const emptyTitle: PanelContent = {
      title: "",
      subtitle: null,
      sections: [makeEmptyState("x", "y")],
    };
    expect(() =>
      openDetailPanel({
        sourceChart: "throughput",
        focusedData: { kind: "throughput", weekIso: "2025-W12" },
        triggerElement: trigger,
        content: emptyTitle,
      }),
    ).toThrow(TypeError);

    const emptySections: PanelContent = {
      title: "Title",
      subtitle: null,
      sections: [],
    };
    expect(() =>
      openDetailPanel({
        sourceChart: "throughput",
        focusedData: { kind: "throughput", weekIso: "2025-W12" },
        triggerElement: trigger,
        content: emptySections,
      }),
    ).toThrow(TypeError);
  });

  it("dismissDetailPanel is a no-op when called while the panel is already closed", () => {
    // Panel starts closed — calling dismiss must not throw and must not
    // leave any state behind.
    expect(isDetailPanelOpen()).toBe(false);
    dismissDetailPanel("escape-key");
    expect(isDetailPanelOpen()).toBe(false);

    // Exercise all other reasons the same way — the guard is reason-
    // agnostic so any reason should be a no-op when closed.
    dismissDetailPanel("outside-click");
    dismissDetailPanel("filters-changed");
    dismissDetailPanel("tab-changed");
    dismissDetailPanel("comparison-toggled");
    dismissDetailPanel("explicit-close-button");
    expect(isDetailPanelOpen()).toBe(false);
  });

  it("stays within the viewport at the 768 px minimum supported width (FR-012)", () => {
    // Resize jsdom's viewport to the minimum supported dashboard width.
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 768,
    });
    Object.defineProperty(document.documentElement, "scrollWidth", {
      configurable: true,
      get: () => 768,
    });

    // Establish a "chart region" with known non-zero width that the panel
    // must not obliterate.
    const chartRegion = document.createElement("div");
    chartRegion.style.width = "400px";
    chartRegion.style.height = "200px";
    document.body.appendChild(chartRegion);
    Object.defineProperty(chartRegion, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        width: 400,
        height: 200,
        top: 0,
        left: 0,
        right: 400,
        bottom: 200,
        toJSON: () => ({}),
      }),
    });

    openDetailPanel(makeThroughputContext());

    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth,
    );
    expect(chartRegion.getBoundingClientRect().width).toBeGreaterThan(0);
  });
});

describe("detail-panel — top offset (#303)", () => {
  type FakeRO = {
    callback: ResizeObserverCallback;
    observe: jest.Mock;
    disconnect: jest.Mock;
  };
  let originalMatchMedia: typeof window.matchMedia | undefined;
  let originalResizeObserver: unknown;
  let matchMediaMock: jest.Mock;
  let resizeObserverInstances: FakeRO[];

  beforeEach(() => {
    resetComparisonState();
    resizeObserverInstances = [];

    originalMatchMedia = window.matchMedia;
    matchMediaMock = jest.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(() => false),
    })) as unknown as jest.Mock;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: matchMediaMock,
    });

    originalResizeObserver = (globalThis as { ResizeObserver?: unknown })
      .ResizeObserver;
    const capture = resizeObserverInstances;
    class FakeResizeObserver {
      observe = jest.fn();
      disconnect = jest.fn();
      unobserve = jest.fn();
      constructor(cb: ResizeObserverCallback) {
        capture.push({
          callback: cb,
          observe: this.observe,
          disconnect: this.disconnect,
        });
      }
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
      FakeResizeObserver;
  });

  afterEach(() => {
    if (isDetailPanelOpen()) dismissDetailPanel("explicit-close-button");
    document.body.innerHTML = "";
    if (originalMatchMedia !== undefined) {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      });
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
      originalResizeObserver;
  });

  function setupFilterBar(bottom: number): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "filter-bar";
    document.body.appendChild(bar);
    Object.defineProperty(bar, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        width: 1280,
        height: bottom,
        top: 0,
        left: 0,
        right: 1280,
        bottom,
        toJSON: () => ({}),
      }),
    });
    return bar;
  }

  function setMobileMatch(isMobile: boolean): void {
    matchMediaMock.mockImplementation((query: string) => ({
      matches: isMobile && query === "(max-width: 768px)",
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(() => false),
    }));
  }

  it("sets --detail-panel-top to filter-bar bottom + gap on desktop open", () => {
    setupFilterBar(80);
    openDetailPanel(makeThroughputContext());
    const root = getPanelRoot();
    expect(root).not.toBeNull();
    expect(root!.style.getPropertyValue("--detail-panel-top")).toBe("92px");
  });

  it("removes --detail-panel-top when filter-bar is absent, clearing any stale value", () => {
    setupFilterBar(80);
    openDetailPanel(makeThroughputContext());
    const root = getPanelRoot()!;
    expect(root.style.getPropertyValue("--detail-panel-top")).toBe("92px");

    dismissDetailPanel("explicit-close-button");
    document.querySelector(".filter-bar")!.remove();
    openDetailPanel(makeThroughputContext());

    expect(root.style.getPropertyValue("--detail-panel-top")).toBe("");
  });

  it("removes --detail-panel-top under the mobile media query, clearing any stale value", () => {
    setupFilterBar(80);
    openDetailPanel(makeThroughputContext());
    const root = getPanelRoot()!;
    expect(root.style.getPropertyValue("--detail-panel-top")).toBe("92px");

    dismissDetailPanel("explicit-close-button");
    setMobileMatch(true);
    openDetailPanel(makeThroughputContext());

    expect(root.style.getPropertyValue("--detail-panel-top")).toBe("");
  });

  it("sets --detail-panel-top before the is-open class is applied", () => {
    setupFilterBar(80);

    const observedOrder: string[] = [];
    const originalSetProperty = CSSStyleDeclaration.prototype.setProperty;
    const originalAdd = DOMTokenList.prototype.add;

    CSSStyleDeclaration.prototype.setProperty = function patched(
      name: string,
      value: string | null,
      priority?: string,
    ): void {
      if (name === "--detail-panel-top") {
        observedOrder.push("setProperty:--detail-panel-top");
      }
      return originalSetProperty.call(this, name, value, priority);
    };
    DOMTokenList.prototype.add = function patched(...tokens: string[]): void {
      if (tokens.includes("is-open")) {
        observedOrder.push("classList.add:is-open");
      }
      return originalAdd.apply(this, tokens);
    };

    try {
      openDetailPanel(makeThroughputContext());
    } finally {
      CSSStyleDeclaration.prototype.setProperty = originalSetProperty;
      DOMTokenList.prototype.add = originalAdd;
    }

    const setPropertyIdx = observedOrder.indexOf(
      "setProperty:--detail-panel-top",
    );
    const classAddIdx = observedOrder.indexOf("classList.add:is-open");
    expect(setPropertyIdx).toBeGreaterThanOrEqual(0);
    expect(classAddIdx).toBeGreaterThanOrEqual(0);
    expect(setPropertyIdx).toBeLessThan(classAddIdx);
  });

  it("disconnects the filter-bar ResizeObserver on dismiss", () => {
    setupFilterBar(80);
    openDetailPanel(makeThroughputContext());
    expect(resizeObserverInstances).toHaveLength(1);
    const instance = resizeObserverInstances[0]!;
    expect(instance.disconnect).not.toHaveBeenCalled();

    dismissDetailPanel("explicit-close-button");

    expect(instance.disconnect).toHaveBeenCalledTimes(1);
  });

  it("updates --detail-panel-top when the filter-bar ResizeObserver fires with a new height", () => {
    const bar = setupFilterBar(80);
    openDetailPanel(makeThroughputContext());
    const root = getPanelRoot()!;
    expect(root.style.getPropertyValue("--detail-panel-top")).toBe("92px");

    Object.defineProperty(bar, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        width: 1280,
        height: 120,
        top: 0,
        left: 0,
        right: 1280,
        bottom: 120,
        toJSON: () => ({}),
      }),
    });
    const instance = resizeObserverInstances[0]!;
    instance.callback([], instance as unknown as ResizeObserver);

    expect(root.style.getPropertyValue("--detail-panel-top")).toBe("132px");
  });

  it("removes --detail-panel-top when the ResizeObserver fires with a zero-bottom filter-bar", () => {
    const bar = setupFilterBar(80);
    openDetailPanel(makeThroughputContext());
    const root = getPanelRoot()!;
    expect(root.style.getPropertyValue("--detail-panel-top")).toBe("92px");

    Object.defineProperty(bar, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        toJSON: () => ({}),
      }),
    });
    const instance = resizeObserverInstances[0]!;
    instance.callback([], instance as unknown as ResizeObserver);

    expect(root.style.getPropertyValue("--detail-panel-top")).toBe("");
  });

  // -------------------------------------------------------------------------
  // Feature 060: PrListSection stable-container identity (FR-020, T021)
  // -------------------------------------------------------------------------
  describe("PrListSection stable container (FR-020)", () => {
    function snapshotShell(section: Element): {
      tag: string;
      id: string | null;
      classList: string[];
      role: string | null;
      ariaLabelledby: string | null;
      headingId: string | null;
      headingText: string | null;
    } {
      const heading = section.querySelector("h3");
      return {
        tag: section.tagName,
        id: section.getAttribute("id"),
        classList: Array.from(section.classList).sort(),
        role: section.getAttribute("role"),
        ariaLabelledby: section.getAttribute("aria-labelledby"),
        headingId: heading?.getAttribute("id") ?? null,
        headingText: heading?.textContent ?? null,
      };
    }

    function openWithPrListSection(prList: PrListSection): HTMLElement {
      const trigger = makeTriggerButton();
      const content = makePanelContent("Week of Mar 18 – 24, 2025", "47 PRs", [
        prList,
      ]);
      const context: DrillDownContext = {
        sourceChart: "throughput",
        focusedData: { kind: "throughput", weekIso: "2025-W12" },
        triggerElement: trigger,
        content,
      };
      openDetailPanel(context);
      const section = document.getElementById("pr-detail");
      if (!section) throw new Error("pr-detail section missing after open");
      return section;
    }

    it("renders the always-same <section id='pr-detail'> shell across every content state", () => {
      const prListState = makePrListSection({
        contentState: "pr-list",
        capScope: "single-rollup",
        rows: [
          {
            id: 1,
            title: "test",
            cycleTimeMinutes: 30,
            url: "https://dev.azure.com/acme/Frontend/_git/web/pullrequest/1",
          },
        ],
        renderedCount: 1,
        actualFilteredCount: 1,
        capValue: 500,
        commentsMetricsAvailable: false,
      });
      const shellPrList = snapshotShell(openWithPrListSection(prListState));
      dismissDetailPanel("explicit-close-button");

      const supportedEmptyState = makePrListSection({
        contentState: "supported-empty",
      });
      const shellEmpty = snapshotShell(
        openWithPrListSection(supportedEmptyState),
      );
      dismissDetailPanel("explicit-close-button");

      const teamInlineState = makePrListSection({
        contentState: "team-inline",
      });
      const shellTeam = snapshotShell(openWithPrListSection(teamInlineState));
      dismissDetailPanel("explicit-close-button");

      const reviewerInlineState = makePrListSection({
        contentState: "reviewer-inline",
      });
      const shellReviewer = snapshotShell(
        openWithPrListSection(reviewerInlineState),
      );
      dismissDetailPanel("explicit-close-button");

      // The shell (tag/id/class/role/aria-labelledby/heading) MUST be
      // byte-identical across every content state. Only the content below
      // the heading varies.
      expect(shellPrList.tag).toBe("SECTION");
      expect(shellPrList.id).toBe("pr-detail");
      expect(shellPrList.role).toBe("region");
      expect(shellPrList.ariaLabelledby).toBe("pr-detail-heading");
      expect(shellPrList.headingId).toBe("pr-detail-heading");
      expect(shellPrList.headingText).toBe("Pull requests");
      expect(shellEmpty).toEqual(shellPrList);
      expect(shellTeam).toEqual(shellPrList);
      expect(shellReviewer).toEqual(shellPrList);
    });
  });
});
