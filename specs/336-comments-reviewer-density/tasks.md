---

description: "Implementation tasks for #336 — Dashboard per-reviewer comment density breakdown"
---

# Tasks: Dashboard per-reviewer comment density breakdown

**Input**: Design documents from `specs/336-comments-reviewer-density/`
**Prerequisites**: spec.md (15 CL-axes locked Path B 2026-04-29), plan.md, research.md (ADRs R001–R006), data-model.md, contracts/per-reviewer-comments-density.md, quickstart.md, checklists/requirements.md (PASS).
**Branch**: `feat/336-comments-reviewer-density`
**Single PR scope**: third sibling Cap-2 dimension PR after #334 (per-author, PR #349 merged) and #335 (per-repo, PR #350 merged); inherits the visual + interaction pattern duplicated from 334 (sentinel branch) + 335 (all-zero filter, week-agnostic truncation discovery, FAIL-LOUD demo lookup) per A-08; abstraction extraction deferred to a follow-up feature per ADR R006.
**Tests**: REQUIRED — the spec mandates explicit tests for FR-1-* (producer unit including sentinel + self-comment exclusion + COUNT(DISTINCT) thread semantics + FAIL-LOUD on shape corruption), FR-2-04 / FR-2-05 (reconciliation + meta-failure extensions including the NEW FR-2-03 cross-aggregate parity-vs-INDEPENDENT-count + self-comment-leak injection), FR-3-03 (byte-identity extension), FR-3-04 (F3 live-loader regression), FR-4-01..12 (chart unit including sentinel + fallback + lifecycle), schema validator extension, and the NEW demo synthetic-stream coherence guard (per CL-14 / ADR R005, FIRST test in Phase 2). Test-driven ordering: write tests first, expect failure, then implement.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Maps to user stories from spec.md (US1 = P1 chart MVP, US2 = P2 sort toggle, US3 = P3 capability-off byte-identity, US4 = P3 sentinel rendering, US5 = P3 filter-not-supported posture).
- Setup, Foundational, and Polish phases have NO story label

## Path Conventions

- **Backend**: `src/ado_git_repo_insights/`, `tests/` at repo root
- **Extension**: `extension/ui/`, `extension/tests/`
- **Demo data**: `docs/data/`, `scripts/generate-demo-data.py`
- **Specs**: `specs/336-comments-reviewer-density/`

## Constitution gates that bind every commit

- **QG-43** (per-commit ratchet bump): every commit that adds N tests MUST bump `.test-floor-contract.json` by exactly N in the SAME commit. Tasks below note the bump explicitly where tests are added.
- **QG-49** (single command, many callers): the SC-05 reconciliation extension is invoked via the standard `pytest tests/integration/` path used by pre-push preflight + CI; no new dedicated CommandSpec needed. The schema-parity gate (`scripts/check_pr_record_schema_parity.py`, Row 38) is intentionally NOT extended (CL-09 = follow 333 Decision 5 / 334 CL-08 / 335 CL-08).
- **QG-39 / QG-40 / QG-41 / QG-42**: cross-OS, no `typing.Any`, zero new inline suppressions, enterprise test coverage. See `reference_s608_refactor_pattern.md` for the dynamic-SQL pattern (sentinel literal bound via `?` parameter, NOT f-string interpolation).
- **QG-38**: `--no-verify` forbidden.
- **Partial-branches ratchet gate** (`.coverage-partial-branches-baseline.json`): NOT permitted to grow. Apply the same tie-break-ternary collapse 334 / 335 used to keep the ratchet at zero, OR cover defensive branches with mutation-based tests.
- **Outside-form pnpm** in this file (per kickoff lesson from #335): partial-branches gate task uses `pnpm --dir extension run test:partial-branches` (outside form), NOT `pnpm run test:partial-branches` (inside form).

---

## Phase 1: Setup (ADRs R001–R006 pre-pinned in research.md)

**Purpose**: Confirm the 6 ADRs from research.md are still applicable. No code changes in this phase — the ADR decisions are authoritative; this phase is a per-task confirmation gate.

- [ ] T001 [P] Confirm ADR R001 (chart module file name + sentinel + display-label-fallback wiring) per `specs/336-comments-reviewer-density/research.md` § ADR R001 — chart module is `extension/ui/modules/charts/comments-reviewer-density.ts`, modeled on 334's `comments-author-density.ts` (sentinel branch) + 335's `comments-repository-density.ts` (all-zero filter pattern). Sentinel literal reuse + week-level tooltip text per CL-10. If the inheritance reference has shifted, update research.md and re-trigger /speckit.tasks before proceeding.
- [ ] T002 [P] Confirm ADR R002 (demo synthetic commenter stream design, NEW for this feature) — two new internal per-week parallel lists `synthetic_pr_threads` + `synthetic_pr_comments` populated such that re-aggregating yields each PR's pre-existing PrRecord aggregate counts; coherence guard test at `tests/unit/test_demo_synthetic_pr_comments.py`; ghost-commenter inclusion in ≥1 demo week.
- [ ] T003 [P] Confirm ADR R003 (cross-aggregate parity test placement, NEW shape) — extend `tests/integration/test_comments_trend_reconciliation.py` in-place; parity asserts `SUM_R(comment_count)` vs INDEPENDENT count of eligible-reviewer-comments (NOT vs `comments.comment_count`); `thread_count` / `active_thread_count` sum NOT asserted (multi-counting); `coverage_partial` OR-coherence asserted as drift guard. Week-agnostic truncation discovery per A-11.
- [ ] T004 [P] Confirm ADR R004 (failure-mode meta-test extension) — extend `tests/integration/test_comments_trend_meta_failure.py` in-place with THREE injections: (a) per-(week, reviewer) `active_thread_count > thread_count` violation, (b) per-week sum-coherence violation (mutate one bucket's `comment_count`), (c) self-comment-leak violation (inject a synthetic bucket where commenter == PR author).
- [ ] T005 [P] Confirm ADR R005 (demo→production data-shape verification protocol) — the coherence guard test at `tests/unit/test_demo_synthetic_pr_comments.py` is the FIRST test written in Phase 2; failure there blocks subsequent tasks. Synthetic commenter author_ids MUST match canonical UUID shape (32 hex + 4 hyphens).
- [ ] T006 [P] Confirm ADR R006 (pattern-extraction posture, post-#336) — three concrete chart modules will exist after this PR ships; abstraction extraction deferred to a follow-up feature so it is informed by all three concrete instances. Aggregator extraction stays NOT recommended.

**Checkpoint**: All 6 ADRs confirmed. Subsequent tasks have deterministic targets.

---

## Phase 2: Foundational (Blocking prerequisites for all user stories)

**Purpose**: demo synthetic stream coherence guard FIRST (per ADR R005) → producer unit tests + reconciliation extension + meta-test extension + byte-identity extension + schema validator tests + F3 live-loader regression + sentinel-collision T029 extension → demo synthetic stream impl + production aggregator emission + schema extension → floor accounting. All 5 user stories depend on these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. T007 (demo coherence guard) MUST be written and FAIL before T008+ tests proceed (per ADR R005).

### 2.1 — Demo synthetic stream coherence guard FIRST (per ADR R005)

- [ ] T007 [Phase 2.1] Add demo synthetic-stream coherence guard at `tests/unit/test_demo_synthetic_pr_comments.py`. Cover CL-14 step 3 / A-12 / ADR R005: (a) for every PR P in a small synthetic fixture, `len(synthetic_pr_threads for P) == P.thread_count`; (b) `len(synthetic_pr_threads for P with status='active') == P.active_thread_count`; (c) `len(synthetic_pr_comments for P) == P.comment_count`; (d) every emitted thread has ≥1 comment (no orphan threads); (e) every commenter `author_id` ≠ corresponding PR's `author_id`; (f) every emitted commenter `author_id` matches UUID format (32 hex + 4 hyphens). Test MUST currently FAIL (synthetic streams not implemented yet). Bump `.test-floor-contract.json` Python floor by 6 in same commit (QG-43). **Per ADR R005 / kickoff lesson "demo key-shape verification — do this FIRST", T007 MUST land before T008+ tests proceed.**

### 2.2 — Test-first scaffolding (TDD: write tests, expect FAIL, then implement)

- [ ] T008 Add producer unit tests at `tests/unit/test_aggregators_reviewer_comments.py`. Cover FR-1-* cases per data-model.md and quickstart §3: (i) all-extracted week, no self-comments → all entries `coverage_partial=false`, sums correct; (ii) mixed-extraction week → all entries `coverage_partial=true` (same-W flag per CL-10); (iii) all-unextracted week → no buckets emitted (key omitted per FR-1-11); (iv) capability-off → no `by_reviewer_comments` key emitted; (v) atomicity (FR-1-08) → entry has all 4 fields or absent; (vi) ordering (FR-1-09) → `active_thread_count <= thread_count` per entry; (vii) full extracted-subset scope (FR-1-10) → emission covers W's full canonical PR set, not the drill-down slice; (viii) self-comment exclusion (FR-1-04) → PR author commenting on own PR does NOT appear in `by_reviewer_comments`; (ix) thread_count COUNT(DISTINCT) semantics (FR-1-05) — reviewer with 5 comments across 2 threads has thread_count=2 (NOT 5); (x) active_thread_count subset semantics (FR-1-05) — only threads with status='active' contribute; (xi) sentinel bucketing (FR-1-03) — `pr_comments.author_id` absent from `users` → sentinel literal as bucket key; (xii) FAIL-LOUD on shape corruption (FR-1-12) — RuntimeError on non-UUID `pr_comments.author_id`; (xiii) determinism — outer dict key order ascending by commenter key. Tests MUST currently FAIL (no aggregator emission yet). Bump `.test-floor-contract.json` Python floor by 13 in same commit. Note: the FR-1-12 NULL clause is structurally unreachable in the production SQL path (the CASE expression maps absent-from-users rows to the sentinel literal, and `pr_comments.author_id NOT NULL` at `models.py:160` prevents NULL at INSERT) — the defensive NULL check in T016's helper is retained for forward-compat against a hypothetical future SQL refactor, but no test exercises it (mock-based testing would couple to internal SQL invocations and would fail if the SQL ever changes).
- [ ] T009 Extend the SC-05 reconciliation test in-place at `tests/integration/test_comments_trend_reconciliation.py` with per-reviewer parity assertions per CL-06. Three new tests: (a) **FR-2-01 per-PR drill-down ↔ per-reviewer aggregator `comment_count` distribution coherence** — for every PR P in the drill-down's top-500-by-cycle-time slice ∩ extracted-subset, assert `P.comment_count_drilldown - count_self_comments(P)` EQUALS the SUM over non-self commenters R of `(count of pr_comments rows for P where author_id = R AND is_deleted = 0)`. **Do NOT assert thread_count or active_thread_count distribution at the per-PR level** — the "PR with mixed self-only and non-self threads" edge case (spec.md Edge Cases) makes the per-PR bound non-closed-form for those metrics (self-only threads contribute to drill-down thread_count but 0 to any reviewer bucket; the gap depends on P's self-only-thread count which is not recorded per-PR). FR-2-02 covers per-bucket correctness for `thread_count` / `active_thread_count`. (b) **FR-2-02 per-(W, reviewer) independent re-computation** — for each (W, reviewer) tuple, aggregator emission equals an independent re-computation grouped by commenter against direct SQL on `pr_comments` + `pull_requests` (INNER JOIN for self-comment exclusion) + `pr_threads` (LEFT JOIN for active-thread filter) + `users` (LEFT JOIN for sentinel detection); per-bucket COUNT(DISTINCT thread_id) for thread_count / active_thread_count; (c) **FR-2-03 cross-aggregate parity-vs-INDEPENDENT-count (NEW shape)** — for every week W where both `comments` and `by_reviewer_comments` are emitted, assert `SUM_R(by_reviewer_comments[R].comment_count)` EQUALS the count of `pr_comments` rows in W's extracted-subset where `pr_comments.author_id != pull_requests.user_id` AND `pr_comments.is_deleted = 0` (computed INDEPENDENTLY by direct SQL — NOT vs `comments.comment_count`); assert `OR_R(coverage_partial)` EQUALS `comments.coverage_partial`. The parity test auto-discovers truncated weeks via `_prs_truncated: true` introspection (week-agnostic per A-11). **Pre-loop fixture guard**: assert that at least ONE week W in the demo dataset satisfies "both `comments` AND `by_reviewer_comments` are emitted (non-empty)" — otherwise the parity loop iterates zero weeks and silently passes (no positive control). The guard fails loudly with a clear message identifying that demo regeneration has shifted the witness; A-11 documents the spec-level assumption this guard enforces. Tests MUST currently FAIL on demo (no aggregator emission yet). Bump `.test-floor-contract.json` Python floor by 3 in same commit.
- [ ] T010 Extend the FR-2-05 failure-mode meta-test at `tests/integration/test_comments_trend_meta_failure.py` with THREE new injections per ADR R004: (a) per-(week, reviewer) INV-4-07 violation — mutate one bucket's emission so `active_thread_count > thread_count`; assert FR-2-04 reconciliation test (T009) FAILS on the mutated copy; (b) per-week sum-coherence violation — mutate one bucket's `comment_count` so the per-reviewer sum no longer matches the INDEPENDENT count from FR-2-03's right-hand side; assert FR-2-04 reconciliation test (T009) FAILS on the mutated copy; (c) self-comment-leak violation — inject a synthetic bucket whose key equals the PR author's own `user_id` (i.e., a bucket representing self-comments by the PR author on their own PR); assert FR-2-04 reconciliation test (T009) FAILS on the mutated copy because either FR-2-02 or FR-2-03 catches the leak. Tests MUST currently SKIP / XFAIL until T009 + T014 land green on clean demo (use `xfail(strict=False, reason="depends on T009 + T014")` for collection-stability per Principle XXVI). Bump `.test-floor-contract.json` Python floor by 3 in same commit.
- [ ] T011 Extend `tests/integration/test_demo_variants_byte_identity.py` `_GATED_*` set per FR-3-03. Add `"by_reviewer_comments"` to the existing rollup-level gated namespace strip set (333 added `"comments"`; 334 added `"by_author_comments"`; 335 added `"by_repository_comments"`; this feature adds the per-reviewer sibling). The 4 omission failure modes (key absent / `null`-valued / `{}`-valued / partial-fielded) gate individually per the existing pattern; each mode is a parameterized test row. Tests MUST currently FAIL until T014 emission emits-and-omits correctly. Bump `.test-floor-contract.json` Python floor by 4 in same commit.
- [ ] T012 [P] Add schema validator tests at `extension/tests/schema/rollup.test.ts` (extending the existing 333 / 334 / 335 schema test file). Cases: (a) valid 4-field entry passes; (b) partial entry (missing one field) → atomicity error in BOTH strict and permissive modes (mirrors 334 / 335 STRICT-ERROR posture per ADR R001); (c) null-valued numeric fields fail; (d) rollup without `by_reviewer_comments` key passes (capability-off scenario); (e) wrong-typed fields fail (e.g., `thread_count` is a string); (f) `active_thread_count > thread_count` per entry → ordering error (INV-4-07); (g) empty `{}` outer dict fails (FR-1-11 — key MUST be omitted entirely when no buckets); (h) entry with `__former_or_unavailable_author__` as key passes. Tests MUST currently FAIL (validator not extended yet). Bump `.test-floor-contract.json` Extension floor by 8 in same commit.
- [ ] T013 [P] Add F3 live-loader regression test at `extension/tests/artifact-client.test.ts` per FR-3-04 (mirrors the by_author_comments regression added for #334 in PR #349 + by_repository_comments regression for #335 in PR #350). Test asserts `AuthenticatedDatasetLoader.getCapabilityState()?.commentsMetricsAvailable === true` resolves correctly on a dataset variant containing the `by_reviewer_comments` key — guards against another #347-style live-loader gate regression on the new chart's capability path. Test MUST currently PASS (capability gate already exists from #334 / #335; this test adds coverage for the new namespace). Bump `.test-floor-contract.json` Extension floor by 1 in same commit.

### 2.3 — Sentinel collision-safety T029 extension (NOT duplication)

- [ ] T014 Extend `tests/unit/test_aggregators_author_comments.py:514` `test_sentinel_literal_does_not_collide_with_real_author_ids` (T029 from #334) per kickoff directive. Widen the existing assertion list to ALSO assert no real `pr_comments.author_id` value collides with `FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL`. NO new test file; NO new test function; NO duplicated test logic. The widened test reads from a fixture that includes both `users.user_id` UUIDs (existing 334 assertion) AND `pr_comments.author_id` UUIDs (NEW for #336). NO `.test-floor-contract.json` bump for T014 — extending an existing test's assertion list is not adding a new test. Test MUST PASS after the assertion list extension (the SENTINEL literal cannot collide with UUID-format strings; the existing #334 assertion already validates this for the user_id namespace).

**Checkpoint 2.1+2.2+2.3**: Test infrastructure exists. T007 (demo coherence guard) is RED. T008–T011 (Python tests) are RED. T012 (extension schema tests) is RED. T013 (F3 live-loader regression) may PASS — its test target already exists from #334 / #335. T014 (T029 extension) PASSES (no new tests, just widened assertion list). The 333 import-block isolation test (`tests/integration/test_comments_trend_reconciliation_isolation.py`) automatically covers T009 since aggregator imports remain forbidden by file.

### 2.4 — Demo synthetic streams + aggregator helper (per CL-14 / ADR R002)

- [ ] T015 Implement synthetic commenter streams + new demo aggregator helper in `scripts/generate-demo-data.py`. Add per-week parallel lists `synthetic_pr_threads: list[SyntheticPrThread]` and `synthetic_pr_comments: list[SyntheticPrComment]` alongside `synthetic_prs_full` (NOT serialized to rollup files; consumed only by the new helper per CL-14 step 5). For each PR P with non-NULL `thread_count`: emit `P.thread_count` synthetic thread records, marking `P.active_thread_count` of them with `status='active'` (deterministic by sorted thread_id). For each PR P with non-NULL `comment_count`: emit `P.comment_count` synthetic comment records distributed across P's threads (each thread has ≥1 comment); sample commenter `author_id` deterministically from `author_pool` excluding P's author; ≥1 demo week MUST sample from a synthetic ghost pool (UUIDs absent from seeded `users`). Add `_aggregate_by_reviewer_comments_for_week(synthetic_prs_full, synthetic_pr_threads, synthetic_pr_comments, users_pool)` helper paralleling existing `_aggregate_by_author_comments_for_week` (`generate-demo-data.py:567`) and `_aggregate_by_repository_comments_for_week` (`generate-demo-data.py:624`). Helper iterates `synthetic_pr_comments`, INNER JOIN with PrRecords for self-comment exclusion (commenter ≠ PR author), LEFT JOIN with users_pool for sentinel detection (sample from ghost pool → SENTINEL literal). FAIL-LOUD per CL-15 on any internal commenter-pool resolution miss (mirrors 335's name→UUID FAIL-LOUD pattern at `generate-demo-data.py:684-696`). Add the call site in the rollup-builder path that already emits `by_repository_comments`; emit `by_reviewer_comments` immediately after. Verify: T007 demo coherence guard PASSES.

### 2.5 — Aggregator emission (FR-1-01..12 + INV-4-07/08/12)

- [ ] T016 Implement `by_reviewer_comments` emission in `src/ado_git_repo_insights/transform/aggregators.py`. Add a new helper `_compute_weekly_by_reviewer_comments(week_pr_uids: set[str])` paralleling existing `_compute_weekly_by_author_comments` (`aggregators.py:1104`) and `_compute_weekly_by_repository_comments` (`aggregators.py:1239`). SQL pattern per `contracts/per-reviewer-comments-density.md` §2 — iterate `pr_comments` rows joined with `pull_requests` (INNER JOIN for self-comment exclusion `pr_comments.author_id != pull_requests.user_id` per CL-04 / FR-1-04) + `pr_threads` (LEFT JOIN for active-thread filter per FR-1-05) + `users` (LEFT JOIN for sentinel detection per CL-03 / FR-1-03); GROUP BY commenter_or_sentinel; use COUNT(DISTINCT thread_id) for `thread_count` and `COUNT(DISTINCT CASE WHEN t.status = 'active' THEN pc.thread_id ELSE NULL END)` for `active_thread_count` per FR-1-05; ORDER BY commenter_or_sentinel ASC for deterministic outer-dict key order. Use the same `_aggr_week_by_reviewer_comments_slice` temp-table pattern 334 / 335 use for the `week_pr_uids` slice (S608 compliance per `reference_s608_refactor_pattern.md`); bind the SENTINEL literal via parameter (`?` in CASE branch), NOT f-string interpolation. Compute the same-W `coverage_partial` flag (per FR-1-07 / CL-10) by querying for any PR in W's canonical set with `comments_extracted_at IS NULL`; apply this single boolean uniformly to ALL reviewer buckets in W. Add the call site in `_generate_weekly_rollups()` immediately after the `by_repository_comments` emission (`aggregators.py:741-745` pattern); if the helper returns a non-empty dict, emit `rollup_dict["by_reviewer_comments"] = ...`; if empty / None, omit the key entirely (FR-1-11 + FR-3-03 omission contract). FAIL-LOUD per FR-1-12 / CL-15: if any `pr_comments.author_id` value is NULL or non-UUID-format (32 hex + 4 hyphens), raise `RuntimeError` with a clear message identifying the offending row. Verify: T008 cases (i)–(xiv) PASS; T009 reconciliation PASSES; T010 meta-test xfail flips to xpass-strict-False on green demo, then fails on mutated demo as designed; T011 byte-identity PASSES.

### 2.6 — Schema extension (rollup.schema.ts)

- [ ] T017 [P] Extend `extension/ui/schemas/rollup.schema.ts` with: (a) new `ReviewerCommentsDensityEntry` interface (`thread_count: number; comment_count: number; active_thread_count: number; coverage_partial: boolean`); (b) optional `by_reviewer_comments?: Record<string, ReviewerCommentsDensityEntry>` field on the existing `Rollup` interface (add right after the existing `by_repository_comments` field at `rollup.schema.ts:197`); (c) `"by_reviewer_comments"` added to the `KNOWN_ROOT_FIELDS` set (right after the existing `"by_repository_comments"` near line 204); (d) new `validateReviewerCommentsDensity(value, path)` validator function alongside existing `validateAuthorCommentsDensity` (`rollup.schema.ts:868`) and `validateRepositoryCommentsDensity` — STRICT ERROR atomicity in both modes; numeric fields integer + non-negative; INV-4-07 ordering check per entry; empty-`{}` outer dict → ERROR per FR-1-11. Wire the validator at the rollup-root validation site. DO NOT extend the per-PR `PrRecord` declarations (locked by 310's schema-parity gate; CL-09 = follow 333 / 334 / 335 non-extension). Also extend the `Rollup` interface in `extension/ui/dataset-loader.ts` to add the matching `by_reviewer_comments?: Record<string, { thread_count: number; comment_count: number; active_thread_count: number; coverage_partial: boolean }>` field after the existing `by_repository_comments` at line 239. Verify: T012 schema tests PASS.

### 2.7 — Test floor accounting

- [ ] T018 Verify `.test-floor-contract.json` matches actual added test count after T007–T017. Sum: T007 (+6), T008 (+14), T009 (+3), T010 (+3), T011 (+4), T014 (+0) = +30 Python; T012 (+8), T013 (+1) = +9 Extension. Run `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml` locally to verify floor==actual on both Python and Extension suites. If actual differs from sum, reconcile by either correcting the floor or auditing T007–T017 for unintended test additions.

**Checkpoint 2 (Foundational complete)**: `rollup[W].by_reviewer_comments` is emitted by the aggregator under capability-on; demo generator emits the same namespace via parallel synthetic-stream path; schema validator accepts the new outer dict; reconciliation extension + meta-failure + byte-identity + F3 live-loader + T029 sentinel-collision-extension tests are GREEN. **All user stories can now begin.**

---

## Phase 3: User Story 1 — Identify highest-load reviewers at a glance (Priority: P1) 🎯 MVP

**Goal**: dashboard renders the new per-reviewer comment-density breakdown surface on the Metrics tab below the per-repo breakdown; team lead identifies the top-`comment_count` reviewer with no interaction beyond visual scan; partial-coverage qualifier prevents misreading partial-week rows; raw-`user_id` fallback ensures rows are never blank when the dimension entry is missing; sentinel branch renders fixed-string label "Former / unavailable author" for ghost commenters.

**Independent Test** (per spec): Open a demo dashboard with `capabilities.comments_metrics` enabled and ≥10 distinct commenters with mixed comment-load on PRs they didn't author. Confirm a chart titled with reviewer / density vocabulary renders below the 335 per-repo breakdown on the Metrics tab. Confirm rows are ordered by `comment_count` desc. Confirm the date-range filter narrows the visible set when changed. (US2 / US3 / US4 / US5 are NOT required for this test.)

### 3.1 — Chart-module test scaffolding (TDD)

- [ ] T019 [US1] Add `extension/tests/modules/charts/comments-reviewer-density.test.ts` chart unit tests. Cover FR-4-01..06, FR-4-08, FR-4-09, FR-4-10, FR-4-11, FR-4-12, idempotency: (a) chart renders rows for the top-50-by-`comment_count`-desc on a 12-reviewer fixture; each row shows reviewer display label + 3 numeric metrics; (b) chart re-renders correctly when range filter narrows; (c) chart renders truncation indicator when input exceeds the cap (53-reviewer fixture → 50 visible + truncation indicator; noun "reviewers"); (d) FR-4-03 partial-coverage qualifier on rows where reduced `coverage_partial` is `true`; tooltip text emphasizes **week-level** uncertainty per CL-10 directive (assert tooltip string contains "week" / "weekly" / "this week's" or similar week-level wording); (e) **all-zero row filter BEFORE sort/truncate** (FR-4-02 critical per kickoff lesson) — fixture with one all-zero reviewer + 50 non-zero reviewers; assert all-zero row absent regardless of which sort metric is active (test all three: `comment_count` / `thread_count` / `active_thread_count`); (f) deterministic UI tie-break per FR-4-05 — chosen-metric desc → display name asc → bucket key asc as final tie-breaker (covers a duplicate-display-name fixture from rename / fallback collision); (g) FR-4-09 no click-through (rows have no `data-drilldown-*` attribute or click handler); (h) FR-4-10 a11y — rows expose metrics via screen-reader-readable text; sort-selector buttons keyboard-activatable per WAI-ARIA Toolbar pattern; (i) chart-layer idempotency — calling render twice produces ONE chart, not two; (j) **FR-4-11 raw-`user_id` fallback** — fixture with one bucket whose `user_id` is absent from the `usersDimension` array; assert the rendered row label equals the raw ID (no blank, no row omission); (k) **FR-4-12 sentinel rendering (CL-03 / CL-05)** — fixture with one sentinel-keyed bucket (`__former_or_unavailable_author__`); assert the rendered row label equals "Former / unavailable author" REGARDLESS of whether `usersDimension` happens to contain an entry under the literal key (defensive precedence per CL-05 step 1); also assert the sentinel row participates in sort like other rows (NOT pinned to top or bottom); (l) **FR-4-08 no-data-in-range empty state** — fixture with `capabilities.comments_metrics: true` but visible date range yields zero contributions (all rollups missing `by_reviewer_comments` OR all entries reduce to zero after the all-zero filter); assert the chart renders the no-data-in-range empty state with a DOM marker visibly distinct from filter-not-supported (FR-4-07). Per A-14 kickoff lesson: query `.no-data` and `.no-data-hint` paragraphs SEPARATELY; enumerate per-state unique markers as named constants `FILTER_STATE_UNIQUE_MARKERS` / `NODATA_STATE_UNIQUE_MARKERS`; iterate cross-state exclusion to prove no marker leaks into the wrong empty state. Per A-15 kickoff lesson: design the fixture so all three sort orderings (`comment_count` / `thread_count` / `active_thread_count`) are DISTINCT; `expect(afterSpace).not.toEqual(afterEnter)` on the keyboard-activation assertions to catch vacuous-pass regressions where two metrics agree on ordering. Tests MUST currently FAIL (chart module doesn't exist). Bump `.test-floor-contract.json` Extension floor by 12 in same commit.

### 3.2 — Chart module implementation

- [ ] T020 [US1] Create new chart module at `extension/ui/modules/charts/comments-reviewer-density.ts` modeled on 334's `comments-author-density.ts` (sentinel branch) + 335's `comments-repository-density.ts` (all-zero filter pattern + week-agnostic FR-4-08). Reads `Rollup[]` and accesses `rollup[W].by_reviewer_comments` per week. Reduces per-reviewer across visible weeks: sums the 3 numeric fields; OR-reduces `coverage_partial` per FR-1-07 reduction rule. Accepts a `usersDimension?: readonly UserDirectoryEntry[]` option; build a `Map<string, string>` directory via a `buildUsersDirectory` helper paralleling 334's `buildAuthorsDirectory` + 335's `buildRepositoriesDirectory`. Display label resolution per CL-05 three-step lookup precedence: (1) sentinel branch — if `key === FORMER_OR_UNAVAILABLE_AUTHOR_KEY`, return `FORMER_OR_UNAVAILABLE_AUTHOR_LABEL` (renderer-local literals at the top of the module mirroring 334's pattern at `comments-author-density.ts:65-72`); (2) users-dimension lookup — `directory?.get(reviewerKey)`; (3) raw-`user_id` fallback. Display cap: declare `MAX_COMMENTS_REVIEWER_DENSITY_ROWS = 50`. Truncation indicator via shared `renderTruncationIndicator` from `chart-layout` with noun "reviewers". **All-zero filter BEFORE sort/truncate** (FR-4-02 critical): apply during the row-build loop before sort step + before top-50 cap (mirrors 335's pattern at `comments-repository-density.ts:335-341`). Does NOT add click-through. Verify: T019 cases (a)–(c), (e)–(k), but NOT yet (d) partial qualifier or (l) no-data which depend on next subtasks.
- [ ] T021 [US1] Implement partial-coverage visual qualifier in `comments-reviewer-density.ts` — reuse 333 / 334 / 335's `.coverage-partial` CSS class hook (no new class). Apply ONLY to rows where the row's reduced range-total `coverage_partial` is `true` (FR-4-03). Tooltip text MUST emphasize **week-level** uncertainty per CL-10 directive (e.g., "This week's comments extraction is partial; reviewer activity may be incomplete"); NOT bucket-specific text that the data cannot support. Verify: T019 case (d) PASS.
- [ ] T022 [US1] Implement the sort-selector UI control in `comments-reviewer-density.ts` per FR-4-05 — WAI-ARIA Toolbar pattern (`role="toolbar"` wrapper + plain `<button>` elements with default `tabindex=0` and `aria-pressed`); three buttons (`comment_count` / `thread_count` / `active_thread_count`); default selection `comment_count`. Each button is independently Tab-reachable; Enter / Space activates. (Sort behavior wiring — the click handler that re-renders with the new metric — is T026 in US2; this task covers ONLY the UI scaffold.) Apply the same tie-break-ternary collapse 334 / 335 applied to keep `.coverage-partial-branches-baseline.json` at zero growth.
- [ ] T023 [US1] Implement no-data and dimension-filter short-circuits at the top of the chart's render function. Filter-not-supported (FR-4-07): if any of `filters.{repos, teams, authors, reviewers}` is non-empty, render `renderNoData(container, "...filter-not-supported message...", "...hint...")` with a message visibly distinct from no-data-in-range. No-data-in-range (FR-4-08): when reduced rows are empty (capability-on but zero contributions, including after the all-zero filter), render distinct empty state with the per-state markers declared per A-14. Verify: T019 case (l) FR-4-08 empty state PASSES. (Tests for filter-not-supported in T030 — US5 phase.)
- [ ] T024 [US1] Add CSS styles for the new chart in `extension/ui/styles.css` — minimal additions only. Reuse 334 / 335's row-table layout rules + sort-selector button-group rules + active-button visual indicator (the 334 / 335 chart CSS already covers these patterns; the new chart's element IDs may require selector-list extensions only, no new rules). Reuse 333 / 334 / 335's `.coverage-partial` rule for the partial qualifier. If no CSS additions are needed (selectors already cover via class composition), this task is a no-op confirmation.
- [ ] T025 [US1] Register the new chart in `extension/ui/modules/charts/index.ts` barrel export. Add a one-line export for `comments-reviewer-density`.

### 3.3 — Dashboard wiring

- [ ] T026 [US1] Wire the new chart into `extension/ui/dashboard.ts` with two helper functions, mirroring 334 / 335's pattern (`dashboard.ts:1691-1810` covers the per-author + per-repo pair): (1) `ensureCommentsReviewerDensityContainer(): HTMLElement | null` — returns existing element if present (REUSE — no duplicate insertion); else builds the chart row from scratch via `document.createElement` chain, tags the row with `data-comments-reviewer-density-row="true"` for cleanup discoverability, AND ANCHORS the insertion against the per-repo row at `[data-comments-repository-density-row="true"]` (CL-11 — looks up the per-repo row, inserts the new row immediately after via `parentElement.insertBefore(newRow, perRepoRow.nextSibling)`); (2) `removeCommentsReviewerDensityContainer(): void` — finds any element matching `[data-comments-reviewer-density-row="true"]` and removes it (no-op if absent). On Metrics tab render: if `capabilityState?.commentsMetricsAvailable === true`, call `ensureCommentsReviewerDensityContainer()` → invoke the chart module's render function passing both the dashboard's `FilterState` AND `usersDimension = currentDimensions?.users?.map((u) => ({ user_id: u.user_id, display_name: u.display_name }))` (mirrors `dashboard.ts:1134-1138` pattern). If capability-off, call `removeCommentsReviewerDensityContainer()`. At any moment when capability is off, Metrics tab DOM MUST be byte-identical to pre-feature (FR-3-01 + SC-1-03 + FR-3-02 lifecycle parity; tests in T028 below).

**Checkpoint US1**: per-reviewer breakdown chart renders on the Metrics tab below the 335 per-repo row when capability-on; rows ordered by `comment_count` desc; sort selector visible (default `comment_count` active); partial-coverage qualifier on partial rows with week-level tooltip; raw-`user_id` fallback honored; sentinel rendering honored ("Former / unavailable author" label for SENTINEL-keyed buckets); range filter honored; T019 all green. US1 deliverable is INDEPENDENTLY verifiable per the spec's Independent Test.

---

## Phase 4: User Story 2 — Toggle the chosen sort metric (Priority: P2)

**Goal**: clicking each of the three sort-metric buttons re-orders rows; deterministic tie-break is reproducible across reloads (display name asc → bucket key asc as final tie-breaker per FR-4-05).

**Independent Test**: With the chart rendered (US1), activate each sort-metric option. Confirm rows re-order and the active metric is visually indicated. Tie-break order is reproducible across reloads.

### 4.1 — Sort toggle test scaffolding

- [ ] T027 [US2] Add tests to `extension/tests/modules/charts/comments-reviewer-density.test.ts` (extending T019's file). Cases: (a) clicking the `thread_count` button re-orders rows by `thread_count` desc; the `aria-pressed` indicator updates to mark `thread_count` as the active button; (b) clicking the `active_thread_count` button re-orders by `active_thread_count` desc; (c) tie-break is reproducible across page reloads under the same dataset (use a fixture with deliberate ties on `comment_count` AND on display name; verify final order is determined by bucket key per FR-4-05); (d) keyboard activation (Enter / Space on a focused button) re-orders correctly; per A-15 kickoff lesson, the three sort orderings are DISTINCT — `expect(afterSpace).not.toEqual(afterEnter)` catches vacuous-pass. Tests MUST currently FAIL (T022 wired the UI skeleton but not the toggle behavior). Bump `.test-floor-contract.json` Extension floor by 4 in same commit.

### 4.2 — Sort toggle implementation

- [ ] T028 [US2] Wire the three sort-selector buttons in `comments-reviewer-density.ts` (extending T022's UI scaffold) to update the chart's selected metric and re-render rows. Tie-break order: chosen metric desc → display name asc → bucket key asc as the final deterministic tie-breaker. Apply the same tie-break-ternary collapse 334 / 335 used. Verify: T027 cases (a)–(d) PASS.

**Checkpoint US2**: sort toggle works with deterministic tie-break. T027 green.

---

## Phase 5: User Story 3 — Capability-off renders byte-identical to the prior baseline (Priority: P3)

**Goal**: datasets without `capabilities.comments_metrics` MUST see the dashboard render identically to the pre-feature baseline — no per-reviewer breakdown container, no shifted layout, no new banner. Capability flips on / off MUST clean up correctly.

**Independent Test**: Load a dataset variant with `capabilities.comments_metrics: false`. Confirm the Metrics tab renders identically to the pre-feature baseline (existing chart surfaces including the 335 per-repo row at pre-feature positions; no per-reviewer breakdown container).

### 5.1 — Dashboard lifecycle test (extension-side capability-off byte-identity)

- [ ] T029 [US3] Add an extension dashboard-lifecycle test at `extension/tests/dashboard/comments-reviewer-density-lifecycle.test.ts`. Test 4 scenarios per FR-3-01 + FR-3-02 + SC-1-03: (a) **Initial capability-off**: with `capabilities.comments_metrics: false` from the start, no element with `id="comments-reviewer-density"` is mounted; no element with `[data-comments-reviewer-density-row="true"]` is mounted; the existing chart surfaces (333 comments-trend + 334 per-author + 335 per-repo also omitted per their respective FR-3-01) occupy the same layout positions; the Metrics tab DOM is byte-identical to the pre-feature baseline. (b) **On→off transition**: render dashboard once with capability-on (chart row inserted via `ensureCommentsReviewerDensityContainer`), reload with capability-off, assert `removeCommentsReviewerDensityContainer` cleaned up — no `id="comments-reviewer-density"`, no `[data-...]` attribute, layout pristine. (c) **Off→on transition**: render with capability-off, reload with capability-on, assert chart row inserted exactly once, positioned BELOW the 335 per-repo row (assert `[data-comments-reviewer-density-row]`'s previous sibling is `[data-comments-repository-density-row]`). (d) **On→on re-render idempotency**: render the FULL DASHBOARD render path twice consecutively with capability-on. Assert exactly ONE `[data-comments-reviewer-density-row="true"]` element exists; exactly ONE `<div id="comments-reviewer-density">` exists; rows inside the chart are not duplicated from the first render. **Source-parse binding per A-13 kickoff lesson**: read `dashboard.ts` as text and use `dashboardSrc.indexOf` + `expect.toContain` to assert the `ensureCommentsReviewerDensityContainer` / `removeCommentsReviewerDensityContainer` call sites are present in the production source. Without this, lifecycle tests verify the test harness, not production. Bump `.test-floor-contract.json` Extension floor by 4 in same commit.

(Capability-off byte-identity at the rollup / manifest level is already covered by T011 in Phase 2.)

**Checkpoint US3**: capability-off renders pre-feature baseline; FR-3-03 byte-identity test (T011) green; FR-3-02 lifecycle test (T029) green.

---

## Phase 6: User Story 4 — Sentinel rendering for "Former / unavailable author" (Priority: P3)

**Goal**: datasets containing ≥1 ghost commenter render exactly ONE row labeled "Former / unavailable author" aggregating ALL such commenters' contributions; sentinel row participates in sort like real-reviewer rows.

**Independent Test**: With ghost commenters present in the demo dataset (per CL-14 step 4 / T015), the chart renders exactly one sentinel row labeled "Former / unavailable author"; activating different sort metrics — sentinel row participates in the new sort order using its summed metric value (NOT pinned to top or bottom).

### 6.1 — Sentinel-specific tests

- [ ] T030 [US4] Add tests to `extension/tests/modules/charts/comments-reviewer-density.test.ts` (extending T019 / T027). Cases: (a) fixture with 3 distinct ghost commenters' contributions in a single demo week (per CL-14 ghost-commenter inclusion) — assert exactly ONE row labeled "Former / unavailable author" appears with metrics equal to the sum of all 3 ghost-commenter contributions; no per-ghost-commenter rows appear; (b) sentinel row participates in sort exactly like real-reviewer rows — fixture where the sentinel's `comment_count` is the median value; assert sorting by `comment_count` places the sentinel row in the middle (NOT top, NOT bottom); switching to `thread_count` re-positions the sentinel based on its summed thread_count; (c) zero-ghost-commenter range — fixture where no week in the visible range has ghost commenters; assert no sentinel row appears. Bump `.test-floor-contract.json` Extension floor by 3 in same commit.

(Sentinel branch implementation is already in T020 — chart module skeleton includes the FORMER_OR_UNAVAILABLE_AUTHOR_KEY check in `resolveDisplayName`. T030 adds the user-story-specific tests proving it works on demo-shaped fixtures.)

**Checkpoint US4**: sentinel rendering works correctly on demo-shaped fixtures. T030 green.

---

## Phase 7: User Story 5 — Filter-not-supported posture (Priority: P3)

**Goal**: when ANY dashboard dimension filter is active (`repos` / `teams` / `authors` / `reviewers`), the breakdown surface shows a self-explanatory filter-not-supported empty state instead of rows. Disappears cleanly when filters are cleared. The `reviewers` filter explicitly triggers this empty state — narrowing to a single reviewer hides the multi-reviewer comparison surface per spec design.

**Independent Test**: With the chart rendered (US1), apply any dashboard dimension filter. Confirm filter-not-supported empty state appears (visibly distinct from no-data-in-range); clear filter, confirm rows reappear.

### 7.1 — Filter-not-supported tests

- [ ] T031 [US5] Add tests to `extension/tests/modules/charts/comments-reviewer-density.test.ts` (extending T019 / T027 / T030): (a) any of `filters.{repos, teams, authors, reviewers}` non-empty → render shows filter-not-supported empty state; (b) clearing the filter restores the rows; (c) filter-not-supported empty state is visibly distinct from no-data-in-range (FR-4-08) — different message text, different DOM marker. Per A-14 kickoff lesson: query `.no-data` and `.no-data-hint` paragraphs SEPARATELY; assert FILTER_STATE_UNIQUE_MARKERS appear ONLY when filters are active and NODATA_STATE_UNIQUE_MARKERS appear ONLY when no contributions in range; iterate cross-state exclusion. Bump `.test-floor-contract.json` Extension floor by 3 in same commit.

(Filter-not-supported short-circuit logic was implemented in T023. T031 adds the tests proving it works.)

**Checkpoint US5**: filter-not-supported empty state renders correctly when any filter is active.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: regenerate every managed artifact via the canonical sync + rebuild docs/data/ via build-demo-dataset.py, verify ratchet + coverage parity. Per memory `feedback_canonical_artifact_sync_one_task.md`, the canonical sync drives ALL managed outputs in ONE task — no per-managed-path manual regenerate tasks.

- [ ] T032 Regenerate ALL managed artifacts via the canonical commands (run sequentially in this single task): (1) `python scripts/manage_generated_artifacts.py sync --scope all --stage` — drives `extension/ui/dist/` esbuild rebuilds (for the new chart module), `docs/` shell, broken-docs fixtures, and any sibling managed paths the canonical sync touches; (2) `uv run --python 3.12 python scripts/build-demo-dataset.py` — rebuilds `docs/data/` per memory `feedback_managed_artifacts_excludes_demo_data.md` (NOT covered by sync; demo dataset gains the `by_reviewer_comments` namespace under capability-on); (3) `python scripts/manage_generated_artifacts.py verify` — confirms working tree clean against the index post-stage. The `--stage` flag is REQUIRED (without it, the verify gate fails).
- [ ] T033 [P] Ratchet bump sanity check: `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml`. Confirm floor == actual on both Python and Extension. Cumulative target across all phases: +29 Python (T007 +6, T008 +13, T009 +3, T010 +3, T011 +4, T014 +0) + +35 Extension (T012 +8, T013 +1, T019 +12, T027 +4, T029 +4, T030 +3, T031 +3). If drift detected, reconcile (correct the floor or audit task commits for unintended test additions). NO `[ratchet-realignment]` marker should be needed for a clean foundation PR.
- [ ] T034 [P] Coverage delta check: `python scripts/check_coverage_delta.py`. Confirm ≤ 2% drop vs `.coverage-baseline.json` per QG-52. NO `[threshold-update]` marker should be needed.
- [ ] T035 [P] Partial-branches ratchet sanity check: `pnpm --dir extension run test:partial-branches` (**outside form** per kickoff lesson — NOT `pnpm run test:partial-branches` inside form). Confirm zero growth vs `.coverage-partial-branches-baseline.json`. The tie-break-ternary collapse applied in T022 + T028 keeps the chart-module's branches at zero growth; if the baseline shows growth, audit the chart module for defensive branches that need either elimination via refactor or coverage via mutation-based tests (NOT a baseline bump).

**Checkpoint**: All managed artifacts staged + clean; ratchet + coverage + partial-branches gates green.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: ADRs R001–R006 already pinned in research.md — confirmation only; no dependencies.
- **Foundational (Phase 2)**: BLOCKS all user stories. Demo coherence guard (T007 — FIRST per ADR R005) → Test scaffolding (T008–T013) → T029 sentinel-collision extension (T014) → Demo synthetic streams + helper (T015) → Aggregator emission (T016) → Schema extension (T017) → Floor accounting (T018).
- **US1 (Phase 3, MVP)**: Depends on Foundational complete.
- **US2 (Phase 4)**: Depends on Foundational + US1 (chart module + sort-selector UI scaffold from T022).
- **US3 (Phase 5)**: Depends on Foundational + US1 (dashboard wiring from T026).
- **US4 (Phase 6)**: Depends on Foundational + US1 (chart module sentinel branch from T020 + demo synthetic streams from T015 with ghost-commenter inclusion).
- **US5 (Phase 7)**: Depends on Foundational + US1 (filter-not-supported short-circuit from T023).
- **Polish (Phase 8)**: Depends on all of the above being complete.

### User Story Dependencies

- **US1 (P1, MVP)**: First user story; all others depend on its chart module + dashboard wiring.
- **US2–US5 (P2, P3)**: All depend on US1's chart module. Can run in parallel with each other after US1 completes (different test cases within shared test files; the `.test-floor-contract.json` bump per commit is the synchronization point, not the source files).

### Within Each User Story

- Tests (T019, T027, T029, T030, T031) MUST be written and FAIL before implementation.
- Chart module skeleton (T020) before partial qualifier (T021) before sort-selector UI scaffold (T022) before short-circuits (T023).
- Sort toggle implementation (T028) extends T022's UI scaffold.
- Story complete before moving to next priority.

### Parallel Opportunities

- ADR confirmation (T001–T006): all parallel within Setup.
- T007 (demo coherence guard) MUST be first per ADR R005 — does not parallelize with T008+.
- T012 (extension schema tests) + T013 (F3 live-loader regression) parallel with T008–T011 (Python tests) within Phase 2.2 (different files / runtimes).
- T017 (schema extension) parallel with T015 (demo synthetic streams) + T016 (aggregator emission) within Phase 2 (different files).
- US2 / US3 / US4 / US5 phases: can run in parallel after US1 completes (different test cases within `extension/tests/...` test files).
- T033 / T034 / T035 (ratchet + coverage + partial-branches checks) parallel within Polish.

---

## Parallel Example: Foundational Phase

```bash
# T007 demo coherence guard FIRST (per ADR R005):
Task: T007 demo synthetic-stream coherence guard at tests/unit/test_demo_synthetic_pr_comments.py

# After T007 lands + RED, test-first scaffolding launches in parallel where files differ:
Task: T008 producer unit tests at tests/unit/test_aggregators_reviewer_comments.py
Task: T009 reconciliation extension at tests/integration/test_comments_trend_reconciliation.py
Task: T011 byte-identity extension at tests/integration/test_demo_variants_byte_identity.py
Task: T012 schema validator tests at extension/tests/schema/rollup.test.ts
Task: T013 F3 live-loader regression at extension/tests/artifact-client.test.ts

# T014 T029 sentinel-collision extension is independent (extends an existing test):
Task: T014 widen tests/unit/test_aggregators_author_comments.py:514 assertion list

# After tests are written + failing, implementation in parallel where files differ:
Task: T015 demo synthetic streams + helper at scripts/generate-demo-data.py
Task: T016 aggregator emission at src/ado_git_repo_insights/transform/aggregators.py
Task: T017 schema extension at extension/ui/schemas/rollup.schema.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (ADRs already pinned — confirmation only).
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories; T007 demo coherence guard FIRST per ADR R005).
3. Complete Phase 3: User Story 1 — chart renders.
4. **STOP and VALIDATE**: Test US1 independently per the spec's Independent Test.
5. Deploy / demo if ready.

### Incremental Delivery

1. Setup + Foundational → Foundation ready.
2. US1 → Test independently → Deploy / Demo (MVP).
3. US2 (sort toggle) → Test independently → Deploy / Demo.
4. US3 (capability-off lifecycle) → Test independently → Deploy / Demo.
5. US4 (sentinel rendering) → Test independently → Deploy / Demo.
6. US5 (filter-not-supported posture) → Test independently → Deploy / Demo.
7. Polish → Final cohesive check + canonical artifact sync + demo rebuild.

### Parallel Team Strategy

After Foundational completes:
- Developer A: US1 (chart module + dashboard wiring, the MVP).
- Developer B: US2 (sort toggle — can start once US1 chart module skeleton + UI scaffold exist).
- Developer C: US3 (capability-off lifecycle test — can start once US1 dashboard wiring exists).
- Developer D: US4 (sentinel rendering tests — can start once US1 chart module skeleton exists).
- Developer E: US5 (filter-not-supported tests — once US1 short-circuit T023 exists).

---

## Notes

- **Cumulative test additions**: Phase 2 +29 Python +9 Extension; Phase 3 +12 Extension; Phase 4 +4 Extension; Phase 5 +4 Extension; Phase 6 +3 Extension; Phase 7 +3 Extension. **Cumulative target**: +29 Python + +35 Extension across the PR. Verified at task time via `scripts/check_ratchet_bump.py` (T033). Note: the original T008 plan listed 14 cases; case (xii) NULL author_id was dropped during T008 implementation because the FR-1-12 NULL clause is structurally unreachable through the production SQL path (CASE always maps absent-user to sentinel; `pr_comments.author_id NOT NULL` prevents NULL at INSERT). The defensive NULL check in T016's helper is retained for forward-compat but no test exercises it.
- **Constitution gates**: every commit honors QG-38 (no `--no-verify`), QG-39 (cross-OS), QG-40 (no `typing.Any`), QG-41 (zero new suppressions), QG-43 (per-commit ratchet bump). The QG-50 bypass markers are subject-line-only; no markers are expected for a clean foundation PR.
- **Schema-parity gate (CL-09)**: NOT extended for the new namespace. The reconciliation test (T009) is the parity authority for `by_reviewer_comments`.
- **Import-block isolation (333 round-9 / 334 / 335 propagation)**: extends automatically for T009 / T010 since the `aggregators.py` import-forbid is by-FILE not by-dimension.
- **Sentinel collision-safety (T014)**: per kickoff directive, EXTEND the existing #334 T029 test in-place — widen its assertion list to also cover `pr_comments.author_id` UUIDs. NO new test file, NO duplicated test logic. The `.test-floor-contract.json` bump for T014 is +0 because no new test functions are added.
- **Demo synthetic streams (T015)**: required per CL-14 + ADR R002. T007 (coherence guard) is the FIRST test in Phase 2 per ADR R005 / kickoff lesson "demo key-shape verification — do this FIRST". Without T015, byte-identity tests on the demo dataset would pass vacuously because the demo path emits no `by_reviewer_comments` key at all (Codex caught analogous shape mismatches on #334 / #335).
- **Canonical artifact sync (T032)**: the SINGLE task for regenerating managed artifacts. Drives `extension/ui/dist/` (esbuild) + `docs/` shell via `manage_generated_artifacts.py sync --scope all --stage`, plus `docs/data/` via `scripts/build-demo-dataset.py` (the latter is required separately per memory `feedback_managed_artifacts_excludes_demo_data.md`). Per-managed-path manual regenerate tasks are explicitly forbidden by user directive.
- **Sentinel applies (CL-03 / INV-4-12)**: divergence from #335's no-sentinel posture. The `FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL` literal is REUSED verbatim from `transform/constants.py:27`; the renderer-side label "Former / unavailable author" is REUSED verbatim from #334's `comments-author-density.ts:72` per cross-feature consistency directive.
- **NO abstraction extraction**: per A-08 / ADR R006, the chart module is a duplicated-then-extract candidate; the abstraction will be informed by all THREE concrete instances (per-author + per-repo + per-reviewer) at a follow-up feature, not by two-instance extraction now.
- **NO new wall-clock performance assertions**: chart-render budget is governed by QG-28's existing 1000ms / 156-week scalability gate; aggregator runtime is governed by existing producer test-suite wall-clock budgets only. Single-run wall-clock assertions are CI-flake bait per memory `feedback_flake_fix_is_policy_decision.md`.
- **Partial-branches ratchet (T035)**: zero growth enforced; outside-form `pnpm --dir extension run test:partial-branches` per kickoff lesson. T022 + T028 apply 334 / 335's tie-break-ternary collapse pattern proactively to avoid the ratchet trap.
- **#348 perf-budget flake non-absorption**: per A-16 / memory `feedback_do_not_absorb_flakes_into_feature_scope.md`. If observed in CI, retry once per memory `feedback_one_push_attempt_policy.md`.
