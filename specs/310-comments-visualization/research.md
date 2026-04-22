# Research: Comment visualization — Drill-down extension (Feature 310)

**Phase**: 0 (Outline & Research) — resolves all NEEDS CLARIFICATION before Phase 1 design.
**Scope**: seven research decisions (R-01..R-07) inputs into [plan.md](./plan.md) and [data-model.md](./data-model.md).

All clarifications C1..C5 are already resolved in [spec.md](./spec.md) and are NOT re-opened here. The research below focuses on implementation-strategy choices locked by the user during planning (DIRECTIVE 1..7 and the user's additional constraints in the plan-approval response).

---

## R-01 — Coverage signal: per-PR `comments_extracted_at` (SOLE signal)

**Decision**: The sole signal used to decide per-PR render state is `pull_requests.comments_extracted_at IS NOT NULL` vs `IS NULL`. No dataset-level fallback; no hybrid.

**Rationale**:

- Dataset-level `manifest.coverage.comments` status (`"full" | "partial" | "disabled"`) is **derived** from per-PR `comments_extracted_at` in `aggregators.py:1557-1568` (verified Pass 3). The per-PR column is authoritative; the dataset-level status is a strict function of it.
- FR-3-05 requires per-PR rendering of a "coverage partial" state distinguishable from a true-zero state. A dataset-level signal alone cannot satisfy this: when the dataset is `partial`, some PRs are covered and some are not, but dataset-level doesn't tell the renderer which PRs are which.
- INV-10 (coverage-partial state consistency): all three fields enter partial state together per PR. Per-PR encoding (all three `null` when uncovered; all three integers when covered) enforces this atomicity at the producer side.
- User constraint (plan-approval response): "lock per-PR `comments_extracted_at` as the only signal. Do not fallback to dataset-level anywhere in this feature."

**Alternatives considered**:

- **Dataset-level only** — REJECTED. Cannot render per-PR coverage-partial state per FR-3-05.
- **Hybrid (dataset-level + per-PR)** — REJECTED. DIRECTIVE 4 requires ONE signal, not mixed. User additionally locked out any fallback.
- **New per-PR coverage flag field** (e.g., `comments_coverage: "covered" | "partial"`) — REJECTED. Redundant; `null` sentinel on existing fields already encodes partial per R-02, and adding a 9th field would bloat the wire shape.

---

## R-02 — Partial-coverage sentinel: three `number | null` fields

**Decision**: The three new per-PR fields (`thread_count`, `comment_count`, `active_thread_count`) are each typed `NotRequired[int | None]` (Python; `typing.NotRequired`, Python 3.11+ / baseline 3.12) / `?: number | null` (TypeScript). The `NotRequired` / `?:` markers encode **optional presence** (field may be absent); the inner `int | None` / `number | null` encodes **nullable value** when present. `null` means "coverage partial for this PR". Non-null means the covered count (including `0`). When `capabilities.comments_metrics=false`, the fields are **absent entirely** from the serialized PR record (not `null`) — legal under both `NotRequired[int | None]` and `?: number | null`.

**Rationale**:

- Satisfies INV-08 (field atomicity): all three present together or absent together — no mixed state at the record level. Within the "present" case, INV-10 further requires all three be either all-null or all-number together (enforced by tests; see contract file).
- Distinguishes three states cleanly: absent (capability off), present-and-null (covered but coverage-partial), present-and-number (covered).
- Explicit `0` (number, not null) is a true zero per Acceptance Scenario 2.2 — "Given a PR with all threads resolved, When the drill-down renders that PR's row, Then the unresolved count is explicit `0` (not blank, not `—`), distinguishable from a true 'no comment data yet' state." Null sentinel pattern separates this from the partial state.
- Aligns with the permissive-validator convention already used by Feature 060 for optional fields (rollup.schema.ts:402-487): the validator warns on malformed shapes and treats malformed records as absent, never failing the load.

**Alternatives considered**:

- **Three optional fields `thread_count?: number` with absence = partial** — REJECTED. Breaks INV-08 at the wire level: absence on one field but not the other two would become a validator edge case. Cleaner to have three-together-or-none-together enforced as a producer rule with `null` as the partial sentinel.
- **Grouped sub-object `comments: { threadCount, commentCount, activeThreadCount }`** — REJECTED. Diverges from the existing flat-dict PR record shape. INV-08 atomicity can be enforced via tests on the flat shape with equal rigor and without breaking the 060 wire pattern.
- **Separate per-PR flag field (`comments_coverage: "covered" | "partial"`)** — REJECTED. See R-01 alternatives; redundant to the `null` sentinel.

---

## R-03 — Atomic schema expansion: 4 surfaces, no `KNOWN_PR_RECORD_FIELDS`

**Decision**: Atomic expansion of the PrRecord contract covers exactly 4 surfaces:

1. Python `PrRecord` TypedDict at `src/ado_git_repo_insights/types.py:289-301` (docstring updated to cite the 310 sibling contract).
2. TypeScript `PrRecord` interface at `extension/ui/schemas/rollup.schema.ts:73-79`.
3. `PR_RECORD_REQUIRED_FIELDS` at `extension/ui/schemas/rollup.schema.ts:136-142`.
4. **310 sibling contract** at `specs/310-comments-visualization/contracts/pr-record-comments-fields.md`, specifically its `§1 Canonical field declaration` section (machine-parseable markdown table). The 310 sibling contract is the authoritative documentation surface for the three new fields. This is the file the parity gate parses.

**Note on the 060 contract** at `specs/060-throughput-pr-drilldown/contracts/pr-record.md`: a one-line pointer update ("the 5 fields declared here are extended by the three additional fields in the 310 sibling contract when `capabilities.comments_metrics=true`") lands in the same tasks.md work, for human contract continuity. **This update is NOT a parity-gate-checked surface** — see [`contracts/schema-parity-gate.md`](./contracts/schema-parity-gate.md) for the rationale (it has no canonical table to drift against, and over-triggering on it would over-declare the gate's coverage).

`KNOWN_ROOT_FIELDS` is NOT in scope (governs rollup-root keys, not per-PR element keys; verified by reading `validatePrRecordArray` which never calls `findUnknownFields` on PR rows).

`KNOWN_PR_RECORD_FIELDS` is **not introduced** in this pass. Per the user's plan-approval constraint ("if you introduce it, it must be enforced everywhere or not at all. Partial enforcement creates silent drift. Default to not adding it in this pass."), adding a per-PR unknown-fields set would require wiring into the permissive validator + parity test + all consumer types — a larger refactor that belongs to a standalone hardening pass.

**Rationale**:

- User Q1 answer confirmed 4 surfaces and explicitly excluded `KNOWN_ROOT_FIELDS`.
- The existing validator is permissive by design (rollup.schema.ts:402 comment). Adding unknown-field strictness on PR rows is a legitimate hardening concern but scope-independent of Feature 310.

**Alternatives considered**:

- **Introduce `KNOWN_PR_RECORD_FIELDS` now** — REJECTED. Partial enforcement guaranteed by the current validator shape (other optional fields on PR records would not get the same treatment) creates silent drift (anti-pattern flagged by feedback memory "narrowing creates regressions").

---

## R-04 — Parity gate: single canonical command

**Decision**: The atomic-expansion parity gate is implemented as one canonical command — `python scripts/check_pr_record_schema_parity.py` — and invoked identically from every one of the four entry points Constitution QG-49 enumerates:

| Entry point | Invocation |
|---|---|
| pre-commit | new predicate (`is_pr_record_parity_trigger`) + runner (`run_pr_record_schema_parity_check`) in `scripts/run_repo_hook.py`, following the existing `is_ui_trigger` / `is_test_trigger` pattern (there is no `CommandSpec` abstraction in `run_repo_hook.py`) → identical command string |
| pre-push preflight | `scripts/run_pr_preflight.py` — new `CommandSpec(name=..., command=...)` using only the five real fields from the `@dataclass(frozen=True)` at `run_pr_preflight.py:71-76` (no `triggers_any_of`, no `degraded_fallback`) → identical command string |
| CI (Python job, Ubuntu + Windows) | `.github/workflows/ci.yml` step → exact command string |
| `pnpm test:ci` | `extension/package.json` adds `"test:schema-parity": "python ../scripts/check_pr_record_schema_parity.py"` and chains it into the existing `test:ci` script. Mirrors the existing `test:partial-branches` precedent at `extension/package.json:34` (which already shells from `pnpm test:ci` into `python ../scripts/check_partial_branches.py`). No duplicated logic; single canonical command string across all four entry points. |

**What the script checks**:

1. Parse `src/ado_git_repo_insights/types.py` (Python AST) → extract PrRecord TypedDict field names + types.
2. Parse `extension/ui/schemas/rollup.schema.ts` (TypeScript AST via a local `typescript` import — already a devDep) → extract PrRecord interface field names + types AND `PR_RECORD_REQUIRED_FIELDS` set.
3. Parse the 310 sibling contract file markdown → extract the declared PrRecord field table.
4. Assert: all four sources enumerate the identical set of field names with compatible types, split by presence-kind. Presence-required fields (TS without `?:`, Python without `NotRequired`): `int ↔ number`, `int | None ↔ number | null`, `str ↔ string`, `float ↔ number`. Presence-optional fields (TS `?:`, Python `NotRequired[...]`): `NotRequired[int | None] ↔ ?: number | null`, etc. Cross-presence mismatches (e.g., Python required + TS `?:`) fail the gate — see [`contracts/schema-parity-gate.md`](./contracts/schema-parity-gate.md) for the full compatibility tables.
5. Fail the gate with a human-readable diff on any mismatch.

**Pre-commit trigger scope** (QG-47) covers every file the gate reads:

- `src/ado_git_repo_insights/types.py`
- `extension/ui/schemas/rollup.schema.ts`
- `specs/060-throughput-pr-drilldown/contracts/pr-record.md`
- `specs/310-comments-visualization/contracts/pr-record-comments-fields.md`

**Worktree-clean guard** (QG-48): `require_clean_pr_record_parity_scope()` added to `scripts/run_repo_hook.py`, blocking commit if unstaged changes exist in any of the four read paths.

**pytest wrapper** `tests/unit/test_pr_record_schema_parity.py` imports the same Python module and asserts `main()` exits zero on the current tree — gives coverage credit and keeps the assertion inside the pytest collection.

**Rationale**:

- QG-49 requires one authoritative command invoked by name from every one of its four enumerated entry points: pre-commit, pre-push preflight, `pnpm test:ci`, and CI. A Python CLI script with a zero/non-zero exit status is the cleanest shape — identical string across callers, no duplicated logic.
- Precedent exists in-repo: `test:partial-branches` (`extension/package.json:34`) is a Python-scoped gate invoked from `pnpm test:ci` via a pnpm-script wrapper that shells to Python. The parity gate here follows the same pattern.
- User constraint (plan-approval): "must run via one canonical command invoked identically in pre-commit, pre-push, test:ci, and CI. No duplicated logic." All four entry points in scope; no hand-wave via QG-36 "local-modes-no-weaker" (that is a different invariant).

**Alternatives considered**:

- **One pytest test that does everything** — REJECTED. Pytest is not directly invokable from pre-commit without extra wrapping; running a bare script from pre-commit keeps the invocation identical across all entry points. (A thin pytest wrapper that calls the same `main()` is still added for coverage credit, per the Entry Point table above — but the canonical command remains the Python script.)
- **Two scripts (Python + TS)** — REJECTED. Creates drift risk (one might get updated and not the other); the user explicitly said "no duplicated logic."
- **AST parity in a Jest test only** — REJECTED. Cannot run from CI's Python job; pre-commit would need a TS runner installed, which is an environmental fragility (feedback memory "hooks requiring pnpm silently break python jobs").
- **Previous draft of this research note** had an "N/A for `pnpm test:ci`" row justified via QG-36 — REJECTED as self-inconsistent with QG-49 and with the user's explicit four-entry-point constraint. QG-36 ("no weaker local modes") and QG-49 ("one command, named, invoked from every listed entry point") are distinct gates; the `test:partial-branches` precedent proves the four-entry-point pattern is the standard, not an exception.

---

## R-05 — Aggregator join: top-500 slice first

**Decision**: The per-week aggregator join happens strictly AFTER the qualified→sorted→truncated slice is built. Flow inside `_generate_weekly_rollups`:

1. Compute qualified set (existing).
2. Sort by `(-cycle_time, pull_request_id)` (existing, stable).
3. Truncate to `_PR_DETAIL_CAP = 500` (existing).
4. Collect `pull_request_uid` values from the capped slice.
5. Issue ONE per-week query: `SELECT pull_request_uid, thread_count, comment_count, active_thread_count FROM (...) WHERE pull_request_uid IN (...)`. The subquery applies C1's inclusion rules on `pr_threads` and `pr_comments` (see contract file for SQL text).
6. Build an in-memory lookup map `{pull_request_uid: (thread_count, comment_count, active_thread_count) | None}` where `None` means the PR's `comments_extracted_at IS NULL` (partial).
7. In the existing `PrRecord` serialization loop (aggregators.py:797-834), attach three new fields per PR. When the capability is off on the manifest, attach NOTHING (no new fields emitted).

**Rationale**:

- User constraint (plan-approval): "enforce top-500 slice only before join. Do not compute counts outside the capped set."
- Performance: bounds the work to ≤500 PRs per week regardless of total week volume. Avoids scanning `pr_threads` / `pr_comments` for PRs never rendered.
- Determinism: Python `list.sort` is stable; existing `cycle_numeric.notna()` + `_PR_DETAIL_CAP` truncation already deterministic (Feature 060 locked). Adding the lookup map doesn't affect serialization order.

**C1 SQL inclusion rules** (applied in the subquery; exact text in [contracts/pr-record-comments-fields.md](./contracts/pr-record-comments-fields.md)):

- `pr_threads.is_deleted = 0` for thread_count AND active_thread_count.
- `pr_threads.status = 'active'` for active_thread_count (subset of thread_count).
- `pr_threads.status = 'unknown'` counts in thread_count (naturally excluded from active_thread_count).
- `pr_comments.is_deleted = 0` for comment_count.
- `pr_comments.comment_type = 'system'` counts in comment_count (no filter needed beyond is_deleted).
- Author-missing rows counted per C1 (no DROP JOIN to `users`; just count as-is; the sentinel label is a follow-on-feature render concern with no visible effect here per spec's Edge Cases).

**Alternatives considered**:

- **Join during the existing group-by upstream** — REJECTED. The qualified+capped slice is unknown before sort+truncate; an upstream join would compute counts for PRs that never render.
- **Two per-week queries (threads, comments separately)** — ACCEPTED as an implementation detail if SQL simpler. Either shape satisfies the constraint so long as both joins are scoped to the `pull_request_uid IN (...)` predicate; contract file specifies the logical result, not the SQL structure.
- **Per-PR query in a Python loop** — REJECTED. N+1 pattern; up to 500 queries per week × weeks per run. Unsafe for larger datasets.

---

## R-06 — Baseline-DOM parity: capability-off path only

**Decision**: A jsdom-based golden test `extension/tests/modules/drilldown/pr-list-capability-off-baseline.test.ts` renders `installThroughputDrilldown` against a fixture rollup that carries `prs[]` WITHOUT any of the three new fields, then compares the resulting `<section id="pr-detail">` innerHTML byte-for-byte to a committed baseline file at `extension/tests/fixtures/throughput-drilldown-capability-off-baseline.html`.

**Not snapshotted**: the capability-on DOM. Per user constraint ("too volatile"), only the capability-off byte-identity is locked.

**Rationale**:

- SC-03 demands byte-identical render against the pre-310 baseline when `capabilities.comments_metrics=false`. A golden file captures that baseline once and fails on any drift.
- User constraint (plan-approval): "assert byte-equality on capability=false path only. Do not snapshot capability=true (too volatile)." Capability-on renders depend on data shape (counts, partials), so snapshot would be brittle; explicit assertions per field suit that path better (covered by `pr-list-comments-columns.test.ts`).
- Matches the existing Phase 1 pattern of targeted golden fixtures (test_golden_outputs.py for backend JSON, committed HTML for frontend DOM).

**Fixture generation** (one-time, pre-implementation): the baseline HTML is produced by running the CURRENT implementation of the test harness against the CURRENT implementation of `renderPrListSection` + `throughput-drilldown.ts` with a fixture rollup carrying only 5-field PR records. Once committed, subsequent implementation changes must preserve that DOM.

**Alternatives considered**:

- **DOM structural assertions** (querySelector counts, class names) — REJECTED. Misses whitespace/attribute-order drift; byte-identity is the SC-03 contract.
- **Snapshot both capability-on and capability-off** — REJECTED per user lock.
- **Byte-identity against the `main` branch's rendered output at run time** — REJECTED. Requires git plumbing in a test; committed golden is simpler and reproducible cross-OS.

---

## R-07 — SC-05 deferral: #322's obligation

**Decision**: SC-05 (cross-feature reconciliation: for any PR visible in 310's drill-down, its `thread_count` equals #322's aggregator's per-PR contribution to that week's trend-series bucket) is NOT implemented in Feature 310. No test file, no CI wiring. Only the producer contract — what counts 310 emits per PR — is finalized here. #322's `/speckit.plan` will author the consumer-side reconciliation test.

**Rationale**:

- DIRECTIVE 6 (user-locked): "SC-05 is #322's obligation, NOT 310's CI."
- Spec.md SC-05 explicit: "This feature does NOT ship or execute SC-05's check; feature 310's acceptance is complete at SC-01..SC-04."
- Honest contract-producer side: the 310 sibling contract file spells out the exact C1 rules applied per PR, so #322 has a frozen reference to reconcile against. No ambiguity about what 310 emits.

**Alternatives considered**:

- **Author SC-05 test now, gate it behind a skip marker** — REJECTED. Violates QG-46 (`pytest.mark.skip` forbidden) and DIRECTIVE 6.
- **Author SC-05 test now, run it in 310's CI against a stub follow-on aggregator** — REJECTED. Widens scope into #322 territory; DIRECTIVE 6 explicit.

---

## R-08 — Capability-off demo variant via serialization-layer gating

**Decision**: Resolve A-06 (Pass 3 BLOCKED) by adding a `--comments-metrics {true,false}` flag to `scripts/generate-demo-data.py`. The flag is **strictly serialization-layer** — it has zero effect on the generation layer (RNG draws, PR construction, weekly-rollup construction, review-time stream). When the flag is `false`, the serializer omits the five gated keys; all other bytes are identical to the flag=true output for the same seed.

`scripts/build-demo-dataset.py` is extended to orchestrate both variants in one invocation: `artifacts/demo-enterprise/` (capability-on, unchanged) and `artifacts/demo-enterprise-comments-off/` (capability-off, new). Both committed OR both produced deterministically by CI at build time (implementation detail — either satisfies the "real artifact" criterion).

The five gated keys:

- `manifest.capabilities.comments_metrics`
- `manifest.features.comments`
- `manifest.coverage.comments`
- `prs[*].thread_count`
- `prs[*].comment_count`
- `prs[*].active_thread_count`

**Byte-identity test contract** (`tests/integration/test_demo_variants_byte_identity.py`):

The test MUST execute three ordered assertions — the order is load-bearing because structural equality is cheaper, clearer, and more localized than byte equality, and because byte equality without structural equality can produce false negatives on ordering/formatting drift unrelated to content:

1. **Sorted key-set equality excluding the gated set** (structural). For every JSON file present in either tree, the key sets at every path (with the gated keys removed) must be identical. Fails with a concrete key-diff diagnostic if not.
2. **Canonicalized byte equality after gated-key removal** (content). With the gated keys removed from both trees, every JSON file is re-serialized using a canonical form (sorted keys, stable numeric formatting) and compared byte-for-byte. Fails on any content difference.
3. **Array-order parity including `prs[]`** (ordering-sensitive, explicit). Every ordering-sensitive array (at minimum `prs[]` inside weekly rollups; also any manifest-level arrays if introduced) must be identical in position and element content after gated-key removal. Fails if any non-gated element has moved or changed value, even if both sides have the same multiset.

If any of the three fails: producer contract bug. Most likely cause: the flag leaked into the generation layer (e.g., an `if emit_comments_metrics:` branch that gated an `rng.random()` call). Fix: restore single-code-path generation — flag affects serialization only.

**Rationale**:

- User constraint: path (a) is the approved A-06 remedy. Contract consistency (one generator), real artifact (not simulated stripping), reproducibility (canonical pipeline), and determinism (byte-identity except gated fields) are all non-negotiable.
- Serialization-layer gating (vs. generation-layer branching) preserves the existing fixed-seed + isolated-RNG-stream discipline of `generate-demo-data.py` (`SEED = 42`; `pr_record_rng = random.Random(SEED + _PR_RECORD_SEED_OFFSET)`; `rt_rng = random.Random(SEED + _REVIEW_TIME_SEED_OFFSET)`). No RNG discipline changes required; byte-identity is a mathematical consequence of "same generation, different serialization filter."
- User additional constraint (plan-approval): "do not introduce branching logic in generation entrypoints that can drift." Satisfied — the flag cannot influence any code path that affects other fields because it is only read at the serialize step.
- Single canonical generator (not the `generate-synthetic-dataset.py` alternate) preserves contract consistency and prevents the two-generators-with-drift failure mode.

**Alternatives considered**:

- **Generation-layer RNG discipline with `if emit_comments_metrics` branches** — REJECTED. User explicitly forbade branching logic in generation entrypoints. Even if the RNG discipline were carefully maintained, it creates a drift-prone code path and a compliance risk.
- **Separate RNG stream for gated generation** — REJECTED (over-engineered). The serialization-layer approach achieves the same determinism outcome with less code and no risk of seed-offset mismanagement.
- **Post-hoc strip pass as a separate script** (e.g., reuse `scripts/strip_pr_arrays.py` pattern) — REJECTED (user explicitly required flag on the canonical generator, not a post-hoc tool).
- **Do not commit the capability-off artifact; build at test time** — DEFERRED as an implementation detail of `build-demo-dataset.py` orchestration. Either committed or build-time produced satisfies the "real artifact" criterion per user's definition (artifact is from the real pipeline, not a test-time fabrication).

**Determinism verification obligation**: after implementation lands (`/speckit.tasks` scope), the three byte-identity subtests MUST pass on the committed artifacts. Failure = producer-contract bug per above. This is the post-fix verification the user specifically called out.

---

---

## Pass 3 status (distinct from R-01..R-07)

The seven research decisions above are locked by user constraints and are independent of Pass 3 code-validation. Pass 3 is a SEPARATE sweep that validates the spec's six Assumptions (A-01..A-06). This section records the current Pass 3 state inherited from the spec and the user's plan-phase input; it does NOT execute any additional Pass 3 work.

| Assumption | Verdict | Narrow record |
|---|---|---|
| A-01 | CONFIRMED | `capabilities.comments_metrics` wired end-to-end; verified in user's initial plan prompt. |
| A-02 | PARTIAL | PrRecord locked to 5 fields; expansion explicitly requires a fresh scoping round — this feature IS it. |
| A-03 | **CONFIRMED (narrowed reading)** — resolved 2026-04-21 Pass 3 follow-up | Feature 058 merged at commit `0bd64240` (PR #292); backfill-comments end-to-end at `79d5a08c`; Phase 4 marked complete at `9deb6a15`. Schema surfaces present. "Extraction + backfill **infrastructure** is available as of Feature 058" is supported by code + git history; "data is complete" is a pipeline-state claim NOT restated (per user's narrow-verdict instruction). 310 does not depend on operational completeness — R-02's partial sentinel handles uncovered PRs. |
| A-04 | PARTIAL | `DatasetCapabilityState.commentsMetricsAvailable` exists and is consumed at `dashboard.ts:2334` for the banner; drill-down has no existing optional-column gating pattern. This feature creates the pattern. |
| A-05 | PENDING — administrative | Forward-looking; resolves by confirming #322 exists. Kept explicitly OUT of code-validation. |
| A-06 | **RESOLVED** via R-08 (path (a) — serialization-layer gating) | User chose path (a) on 2026-04-21. `scripts/generate-demo-data.py` gains a `--comments-metrics` flag that affects serialization output only (zero generation-layer branching; single code path). `scripts/build-demo-dataset.py` orchestrates both variants: `artifacts/demo-enterprise/` (capability-on) and `artifacts/demo-enterprise-comments-off/` (capability-off). Byte-identity except for the five gated keys is enforced by `tests/integration/test_demo_variants_byte_identity.py` (three ordered subtests per R-08). SC-03 verification uses the real committed capability-off artifact, not a simulated-stripped fixture. |

**Planning-readiness after 2026-04-21 fix pass**: UNBLOCKED. A-01 CONFIRMED. A-02 PARTIAL (310 is the scoping round). A-03 CONFIRMED (narrowed). A-04 PARTIAL (310 creates the pattern). A-05 administrative. A-06 RESOLVED via R-08. Parity-gate silent-pass trap RESOLVED via §1 Canonical field declaration in the 310 sibling contract + trigger-list correction.

`/speckit.analyze` can proceed once this edit pass is committed.

---

## Summary

Eight research decisions locked: R-01..R-07 (original plan pass) + R-08 (2026-04-21 A-06 resolution). Pass 3 status: A-01 CONFIRMED, A-02 PARTIAL (310 is the scoping round), A-03 CONFIRMED (narrowed reading), A-04 PARTIAL (310 creates the pattern), A-05 administrative, A-06 RESOLVED via R-08 (serialization-layer gating on `generate-demo-data.py`). Parity-gate silent-pass trap RESOLVED via §1 Canonical field declaration addition to the 310 sibling contract + 3-trigger list. Phase 1 design artifacts (data-model.md, contracts/*.md, quickstart.md) coherent. `/speckit.analyze` unblocked once this edit pass is committed.
