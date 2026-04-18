# Implementation Plan: Historical PR Thread Backfill Subcommand

**Branch**: `058-backfill-comments` | **Date**: 2026-04-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification at `specs/058-backfill-comments/spec.md` (4-pass hardened)
**Constitution**: v1.5.0 | **Pass**: 1 (draft from spec)

## Summary

Deliver a new `backfill-comments` CLI subcommand that drains historical PR thread backlogs for `review_time_minutes` computation without re-fetching PR metadata. The subcommand selects completed pull requests whose coverage marker (`pull_requests.comments_extracted_at`) is unset, orders them oldest-first with a stable tiebreak, materializes the selection once at run start (FR-011a), and processes each one inside its own per-PR atomic commit boundary (FR-012, FR-013, FR-013a). Every run emits a `run_summary.json` artifact whose schema conforms bit-for-bit to the existing extraction flow's schema (FR-025a–c), with backfill-specific field values mapped per FR-019d.

**Technical approach** (locked in spec Pass 4 and pre-plan deliverables; no remaining architectural branching):

1. **Refactor** the existing per-PR body at `cli.py:510-670` into `_fetch_and_upsert_threads_for_pr(client, db, repo, pr_row, max_threads_per_pr) -> FetchOutcome`. The helper performs thread/comment/user upserts through `repo` but does **not** apply the coverage-marker update and does **not** call `db.connection.commit()`. Both the stamp decision and the commit boundary are caller-side responsibilities.
2. **Preserve** extract's post-fix observable behavior by keeping extract's 3-case stamp logic inline in `_extract_comments` (Case 2 now carries a pre-iteration-NULL sub-decision landed by commit `740810fd`, the #289 fix) and its existing end-of-loop `db.connection.commit()` at `cli.py:672`. The `test_extract_comments.py` regression-lock suite (830 LOC, 20 tests) MUST pass unchanged (FR-034).
3. **Introduce** `cmd_backfill_comments` + its argparse subparser. Its per-iteration body calls the shared helper, applies a simplified 2-outcome stamp decision (set if untruncated or every dropped thread is already stored-and-current; else leave unchanged), commits per-PR, and rolls back on `ExtractionError`. The simplified decision never traverses extract's "preserve" branch, making the preserved-unset infinite-loop outcome unreachable by construction at backfill's side (defense-in-depth with extract's own post-fix Case 2a from commit `740810fd`, which also eliminates the outcome at the source for preiteration-NULL inputs).
4. **Enforce** the FR-019b failure-line warnings, FR-017a legacy-schema-skip discriminator, and a new first-class artifact invariant: **every backfill-produced `run_summary.json` — including fatal pre-loop aborts — carries at least one `warnings` entry whose literal prefix is `"backfill-comments: "`**. This is the authoritative discriminator between backfill and extract artifacts (pre-plan deliverable 2).
5. **Lock** every test from FR-030a–j to a named test file and a specific invariant. Collection-stable definitions (Principle XXVI). Python test floor at `.test-floor-contract.json::python::min_collected = 1816` (post-#289-fix baseline) bumps by exactly N in the same commit that adds N tests (QG-43).

## Technical Context

**Language/Version**: Python 3.12+ (backend, scripts, tests) — matches existing CLI and `cli.py` annotation set.
**Primary Dependencies**: existing — `argparse` (parser), `sqlite3` via `DatabaseManager` (persistence), `requests` via `ADOClient` (upstream API), `pytest` + `unittest.mock.MagicMock` (tests). No new third-party dependencies.
**Storage**: SQLite via `DatabaseManager`. Reuses schema v4+; no schema changes introduced (FR-027). Uses `pull_requests.comments_extracted_at`, `pr_threads`, `pr_comments`, `users` tables that already exist (migrations.py:78-92, 211, 226).
**Testing**: pytest with real SQLite on tmp_path (pattern from `tests/unit/test_extract_comments.py`); `MagicMock`-backed `ADOClient`. All FR-030* tests defined unconditionally at module scope per Principle XXVI.
**Target Platform**: Windows, macOS, Linux (QG-39 cross-platform required). No OS-specific paths, shell commands, subprocess calls, or file enumerations.
**Project Type**: CLI subcommand of the existing `ado-insights` tool; single Python project.
**Performance Goals**: Per-PR processing time is dominated by ADO API round-trip latency plus bounded retry (FR-026 reuses existing rate-limit contract, QG-13). No intrinsic per-PR performance budget; total runtime scales linearly with selection snapshot size `T`.
**Constraints**: FR-011a (snapshot stability for `T`/`N` during the run), FR-012/013 (per-PR atomic write set), FR-013a (interrupt safety mid-iteration), FR-015 (no preserved-unset outcome), FR-018c (progress line emitted strictly after commit/rollback resolution), FR-024a (no implicit safety claims on any user-visible surface), FR-025a–c (extract observable-behavior preservation), FR-029/029a (docs tree untouched on this branch).
**Scale/Scope**: Historical backlogs up to tens of thousands of uncovered PRs per database. Per-invocation cap via `--limit`; unbounded when `--limit 0` (sentinel).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design (see "Post-Design Re-Evaluation" at the end of this document).*

### Core Principles (XXVI total)

| Principle | Status | Evidence |
|---|---|---|
| I CSV Schema Contract | N/A | No CSV surface changed (FR-025, FR-027) |
| II No Breaking CSV Changes | N/A | No CSV surface changed |
| III Deterministic CSV Output | N/A | No CSV surface changed |
| IV PowerBI Frictionless Import | N/A | No CSV surface changed |
| V SQLite as Source of Truth | **PASS** | Backfill writes exclusively through `DatabaseManager` + `PRRepository` (no parallel store) |
| VI Pipeline Artifacts as Persistence | **PASS** | `run_summary.json` written to `args.artifacts_dir` (same resolution path extract uses, FR-019a) |
| VII No Publish on Failure | **PASS** | FR-012/013 per-PR atomic commits; failed PR rolls back leaving DB bit-identical to pre-iteration state |
| VIII Idempotent State Updates | **PASS** | FR-002 (skip-if-covered selection) + FR-015 stamp invariants deliver re-run idempotence |
| IX Recoverable Persistence | **PASS** | FR-013a interrupt safety + FR-017 legacy-schema graceful no-op |
| X Daily Incremental Extraction Default | N/A | Backfill is a dedicated historical path, not the incremental default |
| **XI Periodic Backfill Required** | **PASS** | This feature IS the dedicated backfill path; closes #251 |
| XII No Silent Data Loss | **PASS** | FR-014 continues on non-fatal errors; FR-019b records every Failed PR in warnings; FR-019 non-zero exit reserved for fatal pre-loop errors |
| XIII Bounded Rate Limiting | **PASS** | FR-026 reuses existing upstream-client retry/backoff; no new retry surface |
| XIV Stable UPSERT Keys | **PASS** | Uses `pull_request_uid` unchanged |
| XV Organization/Project Scoping | **PASS** | Selection is scoped to the invocation's project list (FR-004) |
| XVI Names as Labels, IDs as Identity | **PASS** | No name-based identity introduced |
| XVII Cross-Agent Compatibility | **PASS** | Pure-Python subcommand; no OS-specific runtime assumptions |
| XVIII Actionable Failure Logs | **PASS** | FR-018a anchor line, FR-018b per-PR progress, FR-019b per-failure warnings, FR-017 legacy-schema warning, FR-024a forbidden-claims scan |
| XIX PAT Secrecy | **PASS** | Reuses existing PAT handling via `ADOClient`; no new surface logs the PAT |
| XX Least Privilege Default | **PASS** | Requires the same Code (Read) scope as extract |
| XXI Single-Authority Storage Backend | N/A | No Azure Storage interaction |
| XXII Explicit One-Way Migration | N/A | No migration introduced |
| XXIII Automated CSV Contract Validation | N/A | No CSV surface changed |
| XXIV End-to-End Testability | **PASS** | FR-032 mandates happy-path, partial-failure, resumability, and legacy-schema end-to-end tests |
| XXV Backfill Mode Testing | **PASS** | FR-031 four-outcome stamp coverage + FR-032 resumability |
| **XXVI Collection-Stable Test Definitions** | **PASS** | All FR-030a–j tests defined unconditionally at module scope; no `if version:` wrappers, no decorators adding/removing test defs, no import-time gating, no runtime `pytest.skip()` at collection |

### Quality Gates bound by this feature

| Gate | Status | Binding |
|---|---|---|
| QG-39 Cross-OS | **PASS** | No OS assumptions; `pathlib.Path` throughout |
| QG-40 No Any | **PASS** | Every new annotation uses precise types (`Literal`, `list[AdoThread]`, `FetchOutcome` dataclass). No `typing.Any` |
| QG-41 Zero suppressions | **PASS** | No `# noqa` / `# type: ignore` in new code |
| QG-42 Enterprise test coverage | **PASS** | FR-030a–j + FR-031 + FR-032 + FR-033 map to test files (see Implementation Strategy §5) |
| QG-43 Ratchet-bump same-commit | **BINDING** | The commit that adds `N` new Python tests MUST bump `.test-floor-contract.json::python::min_collected` by exactly `N` (current floor 1816, post-#289-fix baseline). Plan estimates the count in §5 below so `tasks.md` can enforce — actual count at implementation time is authoritative |
| QG-44 Single source of truth for floor | **PASS** | `.test-floor-contract.json` drives preflight + `ci.yml`; no hardcoded ints introduced |
| QG-45 Python floor is cross-platform min | **PASS** | New tests contain no platform-conditional gating |
| QG-46 Platform-conditional file-name exclusion | **N/A** | No platform-conditional tests added |
| QG-49 One authoritative command | **PASS** | `backfill-comments` is a single argparse subcommand; no parallel invocation path introduced |
| QG-50 Bypass markers in subject lines | **N/A** | No bypass markers used |
| VR-28 Full pre-push hook | **BINDING** | `python scripts/run_repo_hook.py pre-push` completes with exit code 0 before merge |
| VR-30 Ratchet-bump parity | **BINDING** | Cross-OS floor equals actual on Python and Extension; inter-file parity holds |

### Initial gate evaluation: **PASS**

No unjustified violations. No entries in the Complexity Tracking table.

## Project Structure

### Documentation (this feature)

```text
specs/058-backfill-comments/
├── spec.md                        # Feature specification (4-pass hardened)
├── plan.md                        # This file (Pass 1 draft)
├── research.md                    # Phase 0 output — pre-plan deliverables + HEAD verification
├── data-model.md                  # Phase 1 output — entities, outcomes, state transitions
├── quickstart.md                  # Phase 1 output — user-facing smoke test
├── contracts/
│   └── cli-subcommand.md          # Phase 1 output — argparse contract + exit codes + artifact shape
└── checklists/
    └── requirements.md            # Existing requirements checklist
```

### Source Code (repository root) — target files for this feature

```text
src/ado_git_repo_insights/
├── cli.py                         # MODIFIED: add subparser; refactor _extract_comments body
│                                    into _fetch_and_upsert_threads_for_pr returning FetchOutcome;
│                                    add cmd_backfill_comments; add FetchOutcome dataclass
└── utils/
    └── run_summary.py             # UNCHANGED — FR-025a forbids behavior changes
                                     (re-asserted by the FR-030f golden snapshot test)

tests/unit/
├── test_extract_comments.py       # UNCHANGED (FR-034 regression lock; must pass unchanged)
├── test_backfill_comments.py      # NEW — FR-030a/b/c/d/g/h/i/j + FR-031 + FR-032 + FR-033 tests
├── test_run_summary_snapshot.py   # NEW — FR-030f golden-snapshot of extract producer surfaces
└── test_run_summary_parity.py     # NEW — FR-030e cross-flow artifact-shape parity

.test-floor-contract.json          # BUMPED by exactly N in the same commit that adds N tests
```

No changes under `docs/`, `extension/`, `tasks/`, `.github/workflows/`, `sample-pipeline.yml`, `insights-verification-test.yml`, or any Azure DevOps task manifest (FR-025, FR-028, FR-029, FR-029a).

**Structure Decision**: Single Python project (Option 1). Backfill is a new argparse subcommand of the existing `ado-insights` CLI; its command handler (`cmd_backfill_comments`) lives beside `cmd_extract` in `cli.py`. No new modules introduced — the shared fetch/upsert helper is a module-local function in `cli.py` adjacent to `_extract_comments` and `_dropped_threads_all_stored`.

## Implementation Strategy

This section is load-bearing for `/speckit.tasks`. Every decision below is locked by spec Pass 4 or the pre-plan deliverables; no deferred choices remain. Numbered subsections map forward to task buckets.

### §1 — Fetch/stamp helper separation (FR-015a, FR-015b)

**Architectural Decision Log — FR-015a** (locked at spec Pass 4; restated here so downstream tasks do not regress into a rejected path):

| Path | Status | Why |
|---|---|---|
| **Path 1 — Shared-helper bug fix** ("fix the preserve branch inside the shared helper so every caller gets the fixed semantics") | **REJECTED** | Would alter extract's observable stamp behavior for every input that reaches the truncation-preserve branch. Any change to extract's stamp semantics requires a full consumer audit of `comments_extracted_at` (not just `run_summary.json` — every downstream that reads the column) plus a new round of tests locking the new behavior. The spec explicitly defers any extract-side stamp fix to a future feature. Slipping it into 058 is scope creep. |
| **Path 2 — Backfill-only override** ("let the shared helper apply extract's 3-case stamp, then have backfill null-out / re-stamp after the call") | **REJECTED** | Hides divergent behavior behind a single call site: readers must cross-reference the helper's behavior with the caller's post-processing to see what the marker ends up as. FR-015a explicitly forbids mode-flag helpers AND post-call override patterns. The locality principle for stamp policy (each caller's stamp rule lives next to its loop body) fails under this shape. |
| **Path 3 — Fetch/stamp separation** ("refactor the fetch-and-upsert body out of the stamp decision; each caller applies its own stamp decision locally") | **ACCEPTED + COMMITTED** | Extract's caller preserves the existing 3-case logic inline → extract's observable behavior is bit-for-bit unchanged (FR-025a's "harmless refactor preserving all observable behavior" permits). Backfill's caller applies a simplified 2-outcome rule that never traverses the preserve branch → preserved-unset infinite-loop outcome is unreachable **by construction**, not by detection + override. Reading either caller tells you that caller's stamp policy without cross-file traversal. |

#### Commitment lock (non-negotiable for 058 tasks) — FR-015a is CLOSED

**Path 3 is ACCEPTED and the decision is CLOSED. No alternative implementation paths are permitted; deviation fails code review.**

- Tasks MUST NOT re-evaluate Path 1 (shared-helper bug fix) or Path 2 (backfill-only override). The decision lives at the plan level, not at the task level.
- Any implementation diff that introduces a stamp-logic change inside the shared helper (Path 1 surface) or a post-`_fetch_and_upsert_threads_for_pr` override of the marker state in backfill's caller (Path 2 surface) fails code review automatically — the reviewer does not need to reconstruct the rationale; it is already enumerated in the REJECTED rows above.
- A task that "simplifies" the caller-side stamp decision by moving it back inside the helper crosses the boundary and fails review. Helper locality of the stamp policy is the invariant that makes reading either caller self-contained; surrendering it silently re-introduces the rejected Path 1.
- A task that adds a `strict_backfill: bool` / `mode: Literal["extract", "backfill"]` / `is_backfill: bool` parameter to `_fetch_and_upsert_threads_for_pr` crosses the boundary and fails review. FR-015a explicitly forbids mode-flag helpers; the locality principle is "each caller has its own simple, local decision", not "a shared helper that branches on a flag".
- Shared-surface scope is limited to **pure predicates and utility functions**. `_dropped_threads_all_stored` is shared unchanged because it is a pure predicate with no side effects. Any shared surface that mutates `comments_extracted_at` or carries stamp policy fails this lock.

The enforcement teeth that catch deviation: FR-034 regression lock (`tests/unit/test_extract_comments.py`, 20 methods) fires if extract's behavior drifts; FR-030f golden snapshot fires if `RunSummary.to_dict` / `create_minimal_summary` / `normalize_error_message` drift; FR-031 five coverage-marker tests fire if backfill's stamp outcomes drift. The locks overlap deliberately — bypassing one is detected by another.

**Task-boundary consequence**: the refactor is a **single scoped change** (move fetch/upsert body into a helper; migrate the stamp `if/elif/else` to its caller site). It is **not** a shared-helper semantic change (which would require its own consumer audit + test lock-down task). Implementation tasks MUST keep these boundaries distinct; a task that "improves" the shared helper's stamp behavior crosses the boundary and must be rejected at code review.

**Regression risk distribution** after the refactor:

| Risk | Surface | Mitigation |
|---|---|---|
| Extract's loop behavior diverges from pre-refactor (any of the 5 post-fix stamp transitions — Case 1 SET / Case 2a preiteration-NULL→SET / Case 2b preiteration-non-NULL→preserve / Case 3 CLEAR / ExtractionError→unchanged — reaches a different end-state for any reachable input) | `_extract_comments` loop body + extract's caller-side stamp block (including the pre-iteration snapshot read) | FR-034 regression lock: `tests/unit/test_extract_comments.py` (20 tests, 830 LOC) MUST pass bit-for-bit unchanged. Zero assertion edits, zero tests added/removed/skipped, zero gating introduced. Pre-push gate catches any test failure |
| Extract's artifact producer drifts (`RunSummary.to_dict`, `create_minimal_summary`, `normalize_error_message`) | `src/ado_git_repo_insights/utils/run_summary.py` (untouched by this feature) | FR-030f golden-snapshot test (`tests/unit/test_run_summary_snapshot.py`, NEW) asserts rendered JSON equality against a committed golden across all three producer surfaces. Catches any accidental behavior drift caused by refactor side effects or untouched-module regressions |
| Extract's end-of-loop commit boundary drifts (i.e., changes from "commit once after loop" to something else) | `_extract_comments` bottom — specifically `db.connection.commit()` at current cli.py:672 | Structural: plan mandates the commit line at `cli.py:672` is bit-for-bit preserved; only the per-PR loop body (cli.py:510-670) is refactored. Visual inspection during Pass 3 + regression via FR-034 |
| Backfill's simplified 2-outcome rule diverges from extract's post-fix behavior for some input (would matter if backfill's selection ever delivered a pre-iteration non-NULL marker — backfill's predicate forbids this, but a future selection-predicate change could regress the invariant) | `cmd_backfill_comments` loop body + selection predicate | FR-031 truncation-verified-complete tests run both sub-cases (pre-iteration marker NULL + pre-iteration marker set) and assert post-iteration marker is non-null in both |
| Backfill's per-PR commit boundary leaks state across PRs | `cmd_backfill_comments` loop body | FR-030b atomicity test + FR-030c interrupt-safety tests drive failures at upsert and commit boundaries, asserting DB is bit-identical to pre-iteration state on the failure path |

**Extract-parity proof ownership** (who attests extract's observable behavior is unchanged):

| Proof surface | Owner (test file) | Binding FR / principle |
|---|---|---|
| Extract's 5 post-fix stamp transitions (Case 1 / Case 2a / Case 2b / Case 3 / error-unchanged) on every reachable input | `tests/unit/test_extract_comments.py` (UNCHANGED; 20 methods post-#289-fix) | FR-034 (hard regression lock) |
| Extract's artifact producer output (all three public surfaces) | `tests/unit/test_run_summary_snapshot.py` (NEW) | FR-030f / FR-025c (golden snapshot) |
| Extract's cross-flow artifact shape vs backfill's | `tests/unit/test_run_summary_parity.py` (NEW) | FR-030e / FR-025b (shape parity) |
| Extract's end-of-loop commit boundary unchanged | Structural inspection; no dedicated test (the refactor diff must leave `db.connection.commit()` at the same logical position) | FR-025a |

**Extract's preserve-when-null case — FIXED** (commit `740810fd`, previously tracked as [issue #289](https://github.com/oddessentials/ado-git-repo-insights/issues/289)). The previously-latent preserve-when-null outcome in `_extract_comments` is no longer reachable: extract now reads a pre-iteration snapshot of `comments_extracted_at` at the top of each per-PR iteration (`cli.py:517-526`), and the truncation-verified-complete branch at `cli.py:627-640` sets the marker to the current timestamp when the pre-iteration value was `NULL` (Case 2a), while still preserving a pre-existing non-`NULL` marker (Case 2b).

What the evidence now says about extract (all locked by the regression suite):

- **Both sub-cases of the preserve branch are locked by tests.** `TestExtractCommentsStamping::test_truncated_fetch_preserves_stamp_when_dropped_stored_preiteration_set` (renamed from the pre-fix method; test file lines 141-161) locks preserve-when-**set** with a stricter `stamp_after == stamp_before` assertion. `test_truncated_fetch_sets_completion_marker_when_dropped_stored_preiteration_null` (NEW in `740810fd`; test file lines 163-198) locks preserve-when-**null → SET**. `test_manual_marker_reset_does_not_loop_when_dropped_threads_already_stored` (NEW in `740810fd`; test file lines 201-230) locks the operator-reset recovery path documented in backfill's quickstart.
- **The "processed-but-no-progress" infinite-loop outcome is eliminated at BOTH levels for backfill's workload.** Backfill's selection predicate (`comments_extracted_at IS NULL`) + extract's post-fix Case 2a (preiteration-NULL → SET) means: even if some future refactor accidentally routed backfill's work through extract's preserve branch, the post-fix logic would still set the marker. Defense-in-depth: backfill's 2-outcome caller-side rule (locality) + extract's post-fix Case 2a (source-side elimination).

**Scope fence for 058 (restated for the post-fix world)**: this feature MUST preserve extract's **post-fix** observable behavior bit-for-bit. T002 (helper extraction) and T003 (extract caller refactor) MUST NOT regress the preserve-when-null → SET behavior, must preserve the pre-iteration snapshot read, and must preserve the Case 2 sub-branch structure. The 20-method `test_extract_comments.py` regression-lock suite (FR-034) catches any drift in either sub-case. The `test_truncated_fetch_sets_completion_marker_when_dropped_stored_preiteration_null` test is the primary tooth against accidental regression of the #289 fix; any refactor that alters extract's Case 2a behavior will fail this specific test.

---

**Introduce** a module-level dataclass and helper in `cli.py`, placed between `_extract_comments` (current end at line 681) and `_dropped_threads_all_stored` (current definition at line 979). Both pieces of code relate to PR-thread processing; this is the natural insertion point.

```python
@dataclass(frozen=True)
class FetchOutcome:
    """Outcome of a per-PR thread fetch + upsert operation.

    Carries enough information for the caller to apply its own
    coverage-marker stamp decision and commit/rollback policy.

    Thread/comment counts are carried on the outcome so the helper remains a
    single-return, no-mutated-parameter boundary while preserving extract's
    existing ``stats["threads"]`` / ``stats["comments"]`` contract
    (FR-034 regression lock: tests/unit/test_extract_comments.py:337, 371).
    """
    status: Literal["ok", "failed"]
    truncated: bool
    dropped_threads: list[AdoThread]
    threads_upserted: int
    comments_upserted: int


def _fetch_and_upsert_threads_for_pr(
    client: ADOClient,
    db: DatabaseManager,
    repo: PRRepository,
    pr_row: Mapping[str, object],
    max_threads_per_pr: int,
) -> FetchOutcome:
    """Fetch threads for a single PR and upsert thread/comment/user rows.

    Side effects: writes to pr_threads, pr_comments, users via ``repo``.
    Does NOT update pull_requests.comments_extracted_at.
    Does NOT call db.connection.commit() or db.connection.rollback().
    Does NOT catch ExtractionError — lets it propagate to the caller.
    """
```

**Behavior preserved bit-for-bit from the existing inline body at `cli.py:510-670`** (post-fix; the #289 fix added a pre-iteration snapshot read at cli.py:517-526):

- Pre-iteration coverage-marker snapshot (`pre_iteration_comments_extracted_at`, currently at cli.py:517-526 — added by the #289 fix; MUST be preserved so the Case 2 sub-decision remains stable across the iteration)
- Per-thread incremental sync check (`local_thread is not None and thread_updated <= local_thread["last_updated"]: continue`, currently at cli.py:561-565)
- Thread upsert via `repo.upsert_thread` (currently at cli.py:573-581)
- Comment upsert via `repo.upsert_comment`, preceded by `repo.upsert_user` for FK integrity (currently at cli.py:591-607)
- Truncation flag computation (currently at cli.py:539-541)
- Dropped-threads slice (currently at cli.py:628, `all_threads[max_threads_per_pr:]`)

**Removed from the helper (migrated to callers)**:

- The 3-case `if/elif/else` stamp block at `cli.py:621-647` with Case 2 sub-decision (full-success SET / Case 2a preiteration-NULL→SET, Case 2b preiteration-non-NULL→preserve / truncation-clear NULL) — post-fix structure from commit `740810fd`
- The ExtractionError handler at `cli.py:649-670` (warning emission + failure counter increment)
- The final `db.connection.commit()` at `cli.py:672` (caller decides commit boundary)

**Extract caller's new shape** (`_extract_comments` body replaces current `cli.py:510-670`, commit at `cli.py:672` preserved unchanged):

```python
for pr_row in prs_to_process:
    pr_uid = pr_row["pull_request_uid"]
    try:
        # Pre-iteration coverage-marker snapshot — added by #289 fix (commit 740810fd).
        # MUST be preserved by the refactor so Case 2's sub-decision stays stable.
        pre_iteration_stamp_row = db.execute(
            "SELECT comments_extracted_at FROM pull_requests "
            "WHERE pull_request_uid = ?",
            (pr_uid,),
        ).fetchone()
        pre_iteration_comments_extracted_at = (
            pre_iteration_stamp_row["comments_extracted_at"]
            if pre_iteration_stamp_row is not None
            else None
        )

        outcome = _fetch_and_upsert_threads_for_pr(
            client, db, repo, pr_row, max_threads_per_pr
        )
        # Per-thread / per-comment counts roll up from the helper's return
        # value so extract's existing stats contract survives the refactor
        # (FR-034 regression lock; test_extract_comments.py:337, 371).
        stats["threads"] = int(stats["threads"]) + outcome.threads_upserted
        stats["comments"] = int(stats["comments"]) + outcome.comments_upserted
        # Extract's post-fix 3-case stamp logic — preserved bit-for-bit from 740810fd.
        # Case 2 carries a sub-decision (Case 2a/2b) on pre_iteration_comments_extracted_at.
        if not outcome.truncated:
            # Case 1: full success → SET.
            db.execute(
                "UPDATE pull_requests SET comments_extracted_at = ? "
                "WHERE pull_request_uid = ?",
                (datetime.now(UTC).isoformat(), pr_uid),
            )
        elif _dropped_threads_all_stored(db, pr_uid, outcome.dropped_threads):
            # Case 2a (pre-iteration NULL) → SET; Case 2b (pre-iteration non-NULL) → preserve.
            if pre_iteration_comments_extracted_at is None:
                db.execute(
                    "UPDATE pull_requests SET comments_extracted_at = ? "
                    "WHERE pull_request_uid = ?",
                    (datetime.now(UTC).isoformat(), pr_uid),
                )
        else:
            # Case 3: truncation-clear → CLEAR to NULL.
            db.execute(
                "UPDATE pull_requests SET comments_extracted_at = NULL "
                "WHERE pull_request_uid = ?",
                (pr_uid,),
            )
        stats["prs_processed"] = int(stats["prs_processed"]) + 1
    except ExtractionError as e:
        logger.warning(
            "Failed to extract comments for PR %s: %s",
            pr_uid, normalize_error_message(str(e)),
        )
        stats["prs_comment_failures"] = int(stats["prs_comment_failures"]) + 1

db.connection.commit()  # unchanged end-of-loop commit (preserves existing behavior)
```

**Backfill caller's shape** (inside `cmd_backfill_comments`, using the simplified 2-outcome rule):

```python
for ordinal, pr_row in enumerate(selection_snapshot, start=1):
    pr_uid = pr_row["pull_request_uid"]
    outcome_token: Literal["Processed", "Failed"]
    try:
        outcome = _fetch_and_upsert_threads_for_pr(
            client, db, repo, pr_row, max_threads_per_pr
        )
        # Simplified 2-outcome rule: never traverses extract's "preserve" branch.
        if (not outcome.truncated) or _dropped_threads_all_stored(
            db, pr_uid, outcome.dropped_threads
        ):
            db.execute(
                "UPDATE pull_requests SET comments_extracted_at = ? "
                "WHERE pull_request_uid = ?",
                (datetime.now(UTC).isoformat(), pr_uid),
            )
        # else: truncation-clear → leave unchanged (still NULL; will reselect)
        db.connection.commit()          # per-PR commit (FR-012)
        outcome_token = "Processed"
        processed_count += 1
    except ExtractionError as e:
        db.connection.rollback()        # per-PR rollback (FR-013)
        warnings_list.append(
            f"backfill-comments: failed to process PR {pr_uid}: "
            f"{normalize_error_message(str(e))}"
        )
        outcome_token = "Failed"
        failed_count += 1

    # FR-018c: progress line emitted AFTER commit/rollback resolves.
    logger.info(
        "backfill-comments: covered PR %s (%d of %d) [%s]",
        pr_uid, ordinal, total_count, outcome_token,
    )
```

**Why the preserved-unset outcome is unreachable**: backfill's rule never enters extract's Case 2b (preserve) branch. If `outcome.truncated` is True and `_dropped_threads_all_stored` returns True, backfill **sets** the stamp (refreshes to now). The truncation-verified-complete branch always produces a non-null stamp post-iteration; FR-015's forbidden outcome cannot arise. Post-fix defense-in-depth: extract itself (commit `740810fd`) also eliminates the preserved-unset outcome for preiteration-NULL via its new Case 2a (preiteration-NULL → SET) — so even if a future refactor accidentally routed backfill through extract's caller-side logic, the outcome would still be SET, not unset.

### §2 — Argparse subcommand (FR-020–024, FR-024a, Issue #285)

Insert a new subparser block in `create_parser()` (currently `cli.py:69-463`) immediately after the existing `extract_parser` block (which ends at line 163). This placement keeps thread-related subcommands grouped.

Exact subparser prose — the canonical source for the forthcoming `docs/reference/cli-reference.md` generator (Issue #285) — is drafted in full in [contracts/cli-subcommand.md](./contracts/cli-subcommand.md). Plan-level summary:

- `subcommand="backfill-comments"`, parent-index `help=` is a one-line summary that distinguishes backfill from the normal extract flow (FR-020).
- `description=` paragraph explains the selection invariant (oldest-uncovered-first, stable tiebreak, skip-if-covered), the resume guarantee (per-PR commit boundary; durably-committed PRs persist across invocations per FR-012; failed and interrupted PRs remain selectable per FR-013/FR-013a), and the inherited upstream rate-limit behavior (FR-021). Phrased FR-024a-compliant — every "resumable"-flavored claim is qualified by the per-PR commit-boundary contract; no use of "thread-safe", "concurrent", "atomic" (outside the permitted "per-PR atomic" qualifier), or "complete" in database-wide context.
- `epilog=` includes at least one concrete usage example demonstrating a typical historical backfill (FR-022).
- Every flag's `help=` string states: effect, default (where applicable), permitted shape/range, and interactions with other flags (FR-023).
- Numeric flags use the existing `_non_negative_int` validator from `cli.py` (FR-010).
- Date flags are validated with a helper provably equivalent to extract's `--start-date`/`--end-date` validation (FR-005, FR-030d). The decision between (a) exposing extract's inline validator as a shared helper and (b) introducing a backfill-local twin with a parity test is deferred one level: the implementation chooses (a) if the existing validator is already expressible as a pure function; (b) otherwise. This deferral is scoped to an internal helper-naming choice, not an architectural decision — both paths satisfy FR-005's "reuse if shared helper exists; else introduce parity-tested twin" contract.
- Flag list (see contracts/cli-subcommand.md for exact `help=` prose): `--organization`, `--pat`, `--database`, `--projects`, `--since`, `--until`, `--limit`, `--comments-max-threads-per-pr`.

### §3 — Selection query and snapshot (FR-002, FR-003, FR-011a, FR-018a)

Backfill's selection query (executed once at run start, result set materialized in full before the loop begins):

```sql
SELECT pull_request_uid, pull_request_id, repository_id, project_name, closed_date
FROM pull_requests
WHERE status = 'completed'
  AND comments_extracted_at IS NULL
  [AND project_name IN (?, ?, ...)]                    -- when --projects provided
  [AND closed_date >= ?]                               -- when --since provided
  [AND closed_date <  ?]                               -- when --until provided (half-open)
ORDER BY closed_date ASC, pull_request_uid ASC
[LIMIT ?]                                              -- when --limit > 0
;
```

Result rows are fully consumed into a Python list before any ADO API call or per-PR iteration begins. `T = len(selection_snapshot)`; `T` is the value surfaced in FR-018a's anchor line (`"backfill-comments: backfill run over <T> pull request(s)"`) and as the denominator in every FR-018b progress line. New rows inserted into `pull_requests` during the run cannot enter the working set because the list is already materialized.

### §4 — Artifact composition and the first-class discriminator invariant (FR-019a–d, pre-plan deliverable 2)

**Invariant (non-negotiable, elevated to first-class contract per user confirmation)**: every `run_summary.json` artifact produced by the `backfill-comments` subcommand — across every terminated run (loop-completed success, loop-completed partial/100%-failure, loop-completed empty-selection, loop-completed legacy-schema no-op, fatal pre-loop abort) — MUST contain at least one entry in its `warnings` list whose literal prefix is `"backfill-comments: "`.

This invariant is enforced at **eight concrete code sites** inside `cmd_backfill_comments`. Every backfill termination path — success, partial-failure, 100%-failure, empty-selection, legacy-schema no-op, config error, DB error, upstream auth error, Ctrl-C mid-run, unexpected exception mid-run — traverses at least one of these sites. Tasks MUST wire each site explicitly; a missing site breaks the invariant for that one state and is detected by the FR-030e discriminator test (which drives every state and asserts `is_backfill_artifact()` returns True on every backfill-produced artifact).

#### Site-by-site enumeration (A–D5)

| Site | Location in `cmd_backfill_comments` | Trigger | Warning entry appended | Artifact state(s) covered |
|---|---|---|---|---|
| **A** | Inside the per-PR loop, within the `except ExtractionError:` handler local to the loop body | Each caught per-PR `ExtractionError` (ADO API 4xx/5xx after bounded retry, unreachable repo, invalid PR, etc.) — per FR-014 the loop continues | `f"backfill-comments: failed to process PR {pr_uid}: {normalize_error_message(str(e))}"` (appended once per Failed PR, time-ordered) | Loop-completed partial-failure; loop-completed 100%-failure |
| **B** | Pre-loop legacy-schema short-circuit branch (runs BEFORE the selection query executes) | `_legacy_schema_missing_thread_tables(db)` returns True | `"backfill-comments: legacy-schema-skip: pr_threads and pr_comments tables not present; run a migration or extract with --include-comments first"` (exactly one entry; no other warning may share the `legacy-schema-skip:` prefix per FR-017a) | Loop-completed legacy-schema no-op |
| **C** | Post-loop, immediately **before** the `RunSummary(...)` constructor call on the success path | Every loop-completed run — emitted unconditionally regardless of `P` and `F` values (including `T=0` empty-selection and `P=0,F=T` 100%-failure) | `f"backfill-comments: loop-complete: processed={processed_count} failed={failed_count}"` (exactly one entry, appended last in the warnings list) | Loop-completed success; loop-completed partial-failure; loop-completed 100%-failure; loop-completed empty-selection (`T=0`) |
| **D1** | Outer `except ConfigurationError as e:` handler (wraps the function body) | `load_config(...)` raises — invalid `--organization`, missing/malformed config | `f"backfill-comments: fatal-abort: Configuration error: {normalize_error_message(str(e))}"` | Fatal pre-loop abort: invalid configuration |
| **D2** | Outer `except DatabaseError as e:` handler | `DatabaseManager(path)` / `db.connect()` raises — DB file missing, unopenable, corrupted header | `f"backfill-comments: fatal-abort: Database error: {normalize_error_message(str(e))}"` | Fatal pre-loop abort: unopenable / missing DB |
| **D3** | Outer `except ExtractionError as e:` handler — catches `ExtractionError` raised BEFORE the loop begins (the per-PR loop body has its own narrower `except ExtractionError` at Site A that catches and does NOT re-raise) | `ADOClient.test_connection(...)` raises — auth failure, unreachable org, PAT revoked | `f"backfill-comments: fatal-abort: Extraction error: {normalize_error_message(str(e))}"` | Fatal pre-loop abort: authentication failure or upstream unreachable |
| **D4** | Outer `except KeyboardInterrupt:` handler installed by `cmd_backfill_comments` itself (NOT delegated to `main()`) | Ctrl-C / SIGINT at any point during the subcommand, including mid-iteration (per FR-013a any in-flight transaction has rolled back by the time this handler runs) | `"backfill-comments: fatal-abort: Operation cancelled by user"` — writes summary with this entry, then **re-raises** `KeyboardInterrupt` so `main()`'s existing handler at `cli.py:2180-2191` sees `summary_path.exists()` is True (skips its own write) and returns exit code 130 | Mid-run Ctrl-C / SIGINT / SIGTERM |
| **D5** | Outer `except Exception as e:` handler installed by `cmd_backfill_comments` itself | Any non-anticipated exception type not matched by A/D1–D4 (e.g., a bug, an un-caught `OSError`, a dependency failure) | `f"backfill-comments: fatal-abort: {normalize_error_message(str(e))}"` — writes summary, then **re-raises** so `main()`'s existing handler at `cli.py:2193-2203` sees the summary already on disk and returns exit code 1 | Mid-run unexpected exception |

#### Shared emission utility — mandatory single-source-of-truth for the discriminator (non-negotiable)

**All eight sites above MUST route their warning append through exactly one helper.** Per-site inline `summary.warnings.append(f"backfill-comments: ...")` / `warnings_list.append(f"backfill-comments: ...")` calls are **forbidden**. Copy-pasted prefix strings across 8 sites will drift — a typo, a missing space, a refactor that splits the prefix across two concatenated strings — and the discriminator invariant will fail on that one termination path while still passing the FR-030e artifact test for every other state. The AST parity test below catches this mechanically.

**Helper contract** (added to `cli.py` alongside `FetchOutcome` and `_fetch_and_upsert_threads_for_pr`):

```python
# Single source of truth for the first-class discriminator prefix
# (plan §4 invariant). This string literal MUST NOT appear anywhere
# else in cli.py; the AST parity test in
# tests/unit/test_backfill_comments.py::TestBackfillWarningEmissionParity
# asserts the literal occurs exactly once in the module.
_BACKFILL_WARNING_PREFIX = "backfill-comments: "


def _append_backfill_warning(warnings: list[str], body: str) -> None:
    """Append a discriminator-prefixed warning to a backfill warnings list.

    All backfill warning emissions MUST route through this helper — across
    every termination path enumerated in plan §4 Sites A / B / C / D1–D5.
    Per-site inline `warnings.append(f"backfill-comments: ...")` calls are
    forbidden; the AST parity test asserts the discriminator prefix literal
    appears only inside this function's body in cli.py.

    `warnings` is typed as `list[str]` so the helper works against both the
    function-local `warnings_list` accumulated during the per-PR loop and
    the `RunSummary.warnings` list on a `create_minimal_summary()` return
    value (Sites D1–D5).
    """
    warnings.append(f"{_BACKFILL_WARNING_PREFIX}{body}")
```

**Call pattern per site** (replaces the inline f-strings shown in the enumeration table above):

| Site | Caller code |
|---|---|
| A — per-PR failure | `_append_backfill_warning(warnings_list, f"failed to process PR {pr_uid}: {normalize_error_message(str(e))}")` |
| B — legacy-schema-skip | `_append_backfill_warning(warnings_list, "legacy-schema-skip: pr_threads and pr_comments tables not present; run a migration or extract with --include-comments first")` |
| C — loop-complete (unconditional) | `_append_backfill_warning(warnings_list, f"loop-complete: processed={processed_count} failed={failed_count}")` |
| D1 — ConfigurationError | `_append_backfill_warning(minimal.warnings, f"fatal-abort: Configuration error: {normalize_error_message(str(e))}")` |
| D2 — DatabaseError | `_append_backfill_warning(minimal.warnings, f"fatal-abort: Database error: {normalize_error_message(str(e))}")` |
| D3 — pre-loop ExtractionError | `_append_backfill_warning(minimal.warnings, f"fatal-abort: Extraction error: {normalize_error_message(str(e))}")` |
| D4 — KeyboardInterrupt | `_append_backfill_warning(minimal.warnings, "fatal-abort: Operation cancelled by user")` — then re-raise |
| D5 — unexpected Exception | `_append_backfill_warning(minimal.warnings, f"fatal-abort: {normalize_error_message(str(e))}")` — then re-raise |

The prefix `"backfill-comments: "` lives in exactly ONE place in `cli.py` (inside `_BACKFILL_WARNING_PREFIX` / `_append_backfill_warning`); the 8 sites each construct only the tail portion of the entry.

**AST parity test — mandatory** (added to `tests/unit/test_backfill_comments.py` as a new test method; see §5 for test matrix row):

```python
class TestBackfillWarningEmissionParity:
    """Lock the shared-helper invariant from plan §4."""

    def test_discriminator_prefix_literal_appears_only_inside_helper(self) -> None:
        """
        Parse cli.py; find every string literal and f-string whose value
        starts with "backfill-comments: "; assert every occurrence is inside
        `_append_backfill_warning` or `_BACKFILL_WARNING_PREFIX`. Any other
        occurrence means a site bypassed the helper — fail.
        """
```

Implementation sketch (the test is a standard pytest file reading `src/ado_git_repo_insights/cli.py` via `ast.parse`):

```python
import ast
import pathlib


PREFIX = "backfill-comments: "
ALLOWED_ENCLOSING_NAMES = frozenset({"_append_backfill_warning"})
ALLOWED_ASSIGNMENT_TARGETS = frozenset({"_BACKFILL_WARNING_PREFIX"})


def test_discriminator_prefix_literal_appears_only_inside_helper():
    source = pathlib.Path("src/ado_git_repo_insights/cli.py").read_text(encoding="utf-8")
    tree = ast.parse(source)

    violations: list[tuple[int, str]] = []

    class Visitor(ast.NodeVisitor):
        def __init__(self) -> None:
            self.enclosing_function_name: str | None = None
            self.enclosing_assignment_target: str | None = None

        def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
            saved = self.enclosing_function_name
            self.enclosing_function_name = node.name
            self.generic_visit(node)
            self.enclosing_function_name = saved

        def visit_Assign(self, node: ast.Assign) -> None:
            if (
                len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name)
            ):
                saved = self.enclosing_assignment_target
                self.enclosing_assignment_target = node.targets[0].id
                self.generic_visit(node)
                self.enclosing_assignment_target = saved
            else:
                self.generic_visit(node)

        def visit_Constant(self, node: ast.Constant) -> None:
            if (
                isinstance(node.value, str)
                and PREFIX in node.value
                and self.enclosing_function_name not in ALLOWED_ENCLOSING_NAMES
                and self.enclosing_assignment_target not in ALLOWED_ASSIGNMENT_TARGETS
            ):
                violations.append((node.lineno, node.value))

    Visitor().visit(tree)
    assert not violations, (
        f"Discriminator prefix {PREFIX!r} must appear only inside "
        f"_append_backfill_warning or the _BACKFILL_WARNING_PREFIX constant. "
        f"Found {len(violations)} violation(s): {violations!r}"
    )
```

This test fires on every commit that adds a new inline `"backfill-comments: ..."` literal outside the helper — catching drift at code-review time without relying on someone remembering the rule.

**Drift modes this catches**:

1. A task author copy-pastes the Site A line into a new code path and forgets the helper → inline f-string at the new site → fail.
2. A task author uses a different spelling (`"backfill-comment:"`, `"Backfill-comments:"`, `" backfill-comments:"`) → inline literal at a new site → fail.
3. A future feature refactors `_append_backfill_warning` to delegate to a different helper without updating `ALLOWED_ENCLOSING_NAMES` → test fails loudly, forcing an explicit review.

**Drift modes this does NOT catch** (intentionally — those are locked elsewhere):

1. Body-format drift (e.g., `"loop_complete:"` instead of `"loop-complete:"` in the body passed to the helper) → caught by FR-030e artifact shape test (the FR-030i test locks `"legacy-schema-skip:"` specifically; FR-030e drives all 5 states through `is_backfill_artifact()`; the FR-030h ordering test observes the progress-line outcome token).
2. `normalize_error_message` drift → caught by FR-030f golden snapshot.

#### Why `cmd_backfill_comments` owns its own KeyboardInterrupt + Exception handlers (Sites D4 + D5)

`main()`'s existing handlers at `cli.py:2180-2203` write a bare-minimum summary via `create_minimal_summary()` and do NOT know about backfill's discriminator prefix. If the backfill subcommand let `KeyboardInterrupt` or an unexpected exception propagate unhandled, `main()` would write an artifact with `warnings=[]` — **invariant violated**. Sites D4 and D5 intercept first, attach the discriminator entry to the summary, write the artifact, then re-raise. `main()`'s `if not summary_path.exists()` guard (cli.py:2184 and cli.py:2197) sees the summary is already on disk and skips its own write; the exit-code semantics remain owned by `main()` (130 for KeyboardInterrupt, 1 for Exception) — Sites D4/D5 do not compete with `main()` for exit-code ownership.

#### Site-to-state coverage matrix (for task-level verification + the FR-030e test)

| Artifact state | Sites that fire | Minimum required `warnings` entries with `"backfill-comments: "` prefix |
|---|---|---|
| Loop-completed, all-success (`P>0, F=0, T>0`) | C | 1 (the loop-complete entry) |
| Loop-completed, partial-failure (`P>0, F>0`) | A × F + C | `F + 1` |
| Loop-completed, 100%-failure (`P=0, F=T>0`) | A × T + C | `T + 1` |
| Loop-completed, empty-selection (`T=0`) | C | 1 |
| Loop-completed, legacy-schema no-op | B | 1 (no loop-complete entry because the loop did not run) |
| Fatal pre-loop: invalid config | D1 | 1 |
| Fatal pre-loop: unopenable DB | D2 | 1 |
| Fatal pre-loop: upstream auth failure | D3 | 1 |
| Mid-run Ctrl-C | D4 | 1 |
| Mid-run unexpected exception | D5 | 1 |

**Every row returns ≥ 1.** The discriminator invariant holds on every backfill artifact by construction.

#### FR-025a compliance (Sites D1–D5)

Each fatal-handler site constructs a base `RunSummary` via `create_minimal_summary(error_message, args.artifacts_dir)` — exactly as extract does at `cli.py:877-897` — then **mutates the returned summary's `warnings` list** to append the discriminator entry before calling `.write()`. The helper's observable behavior (return a `RunSummary` with `warnings=[]`) is preserved; the backfill caller composes on top of the helper's return. Extract's identical call sites at `cli.py:875-897` and `cli.py:2185, 2198` are not touched.

**Enforcement tooth**: the FR-030f golden-snapshot test exercises `create_minimal_summary()` **directly** against its deterministic input and locks its return's rendered JSON. Any future change that alters the helper's default `warnings=[]` return would break the snapshot, forcing an explicit review before merge.

**FR-019d field mapping** (locked; Bucket 3 of the pre-plan audit is empty, so `counts.prs_updated = Processed` is used directly without the warnings-fallback):

| Schema field | Backfill value |
|---|---|
| `tool_version` | `get_tool_version()` |
| `git_sha` | `get_git_sha()` |
| `organization` | `args.organization` |
| `projects` | normalized project list from `--projects` per FR-004 (empty list if unset) |
| `date_range.start` | `args.since` or `""` |
| `date_range.end` | `args.until` or `""` |
| `counts.prs_fetched` | `0` (FR-019d — "PR metadata fetched" semantic does not apply to backfill) |
| `counts.prs_updated` | `processed_count` (FR-019d — semantic expansion; Bucket 3 empty, no fallback needed) |
| `counts.rows_per_csv` | `{}` (no CSV export in backfill) |
| `timings.total_seconds` | wall-clock from subcommand entry to artifact write |
| `timings.extract_seconds` | wall-clock inside the selection + loop block |
| `timings.persist_seconds` | `0.0` (no separate persistence phase — writes occur inside per-PR atomic units) |
| `timings.export_seconds` | `0.0` (no export phase) |
| `warnings` | ordered by emission time; contains per-Failed-PR entries + the legacy-schema entry if applicable + the unconditional loop-complete entry (or fatal-abort entry on pre-loop aborts) |
| `final_status` | `"success"` if loop ran to completion (any failure rate) or if legacy-schema branch fired; `"failed"` only for fatal pre-loop aborts |
| `per_project_status` | map `project_name → "success" \| "partial" \| "failed"` per FR-019d; projects with zero selected PRs absent from the map |
| `first_fatal_error` | `null` for loop-completed runs; normalized error message for fatal pre-loop aborts (definitive discriminator between the two shapes) |

**Consumer check form (exact)** — carried through to `contracts/cli-subcommand.md`:

```python
def is_backfill_artifact(artifact: dict[str, object]) -> bool:
    """Return True iff produced by the backfill-comments subcommand.

    Relies on the first-class artifact invariant (plan §4): every backfill-
    produced artifact state carries at least one warnings entry prefixed
    with "backfill-comments: ".
    """
    warnings = artifact.get("warnings", [])
    if not isinstance(warnings, list):
        return False
    return any(
        isinstance(w, str) and w.startswith("backfill-comments: ")
        for w in warnings
    )
```

### §5 — Test surface: named test methods, locked invariants, exact ratchet impact

Tests are defined unconditionally at module scope (Principle XXVI). No `pytest.mark.skipIf`, no runtime `pytest.skip()` at collection time, no decorators that add or remove definitions. The matrices below enumerate **38 distinct test method declarations** across **3 new test files** (32 in `test_backfill_comments.py` + 1 at #19a + 2 + 3). Some methods are parametrized — the collected-item count (what `pytest --collect-only` reports and what `scripts/check_ratchet_bump.py` ratchets against) is ≥ 38. Ratchet-bump target: `.test-floor-contract.json::python::min_collected` moves from **1816 → 1816 + N** in the **same commit** that lands the new tests, where `N` is the actual collected count observed locally and in CI.

#### File 1 — `tests/unit/test_backfill_comments.py` (NEW, 32 method declarations)

| # | Test class | Test method | Locked invariant | Source FR | Parametrized? |
|---:|---|---|---|---|---|
| 1 | `TestSelection` | `test_excludes_already_covered_prs` | FR-002: seed 3 covered + 2 uncovered; assert snapshot size == 2; assert iterated identities are exactly the 2 uncovered | FR-030 | no |
| 2 | `TestSelection` | `test_stable_ordering_on_equal_closed_dates` | FR-003: seed 2 PRs with identical `closed_date` and distinct `pull_request_uid`; assert iteration order == `pull_request_uid ASC` | FR-030 | no |
| 3 | `TestSelection` | `test_projects_filter_selects_only_matching_project` | FR-004: seed PRs across ProjectA + ProjectB; invoke with `--projects ProjectA`; assert only ProjectA PRs iterated | FR-030 | no |
| 4 | `TestSelection` | `test_since_until_half_open_interval` | FR-005: seed PRs across a date range; invoke with `--since X --until Y`; assert selection == `[X, Y)` (closed_date >= X AND closed_date < Y) | FR-030 | no |
| 5 | `TestSelection` | `test_limit_zero_is_unbounded` | FR-006: seed 100 PRs; invoke with `--limit 0`; assert all 100 iterated | FR-030 | no |
| 6 | `TestSelection` | `test_limit_positive_caps_selection_to_oldest_n` | FR-006: seed 100 PRs with distinct closed_dates; invoke with `--limit 10`; assert exactly the 10 oldest are iterated | FR-030 | no |
| 7 | `TestSelectionSnapshotStability` | `test_mid_loop_inserts_do_not_change_T_or_order` | FR-011a: materialize T=3; inside loop iteration 2, insert a 4th PR matching the selection predicate; assert loop iterates exactly 3 times and the inserted row is NOT iterated; re-run asserts T=1 on the second invocation | FR-030a | no |
| 8 | `TestPerPRAtomicity` | `test_exception_mid_upsert_leaves_db_bit_identical` | FR-012/013: seed 3 uncovered PRs; force the mocked `ADOClient.get_pr_threads` to succeed for PR1, partially succeed then raise after first `repo.upsert_thread` for PR2, succeed for PR3. Assert PR1 + PR3 are covered (threads + comments + users + marker all committed); assert PR2 has zero `pr_threads` rows, zero `pr_comments` rows, zero new `users` rows (rollback), and `comments_extracted_at` is NULL | FR-030b | no |
| 9 | `TestInterruptSafety` | `test_signal_between_iterations_leaves_committed_prs_persisted` | FR-013a: seed 3 PRs; simulate SIGINT raised AFTER PR2's commit but BEFORE PR3's iteration. Assert PR1 + PR2 are covered; assert PR3 is NOT covered; assert a re-invocation selects only PR3 | FR-030c | no |
| 10 | `TestInterruptSafety` | `test_signal_mid_iteration_rolls_back_affected_pr` | FR-013a: seed 3 PRs; simulate SIGINT raised partway through PR2's upsert sequence (before commit). Assert PR1 is covered; assert PR2 has zero partial rows and `comments_extracted_at IS NULL`; assert PR3 has zero rows and `IS NULL`; re-invocation selects PR2 + PR3 | FR-030c | no |
| 11 | `TestFilterParsingParity` | `test_projects_parser_matches_extract_on_corpus` | FR-004: feed a corpus of raw `--projects` strings (`""`, `"A"`, `"A,B"`, `" A , B "`, `"A,,B"`, `"A ,B"`, `",A,"`, `"  "`) to extract's parser AND backfill's parser (after the shared-helper refactor, they are the same function; this test still executes through each entry point); assert identical normalized output for every input | FR-030d | **yes** (pytest.mark.parametrize over input corpus — ~8 cases) |
| 12 | `TestFilterParsingParity` | `test_date_parser_matches_extract_on_corpus` | FR-005: feed a corpus of raw date strings (`"2024-01-01"`, `"2024-12-31"`, `"2024-13-01"`, `"2024-02-30"`, `"2024-00-01"`, `""`, `"not-a-date"`, `"2024/01/01"`, `"01-01-2024"`, garbage) to extract's validator AND backfill's validator; assert identical accept/reject outcome for every input | FR-030d | **yes** (~10 cases) |
| 13 | `TestDocsTreeUntouched` | `test_feature_branch_has_zero_diff_under_docs` | FR-029/029a + SC-008/021: invoke `git diff --name-only origin/refactor/constitution..HEAD -- docs/` from the test; assert output is empty. Also assert no file under `docs/` is modified by any automation the feature adds (verified by a dry-run of pre-commit + preflight against a throwaway commit) | FR-030g | no |
| 14 | `TestProgressLogOrdering` | `test_commit_failure_mid_loop_logs_failed_not_processed` | FR-018c: seed 3 PRs; force `db.connection.commit()` to raise on PR2's iteration; capture the log stream. Assert the progress line for PR2 carries `[Failed]`; assert there is NO earlier conflicting `[Processed]` line for PR2; assert PR1 logs `[Processed]` (its commit succeeded) | FR-030h | no |
| 15 | `TestLegacySchemaDiscriminator` | `test_legacy_schema_emits_skip_prefix_warning` | FR-017 + FR-017a: construct a DB with `pull_requests` but WITHOUT `pr_threads` / `pr_comments` tables; run backfill; assert the artifact's `warnings` list contains **exactly one** entry with prefix `"backfill-comments: legacy-schema-skip:"` and that entry names both missing tables | FR-030i | no |
| 16 | `TestLegacySchemaDiscriminator` | `test_empty_selection_does_not_emit_skip_prefix` | FR-017a: construct a modern-schema DB with zero uncovered completed PRs; run backfill; assert the artifact contains ZERO entries with prefix `"legacy-schema-skip:"`; assert the artifact still contains exactly one entry with prefix `"backfill-comments: loop-complete:"` (Site C invariant) | FR-030i | no |
| 17 | `TestNoImplicitSafetyClaims` | `test_help_output_has_no_forbidden_claims` | FR-024a: render `ado-insights backfill-comments --help`; scan for forbidden keywords (`thread-safe`, `concurrent`, `atomic` outside `"per-PR atomic"`, `complete` in DB-wide context, `resumable` without FR-012/013 qualifier); assert zero unqualified occurrences | FR-030j | no |
| 18 | `TestNoImplicitSafetyClaims` | `test_log_stream_has_no_forbidden_claims` | FR-024a: drive a controlled-fixture mixed-outcome run (2 Processed + 1 Failed + 1 legacy-schema); capture log stream; scan for forbidden keywords; assert zero unqualified occurrences | FR-030j | no |
| 19 | `TestNoImplicitSafetyClaims` | `test_artifact_has_no_forbidden_claims` | FR-024a: same run as #18; scan the artifact's `warnings` entries + `first_fatal_error` string for forbidden keywords; assert zero unqualified occurrences | FR-030j | no |
| 19a | `TestBackfillWarningEmissionParity` | `test_discriminator_prefix_literal_appears_only_inside_helper` | **Plan §4 shared-helper invariant**: parse `src/ado_git_repo_insights/cli.py` via `ast.parse`; find every string constant whose value contains `"backfill-comments: "`; assert each occurrence is either inside the `_append_backfill_warning` function body or inside the `_BACKFILL_WARNING_PREFIX` module-level constant assignment. Any other occurrence means a site bypassed the helper (drift) — fail with a line-numbered violation list. | plan §4 (supplementary to FR-030e; locks the implementation mechanism behind the first-class discriminator invariant) | no |
| 20 | `TestCoverageMarkerInvariants` | `test_full_success_branch_sets_stamp` | FR-015 full-success: untruncated fetch; assert post-iteration `comments_extracted_at` is non-null ISO-8601 | FR-031 | no |
| 21 | `TestCoverageMarkerInvariants` | `test_truncation_verified_complete_preiteration_null_sets_stamp` | FR-015 truncation-verified-complete (pre-iteration marker NULL): truncated fetch, every dropped thread already stored locally with current `last_updated`; assert post-iteration marker is non-null — **locks that preserved-unset outcome is unreachable in backfill** | FR-031 | no |
| 22 | `TestCoverageMarkerInvariants` | `test_truncation_verified_complete_preiteration_set_keeps_or_refreshes_stamp` | FR-015 truncation-verified-complete (pre-iteration marker set): same fixture but pre-iteration marker is a past ISO timestamp; assert post-iteration marker is non-null (preserved-in-place OR refreshed to now — both acceptable per FR-015) | FR-031 | no |
| 23 | `TestCoverageMarkerInvariants` | `test_truncation_clear_branch_leaves_marker_null` | FR-015 truncation-clear: truncated fetch, at least one dropped thread is missing or stale locally; assert post-iteration marker is NULL; assert re-invocation reselects this PR | FR-031 | no |
| 24 | `TestCoverageMarkerInvariants` | `test_non_fatal_error_branch_leaves_marker_unchanged` | FR-015 non-fatal-error: `ExtractionError` raised during fetch; assert pre-iteration marker state is preserved (NULL stays NULL); assert re-invocation reselects this PR | FR-031 | no |
| 25 | `TestEndToEnd` | `test_happy_path_drains_uncovered_prs` | FR-032 happy path: seed 3 uncovered PRs; invoke backfill with valid credentials; assert 3 covered, artifact reports `prs_updated=3`, `final_status="success"`, exit code 0 | FR-032 | no |
| 26 | `TestEndToEnd` | `test_partial_failure_continues_loop_and_exits_zero` | FR-032 partial failure: seed 3 PRs, arrange PR2 to raise `ExtractionError`; assert loop runs to completion, PR1 + PR3 covered, PR2 not covered, artifact has one `"failed to process PR"` warning + the `loop-complete` warning, exit code 0 | FR-032 | no |
| 27 | `TestEndToEnd` | `test_resumability_zero_api_calls_on_drained_fixture` | FR-032 resumability: seed 3 covered PRs; invoke backfill; assert mocked `ADOClient.get_pr_threads` is called 0 times; assert artifact's `loop-complete` entry carries `processed=0 failed=0`; exit code 0 | FR-032 | no |
| 28 | `TestEndToEnd` | `test_legacy_schema_successful_no_op_full_artifact` | FR-032 legacy schema: legacy-schema DB; assert full-shape success artifact (not minimal-shape) with `final_status="success"`, `first_fatal_error=null`, `counts.prs_fetched=0`, `counts.prs_updated=0`, exit code 0 | FR-032 | no |
| 29 | `TestFlagValidation` | `test_negative_limit_rejected` | FR-010 + FR-033: invoke with `--limit -1`; assert argparse error; exit code 2 | FR-033 | no |
| 30 | `TestFlagValidation` | `test_negative_comments_max_threads_rejected` | FR-010 + FR-033: invoke with `--comments-max-threads-per-pr -1`; assert argparse error; exit code 2 | FR-033 | no |
| 31 | `TestFlagValidation` | `test_malformed_since_rejected` | FR-005 + FR-033: invoke with `--since 2024-13-99`; assert validation error; exit code 2 | FR-033 | no |
| 32 | `TestFlagValidation` | `test_malformed_until_rejected` | FR-005 + FR-033: invoke with `--until not-a-date`; assert validation error; exit code 2 | FR-033 | no |

#### File 2 — `tests/unit/test_run_summary_parity.py` (NEW, 2 method declarations)

| # | Test class | Test method | Locked invariant | Source FR | Parametrized? |
|---:|---|---|---|---|---|
| 33 | `TestArtifactShapeParity` | `test_backfill_and_extract_artifacts_have_identical_shape` | FR-025b: run extract against a controlled fixture (mocked ADO client, fixed tool_version/git_sha); run backfill against a comparable controlled fixture; parse both `run_summary.json` files; assert identical top-level key sets; assert identical nested-object key sets for `date_range`, `counts`, `timings`; assert identical per-field Python type shapes | FR-030e | no |
| 34 | `TestArtifactShapeParity` | `test_discriminator_invariant_holds_for_all_backfill_states` | First-class discriminator invariant: drive backfill in 9 states (one per Site A/B/C/D1/D2/D3/D4/D5 + empty-selection — loop-success, partial-failure, empty-selection, legacy-schema no-op, fatal-config-error, fatal-database-error, fatal-preloop-extraction-error, fatal-ctrl-c, fatal-unexpected-exception) and extract in 1 state; assert `is_backfill_artifact()` returns True for all 9 backfill states; assert False for extract. **This is the single test that would fail if any of the 8 code sites A–D5 in §4 is not wired.** Pass 2 expanded the corpus from 5 to 9 backfill states so every Site has a dedicated parametrize case (no transitive coverage). | FR-030e | **yes** (parametrized over 9 backfill states + 1 extract = 10 parametrized cases) |

#### File 3 — `tests/unit/test_run_summary_snapshot.py` (NEW, 3 method declarations)

| # | Test class | Test method | Locked invariant | Source FR | Parametrized? |
|---:|---|---|---|---|---|
| 35 | `TestExtractProducerGoldenSnapshot` | `test_RunSummary_to_dict_matches_golden` | FR-025c: construct `RunSummary` with deterministic fields (monkeypatched `get_tool_version()` + `get_git_sha()`); call `.to_dict()`; assert rendered JSON bytes equal committed `tests/unit/goldens/run_summary_to_dict.json` | FR-030f | no |
| 36 | `TestExtractProducerGoldenSnapshot` | `test_create_minimal_summary_matches_golden` | FR-025c: call `create_minimal_summary("test fatal error", Path("run_artifacts"))` with monkeypatched version/sha helpers; call `.to_dict()`; assert rendered JSON bytes equal committed `tests/unit/goldens/create_minimal_summary.json`. **This test locks `warnings=[]` as the helper's default return**, which is the FR-025a compliance tooth behind Sites D1–D5's caller-side mutation approach. | FR-030f | no |
| 37 | `TestExtractProducerGoldenSnapshot` | `test_normalize_error_message_matches_golden` | FR-025c: feed a corpus of inputs (URL with query params, plain URL, long string, short string, mixed); call `normalize_error_message()` on each; assert each output equals the corresponding entry in committed `tests/unit/goldens/normalize_error_message.json` | FR-030f | **yes** (parametrized over corpus — ~5 cases) |

#### Ratchet impact summary (for the implementation commit)

| Quantity | Value |
|---|---|
| Pre-feature Python floor (`.test-floor-contract.json::python::min_collected`) | **1816** (post-#289-fix baseline; `740810fd` bumped 1814 → 1816 for the +2 tests added by that commit) |
| New test methods declared | **38** (32 in `test_backfill_comments.py` + 1 at #19a `TestBackfillWarningEmissionParity` + 2 in `test_run_summary_parity.py` + 3 in `test_run_summary_snapshot.py`) |
| New test files created | **3** (`test_backfill_comments.py`, `test_run_summary_parity.py`, `test_run_summary_snapshot.py`) |
| Methods with `pytest.mark.parametrize` | 4 (#11 corpus=8, #12 corpus=10, #34 corpus=10 (Pass 2 expansion: 9 backfill sites + 1 extract), #37 corpus=5) |
| Minimum ratchet-bump delta (no parametrization) | **+38** → floor becomes **1854** |
| Expected ratchet-bump delta (with parametrization) | **+67** (refined after Pass 2 #34 expansion: 34 non-parametrized × 1 + 8 + 10 + 10 + 5) → floor becomes **~1883** |
| Authoritative measurement | `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml` at the implementation commit |
| Binding gate | QG-43: the commit that lands the new tests MUST bump `.test-floor-contract.json::python::min_collected` by exactly the observed new-test count. Any drift fails the `ratchet-bump-guard` CI job. |

#### FR-030 → test-method cross-reference (quick lookup)

| FR | Tests (row numbers above) |
|---|---|
| FR-030 base (selection) | 1, 2, 3, 4, 5, 6 |
| FR-030a (snapshot stability) | 7 |
| FR-030b (per-PR atomicity) | 8 |
| FR-030c (interrupt safety) | 9, 10 |
| FR-030d (filter-parser parity) | 11, 12 |
| FR-030e (artifact-shape parity + discriminator across all states) | 33, 34 |
| FR-030f (extract producer golden snapshot) | 35, 36, 37 |
| FR-030g (docs-tree untouched) | 13 |
| FR-030h (progress-log ordering) | 14 |
| FR-030i (legacy-schema discriminator) | 15, 16 |
| FR-030j (forbidden-claim scan) | 17, 18, 19 |
| plan §4 (shared-helper emission parity — discriminator drift prevention) | 19a |
| FR-031 (coverage-marker invariants) | 20, 21, 22, 23, 24 |
| FR-032 (end-to-end) | 25, 26, 27, 28 |
| FR-033 (flag validation) | 29, 30, 31, 32 |
| FR-034 (extract regression lock, UNCHANGED) | tests/unit/test_extract_comments.py — 20 methods, must pass bit-for-bit after refactor |

#### Parametrization policy

The 4 parametrized methods (#11, #12, #34, #37) each have a corpus that is **locked at implementation time** via a module-level tuple or frozenset constant — no runtime-dynamic corpus construction. This keeps the collection count deterministic across local + CI + cross-OS lanes (Principle XXVI + QG-45). If a parametrized case is added mid-feature (during Pass 3 code validation), the ratchet target bumps accordingly in the same commit.

#### FR-034 regression lock — binding

`tests/unit/test_extract_comments.py` (current HEAD: 830 LOC, 20 test methods across 7 classes — enumerated in [research.md §3](./research.md#findings)) MUST pass bit-for-bit after the `_fetch_and_upsert_threads_for_pr` refactor. Zero assertion edits, zero tests added/removed/skipped, zero gating introduced. A failing test in this suite blocks merge; the fix is to re-align the refactor, not to edit the test.

### §6 — Pre-push gate chain (VR-28)

Before merge, `python scripts/run_repo_hook.py pre-push` MUST return exit code 0. This command runs version-guard first (QG-51, fast-fail), then the authoritative preflight (`scripts/run_pr_preflight.py`), which includes cross-OS collection parity (QG-45), ratchet-bump guard (QG-43), suppression audit (QG-41), mypy (QG-40 / VR-03), ruff (VR-02), pytest (VR-04 / QG-42), extension `format:check` (QG-55 / VR-02a), gitleaks (QG-56), and `test:ci` (QG-49). No `--no-verify` (QG-38). No `--allow-local-degraded` (QG-56).

## Complexity Tracking

*(Empty — every deferred architectural decision was locked at spec Pass 4 or by pre-plan deliverables.)*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| *(none)* | | |

## Post-Design Re-Evaluation of Constitution Check

Phase 1 companion artifacts (`research.md`, `data-model.md`, `contracts/cli-subcommand.md`, `quickstart.md`) are now generated. Re-walking the gate list against the Pass 1 design:

| Gate | Pre-design status | Post-design status | Delta |
|---|---|---|---|
| Core Principle V (SQLite as Source of Truth) | PASS | PASS | Confirmed: data-model.md §1.2–1.4 shows all writes flow through `repo.upsert_*` helpers |
| Core Principle VI (Pipeline Artifacts as Persistence) | PASS | PASS | Confirmed: contracts/cli-subcommand.md §7 locks artifact write to `args.artifacts_dir` |
| Core Principle VII (No Publish on Failure) | PASS | PASS | Confirmed: data-model.md §7 lifecycle shows per-PR `db.connection.commit()` / `rollback()` |
| Core Principle VIII (Idempotent State Updates) | PASS | PASS | Confirmed: data-model.md §2.1 shows 2-outcome rule; quickstart.md §2 demonstrates zero-API-call second run |
| Core Principle IX (Recoverable Persistence) | PASS | PASS | Confirmed: quickstart.md §5 legacy-schema smoke test |
| Core Principle XI (Periodic Backfill Required) | PASS | PASS | This feature IS the dedicated backfill path |
| Core Principle XII (No Silent Data Loss) | PASS | PASS | Confirmed: contracts/cli-subcommand.md §7.3 — every Failed PR has a `warnings` entry |
| Core Principle XVIII (Actionable Failure Logs) | PASS | PASS | Confirmed: contracts/cli-subcommand.md §6 log-stream contract |
| Core Principle XXVI (Collection-Stable Test Definitions) | PASS | PASS | Confirmed: plan.md §5 explicitly forbids `if version:` / decorators / import-time gating / runtime `pytest.skip()` |
| QG-39 Cross-OS | PASS | PASS | Confirmed: no OS-specific construct in any new string or code path |
| QG-40 No Any | PASS | PASS | Confirmed: `FetchOutcome.status: Literal["ok","failed"]`, `dropped_threads: list[AdoThread]`, `threads_upserted: int`, `comments_upserted: int`, `BackfillSelectionRow: TypedDict` — all precise types |
| QG-41 Zero suppressions | PASS | PASS | No suppression comments drafted |
| QG-42 Enterprise test coverage | PASS | PASS | Every FR-030a–j and FR-031/032/033 mapped to a named test file + method in plan.md §5 |
| QG-43 Ratchet-bump same-commit | BINDING | BINDING | Estimate `~33` new tests; actual count authoritative at implementation time; plan.md §5 flags this for tasks.md |
| QG-44 Single source of truth for floor | PASS | PASS | `.test-floor-contract.json` alone; no hardcoded ints in drafted wiring |
| QG-49 One authoritative command | PASS | PASS | `backfill-comments` single argparse subparser; no parallel invocation path |
| VR-28 Full pre-push hook | BINDING | BINDING | Pre-merge requirement: `python scripts/run_repo_hook.py pre-push` exits 0 |
| VR-30 Ratchet-bump parity | BINDING | BINDING | Cross-OS floor parity enforced by `python-collection-parity` CI job |

### Newly discovered invariants surfaced during Phase 1

Two invariants became visible only after Phase 1 drafting and are load-bearing enough to capture here:

1. **INV-8 (discriminator invariant, first-class)** — every backfill-produced artifact carries at least one `"backfill-comments: "` warning entry. Elevated from implementation detail to first-class contract per user confirmation at the end of the pre-plan phase. Enforced at 4 code sites (plan.md §4 table); verified by FR-030e test across all 5 artifact states.
2. **Caller-side commit-boundary responsibility** — the FR-015a helper refactor implies that `_fetch_and_upsert_threads_for_pr` MUST NOT call `db.connection.commit()` or `db.connection.rollback()`; each caller decides its own commit boundary. Extract preserves its end-of-loop commit; backfill commits per-PR inside each iteration. Surfaced in research.md §4 and plan.md §1; testable via FR-030b (atomicity) and FR-030c (interrupt safety).

### Filter-parser reuse decision (plan §2, research.md §5)

Refactor extract's inline projects-parsing logic into `_parse_projects_list(raw: str) -> list[str]` (pure function in `config` module) and extract's inline date validation into `_parse_iso_date(raw: str) -> date`. Both flows call the shared helpers. This is a behavior-preserving refactor (FR-025a-permitted). FR-030d parity test exercises the shared helpers + extract's end-to-end path, guaranteeing no regression.

### Gate evaluation: **PASS** (post-design)

No unjustified violations. No entries added to Complexity Tracking. No deferred architectural decisions. Ready for Pass 2 (hardening).

## Planning Cadence Status

- **Pass 1 (draft from spec)**: **COMPLETE** (this document).
- **Pass 2 (hardening)**: pending — tighten vague task bullets, confirm test-count estimate against the drafted test file skeletons, add concrete `assert` expressions to each FR-030* entry.
- **Pass 3 (code-validation)**: pending — walk every task against HEAD one more time; confirm line-number references still hold after any intervening commits; confirm every named test class/method in §5 is both drafted AND wire-tested against a miniature fixture.
- **Pass 4 (readiness-for-tasks)**: pending — ensure every task is self-contained; no task depends on a decision that lives in another task's body.

`/speckit.tasks` MUST NOT start until Pass 4 is complete.
