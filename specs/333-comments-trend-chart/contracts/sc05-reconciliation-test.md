# Contract: SC-05 reconciliation test (Feature 333)

**Scope**: the executable closure of feature 310's deferred SC-05 cross-feature coherence obligation (310 spec lines 145–146). Lives in `tests/integration/test_comments_trend_reconciliation.py` (new) plus a sibling structural-isolation test, plus `tests/integration/test_comments_trend_meta_failure.py` (new — FR-2-05 meta-test).

**Authoritative spec refs**: [spec.md](../spec.md) — FR-2-01, FR-2-03, FR-2-04, FR-2-05, INV-1-02, INV-1-06, INV-1-08, SC-1-05.

**Sole authority status**: per spec FR-3-03 + Out of Scope, this test is the sole authority for weekly-comments-aggregate parity. The existing per-PR schema-parity gate (`scripts/check_pr_record_schema_parity.py`, Row 38, QG-49) is NOT extended to cover the new aggregate object.

---

## §1 What the test verifies

For every week W in the demo dataset, the test asserts TWO properties (FR-2-04):

### (a) Cross-surface coherence on the extracted-subset of the intersection

For every PR P in the drill-down's top-500-by-cycle-time slice for W (per 310 INV-02) AND in W's extracted-subset (`pull_requests.comments_extracted_at IS NOT NULL`):

- The drill-down's per-PR `thread_count` value (PrRecord field per 310's contract) MUST equal P's per-PR contribution to `rollup[W].comments.thread_count` as computed by the aggregator.
- Same for `comment_count` and `active_thread_count`.

For PRs in the drill-down's slice that are NOT in W's extracted-subset (`comments_extracted_at IS NULL`):

- **Explicitly excluded from pairwise numeric comparison** — both surfaces signal "no data / pending" via different conventions, and pairwise numeric comparison is not applicable.
- **AND positively asserted** — the test MUST verify that the drill-down's rendered per-PR `thread_count` / `comment_count` / `active_thread_count` for each unextracted PR are 310's per-PR partial sentinel (null / undefined per INV-10), NOT zero, NOT a number, NOT silently absent. This catches the failure mode where the drill-down accidentally renders unextracted PRs as numeric zero (which would silently misrepresent "no data" as "no activity").
- The aggregator's exclude-from-sum behavior on the producer side is verified independently by the FR-2-04 (b) end-to-end re-computation (which includes the same extracted-subset filter step).

### (b) End-to-end aggregator correctness via independent re-computation

For each week W and each numeric field of `rollup[W].comments`, the test:

1. Determines W's canonical throughput PR set via **DIRECT SQL** against the source `pull_requests` table grouped by week. The week-attribution rule is re-implemented in the test independently (round-9 tightening): the test does NOT call throughput aggregator code, does NOT read the throughput rollup's emitted `prs[]` list, and does NOT reuse any helper either aggregator uses for week-attribution. A separate per-PR parity test (per FR-2-03 (a) or (b)) asserts the test's week-attribution agrees with throughput's per-PR emission, so silent drift between the test's rule and throughput's rule is caught.
2. Filters that set to W's extracted-subset (PRs with `comments_extracted_at IS NOT NULL`) — applying the SAME extracted-subset rule the comments aggregator applies per FR-2-03.
3. For each PR in the extracted-subset, applies the C1 inclusion rules from `specs/310-comments-visualization/spec.md` lines 75–87 directly against `pr_threads` / `pr_comments` (NOT via either aggregator's helpers).
4. Sums per-PR contributions → expected `thread_count`, `comment_count`, `active_thread_count`.
5. Re-derives expected `coverage_partial = (|canonical set| != |extracted-subset|)`.
6. Asserts the aggregator's emitted `rollup[W].comments` matches the independently-re-computed values, field-by-field, for every week.

**No-call-to-throughput-aggregator hard rule (round 9)**: the previously-listed "cross-reference against throughput rollup's per-week PR list" option is REMOVED. Direct SQL against the source `pull_requests` table is the only acceptable grounding source for the test's per-week PR set determination, because reading throughput's emission would couple the reconciliation test to the throughput aggregator's correctness — defeating the purpose of "independent re-computation."

## §2 No shared code with EITHER aggregator (round-9 extension)

The independent re-computation in (b) MUST share NO code, helpers, or shared utilities with EITHER:

1. **The comments aggregator's bucket-computation path** (the new per-week `comments` emission added by this feature).
2. **The throughput aggregator's PR-set-determination code path** (the existing throughput weekly-rollup emission that determines W's canonical PR set).

Both live in `src/ado_git_repo_insights/transform/aggregators.py`. This means:

- No imports from `src/ado_git_repo_insights/transform/aggregators.py` (covers BOTH aggregators by file).
- No imports of any helper either aggregator imports for week-attribution, PR-set assembly, or aggregate computation specifically (excludes general utilities like `DatabaseManager` connection — includes any function specific to either aggregator's logic).
- No call to `_generate_weekly_rollups()` or any of its helpers; no read of its emitted JSON output as the source of W's PR set.

**Why round 9 extended the rule to throughput**: if the test reads throughput's emitted `prs[]` to determine W's PR set, then the test couples the reconciliation to throughput's aggregator correctness. A bug in throughput's PR-set assembly would silently propagate into the test's "expected" values — both surfaces would agree by virtue of sharing the same upstream bug. Direct SQL against the source `pull_requests` table is the only true independence.

**Structural enforcement**: the "no shared code" constraint MUST be enforced at the IMPORT-BLOCK level, NOT by code-organization convention. Two implementation options (task-level pin):

- **AST-based import-block test** (`tests/integration/test_comments_trend_reconciliation_isolation.py`): walks the reconciliation test module's transitive imports and asserts that NEITHER `src/ado_git_repo_insights/transform/aggregators.py` NOR any of its non-trivial helpers appear in the set. Fails the build if a future refactor pulls a shared helper into the test path.
- **Module-boundary mechanism**: the reconciliation test lives in a sub-package (e.g., `tests/integration/sc05_reconciliation/`) configured with no shared transitive imports — perhaps via a Python import hook or a static analysis check.

The AST-based check is the simpler implementation; module-boundary mechanism is plan-of-record only if AST-based proves brittle.

**Why this matters**: without structural enforcement covering BOTH aggregators, "no shared code" can drift silently — a future refactor pulls in a shared utility, the test stops being independent, the reconciliation degrades to internal tautology and silently passes on a wrong codebase. The structural check catches it at commit time.

## §3 Failure-mode meta-test (FR-2-05)

A separate meta-test in `tests/integration/test_comments_trend_meta_failure.py` MUST inject a synthetic dataset where one week's emitted `rollup[W].comments` has `active_thread_count > thread_count` (violating INV-1-06) and assert that the FR-2-04 reconciliation test FAILS on that injected dataset.

**Mechanism**:

- The meta-test loads the demo dataset, mutates one week's `rollup[W].comments` to violate INV-1-06, runs the FR-2-04 reconciliation test against the mutated dataset, and asserts non-zero exit / pytest failure.
- The mutation MUST be in-test only (does not commit a corrupt fixture to the repo). Use a `tmp_path` working copy of the manifest.

**Why this matters**: without FR-2-05, the FR-2-04 reconciliation test could silently degrade to a no-op (a refactor short-circuits the assertion, the fixture loader stops finding the dataset, the comparison loop skips weeks under some condition) and pass on a wrong codebase forever. FR-2-05 is the positive control that proves FR-2-04 is real.

**Minimum required injected case**: `active_thread_count > thread_count`. Additional bad-case fixtures (missing PR, off-by-one bucket sum, wrong C1 application) are recommended in research.md but not contractually required.

## §4 Test invocation contract (QG-49 alignment)

The reconciliation test, the structural-isolation test, and the meta-test all run via standard pytest. They are invoked from:

- **Pre-push preflight** (`scripts/run_pr_preflight.py`) — as part of the `tests/integration/` pytest run.
- **CI** (`.github/workflows/ci.yml`) — same.
- **Local pytest** — `python scripts/run_pytest.py` (the coverage-safe launcher).

No new dedicated CommandSpec or pnpm script is needed — these are integration tests that run in the existing `pytest tests/integration/` invocation, which is already invoked by name from all three entry points.

QG-49 compliance: the reconciliation logic is defined ONCE (in the test module) and invoked ONCE per pytest run from each entry point.

## §5 What this test does NOT verify

- **Schema shape of `rollup[W].comments`** — that's `weekly-comments-aggregate.md`'s scope, enforced by `extension/tests/schema/rollup.test.ts`.
- **Capability-off serialization gating** — that's FR-3-03's scope, enforced by the demo byte-identity test (file pinned at task time). The test gates all four omission failure modes individually: NOT present, NOT `null`-valued, NOT `{}`-valued, NOT partially-fielded.
- **Week-attribution rule parity with throughput** — that's FR-2-03 (a)/(b)'s scope, enforced by either the canonical-helper-reuse path or the per-PR parity test.
- **Chart rendering correctness (FR-1-04 visual qualifier on partial weeks)** — that's `extension/tests/modules/charts/comments-trend.test.ts`'s scope. Specifically includes:
  - Case (v) mixed partial + non-partial weeks — qualifier applied ONLY to partial-marked weeks.
  - **Case (vi) all-unextracted week** (round 9) — bar element MUST be present in the DOM with explicit zero-height segments AND the partial-coverage qualifier applied; comment-line series MUST connect through the zero point. Prevents silent-omission failure mode where a renderer optimizes out zero-value bars and inadvertently hides the partial-state signal.

The narrow goal of this test is: **for every week W, the values inside `rollup[W].comments` match an independent re-computation of those values from source data, and the per-PR drill-down values (where extracted) agree with the aggregator's per-PR contributions.**
