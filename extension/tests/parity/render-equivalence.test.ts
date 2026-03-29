/**
 * Render-Equivalence Parity Tests (P1 Guardrail)
 *
 * Two layers:
 * A) Chart idempotency — same function, same data, two containers → identical HTML
 * B) Cross-entry-point wiring — CLI, /docs, and extension data paths → identical chart output
 *
 * Proves the parity invariant: same data in → same rendered DOM out,
 * regardless of how data was sourced or which entry point loaded it.
 */

import { renderThroughputChart } from "../../ui/modules/charts/throughput";
import {
  renderCycleDistribution,
  renderCycleTimeTrend,
} from "../../ui/modules/charts/cycle-time";
import { renderReviewerActivity } from "../../ui/modules/charts/reviewer-activity";
import { renderSummaryCards } from "../../ui/modules/charts/summary-cards";
import { normalizeRollup, normalizeRollups } from "../../ui/dataset-loader";
import type { Rollup } from "../../ui/dataset-loader";
import type { DistributionData } from "../../ui/types";

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

/** Create N rollups with predictable, deterministic values. */
function makeTestRollups(count: number): Rollup[] {
  return Array.from({ length: count }, (_, i) => ({
    week: `2025-W${String(i + 1).padStart(2, "0")}`,
    pr_count: 10 + i * 5,
    cycle_time_p50: 60 + i * 10,
    cycle_time_p90: 120 + i * 20,
    authors_count: 5 + i,
    reviewers_count: 3 + i,
    by_repository: null,
    by_team: null,
  }));
}

/** Create raw rollup objects (as parsed from JSON, pre-normalization). */
function makeRawRollups(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({
    week: `2025-W${String(i + 1).padStart(2, "0")}`,
    pr_count: 10 + i * 5,
    cycle_time_p50: 60 + i * 10,
    cycle_time_p90: 120 + i * 20,
    authors_count: 5 + i,
    reviewers_count: 3 + i,
  }));
}

/** Create test distributions with predictable values. */
function makeTestDistributions(): DistributionData[] {
  return [
    {
      year: "2025",
      cycle_time_buckets: {
        "0-1h": 15,
        "1-4h": 30,
        "4-8h": 25,
        "8-24h": 20,
        "1-3d": 7,
        "3d+": 3,
      },
    },
  ];
}

/** Create summary card container elements. */
function makeSummaryContainers() {
  const make = () => document.createElement("span");
  return {
    totalPrs: make(),
    cycleP50: make(),
    cycleP90: make(),
    authorsCount: make(),
    reviewersCount: make(),
    totalPrsSparkline: make(),
    cycleP50Sparkline: make(),
    cycleP90Sparkline: make(),
    authorsSparkline: make(),
    reviewersSparkline: make(),
    totalPrsDelta: make(),
    cycleP50Delta: make(),
    cycleP90Delta: make(),
    authorsDelta: make(),
    reviewersDelta: make(),
  };
}

// ---------------------------------------------------------------------------
// Layer A: Chart function idempotency
// ---------------------------------------------------------------------------

describe("Layer A: Chart function idempotency", () => {
  it("throughput chart renders identically in two containers", () => {
    const rollups = makeTestRollups(8);
    const a = document.createElement("div");
    const b = document.createElement("div");

    renderThroughputChart(a, rollups);
    renderThroughputChart(b, rollups);

    expect(a.innerHTML).toBe(b.innerHTML);
    expect(a.innerHTML).not.toBe(""); // non-vacuous
  });

  it("cycle-time distribution renders identically in two containers", () => {
    const distributions = makeTestDistributions();
    const a = document.createElement("div");
    const b = document.createElement("div");

    renderCycleDistribution(a, distributions);
    renderCycleDistribution(b, distributions);

    expect(a.innerHTML).toBe(b.innerHTML);
    expect(a.innerHTML).not.toBe("");
  });

  it("cycle-time trend renders identically in two containers", () => {
    const rollups = makeTestRollups(8);
    const a = document.createElement("div");
    const b = document.createElement("div");

    renderCycleTimeTrend(a, rollups);
    renderCycleTimeTrend(b, rollups);

    expect(a.innerHTML).toBe(b.innerHTML);
    expect(a.innerHTML).not.toBe("");
  });

  it("reviewer-activity renders identically in two containers", () => {
    const rollups = makeTestRollups(8);
    const a = document.createElement("div");
    const b = document.createElement("div");

    renderReviewerActivity(a, rollups);
    renderReviewerActivity(b, rollups);

    expect(a.innerHTML).toBe(b.innerHTML);
    expect(a.innerHTML).not.toBe("");
  });

  it("summary-cards renders identically with two container sets", () => {
    const rollups = makeTestRollups(8);
    const containersA = makeSummaryContainers();
    const containersB = makeSummaryContainers();

    renderSummaryCards({ rollups, containers: containersA });
    renderSummaryCards({ rollups, containers: containersB });

    // Compare each container element pair
    const mapB = new Map(Object.entries(containersB));
    for (const [key, elA] of Object.entries(containersA)) {
      const elB = mapB.get(key);
      expect(elA!.innerHTML).toBe(elB!.innerHTML);
    }
    // Non-vacuous: at least totalPrs should have content
    expect(containersA.totalPrs!.textContent).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
// Layer B: Cross-entry-point wiring parity
// ---------------------------------------------------------------------------

describe("Layer B: Cross-entry-point wiring parity", () => {
  // The parity claim: all entry points normalize data through normalizeRollup(),
  // and chart functions are pure (no mode branching). So:
  //   raw JSON → normalizeRollup() → renderChart() must produce
  //   identical output to directly-constructed Rollup → renderChart().

  it("CLI local mode wiring: normalizeRollup produces identical chart output to direct render", () => {
    // Direct render with typed Rollup objects (baseline)
    const typedRollups = makeTestRollups(8);
    const baseline = document.createElement("div");
    renderThroughputChart(baseline, typedRollups);

    // CLI wiring: raw JSON → normalizeRollups() → render
    // This simulates: CLI serves JSON files → fetch → JSON.parse → normalize → render
    const rawJson = makeRawRollups(8);
    const normalized = normalizeRollups(rawJson);
    const cliOutput = document.createElement("div");
    renderThroughputChart(cliOutput, normalized);

    expect(cliOutput.innerHTML).toBe(baseline.innerHTML);
    expect(cliOutput.innerHTML).not.toBe("");
  });

  it("docs demo mode wiring: same JSON, same normalization, identical output", () => {
    // /docs demo uses the same DatasetLoader + normalizeRollup path as CLI.
    // The only difference is the data source (./data vs CLI temp dir).
    // Same raw data → same normalized rollups → same chart output.
    const rawJson = makeRawRollups(8);

    // Simulate CLI path
    const cliNormalized = normalizeRollups(rawJson);
    const cliContainer = document.createElement("div");
    renderThroughputChart(cliContainer, cliNormalized);

    // Simulate docs path (identical normalization, different source URL)
    const docsNormalized = normalizeRollups(rawJson);
    const docsContainer = document.createElement("div");
    renderThroughputChart(docsContainer, docsNormalized);

    expect(docsContainer.innerHTML).toBe(cliContainer.innerHTML);
  });

  it("extension mode wiring: normalizeRollup on artifact data produces identical output", () => {
    // Extension loads via ArtifactClient → same JSON → normalizeRollup → render.
    // The raw JSON shape is identical regardless of transport mechanism.
    const rawJson = makeRawRollups(8);

    // Simulate CLI/docs path (baseline)
    const localNormalized = normalizeRollups(rawJson);
    const localContainer = document.createElement("div");
    renderThroughputChart(localContainer, localNormalized);

    // Simulate extension path: ArtifactClient returns same JSON,
    // normalizeRollup applied before rendering
    const extensionRollups = rawJson.map((r) => normalizeRollup(r));
    const extContainer = document.createElement("div");
    renderThroughputChart(extContainer, extensionRollups);

    expect(extContainer.innerHTML).toBe(localContainer.innerHTML);
    expect(extContainer.innerHTML).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
// Layer C: New component parity (041-metrics-dashboard-ux)
// ---------------------------------------------------------------------------

import { initTypeaheadDropdown } from "../../ui/modules/typeahead-dropdown";
import {
  classifyEmptyState,
  type EmptyStateContext,
} from "../../ui/modules/empty-state-classifier";
import type { DataAvailabilitySignal } from "../../ui/types";
import type { FilterState } from "../../ui/modules/filters";

const defaultAvailability: DataAvailabilitySignal = {
  reviewerDataPresent: true,
  reviewerDataEmpty: false,
  cycleTimePresent: true,
  reviewerRepoMode: "constrained",
  commentsStatus: "disabled",
};

const emptyFilters: FilterState = {
  repos: [],
  teams: [],
  reviewers: [],
  authors: [],
};

describe("Layer C: New component parity", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("typeahead dropdown renders identically in two containers with same config", () => {
    const containerA = document.createElement("div");
    containerA.id = "parity-a";
    document.body.appendChild(containerA);

    const containerB = document.createElement("div");
    containerB.id = "parity-b";
    document.body.appendChild(containerB);

    const options = [
      { id: "r1", displayName: "Repo Alpha" },
      { id: "r2", displayName: "Repo Beta" },
      { id: "r3", displayName: "Repo Gamma" },
    ];

    initTypeaheadDropdown({
      containerId: "parity-a",
      options,
      mode: "multi",
      placeholder: "Search...",
      initialSelection: [],
      onChange: () => {},
    });

    initTypeaheadDropdown({
      containerId: "parity-b",
      options,
      mode: "multi",
      placeholder: "Search...",
      initialSelection: [],
      onChange: () => {},
    });

    expect(containerA.innerHTML).toBe(containerB.innerHTML);
    expect(containerA.innerHTML).not.toBe(""); // non-vacuous
  });

  it("typeahead dropdown renders identically with same pre-selected values", () => {
    const containerA = document.createElement("div");
    containerA.id = "parity-sel-a";
    document.body.appendChild(containerA);

    const containerB = document.createElement("div");
    containerB.id = "parity-sel-b";
    document.body.appendChild(containerB);

    const options = [
      { id: "t1", displayName: "Team One" },
      { id: "t2", displayName: "Team Two" },
    ];

    initTypeaheadDropdown({
      containerId: "parity-sel-a",
      options,
      mode: "multi",
      placeholder: "Search teams...",
      initialSelection: ["t1"],
      onChange: () => {},
    });

    initTypeaheadDropdown({
      containerId: "parity-sel-b",
      options,
      mode: "multi",
      placeholder: "Search teams...",
      initialSelection: ["t1"],
      onChange: () => {},
    });

    expect(containerA.innerHTML).toBe(containerB.innerHTML);
    // Verify chip is present (non-vacuous)
    expect(containerA.querySelector(".typeahead-chip")).not.toBeNull();
  });

  it("typeahead single-select renders identically in two containers", () => {
    const containerA = document.createElement("div");
    containerA.id = "parity-single-a";
    document.body.appendChild(containerA);

    const containerB = document.createElement("div");
    containerB.id = "parity-single-b";
    document.body.appendChild(containerB);

    const options = [
      { id: "a1", displayName: "Alice" },
      { id: "a2", displayName: "Bob" },
    ];

    initTypeaheadDropdown({
      containerId: "parity-single-a",
      options,
      mode: "single",
      placeholder: "Search authors...",
      initialSelection: ["a1"],
      onChange: () => {},
    });

    initTypeaheadDropdown({
      containerId: "parity-single-b",
      options,
      mode: "single",
      placeholder: "Search authors...",
      initialSelection: ["a1"],
      onChange: () => {},
    });

    expect(containerA.innerHTML).toBe(containerB.innerHTML);
    // Verify selected value shows in input (non-vacuous)
    const inputA = containerA.querySelector(
      ".typeahead-input",
    ) as HTMLInputElement;
    expect(inputA?.value).toBe("Alice");
  });

  it("empty state classifier produces identical output for identical inputs", () => {
    const ctx: EmptyStateContext = {
      chartType: "throughput",
      filters: { repos: ["repo-a"], teams: [], reviewers: [], authors: [] },
      unfilteredRollups: makeTestRollups(8),
      filteredRollups: [],
      availability: defaultAvailability,
      minimumDataPoints: 0,
    };

    const result1 = classifyEmptyState(ctx);
    const result2 = classifyEmptyState(ctx);

    expect(result1).toEqual(result2);
    expect(result1).not.toBeNull();
    expect(result1!.reason).toBe("filter_caused");
  });

  it("empty state classifier is deterministic across chart types with same availability", () => {
    const baseCtx = {
      filters: emptyFilters,
      unfilteredRollups: [],
      filteredRollups: [],
      availability: { ...defaultAvailability, reviewerDataPresent: false },
      minimumDataPoints: 0,
    };

    // Reviewer: not_extracted
    const reviewer1 = classifyEmptyState({
      ...baseCtx,
      chartType: "reviewer_activity",
    });
    const reviewer2 = classifyEmptyState({
      ...baseCtx,
      chartType: "reviewer_activity",
    });
    expect(reviewer1).toEqual(reviewer2);
    expect(reviewer1!.reason).toBe("not_extracted");

    // Throughput: falls through to date_range_empty (pr_count always available)
    const throughput1 = classifyEmptyState({
      ...baseCtx,
      chartType: "throughput",
    });
    const throughput2 = classifyEmptyState({
      ...baseCtx,
      chartType: "throughput",
    });
    expect(throughput1).toEqual(throughput2);
    expect(throughput1!.reason).toBe("date_range_empty");
  });

  it("charts with empty-state classifier options produce identical output", () => {
    const rollups = makeTestRollups(0); // empty
    const unfilteredRollups = makeTestRollups(8);
    const filters: FilterState = {
      repos: ["nonexistent"],
      teams: [],
      reviewers: [],
      authors: [],
    };
    const options = {
      filters,
      unfilteredRollups,
      availability: defaultAvailability,
    };

    // Throughput parity with classifier options
    const tpA = document.createElement("div");
    const tpB = document.createElement("div");
    renderThroughputChart(tpA, rollups, options);
    renderThroughputChart(tpB, rollups, options);
    expect(tpA.innerHTML).toBe(tpB.innerHTML);
    expect(tpA.innerHTML).not.toBe("");

    // Reviewer activity parity with classifier options
    const raA = document.createElement("div");
    const raB = document.createElement("div");
    renderReviewerActivity(raA, rollups, {
      reviewerFilterActive: false,
      ...options,
    });
    renderReviewerActivity(raB, rollups, {
      reviewerFilterActive: false,
      ...options,
    });
    expect(raA.innerHTML).toBe(raB.innerHTML);
    expect(raA.innerHTML).not.toBe("");
  });
});
