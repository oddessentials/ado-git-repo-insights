/**
 * Reviewer drill-down (US3).
 *
 * Delegated `click` + `keydown` on the reviewer-activity chart
 * container per `contracts/drilldown-integration.md`: resolves
 * `[data-drilldown-reviewer-id]` targets on `.h-bar-row` elements and
 * opens the shared DetailPanel with per-reviewer stats aggregated from
 * the already-rendered rollups slice (no second data fetch — FR-070).
 *
 * Panel content shape per FR-040 / FR-041 / FR-042 / FR-043:
 *   - title:    the reviewer id (display-name lookup is deferred)
 *   - subtitle: total PR count for the reviewer across rollups
 *   - sections:
 *     - StatRowSection with four stats:
 *         · Total reviews       (sum of reviews_count)
 *         · PRs reviewed        (sum of reviewed_prs)
 *         · Approval rate       (computeApprovalRate — "No data"
 *                                 label + em-dash value when not
 *                                 computable, per FR-041's empty-
 *                                 state requirement)
 *         · Peak repositories   (max per-week repositories_count with
 *                                 the qualifying week label, per
 *                                 FR-042)
 *     - BreakdownTableSection with columns
 *         [Week, Reviews, PRs reviewed, Approval rate]
 *       built by iterating rollups, skipping weeks without a
 *       by_reviewer entry for the focused reviewer; null approval_rate
 *       renders as an empty cell (FR-043).
 *
 * Touch / tooltip / MutationObserver contracts mirror the throughput
 * and cycle-time drill-down modules — see `throughput-drilldown.ts`
 * for the invariant commentary.
 */

import type { Rollup } from "../../dataset-loader";
import type { ReviewerBreakdownEntry } from "../../schemas/rollup.schema";
import { computeApprovalRate } from "../charts/reviewer-activity";
import { dismissAllTooltips } from "../tooltip-manager";
import { formatWeekLabel } from "../shared/format";
import {
  makeBreakdownTable,
  makePanelContent,
  makeStatRow,
  openDetailPanel,
  type DrillDownContext,
  type PanelContent,
  type PanelRow,
} from "../shared/detail-panel";
import {
  isDrilldownDisabledByComparison,
  showComparisonAdvisoryToast,
} from "./comparison-advisory";

const ACTIVE_CLASS = "is-drilldown-active";

function reviewerEntry(
  rollup: Rollup,
  reviewerId: string,
): ReviewerBreakdownEntry | undefined {
  const map = rollup.by_reviewer;
  if (!map) return undefined;
  // Go through a Map view rather than a bracket-indexed object lookup
  // so ESLint's security/detect-object-injection rule is satisfied —
  // reviewerId is a user-supplied string.
  return new Map(Object.entries(map)).get(reviewerId);
}

function buildStatRow(rollups: readonly Rollup[], reviewerId: string) {
  let totalReviews = 0;
  let totalPrs = 0;
  let peakRepos = 0;
  let peakWeek: string | null = null;
  for (const rollup of rollups) {
    const entry = reviewerEntry(rollup, reviewerId);
    if (!entry) continue;
    totalReviews += entry.reviews_count;
    totalPrs += entry.reviewed_prs;
    const repos = entry.repositories_count ?? 0;
    if (repos > peakRepos) {
      peakRepos = repos;
      peakWeek = rollup.week;
    }
  }
  const approval = computeApprovalRate([...rollups], [reviewerId]);
  const approvalLabel =
    approval.rate === null ? "Approval rate (no data)" : "Approval rate";
  const approvalValue =
    approval.rate === null ? "—" : `${Math.round(approval.rate * 100)}%`;
  const peakValue =
    peakWeek !== null ? `${peakRepos} (${formatWeekLabel(peakWeek)})` : "0";
  return {
    section: makeStatRow([
      { label: "Total reviews", value: String(totalReviews) },
      { label: "PRs reviewed", value: String(totalPrs) },
      { label: approvalLabel, value: approvalValue },
      { label: "Peak repositories", value: peakValue },
    ]),
    totalPrs,
  };
}

function buildWeeklyTable(rollups: readonly Rollup[], reviewerId: string) {
  const rows: PanelRow[] = [];
  for (const rollup of rollups) {
    const entry = reviewerEntry(rollup, reviewerId);
    if (!entry) continue;
    const rate = entry.approval_rate;
    const rateCell =
      typeof rate === "number" && Number.isFinite(rate)
        ? `${Math.round(rate * 100)}%`
        : "";
    rows.push({
      label: formatWeekLabel(rollup.week),
      values: [
        String(entry.reviews_count),
        String(entry.reviewed_prs),
        rateCell,
      ],
    });
  }
  return makeBreakdownTable(
    "Weekly activity",
    ["Week", "Reviews", "PRs reviewed", "Approval rate"] as const,
    rows,
  );
}

function buildPanelContent(
  rollups: readonly Rollup[],
  reviewerId: string,
): PanelContent {
  const stats = buildStatRow(rollups, reviewerId);
  const subtitle = `${stats.totalPrs} ${stats.totalPrs === 1 ? "PR" : "PRs"} reviewed`;
  return makePanelContent(reviewerId, subtitle, [
    stats.section,
    buildWeeklyTable(rollups, reviewerId),
  ]);
}

export function installReviewerDrilldown(
  container: HTMLElement,
  rollups: readonly Rollup[],
): { dispose(): void } {
  const controller = new AbortController();
  const { signal } = controller;
  const observers = new Set<MutationObserver>();
  let activeTrigger: HTMLElement | null = null;

  function resolveTrigger(evt: Event): HTMLElement | null {
    const target = evt.target;
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>("[data-drilldown-reviewer-id]");
  }

  function clearActive(): void {
    if (activeTrigger) {
      activeTrigger.classList.remove(ACTIVE_CLASS);
      // PR #302 P1.E — aria-expanded mirrors active class; symmetric
      // with throughput-drilldown.ts and cycle-time-drilldown.ts.
      activeTrigger.setAttribute("aria-expanded", "false");
      activeTrigger = null;
    }
  }

  function registerPanelObserver(): void {
    const panel = document.querySelector<HTMLElement>("aside.detail-panel");
    if (!panel) return;
    const observer = new MutationObserver(() => {
      if (!panel.classList.contains("is-open")) {
        observer.disconnect();
        observers.delete(observer);
        clearActive();
      }
    });
    observer.observe(panel, { attributes: true, attributeFilter: ["class"] });
    observers.add(observer);
  }

  function activate(trigger: HTMLElement): void {
    const reviewerId = trigger.getAttribute("data-drilldown-reviewer-id");
    if (!reviewerId) return;

    dismissAllTooltips();

    if (isDrilldownDisabledByComparison()) {
      showComparisonAdvisoryToast(trigger);
      return;
    }

    // Resolve the set of rollups that actually carry data for the
    // reviewer. If none do, the panel still opens (empty-week table
    // + approval-rate "no data") so users see the null-result UX
    // rather than a silent no-op.
    const context: DrillDownContext = {
      sourceChart: "reviewer",
      focusedData: { kind: "reviewer", reviewerId },
      triggerElement: trigger,
      content: buildPanelContent(rollups, reviewerId),
    };

    openDetailPanel(context);

    clearActive();
    activeTrigger = trigger;
    trigger.classList.add(ACTIVE_CLASS);
    trigger.setAttribute("aria-expanded", "true");
    registerPanelObserver();
  }

  container.addEventListener(
    "click",
    (event) => {
      const trigger = resolveTrigger(event);
      if (!trigger) return;
      activate(trigger);
    },
    { signal },
  );

  container.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const trigger = resolveTrigger(event);
      if (!trigger) return;
      if (event.key === " ") event.preventDefault();
      activate(trigger);
    },
    { signal },
  );

  return {
    dispose(): void {
      controller.abort();
      for (const observer of observers) {
        observer.disconnect();
      }
      observers.clear();
      clearActive();
    },
  };
}
