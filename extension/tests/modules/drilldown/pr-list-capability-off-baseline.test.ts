/**
 * SC-03 baseline for the capability-off drill-down path (issue #342 reframed).
 *
 * Renders ``installThroughputDrilldown`` against the REAL committed
 * capability-off demo artifact at
 * ``artifacts/demo-enterprise-comments-off/data/aggregates/weekly_rollups/*.json``
 * (NOT a synthetic-stripped fixture — per R-08's
 * "real committed capability-off artifact" constraint) and compares
 * the resulting ``<section id="pr-detail">`` innerHTML byte-for-byte
 * to the committed golden at
 * ``extension/tests/fixtures/throughput-drilldown-capability-off-baseline.html``.
 *
 * Reframed SC-03 contract (post-#342, 2026-04-25): capability-off
 * carries the shared ``PR | Cycle`` columnheader row ABOVE the list
 * (so the cycle-time number is labeled, not a context-less duration
 * floating beside the PR link), AND the bare ``.detail-panel-pr-row``
 * 2-col grid so rows align under the header — but the DOM still
 * carries NO comments-metrics surface: no ``--with-comments``
 * modifier classes anywhere, no sort buttons, no filter, no metric
 * spans, no coverage notice.  The pre-#310 baseline preserved by
 * this test from 2025 → 2026-04-25 had NO header at all; that shape
 * is now superseded — the "byte-identical to pre-310" framing was
 * preserving an unlabeled cycle-time as an accident, not an
 * invariant.  See PR #342 for the user-flagged UX gap and the
 * decision to reframe SC-03 around "no comments-metrics surface"
 * rather than "no header at all."
 *
 * The structural assertion further down (the ``it`` after this one)
 * spells out the new contract in code.
 *
 * Fails on any drift from the post-#342 shape.  Regenerate the golden
 * with ``REGENERATE_CAPABILITY_OFF_BASELINE=1 pnpm --dir extension
 * test -- pr-list-capability-off-baseline``.
 *
 * @module tests/modules/drilldown/pr-list-capability-off-baseline.test.ts
 */

import * as path from "node:path";

import type { Rollup } from "../../../ui/dataset-loader";
import { renderThroughputChart } from "../../../ui/modules/charts/throughput";
import { __resetComparisonAdvisoryForTests } from "../../../ui/modules/drilldown/comparison-advisory";
import { publishComparisonToggled } from "../../../ui/modules/drilldown/lifecycle-signals";
import { installThroughputDrilldown } from "../../../ui/modules/drilldown/throughput-drilldown";
import {
  dismissDetailPanel,
  isDetailPanelOpen,
} from "../../../ui/modules/shared/detail-panel";
import {
  ensureDir,
  readJsonFile,
  readTextFile,
  writeTextFile,
} from "../../helpers/fs-test-utils";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const WEEK = "2021-W52";
const ARTIFACT_ROLLUP_PATH = path.join(
  REPO_ROOT,
  "artifacts",
  "demo-enterprise-comments-off",
  "data",
  "aggregates",
  "weekly_rollups",
  `${WEEK}.json`,
);
const GOLDEN_PATH = path.join(
  REPO_ROOT,
  "extension",
  "tests",
  "fixtures",
  "throughput-drilldown-capability-off-baseline.html",
);

function click(target: HTMLElement): void {
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
}

function loadCapabilityOffRollup(): Rollup {
  return readJsonFile<Rollup>(ARTIFACT_ROLLUP_PATH);
}

describe("SC-03 capability-off baseline DOM matches the post-#342 reframed contract (shared PR | Cycle header, no comments-metrics surface)", () => {
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

  it(`renders <section id="pr-detail"> byte-identically to the committed golden for week ${WEEK}`, () => {
    const rollup = loadCapabilityOffRollup();
    const container = document.createElement("div");
    container.id = "throughput-chart";
    document.body.appendChild(container);
    renderThroughputChart(container, [rollup]);

    installThroughputDrilldown(container, [rollup], {
      filters: { repos: [], teams: [], reviewers: [], authors: [] },
      // Capability-off path: every manifest read resolved to
      // commentsMetricsAvailable=false in a real dataset-loader call,
      // and dashboard.ts wires that value into the options (see the
      // capabilityState?.commentsMetricsAvailable ?? false site at
      // dashboard.ts:1108).  The real capability-off artifact this
      // test loads has no thread_count / comment_count /
      // active_thread_count on its prs[*] entries — so capability-off
      // here exercises the "no comments-metrics columns" renderer
      // path SC-03 locks.
      commentsMetricsAvailable: false,
      webContext: {
        collectionUri: "https://dev.azure.com/acme",
      },
      repositoriesDimension: [],
      authorsDimension: [],
    });

    const bar = container.querySelector<HTMLElement>(".bar-container");
    if (bar === null) {
      throw new Error("throughput chart rendered no bars");
    }
    click(bar);

    const prSection = document.getElementById("pr-detail");
    if (prSection === null) {
      throw new Error("pr-detail section missing after drilldown click");
    }
    const actual = prSection.innerHTML;

    if (process.env.REGENERATE_CAPABILITY_OFF_BASELINE === "1") {
      ensureDir(path.dirname(GOLDEN_PATH));
      // Trailing newline keeps the pre-commit ``end-of-file-fixer``
      // hook happy; the comparison normalizes trailing whitespace on
      // both sides so the hook's normalization cannot drift the test.
      writeTextFile(GOLDEN_PATH, `${actual}\n`);
      return;
    }

    const expected = readTextFile(GOLDEN_PATH).replace(/\s+$/, "");
    expect(actual.replace(/\s+$/, "")).toBe(expected);
  });

  it("contains no comments-metrics spans in the rendered capability-off DOM", () => {
    const rollup = loadCapabilityOffRollup();
    const container = document.createElement("div");
    container.id = "throughput-chart";
    document.body.appendChild(container);
    renderThroughputChart(container, [rollup]);
    installThroughputDrilldown(container, [rollup], {
      filters: { repos: [], teams: [], reviewers: [], authors: [] },
      commentsMetricsAvailable: false,
      webContext: { collectionUri: "https://dev.azure.com/acme" },
      repositoriesDimension: [],
      authorsDimension: [],
    });
    const bar = container.querySelector<HTMLElement>(".bar-container");
    if (bar === null) throw new Error("no bar");
    click(bar);
    const prSection = document.getElementById("pr-detail")!;
    // Belt-and-braces structural assertion: the innerHTML snapshot
    // guards against every drift, but this explicit check makes
    // regressions about the comments-metrics surface surface with a
    // readable message rather than a 100KB diff.
    expect(prSection.querySelectorAll(".comments-metric").length).toBe(0);

    // Issue #342 reframed SC-03 contract: capability-off DOES carry
    // the shared PR | Cycle header (so the cycle-time gets labeled),
    // but MUST NOT carry any comments-metrics surface — no sort
    // buttons, no ``--with-comments`` modifier on header or list,
    // no filter bar, no metric spans, no coverage notice.  The
    // legacy ``.detail-panel-pr-list-controls`` container never
    // existed post-310 either; kept as a regression guard.
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
