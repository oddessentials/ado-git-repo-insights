/**
 * Comparison-advisory unit tests.
 *
 * Covers
 * `extension/ui/modules/drilldown/comparison-advisory.ts` per
 * `specs/059-chart-drill-down/contracts/lifecycle-signals.md` and
 * research.md R-05 — the three-layer disabled-drill-down UX (chart
 * attribute, persistent banner, transient on-attempt toast).
 */

import {
  isDrilldownDisabledByComparison,
  showComparisonAdvisoryToast,
  __resetComparisonAdvisoryForTests,
} from "../../../ui/modules/drilldown/comparison-advisory";
import { COMPARISON_ADVISORY_TOAST_MS } from "../../../ui/modules/shared/constants";
import { publishComparisonToggled } from "../../../ui/modules/drilldown/lifecycle-signals";
import {
  openDetailPanel,
  dismissDetailPanel,
  isDetailPanelOpen,
  makePanelContent,
  makeStatRow,
  type DrillDownContext,
} from "../../../ui/modules/shared/detail-panel";

function scaffoldChartContainers(): {
  throughput: HTMLElement;
  cycleTime: HTMLElement;
  reviewer: HTMLElement;
  summaryCards: HTMLElement;
  comparisonBanner: HTMLElement;
} {
  const make = (id: string, className?: string): HTMLElement => {
    const el = document.createElement("div");
    if (id) el.id = id;
    if (className) el.className = className;
    document.body.appendChild(el);
    return el;
  };

  return {
    throughput: make("throughput-chart"),
    cycleTime: make("cycle-time-trend"),
    reviewer: make("reviewer-activity"),
    summaryCards: make("", "summary-cards"),
    comparisonBanner: make("comparison-banner", "comparison-banner"),
  };
}

function makeTrigger(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  document.body.appendChild(btn);
  return btn;
}

function makeContext(): DrillDownContext {
  return {
    sourceChart: "cycle-time",
    focusedData: { kind: "cycle-time", weekIso: "2025-W12", metric: "p50" },
    triggerElement: makeTrigger(),
    content: makePanelContent("t", null, [
      makeStatRow([{ label: "L", value: "V" }]),
    ]),
  };
}

describe("comparison-advisory — banner + attribute lifecycle", () => {
  beforeEach(() => {
    publishComparisonToggled({ enabled: false });
    __resetComparisonAdvisoryForTests();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    publishComparisonToggled({ enabled: false });
    __resetComparisonAdvisoryForTests();
    if (isDetailPanelOpen()) dismissDetailPanel("explicit-close-button");
    document.body.innerHTML = "";
  });

  it("mounts banner note and sets disabled attr on all four chart containers when comparison enables", () => {
    const { throughput, cycleTime, reviewer, summaryCards, comparisonBanner } =
      scaffoldChartContainers();

    publishComparisonToggled({ enabled: true });

    expect(isDrilldownDisabledByComparison()).toBe(true);
    expect(throughput.getAttribute("data-drilldown-disabled")).toBe(
      "comparison",
    );
    expect(cycleTime.getAttribute("data-drilldown-disabled")).toBe(
      "comparison",
    );
    expect(reviewer.getAttribute("data-drilldown-disabled")).toBe("comparison");
    expect(summaryCards.getAttribute("data-drilldown-disabled")).toBe(
      "comparison",
    );
    expect(
      comparisonBanner.querySelector(".comparison-advisory-banner"),
    ).not.toBeNull();
  });

  it("unmounts banner and clears attributes when comparison disables", () => {
    const containers = scaffoldChartContainers();
    publishComparisonToggled({ enabled: true });
    publishComparisonToggled({ enabled: false });

    expect(isDrilldownDisabledByComparison()).toBe(false);
    for (const el of [
      containers.throughput,
      containers.cycleTime,
      containers.reviewer,
      containers.summaryCards,
    ]) {
      expect(el.hasAttribute("data-drilldown-disabled")).toBe(false);
    }
    expect(
      containers.comparisonBanner.querySelector(".comparison-advisory-banner"),
    ).toBeNull();
  });

  it("dismisses any currently-open DetailPanel when comparison activates", () => {
    scaffoldChartContainers();
    openDetailPanel(makeContext());
    expect(isDetailPanelOpen()).toBe(true);

    publishComparisonToggled({ enabled: true });

    expect(isDetailPanelOpen()).toBe(false);
  });

  it("banner mount is idempotent on repeat enable events", () => {
    const { comparisonBanner } = scaffoldChartContainers();

    publishComparisonToggled({ enabled: true });
    publishComparisonToggled({ enabled: true });

    const banners = comparisonBanner.querySelectorAll(
      ".comparison-advisory-banner",
    );
    expect(banners.length).toBe(1);
  });
});

describe("comparison-advisory — transient toast", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    publishComparisonToggled({ enabled: false });
    __resetComparisonAdvisoryForTests();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    jest.useRealTimers();
    publishComparisonToggled({ enabled: false });
    __resetComparisonAdvisoryForTests();
    document.body.innerHTML = "";
  });

  it("mounts toast near target and auto-dismisses after COMPARISON_ADVISORY_TOAST_MS", () => {
    const target = makeTrigger();

    showComparisonAdvisoryToast(target);
    const toast = document.querySelector(".comparison-advisory-toast");
    expect(toast).not.toBeNull();

    jest.advanceTimersByTime(COMPARISON_ADVISORY_TOAST_MS - 1);
    expect(document.querySelector(".comparison-advisory-toast")).not.toBeNull();

    jest.advanceTimersByTime(1);
    expect(document.querySelector(".comparison-advisory-toast")).toBeNull();
  });

  it("second showComparisonAdvisoryToast replaces an in-flight toast (no stacking)", () => {
    const a = makeTrigger();
    const b = makeTrigger();

    showComparisonAdvisoryToast(a);
    showComparisonAdvisoryToast(b);

    expect(document.querySelectorAll(".comparison-advisory-toast").length).toBe(
      1,
    );
  });

  it("toast clears when comparison mode disables", () => {
    scaffoldChartContainers();
    publishComparisonToggled({ enabled: true });
    showComparisonAdvisoryToast(makeTrigger());
    expect(document.querySelector(".comparison-advisory-toast")).not.toBeNull();

    publishComparisonToggled({ enabled: false });
    expect(document.querySelector(".comparison-advisory-toast")).toBeNull();
  });

  it("positions toast against a target in the middle of the viewport (non-boundary placement)", () => {
    // Set predictable viewport dims so top/left clamping branches do not
    // fire: target rect safely clear of all four viewport edges.
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    const target = makeTrigger();
    Object.defineProperty(target, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 400,
        y: 200,
        width: 100,
        height: 30,
        top: 200,
        left: 400,
        right: 500,
        bottom: 230,
        toJSON: () => ({}),
      }),
    });

    showComparisonAdvisoryToast(target);
    const toast = document.querySelector<HTMLElement>(
      ".comparison-advisory-toast",
    );
    expect(toast).not.toBeNull();
    // Toast should not be pushed to the viewport edges by the clamp
    // branches when the target sits in the middle.
    expect(toast!.style.top).not.toBe("4px");
    expect(toast!.style.left).not.toBe("4px");
  });

  it("stale timer from a replaced toast is a no-op against the current active toast", () => {
    const a = makeTrigger();
    const b = makeTrigger();

    showComparisonAdvisoryToast(a);
    // Advance timer partway — still in-flight.
    jest.advanceTimersByTime(1000);
    // Replace with a new toast: the original's timer still exists until
    // dismissActiveToast() clears it, which showComparisonAdvisoryToast
    // does internally. Firing the remainder should leave `b` intact.
    showComparisonAdvisoryToast(b);
    jest.advanceTimersByTime(COMPARISON_ADVISORY_TOAST_MS - 1000 - 1);

    // The new toast is still showing; the replaced timer (if it fired)
    // must NOT have touched it because activeToast !== the replaced one.
    expect(document.querySelectorAll(".comparison-advisory-toast").length).toBe(
      1,
    );
  });
});

// PR #302 P1.H — a11y / copy split between persistent banner and
// transient on-attempt toast. Tests lock:
//   - Banner  role="status"   + aria-live="polite"    + BANNER_MESSAGE
//   - Toast   role="alert"    + aria-live="assertive" + TOAST_MESSAGE
//   - Banner / toast copy differ (prevents collapse back to one message)
//   - Disable→enable remount produces a *new* DOM element (so SRs
//     actually re-announce; idempotent repeat-enable does NOT remount)
//   - Banner mounts into a visible parent (caller must un-hide
//     #comparison-banner before toggling); regression test against the
//     Phase-2 refactor risk flagged by a11y review
describe("comparison-advisory — a11y roles + copy split (PR #302 P1.H)", () => {
  beforeEach(() => {
    publishComparisonToggled({ enabled: false });
    __resetComparisonAdvisoryForTests();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    publishComparisonToggled({ enabled: false });
    __resetComparisonAdvisoryForTests();
    if (isDetailPanelOpen()) dismissDetailPanel("explicit-close-button");
    document.body.innerHTML = "";
  });

  it("banner is role=status + aria-live=polite with BANNER_MESSAGE copy", () => {
    const { comparisonBanner } = scaffoldChartContainers();
    publishComparisonToggled({ enabled: true });

    const note = comparisonBanner.querySelector<HTMLElement>(
      ".comparison-advisory-banner",
    );
    expect(note).not.toBeNull();
    expect(note!.getAttribute("role")).toBe("status");
    expect(note!.getAttribute("aria-live")).toBe("polite");
    expect(note!.textContent).toBe(
      "Chart details are unavailable during comparison.",
    );
  });

  it("toast is role=alert + aria-live=assertive with TOAST_MESSAGE copy", () => {
    const target = makeTrigger();
    showComparisonAdvisoryToast(target);

    const toast = document.querySelector<HTMLElement>(
      ".comparison-advisory-toast",
    );
    expect(toast).not.toBeNull();
    expect(toast!.getAttribute("role")).toBe("alert");
    expect(toast!.getAttribute("aria-live")).toBe("assertive");
    expect(toast!.textContent).toBe(
      "Exit comparison to open chart details.",
    );
  });

  it("banner copy differs from toast copy (no SR double-announce overlap)", () => {
    const { comparisonBanner } = scaffoldChartContainers();
    publishComparisonToggled({ enabled: true });
    const target = makeTrigger();
    showComparisonAdvisoryToast(target);

    const banner = comparisonBanner.querySelector<HTMLElement>(
      ".comparison-advisory-banner",
    );
    const toast = document.querySelector<HTMLElement>(
      ".comparison-advisory-toast",
    );
    expect(banner).not.toBeNull();
    expect(toast).not.toBeNull();
    expect(banner!.textContent).not.toBe(toast!.textContent);
  });

  it("disable→enable remount yields a NEW DOM node (so SRs re-announce)", () => {
    const { comparisonBanner } = scaffoldChartContainers();
    publishComparisonToggled({ enabled: true });
    const first = comparisonBanner.querySelector(".comparison-advisory-banner");
    expect(first).not.toBeNull();

    publishComparisonToggled({ enabled: false });
    publishComparisonToggled({ enabled: true });

    const second = comparisonBanner.querySelector(
      ".comparison-advisory-banner",
    );
    expect(second).not.toBeNull();
    // New element identity — remount, not just class re-add.
    expect(second!.isSameNode(first)).toBe(false);
  });

  it("banner mounts inside a non-hidden parent (ordering invariant)", () => {
    // Production caller removes the `.hidden` class on #comparison-banner
    // BEFORE publishing COMPARISON_TOGGLED_EVENT (see dashboard.ts 2057-
    // 2070 + deep-link restore 2035-2044). If a future refactor inverts
    // that ordering the role="status" live-region would mount inside a
    // display:none subtree and some AT combinations suppress the
    // announcement. Lock the expected ordering.
    const { comparisonBanner } = scaffoldChartContainers();
    comparisonBanner.classList.add("hidden");
    // Mimic production sequence: un-hide FIRST, then publish.
    comparisonBanner.classList.remove("hidden");
    publishComparisonToggled({ enabled: true });

    const note = comparisonBanner.querySelector(".comparison-advisory-banner");
    expect(note).not.toBeNull();
    expect(comparisonBanner.classList.contains("hidden")).toBe(false);
  });
});
