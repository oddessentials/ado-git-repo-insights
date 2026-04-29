# Research: Dashboard per-reviewer comment density breakdown

**Feature**: 336-comments-reviewer-density
**Phase**: 0 (research consolidation)
**Created**: 2026-04-29
**Spec**: [spec.md](./spec.md) — all 15 CL-axes locked (Path B by user directive 2026-04-29)

This file consolidates the genuinely new ADRs (R001 – R006) for this feature. Eight axes inherited verbatim from #334 / #335 (CL-01 emission shape, CL-02 filter posture, CL-07 cap/sort, CL-08 click-through, CL-09 schema-parity scope, plus 333's pattern foundations) require no further research — they are silently inherited and recorded in spec.md Background. The four substantive divergences from #334 / #335 (sentinel re-applied, reviewer semantics, iteration unit `pr_comments`, demo synthetic stream) and one new contract shape (FR-2-03 sum-coherence vs INDEPENDENT count) drive the six ADRs below.

---

## ADR R001: Chart module file name + sentinel + display-label-fallback wiring

**Decision**: New module at `extension/ui/modules/charts/comments-reviewer-density.ts`, modeled on the merged-on-main `extension/ui/modules/charts/comments-author-density.ts` (PR #349, for the sentinel branch) and `extension/ui/modules/charts/comments-repository-density.ts` (PR #350, for the all-zero filter pattern). Differences from both siblings:

- Reads `rollup[W].by_reviewer_comments` instead of `rollup[W].by_author_comments` / `rollup[W].by_repository_comments`.
- Takes a `usersDimension?: readonly UserDirectoryEntry[]` option (entry shape: `{ user_id?: string; display_name?: string }`).
- Display label resolution (CL-05 — three-step lookup precedence):
  1. **Sentinel branch (highest precedence)**: when the bucket key equals `FORMER_OR_UNAVAILABLE_AUTHOR_KEY` (renderer-local literal mirroring 334's pattern at `comments-author-density.ts:65`), render the fixed-string label "Former / unavailable author" (`FORMER_OR_UNAVAILABLE_AUTHOR_LABEL` constant; reuse 334's literal verbatim per cross-feature consistency directive).
  2. **Users-dimension lookup**: when the bucket key is a non-sentinel `user_id`, render `display_name` from the matching dimension entry.
  3. **Raw-`user_id` fallback**: when the bucket key is a non-sentinel `user_id` AND the dimension entry is missing, render the raw `user_id` value.
- All-zero row filter BEFORE sort/truncate (FR-4-02 critical lesson from kickoff comment 2 / #335 session): `if (bucket.thread_count === 0 && bucket.comment_count === 0 && bucket.active_thread_count === 0) continue;` — applied during the row-build loop before sorting + before the top-50 cap. Mirrors 335's pattern at `comments-repository-density.ts:335-341`.
- Tooltip text on partial-coverage qualifier (FR-4-03) MUST emphasize **week-level** uncertainty per CL-10 directive — e.g., "This week's comments extraction is partial; reviewer activity may be incomplete." NOT bucket-specific text that the data cannot support.
- Tie-break ordering (FR-4-05): chosen-metric desc → display name asc → bucket key asc. Implementation MUST collapse the secondary/tertiary into a single ternary expression (mirrors 334 / 335's `compareRows` pattern) so `.coverage-partial-branches-baseline.json` does not grow.
- `MAX_COMMENTS_REVIEWER_DENSITY_ROWS = 50` constant (CL-07 / FR-4-06).

**Rationale**: The 334 chart module provides the sentinel branch + label-mapping pattern; the 335 chart module provides the all-zero filter and FK-protected display-label fallback pattern. The new chart is a hybrid of both — sentinel branch presence (closer to 334) with the all-zero filter and label-fallback pattern (closer to 335). Duplicate-then-extract is the deliberate posture per A-08 / memory `feedback_no_invented_abstractions.md` / ADR R006; abstraction extraction is informed by all three concrete instances at a follow-up feature.

**Alternatives considered & rejected**:

- Extend the 334 chart module by parameterizing on `bucketKind: "author" | "reviewer"`: trap warned about by `feedback_no_invented_abstractions.md`. Two-instance extraction is too early; the per-repo dimension already proves divergent paths exist (#335 has no sentinel; #336 has sentinel but iterates differently). ADR R006 defers extraction to a follow-up.
- Render `user_id` raw without the dimension lookup (skip CL-05 step 2): forces the user to read UUIDs; rejected at spec time.
- Apply the all-zero filter AFTER sort/truncate: rejected per FR-4-02 + kickoff lesson — sorting by `active_thread_count` would otherwise hide reviewers with comments / threads but no active threads.
- Use a separate "Former / unavailable reviewer" label string for semantic accuracy: rejected per cross-feature consistency directive (kickoff comment 1: "same renderer-side fixed label 'Former / unavailable author' (CL-03 inheritance)") + consolidates renderer label set.

**Spec anchors**: CL-03, CL-05, CL-07, CL-10, FR-4-01, FR-4-02, FR-4-03, FR-4-05, FR-4-11, FR-4-12, A-08.

---

## ADR R002: Demo synthetic commenter stream design (NEW for this feature)

**Decision**: Add two NEW internal per-week parallel lists in `scripts/generate-demo-data.py` alongside `synthetic_prs_full`, populated such that re-aggregating them yields each PR's pre-existing PrRecord aggregate counts. NOT serialized to rollup files (privacy posture; only aggregated `by_reviewer_comments` keys ship).

**Precondition (added post-Codex-stop-time-review on the T007 commit)**: the existing demo generator at `generate-demo-data.py:486-493` previously emitted PrRecords with `(thread_count=0, comment_count>0)` "drive-by system comments" — a synthetic abstraction that violates the production schema FK at `models.py:170` (`pr_comments.thread_id NOT NULL` + FK to `pr_threads`). The Codex stop-time review on the T007 commit identified that CL-14's "Total count per PR MUST match `comment_count` aggregate" + "each emitted thread MUST have ≥1 comment" rules + production-schema FK semantics jointly forbid the unsatisfiable `(thread_count=0, comment_count>0)` shape. This ADR's implementation includes a small, byte-identity-preserving fix to the demo generator: enforce `comment_count = 0` when `thread_count = 0`; consume-and-discard the historical `randint(0, 3)` draw so the rest of the RNG sequence (and every other field in the demo's serialized output) stays in lockstep with pre-#336 state. The fix lands BEFORE T015's helper implementation so T015 can iterate `synthetic_prs_full` without special-casing the unsatisfiable shape.

**Stream shapes**:

```python
# In the demo generator's per-week aggregation loop, alongside synthetic_prs_full:
synthetic_pr_threads: list[SyntheticPrThread] = []   # {pull_request_uid, thread_id, status, is_deleted}
synthetic_pr_comments: list[SyntheticPrComment] = [] # {pull_request_uid, thread_id, author_id (commenter), is_deleted}
```

**Generation rules** (per CL-14):

1. **Per-PR thread synthesis**: for each PR P with non-NULL `thread_count`, emit `P.thread_count` synthetic thread records. Mark `P.active_thread_count` of them with `status='active'` (chosen deterministically — first N by thread_id sort). Remaining threads get `status='fixed'` (or another non-active value). All threads have `is_deleted=0` per C1.
2. **Per-PR comment synthesis**: for each PR P with non-NULL `comment_count`, emit `P.comment_count` synthetic comment records. Distribute commenters across threads such that each emitted thread has ≥1 comment (no orphan threads). Sample commenter `author_id` deterministically from the existing user pool (`author_pool` at `generate-demo-data.py:450-451`) excluding the PR's author. Sample MUST use the existing `init_random` seed for determinism (mirrors `pr_record_rng` pattern at line 465). All comments have `is_deleted=0` per C1.
3. **Coherence guard** (per CL-14 step 3): re-aggregating `synthetic_pr_threads` + `synthetic_pr_comments` per PR P MUST yield P's pre-existing PrRecord `thread_count` (count of synthetic_pr_threads rows for P) / `comment_count` (count of synthetic_pr_comments rows for P) / `active_thread_count` (count of synthetic_pr_threads rows for P with status='active'). A unit test at `tests/unit/test_demo_synthetic_pr_comments.py` asserts this guard.
4. **Ghost-commenter inclusion** (per CL-14 step 4): ≥1 demo week MUST include synthetic ghost commenters (UUIDs sampled from a synthetic ghost pool absent from the seeded `users` table). The aggregator's LEFT JOIN `users` will not find them, and the sentinel branch maps them to the SENTINEL literal. This exercises the per-reviewer sentinel reconciliation branch non-vacuously (mirrors #334's GHOST_USER_ID extension at `tests/fixtures/sc05/fixture_builder.py:80`).

**Rationale**: The demo generator currently has NO `pr_comments` stream — only PR-level aggregate counts at `generate-demo-data.py:476-503`. The per-reviewer dimension fundamentally requires comment-level granularity (commenter identity per row, thread participation per commenter) which the existing aggregate counts cannot provide. Adding synthetic streams that round-trip through re-aggregation to produce the existing PrRecord counts is the cleanest extension — it preserves all existing test assertions on the rollup file's serialized shape (byte-identity tests, schema validation, drill-down PrRecord parity) while enabling per-reviewer aggregation downstream.

**Alternatives considered & rejected**:

- Add a per-PR `commenter_distribution` field directly to PrRecord: would require schema-parity gate extension (rejected per CL-09); pollutes the per-PR drill-down's PrRecord schema with reviewer-aggregate fields that don't belong there.
- Generate `pr_comments` rows during the production path's database population: out of scope (this is a demo-only path; the production path gets real data from extraction).
- Skip ghost-commenter inclusion and rely on the GHOST_USER_ID fixture in `tests/fixtures/sc05/fixture_builder.py` only: would not cover the demo dataset's per-reviewer sentinel rendering — the demo dashboard's US4 acceptance scenario requires ghost commenters in the visible range.
- Use raw repository_name → UUID resolution (mirroring 335's pattern at `generate-demo-data.py:684-696`): not applicable — commenter author_ids are already UUIDs in the demo pool (sampled from `author_pool` at line 450-451 which holds `str(generate_uuid(...))` values from `generate_uuid` at line 726).

**Spec anchors**: CL-14, FR-1-03, FR-1-04, FR-1-05, A-09, A-12.

---

## ADR R003: Cross-aggregate parity test placement (NEW shape for this feature)

**Decision**: Extend `tests/integration/test_comments_trend_reconciliation.py` in-place (CL-06) with a NEW `test_by_reviewer_comments_parity_vs_independent_count` assertion. The test:

1. Iterates every week W in the demo dataset where `capabilities.comments_metrics` is enabled AND `rollup[W].by_reviewer_comments` is non-empty.
2. For each such W: computes `SUM_R(by_reviewer_comments[R].comment_count)` (left-hand side).
3. Computes the right-hand side INDEPENDENTLY by direct SQL: `SELECT COUNT(*) FROM pr_comments pc INNER JOIN pull_requests pr ON pc.pull_request_uid = pr.pull_request_uid WHERE pc.pull_request_uid IN (W's canonical extracted-subset) AND pc.author_id != pr.user_id AND pc.is_deleted = 0`. The test MUST NOT reference `rollup[W].comments.comment_count` as the right-hand side (which would over-count by the self-comment delta).
4. Asserts equality of left-hand and right-hand sides.
5. Asserts `OR_R(by_reviewer_comments[R].coverage_partial)` EQUALS `rollup[W].comments.coverage_partial` (drift guard against CL-10 same-W lock breakage).
6. Does NOT assert sum-coherence for `thread_count` or `active_thread_count` (per CL-12 — multi-counting metrics; FR-2-02's per-bucket re-computation covers correctness).
7. Auto-discovers truncated weeks via `_prs_truncated: true` introspection — the test is week-agnostic (does NOT hard-code W26). At least one truncated week MUST be present in the demo (asserted by a separate guard), but which week is truncated is allowed to drift across demo regenerations per A-11.
8. Pre-loop guard: assert that at least ONE week W in the demo dataset satisfies "both `comments` AND `by_reviewer_comments` are emitted (non-empty)" — otherwise the parity loop iterates zero weeks and silently passes (no positive control). The guard fails loudly with a clear message identifying that demo regeneration has shifted the witness; mirrors 335 T006's pre-loop guard.

**Rationale**: Per-reviewer sum-coherence is fundamentally NOT equal to `comments.comment_count` (which counts ALL comments including PR-author self-comments), so the 334 / 335 pattern of comparing `SUM_dimension(*).comment_count` to `comments.comment_count` directly does NOT apply. The independent count via direct SQL is the correct right-hand side — it computes the same eligible-reviewer-comment count the per-reviewer aggregator should produce, but via a separate code path. This makes FR-2-03 a meaningful cross-aggregate consistency check rather than a tautology.

`thread_count` and `active_thread_count` sum-coherence are NOT assertable at FR-2-03 level because they multi-count: a thread with N distinct non-self commenters contributes N to `SUM_R(thread_count)` but only 1 to `comments.thread_count` (or to a corresponding "distinct eligible threads in W" independent count). FR-2-02's per-bucket independent re-computation covers thread_count correctness at the load-bearing level.

The `coverage_partial` OR-coherence assertion is tautological under CL-10 same-W lock (every reviewer in W shares W's flag value), but it's still useful as a producer-side bug guard against drift — e.g., a future regression where the producer fails to propagate the W-wide flag uniformly across reviewers in W (perhaps applying a faulty bucket-specific calculation that happens to agree with same-W on most data but drifts on edge cases). The assertion catches such drift even if it never fails in well-formed data.

The test runs in-place to 333's reconciliation file because the import-block isolation (`tests/integration/test_comments_trend_reconciliation_isolation.py`) is enforced by FILE, not by test function; adding new assertions to the existing file does not weaken the isolation invariant.

**Alternatives considered & rejected**:

- Compare `SUM_R(comment_count)` to `comments.comment_count`: rejected — over-counts by self-comment delta. Always fails on any week with self-comments. Not a meaningful contract.
- Compare to `comments.comment_count - self_comment_count` (compute self-comment count separately): the same independent count via direct SQL, but framed as a delta. Equivalent to the chosen formulation; the chosen direct-count framing is cleaner because the self-comment exclusion is part of the eligible-reviewer-comment definition (CL-04), not a post-hoc subtraction.
- Hard-code W26 as the witness: would fail on any demo regeneration that shifts the truncation. Rejected — week-agnostic discovery is more robust per A-11.
- Parallel test file `tests/integration/test_by_reviewer_comments_parity.py`: adds duplicate import-block-guard machinery; same reasoning as 334 Decision 5 / 335 ADR R002.
- Run parity only on truncated weeks: weakens coverage. The contract holds on EVERY week where both aggregates are emitted; testing on every such week catches more failure modes (e.g., a regression where a non-truncated week's per-reviewer sum drifts).
- Test parity at the producer side via direct SQL re-summation: that's what FR-2-02's independent re-computation already does at the per-(W, R) level. The cross-aggregate parity is the consistency check between the aggregator's output and an independently-computed reference count, which is a strictly stronger property than either individual independent re-computation guarantees alone.
- Assert sum-coherence for `thread_count` / `active_thread_count` with a multi-counting bound (e.g., `SUM_R(thread_count) >= comments.thread_count`): the bound holds but provides weak signal — a producer bug that simply emits the wrong (lower) count per bucket would still satisfy the bound. FR-2-02's exact-equality per bucket is a strictly stronger check.

**Spec anchors**: CL-12, FR-2-03, FR-2-04, INV-4-10, INV-4-13, SC-1-06, A-11.

---

## ADR R004: Failure-mode meta-test extension (FR-2-05)

**Decision**: Extend `tests/integration/test_comments_trend_meta_failure.py` in-place with THREE new injection cases:

- **(a) Per-(week, reviewer) INV-4-07 violation**: mutate one bucket so `active_thread_count > thread_count`; assert FR-2-04 reconciliation test FAILS on the mutated copy. (Mirrors 334 / 335 pattern.)
- **(b) Per-week sum-coherence violation**: mutate one bucket's `comment_count` (e.g., subtract 1) so the per-reviewer sum no longer matches the INDEPENDENT count from FR-2-03's right-hand side; assert FR-2-04 reconciliation test FAILS on the mutated copy.
- **(c) Self-comment-leak violation (NEW for this feature)**: inject a synthetic bucket whose key equals the PR author's own `user_id` (i.e., a bucket representing self-comments by the PR author on their own PR). The injection violates CL-04 (self-comments excluded from this dimension). Assert FR-2-04 reconciliation test FAILS on the mutated copy because either FR-2-02 (independent re-computation excludes self-comments via `pr_comments.author_id != pull_requests.user_id` filter) or FR-2-03 (independent count excludes self-comments) catches the leak.

**Rationale**: Mirrors 334 / 335 FR-2-05's pattern — the meta-test catches the failure mode where the reconciliation test silently degrades to a no-op (a future refactor short-circuits an assertion, the fixture loader stops finding the dataset, or the iteration loop skips weeks under some condition). Without the meta-test, FR-2-04 could pass on a wrong codebase forever and no signal would surface. THREE injections (not just the INV-4-07 violation 334 used, not just the sum-coherence 335 used) because:
- The INV-4-07 ordering check is inherited from 334 / 335 — keep it.
- FR-2-03 is a NEW contract introduced by this feature with a NEW shape (sum vs INDEPENDENT count, not vs `comments.comment_count`); the meta-test must positively prove FR-2-03 is real with the correct semantics — mutating `comment_count` to break the sum-coherence proves the assertion fires.
- Self-comment exclusion (CL-04) is NEW for this dimension and is critical to correctness — silent failure (e.g., the WHERE clause omitting the `!=` filter) would produce a quietly-wrong aggregator. The injection proves either FR-2-02 or FR-2-03 (or both) catches the leak.

**Alternatives considered & rejected**:

- Only the INV-4-07 + sum-coherence injections (skip the self-comment-leak): would not prove CL-04 self-comment exclusion is real. The CL-04 directive is foundational to the per-reviewer dimension's correctness; without an explicit failure-mode injection, a future regression where the WHERE filter is dropped would not surface in the meta-test. Rejected.
- Parallel meta-test file: same in-place-vs-parallel reasoning as ADR R003.

**Spec anchors**: FR-2-05, FR-2-03, FR-2-04, CL-04.

---

## ADR R005: Demo→production data-shape verification protocol (per kickoff pre-empt #1)

**Decision**: Trace the demo generator's new `synthetic_pr_comments` stream end-to-end and verify `author_id` values match the canonical extractor's UUID shape BEFORE writing the production `_compute_weekly_by_reviewer_comments` helper. The coherence guard test at `tests/unit/test_demo_synthetic_pr_comments.py` (per CL-14 step 3 / A-12) is the FIRST test written in Phase 2 (Task T004); a failure there blocks subsequent tasks.

**Verification protocol** (Phase 2 prerequisite):

1. The demo's `author_pool` at `generate-demo-data.py:450-451` holds `str(generate_uuid(name))` values from `generate_uuid` at line 726. These are canonical UUIDs (32 hex + 4 hyphens).
2. The new synthetic commenter sampling MUST draw from `author_pool` (excluding the PR's author per CL-04). The synthetic ghost commenters MUST also be canonical UUIDs (sampled from a separate ghost pool seeded by `generate_uuid(f"ghost-{idx}")` or similar).
3. The coherence guard test (T004) constructs a small fixture (e.g., 3 PRs across 2 commenters), invokes the demo generator's per-week synthesis path, and asserts:
   - Every emitted `synthetic_pr_comments[*].author_id` matches the UUID regex.
   - Re-aggregating per PR yields the PrRecord's pre-existing aggregate counts (CL-14 coherence).
   - At least one ghost commenter is present in at least one week (per CL-14 step 4 / A-03).
4. Only after T004 passes does T011 (production `_compute_weekly_by_reviewer_comments` helper) get written.

**Rationale**: Per kickoff comment 2: "Demo key-shape verification — do this FIRST. Before writing `_compute_weekly_by_reviewer_comments`, trace the demo generator's `pr_comments` stream end-to-end and verify it produces `author_id` values that match the canonical extractor's UUID shape. #335 burned two Codex catches because the demo's `by_repository` was keyed by `repository_name` while the canonical emitted `repository_id`; the same shape mismatch is plausible on the comments path."

Pre-emption value: catching demo→production shape mismatch at T004 (before T011) avoids the failure mode where T011 lands and tests pass against the demo, but production data (real UUIDs) trips a different code path. The shape-mismatch class of bug cost #335 two Codex catches; this ADR pre-empts it for #336.

**Alternatives considered & rejected**:

- Write T011 first, then T004: order-of-operations regression — would require T011's SQL to run against a not-yet-shape-verified demo path; a shape mismatch surfaces only when T006 reconciliation runs, by which point T011 is already committed and may need a refactor. Rejected.
- Skip the explicit verification test and rely on T006 reconciliation to catch shape drift: T006 runs against the production aggregator's emission; if the demo generator emits a different shape, T006 fails but the failure mode is harder to diagnose (is it the production helper or the demo generator?). T004's narrow scope (demo-only coherence) localizes the failure clearly.

**Spec anchors**: CL-14, A-12, A-03, FR-1-03 (sentinel + UUID shape).

---

## ADR R006: Pattern-extraction posture (post-#336)

**Decision**: Three concrete chart modules will exist after this feature ships (per-author + per-repo + per-reviewer); abstraction extraction is **deferred to a follow-up feature** so it is informed by all three concrete instances. Aggregator extraction stays NOT recommended.

**Surfaces eligible for extraction** (post-#336 follow-up scope):

1. **Renderer module shared scaffolding**: sort selector toolbar, range-total reduction, partial-coverage qualifier per row, filter-not-supported empty state, no-data empty state, top-N cap + truncation indicator, sentinel rendering (where applicable). All three chart modules share this shape; extraction would parameterize on `bucketKind: "author" | "repository" | "reviewer"`, `dimensionEntry` shape, and sentinel-applies flag.
2. **Schema validator module**: `validateAuthorCommentsDensity` (`rollup.schema.ts:868`) + `validateRepositoryCommentsDensity` (post-#350) + `validateReviewerCommentsDensity` (this feature). All three share the same atomicity check (4-field requirement), same numeric-field type checks, same `active_thread_count <= thread_count` ordering check. Extraction would produce a single `validateCommentsDensityEntry(value, path, options)` helper invoked by the three dimension-specific wrappers.
3. **Dashboard ensure/remove helpers**: `ensureCommentsAuthorDensityContainer` / `removeCommentsAuthorDensityContainer` (`dashboard.ts:1691,1734`) + `ensureCommentsRepositoryDensityContainer` / `removeCommentsRepositoryDensityContainer` (`dashboard.ts:1760,1806`) + `ensureCommentsReviewerDensityContainer` / `removeCommentsReviewerDensityContainer` (this feature). All six share the same idempotent-insertion + data-attribute-discoverable-removal pattern. Extraction would produce a single `ensureChartContainer(rowAttribute, anchorAttribute, ...)` helper.
4. **Lifecycle test scaffolding**: `comments-author-density-lifecycle.test.ts` + `comments-repository-density-lifecycle.test.ts` + `comments-reviewer-density-lifecycle.test.ts`. All three share the same four scenarios (initial-off / on→off / off→on / on→on idempotency) + the source-parse binding pattern (per A-13). Extraction would produce a parameterized lifecycle-test helper.

**Surfaces explicitly NOT eligible for extraction**:

- **Aggregator helpers** — `_compute_weekly_by_author_comments` and `_compute_weekly_by_repository_comments` iterate `pull_requests`; `_compute_weekly_by_reviewer_comments` (this feature) iterates `pr_comments`. The substantive iteration-unit divergence makes shared aggregator scaffolding more cost than benefit. Each aggregator's SQL is also dimension-specific (LEFT JOIN users for author + reviewer; INNER JOIN pull_requests for self-comment exclusion in reviewer-only; GROUP BY differs per dimension). Extraction stays NOT recommended — this is a deliberate divergence per A-08 / kickoff comment 2.
- **Cross-aggregate parity contract shape** — 334 / 335 use `SUM_dimension == comments.comment_count`; 336 uses `SUM_R == INDEPENDENT count`. The shape divergence is structural (the per-reviewer dimension's many-to-one PR-to-bucket relationship + self-comment exclusion); a shared parity-test helper would require either parameterizing on the right-hand side computation or splitting into two helpers. The 334 / 335 helper (if extracted) does not generalize to 336's shape; keep them separate.

**Rationale**: Two-instance extraction is the trap warned about by `feedback_no_invented_abstractions.md`; #335's plan explicitly deferred extraction to #336. After #336 lands, three concrete instances exist — three is the natural ground for extraction (proven by the pattern of same vs different across dimensions). The follow-up feature scope: extract the four eligible surfaces above; preserve aggregator divergence + parity contract divergence as deliberate. Plan-level for the follow-up; this spec does not constrain the abstraction's design.

**Alternatives considered & rejected**:

- Extract during #336 itself: rejected — the pattern is still being established (the per-reviewer dimension's substantive divergences in iteration unit + parity contract shape would either be flattened into the abstraction prematurely or excluded from it, leaving inconsistency). Three concrete instances must exist BEFORE extraction.
- Delay extraction beyond the follow-up (e.g., wait for the per-team dimension #321): rejected — #321 is on-hold pending team-at-time-of-PR history modeling (an unresolved schema obligation per 310 INV-03); waiting indefinitely lets the abstraction debt accumulate. Three is enough to extract; the per-team dimension can be added as a fourth instance later.
- Extract only the renderer module (not the schema / dashboard / lifecycle): rejected — partial extraction creates inconsistent abstraction surfaces (renderer is shared, but every-other-surface is dimension-specific) and adds maintenance cost without proportional benefit. Extract all four eligible surfaces or none.

**Spec anchors**: A-08, all CL-* axes (which lock the dimension-specific divergences), all INV-* invariants (which preserve cross-feature contracts).

---

## Silently inherited from 334 / 335 (no new ADR needed)

- **Sort selector pattern (WAI-ARIA Toolbar)**: locked verbatim by CL-07 / FR-4-05 — `role="toolbar"` wrapper + plain `<button>` elements (default `tabindex=0` + `aria-pressed`), three buttons. Not a plan-level choice.
- **Schema validator atomicity posture (STRICT-ERROR in both modes)**: 334 ADR T003 / 335 inheritance — INV-4-08 atomicity is NEW for this feature's namespace, no legacy emissions to be lenient toward. Same posture, no new ADR.
- **Partial-coverage visual qualifier (hatched + dimmed)**: 333 ADR T005 / 334 ADR T004 / 335 inheritance — reuse existing `.coverage-partial` CSS class hooks. No new visual decision. Tooltip text divergence (week-level vs bucket-specific per CL-10) is captured at FR-4-03 / ADR R001, not as a new ADR.
- **Week-attribution rule**: same `closed_date → ISO-week` formula 333 / 334 / 335 / throughput use. The per-PR parity guard at `tests/integration/test_week_attribution_parity.py` already covers all aggregators. No new ADR.
- **Sentinel literal name + label**: locked by CL-03 (reuse 334's `FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL` literal verbatim + reuse "Former / unavailable author" label). No new ADR.

## Open Implementation Questions (none)

All ADRs above resolve the planning-stage questions surfaced during research. No items defer to /speckit.tasks. Plan is ready for /speckit.tasks (Phase 2).

## References

- `specs/310-comments-visualization/spec.md` — C1 inclusion-rule contract authority + C2 reviewer-semantics contract authority; INV-02 / INV-03 / INV-05 / INV-06 / INV-07.
- `specs/333-comments-trend-chart/spec.md` — `rollup[W].comments` foundation; FR-2-04 reconciliation contract; FR-3-03 capability-off byte-identity.
- `specs/333-comments-trend-chart/contracts/sc05-reconciliation-test.md` — reconciliation test contract this feature extends in-place.
- `specs/334-comments-author-density/spec.md` — sibling per-author dimension; sentinel pattern source; CL-axis lock conventions.
- `specs/334-comments-author-density/research.md` Decisions 1–8 / ADRs T001–T006 — silently inherited where applicable, simplified where CL-04 / CL-10 / CL-12 / CL-13 / CL-14 apply.
- `specs/334-comments-author-density/contracts/per-author-comments-density.md` — contract pattern source for the sentinel branch + LEFT JOIN users SQL.
- `specs/335-comments-repo-density/spec.md` — sibling per-repo dimension; render-order anchor + cross-aggregate parity contract shape source.
- `specs/335-comments-repo-density/research.md` ADRs R001–R003 — silently inherited where applicable, with shape adaptations per CL-12.
- `specs/335-comments-repo-density/contracts/per-repo-comments-density.md` — contract pattern source for the all-zero filter + display-label fallback + week-agnostic truncation discovery.
