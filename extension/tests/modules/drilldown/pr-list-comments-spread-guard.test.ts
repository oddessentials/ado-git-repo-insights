/**
 * Feature 310 spread guard: the three comments-metrics field names and
 * the capability gate MUST NOT appear in any drill-down module other
 * than ``throughput-drilldown.ts``.
 *
 * Locks the scope of the Feature-310 rendering to the throughput
 * surface (user constraint) and prevents an accidental follow-on
 * feature from adding the columns to ``cycle-time-drilldown.ts`` or
 * ``reviewer-drilldown.ts`` without going through a capability-gate
 * review and an SC-03-equivalent baseline.  Fails CI if any module
 * outside the allowlist references the tripleted field names or
 * constructs a ``PrListSection`` with ``commentsMetricsAvailable:
 * true``.
 *
 * @module tests/modules/drilldown/pr-list-comments-spread-guard.test.ts
 */

import * as path from "node:path";

import { readDirEntries, readTextFile } from "../../helpers/fs-test-utils";

const DRILLDOWN_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "ui",
  "modules",
  "drilldown",
);

const ALLOWED_MODULES: ReadonlySet<string> = new Set([
  // Only the throughput drill-down owns the comments-metrics surface
  // (user constraint; tasks.md Phase 3 Note "INV-08 forces atomic
  // emission — the entire Capability-3/4 surface is the throughput
  // panel").
  "throughput-drilldown.ts",
  // Feature 361 (FR-015 + contract § 4): cycle-time drill-down's PR
  // list MUST display the same per-row thread / comment / unresolved
  // counts when the host data carries the comments-metrics capability.
  // The cycle-time consumer reuses the shared `PrListSection`
  // discriminated union and the shared renderer; this allowlist entry
  // is the 310-spread-guard's acknowledgement of 361's authorized
  // scope expansion. The guard remains active for every other
  // drill-down module.
  "cycle-time-drilldown.ts",
  // Feature 362 (FR-005 + contract `reviewer-pr-list.md` § 14):
  // reviewer drill-down's PR list MUST display the same per-row
  // thread / comment / unresolved counts when the host data carries
  // the comments-metrics capability.  The reviewer consumer reuses
  // the shared `PrListSection` discriminated union and the shared
  // renderer; this allowlist entry is the 310-spread-guard's
  // acknowledgement of 362's authorized scope expansion.  The guard
  // remains active for every other drill-down module.
  "reviewer-drilldown.ts",
]);

// Feature 310 identifiers that MUST stay inside
// ``throughput-drilldown.ts`` plus the shared ``detail-panel.ts``
// renderer which is the authoritative consumer.  The guard scans the
// drilldown directory only — shared modules are intentionally out of
// scope because they are the capability-aware consumers.
//
// Each entry pairs an identifier with its word-boundary regex.  The
// regex literals are hardcoded (not built dynamically from the
// identifier string) so ``eslint-plugin-security``
// ``detect-non-literal-regexp`` doesn't flag runtime construction —
// adding a new forbidden identifier is a two-place edit (name +
// literal regex) by design.
const FORBIDDEN_IDENTIFIERS: readonly {
  readonly name: string;
  readonly pattern: RegExp;
}[] = [
  { name: "threadCount", pattern: /\bthreadCount\b/ },
  { name: "commentCount", pattern: /\bcommentCount\b/ },
  { name: "activeThreadCount", pattern: /\bactiveThreadCount\b/ },
  { name: "thread_count", pattern: /\bthread_count\b/ },
  { name: "comment_count", pattern: /\bcomment_count\b/ },
  { name: "active_thread_count", pattern: /\bactive_thread_count\b/ },
];

const COMMENTS_METRICS_AVAILABLE_TRUTHY_PATTERN =
  /commentsMetricsAvailable\s*:\s*(true|[A-Za-z_$][\w$]*)/g;

function readDrilldownModules(): Array<{
  readonly name: string;
  readonly source: string;
}> {
  const entries = readDirEntries(DRILLDOWN_DIR);
  const modules: Array<{ readonly name: string; readonly source: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".ts")) continue;
    const source = readTextFile(path.join(DRILLDOWN_DIR, entry.name));
    modules.push({ name: entry.name, source });
  }
  return modules;
}

describe("Feature 310 spread guard: comments-metrics stays inside throughput-drilldown", () => {
  const modules = readDrilldownModules();

  it("scans at least the three expected drill-down modules", () => {
    const names = modules.map((m) => m.name).sort();
    // Sanity that the directory actually contains drill-down code.
    expect(names.length).toBeGreaterThanOrEqual(3);
    // Every allowlist entry MUST correspond to a real file; otherwise
    // a renamed module would silently leave the scope wide-open.
    for (const allowed of ALLOWED_MODULES) {
      expect(names).toContain(allowed);
    }
  });

  describe.each(
    modules
      .filter((m) => !ALLOWED_MODULES.has(m.name))
      .map((m) => [m.name, m.source] as const),
  )("non-throughput module %s", (_name, source) => {
    it.each(FORBIDDEN_IDENTIFIERS)(
      "does not reference $name",
      ({ pattern }) => {
        // Word-boundary regex so "threadCount" does not match
        // unrelated substrings in comments that happen to contain it.
        expect(source).not.toMatch(pattern);
      },
    );

    it("does not set commentsMetricsAvailable to any truthy value", () => {
      // The regex matches any ``commentsMetricsAvailable: <value>``
      // literal where the value is ``true`` OR a bare identifier
      // (which could transitively resolve to ``true``).  If a
      // non-throughput drill-down needs the flag threaded through for
      // unrelated reasons it MUST route through ``throughput-
      // drilldown.ts`` (or update ALLOWED_MODULES with review).
      for (const match of source.matchAll(
        COMMENTS_METRICS_AVAILABLE_TRUTHY_PATTERN,
      )) {
        const value = match[1];
        expect(value).toBe("false");
      }
    });
  });
});
