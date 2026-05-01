/**
 * FR-008 / SC-003 — Cycle-time PR list rendered-count parity.
 *
 * Mirrors the cross-cutting count-parity contract from feature 060
 * (`pr-list-count-parity.test.ts` covers `applyFiltersToRollups` at the
 * pure-function level). This test runs against the cycle-time consumer's
 * DOM render path: count the rendered `<li>` rows and compare them to
 * the producer's cap-aware slice.
 *
 * Two assertions per the contract:
 *   - Non-truncated rollup: rendered row count === `rollup.pr_count`.
 *   - Truncated rollup (`_prs_truncated: true`): rendered row count ===
 *     `rollup.prs.length` AND strictly less than `rollup.pr_count`
 *     (the producer pre-capped the slice; the consumer renders the slice
 *     and shows the truncation cue, but does not invent extra rows).
 */

import { renderCycleTimeTrend } from "../../../ui/modules/charts/cycle-time";
import { installCycleTimeDrilldown } from "../../../ui/modules/drilldown/cycle-time-drilldown";
import { __resetComparisonAdvisoryForTests } from "../../../ui/modules/drilldown/comparison-advisory";
import { publishComparisonToggled } from "../../../ui/modules/drilldown/lifecycle-signals";
import {
  dismissDetailPanel,
  isDetailPanelOpen,
} from "../../../ui/modules/shared/detail-panel";
import type { Rollup } from "../../../ui/dataset-loader";
import type { PrRecord } from "../../../ui/schemas/rollup.schema";

const BASE_WEB_CTX = { collectionUri: "https://dev.azure.com/acme/" };
const BASE_REPOS = [
  {
    repository_id: "repo-1",
    repository_name: "web-app",
    project_name: "Frontend",
    organization_name: "acme",
  },
];

function supportedOptions(): {
  filters: {
    repos: string[];
    teams: string[];
    reviewers: string[];
    authors: string[];
  };
  repositoriesDimension: typeof BASE_REPOS;
  webContext: typeof BASE_WEB_CTX;
  authorsDimension: never[];
  commentsMetricsAvailable: boolean;
} {
  return {
    filters: { repos: [], teams: [], reviewers: [], authors: [] },
    repositoriesDimension: BASE_REPOS,
    webContext: BASE_WEB_CTX,
    authorsDimension: [],
    commentsMetricsAvailable: false,
  };
}

function click(target: HTMLElement): void {
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
}

function makePr(id: number, cycleMinutes: number): PrRecord {
  return {
    id,
    title: `PR ${id}`,
    author_id: "alice",
    repository_id: "repo-1",
    cycle_time: cycleMinutes,
  };
}

function makeRollup(
  week: string,
  prs: PrRecord[],
  overrides: Partial<Rollup> = {},
): Rollup {
  return {
    week,
    pr_count: prs.length,
    cycle_time_p50: 60 * 4,
    cycle_time_p90: 60 * 18,
    authors_count: 1,
    reviewers_count: 0,
    by_repository: {
      "repo-1": {
        pr_count: prs.length,
        cycle_time_p50: 60 * 4,
        cycle_time_p90: 60 * 18,
      },
    },
    by_team: null,
    prs,
    _prs_truncated: false,
    _prs_cap: 500,
    ...overrides,
  };
}

function mountChart(rollups: Rollup[]): HTMLElement {
  const container = document.createElement("div");
  container.id = "cycle-time-trend";
  document.body.appendChild(container);
  renderCycleTimeTrend(container, rollups);
  return container;
}

function dotFor(
  container: HTMLElement,
  week: string,
  metric: "p50" | "p90",
): HTMLElement {
  const dot = container.querySelector<HTMLElement>(
    `g[data-drilldown-week="${week}"][data-drilldown-metric="${metric}"]`,
  );
  if (!dot) throw new Error(`dot for ${week}/${metric} not rendered`);
  return dot;
}

function renderedRowCount(): number {
  return document.querySelectorAll("#pr-detail ol li").length;
}

describe("cycle-time PR list rendered-count parity (FR-008 / SC-003)", () => {
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

  it("non-truncated rollup: rendered row count === rollup.pr_count", () => {
    const prs = [makePr(101, 800), makePr(102, 500), makePr(103, 200)];
    const week = "2025-W11";
    const rollups = [
      makeRollup("2025-W10", [makePr(1, 60)]),
      makeRollup(week, prs, { _prs_truncated: false }),
    ];
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups, supportedOptions());

    click(dotFor(container, week, "p90"));

    const rollup = rollups[1]!;
    expect(rollup._prs_truncated).toBe(false);
    expect(renderedRowCount()).toBe(rollup.pr_count);
    expect(renderedRowCount()).toBe(rollup.prs!.length);
    // No truncation cue emitted on un-truncated rollups.
    expect(
      document.querySelector("#pr-detail .truncation-indicator"),
    ).toBeNull();
  });

  it("truncated rollup: rendered count === rollup.prs.length AND strictly less than rollup.pr_count", () => {
    // Producer pre-capped: 4 rows in `prs`, but pr_count says 47 actual
    // matches existed (the producer truncated to top-4 by cycle_time).
    const prs = [
      makePr(101, 1500),
      makePr(102, 1200),
      makePr(103, 900),
      makePr(104, 600),
    ];
    const week = "2025-W11";
    const rollups = [
      makeRollup("2025-W10", [makePr(1, 60)]),
      makeRollup(week, prs, {
        pr_count: 47,
        _prs_truncated: true,
        _prs_cap: 4,
      }),
    ];
    const container = mountChart(rollups);
    installCycleTimeDrilldown(container, rollups, supportedOptions());

    click(dotFor(container, week, "p90"));

    const rollup = rollups[1]!;
    expect(rollup._prs_truncated).toBe(true);
    expect(renderedRowCount()).toBe(rollup.prs!.length);
    expect(renderedRowCount()).toBeLessThan(rollup.pr_count);

    // Truncation cue surfaces both counts so the user knows the slice is
    // capped.
    const indicator = document.querySelector(
      "#pr-detail .truncation-indicator",
    );
    expect(indicator).not.toBeNull();
    const indicatorText = indicator!.textContent ?? "";
    expect(indicatorText).toContain("4");
    expect(indicatorText).toContain("47");
  });
});
