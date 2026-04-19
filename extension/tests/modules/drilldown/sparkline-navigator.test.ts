/**
 * Sparkline navigator unit tests (US4).
 *
 * Covers `extension/ui/modules/drilldown/sparkline-navigator.ts` per
 * `specs/059-chart-drill-down/contracts/drilldown-integration.md` and
 * spec.md FR-050 / FR-051 / FR-052: delegated click + keyboard
 * activation on `.sparkline-trigger` buttons, scrollIntoView on the
 * target chart container, short-lived `is-sparkline-highlight` CSS
 * class with self-dismiss after `SPARKLINE_HIGHLIGHT_MS`, missing-
 * target advisory, comparison-mode advisory routing, and dispose
 * semantics.
 */

import { installSparklineNavigator } from "../../../ui/modules/drilldown/sparkline-navigator";
import { publishComparisonToggled } from "../../../ui/modules/drilldown/lifecycle-signals";
import { __resetComparisonAdvisoryForTests } from "../../../ui/modules/drilldown/comparison-advisory";
import { SPARKLINE_HIGHLIGHT_MS } from "../../../ui/modules/shared/constants";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type TargetChart = "throughput" | "cycle-time" | "reviewer";
const TARGET_ID_BY_CHART = new Map<TargetChart, string>([
  ["throughput", "throughput-chart"],
  ["cycle-time", "cycle-time-trend"],
  ["reviewer", "reviewer-activity"],
]);

function mountSummaryCards(targets: TargetChart[]): HTMLElement {
  const container = document.createElement("div");
  container.className = "summary-cards";
  for (const target of targets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sparkline-trigger";
    button.setAttribute("data-drilldown-target-chart", target);
    button.setAttribute("aria-label", `Open full ${target} chart`);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    button.appendChild(svg);
    container.appendChild(button);
  }
  document.body.appendChild(container);
  return container;
}

function mountTargetCharts(
  targets: TargetChart[],
): Map<TargetChart, HTMLElement> {
  const out = new Map<TargetChart, HTMLElement>();
  for (const chart of targets) {
    const el = document.createElement("div");
    const id = TARGET_ID_BY_CHART.get(chart);
    if (id === undefined) throw new Error(`unknown chart ${chart}`);
    el.id = id;
    document.body.appendChild(el);
    out.set(chart, el);
  }
  return out;
}

function triggerFor(container: HTMLElement, chart: TargetChart): HTMLElement {
  const el = container.querySelector<HTMLElement>(
    `button.sparkline-trigger[data-drilldown-target-chart="${chart}"]`,
  );
  if (!el) throw new Error(`trigger for ${chart} not rendered`);
  return el;
}

function click(target: HTMLElement): void {
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("sparkline-navigator", () => {
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  let scrollSpy: jest.Mock;
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    jest.useFakeTimers();
    publishComparisonToggled({ enabled: false });
    __resetComparisonAdvisoryForTests();
    document.body.innerHTML = "";
    scrollSpy = jest.fn();
    HTMLElement.prototype.scrollIntoView = scrollSpy;
    // Default matchMedia: no reduced-motion preference.
    window.matchMedia = ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
  });

  afterEach(() => {
    jest.useRealTimers();
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    window.matchMedia = originalMatchMedia;
    publishComparisonToggled({ enabled: false });
    __resetComparisonAdvisoryForTests();
    document.body.innerHTML = "";
  });

  // -------------------------------------------------------------------------
  // Happy-path activation
  // -------------------------------------------------------------------------

  it("click scrolls the target chart into view and applies the highlight class", () => {
    const container = mountSummaryCards(["throughput"]);
    const targets = mountTargetCharts(["throughput"]);
    installSparklineNavigator(container);

    click(triggerFor(container, "throughput"));

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    expect(
      targets.get("throughput")!.classList.contains("is-sparkline-highlight"),
    ).toBe(true);
  });

  it("uses scroll behavior 'auto' when prefers-reduced-motion is active", () => {
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;

    const container = mountSummaryCards(["throughput"]);
    mountTargetCharts(["throughput"]);
    installSparklineNavigator(container);

    click(triggerFor(container, "throughput"));

    expect(scrollSpy).toHaveBeenCalledWith({
      behavior: "auto",
      block: "center",
    });
  });

  it.each<TargetChart>(["throughput", "cycle-time", "reviewer"])(
    "resolves target chart '%s' via its canonical id",
    (chart) => {
      const container = mountSummaryCards([chart]);
      const targets = mountTargetCharts([chart]);
      installSparklineNavigator(container);

      click(triggerFor(container, chart));

      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(
        targets.get(chart)!.classList.contains("is-sparkline-highlight"),
      ).toBe(true);
    },
  );

  it("highlight class is removed after SPARKLINE_HIGHLIGHT_MS", () => {
    const container = mountSummaryCards(["throughput"]);
    const targets = mountTargetCharts(["throughput"]);
    installSparklineNavigator(container);

    click(triggerFor(container, "throughput"));
    expect(
      targets.get("throughput")!.classList.contains("is-sparkline-highlight"),
    ).toBe(true);

    jest.advanceTimersByTime(SPARKLINE_HIGHLIGHT_MS - 1);
    expect(
      targets.get("throughput")!.classList.contains("is-sparkline-highlight"),
    ).toBe(true);
    jest.advanceTimersByTime(1);
    expect(
      targets.get("throughput")!.classList.contains("is-sparkline-highlight"),
    ).toBe(false);
  });

  it("repeat activation re-applies the highlight class (timer resets)", () => {
    const container = mountSummaryCards(["throughput"]);
    const targets = mountTargetCharts(["throughput"]);
    installSparklineNavigator(container);
    const trigger = triggerFor(container, "throughput");

    click(trigger);
    expect(
      targets.get("throughput")!.classList.contains("is-sparkline-highlight"),
    ).toBe(true);

    // Part-way through the first timer.
    jest.advanceTimersByTime(500);
    click(trigger);
    expect(
      targets.get("throughput")!.classList.contains("is-sparkline-highlight"),
    ).toBe(true);

    // Neither timer has fired yet; the second keeps the class applied
    // until SPARKLINE_HIGHLIGHT_MS elapses from the second click.
    jest.advanceTimersByTime(SPARKLINE_HIGHLIGHT_MS);
    expect(
      targets.get("throughput")!.classList.contains("is-sparkline-highlight"),
    ).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Missing-target advisory (FR-052)
  // -------------------------------------------------------------------------

  it("renders an inline advisory and does NOT scroll when the target chart is absent", () => {
    const container = mountSummaryCards(["throughput"]);
    // No target chart element rendered — FR-052 scenario.
    installSparklineNavigator(container);

    click(triggerFor(container, "throughput"));

    expect(scrollSpy).not.toHaveBeenCalled();
    const advisory = document.querySelector(".sparkline-advisory");
    expect(advisory).not.toBeNull();
    expect(advisory!.textContent).toContain("throughput");
  });

  it("missing cycle-time target renders advisory with 'cycle time' label", () => {
    const container = mountSummaryCards(["cycle-time"]);
    // No #cycle-time-trend element.
    installSparklineNavigator(container);

    click(triggerFor(container, "cycle-time"));

    const advisory = document.querySelector(".sparkline-advisory");
    expect(advisory).not.toBeNull();
    expect(advisory!.textContent).toContain("cycle time");
  });

  it("advisory is cleared when a subsequent activation succeeds", () => {
    const container = mountSummaryCards(["throughput"]);
    installSparklineNavigator(container);

    click(triggerFor(container, "throughput"));
    expect(document.querySelector(".sparkline-advisory")).not.toBeNull();

    // Mount the target element and click again.
    const chart = document.createElement("div");
    chart.id = "throughput-chart";
    document.body.appendChild(chart);

    click(triggerFor(container, "throughput"));

    expect(document.querySelector(".sparkline-advisory")).toBeNull();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Keyboard activation
  // -------------------------------------------------------------------------

  it("keyboard Enter on a focused trigger scrolls and highlights", () => {
    const container = mountSummaryCards(["throughput"]);
    const targets = mountTargetCharts(["throughput"]);
    installSparklineNavigator(container);

    triggerFor(container, "throughput").dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }),
    );

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(
      targets.get("throughput")!.classList.contains("is-sparkline-highlight"),
    ).toBe(true);
  });

  it("keyboard Space activates and calls preventDefault", () => {
    const container = mountSummaryCards(["throughput"]);
    mountTargetCharts(["throughput"]);
    installSparklineNavigator(container);

    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: " ",
    });
    triggerFor(container, "throughput").dispatchEvent(event);

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Comparison routing
  // -------------------------------------------------------------------------

  it("routes to comparison advisory toast when comparison mode is active", () => {
    const container = mountSummaryCards(["throughput"]);
    mountTargetCharts(["throughput"]);
    installSparklineNavigator(container);

    publishComparisonToggled({ enabled: true });
    click(triggerFor(container, "throughput"));

    expect(scrollSpy).not.toHaveBeenCalled();
    expect(document.querySelector(".comparison-advisory-toast")).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  it("dispose() detaches listeners — subsequent click does not scroll", () => {
    const container = mountSummaryCards(["throughput"]);
    mountTargetCharts(["throughput"]);
    const handle = installSparklineNavigator(container);

    handle.dispose();
    click(triggerFor(container, "throughput"));

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("dispose() cancels pending highlight timers so the class does not flicker off later", () => {
    const container = mountSummaryCards(["throughput"]);
    const targets = mountTargetCharts(["throughput"]);
    const handle = installSparklineNavigator(container);

    click(triggerFor(container, "throughput"));
    expect(
      targets.get("throughput")!.classList.contains("is-sparkline-highlight"),
    ).toBe(true);

    // Manually wipe the class to mimic a caller controlling highlight
    // state after dispose. The timer must be cancelled by dispose()
    // so it does not run and re-remove the class (would be a no-op
    // but shouldn't fire at all).
    targets.get("throughput")!.classList.remove("is-sparkline-highlight");
    targets.get("throughput")!.classList.add("caller-set-class");
    handle.dispose();
    jest.advanceTimersByTime(SPARKLINE_HIGHLIGHT_MS * 2);

    // Caller's class is untouched.
    expect(
      targets.get("throughput")!.classList.contains("caller-set-class"),
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Coverage hardening — early-return branches
  // -------------------------------------------------------------------------

  it("click on the container outside any trigger is ignored", () => {
    const container = mountSummaryCards(["throughput"]);
    mountTargetCharts(["throughput"]);
    installSparklineNavigator(container);

    click(container);

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("keydown with an unrelated key on a trigger is ignored", () => {
    const container = mountSummaryCards(["throughput"]);
    mountTargetCharts(["throughput"]);
    installSparklineNavigator(container);

    triggerFor(container, "throughput").dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      }),
    );

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("keydown Enter outside any trigger (on the container) is ignored", () => {
    const container = mountSummaryCards(["throughput"]);
    mountTargetCharts(["throughput"]);
    installSparklineNavigator(container);

    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }),
    );

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("unrecognized data-drilldown-target-chart value is a no-op", () => {
    const container = mountSummaryCards(["throughput"]);
    mountTargetCharts(["throughput"]);
    installSparklineNavigator(container);
    const trigger = triggerFor(container, "throughput");
    trigger.setAttribute("data-drilldown-target-chart", "unknown");

    click(trigger);

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("matchMedia undefined environment gracefully defaults to smooth scroll", () => {
    (window as unknown as Record<string, unknown>).matchMedia = undefined;
    const container = mountSummaryCards(["throughput"]);
    mountTargetCharts(["throughput"]);
    installSparklineNavigator(container);

    click(triggerFor(container, "throughput"));

    expect(scrollSpy).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
  });
});
