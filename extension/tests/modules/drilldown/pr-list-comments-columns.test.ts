/**
 * Feature 310 consumer-side rendering tests: per-PR comments-metrics columns
 * on the throughput drill-down PR-detail list.
 *
 * Covers the acceptance scenarios on the consumer side:
 *   - Capability-off: no new columns, no controls (SC-03 / FR-3-06 /
 *     INV-01) — the DOM is byte-shape-compatible with the pre-310 panel.
 *   - Capability-on: three `<span>` nodes per row (threads / comments /
 *     unresolved), sort controls, and threshold filter controls.
 *   - Partial sentinel (`null` triplet): renders as "—" with
 *     ``data-partial="true"`` on the row + per-span, distinguishable from
 *     a numeric 0 (FR-3-05 / INV-10).
 *   - Sort: clicking a sort button re-orders rows descending by that axis;
 *     partial rows sort to the end (stable convention).
 *   - Filter: threshold input hides rows below the threshold; partial rows
 *     are hidden when a threshold is active on any axis (per FR-3-05).
 *   - INV-09 ordering: ``active_thread_count <= thread_count`` for every
 *     visible row with numeric counts.
 *
 * @module tests/modules/drilldown/pr-list-comments-columns.test.ts
 */

import {
  openDetailPanel,
  dismissDetailPanel,
  isDetailPanelOpen,
  makePanelContent,
  makePrListSection,
  type DrillDownContext,
  type PrListRow,
  type PrListSection,
} from "../../../ui/modules/shared/detail-panel";

function makeTriggerButton(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Trigger";
  document.body.appendChild(btn);
  return btn;
}

function openWithPrListSection(section: PrListSection): HTMLElement {
  const trigger = makeTriggerButton();
  const content = makePanelContent("Week of Mar 18 – 24, 2025", "5 PRs", [
    section,
  ]);
  const context: DrillDownContext = {
    sourceChart: "throughput",
    focusedData: { kind: "throughput", weekIso: "2025-W12" },
    triggerElement: trigger,
    content,
  };
  openDetailPanel(context);
  const root = document.querySelector<HTMLElement>(".detail-panel");
  if (root === null) throw new Error("detail-panel not rendered");
  return root;
}

function listRows(root: HTMLElement): HTMLLIElement[] {
  return Array.from(
    root.querySelectorAll<HTMLLIElement>(".detail-panel-pr-row"),
  );
}

function metricSpan(li: HTMLLIElement, axis: string): HTMLSpanElement {
  const span = li.querySelector<HTMLSpanElement>(`.comments-metric--${axis}`);
  if (span === null) {
    throw new Error(`missing comments-metric span for axis=${axis}`);
  }
  return span;
}

function rowPartial(li: HTMLLIElement): boolean {
  return li.getAttribute("data-partial") === "true";
}

function buildRow(overrides: Partial<PrListRow>): PrListRow {
  return {
    id: 1,
    title: "fixture",
    cycleTimeMinutes: 100,
    url: "https://example.com/pr/1",
    ...overrides,
  };
}

afterEach(() => {
  if (isDetailPanelOpen()) dismissDetailPanel("explicit-close-button");
  document.body.innerHTML = "";
});

describe("capability-off path — no new columns / controls", () => {
  it("does not emit any comments-metric spans when commentsMetricsAvailable=false", () => {
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [buildRow({ id: 1 }), buildRow({ id: 2 })],
      renderedCount: 2,
      actualFilteredCount: 2,
      capValue: 500,
      commentsMetricsAvailable: false,
    });
    const root = openWithPrListSection(section);
    expect(root.querySelectorAll(".comments-metric").length).toBe(0);
    expect(root.querySelector(".detail-panel-pr-list-controls")).toBeNull();
  });
});

describe("capability-on path — three columns per row (INV-08)", () => {
  it("emits thread / comment / unresolved spans on every row", () => {
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 10,
          threadCount: 5,
          commentCount: 17,
          activeThreadCount: 2,
        }),
        buildRow({
          id: 11,
          threadCount: 1,
          commentCount: 3,
          activeThreadCount: 0,
        }),
      ],
      renderedCount: 2,
      actualFilteredCount: 2,
      capValue: 500,
      commentsMetricsAvailable: true,
    });
    const root = openWithPrListSection(section);
    const rows = listRows(root);
    expect(rows).toHaveLength(2);
    for (const li of rows) {
      expect(metricSpan(li, "threads")).not.toBeNull();
      expect(metricSpan(li, "comments")).not.toBeNull();
      expect(metricSpan(li, "unresolved")).not.toBeNull();
    }
    expect(metricSpan(rows[0]!, "threads").textContent).toBe("5");
    expect(metricSpan(rows[0]!, "comments").textContent).toBe("17");
    expect(metricSpan(rows[0]!, "unresolved").textContent).toBe("2");
    expect(metricSpan(rows[1]!, "unresolved").textContent).toBe("0");
  });

  it("renders controls block with 3 sort buttons and 3 filter inputs", () => {
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 1,
          threadCount: 1,
          commentCount: 1,
          activeThreadCount: 0,
        }),
      ],
      renderedCount: 1,
      actualFilteredCount: 1,
      capValue: 500,
      commentsMetricsAvailable: true,
    });
    const root = openWithPrListSection(section);
    const controls = root.querySelector<HTMLElement>(
      ".detail-panel-pr-list-controls",
    );
    expect(controls).not.toBeNull();
    const sortButtons = controls!.querySelectorAll<HTMLButtonElement>(
      "button[data-sort-key]",
    );
    expect(Array.from(sortButtons).map((b) => b.dataset.sortKey)).toEqual([
      "threads",
      "comments",
      "unresolved",
    ]);
    const filterInputs = controls!.querySelectorAll<HTMLInputElement>(
      "input[data-filter-key]",
    );
    expect(Array.from(filterInputs).map((i) => i.dataset.filterKey)).toEqual([
      "threads",
      "comments",
      "unresolved",
    ]);
  });
});

describe("partial sentinel rendering (FR-3-05 / INV-10)", () => {
  it("renders '—' with data-partial='true' on all three spans when triplet is null", () => {
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 100,
          threadCount: null,
          commentCount: null,
          activeThreadCount: null,
        }),
      ],
      renderedCount: 1,
      actualFilteredCount: 1,
      capValue: 500,
      commentsMetricsAvailable: true,
    });
    const root = openWithPrListSection(section);
    const row = listRows(root)[0]!;
    expect(rowPartial(row)).toBe(true);
    for (const axis of ["threads", "comments", "unresolved"] as const) {
      const span = metricSpan(row, axis);
      expect(span.getAttribute("data-partial")).toBe("true");
      expect(span.textContent).toBe("—");
    }
  });

  it("renders explicit '0' (not '—') when the count is a true zero (Acceptance 2.2)", () => {
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 200,
          threadCount: 0,
          commentCount: 0,
          activeThreadCount: 0,
        }),
      ],
      renderedCount: 1,
      actualFilteredCount: 1,
      capValue: 500,
      commentsMetricsAvailable: true,
    });
    const root = openWithPrListSection(section);
    const row = listRows(root)[0]!;
    expect(rowPartial(row)).toBe(false);
    for (const axis of ["threads", "comments", "unresolved"] as const) {
      const span = metricSpan(row, axis);
      expect(span.textContent).toBe("0");
      expect(span.getAttribute("data-partial")).toBe("false");
    }
  });
});

describe("sort mechanics (FR-3-02 / FR-4-02)", () => {
  function sortSection(): PrListSection {
    return makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 1,
          threadCount: 2,
          commentCount: 5,
          activeThreadCount: 0,
        }),
        buildRow({
          id: 2,
          threadCount: 7,
          commentCount: 3,
          activeThreadCount: 2,
        }),
        buildRow({
          id: 3,
          threadCount: 5,
          commentCount: 20,
          activeThreadCount: 5,
        }),
      ],
      renderedCount: 3,
      actualFilteredCount: 3,
      capValue: 500,
      commentsMetricsAvailable: true,
    });
  }

  function idsInOrder(root: HTMLElement): number[] {
    return listRows(root).map((li) => {
      const link = li.querySelector("a");
      const text = link?.textContent ?? "";
      const match = /^#(\d+)/.exec(text);
      if (match === null) {
        throw new Error(`cannot parse id from ${String(text)}`);
      }
      return Number.parseInt(match[1]!, 10);
    });
  }

  function clickSort(root: HTMLElement, key: string): void {
    const button = root.querySelector<HTMLButtonElement>(
      `button[data-sort-key="${key}"]`,
    );
    if (button === null) throw new Error(`sort button ${key} not found`);
    button.dispatchEvent(new Event("click", { bubbles: true }));
  }

  it("sorts descending by threads", () => {
    const root = openWithPrListSection(sortSection());
    clickSort(root, "threads");
    expect(idsInOrder(root)).toEqual([2, 3, 1]);
  });

  it("sorts descending by comments", () => {
    const root = openWithPrListSection(sortSection());
    clickSort(root, "comments");
    expect(idsInOrder(root)).toEqual([3, 1, 2]);
  });

  it("sorts descending by unresolved", () => {
    const root = openWithPrListSection(sortSection());
    clickSort(root, "unresolved");
    expect(idsInOrder(root)).toEqual([3, 2, 1]);
  });

  it("places partial-sentinel rows at the end on sort", () => {
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 10,
          threadCount: 2,
          commentCount: 2,
          activeThreadCount: 1,
        }),
        buildRow({
          id: 11,
          threadCount: null,
          commentCount: null,
          activeThreadCount: null,
        }),
        buildRow({
          id: 12,
          threadCount: 9,
          commentCount: 9,
          activeThreadCount: 9,
        }),
      ],
      renderedCount: 3,
      actualFilteredCount: 3,
      capValue: 500,
      commentsMetricsAvailable: true,
    });
    const root = openWithPrListSection(section);
    clickSort(root, "threads");
    expect(idsInOrder(root)).toEqual([12, 10, 11]);
  });

  it("sort with two partial-sentinel rows keeps both at the end (two-null comparator arm)", () => {
    // Specifically exercises the ``aValue === null && bValue === null``
    // arm of the sort comparator (returns 0, preserving relative order
    // across both partial rows).  A one-partial test cannot reach this
    // arm because at least one side of every comparison is numeric.
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 20,
          threadCount: 1,
          commentCount: 1,
          activeThreadCount: 0,
        }),
        buildRow({
          id: 21,
          threadCount: null,
          commentCount: null,
          activeThreadCount: null,
        }),
        buildRow({
          id: 22,
          threadCount: null,
          commentCount: null,
          activeThreadCount: null,
        }),
        buildRow({
          id: 23,
          threadCount: 4,
          commentCount: 4,
          activeThreadCount: 2,
        }),
      ],
      renderedCount: 4,
      actualFilteredCount: 4,
      capValue: 500,
      commentsMetricsAvailable: true,
    });
    const root = openWithPrListSection(section);
    clickSort(root, "threads");
    const order = idsInOrder(root);
    // Numeric rows sort descending first; partial rows end up after.
    expect(order.slice(0, 2)).toEqual([23, 20]);
    expect(new Set(order.slice(2))).toEqual(new Set([21, 22]));
  });

  it("sets aria-pressed='true' only on the active sort button", () => {
    const root = openWithPrListSection(sortSection());
    clickSort(root, "comments");
    const buttons = root.querySelectorAll<HTMLButtonElement>(
      "button[data-sort-key]",
    );
    for (const btn of buttons) {
      const key = btn.dataset.sortKey;
      expect(btn.getAttribute("aria-pressed")).toBe(
        key === "comments" ? "true" : "false",
      );
    }
  });
});

describe("filter mechanics (FR-3-03 / FR-4-02)", () => {
  function filterSection(): PrListSection {
    return makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 1,
          threadCount: 0,
          commentCount: 0,
          activeThreadCount: 0,
        }),
        buildRow({
          id: 2,
          threadCount: 3,
          commentCount: 12,
          activeThreadCount: 1,
        }),
        buildRow({
          id: 3,
          threadCount: 5,
          commentCount: 2,
          activeThreadCount: 0,
        }),
        buildRow({
          id: 4,
          threadCount: null,
          commentCount: null,
          activeThreadCount: null,
        }),
      ],
      renderedCount: 4,
      actualFilteredCount: 4,
      capValue: 500,
      commentsMetricsAvailable: true,
    });
  }

  function setFilter(root: HTMLElement, key: string, value: string): void {
    const input = root.querySelector<HTMLInputElement>(
      `input[data-filter-key="${key}"]`,
    );
    if (input === null) throw new Error(`filter input ${key} not found`);
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function visibleIds(root: HTMLElement): number[] {
    return listRows(root)
      .filter((li) => !li.hasAttribute("hidden"))
      .map((li) => {
        const link = li.querySelector("a");
        const text = link?.textContent ?? "";
        const match = /^#(\d+)/.exec(text);
        if (match === null) {
          throw new Error(`cannot parse id from ${String(text)}`);
        }
        return Number.parseInt(match[1]!, 10);
      });
  }

  it("hides rows whose threadCount is below the threshold", () => {
    const root = openWithPrListSection(filterSection());
    setFilter(root, "threads", "3");
    expect(visibleIds(root)).toEqual([2, 3]);
  });

  it("hides rows whose unresolved count is below the threshold", () => {
    const root = openWithPrListSection(filterSection());
    setFilter(root, "unresolved", "1");
    expect(visibleIds(root)).toEqual([2]);
  });

  it("composes thresholds across axes with AND semantics", () => {
    const root = openWithPrListSection(filterSection());
    setFilter(root, "threads", "3");
    setFilter(root, "comments", "5");
    expect(visibleIds(root)).toEqual([2]);
  });

  it("hides partial-sentinel rows whenever any threshold is active (FR-3-05)", () => {
    const root = openWithPrListSection(filterSection());
    setFilter(root, "threads", "1");
    // id=4 is the partial row; it has no data-threads and must be hidden.
    expect(visibleIds(root)).toEqual([2, 3]);
  });

  it("clearing the filter restores all rows (including partial)", () => {
    const root = openWithPrListSection(filterSection());
    setFilter(root, "threads", "3");
    expect(visibleIds(root)).toEqual([2, 3]);
    setFilter(root, "threads", "");
    expect(visibleIds(root)).toEqual([1, 2, 3, 4]);
  });

  it("ignores negative threshold values (defensive guard)", () => {
    // ``min="0"`` on the input prevents UI entry below zero, but
    // programmatic dispatch (or a future caller) might still push a
    // negative value.  The filter MUST ignore it rather than invert the
    // predicate (which would accidentally hide all non-negative rows if
    // ``value < -5`` were treated as a real threshold of -5).  All
    // rows stay visible because the negative threshold never lands in
    // the active set.
    const root = openWithPrListSection(filterSection());
    setFilter(root, "threads", "-5");
    expect(visibleIds(root)).toEqual([1, 2, 3, 4]);
  });
});

describe("INV-09 ordering assertion across rendered rows", () => {
  it("every visible row with numeric counts has active <= total", () => {
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 1,
          threadCount: 5,
          commentCount: 17,
          activeThreadCount: 2,
        }),
        buildRow({
          id: 2,
          threadCount: 3,
          commentCount: 8,
          activeThreadCount: 3,
        }),
        buildRow({
          id: 3,
          threadCount: 0,
          commentCount: 0,
          activeThreadCount: 0,
        }),
      ],
      renderedCount: 3,
      actualFilteredCount: 3,
      capValue: 500,
      commentsMetricsAvailable: true,
    });
    const root = openWithPrListSection(section);
    for (const li of listRows(root)) {
      const threads = Number.parseInt(
        metricSpan(li, "threads").textContent ?? "0",
        10,
      );
      const unresolved = Number.parseInt(
        metricSpan(li, "unresolved").textContent ?? "0",
        10,
      );
      expect(unresolved).toBeLessThanOrEqual(threads);
    }
  });
});
