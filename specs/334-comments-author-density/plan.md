# Implementation Plan: Dashboard per-author comment density breakdown

**Branch**: `feat/334-comments-author-density` | **Date**: 2026-04-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/334-comments-author-density/spec.md` (all 8 CL-axes locked 2026-04-27 by user directive — Path B; zero `[NEEDS CLARIFICATION]` markers; zero branch-aware alternatives in executable requirements)
**Issue**: #334 (split from #322 — Capability 2, author dimension; first of three sibling Cap-2 dimension PRs alongside #335 repo + #336 reviewer; sibling #321 team is on-hold)

## Summary

Add a per-author comments-density breakdown surface to the dashboard's Metrics tab, gated on `capabilities.comments_metrics`. Backed by a new `rollup[W].by_author_comments[<author_id>]` per-week sub-object that the aggregator emits when capability-on. The breakdown reduces per-(week, author) emissions to a range-total per row over the user-selected date range, sorts by chosen metric (default `comment_count`), caps at 50 rows, and surfaces a partial-coverage qualifier per row when the row's reduced `coverage_partial` is `true`. Authors absent from the `users` table collapse into one sentinel-bucketed row labeled "Former / unavailable author" per 310 C1. Filter-not-supported empty state when ANY dimension filter is active (full 333 FR-1-07 parity).

This is the foundation PR for the per-author dimension; siblings #335 (per-repo) and #336 (per-reviewer) inherit the visual + interaction pattern locked here. SC-05 cross-feature coherence (310 INV-07 / 333 INV-1-02) is closed for the per-author scope by extending 333's `tests/integration/test_comments_trend_reconciliation.py` in-place.

## Technical Context

**Language/Version**: Python 3.12+ (backend, aggregator, scripts, tests) and TypeScript 6.0.3 (extension UI). Matches existing baseline per `CLAUDE.md`.

**Primary Dependencies**: existing only — Backend: `argparse`, `sqlite3` via `DatabaseManager`, `pandas` (aggregator group-by), `pytest` + `unittest.mock.MagicMock`. Extension: Jest 30.x + jsdom 28.x test environment, esbuild bundler, VSS SDK runtime. **No new third-party runtime or dev dependencies.**

**Storage**: SQLite via existing `DatabaseManager`. **No schema changes; no migrations.** Reads `pr_threads`, `pr_comments`, `pull_requests.comments_extracted_at`, `users` (LEFT JOIN for sentinel detection per FR-1-03 / CL-03) — all present since Feature 058. INV-2-05 (extractor frozen, inherits 310 INV-06 / 333 INV-1-05) preserved.

**Testing**: pytest (Python integration + unit), Jest 30.x (extension). `.test-floor-contract.json` bumped in the same commit as added tests per QG-43. `--max-skips=0` enforced (QG-46). Tests collection-stable per QG-45 / Principle XXVI.

**Target Platform**: Cross-OS (Windows + Linux + macOS) per QG-39. Extension targets Azure DevOps via VSS SDK; dashboard renders in Chromium / Edge browser surface.

**Project Type**: web-service + extension-app (backend Python aggregator + TypeScript extension UI).

**Performance Goals**: New breakdown surface MUST render within QG-28's existing 1000ms / 156-week scalability gate (which already covers chart-render performance at scale; this feature inherits without adding a new gate). Top-N=50 row cap (`MAX_COMMENTS_AUTHOR_DENSITY_ROWS`) bounds render cost regardless of dataset author cardinality. Aggregator-side runtime is governed by the existing producer test-suite wall-clock budgets (no new single-run wall-clock assertion is added — single-run timings are CI-flake bait).

**Constraints**:
- CSV contract frozen (INV-2-04 / 310 INV-05 / 333 INV-1-04 / Constitution Principle I-IV). No producer-side CSV changes.
- Extractor frozen (INV-2-05 / 310 INV-06 / 333 INV-1-05). Reads `pr_threads` / `pr_comments` / `users` only.
- 333's per-PR `PrRecord` shape (declared at `extension/ui/schemas/rollup.schema.ts` `PrRecord` interface) MUST NOT be shadowed; this feature's namespace is `by_author_comments` (separate from `comments` and `by_author`).
- Schema-parity gate (`scripts/check_pr_record_schema_parity.py`, Row 38, QG-49) intentionally NOT extended for the rollup-level `by_author_comments` namespace; the FR-2-04 reconciliation test extension is the sole authority for this feature's parity (CL-08 = follow 333 Decision 5).
- `--no-verify` forbidden (QG-38).
- Zero inline suppressions (QG-41) — `# noqa` / `# type: ignore` / `// eslint-disable` are forbidden in new code; refactor patterns from `reference_s608_refactor_pattern.md` apply for any dynamic SQL.
- No `typing.Any` (QG-40).

**Scale/Scope**: Demo dataset has ≥10 distinct authors with mixed comment-load (per A-03), at least 1 unknown-to-`users` author exercising the sentinel, and at least one author with mixed extraction exercising the per-row `coverage_partial` qualifier. Top-N display cap inherits the chart-truncation pattern (constant `MAX_COMMENTS_AUTHOR_DENSITY_ROWS = 50`). Aggregator emits one `by_author_comments` sub-object per week for capability-on datasets; per-week payload depends on author cardinality (one entry per (week, author) tuple under capability-on). Estimated payload increase per rollup file: ~100 bytes × author cardinality (4 fields per entry + JSON overhead).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The following gates are touched by this feature:

| Gate | Applies | How this PR honors it |
|---|---|---|
| **QG-01..04 CSV Contract** | indirect | INV-2-04 / 310 INV-05 / 333 INV-1-04 frozen — no CSV changes. PASSED by non-touch. |
| **QG-05 Golden output determinism** | yes | Aggregator emission MUST produce deterministic per-(week, author) ordering — outer `by_author_comments` dict keys sorted ascending by author key (the stable identity string, including the sentinel literal `__former_or_unavailable_author__`); display name is NOT the producer's sort key (display names can collide; producer-side sort on stable identity guarantees byte-determinism). UI row tie-breaking is renderer-side (FR-4-05). `tests/integration/test_golden_outputs.py` gates this. |
| **QG-19 Unit + integration tests** | yes | New tests in `tests/unit/test_aggregators_author_comments.py` (FR-1-* cases) and extension to `tests/integration/test_comments_trend_reconciliation.py` (FR-2-01/02/03 per-author parity), `tests/integration/test_comments_trend_meta_failure.py` (FR-2-05 per-author INV-2-07 violation), `tests/integration/test_demo_variants_byte_identity.py` (FR-3-03 four omission failure modes for `by_author_comments`). |
| **QG-20 Coverage threshold** | yes | New code paths must satisfy QG-52's ≤ 2% coverage delta. |
| **QG-28 Chart render < 1000ms (156 weeks)** | yes | New breakdown surface inherits the row-rendering performance posture; cap at 50 rows bounds DOM cost. Validated by `extension/tests/unit/chart-scalability.test.ts` extension. |
| **QG-29 Chart data caps enforced** | yes | New chart module declares `MAX_COMMENTS_AUTHOR_DENSITY_ROWS = 50` constant per FR-4-06. |
| **QG-30..34 Demo parity** | yes | Capability-on demo manifest carries the `by_author_comments` namespace; capability-off variant omits the entire key (FR-3-03). `tests/integration/test_demo_variants_byte_identity.py` extended (the existing locked-shape gate per 333 ADR T001). |
| **QG-35..38 Local/CI parity** | yes | All new tests run in pre-push preflight + CI; no local-degraded paths; `--no-verify` forbidden. |
| **QG-39 Cross-OS** | yes | Pure Python + TypeScript; no shell-out to OS-specific tools. |
| **QG-40 No `typing.Any`** | yes | New aggregator code uses precise types (`dict[str, int \| bool]`, `TypedDict` for sub-object emission). |
| **QG-41 Zero inline suppressions** | yes | Suppression baseline stays at zero; `audit-suppressions.py` gate enforced. Dynamic SQL (if any) follows `reference_s608_refactor_pattern.md`. |
| **QG-42 Enterprise test coverage** | yes | Producer / schema / chart / reconciliation / meta / byte-identity tests all required by spec; each test path covered. |
| **QG-43 Per-commit ratchet bump** | yes | Each commit that adds N tests bumps `.test-floor-contract.json` by exactly N. Test-count breakdown pinned in tasks.md per phase. |
| **QG-44 Single source of truth for floors** | yes | No hardcoded floors; all floors via `--min-collected-artifact`. |
| **QG-45 Cross-OS Python collection parity** | yes | New tests are collection-stable across OS lanes (no platform gates at module scope). |
| **QG-46 Platform-conditional file naming** | yes | No platform-conditional tests added (none of this code is OS-specific). |
| **QG-47 Pre-commit trigger scope** | yes | Existing test-trigger predicate covers new test file paths; aggregator + schema source changes trigger existing UI / Python triggers. No new trigger predicate needed. |
| **QG-48 Worktree-clean guards** | n/a | This feature does not add a new pre-commit gate. Existing guards cover the affected scopes. |
| **QG-49 Single command, many callers** | yes | The reconciliation test extension (FR-2-04) is invoked via the standard `pytest tests/integration/` path used by pre-push preflight + CI; no new dedicated CommandSpec needed. The schema-parity gate (`scripts/check_pr_record_schema_parity.py`) is intentionally NOT extended (CL-08 = follow 333 Decision 5). |
| **QG-50..52 Change acknowledgement** | yes (test-floor only) | Each commit that adds tests bumps `.test-floor-contract.json` by exactly N (QG-43); no `[ratchet-realignment]` marker expected for a clean foundation PR. No version override or threshold update markers expected. Coverage delta ≤ 2% per QG-52. |
| **QG-53..55 Build architecture** | yes | New chart module under `extension/ui/modules/charts/` follows the existing split-tsconfig + esbuild-owns-`dist/ui/` posture; Prettier invoked only via the `format:check` script. |
| **QG-56 Security scan (gitleaks)** | yes | Runs on every commit; new code adds no secrets. |

**No Constitution gate violations identified.** No Complexity Tracking entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/334-comments-author-density/
├── plan.md                                    # This file (/speckit.plan command output)
├── spec.md                                    # Feature specification (all 8 CL-axes locked)
├── research.md                                # Phase 0 output (decisions + rationale)
├── data-model.md                              # Phase 1 output (entity definitions)
├── quickstart.md                              # Phase 1 output (verification steps)
├── contracts/
│   └── per-author-comments-density.md         # Field shape contract for rollup[W].by_author_comments
├── checklists/
│   └── requirements.md                        # Spec quality checklist (PASS, all axes locked)
└── tasks.md                                   # Phase 2 output (created by /speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
# Backend (Python aggregator)
src/ado_git_repo_insights/transform/
└── aggregators.py                             # Extend _generate_weekly_rollups() to emit
                                                # `by_author_comments` sub-object on rollup root
                                                # when _has_comments() is true. New emission:
                                                # dict keyed by author_id (or sentinel literal),
                                                # values per FR-1-02 / FR-1-07 atomicity.

# Extension (TypeScript UI)
extension/ui/
├── index.html                                 # NOT MODIFIED (per FR-3-01 + SC-1-03 byte-identity).
                                                # No new <div>, no <template>. Same dynamic-insertion
                                                # pattern as 333 (T020 lock).
├── dashboard.ts                               # Two helpers + capability gate. ensureCommentsAuthorDensityContainer()
                                                # — idempotent insertion; returns existing if present.
                                                # removeCommentsAuthorDensityContainer() — finds row
                                                # by data attribute and removes; no-op if absent.
                                                # Render path: capability-on → ensure + render;
                                                # capability-off → remove. At any moment when capability
                                                # is off, Metrics tab DOM is byte-identical to pre-feature
                                                # (FR-3-01 + SC-1-03 + FR-3-02 lifecycle parity).
├── styles.css                                 # New row-table styles + sort-selector + partial-coverage
                                                # qualifier (hatched + dimmed per 333 ADR T005 reused).
├── schemas/
│   └── rollup.schema.ts                       # Extend Rollup interface with optional
                                                # `by_author_comments` Record<string, AuthorCommentsDensityEntry>;
                                                # add `"by_author_comments"` to KNOWN_ROOT_FIELDS;
                                                # implement validateAuthorCommentsDensity() validator
                                                # alongside existing validateCommentsAggregate() at the
                                                # rollup-root scope. Atomicity STRICT ERROR posture per
                                                # ADR T003 propagated (mirrors 333 ADR T004 / INV-2-08).
└── modules/charts/
    ├── comments-author-density.ts             # NEW chart module (~250 lines, modeled on the
                                                # 333 `comments-trend.ts` structural template adapted
                                                # for table/row rendering rather than bar+line, per
                                                # ADR T001).
                                                # Reads `rollup[W].by_author_comments` per week,
                                                # reduces per-author over visible date range,
                                                # renders top-50-by-chosen-metric rows + sort
                                                # selector + partial-coverage qualifier per row.
                                                # Filter-not-supported empty state when any
                                                # dimension filter is active (FR-4-07).
    └── index.ts                               # Barrel export updated to include comments-author-density

# Tests
tests/
├── integration/
│   ├── test_comments_trend_reconciliation.py  # EXTEND — FR-2-01 (per-author parity) + FR-2-02
                                                # (independent re-computation, sentinel-bucketed)
                                                # + FR-2-03 (sentinel parity). Per-PR pairwise
                                                # extends to (PR, author = P's author OR sentinel).
                                                # Import-block isolation (test_*_isolation.py)
                                                # covers automatically (file-level, not dimension-level).
│   ├── test_comments_trend_meta_failure.py    # EXTEND — FR-2-05 per-author INV-2-07 violation
                                                # injection (e.g., sentinel bucket with
                                                # active_thread_count > thread_count).
│   └── test_demo_variants_byte_identity.py    # EXTEND — gate the new `by_author_comments` key
                                                # under capability-off for ALL FOUR omission
                                                # failure modes (absent / null / {} / partial).
└── unit/
    └── test_aggregators_author_comments.py    # NEW — FR-1-* cases:
                                                # (i) all-extracted week → all coverage_partial=false
                                                # (ii) mixed-extraction author → coverage_partial=true,
                                                #      sums over EXTRACTED-SUBSET ONLY
                                                # (iii) all-unextracted author → coverage_partial=true,
                                                #       all numeric=0 (sentinel and real authors alike)
                                                # (iv) capability-off → no `by_author_comments` key
                                                # (v) sentinel bucketing → unknown-to-`users` authors
                                                #     collapse into one entry keyed by reserved literal
                                                # (vi) atomicity (FR-1-07) — entry has all 4 fields or none
                                                # (vii) ordering (FR-1-08) — active <= total per entry

extension/tests/
├── modules/charts/
│   └── comments-author-density.test.ts        # NEW — chart unit tests:
                                                # - FR-4-01..06 row rendering / sort / cap / truncation
                                                # - FR-4-03 partial-coverage qualifier per row
                                                # - FR-4-07 filter-not-supported on any active filter
                                                # - FR-4-08 no-data-in-range vs filter-not-supported
                                                # - FR-4-09 no click-through
                                                # - FR-4-10 a11y (sort selector keyboard, screen-reader text)
├── schema/
│   └── rollup.test.ts                         # EXTEND — schema validates `by_author_comments` sub-object:
                                                # - valid 4-field entry passes
                                                # - missing field → atomicity error (STRICT both modes per ADR T003)
                                                # - non-integer / negative → validation error
                                                # - active_thread_count > thread_count → ordering error
                                                # - capability-off (key absent) passes
                                                # - sentinel literal as key permitted
└── dashboard/
    └── comments-author-density-lifecycle.test.ts  # NEW — capability-on/off lifecycle parity (FR-3-02):
                                                # - initial capability-off: no row in DOM, layout pristine
                                                # - on→off transition: row removed cleanly
                                                # - off→on transition: row inserted exactly once
                                                # - on→on re-render idempotency: no duplicate row

# Test floor
.test-floor-contract.json                      # BUMP by N in the same commit as added tests (QG-43)

# Canonical artifact sync — covers EVERY managed output the change touches.
# Tasks MUST run the canonical sync + verify (NOT a hand-curated docs/data/ regenerate).
# Run: python scripts/manage_generated_artifacts.py sync --scope all --stage
# Then: python scripts/manage_generated_artifacts.py verify  (fails if any managed path is unstaged)
# Outputs this feature touches (sync drives all of them; do NOT enumerate manually):
#   - extension/ui/dist/                              # esbuild bundles (rebuilt for the new chart module)
#   - docs/data/aggregates/weekly_rollups/*.json      # rollup JSONs gain `by_author_comments` namespace
#   - docs/data/dataset-manifest.json                 # manifest carries capabilities.comments_metrics state
#   - any sibling managed paths the canonical sync touches (let `sync --scope all` drive)
```

**Structure Decision**: this feature follows the existing repo split — Python aggregator under `src/ado_git_repo_insights/transform/`, extension UI under `extension/ui/`, integration tests under `tests/integration/`, demo artifacts under `docs/data/`. No new top-level directories. The chart module follows the established `extension/ui/modules/charts/<name>.ts` pattern (modeled directly on 333's `comments-trend.ts`, adapted for table/row rendering per ADR T001 in research.md).

## Phase 0: Outline & Research

See [research.md](./research.md) for the full ADR set. Six ADRs pin the open implementation questions:

- **ADR T001** — Chart module file name + structural template: `extension/ui/modules/charts/comments-author-density.ts`, modeled on 333's `comments-trend.ts` adapted for table/row rendering (no bars, no overlaid line, no SVG).
- **ADR T002** — Sort selector UI pattern: button group (radio-style, three buttons), keyboard-accessible.
- **ADR T003** — Schema validator atomicity posture: STRICT ERROR in both strict and permissive modes (mirrors 333 ADR T004; INV-2-08 atomicity).
- **ADR T004** — Partial-coverage qualifier visual: hatched fill (`repeating-linear-gradient`) + dimmed text + tooltip (mirrors 333 ADR T005).
- **ADR T005** — Week-attribution rule reuse: comments-author aggregator implements its own (same `closed_date → pd.to_datetime → .dt.isocalendar() → f"{year}-W{week:02d}"` formula 333 / throughput use); per-PR parity test guards drift (mirrors 333 ADR T003 option (b)). 333's reconciliation test extension implements its third re-implementation in the test side, per 333 round-9 import-block isolation.
- **ADR T006** — Sentinel literal name + label: aggregator-side reserved key `__former_or_unavailable_author__`; renderer-side fixed-string label `"Former / unavailable author"` (English-only for v1 per CL-03 informed default).

## Phase 1: Design & Contracts

See:

- [data-model.md](./data-model.md) — entity definitions (existing referenced + new `Per-Author Comments-Density Emission`).
- [contracts/per-author-comments-density.md](./contracts/per-author-comments-density.md) — field shape contract, producer behavior, consumer behavior.
- [quickstart.md](./quickstart.md) — verification steps for human + automated.

## Constitution Re-Check (post-design)

After Phase 1 design, all gates above remain PASSED. The schema-parity gate intentional non-extension (CL-08) is documented in `contracts/per-author-comments-density.md` §4. The reconciliation extension is in-place to 333's test (CL-04); the import-block isolation guarantee propagates automatically. The ADR set in `research.md` does not introduce any new dependency, gate, or invariant beyond the spec. **No design-stage scope creep detected.**

## Complexity Tracking

> Empty — no Constitution Check violations identified.
