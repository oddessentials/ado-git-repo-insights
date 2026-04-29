# Implementation Plan: Dashboard per-repo comment density breakdown

**Branch**: `feat/335-comments-repo-density` | **Date**: 2026-04-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/335-comments-repo-density/spec.md` (all 10 CL-axes locked 2026-04-28 by user directive — Path B; zero `[NEEDS CLARIFICATION]` markers; zero branch-aware alternatives in executable requirements)
**Issue**: #335 (split from #322 — Capability 2, repo dimension; second of three sibling Cap-2 dimension PRs after #334 author and before #336 reviewer; sibling #321 team is on-hold)

## Summary

Add a per-repo comments-density breakdown surface to the dashboard's Metrics tab, gated on `capabilities.comments_metrics`. Backed by a new `rollup[W].by_repository_comments[<repository_id>]` per-week outer dict that the aggregator emits when capability-on. The breakdown reduces per-(week, repo) emissions to a range-total per row over the user-selected date range, sorts by chosen metric (default `comment_count`), caps at 50 rows, and surfaces a partial-coverage qualifier per row when the row's reduced `coverage_partial` is `true`. Display label resolves to `repository_name` from the `repositories` dimension with raw `repository_id` fallback per CL-04. NO sentinel concept — `repository_id` is FK-protected per CL-03.

This is the second sibling Cap-2 dimension PR; #334 (per-author) is the pattern source and shipped on PR #349. The visual + interaction pattern is duplicated (not abstracted) per A-08; abstraction extraction is deferred to #336 (per-reviewer) so it is informed by all three concrete instances. SC-1-05 cross-feature coherence + the NEW FR-2-03 cross-aggregate sum-coherence contract on the truncated W26 demo fixture is closed by extending 333's `tests/integration/test_comments_trend_reconciliation.py` in-place.

## Technical Context

**Language/Version**: Python 3.12+ (backend, aggregator, scripts, tests) and TypeScript 6.0.3 (extension UI). Matches existing baseline per `CLAUDE.md`.

**Primary Dependencies**: existing only — Backend: `argparse`, `sqlite3` via `DatabaseManager`, `pandas` (aggregator group-by), `pytest` + `unittest.mock.MagicMock`. Extension: Jest 30.x + jsdom 28.x test environment, esbuild bundler, VSS SDK runtime. **No new third-party runtime or dev dependencies.**

**Storage**: SQLite via existing `DatabaseManager`. **No schema changes; no migrations.** Reads `pr_threads`, `pr_comments`, `pull_requests.repository_id`, `pull_requests.comments_extracted_at` — all present since Feature 058. INV-3-05 (extractor frozen, inherits 310 INV-06 / 333 INV-1-05 / 334 INV-2-05) preserved. The aggregator does NOT need to LEFT JOIN `repositories` — `repository_id` is FK-protected per CL-03 and the `repositories` dimension carries the display label resolution at the renderer side.

**Testing**: pytest (Python integration + unit), Jest 30.x (extension). `.test-floor-contract.json` bumped in the same commit as added tests per QG-43. `--max-skips=0` enforced (QG-46). Tests collection-stable per QG-45 / Principle XXVI.

**Target Platform**: Cross-OS (Windows + Linux + macOS) per QG-39. Extension targets Azure DevOps via VSS SDK; dashboard renders in Chromium / Edge browser surface.

**Project Type**: web-service + extension-app (backend Python aggregator + TypeScript extension UI).

**Performance Goals**: New breakdown surface MUST render within QG-28's existing 1000ms / 156-week scalability gate. Top-N=50 row cap (`MAX_COMMENTS_REPO_DENSITY_ROWS`) bounds render cost regardless of dataset repository cardinality. Aggregator-side runtime is governed by existing producer test-suite wall-clock budgets (no new single-run wall-clock assertion is added — single-run timings are CI-flake bait).

**Constraints**:

- CSV contract frozen (INV-3-04 / 310 INV-05 / 333 INV-1-04 / 334 INV-2-04 / Constitution Principle I-IV). No producer-side CSV changes.
- Extractor frozen (INV-3-05 / 310 INV-06 / 333 INV-1-05 / 334 INV-2-05). Reads `pr_threads` / `pr_comments` only (plus existing `pull_requests` joins that throughput already uses).
- 333's per-PR `PrRecord` shape and 334's `by_author_comments` shape MUST NOT be shadowed; this feature's namespace is `by_repository_comments` (separate from `comments`, `by_repository`, and `by_author_comments`).
- Schema-parity gate (`scripts/check_pr_record_schema_parity.py`, Row 38, QG-49) intentionally NOT extended for the rollup-level `by_repository_comments` namespace; the FR-2-04 reconciliation test extension is the sole authority for this feature's parity (CL-08 = follow 333 Decision 5 / 334 CL-08).
- `--no-verify` forbidden (QG-38).
- Zero inline suppressions (QG-41) — `# noqa` / `# type: ignore` / `// eslint-disable` are forbidden in new code.
- No `typing.Any` (QG-40).
- Partial-branches ratchet (memory: `.coverage-partial-branches-baseline.json` enforced by `scripts/check_partial_branches.py`) is NOT permitted to grow. Apply the same tie-break-ternary collapse 334 used to keep the ratchet at zero, OR cover defensive branches with mutation-based tests.

**Scale/Scope**: Demo dataset has ≥10 distinct repositories with mixed comment-load (per A-03), and at least one repository with mixed extraction exercising the per-row `coverage_partial` qualifier. Top-N display cap inherits the chart-truncation pattern (constant `MAX_COMMENTS_REPO_DENSITY_ROWS = 50`). Aggregator emits one `by_repository_comments` outer dict per week for capability-on datasets; per-week payload depends on repository cardinality (one entry per (week, repo) tuple under capability-on). Estimated payload increase per rollup file: ~100 bytes × repository cardinality.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Applies | How this PR honors it |
|---|---|---|
| **QG-01..04 CSV Contract** | indirect | INV-3-04 frozen — no CSV changes. PASSED by non-touch. |
| **QG-05 Golden output determinism** | yes | Aggregator emission MUST produce deterministic per-(week, repo) ordering — outer `by_repository_comments` dict keys sorted ascending by `repository_id` (the stable identity string). UI row tie-breaking is renderer-side (FR-4-05). `tests/integration/test_golden_outputs.py` gates this. |
| **QG-19 Unit + integration tests** | yes | New tests in `tests/unit/test_aggregators_repo_comments.py` (FR-1-* cases) and extensions to `tests/integration/test_comments_trend_reconciliation.py` (FR-2-01 + FR-2-02 + NEW FR-2-03 sum-coherence), `tests/integration/test_comments_trend_meta_failure.py` (FR-2-05 per-repo INV-3-07 + sum-coherence violation), `tests/integration/test_demo_variants_byte_identity.py` (FR-3-03 four omission failure modes for `by_repository_comments`). |
| **QG-20 Coverage threshold** | yes | New code paths must satisfy QG-52's ≤ 2% coverage delta. |
| **QG-28 Chart render < 1000ms (156 weeks)** | yes | New breakdown surface inherits 334's row-rendering performance posture; cap at 50 rows bounds DOM cost. |
| **QG-29 Chart data caps enforced** | yes | New chart module declares `MAX_COMMENTS_REPO_DENSITY_ROWS = 50` constant per FR-4-06. |
| **QG-30..34 Demo parity** | yes | Capability-on demo manifest carries the `by_repository_comments` namespace; capability-off variant omits the entire key (FR-3-03). `tests/integration/test_demo_variants_byte_identity.py` extended. |
| **QG-35..38 Local/CI parity** | yes | All new tests run in pre-push preflight + CI; no local-degraded paths; `--no-verify` forbidden. |
| **QG-39 Cross-OS** | yes | Pure Python + TypeScript; no shell-out to OS-specific tools. |
| **QG-40 No `typing.Any`** | yes | New aggregator code uses precise types (`dict[str, int \| bool]`, TypedDict for sub-object emission). |
| **QG-41 Zero inline suppressions** | yes | Suppression baseline stays at zero; `audit-suppressions.py` gate enforced. |
| **QG-42 Enterprise test coverage** | yes | Producer / schema / chart / reconciliation / meta / byte-identity / live-loader regression tests all required by spec; each test path covered. |
| **QG-43 Per-commit ratchet bump** | yes | Each commit that adds N tests bumps `.test-floor-contract.json` by exactly N. |
| **QG-44 Single source of truth for floors** | yes | No hardcoded floors; all floors via `--min-collected-artifact`. |
| **QG-45 Cross-OS Python collection parity** | yes | New tests are collection-stable across OS lanes (no platform gates at module scope). |
| **QG-46 Platform-conditional file naming** | yes | No platform-conditional tests added (none of this code is OS-specific). |
| **QG-47 Pre-commit trigger scope** | yes | Existing test-trigger predicate covers new test file paths; aggregator + schema source changes trigger existing UI / Python triggers. No new trigger predicate needed. |
| **QG-48 Worktree-clean guards** | n/a | This feature does not add a new pre-commit gate. Existing guards cover the affected scopes. |
| **QG-49 Single command, many callers** | yes | The reconciliation test extension (FR-2-04) is invoked via the standard `pytest tests/integration/` path used by pre-push preflight + CI; no new dedicated CommandSpec needed. The schema-parity gate is intentionally NOT extended (CL-08). |
| **QG-50..52 Change acknowledgement** | yes (test-floor only) | Each commit that adds tests bumps `.test-floor-contract.json` by exactly N (QG-43); no `[ratchet-realignment]` marker expected. Coverage delta ≤ 2% per QG-52. |
| **QG-53..55 Build architecture** | yes | New chart module under `extension/ui/modules/charts/` follows the existing split-tsconfig + esbuild-owns-`dist/ui/` posture; Prettier invoked only via the `format:check` script. |
| **QG-56 Security scan (gitleaks)** | yes | Runs on every commit; new code adds no secrets. |

**No Constitution gate violations identified.** No Complexity Tracking entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/335-comments-repo-density/
├── plan.md                                    # This file (/speckit.plan command output)
├── spec.md                                    # Feature specification (all 10 CL-axes locked)
├── research.md                                # Phase 0 output (3 ADRs — minimum needed)
├── data-model.md                              # Phase 1 output (entity definitions)
├── quickstart.md                              # Phase 1 output (verification steps)
├── contracts/
│   └── per-repo-comments-density.md           # Field shape contract for rollup[W].by_repository_comments
├── checklists/
│   └── requirements.md                        # Spec quality checklist (PASS, all axes locked)
└── tasks.md                                   # Phase 2 output (created by /speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
# Backend (Python aggregator)
src/ado_git_repo_insights/transform/
└── aggregators.py                             # Add _compute_weekly_by_repository_comments(week_pr_uids)
                                                # helper paralleling existing _compute_weekly_by_author_comments
                                                # (aggregators.py:1088). SQL groups by pr.repository_id (no
                                                # LEFT JOIN users — no sentinel per CL-03 / FR-1-03). Call
                                                # site in _generate_weekly_rollups() emits by_repository_comments
                                                # immediately after by_author_comments emission.

# Extension (TypeScript UI)
extension/ui/
├── index.html                                 # NOT MODIFIED (per FR-3-01 + SC-1-03 byte-identity).
├── dataset-loader.ts                          # Extend Rollup interface with optional
                                                # by_repository_comments?: Record<string, RepoCommentsDensityEntry>
                                                # field (mirrors by_author_comments at dataset-loader.ts:220-228).
├── dashboard.ts                               # Two helpers + capability gate. ensureCommentsRepositoryDensityContainer()
                                                # — idempotent insertion below per-author row (anchor on
                                                # [data-comments-author-density-row="true"] per CL-10);
                                                # row carries [data-comments-repository-density-row="true"].
                                                # removeCommentsRepositoryDensityContainer() — finds row
                                                # by data attribute and removes; no-op if absent.
                                                # Render path: capability-on → ensure + render with
                                                # repositoriesDimension = currentDimensions?.repositories?.map(...);
                                                # capability-off → remove. Lifecycle parity per FR-3-02.
├── styles.css                                 # Reuse existing 333 / 334 .coverage-partial CSS class hooks.
                                                # New row-table styles ONLY if not already shared with 334;
                                                # plan-level: prefer reuse via class composition.
├── schemas/
│   └── rollup.schema.ts                       # Extend Rollup interface with optional
                                                # by_repository_comments Record; add "by_repository_comments"
                                                # to KNOWN_ROOT_FIELDS; implement validateRepositoryCommentsDensity()
                                                # validator alongside existing validateAuthorCommentsDensity()
                                                # (rollup.schema.ts:832). Atomicity STRICT-ERROR posture
                                                # mirrors 334 (INV-3-08).
└── modules/charts/
    ├── comments-repository-density.ts          # NEW chart module (~200 lines, modeled directly on
                                                # comments-author-density.ts at extension/ui/modules/charts/
                                                # comments-author-density.ts). Differences from 334:
                                                # - reads rollup[W].by_repository_comments instead of by_author_comments
                                                # - takes repositoriesDimension instead of authorsDimension
                                                # - NO FORMER_OR_UNAVAILABLE_AUTHOR_KEY constant, NO label-mapping
                                                #   branch (CL-03 simplification)
                                                # - display label resolution: repository_name from dimension;
                                                #   raw repository_id fallback per CL-04 / FR-4-11
                                                # - tie-break: chosen-metric desc → repository_name asc →
                                                #   repository_id asc (FR-4-05 — apply same ternary-collapse
                                                #   334 used to keep partial-branches ratchet at zero)
                                                # - MAX_COMMENTS_REPO_DENSITY_ROWS = 50 (CL-06 / FR-4-06)
    └── index.ts                                # Barrel export updated to include comments-repository-density

# Tests
tests/
├── integration/
│   ├── test_comments_trend_reconciliation.py  # EXTEND — FR-2-01 (per-repo parity) + FR-2-02 (independent
                                                # re-computation grouped by repository_id) + NEW FR-2-03
                                                # cross-aggregate sum-coherence assertion. The sum-coherence
                                                # check runs on every week W where both `comments` and
                                                # `by_repository_comments` are emitted; the test
                                                # automatically discovers truncated weeks via _prs_truncated:true
                                                # introspection (week-agnostic per A-11). Import-block isolation
                                                # (test_*_isolation.py) covers automatically (file-level, not dimension-level).
│   ├── test_comments_trend_meta_failure.py    # EXTEND — FR-2-05 per-repo INV-3-07 violation injection
                                                # (per-(week, repo) emission with active_thread_count >
                                                # thread_count) AND a per-week sum-coherence violation
                                                # injection (mutate one repo's thread_count so per-repo
                                                # sum no longer matches comments.thread_count).
│   └── test_demo_variants_byte_identity.py    # EXTEND — gate the new `by_repository_comments` key under
                                                # capability-off for ALL FOUR omission failure modes
                                                # (absent / null / {} / partial).
└── unit/
    └── test_aggregators_repo_comments.py      # NEW — FR-1-* cases (mirrors 334 unit-test scope minus
                                                # the sentinel cases per CL-03):
                                                # (i) all-extracted week → all coverage_partial=false
                                                # (ii) mixed-extraction repo → coverage_partial=true,
                                                #      sums over EXTRACTED-SUBSET ONLY
                                                # (iii) all-unextracted repo → coverage_partial=true,
                                                #       all numeric=0 (bucket still emitted)
                                                # (iv) capability-off → no by_repository_comments key
                                                # (v) atomicity (FR-1-07) — entry has all 4 fields or none
                                                # (vi) ordering (FR-1-08) — active <= thread per entry
                                                # (vii) full extracted-subset scope (FR-1-09) — emission
                                                #       covers W's full canonical PR set, not drill-down slice
                                                # NOT included: sentinel collision-safety test (334 T029
                                                # equivalent) — explicitly omitted per CL-03.

extension/tests/
├── modules/charts/
│   └── comments-repository-density.test.ts    # NEW — chart unit tests:
                                                # - FR-4-01..06 row rendering / sort / cap / truncation
                                                # - FR-4-03 partial-coverage qualifier per row
                                                # - FR-4-07 filter-not-supported on any active filter
                                                # - FR-4-08 no-data-in-range vs filter-not-supported
                                                # - FR-4-09 no click-through
                                                # - FR-4-10 a11y (sort selector keyboard, screen-reader text)
                                                # - FR-4-11 raw-ID fallback when repositoriesDimension entry missing
├── schema/
│   └── rollup.test.ts                         # EXTEND — schema validates `by_repository_comments` outer dict:
                                                # - valid 4-field entry passes
                                                # - missing field → atomicity error
                                                # - non-integer / negative → validation error
                                                # - active_thread_count > thread_count → ordering error
                                                # - capability-off (key absent) passes
├── dashboard/
│   └── comments-repository-density-lifecycle.test.ts  # NEW — capability-on/off lifecycle parity (FR-3-02):
                                                # - initial capability-off: no row in DOM, layout pristine
                                                # - on→off transition: row removed cleanly
                                                # - off→on transition: row inserted exactly once below
                                                #   the per-author row at the data-attribute anchor
                                                # - on→on re-render idempotency: no duplicate row
└── artifact-client.test.ts                    # EXTEND — FR-3-04 F3 live-loader regression:
                                                # - AuthenticatedDatasetLoader.getCapabilityState()?.commentsMetricsAvailable === true
                                                #   on a dataset variant containing the by_repository_comments key
                                                #   (analog of the by_author_comments regression added for #334 in PR #349)

# Demo generator (parallel path per memory feedback_demo_generator_parallel_path.md / A-09)
scripts/
└── generate-demo-data.py                      # ADD _aggregate_by_repository_comments_for_week() helper
                                                # paralleling existing _aggregate_by_author_comments_for_week
                                                # (generate-demo-data.py:567). Call site in
                                                # _build_weekly_rollup() emits by_repository_comments
                                                # immediately after by_author_comments emission.
                                                # Without this mirror, byte-identity tests on the demo
                                                # dataset pass vacuously.

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
#   - docs/data/aggregates/weekly_rollups/*.json      # rollup JSONs gain by_repository_comments namespace
#   - docs/data/dataset-manifest.json                 # manifest carries capabilities.comments_metrics state
#   - artifacts/demo-enterprise-comments-off/         # capability-off variant (byte-identity baseline)
```

**Structure Decision**: this feature follows the existing repo split — Python aggregator under `src/ado_git_repo_insights/transform/`, extension UI under `extension/ui/`, integration tests under `tests/integration/`, demo artifacts under `docs/data/`. No new top-level directories. The chart module follows the established `extension/ui/modules/charts/<name>.ts` pattern (modeled directly on 334's `comments-author-density.ts`, simplified by removing the sentinel branch per CL-03).

## Phase 0: Outline & Research

See [research.md](./research.md) for the full ADR set. Three ADRs pin the genuinely new implementation questions for this feature:

- **ADR R001** — Chart module file name + display-label-fallback wiring: `extension/ui/modules/charts/comments-repository-density.ts`, modeled directly on `comments-author-density.ts` with sentinel-branch removed (CL-03) and `repositoriesDimension`-fed label resolution with raw `repository_id` fallback (CL-04 / FR-4-11). Fallback path covered by a unit test colocated in the chart-module test file.
- **ADR R002** — Cross-aggregate sum-coherence test placement (NEW for this feature): extend `tests/integration/test_comments_trend_reconciliation.py` in-place (CL-05). The test is week-agnostic — it iterates every week W where both `comments` and `by_repository_comments` are emitted, asserts SUM_repo equality field-by-field plus OR-coherence on `coverage_partial`. Truncated weeks (`_prs_truncated: true`) are auto-discovered rather than hard-coded; W26 is the current witness but the assertion survives demo regeneration if truncation shifts to a different week per A-11.
- **ADR R003** — Failure-mode meta-test extension (FR-2-05): extend `tests/integration/test_comments_trend_meta_failure.py` in-place with TWO new injections — (a) per-(week, repo) emission with `active_thread_count > thread_count` (INV-3-07 violation), (b) per-week sum-coherence violation (mutate one repo's `thread_count` to break the FR-2-03 sum equality). Both injections MUST cause the FR-2-04 reconciliation test to FAIL on the mutated dataset.

ADRs that 334 needed but 335 does NOT need (silent inheritance):

- Sort selector pattern (WAI-ARIA Toolbar) — locked verbatim by CL-06 / FR-4-05; no plan-level choice.
- Schema validator atomicity posture (STRICT-ERROR) — mirrors 334's pattern; no plan-level choice.
- Partial-coverage visual qualifier (hatched + dimmed) — reuse 333 / 334's `.coverage-partial` CSS class hooks; no plan-level choice.
- Week-attribution rule — same `closed_date → ISO-week` formula 333 / 334 / throughput use; per-PR parity test (`tests/integration/test_week_attribution_parity.py`) already guards drift across all aggregators.
- Sentinel literal name + label — N/A (CL-03: no sentinel concept).

## Phase 1: Design & Contracts

See:

- [data-model.md](./data-model.md) — entity definitions (existing referenced + new `Per-Repo Comments-Density Emission`).
- [contracts/per-repo-comments-density.md](./contracts/per-repo-comments-density.md) — field shape contract, producer behavior, consumer behavior, cross-aggregate sum-coherence contract.
- [quickstart.md](./quickstart.md) — verification steps for human + automated.

## Constitution Re-Check (post-design)

After Phase 1 design, all gates above remain PASSED. The schema-parity gate intentional non-extension (CL-08) is documented in `contracts/per-repo-comments-density.md`. The reconciliation extension is in-place to 333's test (CL-05); the import-block isolation guarantee propagates automatically. The ADR set in `research.md` does not introduce any new dependency, gate, or invariant beyond the spec. **No design-stage scope creep detected.**

## Deliberate Omissions (per user directive)

The following are EXPLICITLY out of scope for this plan / tasks / implementation:

- **Smoke tests** — none. Existing pre-push preflight + CI gate chain is sufficient.
- **Sentinel infrastructure** — none. CL-03 / FR-1-03 / INV-3-12 explicitly drop sentinel for the per-repo dimension; FK-protection makes it unnecessary. The `__former_or_unavailable_*__` literal pattern from 334 is NOT carried over.
- **Abstraction extraction** — none. A-08 explicitly defers shared-abstraction extraction to #336 (per-reviewer) so it is informed by all three concrete instances. Duplicating the 334 chart module is the correct posture per memory `feedback_no_invented_abstractions.md`.
- **Docs parity gates / wording-parity tests** — none. Memory `feedback_doc_parity_is_churn_bait.md` rules these out. Inline comments at each site are the right tool.
- **New pre-commit / pre-push hooks** — none. All testing surfaces fit in existing `pytest tests/integration` / `pnpm test` invocations gated by existing trigger predicates per QG-47.
- **Pipeline changes** — none. The existing CI workflow `.github/workflows/ci.yml` runs the affected tests via existing job matrix; no new job, step, or workflow file needed.
- **Managed-artifact ceremony beyond canonical sync/build** — single `manage_generated_artifacts.py sync --scope all --stage`, single `scripts/build-demo-dataset.py` run, single `manage_generated_artifacts.py verify`. NO per-managed-path regenerate enumeration in tasks.md (memory `feedback_canonical_artifact_sync_one_task.md`).

## Complexity Tracking

> Empty — no Constitution Check violations identified.
