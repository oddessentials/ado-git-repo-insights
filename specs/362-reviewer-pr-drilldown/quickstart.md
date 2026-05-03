# Quickstart: Verify the Reviewer-Activity Chart PR-Level Detail Feature

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Producer Contract**: [contracts/per-reviewer-week-prs.md](./contracts/per-reviewer-week-prs.md) | **Consumer Contract**: [contracts/reviewer-pr-list.md](./contracts/reviewer-pr-list.md)

This walkthrough verifies every spec acceptance scenario and every Success Criterion. Producer-side behavior is exercised via pytest fixtures; consumer-side behavior is exercised manually against the published demo dataset (after the demo-generator parallel-path mirror lands).

## Pre-flight setup

```bash
# From repo root, on the 362-reviewer-pr-drilldown branch:
pnpm install
cd extension && pnpm install --frozen-lockfile
cd ..
pip install -e .[dev]
```

## 1. Build the producer-side change and rebuild the demo

```bash
# Run the producer + demo-generator extensions:
python -m pytest tests/unit/test_aggregators_reviewer_pr_detail.py -v
python -m pytest tests/unit/test_strip_pr_arrays_reviewer_nested.py -v
python -m pytest tests/unit/test_demo_generator_reviewer_pr_detail.py -v

# Rebuild the demo dataset so the new sub-array lands under each by_reviewer entry:
python scripts/build-demo-dataset.py

# Verify the strip helper removed the new sub-array from docs/data/:
python -c "
import json
from pathlib import Path
rollup = json.loads((Path('docs/data/aggregates/weekly_rollups/2025-W28.json')).read_text(encoding='utf-8'))
for reviewer_id, entry in (rollup.get('by_reviewer') or {}).items():
    for forbidden in ('prs', '_prs_truncated', '_prs_cap'):
        assert forbidden not in entry, f'public artifact leaked {forbidden} on by_reviewer[{reviewer_id}]'
print('public artifact strip verified: no per-(reviewer, week) PR detail leaked')
"
```

## 2. Build the extension and serve the demo

```bash
cd extension
pnpm run build:ui          # bundles ui/ into dist/ui/ (esbuild, IIFE)
pnpm run serve:docs        # serves ../docs/ at http://localhost:3000
```

Open `http://localhost:3000` in a Chromium-based browser. The dashboard loads against the published demo dataset under `docs/data/`.

**Note**: because the public demo strips the per-(reviewer, week) `prs[]` field, the consumer's PR list will render the `supported-empty` content state on the demo (FR-011 — "the union of per-(reviewer, week) prs[] slices is empty" trigger). To verify the `pr-list` content state on the demo, you would need either (a) a private-tenant build that doesn't strip, OR (b) the consumer-side test suite which uses synthetic non-stripped fixtures — see § 6 below. The demo on `docs/data/` is by design the "no PR detail" path.

## 3. P1 — See which PRs a reviewer actually reviewed

**Spec ref**: User Story 1, FR-001 / FR-002 / FR-003 / FR-004, SC-001 / SC-002.

Manual test against private-tenant data (this section presumes a private build with `_strip_pr_arrays_from_rollups` NOT applied to the rollups under test):

1. Apply a reviewer filter to a single reviewer with at least one qualified review in the period (e.g., the reviewer with the highest `reviewed_prs` count).
2. Scroll to the reviewer-activity chart.
3. Click any bar row for that reviewer (typically rows are gated to the focused reviewer; the chart shows their per-week activity).
4. **Verify** the side panel opens and shows, in this order:
    - The reviewer's display name (e.g., "Alice Anderson")
    - The subtitle "N PRs reviewed"
    - The four-cell stat row (Total reviews, PRs reviewed, Approval rate, Peak repositories)
    - The "Weekly activity" breakdown table
    - **The PR list section**, with rows showing PR titles and cycle times in descending order
5. **Verify** the top row's cycle time is the highest in the list (slowest first; FR-003 / SC-001).
6. Click any PR row.
7. **Verify** the PR opens in Azure DevOps in a new browser tab; the dashboard panel state is intact (FR-004 / SC-002).

**Demo-side note**: on the public demo the PR list section will render `supported-empty`. To exercise the full `pr-list` flow on the demo, either (a) point the extension at a private-tenant artifact, or (b) use the consumer test suite via `pnpm test`.

## 4. P2 — Filter overlay sensibility

**Spec ref**: User Story 2, FR-006 / FR-007 / FR-008 / FR-009, SC-004a / SC-004c.

### 4a. Team-filter overlay

1. With the reviewer filter active, apply a team filter on top.
2. Click the reviewer's row.
3. **Verify** the PR list section shows the same `team-inline` "clear the team filter to see PRs" message that the throughput drill-down shows under team-only filters.
4. Open the throughput drill-down for any week (no closing required — switch to the throughput chart and click).
5. **Verify** the messages are verbally and visually identical (same wording, same position).

### 4b. Author/repo-filter overlay (intersection — PR list shows)

1. Clear the team filter. Apply an author filter and/or a repository filter on top of the reviewer filter.
2. Click the reviewer's row.
3. **Verify** the PR list renders normally, with rows representing the (reviewer ∩ author/repo) intersection only.
4. Verify the reviewer-stripping behavior: the `reviewer-inline` "clear the reviewer filter" message MUST NOT appear on this surface (the reviewer filter is the SCOPE here, not a blocker).

### 4c. Comparison mode

1. Toggle comparison mode on.
2. Click any reviewer row.
3. **Verify** no panel opens; the existing comparison-mode toast fires (FR-009 / SC-004c).

## 5. P3 — Truncation and unavailable-data signaling

**Spec ref**: User Story 3, FR-010 / FR-011, SC-006.

### 5a. Truncation cue (cap-boundary at 500/501)

The demo's per-(reviewer, week) seeds are bounded well below 500, so truncation does not fire on demo data. To verify the truncation cue:

- **Option A** (live ADO): point the extension at a tenant where at least one reviewer reviewed 501+ PRs in a single week. Click that reviewer's row.
- **Option B** (test fixture): the producer-side test suite (`tests/unit/test_aggregators_reviewer_pr_detail.py`) exercises the cap-boundary at 500/501 via FR-029. The consumer-side test suite (`extension/tests/modules/drilldown/reviewer-drilldown.test.ts`) exercises the truncation cue via a synthetic rollup with `by_reviewer[*]._prs_truncated: true`. This is the canonical local verification path.

In either case, **verify** the panel renders the same truncation cue text the throughput drill-down renders for the same condition.

### 5b. Supported-empty (zero qualifying PRs)

1. Identify (or construct via test fixture) a reviewer with zero qualifying PRs in the active period (e.g., a reviewer who was on leave).
2. Click the reviewer's row.
3. **Verify** the PR list section renders the `supported-empty` inline message — distinct from the team-filter message.

### 5c. Supported-empty (no web context)

1. Load the dashboard outside an Azure DevOps web context (e.g., the standalone demo at `localhost:3000` simulates this in some configurations).
2. Click any reviewer row.
3. **Verify** the PR list section renders the `supported-empty` inline message — no half-built rows, no link-less list.

(If the local serve does provide a synthetic web context, this case is exercised by the consumer test suite under fixture conditions where `webContext` is undefined.)

### 5d. Demo dataset (current state — Option A's expected demo behavior)

1. With the demo dashboard loaded (from `docs/data/`), apply a reviewer filter and click the row.
2. **Verify** the PR list section renders the `supported-empty` content state — because the public demo strips per-(reviewer, week) `prs[]` per FR-022 + FR-028. This is the expected demo behavior under Option A.
3. Confirm via dev-tools: inspect the rendered panel and verify the PR list section's content-state marker is `supported-empty`, not `pr-list`.

## 6. Accessibility and keyboard verification

**Spec ref**: FR-012 / FR-013, SC-005.

### 6a. Keyboard activation

1. With the dashboard loaded and a reviewer filter active, use Tab to focus the reviewer's bar row.
2. Press `Enter` — **verify** the panel opens with the PR list section (or supported-empty on the public demo).
3. Press Escape to dismiss.
4. Re-focus the row, press `Space` — **verify** the panel opens (and `preventDefault` is called so the page doesn't scroll).

### 6b. Tab reachability

1. With the panel open and the PR list rendered (private-tenant build), press Tab repeatedly.
2. **Verify** focus moves through the PR rows in DOM order (first row first), and each row is activatable (Enter opens the PR in a new tab).

### 6c. Stable section identity

1. Cycle through the three reachable content states by toggling filter overlays:
    - No team filter, with PR list data → `pr-list`
    - No team filter, without PR list data → `supported-empty`
    - Team filter overlay → `team-inline`
2. Use a screen reader (NVDA, VoiceOver, JAWS, or browser dev-tools accessibility inspector).
3. **Verify** the section's accessible name is identical across all three states (e.g., "PR list" or whatever the implementation chooses) — the user does not lose track of where they are in the panel.

## 7. Run the consumer test suite

**Spec ref**: FR-019 / FR-020 / FR-026, SC-006 / SC-010.

```bash
cd extension
pnpm test:coverage
```

**Verify**:

- All reviewer-related tests pass (look for `reviewer-drilldown.test.ts`, `reviewer-pr-list-order.test.ts`, `reviewer-pr-list-count-parity.test.ts`, `reviewer-pr-list-capability-off-baseline.test.ts`).
- The `extension/test-results.xml` JUnit artifact is produced.

Then run the ratchet-bump preview (BOTH dimensions):

```bash
python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml --junit-python pytest-results.xml
```

(Run pytest first to produce `pytest-results.xml` if not already produced — check `python scripts/run_pytest.py --help` for the project's standard JUnit emit path.)

**Verify**:

- Output reports `actual=N_extension` for the Extension dimension equal to `extension.min_collected` in `.test-floor-contract.json`.
- Output reports `actual=N_python` for the Python dimension equal to `python.min_collected` in `.test-floor-contract.json`.
- No drift, no inter-file parity violation.

## 8. Run the producer-side test suite

```bash
python -m pytest tests/unit/test_aggregators_reviewer_pr_detail.py tests/unit/test_strip_pr_arrays_reviewer_nested.py tests/unit/test_demo_generator_reviewer_pr_detail.py -v
```

**Verify**:

- Cap-boundary regression at 500 / 501 passes (FR-029).
- Atomicity: `_prs_cap` always present alongside `prs`.
- Sort-before-truncate: at 501 records, the slice contains the 500 highest-cycle-time records, the dropped record is the fastest.
- `reviewed_prs == prs.length` under non-truncation; `prs.length == _prs_cap` under truncation.
- Strip-helper coverage at depth 2: `by_reviewer[*].prs` is removed by `_strip_one`; `_verify_clean` returns empty list after strip.
- Strip-helper fail-loud regression: monkey-patching `_strip_one` to skip the nested walk causes `strip_pr_arrays_from_rollups` to raise `PrArrayResidueError` referencing the per-(reviewer, week) residue path.
- Demo-generator parallel-path coherence: demo's per-(reviewer, week) `prs[]` satisfies the same atomicity / sort invariants as production.

## 9. Verify the SC-014 byte-budget report

After the implementation lands, the implementation commit's message body MUST include a section like:

```text
## SC-014: Byte-budget before/after fixture-size report

Fixture: artifacts/demo-enterprise/data/aggregates/weekly_rollups/ (or analogous private-tenant fixture path)
Period: 26 weeks
Before (Option A NOT applied): <X> bytes
After (Option A applied):       <Y> bytes
Absolute delta:                  <Y - X> bytes
Relative delta:                  <((Y - X) / X) * 100>%
Per-week average growth:         <(Y - X) / 26> bytes/week
```

**Verify**:

- The report cites a fixture path that exists and is reproducible.
- The before/after numbers are integer byte counts measured by `os.path.getsize()` or equivalent (not estimated).
- The relative delta is plausible (~3.3× growth on the per-week PR-detail portion of the artifact, BUT diluted by the rest of the artifact which doesn't change — so the overall relative delta is smaller than 3.3×).

## 10. Run the authoritative local preflight

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
    - PR-record schema parity (`scripts/check_pr_record_schema_parity.py`) — green by no-op (no PrRecord field added per FR-017)
    - Privacy-posture ordering (`tests/unit/test_privacy_posture_ordering.py`) — green by no-op per FR-022
    - Generated artifact parity (UI bundle, docs shell, broken-docs)
    - Test floor contract validation (`scripts/check_test_floor_contract.py`)
    - Ratchet-bump guard on BOTH Python and Extension dimensions (`scripts/check_ratchet_bump.py`)
    - Coverage delta gate
    - Gitleaks secret scan
    - Suppression baseline gates (zero across all scopes)
    - CLI reference drift gate
    - All other CommandSpecs in the preflight chain

## 11. Visual regression spot-check

Open the dashboard before and after the change in two side-by-side browser windows. Compare:

- Throughput drill-down panel — **MUST be unchanged** (FR-018 / SC-007).
- Cycle-time drill-down panel — **MUST be unchanged**.
- Reviewer activity chart (chart side, not the panel) — **MUST be unchanged** (no chart change per Verified Inputs at HEAD R5).
- Sparkline navigation — **MUST be unchanged**.
- Reviewer drill-down panel — gains the PR list section after the weekly-activity table.

Any visual change on a chart other than the reviewer drill-down panel's PR list section is a regression and MUST block delivery.

## 12. Manager-readability check (SC-009)

Hand `spec.md` (specifically User Story 1) to a non-technical stakeholder. Ask them to summarize, in their own words and in under one minute, what the user sees today and what the user sees after the change.

A successful summary references:

- The reviewer-activity chart and the act of clicking a bar row for a focused reviewer.
- The current behavior (stat row + weekly activity table only).
- The new behavior (a list of actual PR titles, slowest first, click-through to ADO).

If the stakeholder cannot describe it within one minute, User Story 1's framing needs adjustment.

## Done criteria

The feature is verified locally when:

- All P1 / P2 / P3 acceptance scenarios above pass by inspection.
- The accessibility / keyboard verification (§ 6) passes with a screen reader or accessibility inspector.
- The producer-side test suite (`pytest`) passes.
- The consumer test suite (`pnpm test:coverage`) passes.
- The ratchet-bump command reports zero drift on BOTH Python and Extension floors.
- `python scripts/run_pr_preflight.py` returns exit 0 with no degradation flag.
- The implementation commit message includes the SC-014 byte-budget before/after report.
- A non-technical stakeholder reads User Story 1 and summarizes the change in under one minute.

At that point the feature is ready for the standard review cycle (Codex stop-hook + CI on PR).
