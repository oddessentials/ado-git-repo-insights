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

function columnHeaderCell(root: HTMLElement, key: string): HTMLElement {
  const cell = root.querySelector<HTMLElement>(
    `.detail-panel-pr-list-header-cell--${key}`,
  );
  if (cell === null) {
    throw new Error(`column header cell ${key} not found`);
  }
  return cell;
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
    // Lock #9 — the new capability-on DOM (header row, filter bar, modifier
    // class on the ol) MUST be absent, not hidden, on the capability-off
    // path.  The pre-310 ``.detail-panel-pr-list-controls`` container also
    // never reappears (old selector kept as a regression guard).
    expect(root.querySelector(".detail-panel-pr-list-header")).toBeNull();
    expect(root.querySelector(".detail-panel-pr-list-filter")).toBeNull();
    expect(root.querySelector(".detail-panel-pr-list-controls")).toBeNull();
    const list = root.querySelector<HTMLOListElement>(
      "ol.detail-panel-pr-list",
    );
    expect(list).not.toBeNull();
    expect(
      list!.classList.contains("detail-panel-pr-list--with-comments"),
    ).toBe(false);
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

  it("renders a header row with 3 sort buttons and a separate filter row with 3 inputs", () => {
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
    // F4 — sort lives on the column headers, not a separate Sort: bar.
    const header = root.querySelector<HTMLElement>(
      ".detail-panel-pr-list-header",
    );
    expect(header).not.toBeNull();
    const sortButtons = header!.querySelectorAll<HTMLButtonElement>(
      "button[data-sort-key]",
    );
    expect(Array.from(sortButtons).map((b) => b.dataset.sortKey)).toEqual([
      "threads",
      "comments",
      "unresolved",
    ]);
    // Filter stays a separate row below the header (unchanged threshold UI).
    const filter = root.querySelector<HTMLElement>(
      ".detail-panel-pr-list-filter",
    );
    expect(filter).not.toBeNull();
    const filterInputs = filter!.querySelectorAll<HTMLInputElement>(
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
      // Lock #4 — partial data must be human-distinguishable AND
      // screen-reader-distinguishable, not just machine-tagged.  The
      // aria-label carries the meaning to assistive tech; a CSS rule
      // under ``.detail-panel-pr-list--with-comments`` carries the
      // visual distinction (muted + italic).
      expect(span.getAttribute("aria-label")).toBe("Coverage pending");
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
      // Negative pair with the aria-label assertion above — a true zero
      // is NOT partial, so no ``Coverage pending`` label leaks onto it.
      expect(span.getAttribute("aria-label")).toBeNull();
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

  it("sets aria-sort='descending' on the active column header and 'none' elsewhere", () => {
    // F3 + F4 — aria-sort on the <div role="columnheader"> cell replaces
    // the legacy aria-pressed on the sort button.  Button-adjacent
    // assertions are covered by the ``header-driven sort cycle`` describe
    // below; this test asserts the single-active-sort axis invariant
    // after one click (cross-axis reset is tested in the cycle describe).
    const root = openWithPrListSection(sortSection());
    clickSort(root, "comments");
    for (const axis of ["threads", "comments", "unresolved"] as const) {
      const cell = columnHeaderCell(root, axis);
      expect(cell.getAttribute("aria-sort")).toBe(
        axis === "comments" ? "descending" : "none",
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

describe("column header row and ol modifier (F1 + F8 + lock #1 / #9)", () => {
  it("emits a header row with 5 columnheader cells on capability-on", () => {
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
    const header = root.querySelector<HTMLElement>(
      ".detail-panel-pr-list-header",
    );
    expect(header).not.toBeNull();
    const cells = header!.querySelectorAll<HTMLElement>(
      '[role="columnheader"]',
    );
    expect(cells).toHaveLength(5);
    expect(
      cells[0]!.classList.contains("detail-panel-pr-list-header-cell--pr"),
    ).toBe(true);
    expect(
      cells[1]!.classList.contains("detail-panel-pr-list-header-cell--cycle"),
    ).toBe(true);
    expect(
      cells[2]!.classList.contains("detail-panel-pr-list-header-cell--threads"),
    ).toBe(true);
    expect(
      cells[3]!.classList.contains(
        "detail-panel-pr-list-header-cell--comments",
      ),
    ).toBe(true);
    expect(
      cells[4]!.classList.contains(
        "detail-panel-pr-list-header-cell--unresolved",
      ),
    ).toBe(true);
  });

  it("does NOT emit the header row on capability-off (absent, not hidden)", () => {
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [buildRow({ id: 1 })],
      renderedCount: 1,
      actualFilteredCount: 1,
      capValue: 500,
      commentsMetricsAvailable: false,
    });
    const root = openWithPrListSection(section);
    expect(root.querySelector(".detail-panel-pr-list-header")).toBeNull();
  });

  it("unresolved sort button shows 'Unresolved' visibly with full disambiguation via title + aria-label (F8 + header-fit)", () => {
    // Header-width hardening: the column reserved for the unresolved
    // count is too narrow for the full "Unresolved threads" label.
    // Sighted users see the short ``Unresolved`` form; the full
    // disambiguation the F8 rename was meant to convey is preserved
    // via the hover ``title`` and the screen-reader ``aria-label``.
    // Locks the three-surface contract: visible textContent, hover
    // title, SR aria-label.
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 1,
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
    const button = root.querySelector<HTMLButtonElement>(
      'button[data-sort-key="unresolved"]',
    );
    expect(button).not.toBeNull();
    expect(button!.textContent).toBe("Unresolved");
    expect(button!.getAttribute("title")).toBe("Unresolved threads");
    expect(button!.getAttribute("aria-label")).toBe(
      "Sort by unresolved threads",
    );
  });

  it("applies the 'detail-panel-pr-list--with-comments' modifier on the ol when capability-on", () => {
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 1,
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
    const list = root.querySelector<HTMLOListElement>(
      "ol.detail-panel-pr-list",
    );
    expect(list).not.toBeNull();
    expect(
      list!.classList.contains("detail-panel-pr-list--with-comments"),
    ).toBe(true);
  });

  it("does NOT apply the modifier class on the ol when capability-off", () => {
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [buildRow({ id: 1 }), buildRow({ id: 2 })],
      renderedCount: 2,
      actualFilteredCount: 2,
      capValue: 500,
      commentsMetricsAvailable: false,
    });
    const root = openWithPrListSection(section);
    const list = root.querySelector<HTMLOListElement>(
      "ol.detail-panel-pr-list",
    );
    expect(list).not.toBeNull();
    expect(
      list!.classList.contains("detail-panel-pr-list--with-comments"),
    ).toBe(false);
  });
});

describe("header-driven sort cycle (F3 + F4)", () => {
  function cycleSection(): PrListSection {
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

  function clickHeader(root: HTMLElement, key: string): void {
    const button = root.querySelector<HTMLButtonElement>(
      `.detail-panel-pr-list-header button[data-sort-key="${key}"]`,
    );
    if (button === null) {
      throw new Error(`header sort button ${key} not found`);
    }
    button.dispatchEvent(new Event("click", { bubbles: true }));
  }

  it("first click sets aria-sort='descending' on the active cell and sorts DESC", () => {
    const root = openWithPrListSection(cycleSection());
    clickHeader(root, "threads");
    expect(columnHeaderCell(root, "threads").getAttribute("aria-sort")).toBe(
      "descending",
    );
    // threads DESC: 7, 5, 2  -> ids 2, 3, 1.
    expect(idsInOrder(root)).toEqual([2, 3, 1]);
  });

  it("second click on the same header cycles to 'ascending' and sorts ASC", () => {
    const root = openWithPrListSection(cycleSection());
    clickHeader(root, "threads");
    clickHeader(root, "threads");
    expect(columnHeaderCell(root, "threads").getAttribute("aria-sort")).toBe(
      "ascending",
    );
    // threads ASC: 2, 5, 7  -> ids 1, 3, 2.
    expect(idsInOrder(root)).toEqual([1, 3, 2]);
  });

  it("third click cycles to 'none' and restores the aggregator-default order", () => {
    // Constraint: unsorted state uses a stable original-order snapshot
    // captured at header-build time.  Re-appending each snapshot node
    // via appendChild MOVES (not clones), yielding byte-stable restore.
    const root = openWithPrListSection(cycleSection());
    clickHeader(root, "threads");
    clickHeader(root, "threads");
    clickHeader(root, "threads");
    expect(columnHeaderCell(root, "threads").getAttribute("aria-sort")).toBe(
      "none",
    );
    // Original row order as constructed in cycleSection(): 1, 2, 3.
    expect(idsInOrder(root)).toEqual([1, 2, 3]);
  });

  it("clicking a different header resets the previous header's aria-sort to 'none'", () => {
    const root = openWithPrListSection(cycleSection());
    clickHeader(root, "threads");
    clickHeader(root, "comments");
    expect(columnHeaderCell(root, "threads").getAttribute("aria-sort")).toBe(
      "none",
    );
    expect(columnHeaderCell(root, "comments").getAttribute("aria-sort")).toBe(
      "descending",
    );
    // comments DESC: 20, 5, 3  -> ids 3, 1, 2.
    expect(idsInOrder(root)).toEqual([3, 1, 2]);
  });

  it("ascending sort still places partial-sentinel rows at the end", () => {
    // Ascending must preserve the "partials are never comparable to
    // numerics" rule (FR-3-05) — partials sort to the end regardless
    // of direction.
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 10,
          threadCount: 5,
          commentCount: 5,
          activeThreadCount: 0,
        }),
        buildRow({
          id: 11,
          threadCount: null,
          commentCount: null,
          activeThreadCount: null,
        }),
        buildRow({
          id: 12,
          threadCount: 1,
          commentCount: 1,
          activeThreadCount: 0,
        }),
        buildRow({
          id: 13,
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
    const root = openWithPrListSection(section);
    clickHeader(root, "threads"); // DESC
    clickHeader(root, "threads"); // ASC
    const ids = idsInOrder(root);
    // ASC numerics: 1, 5  -> ids 12, 10 at the front.
    expect(ids.slice(0, 2)).toEqual([12, 10]);
    // Partials at the end, in stable (any) order among themselves.
    expect(new Set(ids.slice(2))).toEqual(new Set([11, 13]));
  });
});
