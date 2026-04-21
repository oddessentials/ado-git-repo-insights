/**
 * Throughput drill-down unit tests (US1).
 *
 * Covers `extension/ui/modules/drilldown/throughput-drilldown.ts` per
 * `specs/059-chart-drill-down/contracts/drilldown-integration.md`:
 * delegated click activation, keyboard activation (Enter/Space),
 * panel content shape, `is-drilldown-active` lifecycle (MutationObserver
 * tied to panel root + install-scope AbortController), comparison-mode
 * advisory routing, dispose semantics, rerender sequence, and
 * coexistence with the existing chart-tooltip handler.
 */

import { renderThroughputChart } from "../../../ui/modules/charts/throughput";
import { installThroughputDrilldown } from "../../../ui/modules/drilldown/throughput-drilldown";
import {
  publishComparisonToggled,
  publishFiltersChanged,
} from "../../../ui/modules/drilldown/lifecycle-signals";
import { __resetComparisonAdvisoryForTests } from "../../../ui/modules/drilldown/comparison-advisory";
import {
  dismissDetailPanel,
  isDetailPanelOpen,
} from "../../../ui/modules/shared/detail-panel";
import type { Rollup } from "../../../ui/dataset-loader";

// jsdom lacks PointerEvent — mirror the polyfill used by other tests
// (e.g. detail-panel.test.ts, tooltip.test.ts). Only needed for the
// tooltip-coexistence tests that simulate the tap pointer sequence.
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

function makeRollup(overrides: Partial<Rollup> = {}): Rollup {
  return {
    week: "2025-W12",
    pr_count: 47,
    cycle_time_p50: null,
    cycle_time_p90: null,
    authors_count: 3,
    reviewers_count: 2,
    by_repository: {
      "backend-api": { pr_count: 20 },
      frontend: { pr_count: 27 },
    },
    by_author: {
      alice: { pr_count: 12 },
      bob: { pr_count: 35 },
    },
    by_team: null,
    ...overrides,
  };
}

function mountChart(rollups: Rollup[]): HTMLElement {
  const container = document.createElement("div");
  container.id = "throughput-chart";
  document.body.appendChild(container);
  renderThroughputChart(container, rollups);
  return container;
}

function firstBar(container: HTMLElement): HTMLElement {
  const bar = container.querySelector<HTMLElement>(".bar-container");
  if (!bar) throw new Error("bar-container not rendered");
  return bar;
}

function click(target: HTMLElement): void {
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("throughput-drilldown", () => {
  beforeEach(() => {
    publishComparisonToggled({ enabled: false });
    __resetComparisonAdvisoryForTests();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    if (isDetailPanelOpen()) dismissDetailPanel("explicit-close-button");
    publishComparisonToggled({ enabled: false });
    __resetComparisonAdvisoryForTests();
    document.body.innerHTML = "";
  });

  // -------------------------------------------------------------------------
  // Activation paths
  // -------------------------------------------------------------------------

  it("pointer tap opens the panel with week-range title and PR-count subtitle", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    expect(isDetailPanelOpen()).toBe(true);
    const panel = document.querySelector<HTMLElement>("aside.detail-panel");
    expect(panel).not.toBeNull();
    // ISO 2025-W12 runs Mon Mar 17 – Sun Mar 23. The title must show
    // those calendar dates regardless of the user's local timezone;
    // a UTC-constructed date plus a local-tz formatter would shift
    // the display one day earlier for timezones west of UTC.
    const title = panel!.querySelector("#detail-panel-title")!.textContent;
    expect(title).toBe("Week of Mar 17 – 23, 2025");
    expect(
      panel!.querySelector(".detail-panel-subtitle")!.textContent,
    ).toContain("47 PRs");
  });

  it("panel renders By-author breakdown rows with friendly names from authorsDimension (sorted desc)", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups, {
      authorsDimension: [
        { author_id: "alice", author_name: "Alice Smith" },
        { author_id: "bob", author_name: "Bob Jones" },
      ],
    });

    click(firstBar(container));

    const authorSection = document.querySelectorAll(
      ".detail-panel-section--breakdown-table",
    )[0]!;
    expect(authorSection.querySelector("h3")!.textContent).toBe("By author");
    const rowLabels = Array.from(
      authorSection.querySelectorAll("tbody th[scope='row']"),
    ).map((th) => th.textContent);
    // #308: raw `user_id` keys ("alice", "bob") are resolved to friendly
    // names; no GUID-shaped text surfaces to the user.
    expect(rowLabels).toEqual(["Bob Jones", "Alice Smith"]);
    const rowValues = Array.from(
      authorSection.querySelectorAll("tbody tr td"),
    ).map((td) => td.textContent);
    expect(rowValues).toEqual(["35", "12"]);
  });

  it("By-author non-UUID keys render verbatim when authorsDimension is missing (Codex catch: no blanket masking)", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    // Dimension not yet loaded (early-render race). Panel must not
    // crash; non-UUID keys ("alice", "bob") are already human-readable
    // and survive the fallback unchanged.
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    const authorSection = document.querySelectorAll(
      ".detail-panel-section--breakdown-table",
    )[0]!;
    const rowLabels = Array.from(
      authorSection.querySelectorAll("tbody th[scope='row']"),
    ).map((th) => th.textContent);
    expect(rowLabels).toEqual(["bob", "alice"]);
    const rowValues = Array.from(
      authorSection.querySelectorAll("tbody tr td"),
    ).map((td) => td.textContent);
    expect(rowValues).toEqual(["35", "12"]);
  });

  it("By-author UUID keys fall back to 'Unknown user' when authorsDimension is missing", () => {
    // #308 + Codex catch: only UUID-shaped keys mask; the GUID itself
    // must never surface as visible text.
    const rollups = [
      makeRollup({
        by_author: {
          "f47ac10b-58cc-4372-a567-0e02b2c3d479": { pr_count: 35 },
          "12345678-1234-1234-1234-123456789abc": { pr_count: 12 },
        },
      }),
    ];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    const authorSection = document.querySelectorAll(
      ".detail-panel-section--breakdown-table",
    )[0]!;
    const rowLabels = Array.from(
      authorSection.querySelectorAll("tbody th[scope='row']"),
    ).map((th) => th.textContent);
    expect(rowLabels).toEqual(["Unknown user", "Unknown user"]);
  });

  it("By-author mixed keys: resolved → name, UUID-missing → fallback, non-UUID-missing → raw id", () => {
    const rollups = [
      makeRollup({
        by_author: {
          alice: { pr_count: 35 },
          "f47ac10b-58cc-4372-a567-0e02b2c3d479": { pr_count: 20 },
          "legacy-user-42": { pr_count: 8 },
        },
      }),
    ];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups, {
      authorsDimension: [{ author_id: "alice", author_name: "Alice Smith" }],
    });

    click(firstBar(container));

    const authorSection = document.querySelectorAll(
      ".detail-panel-section--breakdown-table",
    )[0]!;
    const rowLabels = Array.from(
      authorSection.querySelectorAll("tbody th[scope='row']"),
    ).map((th) => th.textContent);
    // Sorted by pr_count desc: alice (35) → resolved, UUID (20) →
    // masked, legacy-user-42 (8) → raw (non-UUID).
    expect(rowLabels).toEqual([
      "Alice Smith",
      "Unknown user",
      "legacy-user-42",
    ]);
  });

  it("panel renders By-repository breakdown rows from rollup.by_repository", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    const repoSection = document.querySelectorAll(
      ".detail-panel-section--breakdown-table",
    )[1]!;
    expect(repoSection.querySelector("h3")!.textContent).toBe("By repository");
    const rowLabels = Array.from(
      repoSection.querySelectorAll("tbody th[scope='row']"),
    ).map((th) => th.textContent);
    expect(rowLabels).toEqual(["frontend", "backend-api"]);
  });

  it("By-repository labels are UNAFFECTED by authorsDimension (name resolution is column-scoped)", () => {
    // Regression guard: authorsDimension must only reach the By-author
    // column; By-repository keys are repository_names, not GUIDs, and
    // must render verbatim regardless of what authors are supplied.
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups, {
      authorsDimension: [
        { author_id: "alice", author_name: "Alice Smith" },
        { author_id: "frontend", author_name: "SHOULD NOT APPEAR" },
      ],
    });

    click(firstBar(container));

    const repoSection = document.querySelectorAll(
      ".detail-panel-section--breakdown-table",
    )[1]!;
    const rowLabels = Array.from(
      repoSection.querySelectorAll("tbody th[scope='row']"),
    ).map((th) => th.textContent);
    expect(rowLabels).toEqual(["frontend", "backend-api"]);
  });

  // -------------------------------------------------------------------------
  // Class lifecycle / MutationObserver
  // -------------------------------------------------------------------------

  it("adds is-drilldown-active to the clicked bar and clears it on dismiss", async () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);
    const bar = firstBar(container);

    click(bar);
    expect(bar.classList.contains("is-drilldown-active")).toBe(true);

    dismissDetailPanel("explicit-close-button");
    // MutationObserver callbacks are microtasks; await a microtask turn.
    await Promise.resolve();

    expect(bar.classList.contains("is-drilldown-active")).toBe(false);
  });

  it("dispose() mid-open clears is-drilldown-active and disconnects the panel observer", async () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    const handle = installThroughputDrilldown(container, rollups);
    const bar = firstBar(container);

    click(bar);
    expect(bar.classList.contains("is-drilldown-active")).toBe(true);

    handle.dispose();

    expect(bar.classList.contains("is-drilldown-active")).toBe(false);
    // Even if the panel is dismissed after dispose, the observer must not
    // touch the trigger class again — disconnected observers don't fire.
    dismissDetailPanel("explicit-close-button");
    await Promise.resolve();
    expect(bar.classList.contains("is-drilldown-active")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Empty-state paths
  // -------------------------------------------------------------------------

  it("by_author null renders an EmptyStateSection (not an empty table)", () => {
    const rollups = [makeRollup({ by_author: null })];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    const emptyStates = document.querySelectorAll(
      ".detail-panel-section--empty-state",
    );
    expect(emptyStates.length).toBe(1);
    expect(emptyStates[0]!.querySelector("h3")!.textContent).toBe("By author");
  });

  it("by_repository empty object renders an EmptyStateSection (not an empty table)", () => {
    const rollups = [makeRollup({ by_repository: {} })];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    const emptyStates = document.querySelectorAll(
      ".detail-panel-section--empty-state",
    );
    expect(emptyStates.length).toBe(1);
    expect(emptyStates[0]!.querySelector("h3")!.textContent).toBe(
      "By repository",
    );
  });

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  it("dispose() detaches listeners — subsequent pointer tap does not open panel", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    const handle = installThroughputDrilldown(container, rollups);

    handle.dispose();
    click(firstBar(container));

    expect(isDetailPanelOpen()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Comparison advisory routing
  // -------------------------------------------------------------------------

  it("routes to comparison advisory toast when comparison mode is active", () => {
    const rollups = [makeRollup()];
    // Comparison-advisory requires chart containers present to annotate;
    // #throughput-chart is already created by mountChart.
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    publishComparisonToggled({ enabled: true });
    click(firstBar(container));

    expect(isDetailPanelOpen()).toBe(false);
    expect(document.querySelector(".comparison-advisory-toast")).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Keyboard activation (independent of pointer path)
  // -------------------------------------------------------------------------

  it("keyboard Enter on a focused bar opens the panel", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);
    const bar = firstBar(container);

    bar.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }),
    );

    expect(isDetailPanelOpen()).toBe(true);
  });

  it("keyboard Space opens the panel and calls preventDefault on the event", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);
    const bar = firstBar(container);

    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: " ",
    });
    bar.dispatchEvent(event);

    expect(isDetailPanelOpen()).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Tooltip coexistence (narrow: panel opens, tooltip path unbroken)
  // -------------------------------------------------------------------------

  it("dismisses any active chart tooltip when the drill-down opens", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);
    const bar = firstBar(container);

    // Simulate the pointer sequence the browser runs on a tap: tooltip
    // pointerup fires first and shows the .chart-tooltip, then the
    // synthesized click reaches our delegated drill-down listener.
    bar.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    bar.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    expect(document.querySelector(".chart-tooltip")).not.toBeNull();

    click(bar);

    expect(isDetailPanelOpen()).toBe(true);
    expect(document.querySelector(".chart-tooltip")).toBeNull();
  });

  it("dismisses any active chart tooltip when comparison advisory toast fires", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);
    const bar = firstBar(container);

    publishComparisonToggled({ enabled: true });

    bar.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    bar.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    expect(document.querySelector(".chart-tooltip")).not.toBeNull();

    click(bar);

    expect(isDetailPanelOpen()).toBe(false);
    expect(document.querySelector(".chart-tooltip")).toBeNull();
    expect(document.querySelector(".comparison-advisory-toast")).not.toBeNull();
  });

  it("coexists with the chart-tooltip — click opens panel; tooltip attribute preserved", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    // Our panel opened.
    expect(document.querySelectorAll("aside.detail-panel.is-open").length).toBe(
      1,
    );
    // The tooltip's per-bar listener still had a chance to run (it wasn't
    // torn down by our install); the specific tooltip DOM is owned by
    // tooltip-manager, so we don't pin its structure here beyond
    // "the tooltip system did not crash and the bar is still tooltip-wired".
    expect(firstBar(container).getAttribute("data-tooltip")).toBe("true");
  });

  // -------------------------------------------------------------------------
  // Rerender sequence (dashboard.ts flow on filter change)
  // -------------------------------------------------------------------------

  it("after dispose→reinstall across a rerender only the newly-clicked bar is active", async () => {
    const rollups = [
      makeRollup({ week: "2025-W12" }),
      makeRollup({ week: "2025-W13", pr_count: 50 }),
    ];
    const container = mountChart(rollups);
    let handle = installThroughputDrilldown(container, rollups);

    const [barA, barB] = Array.from(
      container.querySelectorAll<HTMLElement>(".bar-container"),
    );
    if (!barA || !barB) throw new Error("expected two bars");

    click(barA);
    expect(barA.classList.contains("is-drilldown-active")).toBe(true);

    // Simulate dashboard.ts refreshMetrics: publishFiltersChanged closes
    // the panel via DetailPanel's open-scoped listener, then dispose runs.
    publishFiltersChanged({ reason: "user-change" });
    await Promise.resolve();
    handle.dispose();

    // Re-install (new cycle's render already wired the DOM — in this test
    // the DOM persists, which is stricter than production).
    handle = installThroughputDrilldown(container, rollups);
    click(barB);

    expect(document.querySelectorAll("aside.detail-panel.is-open").length).toBe(
      1,
    );
    const active = Array.from(
      document.querySelectorAll<HTMLElement>(".is-drilldown-active"),
    );
    expect(active.length).toBe(1);
    expect(active[0]).toBe(barB);

    handle.dispose();
  });

  // -------------------------------------------------------------------------
  // A11y surface: focusable + button role
  // -------------------------------------------------------------------------

  it("bars expose a button-role focusable surface (tabindex=0, role=button, focus() works)", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    const bar = firstBar(container);

    expect(bar.tabIndex).toBe(0);
    expect(bar.getAttribute("role")).toBe("button");
    bar.focus();
    expect(document.activeElement).toBe(bar);
  });

  // -------------------------------------------------------------------------
  // Coverage hardening — exercise every reachable early-return branch
  // -------------------------------------------------------------------------

  it("malformed week key falls back to 'Week {raw}' title", () => {
    const rollups = [makeRollup({ week: "not-iso" })];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    const title = document.querySelector("#detail-panel-title")!.textContent;
    expect(title).toBe("Week not-iso");
  });

  it("falls back to the ISO-week computation when start_date/end_date are unparseable", () => {
    const rollups = [
      makeRollup({
        week: "2025-W12",
        start_date: "not-a-date",
        end_date: "also-not-a-date",
      }),
    ];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    expect(document.querySelector("#detail-panel-title")!.textContent).toBe(
      "Week of Mar 17 – 23, 2025",
    );
  });

  it("falls back when start_date is syntactically valid but an impossible calendar date", () => {
    // "2025-02-31" would silently roll over to March 3 in
    // `new Date(y, m, d)`; the parser must reject it so the ISO-week
    // fallback renders the correct title instead.
    const rollups = [
      makeRollup({
        week: "2025-W12",
        start_date: "2025-02-31",
        end_date: "2025-02-31",
      }),
    ];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    expect(document.querySelector("#detail-panel-title")!.textContent).toBe(
      "Week of Mar 17 – 23, 2025",
    );
  });

  it("formats a cross-month week range with both month names", () => {
    // Example: ISO 2025-W14 runs Mon Mar 31 – Sun Apr 6; the formatter
    // must keep both month abbreviations when the range spans months.
    const rollups = [
      makeRollup({
        week: "2025-W14",
        start_date: "2025-03-31",
        end_date: "2025-04-06",
      }),
    ];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    expect(document.querySelector("#detail-panel-title")!.textContent).toBe(
      "Week of Mar 31 – Apr 6, 2025",
    );
  });

  it("formats a cross-year week range with both years", () => {
    // Example: ISO 2025-W01 runs Mon Dec 30 2024 – Sun Jan 5 2025.
    const rollups = [
      makeRollup({
        week: "2025-W01",
        start_date: "2024-12-30",
        end_date: "2025-01-05",
      }),
    ];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    expect(document.querySelector("#detail-panel-title")!.textContent).toBe(
      "Week of Dec 30, 2024 – Jan 5, 2025",
    );
  });

  it("prefers the rollup's authoritative start_date/end_date over the ISO-week computation", () => {
    // rollup.week would compute "Mar 17 – Mar 23" via isoWeekRange, but
    // the pipeline is the source of truth — if it writes a different
    // start_date/end_date pair (e.g., because of an off-by-one edge or
    // a non-standard calendar boundary), we must honor the pipeline.
    const rollups = [
      makeRollup({
        week: "2025-W12",
        start_date: "2025-04-07",
        end_date: "2025-04-13",
      }),
    ];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    expect(document.querySelector("#detail-panel-title")!.textContent).toBe(
      "Week of Apr 7 – 13, 2025",
    );
  });

  it("week-number outside ISO range (00–99) falls back to 'Week {raw}' title", () => {
    const rollups = [makeRollup({ week: "2025-W99" })];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    const title = document.querySelector("#detail-panel-title")!.textContent;
    expect(title).toBe("Week 2025-W99");
  });

  it("subtitle uses singular 'PR' when pr_count is 1", () => {
    const rollups = [makeRollup({ pr_count: 1 })];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    click(firstBar(container));

    expect(document.querySelector(".detail-panel-subtitle")!.textContent).toBe(
      "1 PR",
    );
  });

  it("panel class mutation that keeps is-open leaves is-drilldown-active intact", async () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);
    const bar = firstBar(container);

    click(bar);
    const panel = document.querySelector<HTMLElement>("aside.detail-panel")!;
    panel.classList.add("a-non-open-class");
    await Promise.resolve();

    expect(bar.classList.contains("is-drilldown-active")).toBe(true);
  });

  it("empty data-drilldown-week attribute is a no-op (no panel opens)", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);
    const bar = firstBar(container);
    bar.setAttribute("data-drilldown-week", "");

    click(bar);

    expect(isDetailPanelOpen()).toBe(false);
  });

  it("bar whose week is not in the rollups slice is a no-op (no panel opens)", () => {
    const rollups = [makeRollup({ week: "2025-W12" })];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);
    const bar = firstBar(container);
    bar.setAttribute("data-drilldown-week", "2099-W42");

    click(bar);

    expect(isDetailPanelOpen()).toBe(false);
  });

  it("click on the container outside any bar is ignored", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    // Dispatching on the container itself: closest('[data-drilldown-week]')
    // finds nothing above container, so resolveTrigger returns null.
    click(container);

    expect(isDetailPanelOpen()).toBe(false);
  });

  it("keydown with an unrelated key (e.g. Escape) on a bar is ignored", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    firstBar(container).dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      }),
    );

    expect(isDetailPanelOpen()).toBe(false);
  });

  it("keydown outside any bar (on the container) is ignored", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }),
    );

    expect(isDetailPanelOpen()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Comparison-mode keyboard guard (PR #302 P1.E checklist)
  // -------------------------------------------------------------------------

  it("keyboard Enter in comparison mode opens the advisory toast, NOT the panel", () => {
    const rollups = [makeRollup()];
    const container = mountChart(rollups);
    installThroughputDrilldown(container, rollups);

    publishComparisonToggled({ enabled: true });
    firstBar(container).dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }),
    );

    expect(isDetailPanelOpen()).toBe(false);
    expect(document.querySelector(".comparison-advisory-toast")).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // aria-expanded toggle (PR #302 P1.E sentinel)
  // -------------------------------------------------------------------------

  describe("aria-expanded toggle", () => {
    it("renders aria-expanded='false' on every bar at install time", () => {
      const rollups = [makeRollup({ week: "2025-W11" }), makeRollup()];
      const container = mountChart(rollups);
      installThroughputDrilldown(container, rollups);

      const bars = container.querySelectorAll<HTMLElement>(".bar-container");
      expect(bars.length).toBe(2);
      for (const bar of Array.from(bars)) {
        expect(bar.getAttribute("aria-expanded")).toBe("false");
      }
    });

    it("flips aria-expanded='true' on the activated bar when the panel opens", () => {
      const rollups = [makeRollup()];
      const container = mountChart(rollups);
      installThroughputDrilldown(container, rollups);
      const bar = firstBar(container);

      click(bar);

      expect(isDetailPanelOpen()).toBe(true);
      expect(bar.getAttribute("aria-expanded")).toBe("true");
    });

    it("resets aria-expanded='false' on the trigger via every dismiss path through clearActive", async () => {
      const rollups = [makeRollup()];
      const container = mountChart(rollups);
      installThroughputDrilldown(container, rollups);
      const bar = firstBar(container);

      click(bar);
      expect(bar.getAttribute("aria-expanded")).toBe("true");

      dismissDetailPanel("explicit-close-button");
      // MutationObserver on panel.is-open is async — let the microtask
      // run so clearActive fires and resets aria-expanded.
      await Promise.resolve();
      expect(bar.getAttribute("aria-expanded")).toBe("false");
    });
  });

  // -------------------------------------------------------------------------
  // Feature 060: PR-detail section rendering (T020)
  // -------------------------------------------------------------------------
  describe("PR-detail section (feature 060)", () => {
    const BASE_WEB_CTX = {
      collectionUri: "https://dev.azure.com/acme/",
    };
    const BASE_REPOS = [
      {
        repository_id: "repo-1",
        repository_name: "web-app",
        project_name: "Frontend",
        organization_name: "acme",
      },
    ];

    function makeRollupWithPrs(
      prs: ReadonlyArray<{
        id: number;
        title: string;
        author_id: string;
        repository_id: string;
        cycle_time: number;
      }>,
      overrides: Partial<Rollup> = {},
    ): Rollup {
      return makeRollup({
        pr_count: prs.length,
        prs,
        _prs_truncated: false,
        _prs_cap: 500,
        ...overrides,
      });
    }

    it("unfiltered week with PRs renders PrListSection contentState='pr-list' with row title, cycle time, and URL", () => {
      const rollups = [
        makeRollupWithPrs([
          {
            id: 101,
            title: "feat: oauth",
            author_id: "alice",
            repository_id: "repo-1",
            cycle_time: 125.0,
          },
          {
            id: 102,
            title: "fix: null guard",
            author_id: "bob",
            repository_id: "repo-1",
            cycle_time: 45.0,
          },
        ]),
      ];
      const container = mountChart(rollups);
      installThroughputDrilldown(container, rollups, {
        filters: { repos: [], teams: [], reviewers: [], authors: [] },
        repositoriesDimension: BASE_REPOS,
        webContext: BASE_WEB_CTX,
      });

      const bar = firstBar(container);
      // T026 affordance check — bar MUST remain keyboard-/screen-reader-
      // activatable even after the new PR section is appended.
      expect(bar.getAttribute("tabindex")).not.toBeNull();
      expect(bar.getAttribute("role")).not.toBeNull();
      expect(bar.getAttribute("aria-label")).not.toBeNull();

      click(bar);

      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      expect(prSection!.getAttribute("data-content-state")).toBe("pr-list");
      expect(prSection!.querySelector("h3")!.textContent).toBe("Pull requests");

      const rowLinks = prSection!.querySelectorAll<HTMLAnchorElement>(
        "ol li .detail-panel-pr-link",
      );
      expect(rowLinks.length).toBe(2);
      expect(rowLinks[0]!.getAttribute("href")).toBe(
        "https://dev.azure.com/acme/Frontend/_git/web-app/pullrequest/101",
      );
      expect(rowLinks[0]!.textContent).toContain("#101");
      expect(rowLinks[0]!.textContent).toContain("feat: oauth");
      expect(rowLinks[0]!.getAttribute("target")).toBe("_blank");
      expect(rowLinks[0]!.getAttribute("rel")).toContain("noopener");

      const cycleTexts = Array.from(
        prSection!.querySelectorAll("ol li .cycle-time"),
      ).map((el) => el.textContent);
      // 125 min = 2.1h ; 45 min = 45m (formatDuration output shape).
      expect(cycleTexts[0]).toBe("2.1h");
      expect(cycleTexts[1]).toBe("45m");

      // No truncation indicator when rendered === actualFiltered.
      expect(prSection!.querySelector(".truncation-indicator")).toBeNull();
    });

    it("truncated week (rendered < actualFiltered) shows truncation indicator with both counts", () => {
      // Aggregator-side the prs array is already capped at 500; we simulate
      // that by providing 2 rendered rows against a chart pr_count of 47
      // with _prs_truncated=true.
      const rollups = [
        makeRollupWithPrs(
          [
            {
              id: 201,
              title: "big refactor",
              author_id: "carol",
              repository_id: "repo-1",
              cycle_time: 1200.0,
            },
            {
              id: 202,
              title: "tiny tweak",
              author_id: "dave",
              repository_id: "repo-1",
              cycle_time: 800.0,
            },
          ],
          { pr_count: 47, _prs_truncated: true, _prs_cap: 500 },
        ),
      ];
      const container = mountChart(rollups);
      installThroughputDrilldown(container, rollups, {
        filters: { repos: [], teams: [], reviewers: [], authors: [] },
        repositoriesDimension: BASE_REPOS,
        webContext: BASE_WEB_CTX,
      });

      click(firstBar(container));

      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      const indicator = prSection!.querySelector(".truncation-indicator");
      expect(indicator).not.toBeNull();
      const indicatorText = indicator!.textContent ?? "";
      // FR-008: both counts surfaced.
      expect(indicatorText).toContain("2");
      expect(indicatorText).toContain("47");
      expect(indicatorText).toContain("500");
    });

    it("supported filter with no PRs in rollup renders contentState='supported-empty' (never omits the section)", () => {
      // Feature 060 FR-020: the section is never omitted — even on an old
      // rollup that predates `prs`, the section renders a supported-empty
      // placeholder so users see a consistent surface.
      const rollups = [makeRollup()]; // no prs field
      const container = mountChart(rollups);
      installThroughputDrilldown(container, rollups, {
        filters: { repos: [], teams: [], reviewers: [], authors: [] },
        repositoriesDimension: BASE_REPOS,
        webContext: BASE_WEB_CTX,
      });

      click(firstBar(container));

      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      expect(prSection!.getAttribute("data-content-state")).toBe(
        "supported-empty",
      );
      // No rows rendered in supported-empty.
      expect(prSection!.querySelector("ol")).toBeNull();
    });

    // T034 (feature 060 Phase 5)
    it("team filter active → PrListSection contentState='team-inline', inline message names team filter", () => {
      const rollups = [
        makeRollupWithPrs([
          {
            id: 301,
            title: "blocked by team gate",
            author_id: "alice",
            repository_id: "repo-1",
            cycle_time: 600,
          },
        ]),
      ];
      const container = mountChart(rollups);
      installThroughputDrilldown(container, rollups, {
        filters: {
          repos: [],
          teams: ["platform-core"],
          reviewers: [],
          authors: [],
        },
        repositoriesDimension: BASE_REPOS,
        webContext: BASE_WEB_CTX,
      });

      click(firstBar(container));

      // Panel opens (Phase 1 behavior preserved under team filter).
      expect(isDetailPanelOpen()).toBe(true);

      // Phase 1 aggregate sections render unchanged.
      expect(
        document.querySelectorAll(".detail-panel-section--breakdown-table")
          .length,
      ).toBeGreaterThanOrEqual(1);

      // PR-detail container flips to team-inline content state.
      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      expect(prSection!.getAttribute("data-content-state")).toBe("team-inline");
      const gated = prSection!.querySelector(".pr-detail-gated");
      expect(gated).not.toBeNull();
      expect(gated!.textContent ?? "").toMatch(/team/i);
      // Inline message is a status announcement, not an alert.
      expect(gated!.getAttribute("aria-live")).toBe("polite");
      // No PR rows rendered under team filter.
      expect(prSection!.querySelector("ol")).toBeNull();
    });

    // T035 (feature 060 Phase 5)
    it("reviewer filter active → PrListSection contentState='reviewer-inline', inline message names reviewer filter", () => {
      const rollups = [
        makeRollupWithPrs([
          {
            id: 401,
            title: "not rendered",
            author_id: "alice",
            repository_id: "repo-1",
            cycle_time: 300,
          },
        ]),
      ];
      const container = mountChart(rollups);
      installThroughputDrilldown(container, rollups, {
        filters: {
          repos: [],
          teams: [],
          reviewers: ["reviewer-007"],
          authors: [],
        },
        repositoriesDimension: BASE_REPOS,
        webContext: BASE_WEB_CTX,
      });

      click(firstBar(container));

      expect(isDetailPanelOpen()).toBe(true);
      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      expect(prSection!.getAttribute("data-content-state")).toBe(
        "reviewer-inline",
      );
      const gated = prSection!.querySelector(".pr-detail-gated");
      expect(gated).not.toBeNull();
      expect(gated!.textContent ?? "").toMatch(/reviewer/i);
      expect(gated!.getAttribute("aria-live")).toBe("polite");
      expect(prSection!.querySelector("ol")).toBeNull();
    });

    // T036 (feature 060 Phase 5)
    it("comparison-mode active → panel stays closed, PR-detail container is not constructed (Phase 1 toast-denial preserved)", () => {
      const rollups = [
        makeRollupWithPrs([
          {
            id: 501,
            title: "should not appear",
            author_id: "alice",
            repository_id: "repo-1",
            cycle_time: 900,
          },
        ]),
      ];
      const container = mountChart(rollups);
      installThroughputDrilldown(container, rollups, {
        filters: { repos: [], teams: [], reviewers: [], authors: [] },
        repositoriesDimension: BASE_REPOS,
        webContext: BASE_WEB_CTX,
      });

      publishComparisonToggled({ enabled: true });
      click(firstBar(container));

      // FR-007a: panel DOES NOT open, comparison advisory toast fires.
      expect(isDetailPanelOpen()).toBe(false);
      expect(
        document.querySelector(".comparison-advisory-toast"),
      ).not.toBeNull();
      // PR-detail container must not be constructed when activate() early-
      // returns — no leaked <section id="pr-detail"> anywhere in the DOM.
      expect(document.getElementById("pr-detail")).toBeNull();
    });

    // T056 (feature 060 Phase 8, SC-008 / FR-016)
    it("keyboard activation (Enter / Space) produces the same PR-detail outcomes as mouse click across every gated state", () => {
      // Single test covers the four-state matrix from FR-016 / SC-008. Each
      // sub-case reinstalls the drill-down so options + filter state are
      // distinct across sub-cases — matches the production re-install-
      // per-refresh pattern.
      type Sub = {
        readonly label: string;
        readonly key: "Enter" | " ";
        readonly options: Parameters<typeof installThroughputDrilldown>[2];
        readonly rollup: () => Rollup;
        readonly comparisonActive?: boolean;
        readonly expectPanelOpen: boolean;
        readonly expectContentState?:
          | "pr-list"
          | "supported-empty"
          | "team-inline"
          | "reviewer-inline";
      };

      const subs: readonly Sub[] = [
        {
          label: "supported + Enter",
          key: "Enter",
          options: {
            filters: { repos: [], teams: [], reviewers: [], authors: [] },
            repositoriesDimension: BASE_REPOS,
            webContext: BASE_WEB_CTX,
          },
          rollup: () =>
            makeRollupWithPrs([
              {
                id: 9001,
                title: "kbd-open",
                author_id: "alice",
                repository_id: "repo-1",
                cycle_time: 60,
              },
            ]),
          expectPanelOpen: true,
          expectContentState: "pr-list",
        },
        {
          label: "team-inline + Space",
          key: " ",
          options: {
            filters: {
              repos: [],
              teams: ["platform"],
              reviewers: [],
              authors: [],
            },
            repositoriesDimension: BASE_REPOS,
            webContext: BASE_WEB_CTX,
          },
          rollup: () =>
            makeRollupWithPrs([
              {
                id: 9002,
                title: "kbd-team",
                author_id: "alice",
                repository_id: "repo-1",
                cycle_time: 120,
              },
            ]),
          expectPanelOpen: true,
          expectContentState: "team-inline",
        },
        {
          label: "reviewer-inline + Enter",
          key: "Enter",
          options: {
            filters: {
              repos: [],
              teams: [],
              reviewers: ["bob"],
              authors: [],
            },
            repositoriesDimension: BASE_REPOS,
            webContext: BASE_WEB_CTX,
          },
          rollup: () =>
            makeRollupWithPrs([
              {
                id: 9003,
                title: "kbd-reviewer",
                author_id: "alice",
                repository_id: "repo-1",
                cycle_time: 180,
              },
            ]),
          expectPanelOpen: true,
          expectContentState: "reviewer-inline",
        },
        {
          label: "comparison + Space",
          key: " ",
          options: {
            filters: { repos: [], teams: [], reviewers: [], authors: [] },
            repositoriesDimension: BASE_REPOS,
            webContext: BASE_WEB_CTX,
          },
          rollup: () =>
            makeRollupWithPrs([
              {
                id: 9004,
                title: "kbd-cmp",
                author_id: "alice",
                repository_id: "repo-1",
                cycle_time: 240,
              },
            ]),
          comparisonActive: true,
          expectPanelOpen: false,
        },
        {
          label: "supported-empty + Enter",
          key: "Enter",
          options: {
            filters: { repos: [], teams: [], reviewers: [], authors: [] },
            repositoriesDimension: BASE_REPOS,
            webContext: BASE_WEB_CTX,
          },
          rollup: () => makeRollupWithPrs([], { pr_count: 0 }),
          expectPanelOpen: true,
          expectContentState: "supported-empty",
        },
      ];

      for (const sub of subs) {
        // Reset per sub-case.
        if (isDetailPanelOpen()) dismissDetailPanel("explicit-close-button");
        publishComparisonToggled({ enabled: false });
        __resetComparisonAdvisoryForTests();
        document.body.innerHTML = "";

        const rollups = [sub.rollup()];
        const container = mountChart(rollups);
        const handle = installThroughputDrilldown(
          container,
          rollups,
          sub.options,
        );
        if (sub.comparisonActive) {
          publishComparisonToggled({ enabled: true });
        }

        const bar = firstBar(container);
        const event = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: sub.key,
        });
        bar.dispatchEvent(event);

        expect(isDetailPanelOpen()).toBe(sub.expectPanelOpen);
        if (sub.expectPanelOpen && sub.expectContentState) {
          const prSection = document.getElementById("pr-detail");
          expect(prSection).not.toBeNull();
          expect(prSection!.getAttribute("data-content-state")).toBe(
            sub.expectContentState,
          );
        } else {
          expect(document.getElementById("pr-detail")).toBeNull();
        }

        handle.dispose();
      }
    });

    // T043 (feature 060 Phase 6)
    it("supported filter yielding zero matches → contentState='supported-empty' with copy DISTINCT from team/reviewer messages", () => {
      // Simulate the post-applyFiltersToRollups state: an author filter has
      // matched zero PRs upstream, so rollup.prs arrives empty. The PR-
      // detail section MUST flip to supported-empty — distinct from team/
      // reviewer inline copy — so the user reads "zero matches" rather
      // than "dimension unsupported."
      const rollups = [makeRollupWithPrs([], { pr_count: 0 })];
      const container = mountChart(rollups);
      installThroughputDrilldown(container, rollups, {
        filters: { repos: [], teams: [], reviewers: [], authors: ["ghost"] },
        repositoriesDimension: BASE_REPOS,
        webContext: BASE_WEB_CTX,
      });

      click(firstBar(container));

      expect(isDetailPanelOpen()).toBe(true);
      const prSection = document.getElementById("pr-detail");
      expect(prSection).not.toBeNull();
      expect(prSection!.getAttribute("data-content-state")).toBe(
        "supported-empty",
      );
      const emptyMsg = prSection!.querySelector(".detail-panel-empty-detail");
      expect(emptyMsg).not.toBeNull();
      const emptyText = emptyMsg!.textContent ?? "";
      // FR-009 / FR-018: copy is distinct from unsupported-filter wording.
      expect(emptyText).toMatch(/match/i);
      expect(emptyText).not.toMatch(/clear the team/i);
      expect(emptyText).not.toMatch(/clear the reviewer/i);
    });
  });
});
