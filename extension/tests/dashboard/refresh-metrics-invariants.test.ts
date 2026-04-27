/**
 * refreshMetrics structural invariants — drill-down handle dispose ordering.
 *
 * Source-parses dashboard.ts to lock the dispose-loop position relative to
 * the stale-cycle guards introduced in PR #302's P1.A finding.
 *
 * Why structural and not behavioral: refreshMetrics is module-private to
 * dashboard.ts (which runs side-effects at import time and cannot be
 * imported into a Jest test). The lifecycle-signals publisher-exclusivity
 * test in the same repo already establishes the source-parse invariant
 * pattern; this file follows it for the dispose-ordering invariant.
 */

import * as _fsOriginal from "fs";
function _loadFs(): typeof _fsOriginal {
  return _fsOriginal;
}
const _fs = _loadFs();
import { resolve } from "path";

const dashboardSrcPath = resolve(__dirname, "../../ui/dashboard.ts");
const dashboardSrc = _fs.readFileSync(dashboardSrcPath, "utf-8");

const STALE_GUARD = "if (cycleId > 0 && isStale(cycleId)) {";
const DISPOSE_LOOP =
  "for (const handle of activeDrilldownHandles) handle.dispose();";
const HANDLE_RESET = "activeDrilldownHandles = [];";
const HANDLE_PUSH = "activeDrilldownHandles.push(";
const RENDER_BLOCK_START = "renderSummaryCards(";

describe("refresh-metrics-invariants — dispose ordering vs stale guards", () => {
  it("dispose loop sits between the second isStale guard and the render block", () => {
    const stale1Idx = dashboardSrc.indexOf(STALE_GUARD);
    expect(stale1Idx).toBeGreaterThan(-1);

    const stale2Idx = dashboardSrc.indexOf(STALE_GUARD, stale1Idx + 1);
    expect(stale2Idx).toBeGreaterThan(stale1Idx);

    const disposeIdx = dashboardSrc.indexOf(DISPOSE_LOOP);
    expect(disposeIdx).toBeGreaterThan(-1);

    const renderIdx = dashboardSrc.indexOf(RENDER_BLOCK_START);
    expect(renderIdx).toBeGreaterThan(-1);

    expect(disposeIdx).toBeGreaterThan(stale2Idx);
    expect(disposeIdx).toBeLessThan(renderIdx);
  });

  it("dispose loop is NOT between publishFiltersChanged and the first await loader", () => {
    const publishIdx = dashboardSrc.indexOf("publishFiltersChanged({");
    expect(publishIdx).toBeGreaterThan(-1);

    const firstAwaitIdx = dashboardSrc.indexOf(
      "await loader.getWeeklyRollups(",
    );
    expect(firstAwaitIdx).toBeGreaterThan(publishIdx);

    const disposeIdx = dashboardSrc.indexOf(DISPOSE_LOOP);
    const disposeBetween =
      disposeIdx > publishIdx && disposeIdx < firstAwaitIdx;
    expect(disposeBetween).toBe(false);
  });
});

describe("refresh-metrics-invariants — handle array reset/push integrity", () => {
  it("handle array is reset exactly once per refresh and re-installs five chart surfaces", () => {
    // Five surfaces install drill-down handles per refresh:
    //   1. throughput chart (Feature 060)
    //   2. comments-trend chart (Feature 333 — added at T022; reuses
    //      installThroughputDrilldown since both surfaces share the
    //      `data-drilldown-week` convention)
    //   3. cycle-time trend chart
    //   4. reviewer-activity chart
    //   5. summary cards (sparkline navigator)
    const resetMatches =
      dashboardSrc.match(/activeDrilldownHandles = \[\];/g) ?? [];
    expect(resetMatches).toHaveLength(1);

    const pushMatches =
      dashboardSrc.match(/activeDrilldownHandles\.push\(/g) ?? [];
    expect(pushMatches).toHaveLength(5);
  });

  it("handle reset sits adjacent to the dispose loop (no intervening installs)", () => {
    const disposeIdx = dashboardSrc.indexOf(DISPOSE_LOOP);
    const resetIdx = dashboardSrc.indexOf(HANDLE_RESET);
    const firstPushIdx = dashboardSrc.indexOf(HANDLE_PUSH);

    expect(disposeIdx).toBeGreaterThan(-1);
    expect(resetIdx).toBeGreaterThan(disposeIdx);
    expect(firstPushIdx).toBeGreaterThan(resetIdx);

    const between = dashboardSrc.slice(disposeIdx, resetIdx);
    expect(between).not.toContain(HANDLE_PUSH);
  });
});

describe("refresh-metrics-invariants — chart-container inert during load window", () => {
  it("setChartContainersInert(true) follows publishFiltersChanged synchronously", () => {
    const publishIdx = dashboardSrc.indexOf("publishFiltersChanged({");
    expect(publishIdx).toBeGreaterThan(-1);

    const inertTrueIdx = dashboardSrc.indexOf("setChartContainersInert(true)");
    expect(inertTrueIdx).toBeGreaterThan(publishIdx);

    // Must run synchronously before the first await so stale triggers are
    // inert by the time any user interaction can happen during the load
    // window.
    const firstAwaitIdx = dashboardSrc.indexOf(
      "await loader.getWeeklyRollups(",
    );
    expect(inertTrueIdx).toBeLessThan(firstAwaitIdx);
  });

  it("setChartContainersInert(false) is in a finally clause", () => {
    const inertFalseMatches =
      dashboardSrc.match(/setChartContainersInert\(false\)/g) ?? [];
    expect(inertFalseMatches).toHaveLength(1);

    // The clear must live inside a finally block so the winning cycle's
    // success and failure paths both reach it.
    const finallyIdx = dashboardSrc.indexOf("} finally {");
    expect(finallyIdx).toBeGreaterThan(-1);

    const inertFalseIdx = dashboardSrc.indexOf(
      "setChartContainersInert(false)",
    );
    expect(inertFalseIdx).toBeGreaterThan(finallyIdx);
  });

  it("finally clears inert ONLY for the winning cycle (stale-bail must skip)", () => {
    // A stale-bail return enters finally too, but a newer cycle may still
    // be mid-load with inert=true. Clearing inert in the stale-bail
    // finally would re-enable chart interactions on stale DOM until the
    // winning cycle finishes — exactly the race Codex flagged. Gate the
    // clear behind `!isStale(cycleId)` (or `cycleId === 0` if loading
    // state is inactive).
    const finallyIdx = dashboardSrc.indexOf("} finally {");
    expect(finallyIdx).toBeGreaterThan(-1);

    const finallyBody = dashboardSrc.slice(finallyIdx, finallyIdx + 1000);

    // The gate guard pattern — accept either the precise expression we
    // wrote or any future equivalent that includes both isStale and
    // cycleId references inside the finally block.
    expect(finallyBody).toMatch(
      /(cycleId\s*===\s*0\s*\|\|\s*!isStale\(cycleId\))|(!isStale\(cycleId\)\s*\|\|\s*cycleId\s*===\s*0)/,
    );
    expect(finallyBody).toContain("setChartContainersInert(false)");
  });

  it("setChartContainersInert helper toggles all four drill-down host containers", () => {
    const helperStart = dashboardSrc.indexOf(
      "function setChartContainersInert(",
    );
    expect(helperStart).toBeGreaterThan(-1);

    const helperBody = dashboardSrc.slice(helperStart, helperStart + 2000);
    expect(helperBody).toContain('"throughput-chart"');
    expect(helperBody).toContain('"cycle-time-trend"');
    expect(helperBody).toContain('"reviewer-activity"');
    expect(helperBody).toContain('".summary-cards"');
  });
});
