# Quickstart: Verify the Cycle-Time PR-Level Detail Feature

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Contract**: [contracts/cycle-time-pr-list.md](./contracts/cycle-time-pr-list.md)

This walkthrough verifies every spec acceptance scenario and every Success Criterion, using only documented commands and the published demo dataset (which currently includes per-PR detail — see Edge Cases in `spec.md`). No live ADO connection required for the local-developer verification path.

## Pre-flight setup

```bash
# From repo root, on the 361-cycle-time-pr-drilldown branch:
pnpm install
cd extension && pnpm install --frozen-lockfile
cd ..
```

## 1. Build the extension and serve the demo

```bash
cd extension
pnpm run build:ui          # bundles ui/ into dist/ui/ (esbuild, IIFE)
pnpm run serve:docs        # serves ../docs/ at http://localhost:3000
```

Open `http://localhost:3000` in a Chromium-based browser. The dashboard loads against the published demo dataset under `docs/data/`.

## 2. P1 — See the slow PRs behind a slow week

**Spec ref**: User Story 1, FR-001 / FR-002 / FR-003 / FR-004 / FR-005, SC-001 / SC-002.

1. With no filters applied, scroll to the cycle-time trend chart.
2. Click any P90 dot on a week with at least one qualified PR (e.g., the `2025-W28` dot — the demo carries 151 PRs for that week per spec verification).
3. **Verify** the side panel opens and shows, in this order:
   - The week-range title with " — P90"
   - The subtitle "151 PRs" (or matching count)
   - The stat row: P50 and P90 cycle times
   - The "By repository" breakdown table
   - **The PR list section**, with rows showing PR titles and cycle times in descending order
4. **Verify** the top row's cycle time is the highest in the list (slowest first; FR-003 / SC-001).
5. Click any PR row.
6. **Verify** the PR opens in Azure DevOps in a new browser tab; the dashboard panel state is intact (FR-004 / SC-002).
7. Click the corresponding **P50** dot for the same week (without dismissing the panel).
8. **Verify** the metric headline above the PR list updates from "P90" to "P50" but the PR list rows below stay the same set in the same order (FR-005 / FR-014).

## 3. P2 — Filter awareness

**Spec ref**: User Story 2, FR-006 / FR-007 / FR-008 / FR-009, SC-004a / SC-004b / SC-004c / SC-004d.

### 3a. Team filter

1. Apply a single team filter from the team filter UI.
2. Click any cycle-time dot.
3. **Verify** the PR list section shows the same `team-inline` "clear the team filter" message that the throughput drill-down shows under the same filter shape.
4. Open the throughput drill-down for the same week (no closing required — change to the throughput chart and click).
5. **Verify** the messages are verbally and visually identical (same wording, same position).

### 3b. Reviewer filter

Repeat 3a with a single reviewer filter (and no team filter).
**Verify** the `reviewer-inline` message appears, identical to throughput's reviewer message.

### 3c. Author / repo filter

1. Clear team and reviewer filters. Apply an author filter (or repo filter, or both).
2. Click any cycle-time dot.
3. **Verify** the PR list renders normally, showing the filtered set (FR-008).

### 3d. Comparison mode

1. Toggle comparison mode on.
2. Click any cycle-time dot.
3. **Verify** no panel opens; the existing comparison-mode toast fires (FR-009 / SC-004d).

## 4. P3 — Truncation and unavailable-data signaling

**Spec ref**: User Story 3, FR-010 / FR-011, SC-006.

### 4a. Truncation cue

The demo's `2025-W28` rollup has `_prs_truncated: false`. To verify the truncation cue, you have two options:

- **Option A** (live ADO): point the extension at a tenant with a week that has more than 500 qualified PRs (the producer cap from feature 060).
- **Option B** (test fixture): the cycle-time consumer's automated test suite (`extension/tests/modules/drilldown/cycle-time-drilldown.test.ts`) exercises the truncation case via a synthetic rollup with `_prs_truncated: true` and `_prs_cap: 500`. This is the canonical local verification path.

In either case, **verify** the panel renders the same truncation cue text the throughput drill-down renders for the same condition.

### 4b. Supported-empty (zero PRs)

1. Identify (or construct via test fixture) a rollup where the week has zero qualified PRs (e.g., a week where every PR is still open).
2. **Verify** the PR list section renders the `supported-empty` inline message — distinct from the team / reviewer messages.

### 4c. Supported-empty (no web context)

1. Load the dashboard outside an Azure DevOps web context (e.g., the standalone demo at `localhost:3000` simulates this in some configurations).
2. Click any cycle-time dot.
3. **Verify** the PR list section renders the `supported-empty` inline message — no half-built rows, no link-less list.

(If the local serve does provide a synthetic web context, this case is exercised by the consumer test suite under fixture conditions where `webContext` is undefined.)

### 4d. Demo dataset (current state)

1. With the demo dashboard still loaded, click any cycle-time dot.
2. **Verify** the PR list renders normally — same as the throughput drill-down already does on the demo (because the demo currently includes `prs` arrays). No demo-specific empty state is forced. (User Story 3 acceptance scenario 4; spec Edge Cases reference #315.)

## 5. Accessibility and keyboard verification

**Spec ref**: FR-012 / FR-013, SC-005.

### 5a. Keyboard activation

1. With the dashboard loaded and no filters active, use Tab to focus a P90 dot on the cycle-time chart.
2. Press `Enter` — **verify** the panel opens with the PR list.
3. Press Escape to dismiss.
4. Re-focus the dot, press `Space` — **verify** the panel opens (and `preventDefault` is called so the page doesn't scroll).

### 5b. Tab reachability

1. With the panel open and the PR list rendered, press Tab repeatedly.
2. **Verify** focus moves through the PR rows in DOM order (first row first), and each row is activatable (Enter opens the PR in a new tab).

### 5c. Stable section identity

1. Cycle through the four content states: clear filters (pr-list); apply team filter (team-inline); switch to reviewer filter (reviewer-inline); construct a no-PR week or use the test fixture (supported-empty).
2. Use a screen reader (NVDA, VoiceOver, JAWS, or browser dev-tools accessibility inspector).
3. **Verify** the section's accessible name is identical across all four states (e.g., "PR list" or whatever the implementation chooses) — the user does not lose track of where they are.

## 6. Run the consumer test suite

**Spec ref**: FR-019 / FR-020, SC-006 / SC-010.

```bash
cd extension
pnpm test:coverage
```

**Verify**:
- All cycle-time-related tests pass (look for the file paths in `extension/tests/modules/drilldown/cycle-time-drilldown.test.ts` and the new sibling files).
- The `extension/test-results.xml` JUnit artifact is produced.

Then run the ratchet-bump preview:

```bash
python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml
```

**Verify**:
- Output reports `actual=N` for the Extension dimension equal to `extension.min_collected` in `.test-floor-contract.json`.
- No drift, no inter-file parity violation.

## 7. Run the authoritative local preflight

**Spec ref**: SC-007.

```bash
python scripts/run_pr_preflight.py
```

**Verify**:
- Exit code 0.
- No `--allow-local-degraded` flag used.
- Every CommandSpec passes, including:
  - mypy on `src/`, `tests/`, `scripts/`, `.github/scripts/`
  - ruff check + format
  - pytest with full coverage
  - Extension Jest CI (with the new tests)
  - Extension type tests
  - Extension smoke tests (Playwright)
  - PR-record schema parity (`scripts/check_pr_record_schema_parity.py`)
  - Generated artifact parity (UI bundle, docs shell, broken-docs)
  - Test floor contract validation (`scripts/check_test_floor_contract.py`)
  - Ratchet-bump guard (`scripts/check_ratchet_bump.py`)
  - Coverage delta gate
  - Gitleaks secret scan
  - Suppression baseline gates (zero across all scopes)
  - CLI reference drift gate
  - All other CommandSpecs in the preflight chain

## 8. Visual regression spot-check (optional)

Open the dashboard before and after the change in two side-by-side browser windows. Compare:

- Throughput drill-down panel — **MUST be unchanged** (FR-018 / SC-007).
- Reviewer activity drill-down panel — **MUST be unchanged**.
- Sparkline navigation — **MUST be unchanged**.
- Cycle-time drill-down panel — gains the PR list section after the per-repo breakdown.

Any visual change on a chart other than cycle-time is a regression and MUST block delivery.

## 9. Manager-readability check (SC-009)

Hand `spec.md` (specifically User Story 1) to a non-technical stakeholder. Ask them to summarize, in their own words and in under one minute, what the user sees today and what the user sees after the change.

A successful summary references:
- The cycle-time chart and the act of clicking a slow week.
- The current behavior (aggregate numbers + repo breakdown only).
- The new behavior (a list of actual PR titles, slowest first, click-through to ADO).

If the stakeholder cannot describe it within one minute, User Story 1's framing needs adjustment — but iteration 2's drafting was specifically tested against this criterion.

## Done criteria

The feature is verified locally when:

- All P1 / P2 / P3 acceptance scenarios above pass by inspection.
- The accessibility / keyboard verification (§ 5) passes with a screen reader or accessibility inspector.
- The consumer test suite (`pnpm test:coverage`) passes.
- The ratchet-bump command reports zero drift on extension and Python floors.
- `python scripts/run_pr_preflight.py` returns exit 0 with no degradation flag.
- A non-technical stakeholder reads User Story 1 and summarizes the change in under one minute.

At that point the feature is ready for the standard review cycle (Codex stop-hook + CI on PR).
