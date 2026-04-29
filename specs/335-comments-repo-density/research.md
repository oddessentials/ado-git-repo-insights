# Research: Dashboard per-repo comment density breakdown

**Feature**: 335-comments-repo-density
**Phase**: 0 (research consolidation)
**Created**: 2026-04-28
**Spec**: [spec.md](./spec.md) — all 10 CL-axes locked (Path B by user directive 2026-04-28)

This file consolidates the genuinely new ADRs (R001 – R003) for this feature. Eight axes inherited verbatim from #334 (CL-01 emission shape, CL-02 filter posture, CL-06 cap/sort, CL-07 click-through, CL-08 schema-parity scope, CL-09 coverage_partial, plus 333's pattern foundations) require no further research — they are silently inherited and recorded in spec.md Background. Two simplifications (CL-03 no-sentinel, CL-04 display-label) and one new contract (FR-2-03 cross-aggregate sum-coherence) drive the three ADRs below.

---

## ADR R001: Chart module file name + display-label-fallback wiring

**Decision**: New module at `extension/ui/modules/charts/comments-repository-density.ts`, modeled directly on the merged-on-main `extension/ui/modules/charts/comments-author-density.ts` (PR #349). Differences from the 334 source:

- Reads `rollup[W].by_repository_comments` instead of `rollup[W].by_author_comments`.
- Takes a `repositoriesDimension?: readonly RepoDirectoryEntry[]` option instead of `authorsDimension?: readonly AuthorDirectoryEntry[]`.
- Display label resolution (CL-04 / FR-4-11): `directory.get(repository_id)?.repository_name ?? repository_id`. The raw-`repository_id` fallback is the user-visible label when a `repositoriesDimension` entry is missing for the key. A unit test in `comments-repository-density.test.ts` constructs a fixture with one bucket whose `repository_id` is absent from the dimension array and asserts the rendered row label equals the raw ID (no blank, no row omission).
- NO `FORMER_OR_UNAVAILABLE_AUTHOR_KEY` constant, NO `FORMER_OR_UNAVAILABLE_AUTHOR_LABEL` constant, NO label-mapping branch, NO sentinel collision-safety unit test (CL-03 simplification).
- Tie-break ordering (FR-4-05): chosen-metric desc → `repository_name` asc → `repository_id` asc. The implementation MUST collapse the secondary/tertiary into a single ternary expression (the same partial-branches-ratchet-zero pattern PR #349 applied to 334's tie-break) so `.coverage-partial-branches-baseline.json` does not grow.
- `MAX_COMMENTS_REPO_DENSITY_ROWS = 50` constant (CL-06 / FR-4-06).

**Rationale**: 334's chart module is a battle-tested template — same scaffolding (capability-aware container lifecycle, filter-not-supported short-circuit, no-data short-circuit, truncation indicator, tooltip / a11y conventions). Duplicate-then-extract is the deliberate posture per A-08 / memory `feedback_no_invented_abstractions.md`; abstraction extraction is informed by all three concrete instances (per-author + per-repo + per-reviewer) at #336.

**Alternatives considered & rejected**:

- Extract a shared `BucketCommentsRowChart<T>` abstraction now: trap warned about by `feedback_no_invented_abstractions.md`. Two-instance extraction is too early; A-08 defers to #336.
- Generic `comments-density-row-table.ts` taking `bucketKind: "author" | "repo"`: same trap; pretends three concrete instances exist when only two do.
- Render `repository_id` raw without fallback wiring (skip CL-04): forces the user to read UUIDs; rejected at spec time.

**Spec anchors**: CL-04, FR-4-01, FR-4-05, FR-4-11, A-08.

---

## ADR R002: Cross-aggregate sum-coherence test placement (NEW for this feature)

**Decision**: Extend `tests/integration/test_comments_trend_reconciliation.py` in-place (CL-05) with a NEW `test_by_repository_comments_sum_coherence` assertion. The test:

1. Iterates every week W in the demo dataset where `capabilities.comments_metrics` is enabled AND `rollup[W].comments` is present AND `rollup[W].by_repository_comments` is non-empty.
2. For each such W: asserts SUM over all repositories of `by_repository_comments[r].thread_count` EQUALS `comments.thread_count`. Same for `comment_count` and `active_thread_count`.
3. Asserts LOGICAL OR over all repositories of `by_repository_comments[r].coverage_partial` EQUALS `comments.coverage_partial`.
4. Auto-discovers truncated weeks via `_prs_truncated: true` introspection — the test is week-agnostic (does NOT hard-code W26). At least one truncated week MUST be present in the demo (asserted by a separate guard), but which week is truncated is allowed to drift across demo regenerations per A-11.

**Rationale**: Both `comments` (333) and `by_repository_comments` (this feature) compute over the FULL canonical extracted-subset of W's throughput PR set per FR-1-09 / 333 FR-2-03 / 334 INV-2-10. The drill-down truncation (`_prs_truncated: true`) only affects per-PR `prs[]` rendering; aggregator scope is unaffected. Sum-coherence MUST therefore hold even on truncated weeks. The W26 truncated demo fixture is the witness that proves the contract holds under the failure mode the spec is most worried about (drill-down truncation hiding an aggregator scope mismatch).

The test runs in-place to 333's reconciliation file because the import-block isolation (`tests/integration/test_comments_trend_reconciliation_isolation.py`) is enforced by FILE, not by test function; adding new assertions to the existing file does not weaken the isolation invariant.

**Alternatives considered & rejected**:

- Hard-code W26 as the witness: would fail on any demo regeneration that shifts the truncation. Rejected — week-agnostic discovery is more robust per A-11.
- Parallel test file `tests/integration/test_by_repository_comments_sum_coherence.py`: adds duplicate import-block-guard machinery; same reasoning as 334 Decision 5.
- Run sum-coherence only on truncated weeks: weakens coverage. The contract holds on EVERY week where both aggregates are emitted; testing on every such week catches more failure modes (e.g., a regression where a non-truncated week's per-repo sum drifts).
- Test sum coherence at the producer side via direct SQL re-summation: that's what FR-2-02's independent re-computation already does at the per-(week, repo) level. The cross-aggregate sum-coherence is the consistency check between the TWO emitted aggregates, which is a strictly stronger property than either individual independent re-computation guarantees alone.

**Spec anchors**: FR-2-03, FR-2-04, INV-3-10, SC-1-05, A-11.

---

## ADR R003: Failure-mode meta-test extension (FR-2-05)

**Decision**: Extend `tests/integration/test_comments_trend_meta_failure.py` in-place with TWO new injection cases:

- **(a) Per-(week, repo) INV-3-07 violation**: mutate one bucket so `active_thread_count > thread_count`; assert FR-2-04 reconciliation test FAILS on the mutated copy.
- **(b) Per-week sum-coherence violation**: mutate one bucket's `thread_count` (e.g., subtract 1) so the per-repo sum no longer matches `comments.thread_count`; assert FR-2-04 reconciliation test FAILS on the mutated copy.

**Rationale**: Mirrors 334 FR-2-05's pattern — the meta-test catches the failure mode where the reconciliation test silently degrades to a no-op (a future refactor short-circuits an assertion, the fixture loader stops finding the dataset, or the iteration loop skips weeks under some condition). Without the meta-test, FR-2-04 could pass on a wrong codebase forever and no signal would surface. Two injections (not just the INV-3-07 violation 334 used) because FR-2-03 is a NEW contract introduced by this feature; the meta-test must positively prove FR-2-03 is real, not just FR-2-01/02 (already proven for #334's per-author scope).

**Alternatives considered & rejected**:

- Only the INV-3-07 injection (skip the sum-coherence one): would not prove FR-2-03 is real. Rejected.
- Parallel meta-test file: same in-place-vs-parallel reasoning as ADR R002.

**Spec anchors**: FR-2-05, FR-2-03, FR-2-04.

---

## Silently inherited from 334 (no new ADR needed)

- **Sort selector pattern (WAI-ARIA Toolbar)**: locked verbatim by CL-06 / FR-4-05 — `role="toolbar"` wrapper + plain `<button>` elements (default `tabindex=0` + `aria-pressed`), three buttons. Not a plan-level choice.
- **Schema validator atomicity posture (STRICT-ERROR in both modes)**: 334 ADR T003 — INV-3-08 atomicity is NEW for this feature's namespace, no legacy emissions to be lenient toward. Same posture, no new ADR.
- **Partial-coverage visual qualifier (hatched + dimmed)**: 333 ADR T005 / 334 ADR T004 — reuse existing `.coverage-partial` CSS class hooks. No new visual decision.
- **Week-attribution rule**: same `closed_date → ISO-week` formula 333 / 334 / throughput use. The per-PR parity guard at `tests/integration/test_week_attribution_parity.py` already covers all aggregators. No new ADR.
- **Sentinel literal name + label**: N/A (CL-03: no sentinel concept). The 334 ADR T006 pattern is intentionally NOT carried over.

## Open Implementation Questions (none)

All ADRs above resolve the planning-stage questions surfaced during research. No items defer to /speckit.tasks. Plan is ready for /speckit.tasks (Phase 2).

## References

- `specs/310-comments-visualization/spec.md` — C1 inclusion-rule contract authority; INV-02 / INV-03 / INV-05 / INV-06 / INV-07.
- `specs/333-comments-trend-chart/spec.md` — `rollup[W].comments` foundation; FR-2-04 reconciliation contract; FR-3-03 capability-off byte-identity.
- `specs/333-comments-trend-chart/contracts/sc05-reconciliation-test.md` — reconciliation test contract this feature extends in-place.
- `specs/334-comments-author-density/spec.md` — sibling per-author dimension; pattern source; CL-axis lock conventions.
- `specs/334-comments-author-density/research.md` Decisions 1–8 / ADRs T001–T006 — silently inherited where applicable, simplified where CL-03 / CL-04 apply.
- `specs/334-comments-author-density/contracts/per-author-comments-density.md` — contract pattern this feature mirrors at the per-repo scope.
