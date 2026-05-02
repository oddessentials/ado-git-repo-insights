/**
 * FR-015 — Capability-off DOM byte-identity for the cycle-time PR list.
 *
 * Mirrors the throughput equivalent at
 * `extension/tests/modules/drilldown/pr-list-capability-off-baseline.test.ts`.
 * Renders `installCycleTimeDrilldown` against a fixed fixture rollup with
 * `commentsMetricsAvailable: false` and compares the resulting
 * `<section id="pr-detail">` innerHTML byte-for-byte to the committed
 * golden at
 * `extension/tests/fixtures/cycle-time-drilldown-capability-off-baseline.html`.
 *
 * Fails on any drift — tag, attribute order, class set, whitespace, etc.
 * Regenerate the golden with:
 *
 *   REGENERATE_CYCLE_TIME_CAPABILITY_OFF_BASELINE=1 \
 *     pnpm --dir extension test -- cycle-time-pr-list-capability-off-baseline
 *
 * The shared renderer in `detail-panel.ts` owns the byte shape; this test
 * locks it for the cycle-time consumer surface so a future change to
 * either renderer or consumer surfaces a deliberate baseline update.
 */

import * as path from "node:path";

import { installCycleTimeDrilldown } from "../../../ui/modules/drilldown/cycle-time-drilldown";
import { __resetComparisonAdvisoryForTests } from "../../../ui/modules/drilldown/comparison-advisory";
import { publishComparisonToggled } from "../../../ui/modules/drilldown/lifecycle-signals";
import {
  dismissDetailPanel,
  isDetailPanelOpen,
} from "../../../ui/modules/shared/detail-panel";
import type { Rollup } from "../../../ui/dataset-loader";
import type { PrRecord } from "../../../ui/schemas/rollup.schema";
import {
  ensureDir,
  readTextFile,
  writeTextFile,
} from "../../helpers/fs-test-utils";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const GOLDEN_PATH = path.join(
  REPO_ROOT,
  "extension",
  "tests",
  "fixtures",
  "cycle-time-drilldown-capability-off-baseline.html",
);

function click(target: HTMLElement): void {
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
}

function makePr(id: number, cycleMinutes: number, title: string): PrRecord {
  return {
    id,
    title,
    author_id: "alice",
    repository_id: "repo-1",
    cycle_time: cycleMinutes,
  };
}

function makeFixtureRollup(): Rollup {
  return {
    week: "2025-W12",
    pr_count: 3,
    cycle_time_p50: 60 * 4,
    cycle_time_p90: 60 * 18,
    authors_count: 1,
    reviewers_count: 0,
    by_repository: {
      "repo-1": {
        pr_count: 3,
        cycle_time_p50: 60 * 4,
        cycle_time_p90: 60 * 18,
      },
    },
    by_team: null,
    // Producer-emitted order: cycle_time desc, id asc.
    prs: [
      makePr(101, 800, "feat: oauth"),
      makePr(102, 500, "refactor: hooks"),
      makePr(103, 200, "fix: null guard"),
    ],
    _prs_truncated: false,
    _prs_cap: 500,
  };
}

function stampTrigger(
  container: HTMLElement,
  week: string,
  metric: "p50" | "p90",
): HTMLElement {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.setAttribute("data-drilldown-week", week);
  trigger.setAttribute("data-drilldown-metric", metric);
  container.appendChild(trigger);
  return trigger;
}

describe("cycle-time PR list capability-off DOM byte-identity (FR-015)", () => {
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

  it('renders <section id="pr-detail"> byte-identically to the committed golden', () => {
    const rollup = makeFixtureRollup();
    const container = document.createElement("div");
    container.id = "cycle-time-trend";
    document.body.appendChild(container);
    installCycleTimeDrilldown(container, [rollup], {
      filters: { repos: [], teams: [], reviewers: [], authors: [] },
      repositoriesDimension: [
        {
          repository_id: "repo-1",
          repository_name: "web-app",
          project_name: "Frontend",
          organization_name: "acme",
        },
      ],
      webContext: { collectionUri: "https://dev.azure.com/acme/" },
      authorsDimension: [],
      // Capability-off: the renderer omits the comments-metrics columns,
      // sort buttons, filter, and coverage notice. The shared header
      // (PR | Cycle) DOES appear so the cycle-time number is labeled.
      commentsMetricsAvailable: false,
    });

    click(stampTrigger(container, rollup.week, "p50"));

    const prSection = document.getElementById("pr-detail");
    if (prSection === null) {
      throw new Error("pr-detail section missing after drill-down click");
    }
    const actual = prSection.innerHTML;

    if (process.env.REGENERATE_CYCLE_TIME_CAPABILITY_OFF_BASELINE === "1") {
      ensureDir(path.dirname(GOLDEN_PATH));
      // Trailing newline keeps the pre-commit `end-of-file-fixer` hook
      // happy; the comparison normalizes trailing whitespace on both
      // sides so that normalization can never drift the test.
      writeTextFile(GOLDEN_PATH, `${actual}\n`);
      return;
    }

    const expected = readTextFile(GOLDEN_PATH).replace(/\s+$/, "");
    expect(actual.replace(/\s+$/, "")).toBe(expected);
  });

  it("contains no comments-metrics surface in the capability-off DOM", () => {
    const rollup = makeFixtureRollup();
    const container = document.createElement("div");
    container.id = "cycle-time-trend";
    document.body.appendChild(container);
    installCycleTimeDrilldown(container, [rollup], {
      filters: { repos: [], teams: [], reviewers: [], authors: [] },
      repositoriesDimension: [
        {
          repository_id: "repo-1",
          repository_name: "web-app",
          project_name: "Frontend",
          organization_name: "acme",
        },
      ],
      webContext: { collectionUri: "https://dev.azure.com/acme/" },
      authorsDimension: [],
      commentsMetricsAvailable: false,
    });

    click(stampTrigger(container, rollup.week, "p50"));

    const prSection = document.getElementById("pr-detail")!;
    // Belt-and-braces structural assertions — the byte-identity check
    // guards every drift, but these surface regressions about the
    // comments-metrics surface with a readable message.
    expect(prSection.querySelectorAll(".comments-metric").length).toBe(0);
    expect(prSection.querySelector(".detail-panel-pr-list-filter")).toBeNull();
    expect(
      prSection.querySelector(".detail-panel-pr-list-controls"),
    ).toBeNull();
    expect(
      prSection.querySelector(".detail-panel-pr-list-coverage-notice"),
    ).toBeNull();
    const list = prSection.querySelector<HTMLOListElement>(
      "ol.detail-panel-pr-list",
    );
    expect(list).not.toBeNull();
    expect(
      list!.classList.contains("detail-panel-pr-list--with-comments"),
    ).toBe(false);
    const header = prSection.querySelector<HTMLElement>(
      ".detail-panel-pr-list-header",
    );
    expect(header).not.toBeNull();
    expect(
      header!.classList.contains("detail-panel-pr-list-header--with-comments"),
    ).toBe(false);
    expect(
      header!.querySelectorAll<HTMLElement>('[role="columnheader"]'),
    ).toHaveLength(2);
    expect(header!.querySelectorAll("button[data-sort-key]")).toHaveLength(0);
  });
});
