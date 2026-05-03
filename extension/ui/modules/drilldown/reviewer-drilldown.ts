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
 *   - title:    the reviewer's display name, resolved via
 *               `options.reviewersDimension` (#308 — no GUID in visible
 *               text). Falls back to `UNKNOWN_USER_LABEL` when the
 *               dimension is missing or the id is not present in it.
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
import type {
  AuthorEntry,
  ReviewerEntry,
} from "../../schemas/dimensions.schema";
import type {
  PrRecord,
  ReviewerBreakdownEntry,
} from "../../schemas/rollup.schema";
import { computeApprovalRate } from "../charts/reviewer-activity";
import { createEmptyFilterState, type FilterState } from "../filters";
import { dismissAllTooltips } from "../tooltip-manager";
import { formatWeekLabel } from "../shared/format";
import {
  makeBreakdownTable,
  makeEmptyState,
  makePanelContent,
  makePrListSection,
  makeStatRow,
  openDetailPanel,
  type DrillDownContext,
  type PanelContent,
  type PanelRow,
  type PanelSection,
  type PrListRow,
  type PrListSection,
} from "../shared/detail-panel";
import { resolveDisplayName } from "../shared/identity-fallback";
import {
  resolvePrUrl,
  type PrUrlRepositoryEntry,
  type PrUrlWebContext,
} from "../shared/pr-url";
import {
  isDrilldownDisabledByComparison,
  showComparisonAdvisoryToast,
} from "./comparison-advisory";
import { classifyFilterState } from "./filter-support";

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

/**
 * Build the repository-id allowlist for the per-(reviewer, week) PR overlay.
 *
 * `filters.repos` carries `repository_name` values (the chip's display
 * value; written by the dashboard filter UI and round-tripped through
 * URL params in `filters.ts`).  `PrRecord.repository_id`, by contrast,
 * is the repository GUID emitted by the producer.  Comparing across
 * those namespaces drops every row on production data; this helper
 * translates names → ids via `repositoriesDimension` so the overlay
 * stays in a single namespace.
 *
 *   - empty filter ⇒ `null` (no repo constraint; passthrough behaviour)
 *   - filter active + dimension absent / empty ⇒ empty `Set`
 *     (consumer cannot resolve names to ids without the dimension; the
 *     overlay then drops every row and the section falls through to the
 *     existing `supported-empty` branch below)
 *   - filter active + dimension present ⇒ `Set<repository_id>` covering
 *     every selected name that resolves in the dimension; names not
 *     present in the dimension are simply absent from the allowlist
 *     (most-restrictive — no defensive widening to the GUID namespace)
 *
 * Repository names are NOT unique within `repositoriesDimension` —
 * Azure DevOps allows two projects in the same organization to host
 * repos with identical names, so a single chip value can map to
 * multiple ids.  The reverse index is therefore one-to-many; every
 * matching id is added to the allowlist so a chip-level "API" filter
 * surfaces PRs from every "API" repo across projects.
 */
function buildRepoIdAllowlist(
  selectedNames: readonly string[],
  dim: readonly PrUrlRepositoryEntry[] | null | undefined,
): Set<string> | null {
  if (selectedNames.length === 0) return null;
  if (!dim || dim.length === 0) return new Set();
  const namesToIds = new Map<string, string[]>();
  for (const r of dim) {
    const list = namesToIds.get(r.repository_name);
    if (list) {
      list.push(r.repository_id);
    } else {
      namesToIds.set(r.repository_name, [r.repository_id]);
    }
  }
  const ids = new Set<string>();
  for (const name of selectedNames) {
    const matches = namesToIds.get(name);
    if (matches) {
      for (const id of matches) ids.add(id);
    }
  }
  return ids;
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

function buildWeeklyTable(
  rollups: readonly Rollup[],
  reviewerId: string,
): PanelSection {
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
  if (rows.length === 0) {
    // PR #302 P1.G — FR-071: when the reviewer has no by_reviewer entry
    // in any rollup for the active period, emit EmptyStateSection so the
    // panel doesn't render a header-only table. Symmetric with
    // throughput-drilldown.ts:49-65 and cycle-time-drilldown.ts:59-82.
    // Section-level aria-labelledby intentionally omitted (a11y P3-2
    // scope, not this slice).
    return makeEmptyState(
      "Weekly activity",
      "No review activity recorded for this reviewer in this period.",
    );
  }
  return makeBreakdownTable(
    "Weekly activity",
    ["Week", "Reviews", "PRs reviewed", "Approval rate"] as const,
    rows,
  );
}

/**
 * Feature 362: build the per-(reviewer, week) PR list section for the
 * reviewer drill-down panel.
 *
 * Structurally mirrors throughput's and cycle-time's `buildPrListSection`
 * helpers — same classifier, same factory, same row shape — with one
 * structural divergence locked at `/speckit.clarify` Q1 (Option A) +
 * FR-008: the classifier is invoked against a reviewer-stripped copy of
 * the filter state (`{...filters, reviewers: []}`) so the `"reviewer"`
 * classification is unreachable on this surface (the reviewer filter is
 * the SCOPE here, not a blocker).  Three reachable content states:
 * `pr-list`, `supported-empty`, `team-inline`.
 *
 * Cross-week union per data-model.md § 6: each rollup's
 * `by_reviewer[reviewerId].prs` slice is concatenated, the author/repo
 * overlay (if any) is applied client-side, and the union is re-sorted
 * by `cycle_time desc, id asc` (the producer sort is per-week; cross-week
 * ordering is consumer-owned).
 *
 * Truncation cue (contract § 6): the shared renderer fires the cue when
 * `renderedCount < actualFilteredCount`.  Per contract § 6, the cue MUST
 * surface under EITHER:
 *   (a) any participating week's `_prs_truncated` is `true` (the
 *       producer-driven authoritative truncation signal), OR
 *   (b) the pre-overlay collected count is strictly less than the sum of
 *       `reviewed_prs` -- the defensive safety net that catches a
 *       producer contract violation (clipped slice without setting
 *       `_prs_truncated:true`).
 * The author/repo overlay applied at the consumer reduces `rows.length`
 * but does NOT reduce the `collected` accumulator, so an overlay alone
 * (no truncation, no producer violation) NEVER fires the cue.  When
 * neither clause is satisfied, `actualFilteredCount` is set equal to
 * `rows.length` so the renderer's cue gate stays silent.
 *
 * Called after the comparison short-circuit in `activate()`, so the
 * `"comparison"` classification is unreachable here (narrowed-return
 * overload of `classifyFilterState`).
 */
function buildPrListSection(
  rollups: readonly Rollup[],
  reviewerId: string,
  options: ReviewerDrilldownOptions,
): PrListSection {
  const filters = options.filters ?? createEmptyFilterState();
  // FR-008: reviewer-stripping wrapper — the classifier never sees the
  // reviewer filter on THIS surface, so the "reviewer" classification is
  // unreachable by construction.  Only the team / supported branches are
  // reachable; "comparison" was short-circuited upstream in `activate()`.
  // We collapse the "reviewer" case (unreachable by construction) into
  // the "supported" path so the unreachable branch is never written —
  // an upstream classifier-contract change that ever did expose
  // "reviewer" here would naturally fall into supported-empty (no
  // ``by_reviewer.prs`` data → empty collected → supported-empty), which
  // matches contract § 3's defensive handling.
  const filtersForClassifier: FilterState = {
    ...filters,
    reviewers: [],
  };
  const { classification } = classifyFilterState(filtersForClassifier, false);
  if (classification === "team") {
    return makePrListSection({ contentState: "team-inline" });
  }
  // classification is "reviewer" | "supported"; reviewer is unreachable
  // per FR-008 above — both flow into the supported-empty / pr-list
  // branches below, and reviewer collapses to supported-empty by data
  // absence rather than via an explicit case.
  const webContext = options.webContext;
  // Walk every rollup, accumulate the reviewer's per-week prs[] slices
  // into a single working set, and compute the cap + truncation envelope
  // at the same time.  Skip rollups missing the per-(reviewer, week)
  // trio: a partial entry (one of the three present without the others)
  // signals an upstream malformation; the consumer treats any
  // participating week with a missing _prs_cap as the supported-empty
  // trigger per contract § 3.
  let capValue: number | undefined;
  let totalReviewedPrs = 0;
  let anyTruncated = false;
  const collected: PrRecord[] = [];
  for (const rollup of rollups) {
    // Reviewer lookups use the shared `reviewerEntry` helper (Map view)
    // so eslint's `security/detect-object-injection` is satisfied —
    // `reviewerId` is a user-supplied string.
    const entry = reviewerEntry(rollup, reviewerId);
    if (!entry) continue;
    const prsArray = entry.prs;
    const truncated = entry._prs_truncated;
    const cap = entry._prs_cap;
    if (
      !Array.isArray(prsArray) ||
      typeof truncated !== "boolean" ||
      typeof cap !== "number"
    ) {
      // Partial / missing trio — fall through to supported-empty.
      // Returning early is safe because contract § 3 says any
      // participating week missing _prs_cap MUST fire supported-empty.
      return makePrListSection({ contentState: "supported-empty" });
    }
    capValue = capValue === undefined ? cap : Math.max(capValue, cap);
    totalReviewedPrs += entry.reviewed_prs;
    if (truncated) anyTruncated = true;
    for (const pr of prsArray) {
      collected.push(pr);
    }
  }
  if (collected.length === 0 || !webContext || capValue === undefined) {
    return makePrListSection({ contentState: "supported-empty" });
  }
  // Apply the author / repo overlay client-side per contract § 4 (3).
  // Reviewer-stripping was applied to the classifier input upstream, so
  // the reviewer filter does NOT participate in the overlay here.
  //
  // `filters.repos` carries `repository_name` strings sourced from the
  // dashboard chip / URL deserialization (see `filters.ts`), but the
  // producer emits `PrRecord.repository_id` as the repository GUID.
  // Translate the selected names to ids via `repositoriesDimension` so
  // the overlay compares within a single namespace.
  const authorAllow =
    filters.authors.length > 0 ? new Set(filters.authors) : null;
  const repoAllow = buildRepoIdAllowlist(
    filters.repos,
    options.repositoriesDimension,
  );
  const filtered =
    authorAllow === null && repoAllow === null
      ? collected
      : collected.filter(
          (pr) =>
            (authorAllow === null || authorAllow.has(pr.author_id)) &&
            (repoAllow === null || repoAllow.has(pr.repository_id)),
        );
  // Re-sort the cross-week union by `cycle_time desc, id asc`.  The
  // producer guarantees sort within each week; the union must be re-
  // sorted because per-week slices are independent.
  const sorted = filtered.slice().sort((a, b) => {
    if (b.cycle_time !== a.cycle_time) return b.cycle_time - a.cycle_time;
    return a.id - b.id;
  });
  if (sorted.length === 0) {
    return makePrListSection({ contentState: "supported-empty" });
  }
  const commentsMetricsAvailable = options.commentsMetricsAvailable ?? false;
  const rows: PrListRow[] = sorted.map((pr): PrListRow => {
    if (!commentsMetricsAvailable) {
      return {
        id: pr.id,
        title: pr.title,
        cycleTimeMinutes: pr.cycle_time,
        url: resolvePrUrl(pr, options.repositoriesDimension, webContext),
      };
    }
    return {
      id: pr.id,
      title: pr.title,
      cycleTimeMinutes: pr.cycle_time,
      url: resolvePrUrl(pr, options.repositoriesDimension, webContext),
      threadCount: pr.thread_count,
      commentCount: pr.comment_count,
      activeThreadCount: pr.active_thread_count,
    };
  });
  // Truncation cue gating (contract § 6): the shared renderer fires the
  // cue when ``renderedCount < actualFilteredCount``.  Per contract § 6,
  // the cue MUST appear whenever EITHER:
  //   (a) any participating week's ``_prs_truncated`` is true (the
  //       producer-driven authoritative truncation signal), OR
  //   (b) (defensive clause) the pre-overlay collected count is strictly
  //       less than the sum of ``reviewed_prs`` -- "would only fire if
  //       the producer drops to truncation after emission, which is a
  //       contract violation".  This is the safety net that catches a
  //       producer bug where PRs are dropped from the slice without
  //       setting ``_prs_truncated`` (e.g., if a future change drops
  //       PRs with non-finite cycle_time without flagging the slice).
  // The author/repo overlay applied at the consumer (contract § 4 (3))
  // reduces ``rows.length`` BELOW ``collected.length``, but does NOT
  // reduce ``collected.length`` itself -- so the defensive clause is
  // overlay-blind by construction (compares pre-overlay collected count
  // against pre-overlay reviewed_prs sum).  This preserves the
  // intended behavior: an overlay alone does NOT fire the cue, but a
  // producer contract violation (with or without overlay) does.
  const truncationDetected =
    anyTruncated || collected.length < totalReviewedPrs;
  const actualFilteredCount = truncationDetected
    ? totalReviewedPrs
    : rows.length;
  return makePrListSection({
    contentState: "pr-list",
    rows,
    renderedCount: rows.length,
    actualFilteredCount,
    capValue,
    commentsMetricsAvailable,
    // Issue #367 — per-rollup-union: ``capValue`` is
    // ``Math.max(per-week _prs_cap)`` (computed at line 316 above)
    // and the rendered set is the cross-week union of per-week top-
    // {cap} slices.  No global cycle-time-rank guarantee — the
    // shared renderer surfaces "per week" in the truncation cue so
    // the copy doesn't lie about a slice-level rank that doesn't
    // exist for unions.
    capScope: "per-rollup-union",
  });
}

function buildPanelContent(
  rollups: readonly Rollup[],
  reviewerId: string,
  reviewerNameByKey: ReadonlyMap<string, string>,
  options: ReviewerDrilldownOptions,
): PanelContent {
  const stats = buildStatRow(rollups, reviewerId);
  const subtitle = `${stats.totalPrs} ${stats.totalPrs === 1 ? "PR" : "PRs"} reviewed`;
  const displayName = resolveDisplayName(reviewerId, reviewerNameByKey);
  // Section order (contract § 2): stat row → weekly activity table (or
  // its empty-state branch) → PR list.  PR list always renders (one of
  // three reachable content states) so the panel section count is stable
  // across filter / data / capability shapes.
  return makePanelContent(displayName, subtitle, [
    stats.section,
    buildWeeklyTable(rollups, reviewerId),
    buildPrListSection(rollups, reviewerId, options),
  ]);
}

function buildReviewerNameMap(
  dim: readonly ReviewerEntry[] | null | undefined,
): ReadonlyMap<string, string> {
  if (!dim || dim.length === 0) return new Map();
  return new Map(dim.map((r) => [r.reviewer_id, r.reviewer_name]));
}

/**
 * Options accepted by `installReviewerDrilldown`.
 *
 * Issue #308 added `reviewersDimension` so the panel title resolves
 * `reviewer_id` GUIDs to friendly names.  Feature 362 mirrors
 * `ThroughputDrilldownOptions` / `CycleTimeDrilldownOptions` field-for-field
 * so the dashboard can build one options bag and pass it to all three
 * installs (see `data-model.md` § 4 for field semantics).  Every Feature-362
 * field is optional; when absent the reviewer PR list falls through to the
 * `supported-empty` content state (no PR list rows rendered).  Existing
 * two-argument callers keep working — when the dimension is missing every
 * panel title falls back to `UNKNOWN_USER_LABEL`.
 *
 * `authorsDimension` is accepted for call-site uniformity with the
 * throughput / cycle-time installs but is NOT consumed by the reviewer
 * render path (reviewer has no `By author` breakdown).  Threading it
 * through keeps `dashboard.ts` constructing one bag for all three surfaces.
 */
export interface ReviewerDrilldownOptions {
  readonly reviewersDimension?: readonly ReviewerEntry[] | null | undefined;
  readonly filters?: FilterState;
  readonly repositoriesDimension?:
    | readonly PrUrlRepositoryEntry[]
    | null
    | undefined;
  readonly webContext?: PrUrlWebContext;
  readonly authorsDimension?: readonly AuthorEntry[] | null | undefined;
  readonly commentsMetricsAvailable?: boolean;
}

export function installReviewerDrilldown(
  container: HTMLElement,
  rollups: readonly Rollup[],
  options: ReviewerDrilldownOptions = {},
): { dispose(): void } {
  const controller = new AbortController();
  const { signal } = controller;
  const observers = new Set<MutationObserver>();
  let activeTrigger: HTMLElement | null = null;
  // Built once per install so re-renders reuse a stable map; the install
  // is re-created by dashboard.ts on every filter change, so this map
  // stays in sync with the dimensions snapshot the UI currently shows.
  const reviewerNameByKey = buildReviewerNameMap(options.reviewersDimension);

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
      content: buildPanelContent(
        rollups,
        reviewerId,
        reviewerNameByKey,
        options,
      ),
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
