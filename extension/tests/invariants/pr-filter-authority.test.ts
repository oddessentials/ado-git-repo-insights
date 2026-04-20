/**
 * Invariant: the `prs` array is filtered by a SINGLE authoritative
 * operation — the body of `applyFiltersToRollups` in
 * `extension/ui/modules/metrics.ts` (feature 060, FR-021, SC-015).
 *
 * Every other consumer of `rollup.prs` MUST be a read-only read (mapping,
 * rendering, counting). No other file may apply a filter expression to
 * `prs` because dual-path filter logic is how count mismatches (rendered
 * vs chart) are introduced. This invariant guards against that.
 *
 * Source-scan pattern follows the precedent set by
 * `tests/invariants/filter-classification-single-authority.test.ts`.
 */

import { resolve } from "path";
import { readTextFile } from "../helpers/fs-test-utils";

const METRICS_TS = resolve(
  __dirname,
  "..",
  "..",
  "ui",
  "modules",
  "metrics.ts",
);

function findApplyFiltersToRollupsBody(src: string): {
  readonly start: number;
  readonly end: number;
} {
  const declIdx = src.indexOf("export function applyFiltersToRollups");
  if (declIdx < 0) {
    throw new Error(
      "applyFiltersToRollups declaration not found in metrics.ts",
    );
  }
  // Find the first `{` after the declaration — the function body open.
  const bodyStart = src.indexOf("{", declIdx);
  if (bodyStart < 0) {
    throw new Error("applyFiltersToRollups body open brace not found");
  }
  // Walk to the matching close brace.
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    const ch = src.charAt(i);
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return { start: bodyStart, end: i + 1 };
      }
    }
  }
  throw new Error("applyFiltersToRollups body close brace not found");
}

describe("pr-filter single authority (FR-021 / SC-015)", () => {
  it("no code outside applyFiltersToRollups body filters rollup.prs in metrics.ts", () => {
    const src = readTextFile(METRICS_TS);
    const body = findApplyFiltersToRollupsBody(src);
    const outside = src.slice(0, body.start) + src.slice(body.end);

    const forbiddenPatterns: readonly { label: string; re: RegExp }[] = [
      // `rollup.prs.filter(` or `.prs.filter(` in any form
      { label: ".prs.filter(", re: /\.prs\.filter\s*\(/ },
      // Reassignment attempt: `rollup.prs =` outside the authoritative body
      { label: "rollup.prs assignment", re: /\brollup\.prs\s*=/ },
    ];

    const offenders: Array<{ pattern: string }> = [];
    for (const { label, re } of forbiddenPatterns) {
      if (re.test(outside)) offenders.push({ pattern: label });
    }
    expect(offenders).toEqual([]);
  });
});
