# Quickstart: Dashboard per-repo comment density breakdown

**Feature**: 335-comments-repo-density
**Phase**: 1 (verification steps)
**Created**: 2026-04-28

This quickstart documents the concrete verification steps for the per-repo comments-density breakdown feature. Each step maps to a User Story / Functional Requirement / Success Criterion in [spec.md](./spec.md).

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

## §2 Producer unit tests (FR-1-* — pinned at `tests/unit/test_aggregators_repo_comments.py`)

Run the feature's unit-test set:

```bash
python scripts/run_pytest.py tests/unit/test_aggregators_repo_comments.py -v
```

Expected: all FR-1-* cases (i)–(vii) pass:

- (i) all-extracted week → all entries have `coverage_partial=false`, full sums
- (ii) mixed-extraction repo → that repo's entry has `coverage_partial=true`, sums equal extracted-subset only
- (iii) all-unextracted repo → that repo's entry has `coverage_partial=true`, all numeric=0 (bucket still emitted with atomic 4-field shape)
- (iv) capability-off → `by_repository_comments` key absent from emitted rollup
- (v) atomicity (FR-1-07) → entries have all 4 fields or are absent (no partial)
- (vi) ordering (FR-1-08) → `active_thread_count <= thread_count` per entry
- (vii) full extracted-subset scope (FR-1-09) → emission covers W's full canonical PR set, not the drill-down slice

NOT included: sentinel collision-safety test (334 T029 equivalent) — explicitly omitted per CL-03.

## §3 Schema validator tests (FR-1-07 / INV-3-08 / INV-3-07)

Run the extension schema test:

```bash
cd extension
pnpm test -- --testPathPattern='schema/rollup\.test'
cd ..
```

Expected: existing 333 / 334 tests still pass, new tests pass:

- Valid 4-field entry passes.
- Partial entry (missing one field) → atomicity error (STRICT in BOTH modes).
- Null-valued numeric fields fail.
- Capability-off (key absent) passes.
- `active_thread_count > thread_count` per entry → ordering error (INV-3-07).
- Empty `{}` outer dict fails (FR-1-10 — key MUST be omitted entirely when no buckets).

## §4 Chart unit tests (FR-4-* — pinned at `extension/tests/modules/charts/comments-repository-density.test.ts`)

```bash
cd extension
pnpm test -- --testPathPattern='modules/charts/comments-repository-density'
cd ..
```

Expected: all FR-4-* cases pass:

- FR-4-01 row rendering with repository display label + 3 metrics.
- FR-4-02 range-total reduction (per-repo summing across visible weeks; zero rows suppressed).
- FR-4-03 partial-coverage qualifier per row when reduced `coverage_partial = true`.
- FR-4-05 sort selector toggles among 3 metrics, default `comment_count` desc, deterministic tiebreak by `repository_name` asc → `repository_id` asc.
- FR-4-06 truncation indicator when repositories > 50 (noun "repositories").
- FR-4-07 filter-not-supported empty state when ANY dimension filter is active.
- FR-4-08 no-data-in-range empty state when capability-on but no extracted-subset contributions in range.
- FR-4-09 no click-through (rows are not styled clickable).
- FR-4-10 a11y — sort selector keyboard-activatable, screen-reader-readable text.
- FR-4-11 raw-`repository_id` fallback when `repositoriesDimension` entry missing for the bucket key.

## §5 Dashboard lifecycle tests (FR-3-02 — pinned at `extension/tests/dashboard/comments-repository-density-lifecycle.test.ts`)

```bash
cd extension
pnpm test -- --testPathPattern='dashboard/comments-repository-density-lifecycle'
cd ..
```

Expected: 4 lifecycle scenarios pass:

- (a) Initial capability-off → no row in DOM, layout pristine, byte-identical to pre-feature baseline.
- (b) On→off transition → row removed cleanly via `removeCommentsRepositoryDensityContainer`.
- (c) Off→on transition → row inserted exactly once via `ensureCommentsRepositoryDensityContainer`, positioned BELOW the per-author row (anchor `[data-comments-author-density-row="true"]`).
- (d) On→on re-render idempotency → no duplicate row from second render.

## §6 F3 live-loader regression (FR-3-04 — pinned at `extension/tests/artifact-client.test.ts`)

```bash
cd extension
pnpm test -- --testPathPattern='artifact-client'
cd ..
```

Expected: the new regression test asserts `AuthenticatedDatasetLoader.getCapabilityState()?.commentsMetricsAvailable === true` on a dataset variant containing the `by_repository_comments` key — paralleling the by_author_comments regression added for #334 in PR #349. Guards against another #347-style live-loader gate regression on the new chart's capability path.

## §7 Cross-feature reconciliation + cross-aggregate sum-coherence (FR-2-01 / FR-2-02 / FR-2-03 — extended in-place per CL-05)

```bash
python scripts/run_pytest.py tests/integration/test_comments_trend_reconciliation.py -v
python scripts/run_pytest.py tests/integration/test_comments_trend_reconciliation_isolation.py -v
python scripts/run_pytest.py tests/integration/test_comments_trend_meta_failure.py -v
```

Expected:

- Reconciliation test: per-PR pairwise C1 coherence + per-(week, repo) end-to-end aggregator correctness via independent re-computation + cross-aggregate sum-coherence (sum_repo by_repository_comments == comments per-week, OR_repo coverage_partial == comments.coverage_partial) all pass on the demo dataset, including on the truncated W26 witness.
- Isolation test: AST-walk over the reconciliation test's transitive imports asserts `src.ado_git_repo_insights.transform.aggregators` is NOT in the import set (333 round-9 isolation extends automatically — file-level constraint).
- Meta-test: TWO synthetic injections (per-repo INV-3-07 violation + per-week sum-coherence violation) injected into a `tmp_path` manifest copy → reconciliation test FAILS on the mutated copy → meta-test PASSES (proves FR-2-04 + FR-2-03 are real, not silently passive).

## §8 Capability-off byte-identity (FR-3-03 — extended in-place at `tests/integration/test_demo_variants_byte_identity.py`)

```bash
python scripts/run_pytest.py tests/integration/test_demo_variants_byte_identity.py -v
```

Expected: 4 omission failure modes for the `by_repository_comments` key gated individually:

- key NOT present (capability-off variant should always satisfy this).
- key NOT `null`-valued (regression guard).
- key NOT `{}`-valued (regression guard).
- key NOT partial-fielded (regression guard).

## §9 Canonical artifact sync + demo dataset rebuild

```bash
python scripts/manage_generated_artifacts.py sync --scope all --stage
uv run --python 3.12 python scripts/build-demo-dataset.py
python scripts/manage_generated_artifacts.py verify
```

The canonical sync rebuilds and stages every managed output the change touches (UI bundle, broken-docs fixtures, etc.). The build-demo-dataset.py run refreshes `docs/data/` with the new `by_repository_comments` namespace (per memory `feedback_managed_artifacts_excludes_demo_data.md` — `manage_generated_artifacts.py` does NOT cover `docs/data/`). The `verify` step confirms the working tree is clean against the index post-stage.

## §10 Visual / UX smoke test (US1 / US2 / US3 / US4)

Open the dashboard against the capability-on demo (per project's local-dev procedure).

**US1 acceptance — first-glance comprehension**:

- Confirm the per-repo breakdown chart renders BELOW the 334 per-author breakdown on the Metrics tab (anchored on `[data-comments-author-density-row="true"]` per CL-10).
- Confirm rows are ordered by `comment_count` desc.
- Confirm date-range filter narrows the visible rows.
- Confirm rows show repository display label (`repository_name` from dimension; raw `repository_id` fallback when missing) + 3 numeric metrics; rows with `coverage_partial = true` carry the partial-coverage qualifier (hatched + dimmed via shared `.coverage-partial` CSS class hook).

**US2 acceptance — sort toggle**:

- Confirm the sort selector renders as a WAI-ARIA Toolbar with 3 buttons.
- Confirm activating each metric re-orders rows; active metric is visually indicated via `aria-pressed`.
- Confirm tiebreak is by `repository_name` asc, then `repository_id` asc as the final tie-breaker (reproducible across reloads, including duplicate-display-name rows from rename or fallback).

**US3 acceptance — capability-off byte-identity**:

- Switch to the capability-off demo variant.
- Confirm no per-repo breakdown surface; existing surfaces (333 chart absent too, 334 per-author absent too, throughput / cycle-time / reviewer-activity / summary-cards) at pre-feature positions.

**US4 acceptance — filter-not-supported posture**:

- Apply any dashboard dimension filter (`repos` / `teams` / `authors` / `reviewers`).
- Confirm the breakdown body shows a filter-not-supported empty state distinct from no-data-in-range.
- Confirm the `repos` filter triggers the empty state (intentional — narrowing to a single repository hides the multi-repo comparison surface per spec).
- Clear the filter; confirm rows reappear.

## §11 Pre-push gate

```bash
python scripts/run_repo_hook.py pre-push
```

Expected: full chain (version-guard → preflight → tests → ratchet bump → security scan) passes. Per memory `feedback_preflight_for_triage_not_pre_push.md`, reserve pre-push for the final cohesive check; use targeted gates above for triage during development.

## §12 Coverage + ratchet bump check

```bash
python scripts/check_coverage_delta.py
python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml
```

Expected:

- Coverage delta ≤ 2% per QG-52.
- Ratchet bump: floor == actual on both Python and Extension; per-commit floor delta matches per-commit test count delta (QG-43).

## §13 Stop point

This quickstart covers Phase 1 verification only. Phase 2 (`/speckit.tasks`) generates the implementation task graph; Phase 3 executes it. Both are out of scope for this document.

## References

- [spec.md](./spec.md) — feature specification (all 10 CL-axes locked)
- [plan.md](./plan.md) — implementation plan
- [research.md](./research.md) — Phase 0 ADRs and decisions
- [data-model.md](./data-model.md) — entity definitions
- [contracts/per-repo-comments-density.md](./contracts/per-repo-comments-density.md) — field shape contract + producer/consumer behavior + cross-aggregate sum-coherence
- [checklists/requirements.md](./checklists/requirements.md) — spec quality checklist (PASS, all axes locked)
- `specs/333-comments-trend-chart/quickstart.md` — pattern reference
- `specs/334-comments-author-density/quickstart.md` — sibling pattern reference (per-author dimension; this feature mirrors it without the sentinel acceptance scenarios)
