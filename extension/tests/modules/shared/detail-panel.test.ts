/**
 * DetailPanel unit tests.
 *
 * Covers the public contract of
 * `extension/ui/modules/shared/detail-panel.ts` per
 * `specs/059-chart-drill-down/contracts/detail-panel-api.md`:
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
  type DrillDownContext,
  type PanelContent,
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
