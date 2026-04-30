# Quickstart: Dashboard per-reviewer comment density breakdown

**Feature**: 336-comments-reviewer-density
**Phase**: 1 (verification steps)
**Created**: 2026-04-29

This quickstart documents the concrete verification steps for the per-reviewer comments-density breakdown feature. Each step maps to a User Story / Functional Requirement / Success Criterion in [spec.md](./spec.md).

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

## §2 Demo synthetic stream coherence guard (FIRST test in Phase 2 per ADR R005)

Before any other Phase 2 work, verify the demo's new synthetic streams round-trip through re-aggregation:

```bash
python scripts/run_pytest.py tests/unit/test_demo_synthetic_pr_comments.py -v
```

Expected: coherence guard passes:

- For every PR P in the synthetic dataset, `len(synthetic_pr_threads for P) == P.thread_count`.
- For every PR P, `len(synthetic_pr_threads for P with status='active') == P.active_thread_count`.
- For every PR P, `len(synthetic_pr_comments for P) == P.comment_count`.
- Every thread in `synthetic_pr_threads` has ≥1 comment in `synthetic_pr_comments` (no orphan threads).
- Every commenter `author_id` ≠ corresponding PR's `author_id` (self-comment exclusion at synthesis time).
- ≥1 demo week includes synthetic ghost commenters (UUIDs absent from seeded `users`).
- Every emitted commenter `author_id` matches UUID format (32 hex chars + 4 hyphens).

Per ADR R005 / kickoff lesson "demo key-shape verification — do this FIRST", this test MUST pass before T011 (production aggregator helper) is written. A failure here blocks subsequent tasks.

## §3 Producer unit tests (FR-1-* — pinned at `tests/unit/test_aggregators_reviewer_comments.py`)

Run the feature's unit-test set:

```bash
python scripts/run_pytest.py tests/unit/test_aggregators_reviewer_comments.py -v
```

Expected: all FR-1-* cases (i)–(xiv) pass:

- (i) all-extracted week, no self-comments → all entries `coverage_partial=false`, sums correct
- (ii) mixed-extraction week → all entries `coverage_partial=true` (same-W flag per CL-10)
- (iii) all-unextracted week → no buckets emitted (key omitted per FR-1-11)
- (iv) capability-off → no `by_reviewer_comments` key emitted
- (v) atomicity (FR-1-08) → entries have all 4 fields or are absent
- (vi) ordering (FR-1-09) → `active_thread_count <= thread_count` per entry
- (vii) full extracted-subset scope (FR-1-10) → emission covers W's full canonical PR set, not the drill-down slice
- (viii) self-comment exclusion (FR-1-04) → PR author commenting on own PR does NOT appear in `by_reviewer_comments`
- (ix) thread_count COUNT(DISTINCT) semantics (FR-1-05) → reviewer with 5 comments across 2 threads has thread_count=2 (NOT 5)
- (x) active_thread_count subset semantics (FR-1-05) → only threads with status='active' contribute
- (xi) sentinel bucketing (FR-1-03) → `pr_comments.author_id` absent from `users` → sentinel literal as bucket key
- (xii) FAIL-LOUD on shape corruption (FR-1-12) → RuntimeError on NULL `pr_comments.author_id`
- (xiii) FAIL-LOUD on shape corruption (FR-1-12) → RuntimeError on non-UUID `pr_comments.author_id`
- (xiv) determinism — outer dict key order ascending by commenter key

## §4 Sentinel collision-safety extension (T029 widened)

Run the existing #334 collision-safety scan (which has been EXTENDED in-place per kickoff directive, NOT duplicated):

```bash
python scripts/run_pytest.py tests/unit/test_aggregators_author_comments.py::test_sentinel_literal_does_not_collide_with_real_author_ids -v
```

Expected: the widened assertion list passes — the SENTINEL literal `__former_or_unavailable_author__` does not collide with ANY real `users.user_id` value (existing #334 assertion) AND does not collide with ANY real `pr_comments.author_id` value (NEW for #336).

## §5 Schema validator tests (FR-1-08 / INV-4-08 / INV-4-07)

Run the extension schema test:

```bash
cd extension
pnpm test -- --testPathPattern='schema/rollup\.test'
cd ..
```

Expected: existing 333 / 334 / 335 tests still pass, new tests pass:

- Valid 4-field entry passes.
- Partial entry (missing one field) → atomicity error (STRICT in BOTH modes).
- Null-valued numeric fields fail.
- Capability-off (key absent) passes.
- `active_thread_count > thread_count` per entry → ordering error (INV-4-07).
- Empty `{}` outer dict fails (FR-1-11 — key MUST be omitted entirely when no buckets).
- Entry with `__former_or_unavailable_author__` as key passes.

## §6 Chart unit tests (FR-4-* — pinned at `extension/tests/modules/charts/comments-reviewer-density.test.ts`)

```bash
cd extension
pnpm test -- --testPathPattern='modules/charts/comments-reviewer-density'
cd ..
```

Expected: all FR-4-* cases pass:

- FR-4-01 row rendering with reviewer display label + 3 metrics.
- FR-4-02 range-total reduction (per-reviewer summing across visible weeks; **all-zero rows filtered BEFORE sort/truncate** per kickoff lesson).
- FR-4-03 partial-coverage qualifier per row when reduced `coverage_partial = true`; tooltip text emphasizes **week-level** uncertainty per CL-10 directive.
- FR-4-05 sort selector toggles among 3 metrics, default `comment_count` desc, deterministic tiebreak by display name asc → bucket key asc.
- FR-4-06 truncation indicator when reviewers > 50 (noun "reviewers").
- FR-4-07 filter-not-supported empty state when ANY dimension filter is active.
- FR-4-08 no-data-in-range empty state when capability-on but no eligible-reviewer-comment contributions in range.
- FR-4-09 no click-through (rows are not styled clickable).
- FR-4-10 a11y — sort selector keyboard-activatable, screen-reader-readable text.
- FR-4-11 raw-`user_id` fallback when `usersDimension` entry missing for the bucket key.
- FR-4-12 sentinel rendering — fixed-string label "Former / unavailable author" regardless of dimension contents.
- Non-vacuous sort fixture per A-15 — three distinct orderings; `expect(afterSpace).not.toEqual(afterEnter)` catches vacuous-pass.
- Exhaustive empty-state markers per A-14 — separate `.no-data` and `.no-data-hint` queries; per-state unique markers as named constants; cross-state exclusion proven.

## §7 Dashboard lifecycle tests (FR-3-02 — pinned at `extension/tests/dashboard/comments-reviewer-density-lifecycle.test.ts`)

```bash
cd extension
pnpm test -- --testPathPattern='dashboard/comments-reviewer-density-lifecycle'
cd ..
```

Expected: 4 lifecycle scenarios pass + source-parse binding:

- (a) Initial capability-off → no row in DOM, layout pristine, byte-identical to pre-feature baseline.
- (b) On→off transition → row removed cleanly via `removeCommentsReviewerDensityContainer`.
- (c) Off→on transition → row inserted exactly once via `ensureCommentsReviewerDensityContainer`, positioned BELOW the per-repo row (anchor `[data-comments-repository-density-row="true"]`).
- (d) On→on re-render idempotency → no duplicate row from second render.
- Source-parse binding per A-13 — `dashboardSrc.indexOf` + `expect.toContain` assert the `ensureCommentsReviewerDensityContainer` / `removeCommentsReviewerDensityContainer` call sites are present in `dashboard.ts`.

## §8 F3 live-loader regression (FR-3-04 — pinned at `extension/tests/artifact-client.test.ts`)

```bash
cd extension
pnpm test -- --testPathPattern='artifact-client'
cd ..
```

Expected: the new regression test asserts `AuthenticatedDatasetLoader.getCapabilityState()?.commentsMetricsAvailable === true` on a dataset variant containing the `by_reviewer_comments` key — paralleling the regressions added for #334 in PR #349 and #335 in PR #350. Guards against another #347-style live-loader gate regression on the new chart's capability path.

## §9 Cross-feature reconciliation + cross-aggregate parity (FR-2-01 / FR-2-02 / FR-2-03 — extended in-place per CL-06)

```bash
python scripts/run_pytest.py tests/integration/test_comments_trend_reconciliation.py -v
python scripts/run_pytest.py tests/integration/test_comments_trend_reconciliation_isolation.py -v
python scripts/run_pytest.py tests/integration/test_comments_trend_meta_failure.py -v
```

Expected:

- Reconciliation test: per-PR multi-bucket coherence (FR-2-01) + per-(week, reviewer) end-to-end aggregator correctness via independent re-computation (FR-2-02) + cross-aggregate parity-vs-INDEPENDENT-count (FR-2-03 — `SUM_R(comment_count)` EQUALS independent count of eligible-reviewer-comments; `OR_R(coverage_partial)` EQUALS `comments.coverage_partial`) all pass on the demo dataset, including on the truncated W26 witness.
- Isolation test: AST-walk over the reconciliation test's transitive imports asserts `src.ado_git_repo_insights.transform.aggregators` is NOT in the import set (333 round-9 isolation extends automatically — file-level constraint).
- Meta-test: THREE synthetic injections (per-reviewer INV-4-07 violation + per-week sum-coherence violation + self-comment-leak violation) injected into a `tmp_path` manifest copy → reconciliation test FAILS on each mutated copy → meta-test PASSES (proves FR-2-04 + FR-2-03 + CL-04 self-comment exclusion are real, not silently passive).

## §10 Capability-off byte-identity (FR-3-03 — extended in-place at `tests/integration/test_demo_variants_byte_identity.py`)

```bash
python scripts/run_pytest.py tests/integration/test_demo_variants_byte_identity.py -v
```

Expected: 4 omission failure modes for the `by_reviewer_comments` key gated individually:

- key NOT present (capability-off variant should always satisfy this).
- key NOT `null`-valued (regression guard).
- key NOT `{}`-valued (regression guard).
- key NOT partial-fielded (regression guard).

## §11 Canonical artifact sync + demo dataset rebuild

```bash
python scripts/manage_generated_artifacts.py sync --scope all --stage
uv run --python 3.12 python scripts/build-demo-dataset.py
python scripts/manage_generated_artifacts.py verify
```

The canonical sync rebuilds and stages every managed output the change touches (UI bundle, broken-docs fixtures, etc.). The build-demo-dataset.py run refreshes `docs/data/` with the new `by_reviewer_comments` namespace (per memory `feedback_managed_artifacts_excludes_demo_data.md` — `manage_generated_artifacts.py` does NOT cover `docs/data/`). The `verify` step confirms the working tree is clean against the index post-stage.

## §12 Visual / UX smoke test (US1 / US2 / US3 / US4 / US5)

Open the dashboard against the capability-on demo (per project's local-dev procedure).

**US1 acceptance — first-glance comprehension**:

- Confirm the per-reviewer breakdown chart renders BELOW the 335 per-repo breakdown on the Metrics tab (anchored on `[data-comments-repository-density-row="true"]` per CL-11).
- Confirm rows are ordered by `comment_count` desc.
- Confirm date-range filter narrows the visible rows.
- Confirm rows show reviewer display label (`display_name` from dimension; raw `user_id` fallback when missing; sentinel branch overrides for the SENTINEL literal) + 3 numeric metrics; rows with `coverage_partial = true` carry the partial-coverage qualifier (hatched + dimmed via shared `.coverage-partial` CSS class hook) with **week-level** tooltip text.

**US2 acceptance — sort toggle**:

- Confirm the sort selector renders as a WAI-ARIA Toolbar with 3 buttons.
- Confirm activating each metric re-orders rows; active metric is visually indicated via `aria-pressed`.
- Confirm tiebreak is by display name asc, then bucket key asc as the final tie-breaker (reproducible across reloads, including duplicate-display-name rows from rename / fallback / sentinel-collision).
- Confirm the fixture produces three DISTINCT orderings under the three sort metrics (non-vacuous per A-15).

**US3 acceptance — capability-off byte-identity**:

- Switch to the capability-off demo variant.
- Confirm no per-reviewer breakdown surface; existing surfaces (333 chart absent too, 334 per-author absent too, 335 per-repo absent too, throughput / cycle-time / reviewer-activity / summary-cards) at pre-feature positions.

**US4 acceptance — sentinel rendering**:

- Confirm at least one demo week has synthetic ghost commenters (per CL-14 step 4).
- Confirm exactly ONE row labeled "Former / unavailable author" appears, aggregating ALL ghost-commenter contributions.
- Confirm activating each sort metric — the sentinel row participates in the new sort order using its summed metric value (NOT pinned to top or bottom).
- Confirm narrowing the date range to weeks without ghost commenters — the sentinel row disappears.

**US5 acceptance — filter-not-supported posture**:

- Apply any dashboard dimension filter (`repos` / `teams` / `authors` / `reviewers`).
- Confirm the breakdown body shows a filter-not-supported empty state distinct from no-data-in-range.
- Confirm the `reviewers` filter triggers the empty state (intentional — narrowing to a single reviewer hides the multi-reviewer comparison surface per spec).
- Clear the filter; confirm rows reappear.

## §13 Pre-push gate

```bash
python scripts/run_repo_hook.py pre-push
```

Expected: full chain (version-guard → preflight → tests → ratchet bump → security scan) passes. Per memory `feedback_preflight_for_triage_not_pre_push.md`, reserve pre-push for the final cohesive check; use targeted gates above for triage during development.

## §14 Coverage + ratchet bump check

```bash
python scripts/check_coverage_delta.py
python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml
pnpm --dir extension run test:partial-branches
```

Expected:

- Coverage delta ≤ 2% per QG-52.
- Ratchet bump: floor == actual on both Python and Extension; per-commit floor delta matches per-commit test count delta (QG-43).
- Partial-branches ratchet zero growth (memory `.coverage-partial-branches-baseline.json`); the tie-break-ternary collapse applied in the chart module (mirroring 334 / 335) keeps the ratchet at zero.

The partial-branches command MUST be invoked with the **outside form** (`pnpm --dir extension run test:partial-branches`) per kickoff lesson — NOT the inside form (`pnpm run test:partial-branches`) which fails when invoked from outside `extension/`.

## §15 Stop point

This quickstart covers Phase 1 verification only. Phase 2 (`/speckit.tasks`) generates the implementation task graph; Phase 3 executes it. Both are out of scope for this document.

## References

- [spec.md](./spec.md) — feature specification (all 15 CL-axes locked)
- [plan.md](./plan.md) — implementation plan
- [research.md](./research.md) — Phase 0 ADRs and decisions
- [data-model.md](./data-model.md) — entity definitions
- [contracts/per-reviewer-comments-density.md](./contracts/per-reviewer-comments-density.md) — field shape contract + producer/consumer behavior + cross-aggregate parity-vs-INDEPENDENT-count
- [checklists/requirements.md](./checklists/requirements.md) — spec quality checklist (PASS, all axes locked)
- `specs/333-comments-trend-chart/quickstart.md` — pattern reference
- `specs/334-comments-author-density/quickstart.md` — sibling pattern reference (per-author dimension; this feature mirrors it for the sentinel branch)
- `specs/335-comments-repo-density/quickstart.md` — sibling pattern reference (per-repo dimension; this feature mirrors it for the all-zero filter + week-agnostic truncation discovery)
