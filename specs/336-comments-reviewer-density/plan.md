# Implementation Plan: Dashboard per-reviewer comment density breakdown

**Branch**: `feat/336-comments-reviewer-density` | **Date**: 2026-04-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/336-comments-reviewer-density/spec.md` (all 15 CL-axes locked 2026-04-29 by user directive — Path B; zero `[NEEDS CLARIFICATION]` markers; zero branch-aware alternatives in executable requirements)
**Issue**: #336 (split from #322 — Capability 2, reviewer dimension; third of three sibling Cap-2 dimension PRs after #334 author and #335 repo; sibling #321 team is on-hold)

## Summary

Add a per-reviewer comments-density breakdown surface to the dashboard's Metrics tab, gated on `capabilities.comments_metrics`. Backed by a new `rollup[W].by_reviewer_comments[<commenter_id>]` per-week outer dict that the aggregator emits when capability-on. The breakdown reduces per-(week, reviewer) emissions to a range-total per row over the user-selected date range, sorts by chosen metric (default `comment_count`), caps at 50 rows, and surfaces a partial-coverage qualifier per row when the row's reduced `coverage_partial` is `true`. Display label resolves to `users.display_name` from the `users` dimension with raw `user_id` fallback; sentinel branch (CL-03) takes precedence and renders as fixed string "Former / unavailable author" (reuse 334's literal verbatim per cross-feature consistency).

This is the third sibling Cap-2 dimension PR; #334 (per-author) shipped on PR #349 and #335 (per-repo) shipped on PR #350. The visual + interaction pattern is duplicated from 334/335 (closer to 334 for the sentinel branch presence; closer to 335 for the all-zero-row filter and FK-protected display-label pattern). **Substantive aggregator divergence**: this feature iterates `pr_comments` rows (not `pull_requests` rows like 334/335), grouped by commenter `author_id` with self-comment exclusion (commenter ≠ PR author per CL-04). The new FR-2-03 cross-aggregate parity contract is reviewer-specific in shape — `SUM_R(by_reviewer_comments[R].comment_count)` is asserted against an INDEPENDENT count of eligible-reviewer-comments (NOT against `comments.comment_count`, which would over-count by the self-comment delta). `thread_count` / `active_thread_count` sum-coherence is NOT asserted at FR-2-03 level (multi-counting metrics; covered by per-bucket FR-2-02 only). The cross-aggregate parity is closed by extending 333's `tests/integration/test_comments_trend_reconciliation.py` in-place per CL-06.

**Demo generator addition** (per CL-14): the demo path currently has NO synthetic `pr_comments` stream — only PR-level aggregate counts. This feature ADDS internal `synthetic_pr_threads` + `synthetic_pr_comments` parallel lists per week (NOT serialized; consumed only by the new demo aggregator helper). A coherence guard test asserts re-aggregating the synthetic streams yields each PR's pre-existing PrRecord aggregate counts. Ghost-commenter inclusion (≥1 demo week with synthetic UUIDs absent from seeded `users`) exercises the per-reviewer sentinel reconciliation branch non-vacuously.

**Pattern-extraction posture** (per A-08): three concrete chart modules will exist after this PR lands (per-author + per-repo + per-reviewer); abstraction extraction (renderer + schema validator + dashboard ensure/remove + lifecycle test) is **deferred to a follow-up feature** so it is informed by all three concrete instances. Aggregator extraction stays NOT recommended (per-author/per-repo iterate `pull_requests`, per-reviewer iterates `pr_comments`; the substantive divergence makes shared aggregator scaffolding more cost than benefit).

## Technical Context

**Language/Version**: Python 3.12+ (backend, aggregator, scripts, tests) and TypeScript 6.0.3 (extension UI). Matches existing baseline per `CLAUDE.md`.

**Primary Dependencies**: existing only — Backend: `argparse`, `sqlite3` via `DatabaseManager`, `pandas` (aggregator group-by), `pytest` + `unittest.mock.MagicMock`. Extension: Jest 30.x + jsdom 28.x test environment, esbuild bundler, VSS SDK runtime. **No new third-party runtime or dev dependencies.**

**Storage**: SQLite via existing `DatabaseManager`. **No schema changes; no migrations.** Reads `pr_comments` (joined with `pull_requests` for self-comment-exclusion + extraction-status), `pr_threads` (for thread status filter), `users` (LEFT JOIN for sentinel detection), `pull_requests.user_id` + `pull_requests.comments_extracted_at` — all present since Feature 058. INV-4-05 (extractor frozen, inherits 310 INV-06 / 333 INV-1-05 / 334 INV-2-05 / 335 INV-3-05) preserved. The aggregator MUST INNER JOIN `pull_requests` (for `pull_requests.user_id` self-comment filter per CL-04) and LEFT JOIN `users` (for sentinel detection per CL-03); both joins are on existing tables with existing indexes (`idx_pr_comments_author` at `models.py:176` for the GROUP BY commenter; `idx_pr_comments_thread` at `models.py:174` for the COUNT(DISTINCT thread_id)).

**Testing**: pytest (Python integration + unit), Jest 30.x (extension). `.test-floor-contract.json` bumped in the same commit as added tests per QG-43. `--max-skips=0` enforced (QG-46). Tests collection-stable per QG-45 / Principle XXVI.

**Target Platform**: Cross-OS (Windows + Linux + macOS) per QG-39. Extension targets Azure DevOps via VSS SDK; dashboard renders in Chromium / Edge browser surface.

**Project Type**: web-service + extension-app (backend Python aggregator + TypeScript extension UI).

**Performance Goals**: New breakdown surface MUST render within QG-28's existing 1000ms / 156-week scalability gate. Top-N=50 row cap (`MAX_COMMENTS_REVIEWER_DENSITY_ROWS`) bounds render cost regardless of dataset reviewer cardinality. Aggregator-side runtime is governed by existing producer test-suite wall-clock budgets (no new single-run wall-clock assertion is added — single-run timings are CI-flake bait per memory `feedback_flake_fix_is_policy_decision.md`). The new helper's SQL uses two existing indexes (`idx_pr_comments_author` for GROUP BY, `idx_pr_comments_thread` for COUNT(DISTINCT thread_id)); no new schema indexes required.

**Constraints**:

- CSV contract frozen (INV-4-04 / 310 INV-05 / 333 INV-1-04 / 334 INV-2-04 / 335 INV-3-04 / Constitution Principle I-IV). No producer-side CSV changes.
- Extractor frozen (INV-4-05 / 310 INV-06 / 333 INV-1-05 / 334 INV-2-05 / 335 INV-3-05). Reads `pr_comments` / `pr_threads` / `users` / `pull_requests` with existing joins.
- 333's per-PR `PrRecord` shape, 334's `by_author_comments` shape, and 335's `by_repository_comments` shape MUST NOT be shadowed; this feature's namespace is `by_reviewer_comments` (separate from `comments`, `by_author`, `by_repository`, `by_reviewer`, `by_author_comments`, `by_repository_comments`).
- Schema-parity gate (`scripts/check_pr_record_schema_parity.py`, Row 38, QG-49) intentionally NOT extended for the rollup-level `by_reviewer_comments` namespace; the FR-2-04 reconciliation test extension is the sole authority for this feature's parity (CL-09 = follow 333 Decision 5 / 334 CL-08 / 335 CL-08).
- `--no-verify` forbidden (QG-38).
- Zero inline suppressions (QG-41) — `# noqa` / `# type: ignore` / `// eslint-disable` are forbidden in new code.
- No `typing.Any` (QG-40).
- Partial-branches ratchet gate (memory: `.coverage-partial-branches-baseline.json`) is NOT permitted to grow. Apply the same tie-break-ternary collapse 334 / 335 used to keep the ratchet at zero, OR cover defensive branches with mutation-based tests.
- Demo synthetic-stream coherence guard (per CL-14 step 3): re-aggregating `synthetic_pr_threads` + `synthetic_pr_comments` per PR P MUST yield P's pre-existing PrRecord aggregate counts; producer test failure if drift detected.

**Scale/Scope**: Demo dataset has ≥10 distinct commenters with mixed comment-load on PRs they didn't author (per A-03), at least one week with mixed extraction exercising the per-row `coverage_partial` qualifier, ≥1 week with synthetic ghost commenters exercising the sentinel reconciliation branch. Top-N display cap inherits the chart-truncation pattern (constant `MAX_COMMENTS_REVIEWER_DENSITY_ROWS = 50`). Aggregator emits one `by_reviewer_comments` outer dict per week for capability-on datasets; per-week payload depends on commenter cardinality (one entry per (week, commenter) tuple under capability-on). Estimated payload increase per rollup file: ~100 bytes × commenter cardinality.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Applies | How this PR honors it |
|---|---|---|
| **QG-01..04 CSV Contract** | indirect | INV-4-04 frozen — no CSV changes. PASSED by non-touch. |
| **QG-05 Golden output determinism** | yes | Aggregator emission MUST produce deterministic per-(week, reviewer) ordering — outer `by_reviewer_comments` dict keys sorted ascending by commenter key (the stable identity string, including the sentinel literal which sorts deterministically among UUID-shaped real keys at the leading-`__` position). UI row tie-breaking is renderer-side (FR-4-05). `tests/integration/test_golden_outputs.py` gates this. |
| **QG-19 Unit + integration tests** | yes | New tests in `tests/unit/test_aggregators_reviewer_comments.py` (FR-1-* cases including the new thread_count COUNT(DISTINCT) semantics + self-comment exclusion + FAIL-LOUD on shape corruption) and extensions to `tests/integration/test_comments_trend_reconciliation.py` (FR-2-01 + FR-2-02 + NEW FR-2-03 sum-coherence vs INDEPENDENT count), `tests/integration/test_comments_trend_meta_failure.py` (FR-2-05 three injections — INV-4-07 violation + sum-coherence violation + self-comment-leak violation), `tests/integration/test_demo_variants_byte_identity.py` (FR-3-03 four omission failure modes for `by_reviewer_comments`). New demo-generator coherence guard test (per CL-14 step 3 / A-12). |
| **QG-20 Coverage threshold** | yes | New code paths must satisfy QG-52's ≤ 2% coverage delta. |
| **QG-28 Chart render < 1000ms (156 weeks)** | yes | New breakdown surface inherits 334 / 335's row-rendering performance posture; cap at 50 rows bounds DOM cost. |
| **QG-29 Chart data caps enforced** | yes | New chart module declares `MAX_COMMENTS_REVIEWER_DENSITY_ROWS = 50` constant per FR-4-06. |
| **QG-30..34 Demo parity** | yes | Capability-on demo manifest carries the `by_reviewer_comments` namespace; capability-off variant omits the entire key (FR-3-03). `tests/integration/test_demo_variants_byte_identity.py` extended. |
| **QG-35..38 Local/CI parity** | yes | All new tests run in pre-push preflight + CI; no local-degraded paths; `--no-verify` forbidden. |
| **QG-39 Cross-OS** | yes | Pure Python + TypeScript; no shell-out to OS-specific tools. |
| **QG-40 No `typing.Any`** | yes | New aggregator code uses precise types (`dict[str, int \| bool]`, TypedDict for sub-object emission). |
| **QG-41 Zero inline suppressions** | yes | Suppression baseline stays at zero; `audit-suppressions.py` gate enforced. |
| **QG-42 Enterprise test coverage** | yes | Producer / schema / chart / reconciliation / meta / byte-identity / live-loader regression / demo-coherence-guard / sentinel-collision-extension tests all required by spec; each test path covered. |
| **QG-43 Per-commit ratchet bump** | yes | Each commit that adds N tests bumps `.test-floor-contract.json` by exactly N. |
| **QG-44 Single source of truth for floors** | yes | No hardcoded floors; all floors via `--min-collected-artifact`. |
| **QG-45 Cross-OS Python collection parity** | yes | New tests are collection-stable across OS lanes (no platform gates at module scope). |
| **QG-46 Platform-conditional file naming** | yes | No platform-conditional tests added (none of this code is OS-specific). |
| **QG-47 Pre-commit trigger scope** | yes | Existing test-trigger predicate covers new test file paths; aggregator + schema source changes trigger existing UI / Python triggers. No new trigger predicate needed. |
| **QG-48 Worktree-clean guards** | n/a | This feature does not add a new pre-commit gate. Existing guards cover the affected scopes. |
| **QG-49 Single command, many callers** | yes | The reconciliation test extension (FR-2-04) is invoked via the standard `pytest tests/integration/` path used by pre-push preflight + CI; no new dedicated CommandSpec needed. The schema-parity gate is intentionally NOT extended (CL-09). |
| **QG-50..52 Change acknowledgement** | yes (test-floor only) | Each commit that adds tests bumps `.test-floor-contract.json` by exactly N (QG-43); no `[ratchet-realignment]` marker expected. Coverage delta ≤ 2% per QG-52. |
| **QG-53..55 Build architecture** | yes | New chart module under `extension/ui/modules/charts/` follows the existing split-tsconfig + esbuild-owns-`dist/ui/` posture; Prettier invoked only via the `format:check` script. |
| **QG-56 Security scan (gitleaks)** | yes | Runs on every commit; new code adds no secrets. |

**No Constitution gate violations identified.** No Complexity Tracking entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/336-comments-reviewer-density/
├── plan.md                                    # This file (/speckit.plan command output)
├── spec.md                                    # Feature specification (all 15 CL-axes locked)
├── research.md                                # Phase 0 output (6 ADRs — substantive aggregator divergence + demo synthetic stream + parity contract shape)
├── data-model.md                              # Phase 1 output (entity definitions, including new internal synthetic streams)
├── quickstart.md                              # Phase 1 output (verification steps)
├── contracts/
│   └── per-reviewer-comments-density.md       # Field shape contract for rollup[W].by_reviewer_comments + producer SQL + cross-aggregate parity contract
├── checklists/
│   └── requirements.md                        # Spec quality checklist (PASS, all axes locked)
└── tasks.md                                   # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
# Backend (Python aggregator)
src/ado_git_repo_insights/transform/
└── aggregators.py                             # Add _compute_weekly_by_reviewer_comments(week_pr_uids)
                                                # helper paralleling existing _compute_weekly_by_author_comments
                                                # (aggregators.py:1104) and _compute_weekly_by_repository_comments
                                                # (aggregators.py:1239). SQL iterates pr_comments rows joined with
                                                # pull_requests (for self-comment exclusion: pr_comments.author_id !=
                                                # pull_requests.user_id per CL-04) + LEFT JOIN users (for sentinel
                                                # detection per CL-03 / FR-1-03) + LEFT JOIN pr_threads (for status
                                                # filter per FR-1-05). GROUP BY commenter_or_sentinel + thread_id
                                                # subquery for COUNT(DISTINCT thread_id) per commenter per the new
                                                # thread_count semantics (FR-1-05 — distinct eligible threads with
                                                # at least one non-self comment by R, NOT raw row count).
                                                # FAIL-LOUD per FR-1-12 / CL-15: raise RuntimeError on
                                                # pr_comments.author_id shape corruption (NULL or non-UUID).
                                                # Call site in _generate_weekly_rollups() emits
                                                # by_reviewer_comments immediately after by_repository_comments
                                                # emission (aggregators.py:741-745 pattern).

# Extension (TypeScript UI)
extension/ui/
├── index.html                                 # NOT MODIFIED (per FR-3-01 + SC-1-03 byte-identity).
├── dataset-loader.ts                          # Extend Rollup interface with optional
                                                # by_reviewer_comments?: Record<string, ReviewerCommentsDensityEntry>
                                                # field (mirrors by_author_comments at dataset-loader.ts:220 and
                                                # by_repository_comments at dataset-loader.ts:239).
├── dashboard.ts                               # Two helpers + capability gate. ensureCommentsReviewerDensityContainer()
                                                # — idempotent insertion below per-repo row (anchor on
                                                # [data-comments-repository-density-row="true"] per CL-11);
                                                # row carries [data-comments-reviewer-density-row="true"].
                                                # removeCommentsReviewerDensityContainer() — finds row
                                                # by data attribute and removes; no-op if absent.
                                                # Render path: capability-on → ensure + render with
                                                # usersDimension = currentDimensions?.users?.map(...);
                                                # capability-off → remove. Lifecycle parity per FR-3-02.
├── styles.css                                 # Reuse existing 333 / 334 / 335 .coverage-partial CSS class hooks.
                                                # New row-table styles ONLY if not already shared with 334 / 335;
                                                # plan-level: prefer reuse via class composition.
├── schemas/
│   └── rollup.schema.ts                       # Extend Rollup interface with optional
                                                # by_reviewer_comments Record; add "by_reviewer_comments"
                                                # to KNOWN_ROOT_FIELDS; implement validateReviewerCommentsDensity()
                                                # validator alongside existing validateAuthorCommentsDensity()
                                                # (rollup.schema.ts:868) and validateRepositoryCommentsDensity()
                                                # (post-#350). Atomicity STRICT-ERROR posture mirrors 334 / 335
                                                # (INV-4-08).
└── modules/charts/
    ├── comments-reviewer-density.ts           # NEW chart module (~250 lines, modeled on 334's
                                                # comments-author-density.ts for the sentinel branch + 335's
                                                # comments-repository-density.ts for the all-zero filter).
                                                # Differences from siblings:
                                                # - reads rollup[W].by_reviewer_comments
                                                # - takes usersDimension instead of authorsDimension /
                                                #   repositoriesDimension
                                                # - HAS the sentinel branch (CL-03) with fixed-string label
                                                #   "Former / unavailable author" (reuse 334's literal verbatim;
                                                #   bucket key check: FORMER_OR_UNAVAILABLE_AUTHOR_KEY literal
                                                #   from a renderer-local constant mirroring 334's pattern at
                                                #   comments-author-density.ts:65)
                                                # - tie-break: chosen-metric desc → display name asc → bucket
                                                #   key asc (FR-4-05 — apply same ternary-collapse 334 / 335 used
                                                #   to keep partial-branches ratchet at zero)
                                                # - all-zero row filter BEFORE sort/truncate (FR-4-02 critical
                                                #   per kickoff lesson; mirrors 335's pattern at
                                                #   comments-repository-density.ts:335-341)
                                                # - tooltip text on partial-coverage qualifier emphasizes
                                                #   week-level uncertainty per CL-10 directive
                                                # - MAX_COMMENTS_REVIEWER_DENSITY_ROWS = 50 (CL-07 / FR-4-06)
    └── index.ts                                # Barrel export updated to include comments-reviewer-density

# Tests
tests/
├── integration/
│   ├── test_comments_trend_reconciliation.py  # EXTEND — FR-2-01 (per-PR drill-down ↔ per-reviewer aggregator
                                                # multi-bucket coherence) + FR-2-02 (per-(W, R) independent
                                                # re-computation grouped by commenter, joining pr_comments +
                                                # pull_requests + pr_threads + LEFT JOIN users) + NEW FR-2-03
                                                # cross-aggregate parity (sum_R(comment_count) vs INDEPENDENT
                                                # count of pr_comments rows where commenter != PR author AND
                                                # is_deleted = 0; NOT vs comments.comment_count).
                                                # The parity check runs on every week W where both `comments`
                                                # and `by_reviewer_comments` are emitted; auto-discovers
                                                # truncated weeks via _prs_truncated:true introspection
                                                # (week-agnostic per A-11). Pre-loop guard asserts at least
                                                # one such W exists (mirrors 335 T006 guard).
                                                # Import-block isolation (test_*_isolation.py) covers
                                                # automatically (file-level, not dimension-level).
│   ├── test_comments_trend_meta_failure.py    # EXTEND — FR-2-05 THREE injections per ADR R004:
                                                # (a) per-(week, reviewer) INV-4-07 violation
                                                # (active_thread_count > thread_count); (b) FR-2-03
                                                # sum-coherence violation (mutate one bucket's comment_count
                                                # so SUM_R no longer matches independent count);
                                                # (c) self-comment-leak violation (inject a synthetic bucket
                                                # whose key equals the PR author's user_id; FR-2-04
                                                # reconciliation FAILS because either FR-2-02 or FR-2-03
                                                # catches the leak).
│   └── test_demo_variants_byte_identity.py    # EXTEND — gate the new `by_reviewer_comments` key under
                                                # capability-off for ALL FOUR omission failure modes
                                                # (absent / null / {} / partial).
└── unit/
    ├── test_aggregators_reviewer_comments.py  # NEW — FR-1-* cases (mirrors 334 / 335 unit-test scope plus
                                                # sentinel cases inherited from 334 plus self-comment exclusion
                                                # cases unique to per-reviewer):
                                                # (i) all-extracted week, no self-comments → coverage_partial=false
                                                #     for every reviewer; sums correct
                                                # (ii) mixed-extraction week → coverage_partial=true for every
                                                #      reviewer (same-W flag per CL-10)
                                                # (iii) all-unextracted week → no buckets emitted (key omitted
                                                #       per FR-1-11)
                                                # (iv) capability-off → no by_reviewer_comments key
                                                # (v) atomicity (FR-1-08) — entry has all 4 fields or none
                                                # (vi) ordering (FR-1-09) — active_thread_count <= thread_count
                                                #      per entry
                                                # (vii) full extracted-subset scope (FR-1-10) — emission covers
                                                #       W's full canonical PR set, not the drill-down slice
                                                # (viii) self-comment exclusion (FR-1-04) — PR author commenting
                                                #        on own PR does NOT appear in by_reviewer_comments
                                                # (ix) thread_count COUNT(DISTINCT) semantics (FR-1-05) — a
                                                #      reviewer with 5 comments across 2 threads has thread_count=2
                                                #      (NOT 5)
                                                # (x) active_thread_count subset semantics (FR-1-05) — only
                                                #     threads with status='active' contribute
                                                # (xi) sentinel bucketing (FR-1-03) — pr_comments.author_id absent
                                                #      from users → sentinel literal as bucket key
                                                # (xii) FAIL-LOUD on shape corruption (FR-1-12) — RuntimeError
                                                #       on NULL pr_comments.author_id
                                                # (xiii) FAIL-LOUD on shape corruption (FR-1-12) — RuntimeError
                                                #        on non-UUID pr_comments.author_id
                                                # (xiv) determinism — outer dict key order ascending by commenter key
    └── test_demo_synthetic_pr_comments.py     # NEW per CL-14 / A-12 — coherence guard for the demo's new
                                                # synthetic streams. Re-aggregates synthetic_pr_threads +
                                                # synthetic_pr_comments per PR P, asserts the result equals
                                                # P's pre-existing PrRecord thread_count / comment_count /
                                                # active_thread_count. Per kickoff: "demo key-shape
                                                # verification — do this FIRST" — this is the FIRST test
                                                # written in Phase 2 (before T011 production aggregator).

extension/tests/
├── modules/charts/
│   └── comments-reviewer-density.test.ts      # NEW — chart unit tests:
                                                # - FR-4-01..06 row rendering / sort / cap / truncation
                                                # - FR-4-03 partial-coverage qualifier per row + week-level
                                                #   tooltip text (CL-10 directive)
                                                # - FR-4-07 filter-not-supported on any active filter
                                                # - FR-4-08 no-data-in-range vs filter-not-supported (separate
                                                #   .no-data and .no-data-hint queries per A-14 kickoff lesson;
                                                #   per-state unique markers as named constants
                                                #   FILTER_STATE_UNIQUE_MARKERS / NODATA_STATE_UNIQUE_MARKERS)
                                                # - FR-4-09 no click-through
                                                # - FR-4-10 a11y (sort selector keyboard, screen-reader text)
                                                # - FR-4-11 raw-user_id fallback when usersDimension entry missing
                                                # - FR-4-12 sentinel rendering (CL-03 / CL-05) — fixed-string
                                                #   label even when usersDimension contains an entry under the
                                                #   literal key
                                                # - Non-vacuous sort fixture per A-15 — three distinct
                                                #   orderings for comment_count / thread_count / active_thread_count;
                                                #   expect(afterSpace).not.toEqual(afterEnter) catches vacuous-pass
├── schema/
│   └── rollup.test.ts                         # EXTEND — schema validates `by_reviewer_comments` outer dict:
                                                # - valid 4-field entry passes
                                                # - missing field → atomicity error
                                                # - non-integer / negative → validation error
                                                # - active_thread_count > thread_count → ordering error
                                                # - capability-off (key absent) passes
                                                # - empty {} outer dict fails (FR-1-11)
├── dashboard/
│   └── comments-reviewer-density-lifecycle.test.ts  # NEW — capability-on/off lifecycle parity (FR-3-02):
                                                # - initial capability-off: no row in DOM, layout pristine
                                                # - on→off transition: row removed cleanly
                                                # - off→on transition: row inserted exactly once below
                                                #   the per-repo row at the data-attribute anchor
                                                # - on→on re-render idempotency: no duplicate row
                                                # - source-parse binding per A-13 kickoff lesson — read
                                                #   dashboard.ts as text and use dashboardSrc.indexOf +
                                                #   expect.toContain to assert the
                                                #   ensureCommentsReviewerDensityContainer /
                                                #   removeCommentsReviewerDensityContainer call sites are
                                                #   present
└── artifact-client.test.ts                    # EXTEND — FR-3-04 F3 live-loader regression:
                                                # - AuthenticatedDatasetLoader.getCapabilityState()?.commentsMetricsAvailable === true
                                                #   on a dataset variant containing the by_reviewer_comments key
                                                #   (analog of the regressions added for #334 in PR #349 and
                                                #   #335 in PR #350)

# Demo generator (parallel path per memory feedback_demo_generator_parallel_path.md / A-09)
scripts/
└── generate-demo-data.py                      # ADD synthetic_pr_threads + synthetic_pr_comments parallel
                                                # lists per week (per CL-14 — internal, NOT serialized).
                                                # ADD _aggregate_by_reviewer_comments_for_week() helper
                                                # paralleling existing _aggregate_by_author_comments_for_week
                                                # (generate-demo-data.py:567) and
                                                # _aggregate_by_repository_comments_for_week
                                                # (generate-demo-data.py:624). Helper iterates the new
                                                # synthetic_pr_comments + synthetic_pr_threads lists; groups
                                                # by commenter author_id; excludes self-comments
                                                # (commenter == PR author); applies sentinel literal for
                                                # commenters absent from the users pool. Coherence guard
                                                # tested at tests/unit/test_demo_synthetic_pr_comments.py.
                                                # Call site in _build_weekly_rollup() emits
                                                # by_reviewer_comments immediately after by_repository_comments
                                                # emission. FAIL-LOUD per CL-15 on any internal commenter-pool
                                                # resolution miss (mirrors 335's name→UUID FAIL-LOUD).

# Sentinel collision-safety extension
tests/unit/test_aggregators_author_comments.py  # EXTEND test_sentinel_literal_does_not_collide_with_real_author_ids
                                                # (T029 from #334 at tests/unit/test_aggregators_author_comments.py:514)
                                                # to ALSO assert the FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL literal
                                                # does not collide with real pr_comments.author_id values per
                                                # kickoff directive ("extend its assertion list, don't duplicate
                                                # the test"). Widens T029's user_id set to also cover
                                                # pr_comments.author_id UUIDs. NO new test file, NO duplicated
                                                # test function.

# Test floor
.test-floor-contract.json                       # BUMP by N in the same commit as added tests (QG-43)

# Canonical artifact sync — covers EVERY managed output the change touches.
# Tasks MUST run the canonical sync + verify (NOT a hand-curated docs/data/ regenerate),
# THEN run scripts/build-demo-dataset.py to refresh docs/data/ (per memory
# feedback_managed_artifacts_excludes_demo_data.md / A-03 — manage_generated_artifacts.py
# does NOT cover docs/data/).
# Run:
#   1. python scripts/manage_generated_artifacts.py sync --scope all --stage
#   2. uv run --python 3.12 python scripts/build-demo-dataset.py
#   3. python scripts/manage_generated_artifacts.py verify
# Outputs this feature touches (sync + build-demo-dataset drive all of them; do NOT enumerate manually):
#   - extension/ui/dist/                              # esbuild bundles (rebuilt for the new chart module)
#   - docs/data/aggregates/weekly_rollups/*.json      # rollup JSONs gain by_reviewer_comments namespace
#   - docs/data/dataset-manifest.json                 # manifest carries capabilities.comments_metrics state
#   - artifacts/demo-enterprise-comments-off/         # capability-off variant (byte-identity baseline)
```

**Structure Decision**: this feature follows the existing repo split — Python aggregator under `src/ado_git_repo_insights/transform/`, extension UI under `extension/ui/`, integration tests under `tests/integration/`, demo artifacts under `docs/data/`. No new top-level directories. The chart module follows the established `extension/ui/modules/charts/<name>.ts` pattern (modeled on 334's `comments-author-density.ts` for the sentinel branch and 335's `comments-repository-density.ts` for the all-zero-row filter pattern; the new chart is a hybrid of both). The demo generator gains internal synthetic streams + a new aggregation helper without changing the rollup file's serialized shape (only the aggregated `by_reviewer_comments` namespace ships).

## Phase 0: Outline & Research

See [research.md](./research.md) for the full ADR set. Six ADRs pin the genuinely new implementation questions for this feature:

- **ADR R001** — Chart module file name + sentinel + display-label-fallback wiring: `extension/ui/modules/charts/comments-reviewer-density.ts`, modeled on 334's `comments-author-density.ts` (for the sentinel branch) and 335's `comments-repository-density.ts` (for the all-zero filter pattern). `usersDimension`-fed label resolution with sentinel branch precedence (CL-05 step 1) → users-dimension lookup (CL-05 step 2) → raw `user_id` fallback (CL-05 step 3). Tooltip text on partial-coverage qualifier emphasizes week-level uncertainty per CL-10.
- **ADR R002** — Demo synthetic commenter stream design (NEW for this feature, CL-14): two new internal per-week parallel lists (`synthetic_pr_threads` + `synthetic_pr_comments`) populated such that re-aggregating them yields each PR's pre-existing PrRecord aggregate counts; coherence guard test at `tests/unit/test_demo_synthetic_pr_comments.py`; ghost-commenter inclusion in ≥1 demo week.
- **ADR R003** — Cross-aggregate parity test placement (NEW shape for this feature, CL-12): extend `tests/integration/test_comments_trend_reconciliation.py` in-place. The parity assertion compares `SUM_R(by_reviewer_comments[R].comment_count)` to an INDEPENDENT count of eligible-reviewer-comments (NOT to `comments.comment_count`). `thread_count` / `active_thread_count` sum NOT asserted (multi-counting). `coverage_partial` OR-coherence asserted as drift guard against CL-10 same-W lock breakage.
- **ADR R004** — Failure-mode meta-test extension (FR-2-05): extend `tests/integration/test_comments_trend_meta_failure.py` in-place with THREE new injections — (a) per-(week, reviewer) `active_thread_count > thread_count` (INV-4-07), (b) per-week sum-coherence violation (mutate one bucket's `comment_count`), (c) self-comment-leak (synthetic bucket where commenter == PR author). All three injections MUST cause FR-2-04 reconciliation to FAIL on the mutated dataset.
- **ADR R005** — Demo→production data-shape verification protocol (per kickoff pre-empt #1): trace the demo generator's new `synthetic_pr_comments` stream end-to-end and verify `author_id` values match the canonical extractor's UUID shape BEFORE writing the production `_compute_weekly_by_reviewer_comments` helper. The coherence guard test (T004 in tasks.md) is the FIRST test written in Phase 2; a failure there blocks subsequent tasks.
- **ADR R006** — Pattern-extraction posture (per A-08): three concrete chart modules will exist after this feature ships (per-author + per-repo + per-reviewer); abstraction extraction (renderer + schema validator + dashboard ensure/remove + lifecycle test) is **deferred to a follow-up feature** so it is informed by all three concrete instances. Aggregator extraction stays NOT recommended (per-author / per-repo iterate `pull_requests`; per-reviewer iterates `pr_comments`; the substantive divergence makes shared aggregator scaffolding more cost than benefit).

ADRs that 334 / 335 needed but 336 does NOT need (silent inheritance):

- Sort selector pattern (WAI-ARIA Toolbar) — locked verbatim by CL-07 / FR-4-05; no plan-level choice.
- Schema validator atomicity posture (STRICT-ERROR) — mirrors 334 / 335's pattern; no plan-level choice.
- Partial-coverage visual qualifier (hatched + dimmed) — reuse 333 / 334 / 335's `.coverage-partial` CSS class hooks; no plan-level choice.
- Week-attribution rule — same `closed_date → ISO-week` formula 333 / 334 / 335 / throughput use; per-PR parity test (`tests/integration/test_week_attribution_parity.py`) already guards drift across all aggregators.
- Sentinel literal name + label — locked by CL-03 (reuse 334's literal verbatim).

## Phase 1: Design & Contracts

See:

- [data-model.md](./data-model.md) — entity definitions (existing referenced + new `Per-Reviewer Comments-Density Emission` + new internal `synthetic_pr_threads` / `synthetic_pr_comments`).
- [contracts/per-reviewer-comments-density.md](./contracts/per-reviewer-comments-density.md) — field shape contract, producer SQL pattern, consumer schema validator, cross-aggregate parity contract (sum-coherence vs INDEPENDENT count shape).
- [quickstart.md](./quickstart.md) — verification steps for human + automated.

## Constitution Re-Check (post-design)

After Phase 1 design, all gates above remain PASSED. The schema-parity gate intentional non-extension (CL-09) is documented in `contracts/per-reviewer-comments-density.md`. The reconciliation extension is in-place to 333's test (CL-06); the import-block isolation guarantee propagates automatically. The ADR set in `research.md` does not introduce any new dependency, gate, or invariant beyond the spec. **No design-stage scope creep detected.**

## Deliberate Omissions (per user directive)

The following are EXPLICITLY out of scope for this plan / tasks / implementation:

- **Smoke tests** — none. Existing pre-push preflight + CI gate chain is sufficient.
- **AI summarization / privacy framing of comment content** — out of scope per spec Out of Scope; 322 / 182 noted.
- **Pattern-reuse abstraction extraction** — A-08 / ADR R006 explicitly defers to a follow-up feature so the abstraction is informed by three concrete instances. Aggregator extraction stays NOT recommended.
- **Docs parity gates / wording-parity tests** — none. Memory `feedback_doc_parity_is_churn_bait.md` rules these out. Inline comments at each site are the right tool.
- **New pre-commit / pre-push hooks** — none. All testing surfaces fit in existing `pytest tests/integration` / `pnpm test` invocations gated by existing trigger predicates per QG-47.
- **Pipeline changes** — none. The existing CI workflow `.github/workflows/ci.yml` runs the affected tests via existing job matrix; no new job, step, or workflow file needed.
- **Managed-artifact ceremony beyond canonical sync/build** — single `manage_generated_artifacts.py sync --scope all --stage`, single `scripts/build-demo-dataset.py` run, single `manage_generated_artifacts.py verify`. NO per-managed-path regenerate enumeration in tasks.md (memory `feedback_canonical_artifact_sync_one_task.md`).
- **Wall-clock performance assertions** — chart-render budget governed by QG-28's existing 1000ms / 156-week scalability gate; aggregator runtime governed by existing producer test-suite wall-clock budgets only. Single-run wall-clock assertions are CI-flake bait per memory `feedback_flake_fix_is_policy_decision.md`.
- **#348 perf-budget flake fix** — not in #336 scope (per A-16). Pre-existing reliability concerns; retry once if observed in CI per memory `feedback_one_push_attempt_policy.md` / `feedback_do_not_absorb_flakes_into_feature_scope.md`.
- **Schema-parity gate extension** — explicitly NOT extended (CL-09 / 333 Decision 5 / 334 CL-08 / 335 CL-08 inherits). Reconciliation test is the parity authority.
- **Sentinel collision-safety duplicate test** — per kickoff directive: extend #334's T029 in-place at `tests/unit/test_aggregators_author_comments.py:514`; do NOT create a new test file or function. The widened assertion list covers both `users.user_id` and `pr_comments.author_id` UUID sets.
- **Serializing synthetic_pr_threads / synthetic_pr_comments to rollup files** — privacy posture per CL-14 step 5; only aggregated `by_reviewer_comments` keys ship.

## Complexity Tracking

> Empty — no Constitution Check violations identified.
