# Spec Quality Checklist: Dashboard per-reviewer comment density breakdown

**Feature**: 336-comments-reviewer-density
**Status**: PASS — all 15 CL-axes locked Path B 2026-04-29 by user directive; planning-readiness verified; zero `[NEEDS CLARIFICATION]` markers; zero deferred architectural decisions.

## Pass 1 — branch-aware draft

- [x] All 15 CL-axes locked at draft time (Path B per user directive).
- [x] No `[NEEDS CLARIFICATION]` markers in executable requirements (FR-* / SC-* / acceptance scenarios / edge cases).
- [x] No conditional requirements (`MUST X unless Y`); all FRs are unconditional.
- [x] All FR / US / SC / edge-case wording reflects the locked CL-axis values from draft time, not later additions.

## Pass 2 — hardening

- [x] Edge cases are deterministic — each names a specific behavior or points at an existing decision marker (no "must either X or Y; decision falls under [Cx]" patterns).
- [x] Cross-references use anchor text, not line numbers (per memory `feedback_spec_cross_refs_anchor_text.md`).
- [x] No re-declaration of inherited rules — C1 (310) / C2 (310) / 333 / 334 / 335 invariants referenced by section name, not restated.
- [x] Set-theoretic precision in invariant statements (e.g., "active subset" / "extracted-subset" with clear set definitions).
- [x] FR-2-01 narrowed to `comment_count` distribution coherence only, addressing the per-reviewer dimension's many-to-one PR-to-bucket relationship + self-only-thread structural narrowing (post-/speckit.analyze C1+U1 remediation 2026-04-29). Per-bucket `thread_count` / `active_thread_count` correctness is covered by FR-2-02's independent re-computation; the "PR with mixed self-only and non-self threads" edge case is the witness that the FR-2-01 narrowing is structural, not a defect.
- [x] All Out-of-Scope items have explicit pointers (issue # for sibling features, memory references for posture decisions).

## Pass 3 — code validation

Every code anchor referenced in the spec / plan / research / data-model / contract / quickstart was verified against `main` post-#350-merge:

- [x] `src/ado_git_repo_insights/transform/aggregators.py:1104` — `_compute_weekly_by_author_comments` — confirmed.
- [x] `src/ado_git_repo_insights/transform/aggregators.py:1239` — `_compute_weekly_by_repository_comments` — confirmed (post-#350).
- [x] `src/ado_git_repo_insights/transform/aggregators.py:725-729` — `by_author_comments` emission call site — confirmed.
- [x] `src/ado_git_repo_insights/transform/aggregators.py:741-745` — `by_repository_comments` emission call site — confirmed (post-#350).
- [x] `src/ado_git_repo_insights/transform/constants.py:27` — `FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL` — confirmed.
- [x] `src/ado_git_repo_insights/persistence/models.py:158` — `pr_comments.thread_id` column — confirmed.
- [x] `src/ado_git_repo_insights/persistence/models.py:170` — pr_comments FK to pr_threads — confirmed.
- [x] `src/ado_git_repo_insights/persistence/models.py:172` — pr_comments.author_id FK to users — confirmed.
- [x] `src/ado_git_repo_insights/persistence/models.py:174` — `idx_pr_comments_thread` — confirmed.
- [x] `src/ado_git_repo_insights/persistence/models.py:176` — `idx_pr_comments_author` — confirmed.
- [x] `src/ado_git_repo_insights/persistence/models.py:146` — `pr_threads.status` field with values `'active'` / `'fixed'` / `'closed'` — confirmed.
- [x] `extension/ui/dashboard.ts:1691` — `ensureCommentsAuthorDensityContainer` — confirmed.
- [x] `extension/ui/dashboard.ts:1734` — `removeCommentsAuthorDensityContainer` — confirmed.
- [x] `extension/ui/dashboard.ts:1760` — `ensureCommentsRepositoryDensityContainer` — confirmed (post-#350).
- [x] `extension/ui/dashboard.ts:1779` — sets `data-comments-repository-density-row="true"` attribute — confirmed (post-#350).
- [x] `extension/ui/dashboard.ts:1806` — `removeCommentsRepositoryDensityContainer` — confirmed (post-#350).
- [x] `extension/ui/modules/charts/comments-author-density.ts:65` — `FORMER_OR_UNAVAILABLE_AUTHOR_KEY` renderer literal — confirmed.
- [x] `extension/ui/modules/charts/comments-author-density.ts:72` — `FORMER_OR_UNAVAILABLE_AUTHOR_LABEL` renderer literal — confirmed.
- [x] `extension/ui/modules/charts/comments-repository-density.ts:335-341` — all-zero row filter pattern — confirmed (post-#350).
- [x] `extension/ui/schemas/rollup.schema.ts:204` — `KNOWN_ROOT_FIELDS` set with `by_author_comments` + `by_repository_comments` entries — confirmed.
- [x] `extension/ui/schemas/rollup.schema.ts:868` — `validateAuthorCommentsDensity` — confirmed.
- [x] `extension/ui/dataset-loader.ts:168` — `Rollup` interface declaration — confirmed.
- [x] `extension/ui/dataset-loader.ts:220` — `by_author_comments?` field — confirmed.
- [x] `extension/ui/dataset-loader.ts:239` — `by_repository_comments?` field — confirmed (post-#350).
- [x] `scripts/generate-demo-data.py:476-503` — `generate_pr_records` PrRecord emission — confirmed.
- [x] `scripts/generate-demo-data.py:530` — `_aggregate_comments_for_week` — confirmed.
- [x] `scripts/generate-demo-data.py:567` — `_aggregate_by_author_comments_for_week` — confirmed.
- [x] `scripts/generate-demo-data.py:624` — `_aggregate_by_repository_comments_for_week` — confirmed (post-#350).
- [x] `scripts/generate-demo-data.py:684-696` — repository name→UUID FAIL-LOUD pattern (CL-15 reference for demo-side FAIL-LOUD) — confirmed.
- [x] `scripts/generate-demo-data.py:450-451` — `author_pool` UUID-shape commenter pool — confirmed.
- [x] `tests/integration/test_comments_trend_reconciliation.py` — exists — confirmed.
- [x] `tests/integration/test_comments_trend_reconciliation_isolation.py` — exists — confirmed.
- [x] `tests/integration/test_comments_trend_meta_failure.py` — exists — confirmed.
- [x] `tests/integration/test_demo_variants_byte_identity.py` — exists — confirmed.
- [x] `extension/tests/artifact-client.test.ts` — exists — confirmed.
- [x] `tests/fixtures/sc05/fixture_builder.py:80` — `GHOST_USER_ID = "ghost-001"` — confirmed.
- [x] `tests/unit/test_aggregators_author_comments.py:514` — `test_sentinel_literal_does_not_collide_with_real_author_ids` (T029 from #334) — confirmed.

No invented abstractions; no claimed function names that do not exist; no claimed line numbers that drift more than ±5 (memory `feedback_no_invented_abstractions.md`).

## Pass 4 — planning readiness

- [x] Every executable requirement is decidable at /speckit.plan time.
- [x] No architectural decisions deferred to the plan (all 15 CL-axes locked at /speckit.specify).
- [x] data-model.md / quickstart.md / research.md / contracts/per-reviewer-comments-density.md drafted with no architectural decisions deferred.
- [x] Plan-level task seed: every task in tasks.md has a deterministic target (file path / function name / SQL pattern) — no "decide at task time" placeholders.
- [x] Demo synthetic stream design (CL-14) carries through spec → plan → research → data-model → contract → quickstart → tasks consistently.
- [x] Cross-aggregate parity contract shape (CL-12) carries through spec → plan → research → data-model → contract → quickstart → tasks consistently.
- [x] Pattern-extraction posture (A-08 / ADR R006) explicitly DEFERRED to a follow-up feature; #336's plan does NOT include extraction tasks.

## Constitution gates pre-checked

- [x] QG-05 Golden output determinism — outer dict key order ascending by commenter key per FR-1-09 / contracts §2 Determinism.
- [x] QG-19 Unit + integration tests — tests enumerated in plan.md / data-model.md §6.
- [x] QG-20 Coverage threshold ≤ 2% — flagged in plan.md Constitution Check.
- [x] QG-28 Chart render < 1000ms — top-50 cap bounds DOM cost.
- [x] QG-29 Chart data caps — `MAX_COMMENTS_REVIEWER_DENSITY_ROWS = 50` declared.
- [x] QG-30..34 Demo parity — capability-off byte-identity gated per FR-3-03.
- [x] QG-35..38 Local/CI parity — all tests in pre-push preflight + CI; `--no-verify` forbidden.
- [x] QG-39 Cross-OS — pure Python + TypeScript.
- [x] QG-40 No `typing.Any` — precise types used.
- [x] QG-41 Zero inline suppressions — suppression baseline stays at zero.
- [x] QG-42 Enterprise test coverage — full test enumeration in plan.md / data-model.md.
- [x] QG-43 Per-commit ratchet bump — tasks.md notes the bump explicitly per task.
- [x] QG-44 Single source of truth for floors — no hardcoded floors.
- [x] QG-45 Cross-OS Python collection parity — new tests collection-stable.
- [x] QG-46 Platform-conditional file naming — no platform-conditional tests.
- [x] QG-47 Pre-commit trigger scope — existing predicates cover.
- [x] QG-48 Worktree-clean guards — no new gates added.
- [x] QG-49 Single command, many callers — reconciliation invoked via standard `pytest tests/integration/`.
- [x] QG-50..52 Change acknowledgement — test-floor bump only; no `[ratchet-realignment]` expected.
- [x] QG-53..55 Build architecture — new chart module under `extension/ui/modules/charts/`.
- [x] QG-56 Security scan (gitleaks) — runs on every commit; no new secrets.

## Memory-discipline check

- [x] Sign-as-Sloppy-Claude commitments noted (memory `feedback_sign_as_sloppy_claude.md`).
- [x] No-push-without-explicit-command noted (memory `feedback_never_push_without_explicit_command.md`).
- [x] No `--no-verify` (memory `feedback_no_verify.md`).
- [x] Show-plan-before-edit honored (this checklist + spec/plan/research/data-model/contract/quickstart all written before any source edit).
- [x] Atomic crossfile sweep before edit (memory `feedback_atomic_crossfile_sweep_before_edit.md`) — all spec / plan / research / data-model / contract / quickstart cross-references atomic.
- [x] Drift-prone numbers (line counts, test counts, last-verified dates) NOT recorded in spec docs — only in code anchors that are verified against current main.
- [x] Speckit cadence applies (memory `feedback_speckit_cadence_applies_to_tasks.md`) — 4-pass discipline executed before /speckit.analyze.
- [x] No invented abstractions (memory `feedback_no_invented_abstractions.md`) — every function name / file path / line number verified against current main.
- [x] Cross-OS required (memory `feedback_cross_os_required.md`) — no OS-specific code in spec.

## Outcome

**PASS** — spec is locked, planning-readiness verified, ready for /speckit.analyze.
