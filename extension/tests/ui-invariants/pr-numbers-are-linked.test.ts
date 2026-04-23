/**
 * UI invariant gate (issue #308): every rendered `#<number>` token that
 * refers to a PR must be inside an `<a href>` whose URL matches the ADO
 * PR URL shape.
 *
 * Scoped to the throughput drill-down PR list (the only current surface
 * that renders per-PR numbers). Do not mount unrelated panels here —
 * the user directive is to scope this gate to where PR numbers actually
 * surface, not to vacuously pass on panels without them.
 *
 * If a future drill-down starts rendering PR numbers, add it to this
 * file — the shared helper walks a user-provided root.
 */

import { renderThroughputChart } from "../../ui/modules/charts/throughput";
import { installThroughputDrilldown } from "../../ui/modules/drilldown/throughput-drilldown";
import {
  dismissDetailPanel,
  isDetailPanelOpen,
} from "../../ui/modules/shared/detail-panel";
import { publishComparisonToggled } from "../../ui/modules/drilldown/lifecycle-signals";
import { __resetComparisonAdvisoryForTests } from "../../ui/modules/drilldown/comparison-advisory";
import type { Rollup } from "../../ui/dataset-loader";
import { assertPrNumbersAreLinked } from "./_helpers";

const WEB_CTX = { collectionUri: "https://dev.azure.com/acme/" };
const REPOS = [
  {
    repository_id: "repo-1",
    repository_name: "web-app",
    project_name: "Frontend",
    organization_name: "acme",
  },
];

function makeRollup(
  prs: ReadonlyArray<{
    id: number;
    title: string;
    author_id: string;
    repository_id: string;
    cycle_time: number;
  }>,
): Rollup {
  return {
    week: "2025-W12",
    pr_count: prs.length,
    cycle_time_p50: null,
    cycle_time_p90: null,
    authors_count: 2,
    reviewers_count: 1,
    by_repository: null,
    by_author: null,
    by_team: null,
    prs,
    _prs_truncated: false,
    _prs_cap: 500,
  };
}

describe("UI invariant: PR numbers are hyperlinked (#308)", () => {
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

  it("throughput drill-down PR list: every #<number> has an ancestor <a href=.../pullrequest/N>", () => {
    const rollups = [
      makeRollup([
        {
          id: 101,
          title: "feat: oauth",
          author_id: "alice",
          repository_id: "repo-1",
          cycle_time: 125,
        },
        {
          id: 202,
          title: "fix: null guard",
          author_id: "bob",
          repository_id: "repo-1",
          cycle_time: 45,
        },
        {
          id: 9988,
          title: "chore: deps",
          author_id: "alice",
          repository_id: "repo-1",
          cycle_time: 800,
        },
      ]),
    ];
    const container = document.createElement("div");
    container.id = "throughput-chart";
    document.body.appendChild(container);
    renderThroughputChart(container, rollups);
    installThroughputDrilldown(container, rollups, {
      filters: { repos: [], teams: [], reviewers: [], authors: [] },
      repositoriesDimension: REPOS,
      webContext: WEB_CTX,
    });

    container
      .querySelector<HTMLElement>(".bar-container")!
      .dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );

    const panel = document.querySelector<HTMLElement>("aside.detail-panel");
    expect(panel).not.toBeNull();
    // Sanity: the rendered PR list actually contains PR-number text
    // nodes. Without this the assertion would pass vacuously.
    const anchors = panel!.querySelectorAll<HTMLAnchorElement>(
      ".detail-panel-pr-link",
    );
    expect(anchors.length).toBe(3);
    expect(panel!.textContent ?? "").toMatch(/#101/);
    expect(panel!.textContent ?? "").toMatch(/#202/);
    expect(panel!.textContent ?? "").toMatch(/#9988/);

    assertPrNumbersAreLinked(panel!);
  });

  it("helper reports a violation when a PR number is rendered outside an anchor (self-test)", () => {
    // Guards the helper itself against silent drift — if assertion
    // logic regresses to skip-on-miss, this fail-first case catches it.
    const root = document.createElement("div");
    root.innerHTML = `<p>see #404 for context</p>`;
    document.body.appendChild(root);
    expect(() => assertPrNumbersAreLinked(root)).toThrow(/#404/);
  });

  it("helper reports a violation when an anchor href is not an ADO PR URL", () => {
    const root = document.createElement("div");
    root.innerHTML = `<a href="https://example.com/something">#101</a>`;
    document.body.appendChild(root);
    expect(() => assertPrNumbersAreLinked(root)).toThrow(/#101/);
  });
});
