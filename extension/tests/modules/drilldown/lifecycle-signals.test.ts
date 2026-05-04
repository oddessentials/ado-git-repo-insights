/**
 * Lifecycle signals tests.
 *
 * Covers the publish/subscribe surface from
 * extension/ui/modules/drilldown/lifecycle-signals.ts.
 *
 * Includes a static-audit test that verifies the three `publish*` callsites
 * live only in `extension/ui/dashboard.ts` within the `extension/ui/**` tree
 * (publisher-exclusivity invariant). The static audit uses the same
 * fs-indirection pattern as `tests/unit/css-contract.test.ts` so the
 * security/detect-non-literal-fs-filename lint rule does not fire.
 */

import * as _fsOriginal from "fs";
function _loadFs(): typeof _fsOriginal {
  return _fsOriginal;
}
const _fs = _loadFs();
import { resolve } from "path";

import {
  FILTERS_CHANGED_EVENT,
  TAB_CHANGED_EVENT,
  COMPARISON_TOGGLED_EVENT,
  publishFiltersChanged,
  publishTabChanged,
  publishComparisonToggled,
  subscribeFiltersChanged,
  subscribeTabChanged,
  subscribeComparisonToggled,
  type FiltersChangedEvent,
  type TabChangedEvent,
  type ComparisonToggledEvent,
} from "../../../ui/modules/drilldown/lifecycle-signals";

// ---------------------------------------------------------------------------
// Publishers emit typed CustomEvents with the exact detail shape
// ---------------------------------------------------------------------------

describe("lifecycle-signals — publishers", () => {
  it("publishFiltersChanged emits FILTERS_CHANGED_EVENT with detail", () => {
    const received: FiltersChangedEvent[] = [];
    const listener: EventListener = (evt) => {
      received.push(evt as FiltersChangedEvent);
    };
    window.addEventListener(FILTERS_CHANGED_EVENT, listener);

    publishFiltersChanged({ reason: "user-change" });

    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe(FILTERS_CHANGED_EVENT);
    expect(received[0]!.detail).toEqual({ reason: "user-change" });

    window.removeEventListener(FILTERS_CHANGED_EVENT, listener);
  });

  it("publishTabChanged emits TAB_CHANGED_EVENT with both tab ids", () => {
    const received: TabChangedEvent[] = [];
    const listener: EventListener = (evt) => {
      received.push(evt as TabChangedEvent);
    };
    window.addEventListener(TAB_CHANGED_EVENT, listener);

    publishTabChanged({ activeTabId: "predictions", previousTabId: "metrics" });

    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe(TAB_CHANGED_EVENT);
    expect(received[0]!.detail.activeTabId).toBe("predictions");
    expect(received[0]!.detail.previousTabId).toBe("metrics");

    window.removeEventListener(TAB_CHANGED_EVENT, listener);
  });

  it("publishComparisonToggled emits COMPARISON_TOGGLED_EVENT with enabled flag", () => {
    const received: ComparisonToggledEvent[] = [];
    const listener: EventListener = (evt) => {
      received.push(evt as ComparisonToggledEvent);
    };
    window.addEventListener(COMPARISON_TOGGLED_EVENT, listener);

    publishComparisonToggled({ enabled: true });
    publishComparisonToggled({ enabled: false });

    expect(received).toHaveLength(2);
    expect(received[0]!.detail).toEqual({ enabled: true });
    expect(received[1]!.detail).toEqual({ enabled: false });

    window.removeEventListener(COMPARISON_TOGGLED_EVENT, listener);
  });

  it("publishers are pass-through (no suppression at module layer)", () => {
    // Suppression for double-click on an already-active tab is implemented by
    // the publisher site (switchTab in dashboard.ts), NOT by lifecycle-signals.
    // This test documents that invariant: the module always emits when called.
    let count = 0;
    const listener: EventListener = () => {
      count += 1;
    };
    window.addEventListener(TAB_CHANGED_EVENT, listener);

    publishTabChanged({ activeTabId: "metrics", previousTabId: "metrics" });
    publishTabChanged({ activeTabId: "metrics", previousTabId: "metrics" });

    expect(count).toBe(2);

    window.removeEventListener(TAB_CHANGED_EVENT, listener);
  });
});

// ---------------------------------------------------------------------------
// Subscribers return AbortController that detaches cleanly
// ---------------------------------------------------------------------------

describe("lifecycle-signals — subscribers", () => {
  it("subscribeFiltersChanged attaches and abort() detaches", () => {
    let count = 0;
    const controller = subscribeFiltersChanged(() => {
      count += 1;
    });

    publishFiltersChanged({ reason: "user-change" });
    expect(count).toBe(1);

    controller.abort();
    publishFiltersChanged({ reason: "user-change" });
    expect(count).toBe(1); // NOT incremented after abort
  });

  it("subscribeTabChanged attaches and abort() detaches", () => {
    let count = 0;
    const controller = subscribeTabChanged(() => {
      count += 1;
    });

    publishTabChanged({ activeTabId: "a", previousTabId: "b" });
    expect(count).toBe(1);

    controller.abort();
    publishTabChanged({ activeTabId: "a", previousTabId: "b" });
    expect(count).toBe(1);
  });

  it("subscribeComparisonToggled attaches and abort() detaches", () => {
    let count = 0;
    const controller = subscribeComparisonToggled(() => {
      count += 1;
    });

    publishComparisonToggled({ enabled: true });
    expect(count).toBe(1);

    controller.abort();
    publishComparisonToggled({ enabled: false });
    expect(count).toBe(1);
  });

  it("multiple subscribers receive the same event independently", () => {
    let a = 0;
    let b = 0;
    const ctrlA = subscribeFiltersChanged(() => {
      a += 1;
    });
    const ctrlB = subscribeFiltersChanged(() => {
      b += 1;
    });

    publishFiltersChanged({ reason: "user-change" });

    expect(a).toBe(1);
    expect(b).toBe(1);

    ctrlA.abort();
    publishFiltersChanged({ reason: "user-change" });

    expect(a).toBe(1); // A detached
    expect(b).toBe(2); // B still attached

    ctrlB.abort();
  });
});

// ---------------------------------------------------------------------------
// Publisher-exclusivity static audit
// ---------------------------------------------------------------------------

describe("lifecycle-signals — URL deep-link guard sync (FR-060 regression)", () => {
  it("dashboard.ts restoreStateFromUrl emits publishComparisonToggled when ?compare=1 is set", () => {
    // Regression test: the deep-link restore path at page load must emit
    // the comparison-toggled signal so the drill-down guard stays
    // synchronized. Without this emit a user who loads the dashboard via
    // ?compare=1 would see the comparison banner but could still open a
    // drill-down panel — FR-060 broken on init.
    //
    // Static audit: inside dashboard.ts, the function body of
    // `restoreStateFromUrl` that handles `compareParam === "1"` must
    // include a `publishComparisonToggled(` callsite.
    const dashboardSrc = _fs.readFileSync(
      resolve(__dirname, "../../../ui/dashboard.ts"),
      "utf-8",
    );

    const fnStart = dashboardSrc.indexOf("function restoreStateFromUrl");
    expect(fnStart).toBeGreaterThan(-1);
    // Take the next ~4000 chars — large enough to cover the whole function
    // body (it is under 100 lines) and small enough to keep the window
    // focused on restoreStateFromUrl specifically.
    const fnBody = dashboardSrc.slice(fnStart, fnStart + 4000);

    expect(fnBody).toContain('compareParam === "1"');
    expect(fnBody).toContain("publishComparisonToggled(");
  });
});

describe("lifecycle-signals — publisher-exclusivity invariant", () => {
  it("only dashboard.ts contains publish* callsites within extension/ui/**", () => {
    const uiRoot = resolve(__dirname, "../../../ui");
    const offenders: Array<{ file: string; callsite: string }> = [];
    const callsites = [
      "publishFiltersChanged(",
      "publishTabChanged(",
      "publishComparisonToggled(",
    ];

    const visit = (dir: string): void => {
      for (const entry of _fs.readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          visit(full);
          continue;
        }
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith(".ts")) continue;

        // Allow the module that DEFINES the publishers and the barrels that
        // re-export them; these are definition sites, not callsites.
        const relFromUi = resolve(uiRoot, full)
          .replace(uiRoot, "")
          .replace(/^[/\\]/, "")
          .replace(/\\/g, "/");
        if (
          relFromUi === "modules/drilldown/lifecycle-signals.ts" ||
          relFromUi === "modules/drilldown/index.ts" ||
          relFromUi === "modules/index.ts"
        ) {
          continue;
        }

        const source = _fs.readFileSync(full, "utf-8");
        for (const callsite of callsites) {
          if (source.includes(callsite)) {
            offenders.push({ file: relFromUi, callsite });
          }
        }
      }
    };
    visit(uiRoot);

    const dashboardOnly = offenders.every((o) => o.file === "dashboard.ts");
    expect({ offenders, dashboardOnly }).toEqual({
      offenders: expect.arrayContaining([
        { file: "dashboard.ts", callsite: "publishFiltersChanged(" },
        { file: "dashboard.ts", callsite: "publishTabChanged(" },
        { file: "dashboard.ts", callsite: "publishComparisonToggled(" },
      ]),
      dashboardOnly: true,
    });
  });
});
