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
  it("handle array is reset exactly once per refresh and re-installs four chart surfaces", () => {
    const resetMatches =
      dashboardSrc.match(/activeDrilldownHandles = \[\];/g) ?? [];
    expect(resetMatches).toHaveLength(1);

    const pushMatches =
      dashboardSrc.match(/activeDrilldownHandles\.push\(/g) ?? [];
    expect(pushMatches).toHaveLength(4);
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
