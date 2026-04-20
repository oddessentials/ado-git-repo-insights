/**
 * Invariant: `classifyFilterState` is the single authority for drill-down
 * filter classification (feature 060, FR-024 / SC-015).
 *
 * No file under `extension/ui/modules/drilldown/` other than
 * `filter-support.ts` may reconstruct the classification precedence from
 * raw `filters.teams.length` or `filters.reviewers.length` checks. Any
 * consumer that needs the classification MUST import and call
 * `classifyFilterState`.
 *
 * Source-scan pattern follows the precedent set by
 * `tests/dashboard/refresh-metrics-invariants.test.ts` and the
 * `fs-test-utils` helper (no direct `fs` binding in scope).
 */

import { resolve } from "path";
import { readDir, readTextFile } from "../helpers/fs-test-utils";

const DRILLDOWN_DIR = resolve(
  __dirname,
  "..",
  "..",
  "ui",
  "modules",
  "drilldown",
);
const AUTHORITATIVE_MODULE = "filter-support.ts";
const FORBIDDEN_PATTERNS: readonly {
  readonly label: string;
  readonly re: RegExp;
}[] = [
  { label: "filters.teams.length", re: /filters\.teams\.length/ },
  { label: "filters.reviewers.length", re: /filters\.reviewers\.length/ },
];

function drilldownTsFiles(): readonly string[] {
  return readDir(DRILLDOWN_DIR).filter(
    (entry) => entry.endsWith(".ts") && !entry.endsWith(".d.ts"),
  );
}

describe("filter-classification single authority (FR-024 / SC-015)", () => {
  it("no drill-down module other than filter-support.ts rebuilds the classification from raw filter lengths", () => {
    const offenders: Array<{ file: string; pattern: string }> = [];
    for (const fileName of drilldownTsFiles()) {
      if (fileName === AUTHORITATIVE_MODULE) continue;
      const content = readTextFile(resolve(DRILLDOWN_DIR, fileName));
      for (const { label, re } of FORBIDDEN_PATTERNS) {
        if (re.test(content)) {
          offenders.push({ file: fileName, pattern: label });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
