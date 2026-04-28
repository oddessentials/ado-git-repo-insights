# Quickstart: Dashboard per-author comment density breakdown

**Feature**: 334-comments-author-density
**Phase**: 1 (verification steps)
**Created**: 2026-04-27

This quickstart documents the concrete verification steps for the per-author comments-density breakdown feature. Each step maps to a User Story / Functional Requirement / Success Criterion in [spec.md](./spec.md).

---

## §1 Local setup

```bash
# Python 3.12 via uv (per project memory: feedback_uv_for_python_versions.md)
uv venv --python 3.12
source .venv/Scripts/activate            # Windows Git Bash
# or: source .venv/bin/activate          # Linux / macOS
pip install -e .[dev]

# Extension dependencies
cd extension && pnpm install && cd ..
```

Confirm:

```bash
python --version    # 3.12.x
pnpm --version      # any recent version
```

## §2 Producer unit tests (FR-1-* — pinned at `tests/unit/test_aggregators_author_comments.py`)

Run the feature's unit-test set:

```bash
python scripts/run_pytest.py tests/unit/test_aggregators_author_comments.py -v
```

Expected: all FR-1-* cases (i)–(vii) pass:

- (i) all-extracted week → all entries have `coverage_partial=false`, full sums
- (ii) mixed-extraction author → that author's entry has `coverage_partial=true`, sums equal extracted-subset only
- (iii) all-unextracted author → that author's entry has `coverage_partial=true`, all numeric=0
- (iv) capability-off → `by_author_comments` key absent from emitted rollup
- (v) sentinel bucketing → unknown-to-`users` authors collapse into one entry keyed by `__former_or_unavailable_author__`
- (vi) atomicity (FR-1-07) → entries have all 4 fields or are absent (no partial)
- (vii) ordering (FR-1-08) → `active_thread_count <= thread_count` per entry, including sentinel

## §3 Schema validator tests (FR-1-07 / INV-2-08 / INV-2-07)

Run the extension schema test:

```bash
cd extension
pnpm test -- --testPathPattern='schema/rollup\.test'
cd ..
```

Expected: existing 333 tests still pass, new tests pass:

- Valid 4-field entry passes.
- Partial entry (missing one field) → atomicity error (STRICT in BOTH modes per ADR T003).
- Null-valued numeric fields fail.
- Capability-off (key absent) passes.
- `active_thread_count > thread_count` per entry → ordering error (INV-2-07).
- Sentinel literal (`__former_or_unavailable_author__`) as key permitted.

## §4 Chart unit tests (FR-4-* — pinned at `extension/tests/modules/charts/comments-author-density.test.ts`)

```bash
cd extension
pnpm test -- --testPathPattern='modules/charts/comments-author-density'
cd ..
```

Expected: all FR-4-* cases pass:

- FR-4-01 row rendering with author display name + 3 metrics (+ sentinel label when applicable).
- FR-4-02 range-total reduction (per-author summing across visible weeks).
- FR-4-03 partial-coverage qualifier per row when reduced `coverage_partial = true`.
- FR-4-05 sort selector toggles among 3 metrics, default `comment_count` desc, deterministic tiebreak by display name.
- FR-4-06 truncation indicator when authors > 50.
- FR-4-07 filter-not-supported empty state when ANY dimension filter is active.
- FR-4-08 no-data-in-range empty state when capability-on but no extracted-subset contributions in range.
- FR-4-09 no click-through (rows are not styled clickable).
- FR-4-10 a11y — sort selector keyboard-activatable, screen-reader-readable text.

## §5 Dashboard lifecycle tests (FR-3-02 — pinned at `extension/tests/dashboard/comments-author-density-lifecycle.test.ts`)

```bash
cd extension
pnpm test -- --testPathPattern='dashboard/comments-author-density-lifecycle'
cd ..
```

Expected: 4 lifecycle scenarios pass:

- (a) Initial capability-off → no row in DOM, layout pristine, byte-identical to pre-feature baseline.
- (b) On→off transition (round-12 cleanup) → row removed cleanly via `removeCommentsAuthorDensityContainer`.
- (c) Off→on transition → row inserted exactly once via `ensureCommentsAuthorDensityContainer`.
- (d) On→on re-render idempotency → no duplicate row from second render (333 round-12 / round-13 idempotency parity).

## §6 Cross-feature reconciliation (FR-2-01 / FR-2-02 / FR-2-03 — extended in-place per CL-04)

```bash
python scripts/run_pytest.py tests/integration/test_comments_trend_reconciliation.py -v
python scripts/run_pytest.py tests/integration/test_comments_trend_reconciliation_isolation.py -v
python scripts/run_pytest.py tests/integration/test_comments_trend_meta_failure.py -v
```

Expected:

- Reconciliation test: per-PR pairwise C1 coherence + per-(week, author) end-to-end aggregator correctness via independent re-computation + sentinel parity all pass on the demo dataset.
- Isolation test: AST-walk over the reconciliation test's transitive imports asserts `src.ado_git_repo_insights.transform.aggregators` is NOT in the import set (333 round-9 isolation extends automatically — file-level constraint).
- Meta-test: synthetic per-author INV-2-07 violation (e.g., sentinel bucket with `active_thread_count > thread_count`) injected into a `tmp_path` manifest copy → reconciliation test FAILS on the mutated copy → meta-test PASSES (proves FR-2-04 is real, not silently passive).

## §7 Capability-off byte-identity (FR-3-03 — extended in-place at `tests/integration/test_demo_variants_byte_identity.py`)

```bash
python scripts/run_pytest.py tests/integration/test_demo_variants_byte_identity.py -v
```

Expected: 4 omission failure modes for the `by_author_comments` key gated individually:

- key NOT present (capability-off variant should always satisfy this).
- key NOT `null`-valued (regression guard).
- key NOT `{}`-valued (regression guard).
- key NOT partial-fielded (regression guard — applies to entries inside the dict, but the byte-identity gate is at the rollup-key level).

## §8 Canonical artifact sync (every managed output)

```bash
python scripts/manage_generated_artifacts.py sync --scope all --stage
python scripts/manage_generated_artifacts.py verify
```

The canonical sync rebuilds and stages **every managed output the change touches**, not just the demo dataset. For this feature that includes (do NOT enumerate manually; trust `sync --scope all`):

- `extension/ui/dist/` — esbuild bundles, rebuilt because the new chart module changes the UI bundle.
- `docs/data/aggregates/weekly_rollups/*.json` — rollup JSONs gain the `by_author_comments` namespace under capability-on.
- `docs/data/dataset-manifest.json` — manifest carries `capabilities.comments_metrics: true` for the capability-on variant.
- Any sibling managed paths the canonical sync drives.

The `verify` step confirms the working tree is clean against the index post-stage; if any managed path is unstaged or stale, the verify step fails. **Tasks MUST run the canonical sync + verify** rather than touching `docs/data/` (or any other managed output) directly.

## §9 Visual / UX smoke test (US1 / US2 / US3 / US4 / US5)

Open the dashboard against the capability-on demo (per project's local-dev procedure — pinned in plan/tasks).

**US1 acceptance — first-glance comprehension**:
- Confirm the per-author breakdown chart renders BELOW the 333 comments-trend chart on the Metrics tab.
- Confirm rows are ordered by `comment_count` desc.
- Confirm date-range filter narrows the visible rows.
- Confirm rows show author display name + 3 numeric metrics; rows with `coverage_partial = true` carry the partial-coverage qualifier (hatched + dimmed per ADR T004).

**US2 acceptance — sort toggle**:
- Confirm the sort selector renders as a button group with 3 options.
- Confirm activating each metric re-orders rows; active metric is visually indicated.
- Confirm tiebreak is by author display name asc, then author key asc as the final tie-breaker (reproducible across reloads, including duplicate-display-name authors and sentinel/real-name collisions).

**US3 acceptance — capability-off byte-identity**:
- Switch to the capability-off demo variant.
- Confirm no per-author breakdown surface; existing surfaces (333 chart absent too, throughput / cycle-time / reviewer-activity / summary-cards) at pre-feature positions.

**US4 acceptance — sentinel rendering**:
- Confirm exactly ONE row labeled "Former / unavailable author" when the dataset has unknown-to-`users` authors with PR activity in the visible range.
- Confirm the sentinel row participates in sort by metric value (NOT pinned to top/bottom).

**US5 acceptance — filter-not-supported posture**:
- Apply any dashboard dimension filter (`repos` / `teams` / `authors` / `reviewers`).
- Confirm the breakdown body shows a filter-not-supported empty state distinct from no-data-in-range.
- Clear the filter; confirm rows reappear.

## §10 Pre-push gate

```bash
python scripts/run_repo_hook.py pre-push
```

Expected: full chain (version-guard → preflight → tests → ratchet bump → security scan) passes. **Note**: per project memory `feedback_preflight_for_triage_not_pre_push.md`, reserve pre-push for the final cohesive check; use targeted gates above for triage during development.

## §11 Coverage + ratchet bump check

```bash
python scripts/check_coverage_delta.py
python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml
```

Expected:

- Coverage delta ≤ 2% per QG-52.
- Ratchet bump: floor == actual on both Python and Extension; per-commit floor delta matches per-commit test count delta (QG-43).

## §12 Stop point

This quickstart covers Phase 1 verification only. Phase 2 (`/speckit.tasks`) generates the implementation task graph; Phase 3 (`/speckit.implement`) executes it. Both are out of scope for this document.

## References

- [spec.md](./spec.md) — feature specification (all 8 CL-axes locked)
- [plan.md](./plan.md) — implementation plan
- [research.md](./research.md) — Phase 0 ADRs and decisions
- [data-model.md](./data-model.md) — entity definitions
- [contracts/per-author-comments-density.md](./contracts/per-author-comments-density.md) — field shape contract + producer/consumer behavior
- [checklists/requirements.md](./checklists/requirements.md) — spec quality checklist (PASS, all axes locked)
- `specs/333-comments-trend-chart/quickstart.md` — pattern reference for verification steps
