// jsdom lacks PointerEvent — polyfill matches the shape used by
// extension/tests/modules/charts/summary-cards-info.test.ts so the
// pointerenter / pointerleave listeners on the #332 / B2 info icon
// fire predictably.
if (typeof PointerEvent === "undefined") {
  (globalThis as Record<string, unknown>).PointerEvent =
    class PointerEvent extends MouseEvent {
      constructor(type: string, init?: PointerEventInit) {
        super(type, init);
      }
    };
}

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

describe("capability-off path — no comments-metrics surface (post-#342 SC-03)", () => {
  it("emits the shared PR | Cycle header with no comments-metrics surface (no sort buttons / filter / modifier classes / metric spans)", () => {
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [buildRow({ id: 1 }), buildRow({ id: 2 })],
      renderedCount: 2,
      actualFilteredCount: 2,
      capValue: 500,
      commentsMetricsAvailable: false,
    });
    const root = openWithPrListSection(section);

    // Issue #342 reframed SC-03: the shared ``PR | Cycle`` header is
    // ALWAYS emitted (so capability-off labels its previously-bare
    // cycle-time span), but it carries NO comments-metrics surface
    // — no ``--with-comments`` modifier, no sort buttons, no filter,
    // no metric spans, no coverage notice.
    const header = root.querySelector<HTMLElement>(
      ".detail-panel-pr-list-header",
    );
    expect(header).not.toBeNull();
    expect(
      header!.classList.contains("detail-panel-pr-list-header--with-comments"),
    ).toBe(false);
    const headerCells = header!.querySelectorAll<HTMLElement>(
      '[role="columnheader"]',
    );
    expect(headerCells).toHaveLength(2);
    expect(
      headerCells[0]!.classList.contains(
        "detail-panel-pr-list-header-cell--pr",
      ),
    ).toBe(true);
    expect(
      headerCells[1]!.classList.contains(
        "detail-panel-pr-list-header-cell--cycle",
      ),
    ).toBe(true);
    expect(header!.querySelectorAll("button[data-sort-key]")).toHaveLength(0);

    expect(root.querySelectorAll(".comments-metric").length).toBe(0);
    expect(root.querySelector(".detail-panel-pr-list-filter")).toBeNull();
    expect(root.querySelector(".detail-panel-pr-list-controls")).toBeNull();
    expect(
      root.querySelector(".detail-panel-pr-list-coverage-notice"),
    ).toBeNull();
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
    // Two rows so the C5 controls-visibility guard (rowElements.length > 1)
    // permits the sort cells + filter to render.  Single-row suppression
    // (PR | Cycle header still emits, sort cells suppressed) is covered
    // by its own test below.
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 1,
          threadCount: 1,
          commentCount: 1,
          activeThreadCount: 0,
        }),
        buildRow({
          id: 2,
          threadCount: 2,
          commentCount: 4,
          activeThreadCount: 1,
        }),
      ],
      renderedCount: 2,
      actualFilteredCount: 2,
      capValue: 500,
      commentsMetricsAvailable: true,
    });
    const root = openWithPrListSection(section);
    // F4 — sort lives on the column headers, not a separate Sort: bar.
    const header = root.querySelector<HTMLElement>(
      ".detail-panel-pr-list-header",
    );
    expect(header).not.toBeNull();
    // Issue #342: when sort cells emit the header carries the
    // ``--with-comments`` modifier (mirrors the ``<ol>`` modifier
    // pattern); CSS uses it to swap the 2-col base grid template
    // for the 5-col extended template.
    expect(
      header!.classList.contains("detail-panel-pr-list-header--with-comments"),
    ).toBe(true);
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

describe("issue #330 / C5 — controls-visibility guard on trivial lists", () => {
  it("suppresses sort BUTTONS + filter when the capability-on list has a single row (5-cell header still emits, no buttons)", () => {
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 1,
          threadCount: 5,
          commentCount: 17,
          activeThreadCount: 2,
        }),
      ],
      renderedCount: 1,
      actualFilteredCount: 1,
      capValue: 500,
      commentsMetricsAvailable: true,
    });
    const root = openWithPrListSection(section);
    // Issue #342 (post Codex stop-time review on 406263f6): the
    // capability-on row carries three metric spans (5 grid tracks via
    // ``.detail-panel-pr-list--with-comments .detail-panel-pr-row``),
    // so the header MUST emit matching columnheader cells or the
    // metric values render unlabeled.  Only the interactive SORT
    // BUTTONS and the threshold filter are suppressed on a trivial
    // list.  The cells render the plain label text and OMIT
    // ``aria-sort`` so SR users don't get told a column is sortable
    // when it isn't.
    const header = root.querySelector<HTMLElement>(
      ".detail-panel-pr-list-header",
    );
    expect(header).not.toBeNull();
    expect(
      header!.classList.contains("detail-panel-pr-list-header--with-comments"),
    ).toBe(true);
    const cells = header!.querySelectorAll<HTMLElement>(
      '[role="columnheader"]',
    );
    expect(cells).toHaveLength(5);
    // No interactive sort buttons + no aria-sort attributes anywhere
    // on the suppressed-sort header.
    expect(header!.querySelectorAll("button[data-sort-key]")).toHaveLength(0);
    for (const cell of Array.from(cells)) {
      expect(cell.getAttribute("aria-sort")).toBeNull();
    }
    // Spot-check that the comments-metric cells carry their visible
    // labels — the column edges line up under text, not empty cells.
    expect(cells[2]!.textContent).toBe("Threads");
    expect(cells[3]!.textContent).toBe("Comments");
    expect(cells[4]!.textContent).toBe("Unresolved");

    expect(root.querySelector(".detail-panel-pr-list-filter")).toBeNull();
    const list = root.querySelector<HTMLOListElement>(
      "ol.detail-panel-pr-list",
    );
    expect(list).not.toBeNull();
    expect(
      list!.classList.contains("detail-panel-pr-list--with-comments"),
    ).toBe(true);
    // The single row itself still carries the three comments-metric spans.
    const row = listRows(root)[0]!;
    for (const axis of ["threads", "comments", "unresolved"] as const) {
      expect(metricSpan(row, axis)).not.toBeNull();
    }
  });

  it("emits header + filter when the capability-on list has two or more rows", () => {
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
          threadCount: 0,
          commentCount: 0,
          activeThreadCount: 0,
        }),
      ],
      renderedCount: 2,
      actualFilteredCount: 2,
      capValue: 500,
      commentsMetricsAvailable: true,
    });
    const root = openWithPrListSection(section);
    expect(root.querySelector(".detail-panel-pr-list-header")).not.toBeNull();
    expect(root.querySelector(".detail-panel-pr-list-filter")).not.toBeNull();
  });
});

describe("issue #331 / C2 + C3 — in-panel coverage notice + control suppression", () => {
  it("zero-partial slice → no coverage notice; header + filter still render", () => {
    // Negative pair: when no row is partial the notice MUST be
    // absent so it doesn't add chrome on fully-covered slices.
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 1,
          threadCount: 3,
          commentCount: 7,
          activeThreadCount: 1,
        }),
        buildRow({
          id: 2,
          threadCount: 1,
          commentCount: 4,
          activeThreadCount: 0,
        }),
      ],
      renderedCount: 2,
      actualFilteredCount: 2,
      capValue: 500,
      commentsMetricsAvailable: true,
    });
    const root = openWithPrListSection(section);
    expect(
      root.querySelector(".detail-panel-pr-list-coverage-notice"),
    ).toBeNull();
    expect(root.querySelector(".detail-panel-pr-list-header")).not.toBeNull();
    expect(root.querySelector(".detail-panel-pr-list-filter")).not.toBeNull();
  });

  it("mixed-partial slice → 'N of M' notice; header + filter still render (C3)", () => {
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
          threadCount: null,
          commentCount: null,
          activeThreadCount: null,
        }),
        buildRow({
          id: 3,
          threadCount: 1,
          commentCount: 4,
          activeThreadCount: 0,
        }),
      ],
      renderedCount: 3,
      actualFilteredCount: 3,
      capValue: 500,
      commentsMetricsAvailable: true,
    });
    const root = openWithPrListSection(section);
    const notice = root.querySelector<HTMLElement>(
      ".detail-panel-pr-list-coverage-notice",
    );
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toBe(
      "Comments coverage: partial — 1 of 3 PRs are missing comment data.",
    );
    // ``--all-partial`` modifier MUST NOT appear on a mixed slice —
    // that variant is reserved for the all-partial branch.
    expect(
      notice!.classList.contains(
        "detail-panel-pr-list-coverage-notice--all-partial",
      ),
    ).toBe(false);
    expect(notice!.getAttribute("role")).toBe("status");
    expect(notice!.getAttribute("aria-live")).toBe("polite");
    // Sort + filter controls still render — sort/filter operate on
    // the two numeric rows and partial rows continue to sort to the
    // end / be hidden by an active threshold per FR-3-05.
    expect(root.querySelector(".detail-panel-pr-list-header")).not.toBeNull();
    expect(root.querySelector(".detail-panel-pr-list-filter")).not.toBeNull();
  });

  it("all-partial slice → 'pending — none' notice; header + filter SUPPRESSED (C2)", () => {
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 1,
          threadCount: null,
          commentCount: null,
          activeThreadCount: null,
        }),
        buildRow({
          id: 2,
          threadCount: null,
          commentCount: null,
          activeThreadCount: null,
        }),
      ],
      renderedCount: 2,
      actualFilteredCount: 2,
      capValue: 500,
      commentsMetricsAvailable: true,
    });
    const root = openWithPrListSection(section);
    const notice = root.querySelector<HTMLElement>(
      ".detail-panel-pr-list-coverage-notice",
    );
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toBe(
      "Comments coverage: pending — none of these PRs have comment data yet.",
    );
    expect(
      notice!.classList.contains(
        "detail-panel-pr-list-coverage-notice--all-partial",
      ),
    ).toBe(true);
    // C2: sort BUTTONS + filter MUST be absent on an all-partial slice
    // — there are no numeric values to sort / threshold-filter.  But
    // the capability-on rows carry three (dashed) metric spans, so
    // the header still emits 5 columnheader cells with the
    // ``--with-comments`` modifier (issue #342 post Codex stop-time
    // review on 406263f6) — otherwise the dashed columns would render
    // unlabeled.  The cells carry plain label text and omit
    // ``aria-sort`` so SR users don't get told a column is sortable.
    const header = root.querySelector<HTMLElement>(
      ".detail-panel-pr-list-header",
    );
    expect(header).not.toBeNull();
    expect(
      header!.classList.contains("detail-panel-pr-list-header--with-comments"),
    ).toBe(true);
    const cells = header!.querySelectorAll<HTMLElement>(
      '[role="columnheader"]',
    );
    expect(cells).toHaveLength(5);
    expect(header!.querySelectorAll("button[data-sort-key]")).toHaveLength(0);
    for (const cell of Array.from(cells)) {
      expect(cell.getAttribute("aria-sort")).toBeNull();
    }
    expect(root.querySelector(".detail-panel-pr-list-filter")).toBeNull();
    const list = root.querySelector<HTMLOListElement>(
      "ol.detail-panel-pr-list",
    );
    expect(list).not.toBeNull();
    expect(
      list!.classList.contains("detail-panel-pr-list--with-comments"),
    ).toBe(true);
  });

  it("capability-off slice with any row shape → no coverage notice (SC-03 byte-identity)", () => {
    // Lock #9 / SC-03: the new coverage-notice element class is
    // capability-on-only.  Capability-off slices — including ones
    // whose rows happen to carry partial values from the producer —
    // MUST NOT emit any new DOM.  Belt-and-braces alongside the
    // pr-list-capability-off-baseline.test.ts byte-identical check.
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 1,
          threadCount: null,
          commentCount: null,
          activeThreadCount: null,
        }),
        buildRow({ id: 2 }),
      ],
      renderedCount: 2,
      actualFilteredCount: 2,
      capValue: 500,
      commentsMetricsAvailable: false,
    });
    const root = openWithPrListSection(section);
    expect(
      root.querySelector(".detail-panel-pr-list-coverage-notice"),
    ).toBeNull();
  });

  it("truncated all-partial slice → coverage notice present; slice-scope disclosure DROPPED", () => {
    // Locks the truncation-badge gate's #331 / C2 adjustment: when
    // every row is partial, the controls don't render, so the "Sort
    // and filter operate within this slice." sentence would promise
    // an interaction that never lands and must be dropped.  The
    // base "Showing N of M matching PRs (top 500 by cycle time)"
    // text stays so the slice ratio remains discoverable.
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 1,
          threadCount: null,
          commentCount: null,
          activeThreadCount: null,
        }),
        buildRow({
          id: 2,
          threadCount: null,
          commentCount: null,
          activeThreadCount: null,
        }),
      ],
      renderedCount: 2,
      actualFilteredCount: 743,
      capValue: 500,
      commentsMetricsAvailable: true,
    });
    const root = openWithPrListSection(section);
    expect(
      root.querySelector(".detail-panel-pr-list-coverage-notice"),
    ).not.toBeNull();
    const badge = root.querySelector<HTMLElement>(
      ".truncation-indicator.truncation-badge",
    );
    expect(badge).not.toBeNull();
    const badgeText = badge!.textContent ?? "";
    expect(badgeText).toContain("Showing 2 of 743");
    expect(badgeText).toContain("by cycle time");
    expect(badgeText).not.toContain(
      "Sort and filter operate within this slice",
    );
  });
});

describe("issue #330 / C1 — truncation badge slice-scope disclosure", () => {
  it("capability-on truncated week appends the slice-scope disclosure sentence", () => {
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 1,
          threadCount: 3,
          commentCount: 9,
          activeThreadCount: 1,
        }),
        buildRow({
          id: 2,
          threadCount: 2,
          commentCount: 5,
          activeThreadCount: 0,
        }),
      ],
      renderedCount: 2,
      actualFilteredCount: 743,
      capValue: 500,
      commentsMetricsAvailable: true,
    });
    const root = openWithPrListSection(section);
    const badge = root.querySelector<HTMLElement>(
      ".truncation-indicator.truncation-badge",
    );
    expect(badge).not.toBeNull();
    const text = badge!.textContent ?? "";
    // Count literals stay in place — loose substring checks match the
    // pre-existing throughput-drilldown truncation test style.
    expect(text).toContain("2");
    expect(text).toContain("743");
    expect(text).toContain("500");
    expect(text).toContain("by cycle time");
    // New in #330 — the disclosure sentence is appended.
    expect(text).toContain("Sort and filter operate within this slice.");
  });

  it("capability-off truncated week preserves the pre-#330 badge literal (SC-03 byte-identity)", () => {
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [buildRow({ id: 1 }), buildRow({ id: 2 })],
      renderedCount: 2,
      actualFilteredCount: 743,
      capValue: 500,
      commentsMetricsAvailable: false,
    });
    const root = openWithPrListSection(section);
    const badge = root.querySelector<HTMLElement>(
      ".truncation-indicator.truncation-badge",
    );
    expect(badge).not.toBeNull();
    // Capability-off MUST render the exact pre-310 / pre-#330 literal so
    // the committed byte-identical baseline stays valid.  If this
    // assertion ever flips, the disclosure has leaked off the
    // capability-on path.
    expect(badge!.textContent).toBe(
      "Showing 2 of 743 matching PRs (top 500 by cycle time)",
    );
  });
});

describe("issue #330 / C4 — 3-digit metric rendering", () => {
  it("renders 3-digit counts in all three comments-metric columns without partial state", () => {
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 900,
          threadCount: 999,
          commentCount: 999,
          activeThreadCount: 999,
        }),
        buildRow({
          id: 901,
          threadCount: 123,
          commentCount: 456,
          activeThreadCount: 789,
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
    expect(rowPartial(rows[0]!)).toBe(false);
    expect(metricSpan(rows[0]!, "threads").textContent).toBe("999");
    expect(metricSpan(rows[0]!, "comments").textContent).toBe("999");
    expect(metricSpan(rows[0]!, "unresolved").textContent).toBe("999");
    expect(metricSpan(rows[1]!, "threads").textContent).toBe("123");
    expect(metricSpan(rows[1]!, "comments").textContent).toBe("456");
    expect(metricSpan(rows[1]!, "unresolved").textContent).toBe("789");
    // The row-level data attributes the sort + filter machinery reads
    // must round-trip the full 3-digit values.
    expect(rows[0]!.getAttribute("data-threads")).toBe("999");
    expect(rows[0]!.getAttribute("data-comments")).toBe("999");
    expect(rows[0]!.getAttribute("data-unresolved")).toBe("999");
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
      // Issue #331 / A2: span is removed from the a11y tree; the
      // row-level aria-label carries the announcement (asserted
      // separately below).  Per-span aria-labels would cause the
      // SR to announce "Coverage pending" three times per partial
      // row; aria-hidden + a single row-level label fixes that.
      expect(span.getAttribute("aria-hidden")).toBe("true");
      expect(span.getAttribute("aria-label")).toBeNull();
      expect(span.textContent).toBe("—");
    }
  });

  it("issue #331 / A2: announces 'Coverage pending' ONCE on a partial row WITHOUT overriding PR identity", () => {
    // Locks the A2 contract (post Codex 2026-04-25 review): exactly
    // one SR announcement of 'Coverage pending' per partial row,
    // delivered via a visually-hidden child span — NOT via an
    // ``aria-label`` on the <li> (which would override the
    // listitem's accessible name and drop the PR link's text from
    // list-traversal announcements).  Every metric span stays
    // removed from the a11y tree via aria-hidden so the visually-
    // hidden span is the single SR signal for the partial state.
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 100,
          title: "fix: timeout in coverage backfill",
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
    // PR identity preserved — the listitem MUST NOT carry an
    // ``aria-label`` (which would override the accessible name
    // built from the link text below).  This guard fails if a
    // future change moves the ``Coverage pending`` announcement
    // back onto the <li>.
    expect(row.getAttribute("aria-label")).toBeNull();
    // Link text stays the listitem's primary accessible name.
    const link = row.querySelector<HTMLAnchorElement>(".detail-panel-pr-link");
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain("fix: timeout in coverage backfill");
    // Coverage-pending announcement is delivered by exactly one
    // visually-hidden child span inside the <li>.
    const srNotes = row.querySelectorAll<HTMLSpanElement>(
      "span.visually-hidden",
    );
    expect(srNotes).toHaveLength(1);
    expect(srNotes[0]!.textContent).toBe("Coverage pending");
    // Defense-in-depth: no reachable aria-label leaks anywhere
    // under the row (locks the original A2 intent that "Coverage
    // pending" is announced exactly once and not per metric span).
    const reachableLabels = Array.from(
      row.querySelectorAll<HTMLElement>(
        ":not([aria-hidden='true']) > [aria-label]",
      ),
    );
    expect(reachableLabels).toHaveLength(0);
  });

  it("issue #331 / A2: numeric (non-partial) row carries no visually-hidden 'Coverage pending' note or span aria-hidden", () => {
    // Negative pair — the A2 visually-hidden announcement and
    // span aria-hidden treatment MUST NOT leak onto a numeric
    // (non-partial) row.  A true-zero row still renders explicit
    // ``0`` and stays fully reachable to assistive tech.
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
    expect(row.getAttribute("aria-label")).toBeNull();
    expect(row.querySelectorAll("span.visually-hidden")).toHaveLength(0);
    for (const axis of ["threads", "comments", "unresolved"] as const) {
      const span = metricSpan(row, axis);
      expect(span.getAttribute("aria-hidden")).toBeNull();
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
      // Negative pair with the aria-hidden assertion above — a true
      // zero is NOT partial, so neither aria-hidden nor any
      // ``Coverage pending`` label leaks onto it.
      expect(span.getAttribute("aria-label")).toBeNull();
      expect(span.getAttribute("aria-hidden")).toBeNull();
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
    // Two rows so the C5 controls-visibility guard permits the header
    // to render; see the dedicated single-row suppression test below.
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 1,
          threadCount: 1,
          commentCount: 1,
          activeThreadCount: 0,
        }),
        buildRow({
          id: 2,
          threadCount: 2,
          commentCount: 4,
          activeThreadCount: 1,
        }),
      ],
      renderedCount: 2,
      actualFilteredCount: 2,
      capValue: 500,
      commentsMetricsAvailable: true,
    });
    const root = openWithPrListSection(section);
    const header = root.querySelector<HTMLElement>(
      ".detail-panel-pr-list-header",
    );
    expect(header).not.toBeNull();
    // Issue #342: capability-on multi-row + non-partial → header
    // carries the ``--with-comments`` modifier so the CSS swaps to
    // the 5-col grid template.
    expect(
      header!.classList.contains("detail-panel-pr-list-header--with-comments"),
    ).toBe(true);
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

  it("emits the shared 2-cell PR | Cycle header (no `--with-comments` modifier) on capability-off (issue #342)", () => {
    // Pre-#342 contract was "no header at all on capability-off."
    // Post-#342 the shared PR | Cycle header always emits so the
    // cycle-time number is labeled — but the header carries no
    // ``--with-comments`` modifier and no sort cells, so the
    // capability-off DOM stays free of any comments-metrics surface.
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [buildRow({ id: 1 })],
      renderedCount: 1,
      actualFilteredCount: 1,
      capValue: 500,
      commentsMetricsAvailable: false,
    });
    const root = openWithPrListSection(section);
    const header = root.querySelector<HTMLElement>(
      ".detail-panel-pr-list-header",
    );
    expect(header).not.toBeNull();
    expect(
      header!.classList.contains("detail-panel-pr-list-header--with-comments"),
    ).toBe(false);
    const cells = header!.querySelectorAll<HTMLElement>(
      '[role="columnheader"]',
    );
    expect(cells).toHaveLength(2);
    expect(
      cells[0]!.classList.contains("detail-panel-pr-list-header-cell--pr"),
    ).toBe(true);
    expect(
      cells[1]!.classList.contains("detail-panel-pr-list-header-cell--cycle"),
    ).toBe(true);
    expect(header!.querySelectorAll("button[data-sort-key]")).toHaveLength(0);
  });

  it("unresolved SUPPRESSED-sort cell preserves F8 three-surface disambiguation (Codex review of #342)", () => {
    // Codex stop-time review caught a regression on the post-#342
    // suppressed-sort path: when sort buttons are absent (issue
    // #330 / C5 single-row OR issue #331 / C2 all-partial), the
    // capability-on header still emits 5 cells so the row's metric
    // spans don't render unlabeled, but the prior pass dropped
    // aria-label on the plain-text columnheader cell.  That left the
    // SR accessible name as the truncated visible text "Unresolved",
    // losing the disambiguation the F8 rename was meant to convey.
    //
    // Locks the corrected three-surface contract for the SUPPRESSED-
    // sort cell (no button, no "Sort by" prefix on aria-label):
    //   - visible textContent: "Unresolved" (short, fits track)
    //   - title:               "Unresolved threads" (mouse hover)
    //   - aria-label:          "Unresolved threads" (SR accessible name)
    // Plus the negative pair: Threads / Comments cells (where
    // headerLabel === label) carry NO aria-label and NO title — the
    // visible text already serves as accessible name.
    const section = makePrListSection({
      contentState: "pr-list",
      rows: [
        // Single-row triggers the C5 sort-button suppression (sort-
        // cells path) while keeping capability-on so the metric
        // columnheader cells emit.  The sort-button-PRESENT path
        // for the same axis is locked by the next test.
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

    const unresolvedCell = root.querySelector<HTMLElement>(
      ".detail-panel-pr-list-header-cell--unresolved",
    );
    expect(unresolvedCell).not.toBeNull();
    expect(unresolvedCell!.textContent).toBe("Unresolved");
    expect(unresolvedCell!.getAttribute("title")).toBe("Unresolved threads");
    expect(unresolvedCell!.getAttribute("aria-label")).toBe(
      "Unresolved threads",
    );
    // No sort action on this cell — no button child, no "Sort by"
    // prefix on aria-label.
    expect(unresolvedCell!.querySelector("button")).toBeNull();

    for (const axis of ["threads", "comments"] as const) {
      const cell = root.querySelector<HTMLElement>(
        `.detail-panel-pr-list-header-cell--${axis}`,
      );
      expect(cell).not.toBeNull();
      expect(cell!.getAttribute("aria-label")).toBeNull();
      expect(cell!.getAttribute("title")).toBeNull();
    }
  });

  it("unresolved sort button shows 'Unresolved' visibly with full disambiguation via title + aria-label (F8 + header-fit)", () => {
    // Header-width hardening: the column reserved for the unresolved
    // count is too narrow for the full "Unresolved threads" label.
    // Sighted users see the short ``Unresolved`` form; the full
    // disambiguation the F8 rename was meant to convey is preserved
    // via the hover ``title`` and the screen-reader ``aria-label``.
    // Locks the three-surface contract: visible textContent, hover
    // title, SR aria-label.  Two rows so the C5 controls-visibility
    // guard permits the sort buttons to render.
    const section = makePrListSection({
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
          threadCount: 1,
          commentCount: 2,
          activeThreadCount: 0,
        }),
      ],
      renderedCount: 2,
      actualFilteredCount: 2,
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

describe("issue #332 / B1 — sort SR-live announcer", () => {
  // Locks the contract: when sort buttons render (capability-on, >1
  // row, !all-partial), a polite ``role=status`` live region inside
  // the header announces the new direction on every click.  Suppressed-
  // controls states (capability-off, capability-on single-row,
  // capability-on all-partial) do NOT mount the announcer.
  function announcerSection(): PrListSection {
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

  function clickHeader(root: HTMLElement, key: string): void {
    const button = root.querySelector<HTMLButtonElement>(
      `.detail-panel-pr-list-header button[data-sort-key="${key}"]`,
    );
    if (button === null) {
      throw new Error(`header sort button ${key} not found`);
    }
    button.dispatchEvent(new Event("click", { bubbles: true }));
  }

  function getAnnouncer(root: HTMLElement): HTMLElement {
    const el = root.querySelector<HTMLElement>(
      ".detail-panel-pr-list-sort-announcer",
    );
    if (el === null) throw new Error("sort announcer not rendered");
    return el;
  }

  it("mounts an empty role=status aria-live=polite announcer inside the header on cap-on >1-row !all-partial", () => {
    const root = openWithPrListSection(announcerSection());
    const announcer = getAnnouncer(root);
    expect(announcer.getAttribute("role")).toBe("status");
    expect(announcer.getAttribute("aria-live")).toBe("polite");
    expect(announcer.classList.contains("visually-hidden")).toBe(true);
    // Empty before any sort interaction — no startup announcement.
    expect(announcer.textContent).toBe("");
    // Lives inside the header so its lifecycle is bound to the
    // header that owns the sort buttons (panel re-render rebuilds
    // both together).
    const header = root.querySelector<HTMLElement>(
      ".detail-panel-pr-list-header",
    );
    expect(header).not.toBeNull();
    expect(header!.contains(announcer)).toBe(true);
  });

  it("does NOT mount the announcer in suppressed-controls states (cap-off / single-row / all-partial)", () => {
    const states: ReadonlyArray<{ name: string; section: PrListSection }> = [
      {
        name: "capability-off",
        section: makePrListSection({
          contentState: "pr-list",
          rows: [buildRow({ id: 1 }), buildRow({ id: 2 })],
          renderedCount: 2,
          actualFilteredCount: 2,
          capValue: 500,
          commentsMetricsAvailable: false,
        }),
      },
      {
        name: "capability-on single-row (#330 / C5)",
        section: makePrListSection({
          contentState: "pr-list",
          rows: [
            buildRow({
              id: 1,
              threadCount: 5,
              commentCount: 17,
              activeThreadCount: 2,
            }),
          ],
          renderedCount: 1,
          actualFilteredCount: 1,
          capValue: 500,
          commentsMetricsAvailable: true,
        }),
      },
      {
        name: "capability-on all-partial (#331 / C2)",
        section: makePrListSection({
          contentState: "pr-list",
          rows: [
            buildRow({
              id: 1,
              threadCount: null,
              commentCount: null,
              activeThreadCount: null,
            }),
            buildRow({
              id: 2,
              threadCount: null,
              commentCount: null,
              activeThreadCount: null,
            }),
          ],
          renderedCount: 2,
          actualFilteredCount: 2,
          capValue: 500,
          commentsMetricsAvailable: true,
        }),
      },
    ];
    for (const { name, section } of states) {
      const root = openWithPrListSection(section);
      const announcer = root.querySelector(
        ".detail-panel-pr-list-sort-announcer",
      );
      expect({ state: name, announcer }).toEqual({
        state: name,
        announcer: null,
      });
      dismissDetailPanel("explicit-close-button");
      document.body.innerHTML = "";
    }
  });

  it("announces 'Sorted by {axis}, descending.' / '...ascending.' / 'Sort cleared.' across the cycle", () => {
    const root = openWithPrListSection(announcerSection());
    const announcer = getAnnouncer(root);

    clickHeader(root, "threads");
    expect(announcer.textContent).toBe("Sorted by threads, descending.");

    clickHeader(root, "threads");
    expect(announcer.textContent).toBe("Sorted by threads, ascending.");

    clickHeader(root, "threads");
    expect(announcer.textContent).toBe("Sort cleared.");
  });

  it("announces the new axis when sort switches between columns (single-active-sort copy)", () => {
    const root = openWithPrListSection(announcerSection());
    const announcer = getAnnouncer(root);
    clickHeader(root, "threads");
    expect(announcer.textContent).toBe("Sorted by threads, descending.");
    clickHeader(root, "comments");
    expect(announcer.textContent).toBe("Sorted by comments, descending.");
  });

  it("uses the full disambiguated phrase 'unresolved threads' for the unresolved axis (F8 contract carry-forward)", () => {
    // The unresolved column's visible header text is the short
    // ``Unresolved`` (track-fit), but the sort announcement reuses
    // ``axis.label`` so SR users hear the full disambiguating phrase
    // — same form the column-header ``aria-label`` already uses.
    const root = openWithPrListSection(announcerSection());
    const announcer = getAnnouncer(root);
    clickHeader(root, "unresolved");
    expect(announcer.textContent).toBe(
      "Sorted by unresolved threads, descending.",
    );
  });
});

describe("issue #332 / B2 — single C1 info icon adjacent to 'Min:' controls label", () => {
  // Locks the contract: when the threshold filter renders (capability-
  // on, >1 row, !all-partial), exactly one ``.info-icon-btn`` mounts
  // inside the filter group; pointerenter shows an info tooltip with
  // the C1 inclusion-rule disclosure; pointerleave dismisses; click
  // toggles for touch / keyboard.  Suppressed-controls states emit
  // no icon (the filter itself is absent).
  const C1_TOOLTIP_TEXT =
    "Counts apply Feature 310's inclusion rules. Threads include " +
    "unknown-status threads but exclude deleted ones. Comments include " +
    "system events; deleted comments are excluded. Unresolved counts " +
    "only threads still in active status. Comments by users missing " +
    "from the user table are still counted.";

  function iconSection(): PrListSection {
    return makePrListSection({
      contentState: "pr-list",
      rows: [
        buildRow({
          id: 1,
          threadCount: 1,
          commentCount: 1,
          activeThreadCount: 0,
        }),
        buildRow({
          id: 2,
          threadCount: 2,
          commentCount: 4,
          activeThreadCount: 1,
        }),
      ],
      renderedCount: 2,
      actualFilteredCount: 2,
      capValue: 500,
      commentsMetricsAvailable: true,
    });
  }

  function getIcon(root: HTMLElement): HTMLElement {
    const icon = root.querySelector<HTMLElement>(
      ".detail-panel-pr-list-filter .info-icon-btn",
    );
    if (icon === null)
      throw new Error("comments-metrics info icon not rendered");
    // Tooltip positioning reads getBoundingClientRect; provide a
    // stable rect for jsdom (matches the summary-cards-info pattern).
    icon.getBoundingClientRect = () => ({
      top: 100,
      left: 100,
      bottom: 120,
      right: 120,
      width: 20,
      height: 20,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    });
    return icon;
  }

  afterEach(() => {
    document
      .querySelectorAll(".info-tooltip, .chart-tooltip")
      .forEach((el) => el.remove());
  });

  it("mounts exactly one info-icon-btn inside the filter group with type=button + aria-label + ⓘ glyph", () => {
    const root = openWithPrListSection(iconSection());
    const filter = root.querySelector<HTMLElement>(
      ".detail-panel-pr-list-filter",
    );
    expect(filter).not.toBeNull();
    const icons = filter!.querySelectorAll(".info-icon-btn");
    expect(icons).toHaveLength(1);
    const icon = icons[0]!;
    expect(icon.tagName).toBe("BUTTON");
    expect(icon.getAttribute("type")).toBe("button");
    expect(icon.getAttribute("aria-label")).toBe("About these counts");
    expect(icon.getAttribute("data-info-tooltip")).toBe("comments-metrics-c1");
    expect(icon.textContent).toBe("ℹ");
  });

  it("does NOT mount the info icon in suppressed-controls states (cap-off / single-row / all-partial)", () => {
    const states: ReadonlyArray<{ name: string; section: PrListSection }> = [
      {
        name: "capability-off",
        section: makePrListSection({
          contentState: "pr-list",
          rows: [buildRow({ id: 1 }), buildRow({ id: 2 })],
          renderedCount: 2,
          actualFilteredCount: 2,
          capValue: 500,
          commentsMetricsAvailable: false,
        }),
      },
      {
        name: "capability-on single-row (#330 / C5)",
        section: makePrListSection({
          contentState: "pr-list",
          rows: [
            buildRow({
              id: 1,
              threadCount: 5,
              commentCount: 17,
              activeThreadCount: 2,
            }),
          ],
          renderedCount: 1,
          actualFilteredCount: 1,
          capValue: 500,
          commentsMetricsAvailable: true,
        }),
      },
      {
        name: "capability-on all-partial (#331 / C2)",
        section: makePrListSection({
          contentState: "pr-list",
          rows: [
            buildRow({
              id: 1,
              threadCount: null,
              commentCount: null,
              activeThreadCount: null,
            }),
            buildRow({
              id: 2,
              threadCount: null,
              commentCount: null,
              activeThreadCount: null,
            }),
          ],
          renderedCount: 2,
          actualFilteredCount: 2,
          capValue: 500,
          commentsMetricsAvailable: true,
        }),
      },
    ];
    for (const { name, section } of states) {
      const root = openWithPrListSection(section);
      const icon = root.querySelector(".info-icon-btn");
      expect({ state: name, icon }).toEqual({ state: name, icon: null });
      dismissDetailPanel("explicit-close-button");
      document.body.innerHTML = "";
    }
  });

  it("pointerenter shows an info tooltip carrying the exact C1 disclosure text", () => {
    const root = openWithPrListSection(iconSection());
    const icon = getIcon(root);
    icon.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    const tooltip = document.querySelector(".info-tooltip");
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toBe(C1_TOOLTIP_TEXT);
  });

  it("pointerleave dismisses the open info tooltip", () => {
    const root = openWithPrListSection(iconSection());
    const icon = getIcon(root);
    icon.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    expect(document.querySelector(".info-tooltip")).not.toBeNull();
    icon.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    expect(document.querySelector(".info-tooltip")).toBeNull();
  });

  it("click toggles the info tooltip — first click shows, second click dismisses (touch / keyboard path)", () => {
    // Exercises BOTH arms of the click-handler ``existing !== null``
    // check: first click hits the ``null`` arm (no tooltip → show);
    // second click hits the non-null arm (tooltip exists → dismiss).
    // Required for partial-branch ratchet coverage.  The two clicks
    // run synchronously so the rAF-deferred ``dismissOnce`` listener
    // never attaches; the second click is dismissed by the icon's
    // own handler via the ``existing !== null`` arm.
    const root = openWithPrListSection(iconSection());
    const icon = getIcon(root);
    icon.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const opened = document.querySelector(".info-tooltip");
    expect(opened).not.toBeNull();
    expect(opened!.textContent).toBe(C1_TOOLTIP_TEXT);
    icon.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".info-tooltip")).toBeNull();
  });

  it("clicks outside the icon dismiss an open tooltip via the rAF-deferred document listener (Codex stop-time review)", async () => {
    // Locks the outside-click dismiss path the initial #332 / B2 pass
    // missed: a click-shown tooltip persisted indefinitely on outside-
    // click.  The rAF defer makes the listener inert for the click
    // that opened the tooltip; we explicitly yield to ``rAF`` here so
    // the listener is attached before the next dispatch.
    const root = openWithPrListSection(iconSection());
    const icon = getIcon(root);
    icon.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".info-tooltip")).not.toBeNull();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".info-tooltip")).toBeNull();
  });

  it("dismissing the panel removes any open info tooltip (Codex stop-time review)", () => {
    // Locks the panel-teardown contract the initial #332 / B2 pass
    // missed: ``showInfoTooltip`` mounts the tooltip on
    // ``document.body``, not the panel itself, so a tooltip opened
    // before panel close persisted as an orphan.  ``dismissDetailPanel``
    // now calls ``dismissAllTooltips`` so closing the panel for ANY
    // reason (escape / outside-click / explicit close / filters
    // changed / tab changed / comparison toggled) drops the tooltip.
    const root = openWithPrListSection(iconSection());
    const icon = getIcon(root);
    icon.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    expect(document.querySelector(".info-tooltip")).not.toBeNull();
    dismissDetailPanel("explicit-close-button");
    expect(document.querySelector(".info-tooltip")).toBeNull();
  });
});
