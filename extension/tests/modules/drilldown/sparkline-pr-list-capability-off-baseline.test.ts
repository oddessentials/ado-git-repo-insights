/**
 * FR-013 — Capability-off DOM byte-identity for the sparkline-driven
 * period-scoped PR list (#363).
 *
 * Mirrors `cycle-time-pr-list-capability-off-baseline.test.ts`. Renders
 * `installSparklineNavigator` against a fixed multi-week rollup window
 * with `commentsMetricsAvailable: false` and compares the resulting
 * `<section id="pr-detail">` innerHTML byte-for-byte to the committed
 * golden at
 * `extension/tests/fixtures/sparkline-drilldown-capability-off-baseline.html`.
 *
 * Fails on any drift — tag, attribute order, class set, whitespace, etc.
 * Regenerate the golden with:
 *
 *   REGENERATE_SPARKLINE_CAPABILITY_OFF_BASELINE=1 \
 *     pnpm --dir extension test -- sparkline-pr-list-capability-off-baseline
 *
 * The shared renderer in `detail-panel.ts` owns the byte shape; this
 * test locks it for the sparkline consumer surface so a future change
 * to either renderer or consumer surfaces a deliberate baseline update.
 */

import * as path from "node:path";

import { installSparklineNavigator } from "../../../ui/modules/drilldown/sparkline-navigator";
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
  "sparkline-drilldown-capability-off-baseline.html",
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

function makeFixtureRollups(): Rollup[] {
  // Multi-week period (2025-W12 / 2025-W13) with 4 PRs total. The
  // capability-off renderer ignores comments-metrics fields entirely
  // even when the producer would supply them — fixture rows omit those
  // fields so the path is the pre-310 byte shape.
  return [
    {
      week: "2025-W12",
      start_date: "2025-03-17",
      end_date: "2025-03-23",
      pr_count: 2,
      cycle_time_p50: 60 * 4,
      cycle_time_p90: 60 * 18,
      authors_count: 1,
      reviewers_count: 0,
      by_repository: null,
      by_team: null,
      prs: [
        makePr(101, 800, "feat: oauth"),
        makePr(102, 500, "refactor: hooks"),
      ],
      _prs_truncated: false,
      _prs_cap: 500,
    },
    {
      week: "2025-W13",
      start_date: "2025-03-24",
      end_date: "2025-03-30",
      pr_count: 2,
      cycle_time_p50: 60 * 5,
      cycle_time_p90: 60 * 19,
      authors_count: 1,
      reviewers_count: 0,
      by_repository: null,
      by_team: null,
      prs: [makePr(201, 900, "fix: race"), makePr(202, 300, "chore: lint")],
      _prs_truncated: false,
      _prs_cap: 500,
    },
  ];
}

function mountSummaryCards(): HTMLElement {
  const container = document.createElement("div");
  container.className = "summary-cards";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sparkline-trigger";
  button.setAttribute("data-drilldown-target-chart", "throughput");
  button.setAttribute("aria-label", "Open full throughput chart");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  button.appendChild(svg);
  container.appendChild(button);
  document.body.appendChild(container);
  return container;
}

function mountTargetChart(): void {
  const el = document.createElement("div");
  el.id = "throughput-chart";
  document.body.appendChild(el);
}

describe("sparkline PR list capability-off DOM byte-identity (FR-013)", () => {
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
    const rollups = makeFixtureRollups();
    const container = mountSummaryCards();
    mountTargetChart();
    installSparklineNavigator(container, rollups, {
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

    const trigger = container.querySelector<HTMLElement>(
      "button.sparkline-trigger",
    );
    if (!trigger) throw new Error("trigger missing");
    click(trigger);

    const prSection = document.getElementById("pr-detail");
    if (prSection === null) {
      throw new Error("pr-detail section missing after sparkline click");
    }
    const actual = prSection.innerHTML;

    if (process.env.REGENERATE_SPARKLINE_CAPABILITY_OFF_BASELINE === "1") {
      ensureDir(path.dirname(GOLDEN_PATH));
      writeTextFile(GOLDEN_PATH, `${actual}\n`);
      return;
    }

    const expected = readTextFile(GOLDEN_PATH).replace(/\s+$/, "");
    expect(actual.replace(/\s+$/, "")).toBe(expected);
  });

  it("contains no comments-metrics surface in the capability-off DOM", () => {
    const rollups = makeFixtureRollups();
    const container = mountSummaryCards();
    mountTargetChart();
    installSparklineNavigator(container, rollups, {
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

    const trigger = container.querySelector<HTMLElement>(
      "button.sparkline-trigger",
    );
    if (!trigger) throw new Error("trigger missing");
    click(trigger);

    const prSection = document.getElementById("pr-detail")!;
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
  });
});
