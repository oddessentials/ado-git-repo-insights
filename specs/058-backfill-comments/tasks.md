# Tasks: Historical PR Thread Backfill Subcommand

**Branch**: `058-backfill-comments` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)
**Constitution**: v1.5.0 | **Pass**: 1 (draft from plan)

**Prerequisites loaded**: [spec.md](./spec.md) (4-pass hardened), [plan.md](./plan.md) (Pass 1+2+2.5), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/cli-subcommand.md](./contracts/cli-subcommand.md), [quickstart.md](./quickstart.md).

**Tests**: MANDATORY. 38 new test method declarations across 3 new test files locked to FR-030a–j, FR-031, FR-032, FR-033, plan §4. Every test defined unconditionally at module scope (Principle XXVI — no `if version:` wrappers, no import-time gating, no `pytest.mark.skipIf`, no runtime `pytest.skip()` at collection).

**Ratchet strategy (locked, non-negotiable)**:
All 38 new test methods + the `.test-floor-contract.json::python::min_collected` bump land in **ONE terminal commit** (QG-43 same-commit rule). No partial-delta bumps. No tests in earlier commits. The floor delta is determined at the implementation moment by `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml`; tasks reference the measurement command as the sole authoritative source. Any hardcoded delta number appearing in this document is an estimate for planning sanity only (comment, not contract).

**Tasks-phase hard locks (inherited from plan Pass 2.5; violations fail code review)**:

1. **FR-015a is CLOSED**. No task re-evaluates Path 1 (shared-helper bug fix) or Path 2 (backfill-only override). No task adds `mode=` / `strict_backfill=` / `is_backfill=` parameter to `_fetch_and_upsert_threads_for_pr`. Shared surface scope limited to pure predicates + utilities.
2. **Single discriminator source of truth**. All 8 sites A/B/C/D1/D2/D3/D4/D5 emit warnings through `_append_backfill_warning(warnings, body)`; the literal `"backfill-comments: "` appears only inside `_append_backfill_warning` or the `_BACKFILL_WARNING_PREFIX` assignment. AST parity test #19a fires on drift.
3. **Sites D4/D5 intercept BEFORE `main()`**. KeyboardInterrupt + Exception handlers installed inside `cmd_backfill_comments` itself, write the artifact with discriminator entry, then re-raise; `main()`'s handlers at `cli.py:2180-2203` see `summary_path.exists() == True` and skip their own write.
4. **Extract preservation**. `tests/unit/test_extract_comments.py` (830 LOC, 20 methods) MUST pass bit-for-bit unchanged. Zero assertion edits, zero tests added/removed/skipped. Extract's end-of-loop `db.connection.commit()` at `cli.py:672` stays at the same logical position.
5. **T002/T003 MUST preserve the post-fix Case 2 behavior bit-for-bit.** Commit `740810fd` (the #289 fix) landed two load-bearing additions inside `_extract_comments`: (a) a pre-iteration snapshot read `pre_iteration_comments_extracted_at` at `cli.py:517-526`, and (b) a Case 2 sub-decision at `cli.py:627-640` that SETS the coverage marker when the pre-iteration value is NULL (Case 2a) and preserves it when non-NULL (Case 2b). T002 (helper extraction) and T003 (extract caller refactor) MUST carry BOTH pieces through the refactor bit-for-bit. Accidentally reverting the fix — for example by dropping the snapshot read, collapsing Case 2 back to `pass`, or reordering the snapshot below the helper call — fails code review. Primary regression tooth: `TestExtractCommentsStamping::test_truncated_fetch_sets_completion_marker_when_dropped_stored_preiteration_null` (test file lines 163-198) fails immediately if Case 2a regresses. Secondary: `test_manual_marker_reset_does_not_loop_when_dropped_threads_already_stored` (lines 201-230) fails if the operator-reset path regresses. Pass 3 code-validation visually inspects the refactored block to confirm the snapshot+sub-branch structure survived.
6. **Docs tree untouched** (FR-029 / FR-029a). No task writes under `docs/`, `extension/`, `tasks/`, `.github/workflows/`, `sample-pipeline.yml`, `insights-verification-test.yml`, or any Azure DevOps task manifest. FR-030g test method #13 enforces mechanically.
7. **No typing.Any** (QG-40). **No inline suppressions** (QG-41). **Cross-OS** Windows/macOS/Linux (QG-39). **Collection-stable test definitions** (Principle XXVI).

**Format**: `[ID] [P?] Description` — `[P]` = different files, no ordering dependency within its phase.

**Requirement traceback convention**: every task cites the FR / INV / plan-section / QG / VR it satisfies. Every code-writing task names the test method(s) in plan §5 that lock it.

---

## Phase 1: Foundational (blocking prerequisites — §1 helpers + behavior-preserving refactor)

**Purpose**: shared helpers + behavior-preserving extract refactor. All backfill-subcommand work in Phase 2 depends on this phase completing. The entire Phase 1 diff is observationally invisible to extract (FR-025a permits), proven by the unchanged `test_extract_comments.py` passing bit-for-bit.

### §1a — Shared primitives

- [X] **T001** Add `FetchOutcome` frozen dataclass + required imports in `src/ado_git_repo_insights/cli.py`
  - Location: between `_extract_comments` (ends at line 662) and `_dropped_threads_all_stored` (starts at line 960) — the natural insertion point per plan §1.
  - Declare: `@dataclass(frozen=True) class FetchOutcome:` with fields `status: Literal["ok", "failed"]`, `truncated: bool`, `dropped_threads: list[AdoThread]`, `threads_upserted: int`, `comments_upserted: int`. **Amendment rationale**: the original 3-field shape proved incomplete against FR-034 (extract tests assert on `stats["threads"]` / `stats["comments"]` at test file lines 337, 371). Carrying the counts on the outcome preserves the single-return / no-mutated-parameter boundary without coupling the helper to caller-owned stats aggregation.
  - Add module imports as needed: `Literal` from `typing`, `Mapping` from `collections.abc`, `dataclass` from `dataclasses`. **Pass 3 verified**: `AdoThread` is a `TypedDict` defined in `src/ado_git_repo_insights/types.py:143`; cli.py already imports it at line 28 (inside `if TYPE_CHECKING:`). cli.py has `from __future__ import annotations` at line 3, so the TYPE_CHECKING import suffices for the `list[AdoThread]` annotation on `FetchOutcome.dropped_threads` (no runtime import needed). Reuse the existing import site; do NOT declare a local alias.
  - FR refs: **FR-015b** helper shape. INV refs: **INV-6**, **INV-7**.
  - Gates: **QG-40** (precise types — no `Any`), **QG-41** (no suppressions).
  - Tests locking this: structural — attribute presence verified transitively by T002's helper signature and by test #8 (`test_exception_mid_upsert_leaves_db_bit_identical`, which constructs an outcome) plus tests #20–24 via backfill's caller-side stamp logic.

- [X] **T002** Extract `_fetch_and_upsert_threads_for_pr` helper from current per-PR inline body
  - File: `src/ado_git_repo_insights/cli.py`.
  - Signature: `def _fetch_and_upsert_threads_for_pr(client: ADOClient, db: DatabaseManager, repo: PRRepository, pr_row: Mapping[str, object], max_threads_per_pr: int) -> FetchOutcome:`.
  - **Migrate bit-for-bit** from `cli.py:510-670` (post-fix; includes the #289 fix additions): pre-iteration snapshot read of `comments_extracted_at` into a local `pre_iteration_comments_extracted_at` (current lines 517-526 — the snapshot MUST move into the caller's loop body alongside the helper call, NOT inside the helper, because it is consumed by the caller's Case 2 sub-decision), per-thread incremental sync (current lines 561-565), thread upsert via `repo.upsert_thread` (573-581), per-comment upsert with preceding `repo.upsert_user` for FK integrity (591-607), truncation flag computation (539-541), dropped-threads slice computation (628).
  - **Removed from the helper (migrated to callers)**: 3-case stamp block at 621-647 (outer 3 cases with Case 2 sub-decision from the #289 fix: Case 1 SET / Case 2a preiteration-NULL→SET / Case 2b preiteration-non-NULL→preserve / Case 3 CLEAR), ExtractionError handler at 649-670, final `db.connection.commit()` at 672.
  - **Forbidden inside the helper**: calls to `db.connection.commit()` or `db.connection.rollback()`; updates to `pull_requests.comments_extracted_at`; `except ExtractionError` (must propagate to caller).
  - FR refs: **FR-015a Path 3 lock**, **FR-015b** signature, **FR-025a** behavior-preserving refactor permission. INV refs: **INV-6**, **INV-7**.
  - Gates: **QG-40**, **QG-41**, **QG-49** (single authoritative helper — no mode flags).
  - Tests locking this: **FR-034 regression lock** (`tests/unit/test_extract_comments.py` 20 methods MUST pass bit-for-bit unchanged, including the 2 post-#289-fix tests at lines 163 and 201); also #20–24 (TestCoverageMarkerInvariants — backfill-side coverage of the 2-outcome rule that the helper enables).
  - Lock-5 assertion: the pre-iteration snapshot read at cli.py:517-526 is NOT moved into the helper; it stays in the caller's loop body. The helper's body is pure fetch/upsert with no coverage-marker read or write.

- [X] **T003** Refactor `_extract_comments` to call `_fetch_and_upsert_threads_for_pr`; preserve extract's caller-side pre-iteration snapshot + post-fix 3-case stamp (with Case 2 sub-decision) + end-of-loop commit bit-for-bit
  - File: `src/ado_git_repo_insights/cli.py` — replace current inline body at `510-651` with plan §1's "Extract caller's new shape" block.
  - **Preserve bit-for-bit**: (a) 3-branch stamp logic (untruncated → set; truncated + all-dropped-stored → `pass`; truncated + any-dropped-missing → clear NULL), (b) caller-side `except ExtractionError` with `normalize_error_message(str(e))` warning emission + `stats["prs_comment_failures"] += 1`, (c) end-of-loop `db.connection.commit()` at current **line 653** — MUST remain at the same logical position (Pass 3 visual inspection + FR-034 regression lock).
  - **Do NOT touch**: extract's fatal handlers at `cli.py:875-897` (ConfigurationError / DatabaseError / ExtractionError) — unchanged. The post-loop metadata block at `cli.py:673-680` (`repo.update_comments_extraction_metadata` + second `commit`) — unchanged.
  - **Do NOT regress**: the #289 fix (post-fix Case 2 sub-branch at cli.py:627-640 + pre-iteration snapshot read at cli.py:517-526). Lock-5 applies: refactor preserves both pieces bit-for-bit in the caller.
  - FR refs: **FR-025**, **FR-025a**, **FR-034**. INV refs: **INV-6**.
  - Gates: **QG-42** (existing coverage preserved), **QG-49**.
  - Tests locking this: `tests/unit/test_extract_comments.py` (20 methods, 830 LOC) MUST pass unchanged — **FR-034 regression lock is the primary tooth**; additionally the 2 post-#289-fix tests (preserve-when-null→SET at file lines 163-198 and operator-reset recovery at 201-230) are the specific teeth against accidental regression of the fix; #35 / #36 / #37 golden-snapshot suite locks `run_summary.py` producer output so refactor side-effects on untouched modules would surface.

- [X] **T004** [P] Add `_parse_projects_list(raw: str | None) -> list[str]` pure helper and switch extract's inline projects-parsing to call it
  - File: `src/ado_git_repo_insights/config.py` (Pass 3 code-validation confirms current inline location; fallback: a new module-level function in the same module that owns extract's projects parsing).
  - Behavior: tolerant — split on `,`, trim each entry of surrounding whitespace, drop empties, preserve order. Never raises; invalid entries match zero PRs at selection time. `None` / `""` return `[]`.
  - Replace extract's inline projects-list parsing with a call to this helper (FR-025a permits behavior-preserving refactor).
  - Both extract and backfill flows call this helper — guaranteed identical behavior across entry points.
  - FR refs: **FR-004**, **FR-025a**, **FR-030d** parity contract.
  - Gates: **QG-40**, **QG-42**.
  - Tests locking this: **#11** `TestFilterParsingParity::test_projects_parser_matches_extract_on_corpus` (parametrized over 8 cases; module-level tuple locks the corpus per Principle XXVI).

- [X] **T005** [P] Add `_parse_iso_date(raw: str) -> date` pure helper and switch extract's inline date validation to call it
  - File: `src/ado_git_repo_insights/config.py` (Pass 3 code-validation confirms exact location of extract's current date validation; may live in `cli.py` adjacent to `create_parser()`).
  - Behavior: parse `YYYY-MM-DD` ISO-8601; raise `ValueError` on any format mismatch (wrong separator, wrong field widths) or invalid calendar value (month 13, day 30 in February, etc.).
  - Replace extract's inline `--start-date` / `--end-date` validation with a call to this helper (FR-025a permits).
  - Both extract and backfill flows call this helper. **Pass 2 lock**: error-translation happens at the argparse boundary via a thin wrapper `_parse_iso_date_argtype(raw: str) -> date` that calls the pure `_parse_iso_date(raw)` and translates any `ValueError` into `argparse.ArgumentTypeError` (exit code 2 on malformed input — matches contracts/cli-subcommand.md §8 exit-code contract). Both extract's `--start-date`/`--end-date` and backfill's `--since`/`--until` set `type=_parse_iso_date_argtype` in their argparse definitions. `load_config` does NOT re-validate (the argparse pass already caught malformed dates); `load_config` treats the parsed `date` as a trusted value.
  - FR refs: **FR-005**, **FR-025a**, **FR-030d** parity contract.
  - Gates: **QG-40**, **QG-42**.
  - Tests locking this: **#12** `TestFilterParsingParity::test_date_parser_matches_extract_on_corpus` (parametrized over 10 cases; module-level tuple).

- [X] **T006** [P] Add `_BACKFILL_WARNING_PREFIX` constant + `_append_backfill_warning(warnings: list[str], body: str) -> None` helper
  - File: `src/ado_git_repo_insights/cli.py`, adjacent to the `FetchOutcome` / helper block from T001–T002.
  - Constant: `_BACKFILL_WARNING_PREFIX = "backfill-comments: "` (module-level `_`-prefixed).
  - Helper: appends `f"{_BACKFILL_WARNING_PREFIX}{body}"` to the passed `warnings` list. Parameter typed `list[str]` so it accepts both the function-local `warnings_list` (built during the per-PR loop) and `RunSummary.warnings` (on `create_minimal_summary()` returns in Sites D1–D5).
  - **Single source of truth**: the literal `"backfill-comments: "` MUST appear only inside the helper's body and in the `_BACKFILL_WARNING_PREFIX` assignment RHS — no inline f-strings at any Site.
  - FR refs: **FR-019a**, **FR-019b**, **FR-019c**, **FR-019d**, **plan §4** shared-helper invariant. INV refs: **INV-8** discriminator invariant (first-class).
  - Gates: **QG-40**, **QG-49** (one authoritative helper for the discriminator emission).
  - Tests locking this: **#19a** `TestBackfillWarningEmissionParity::test_discriminator_prefix_literal_appears_only_inside_helper` — AST parity scan of `src/ado_git_repo_insights/cli.py`; fires if any inline literal escapes.

- [X] **T007** [P] Add `_legacy_schema_missing_thread_tables(db: DatabaseManager) -> bool` pure predicate
  - File: `src/ado_git_repo_insights/cli.py` (adjacent to the backfill helpers).
  - Behavior: return `True` if `pr_threads` OR `pr_comments` tables are absent from the database (queries `sqlite_master` — mirrors the existing pattern at `cli.py:826-832` where extract checks `pr_comments` presence). No side effects.
  - Pure predicate — no writes, no commits, no error-wrapping beyond letting `DatabaseError` propagate if the underlying connection fails.
  - FR refs: **FR-017**, **FR-028** (no schema mutation). INV refs: **INV-11** legacy-schema detection.
  - Gates: **QG-40**, **QG-41**.
  - Tests locking this: **#15** `test_legacy_schema_emits_skip_prefix_warning` (seeds a DB missing both tables and asserts Site B fires), **#16** `test_empty_selection_does_not_emit_skip_prefix` (negative case: modern-schema DB with zero uncovered PRs), **#28** `test_legacy_schema_successful_no_op_full_artifact` (end-to-end artifact shape).

**Checkpoint (end of Phase 1)**: `tests/unit/test_extract_comments.py` passes bit-for-bit unchanged (FR-034 lock is satisfied); all Phase 1 helpers are callable but not yet wired into a new subcommand. `mypy src/ tests/ scripts/ .github/scripts/` passes. `ruff check . && ruff format --check .` passes. No new inline suppressions. No `typing.Any`. This checkpoint is the gate before Phase 2 begins.

---

## Phase 2: Backfill subcommand implementation (§2 argparse, §3 selection, §4 artifact + Sites A–D5)

**Purpose**: wire `backfill-comments` as a complete subcommand with all 8 discriminator-emission sites, per-PR atomicity (FR-012/013), interrupt safety (FR-013a), and FR-024a-compliant user-facing prose. Depends on Phase 1 completing.

### §2 — Argparse subparser wiring

- [ ] **T008** Add `backfill-comments` subparser to `create_parser()` per `contracts/cli-subcommand.md`
  - File: `src/ado_git_repo_insights/cli.py`.
  - **Insertion point**: immediately after `extract_parser` block ends at line **163** (the closing `)` of the last `extract_parser.add_argument(…--comments-max-threads-per-pr)` call), before the comment `# Generate CSV command` at line 165. This keeps thread-related subcommands grouped (plan §2).
  - Subparser declaration: per `contracts/cli-subcommand.md` §1 — `subparsers.add_parser("backfill-comments", help=..., description=_BACKFILL_DESCRIPTION, epilog=_BACKFILL_EPILOG, formatter_class=argparse.RawDescriptionHelpFormatter)`.
  - Module-level constants `_BACKFILL_DESCRIPTION` (exact text from contracts §2, 1,223 chars) and `_BACKFILL_EPILOG` (exact text from contracts §3).
  - Arguments (exact `help=` prose from contracts §§4.1–4.8): `--organization` (required), `--pat` (required), `--database` (default `Path("ado-insights.sqlite")`), `--projects`, `--since`, `--until`, `--limit` (type=`_non_negative_int`, default 0), `--comments-max-threads-per-pr` (type=`_non_negative_int`, default 50).
  - Date-flag types: `type=str` with downstream validation in `cmd_backfill_comments` via `_parse_iso_date` (T005) — per contracts §8.
  - Numeric flags reuse the existing `_non_negative_int` validator at `cli.py:45-66` (FR-010).
  - **FR-024a self-check**: every help string and the description paragraph contain no unqualified `thread-safe`, `concurrent`, `complete` (DB-wide), or `resumable`; `atomic` appears only as `per-PR atomic`. Inline lint via test #17.
  - FR refs: **FR-020**, **FR-021**, **FR-022**, **FR-023**, **FR-024a**, **Issue #285** (generator source). INV refs: **INV-9** argparse contract, **INV-12** flag validation.
  - Gates: **QG-39** (argparse is cross-OS), **QG-40**, **QG-41**.
  - Tests locking this: **#17** `test_help_output_has_no_forbidden_claims` (forbidden-keyword scan on `--help`), **#29** `test_negative_limit_rejected`, **#30** `test_negative_comments_max_threads_rejected`, **#31** `test_malformed_since_rejected`, **#32** `test_malformed_until_rejected`.

- [ ] **T009** Wire `main()`'s command-dispatch to route `args.command == "backfill-comments"` to `cmd_backfill_comments`
  - File: `src/ado_git_repo_insights/cli.py`.
  - Location: inside the `try:` block at current lines **2137–2157** (right after the `stage-artifacts` branch at line 2147). Insert:
    ```python
    elif args.command == "backfill-comments":
        return cmd_backfill_comments(args)
    ```
  - **Pass 2 lock**: place the `backfill-comments` elif **immediately after the `extract` elif** in main()'s dispatch block — groups thread-related commands visually and mirrors the subparser ordering in `create_parser()`.
  - FR refs: **FR-020** (subcommand routing).
  - Gates: **QG-49** (one invocation path; no alternative entry point).
  - Tests locking this: transitively exercised by #25–28 (TestEndToEnd).

### §3 — Selection query + snapshot

- [ ] **T010** Add `_select_uncovered_prs_for_backfill(db, projects, since, until, limit) -> list[Mapping[str, object]]`
  - File: `src/ado_git_repo_insights/cli.py`.
  - SQL (plan §3 verbatim; conditional clauses appended only when the corresponding filter is set):
    ```sql
    SELECT pull_request_uid, pull_request_id, repository_id, project_name, closed_date
    FROM pull_requests
    WHERE status = 'completed'
      AND comments_extracted_at IS NULL
      [AND project_name IN (?, ?, ...)]        -- when projects non-empty
      [AND closed_date >= ?]                    -- when since provided
      [AND closed_date <  ?]                    -- when until provided (half-open)
    ORDER BY closed_date ASC, pull_request_uid ASC
    [LIMIT ?]                                   -- when limit > 0
    ;
    ```
  - Return: fully materialized via `cursor.fetchall()` before return (FR-011a snapshot stability — no lazy cursor iteration).
  - `limit == 0` sentinel → LIMIT clause omitted (unbounded, FR-006).
  - `projects` parameter is the `list[str]` returned by `_parse_projects_list` (T004); empty list → no project filter.
  - `since` / `until` parameters are `date | None` — formatted as `YYYY-MM-DD` SQL bind parameters when non-None.
  - FR refs: **FR-002**, **FR-003**, **FR-004**, **FR-005**, **FR-006**, **FR-011a**. INV refs: **INV-1** (skip-if-covered), **INV-2** (oldest-first + stable tiebreak), **INV-3** (projects), **INV-4** (half-open date window), **INV-5** (limit sentinel).
  - Gates: **QG-40**, **QG-41**.
  - Tests locking this: **#1** `test_excludes_already_covered_prs`, **#2** `test_stable_ordering_on_equal_closed_dates`, **#3** `test_projects_filter_selects_only_matching_project`, **#4** `test_since_until_half_open_interval`, **#5** `test_limit_zero_is_unbounded`, **#6** `test_limit_positive_caps_selection_to_oldest_n`, **#7** `test_mid_loop_inserts_do_not_change_T_or_order`.

### §4 — `cmd_backfill_comments` body + Sites A–D5

**Pass-2-hardening note**: Pass 1 splits the cmd body into T011 (skeleton + fatal handlers D1–D3), T012 (pre-loop legacy-schema check + Site B), T013 (opening anchor + snapshot materialization), T014 (per-PR loop body + Sites A + C), T015 (Sites D4 + D5). These five tasks modify the same function, so they cannot be `[P]` parallel within Phase 2; they must land in the stated order. Pass 2 may merge adjacent tasks if the combined diff is still ≤1 hour reviewable; Pass 3 confirms each block is syntactically/semantically self-sufficient in isolation.

- [ ] **T011** Add `cmd_backfill_comments(args: Namespace) -> int` skeleton with fatal-handler Sites D1, D2, D3
  - File: `src/ado_git_repo_insights/cli.py` — add adjacent to `cmd_extract` (current range 665–879).
  - Skeleton shape (body deliberately incomplete — subsequent tasks fill the loop and remaining sites):
    ```python
    def cmd_backfill_comments(args: Namespace) -> int:
        from .config import ConfigurationError, load_config
        from .extractor.ado_client import ADOClient, ExtractionError
        from .persistence.database import DatabaseError, DatabaseManager
        from .persistence.repository import PRRepository
        from .utils.run_summary import (
            RunSummary, RunCounts, RunTimings, create_minimal_summary,
            get_git_sha, get_tool_version, normalize_error_message,
        )
        warnings_list: list[str] = []
        processed_count = 0
        failed_count = 0
        try:
            # T012 pre-loop + T013 snapshot + T014 loop + T015 D4/D5 inside this scope
            ...
        except ConfigurationError as e:          # Site D1
            minimal = create_minimal_summary(
                f"Configuration error: {e}", args.artifacts_dir,
            )
            _append_backfill_warning(
                minimal.warnings,
                f"fatal-abort: Configuration error: {normalize_error_message(str(e))}",
            )
            minimal.write(safe_join(args.artifacts_dir, "run_summary.json"))
            return 1
        except DatabaseError as e:               # Site D2
            # same shape as D1, "Database error" prefix
            ...
            return 1
        except ExtractionError as e:             # Site D3 (pre-loop only)
            # same shape as D1, "Extraction error" prefix
            ...
            return 1
    ```
  - **D3 scope discipline**: the outer `except ExtractionError` at Site D3 catches `ExtractionError` raised **before the per-PR loop begins** (specifically from `ADOClient.test_connection(...)` during pre-loop setup). The per-PR loop body's own `except ExtractionError` (Site A, T014) catches + does NOT re-raise, so Site D3 never sees per-PR errors. **Pass 3 note**: import `ExtractionError` from `.extractor.ado_client` (the ADO-API exception class at `ado_client.py:105`), NOT from `.utils.safe_extract` which also defines a class named `ExtractionError` at `safe_extract.py:47` for a different purpose (tarball-extraction safety).
  - All three D-sites use `_append_backfill_warning(minimal.warnings, …)` (T006) — no inline f-strings.
  - FR refs: **FR-019a**, **FR-019b**, **FR-019c**, **FR-019d**, **plan §4 Sites D1/D2/D3**. INV refs: **INV-8**.
  - Gates: **QG-40**, **QG-41**, **QG-49**.
  - Tests locking this: **#34** `test_discriminator_invariant_holds_for_all_backfill_states` (parametrized; includes fatal pre-loop abort as a state), plus artifact-shape assertions in **#33**.

- [ ] **T012** Add pre-loop legacy-schema detection + Site B (inside `cmd_backfill_comments` `try:` block, BEFORE anything else)
  - File: `src/ado_git_repo_insights/cli.py` inside `cmd_backfill_comments`.
  - **Pass 2 locked execution order** inside `cmd_backfill_comments` outer try:
    1. `db = DatabaseManager(args.database); db.connect()` — may raise `DatabaseError` → Site D2.
    2. `_legacy_schema_missing_thread_tables(db)` — pure predicate; if True → Site B short-circuit (log + append legacy-schema-skip warning + write full-shape success artifact + return 0).
    3. `config = load_config(args)` — may raise `ConfigurationError` → Site D1.
    4. `client = ADOClient(...); client.test_connection(...)` — may raise `ExtractionError` → Site D3 (pre-loop).
    5. Selection snapshot materialization (T013) + per-PR loop (T014).
  - Rationale: legacy-schema check needs only `args.database` (from argparse), not full config. Running it before `load_config` means Site B fires cleanly even if the user's config file has an unrelated malformed entry — the legacy-schema no-op is a DB-state observation that shouldn't be gated on config validity. DB connect goes first because schema check needs an open connection.
  - On True → emit log line (contracts §6.4: `"backfill-comments: pr_threads and pr_comments tables not present; run a migration or extract with --include-comments first"` — exact text) + `_append_backfill_warning(warnings_list, "legacy-schema-skip: pr_threads and pr_comments tables not present; run a migration or extract with --include-comments first")` + construct full-shape `RunSummary` with `final_status="success"`, `first_fatal_error=None`, `counts.prs_fetched=0`, `counts.prs_updated=0`, per-project status `{}`, warnings list containing exactly the one Site B entry + write + emit terminal summary line `"backfill-comments: skipped (legacy schema; no thread storage tables)"` + return 0.
  - **No Site C entry** on this path (loop did not run — Site C's precondition is "loop completed").
  - FR refs: **FR-017**, **FR-017a** (no other warning uses `legacy-schema-skip:` prefix), **FR-028** (no schema mutation), **plan §4 Site B**. INV refs: **INV-8**, **INV-11**.
  - Gates: **QG-42**.
  - Tests locking this: **#15** `test_legacy_schema_emits_skip_prefix_warning` (positive — entry present, names both tables), **#16** `test_empty_selection_does_not_emit_skip_prefix` (negative — modern schema must not emit the prefix even on empty selection), **#28** `test_legacy_schema_successful_no_op_full_artifact` (end-to-end: full artifact shape, exit 0).

- [ ] **T013** Opening-anchor log + selection snapshot materialization (inside `cmd_backfill_comments` after T012 passes)
  - File: `src/ado_git_repo_insights/cli.py` inside `cmd_backfill_comments`.
  - Execution: after legacy-schema check returns False (T012 already passed) + after `load_config(args)` succeeds + after `ADOClient` instantiation + after `client.test_connection(probe_project)` passes.
  - **Pass 2 lock — `probe_project` selection** (resolves the "what project to probe" question for `client.test_connection`): use this fallback chain, first non-empty wins:
    1. First element of `_parse_projects_list(args.projects)` if the parsed list is non-empty.
    2. `config.projects[0]` if the config file provided a project list.
    3. Query the DB for a sample project name from the pre-selection predicate: `SELECT project_name FROM pull_requests WHERE status='completed' AND comments_extracted_at IS NULL LIMIT 1`. Use the result if non-null.
    4. If all three fallbacks are empty (no `--projects`, no config projects, no uncovered completed PRs in DB), **skip `test_connection` entirely** — the subsequent selection will return an empty list, loop iterates zero times, Site C emits loop-complete with `processed=0 failed=0`, exit 0. This is the "empty database" degenerate case.
  - Snapshot: `selection_snapshot = _select_uncovered_prs_for_backfill(db, _parse_projects_list(args.projects), _parse_iso_date(args.since) if args.since else None, _parse_iso_date(args.until) if args.until else None, args.limit)`; `T = len(selection_snapshot)`.
  - Log line: `logger.info("backfill-comments: backfill run over %d pull request(s)", T)` (contracts §6.1 — FR-018a). Emitted **before** any per-PR API call.
  - `T == 0` is a valid value — loop body T014 iterates zero times; flow falls through to Site C (T014) for the unconditional loop-complete emission.
  - FR refs: **FR-018a**, **FR-011a** (snapshot stability — rows materialized before loop). INV refs: **INV-4**, **INV-5**.
  - Gates: **QG-40**.
  - Tests locking this: **#7** `test_mid_loop_inserts_do_not_change_T_or_order`, implicitly by **#25–28** TestEndToEnd.

- [ ] **T014** Per-PR loop body with Sites A + C + per-PR commit/rollback (FR-012/013/013a) + review-timestamp hook (FR-016)
  - File: `src/ado_git_repo_insights/cli.py` inside `cmd_backfill_comments` after T013.
  - Loop shape (plan §1 "Backfill caller's shape" verbatim adapted; pseudo):
    ```python
    for ordinal, pr_row in enumerate(selection_snapshot, start=1):
        pr_uid = pr_row["pull_request_uid"]
        outcome_token: Literal["Processed", "Failed"]
        try:
            outcome = _fetch_and_upsert_threads_for_pr(
                client, db, repo, pr_row, args.comments_max_threads_per_pr,
            )
            # Simplified 2-outcome stamp rule — never enters extract's "preserve" branch.
            if (not outcome.truncated) or _dropped_threads_all_stored(
                db, pr_uid, outcome.dropped_threads,
            ):
                db.execute(
                    "UPDATE pull_requests SET comments_extracted_at = ? "
                    "WHERE pull_request_uid = ?",
                    (datetime.now(UTC).isoformat(), pr_uid),
                )
            # else: truncation-clear → leave marker unchanged (stays NULL; reselected)
            db.connection.commit()         # FR-012 per-PR commit
            outcome_token = "Processed"
            processed_count += 1
        except ExtractionError as e:       # Site A
            db.connection.rollback()       # FR-013 per-PR rollback
            _append_backfill_warning(
                warnings_list,
                f"failed to process PR {pr_uid}: {normalize_error_message(str(e))}",
            )
            outcome_token = "Failed"
            failed_count += 1

        # FR-018c: progress line emitted STRICTLY AFTER commit/rollback resolves.
        logger.info(
            "backfill-comments: covered PR %s (%d of %d) [%s]",
            pr_uid, ordinal, T, outcome_token,
        )

    # Site C (unconditional, AFTER the loop — fires for T==0 too).
    _append_backfill_warning(
        warnings_list,
        f"loop-complete: processed={processed_count} failed={failed_count}",
    )

    # FR-016: trigger review-timestamp recomputation (reuses extract's existing hook).
    _backfill_review_timestamps_if_needed(db)

    # Construct full-shape RunSummary per FR-019d field mapping (plan §4 table):
    # counts.prs_fetched = 0; counts.prs_updated = processed_count; etc.
    ...
    run_summary.write(safe_join(args.artifacts_dir, "run_summary.json"))
    run_summary.print_final_line()
    run_summary.emit_ado_commands()
    return 0
    ```
  - **Forbidden inside the loop body**: inline `warnings_list.append(f"backfill-comments: …")` (use T006 helper only); calls into the "preserve" branch (the 2-outcome rule by construction never enters the branch that produces preserved-unset outcomes — FR-015 compliance).
  - **Per-PR commit/rollback discipline**: `db.connection.commit()` on success path, `db.connection.rollback()` on ExtractionError path. No commit/rollback inside `_fetch_and_upsert_threads_for_pr` (T002 helper contract). FR-013a interrupt safety: SIGINT between iterations leaves all previously committed PRs persisted and the in-progress PR (if any) rolled back — delivered by the per-PR commit boundary + transactional upsert pattern in T002.
  - **FR-018c strict ordering**: progress line is a sibling statement AFTER both branches converge, not inside either branch — guarantees post-commit/post-rollback ordering with the correct outcome token.
  - **Terminal summary lines (Pass 2 lock)**: `cmd_backfill_comments` emits a backfill-specific `logger.info` line matching contracts §6.5 ("`backfill-comments: processed <P> pull requests (<F> failures)`" on the non-empty-selection loop-complete path, "`backfill-comments: processed 0 pull requests (0 failures)`" on empty-selection, "`backfill-comments: skipped (legacy schema; no thread storage tables)`" on Site B) BEFORE calling `run_summary.print_final_line()`. This mirrors `cmd_extract`'s pattern of emitting a subcommand-specific `logger.info("Extraction complete: ...")` adjacent to the shared `print_final_line()` call. `run_summary.print_final_line()` runs unchanged per FR-025a.
  - FR refs: **FR-012**, **FR-013**, **FR-013a**, **FR-014**, **FR-015** (2-outcome rule; preserved-unset unreachable by construction), **FR-016**, **FR-018b**, **FR-018c**, **FR-019a–d**, **plan §4 Sites A + C**. INV refs: **INV-6** (reuses `_dropped_threads_all_stored` unchanged), **INV-8**.
  - Gates: **QG-40**, **QG-41**, **QG-42**.
  - Tests locking this: **#8** `test_exception_mid_upsert_leaves_db_bit_identical` (Site A + rollback), **#9** `test_signal_between_iterations_leaves_committed_prs_persisted` (FR-013a), **#10** `test_signal_mid_iteration_rolls_back_affected_pr` (FR-013a), **#14** `test_commit_failure_mid_loop_logs_failed_not_processed` (FR-018c), **#20–24** TestCoverageMarkerInvariants (stamp branches), **#25** `test_happy_path_drains_uncovered_prs`, **#26** `test_partial_failure_continues_loop_and_exits_zero`, **#27** `test_resumability_zero_api_calls_on_drained_fixture`, **#33** artifact-shape parity, **#34** discriminator across states (Site A + Site C coverage).

- [ ] **T015** Add Sites D4 (KeyboardInterrupt) and D5 (Exception) handlers INSIDE `cmd_backfill_comments` — intercept BEFORE `main()`'s handlers
  - File: `src/ado_git_repo_insights/cli.py` — extend the outer `try` in `cmd_backfill_comments` with two additional `except` clauses AFTER D3.
  - Site D4 shape:
    ```python
    except KeyboardInterrupt:
        minimal = create_minimal_summary(
            "Operation cancelled by user", args.artifacts_dir,
        )
        _append_backfill_warning(
            minimal.warnings, "fatal-abort: Operation cancelled by user",
        )
        minimal.write(safe_join(args.artifacts_dir, "run_summary.json"))
        raise  # re-raise so main()'s handler owns exit code 130
    ```
  - Site D5 shape:
    ```python
    except Exception as e:
        minimal = create_minimal_summary(str(e), args.artifacts_dir)
        _append_backfill_warning(
            minimal.warnings,
            f"fatal-abort: {normalize_error_message(str(e))}",
        )
        minimal.write(safe_join(args.artifacts_dir, "run_summary.json"))
        raise  # re-raise so main()'s handler owns exit code 1
    ```
  - **Re-raise discipline**: after writing the artifact with the discriminator entry, Sites D4 and D5 `raise` to let `main()`'s handlers at `cli.py:2180-2191` (KeyboardInterrupt → exit 130) and `cli.py:2193-2203` (Exception → exit 1) own exit-code semantics. `main()`'s guards `if not summary_path.exists()` at `cli.py:2184` and `cli.py:2197` see the artifact already on disk and skip their own fallback write. This preserves the invariant (INV-8) while retaining exit-code ownership in `main()`.
  - **Handler ordering inside `cmd_backfill_comments`**: D1 → D2 → D3 → D4 → D5 (ConfigurationError, DatabaseError, ExtractionError are specific; KeyboardInterrupt is a specific built-in; Exception is the catch-all and MUST be last).
  - FR refs: **FR-019a–d**, **plan §4 Sites D4/D5**. INV refs: **INV-8**.
  - Gates: **QG-40**, **QG-41**.
  - Tests locking this: **#34** `test_discriminator_invariant_holds_for_all_backfill_states` — **Pass 2 lock**: #34's parametrize corpus expands from 5 to **9 backfill states + 1 extract state = 10 cases** to cover every code site directly. The 9 backfill states are:
    1. `loop_success` (Site C only; P≥1, F=0)
    2. `partial_failure` (Sites A × F + C; P≥1, F≥1)
    3. `empty_selection` (Site C with T=0)
    4. `legacy_schema_noop` (Site B)
    5. `fatal_config_error` (Site D1 via injected ConfigurationError)
    6. `fatal_database_error` (Site D2 via injected DatabaseError)
    7. `fatal_preloop_extraction_error` (Site D3 via injected ExtractionError from `test_connection`)
    8. `fatal_ctrl_c` (Site D4 via raised KeyboardInterrupt mid-fixture)
    9. `fatal_unexpected_exception` (Site D5 via raised generic Exception mid-fixture)

    Plus one extract-flow state (`extract_success`) asserting `is_backfill_artifact()` returns False. Corpus locked as a module-level tuple of (name, state_builder_fn) pairs — deterministic collection count = 10. This makes #34 the single test that fails if any of Sites A/B/C/D1/D2/D3/D4/D5 is unwired. No additional dedicated D4/D5 test method needed — #34 covers all 8 sites + extract-negative directly. The AST parity test #19a remains the emission-mechanism lock.

**Checkpoint (end of Phase 2)**: `cmd_backfill_comments` is end-to-end functional. All 8 discriminator-emission sites wired via `_append_backfill_warning` (T006). All fatal handlers (D1–D5) in place. Per-PR commit boundary preserved. Extract still unchanged (T003 diff reviewed). `mypy`/`ruff`/existing pytest suite all pass. **No new tests have been added yet** — the test surface is Phase 3.

---

## Phase 3: Test surface + terminal ratchet-bump commit

⚠️ **SINGLE-COMMIT LOCK**: Tasks T016–T020 MUST land in a **single git commit** together with the `.test-floor-contract.json` bump. No partial-delta bumps. No test additions in any other commit. QG-43 per-commit `floor_delta == actual_delta` holds by construction for this single commit.

**Rationale**: QG-43 enforces "commit that adds N tests MUST bump the floor by exactly N in the same commit"; by bundling every new test into one commit paired with one `.test-floor-contract.json` update, the rule is trivially satisfied without per-commit delta arithmetic.

- [ ] **T016** Author `tests/unit/test_backfill_comments.py` (32 method declarations) — plan §5 File 1 verbatim
  - File: `tests/unit/test_backfill_comments.py` (NEW).
  - Test classes and methods: enumerated in plan §5 File 1 table (rows **#1 – #32**, plus row **#19a**).
  - Fixture pattern: real SQLite on `tmp_path` (mirrors `tests/unit/test_extract_comments.py` setup) with full migration chain applied; `MagicMock`-backed `ADOClient`; `PRRepository` wired against the real SQLite.
  - **Principle XXVI compliance (every method)**:
    - Unconditional `def test_*` at module scope or class scope.
    - No `@pytest.mark.skipIf(…)` or `@pytest.mark.skip(…)`.
    - No runtime `pytest.skip(…)` at collection time (inside a test body is fine if the body is reached during execution, not collection).
    - No `if sys.version_info < …:` wrappers around the `def`.
    - No decorators that conditionally add or remove tests.
  - **Parametrization corpora locked as module-level tuples** (deterministic collection count):
    - #11 `_PROJECTS_CORPUS = (("", []), ("A", ["A"]), ("A,B", ["A", "B"]), (" A , B ", ["A", "B"]), ("A,,B", ["A", "B"]), ("A ,B", ["A", "B"]), (",A,", ["A"]), ("  ", []))` — 8 cases.
    - #12 `_DATE_CORPUS = (("2024-01-01", True), ("2024-12-31", True), ("2024-13-01", False), ("2024-02-30", False), ("2024-00-01", False), ("", False), ("not-a-date", False), ("2024/01/01", False), ("01-01-2024", False), ("2024-1-1", False))` — 10 cases.
  - Special-case tests:
    - **#13** `TestDocsTreeUntouched::test_feature_branch_has_zero_diff_under_docs` — shells out via `subprocess.run` to `git diff --name-only <base-ref>..HEAD -- docs/`; asserts empty output. **Pass 2 lock — base-ref selection**: use `origin/main` (CI + local both have it) via `git merge-base origin/main HEAD` to get a stable base that's invariant to feature-branch rebasing. If `origin/main` is unavailable in the sandbox, fall back to `HEAD~N` where N is the commit count on the branch (derived via `git rev-list --count HEAD ^origin/main` if remote exists, else a conservative default). **Cross-OS**: cross-platform quoting uses the list form of `subprocess.run([...])` not `shell=True`. **Pass 3 finding**: `.subprocess-allowlist.json` (HEAD state) does NOT currently contain a `tests/unit/test_backfill_comments.py` entry; T016's implementation MUST add an entry `{"file": "tests/unit/test_backfill_comments.py", "line": <actual>, "code": "subprocess.run(", "reason": "Test helper: git diff --name-only on docs/ for FR-030g"}` in the SAME commit as T016 (the Phase 3 terminal commit).
    - **#19a** `TestBackfillWarningEmissionParity::test_discriminator_prefix_literal_appears_only_inside_helper` — AST scan of `src/ado_git_repo_insights/cli.py`. Visitor pattern per plan §4 implementation sketch: `ALLOWED_ENCLOSING_NAMES = {"_append_backfill_warning"}`, `ALLOWED_ASSIGNMENT_TARGETS = {"_BACKFILL_WARNING_PREFIX"}`, flags any other occurrence of `"backfill-comments: "` in a string constant with `(lineno, value)` violation records.
    - **#17 / #18 / #19** `TestNoImplicitSafetyClaims` — forbidden-keyword scan on `--help` output, captured log stream, and artifact `warnings` / `first_fatal_error` strings, respectively. **Pass 2 lock — regex forms** (case-insensitive, word-boundary):
      - Unconditional fail: `r'(?i)\bthread-safe\b'` and `r'(?i)\bconcurrent\b'` — any occurrence fails.
      - `atomic`: `r'(?i)(?<!per-PR )\batomic\b'` — passes only if immediately preceded by the literal `"per-PR "` (7 chars). Negative lookbehind catches any other prefix context.
      - `complete`: `r'(?i)(?<!per-PR )\bcomplete\b'` — passes only if preceded by `"per-PR "`. The contracts §2 description uses `"commit together"` (not `"complete"`) to describe transaction semantics, so `"complete"` appearing anywhere outside `"per-PR complete"` is a DB-wide claim and fails.
      - `resumable`: pattern `r'(?i)\bresumable\b'` requires a secondary qualifier check. Implementation: if any `resumable` match is found, also require the same text to contain `"per-PR commit boundary"` or `"FR-012"` or `"FR-013"` within 100 characters before or after the match. If no qualifier found, fail.
      - All four patterns compile at module scope (module-level `re.compile`) for deterministic test behavior.
  - FR refs: **FR-030 base, FR-030a–d, FR-030g–j, FR-031, FR-032, FR-033, plan §4**. INV refs: **INV-1 – INV-12** as applicable (see FR→test-row crosswalk in plan §5).
  - Gates: **QG-39** (cross-OS — no OS-specific constructs), **QG-42** (enterprise coverage), **QG-45** (cross-OS parity — no platform gating), **Principle XXVI**.

- [ ] **T017** [P] Author `tests/unit/test_run_summary_parity.py` (2 method declarations) — plan §5 File 2 verbatim
  - File: `tests/unit/test_run_summary_parity.py` (NEW).
  - Classes and methods: plan §5 File 2 (rows **#33** and **#34**).
  - **#33** `TestArtifactShapeParity::test_backfill_and_extract_artifacts_have_identical_shape` — drive extract against a controlled fixture (MagicMock ADO client, monkeypatched `get_tool_version`/`get_git_sha`, fixed `artifacts_dir` on `tmp_path`), drive backfill against a comparable controlled fixture. Load both emitted `run_summary.json`. Assert identical top-level key sets. Assert identical nested-object key sets for `date_range`, `counts`, `timings`. Assert identical per-field Python type shapes.
  - **#34** `TestArtifactShapeParity::test_discriminator_invariant_holds_for_all_backfill_states` — `@pytest.mark.parametrize` over **9 backfill states (one per Site A/B/C/D1/D2/D3/D4/D5 + empty-selection) + 1 extract state = 10 parametrized cases** (Pass 2 expansion). Corpus locked as module-level tuple:
    ```python
    _BACKFILL_ARTIFACT_STATES = (
        # Site C coverage (loop completed)
        ("loop_success",                    _build_loop_success_artifact),
        ("partial_failure",                 _build_partial_failure_artifact),     # Sites A + C
        ("empty_selection",                 _build_empty_selection_artifact),     # Site C with T=0
        # Site B coverage
        ("legacy_schema_noop",              _build_legacy_schema_artifact),
        # Fatal pre-loop Sites D1/D2/D3 (one state per site for direct coverage)
        ("fatal_config_error",              _build_fatal_config_artifact),        # Site D1
        ("fatal_database_error",            _build_fatal_database_artifact),      # Site D2
        ("fatal_preloop_extraction_error",  _build_fatal_extraction_artifact),    # Site D3
        # Mid-run Sites D4/D5 (direct coverage; KeyboardInterrupt + unexpected Exception)
        ("fatal_ctrl_c",                    _build_fatal_ctrl_c_artifact),        # Site D4
        ("fatal_unexpected_exception",      _build_fatal_exception_artifact),     # Site D5
    )
    _EXTRACT_ARTIFACT_STATES = (("extract_success", _build_extract_success_artifact),)
    ```
    Assert `is_backfill_artifact(artifact) is True` for all 9 backfill states and `is_backfill_artifact(artifact) is False` for the extract state. **This is the single test that fails if any of Sites A/B/C/D1/D2/D3/D4/D5 is unwired.** Every Site has a dedicated parametrize case that exercises it directly; no Site is covered transitively only.
  - Principle XXVI compliance (see T016 discipline).
  - FR refs: **FR-025b**, **FR-030e**, **plan §4** discriminator invariant (**INV-8**).
  - Gates: **QG-42**, **Principle XXVI**.

- [ ] **T018** [P] Author `tests/unit/test_run_summary_snapshot.py` (3 method declarations) — plan §5 File 3 verbatim
  - File: `tests/unit/test_run_summary_snapshot.py` (NEW).
  - Classes and methods: plan §5 File 3 (rows **#35**, **#36**, **#37**).
  - **#35** `TestExtractProducerGoldenSnapshot::test_RunSummary_to_dict_matches_golden` — construct `RunSummary` with deterministic field values (monkeypatch `get_tool_version()` → fixed string, `get_git_sha()` → fixed string, timings/counts → fixed numbers); **Pass 2 lock — assertion mechanism**: call `run_summary.write(tmp_path / "actual.json")` and compare bytes against `tests/unit/goldens/run_summary_to_dict.json` via `Path.read_bytes() == Path.read_bytes()`. This auto-matches whatever serialization `write()` uses; no risk of golden-vs-write kwargs drift.
  - **#36** `TestExtractProducerGoldenSnapshot::test_create_minimal_summary_matches_golden` — call `create_minimal_summary("test fatal error", Path("run_artifacts"))` with monkeypatched version/sha; serialize; assert equals golden. **This test locks `warnings=[]` as the helper's default return** — the FR-025a compliance tooth behind Sites D1–D5's caller-side mutation approach.
  - **#37** `TestExtractProducerGoldenSnapshot::test_normalize_error_message_matches_golden` — `@pytest.mark.parametrize` over 5 corpus entries (URL with query params, plain URL, long string, short string, mixed). Corpus locked as module-level tuple:
    ```python
    _NORMALIZE_CORPUS = (
        ("https://dev.azure.com/org/_apis/git?x=1", _GOLDEN_NORMALIZED_URL_WITH_QUERY),
        ("https://dev.azure.com/org/_apis/git",     _GOLDEN_NORMALIZED_URL_PLAIN),
        ("a" * 1000,                                _GOLDEN_NORMALIZED_LONG),
        ("short",                                    "short"),
        ("prefix https://dev.azure.com/org x=1 suffix", _GOLDEN_NORMALIZED_MIXED),
    )
    ```
    Each case asserts `normalize_error_message(input) == expected`.
  - Principle XXVI compliance (see T016 discipline).
  - FR refs: **FR-025c**, **FR-030f**.
  - Gates: **QG-42**, **Principle XXVI**.

- [ ] **T019** [P] Commit golden JSON files under `tests/unit/goldens/`
  - Files (NEW):
    - `tests/unit/goldens/run_summary_to_dict.json`
    - `tests/unit/goldens/create_minimal_summary.json`
    - `tests/unit/goldens/normalize_error_message.json`
  - **Pass 2 lock — generation mechanism**: at implementation moment, use a throwaway script (e.g., `scripts/generate_058_goldens.py` — kept out of the final commit) that instantiates each deterministic-fixture input, calls `RunSummary.write(output_path)` (and `create_minimal_summary(...).write(...)` for golden #2, and `normalize_error_message(corpus_input)` for each golden #3 corpus entry), and emits the resulting bytes under `tests/unit/goldens/`. File encoding: whatever `RunSummary.write()` uses natively (UTF-8, no BOM, LF line endings on write). `.gitattributes` enforces LF for committed JSON regardless of OS. These 3 goldens ARE committed (unlike QG-05's dynamic fixtures) because they lock the observable behavior of stable producer helpers, not of varying pipeline outputs.
  - Commit in the same terminal commit as T016–T018 + T020.
  - FR refs: **FR-025c**, **FR-030f**.
  - Gates: **QG-42**.

- [ ] **T020** **TERMINAL COMMIT** — measure + bump `.test-floor-contract.json::python::min_collected`
  - File: `.test-floor-contract.json`.
  - Authoritative measurement command (the ONLY source of truth for the delta number):
    ```bash
    python scripts/check_ratchet_bump.py \
      --base-ref origin/main \
      --junit-extension extension/test-results.xml
    ```
  - Procedure (this is the commit-composition recipe — not an optional step):
    1. Stage all Phase 3 files together (T016 + T017 + T018 + T019 + current `.test-floor-contract.json`).
    2. Run the measurement command with the staged change in place; it prints Python's observed collected-item delta (call it `Δ`).
    3. Edit `.test-floor-contract.json::python::min_collected` from `1814` to `1814 + Δ` in the staged working tree.
    4. Re-run the measurement command; confirm `floor_delta == actual_delta` for this commit (QG-43 per-commit check passes).
    5. Commit the staged diff as a single atomic commit with subject describing the feature + signed "Sloppy Claude" per memory discipline.
  - **Planning estimate (non-authoritative, included only for reviewer sanity)**: after Pass 2 expansion of #34 to 10 parametrized cases, the refined calculation (34 non-parametrized × 1 + #11 × 8 + #12 × 10 + #34 × 10 + #37 × 5) suggests `Δ ≈ +67`, giving a new floor of `~1883` (floor pre-feature: 1816 after commit `740810fd` bumped 1814 → 1816 for the #289-fix's +2 tests). Plan §5's estimate of `+51 to +61` predated Pass 2's #34 expansion. The measurement command overrides any estimate; no number is hardcoded in this task.
  - FR refs: **QG-43 same-commit rule**, **QG-44 single source of truth for floor**, **QG-45 cross-OS Python floor is the cross-platform minimum** (ensured by collection-stability from Principle XXVI applied in T016–T018), **VR-30 ratchet-bump parity**.
  - Gates: **QG-43 BINDING**, **QG-44 PASS**, **QG-45 PASS**, **VR-30 BINDING**.

**Checkpoint (end of Phase 3)**: new test files + floor bump all in one commit. Full pytest suite green. `scripts/check_ratchet_bump.py --base-ref origin/main` reports `floor_delta == actual_delta`. No other commit on the branch has touched `.test-floor-contract.json` or any `tests/unit/test_backfill_comments.py` / `test_run_summary_parity.py` / `test_run_summary_snapshot.py` / `tests/unit/goldens/` file.

---

## Phase 4: Pre-merge verification (VR-28 + quickstart smoke)

- [ ] **T021** [P] Execute all 6 quickstart smoke tests ([quickstart.md](./quickstart.md))
  - Scenarios: (1) happy-path drain of a seeded uncovered corpus, (2) resumability (re-run drains zero), (3) `--limit` bounds a single invocation, (4) partial-failure artifact contains both per-PR and loop-complete entries, (5) legacy-schema DB produces skip artifact, (6) empty-selection produces loop-complete artifact with zero entries. Exact commands in `quickstart.md` §§1–6.
  - Outcome: every scenario produces the expected exit code + artifact shape.
  - **No file writes under `docs/`** (FR-029 / FR-029a) — results may be captured in a transient local note, not committed.
  - FR refs: **FR-032** (end-to-end). **VR-28** readiness.

- [ ] **T022** Run the authoritative pre-push gate chain
  - Command: `python scripts/run_repo_hook.py pre-push`.
  - Chain executed (sequential): **version-guard** (QG-51, fast-fail) → **authoritative preflight** (`scripts/run_pr_preflight.py`) which runs cross-OS collection parity (**QG-45**), ratchet-bump guard (**QG-43**), suppression audit (**QG-41**), mypy (**QG-40 / VR-03**), ruff (**VR-02**), pytest (**VR-04 / QG-42**), extension `format:check` (**QG-55 / VR-02a**), gitleaks (**QG-56**), `test:ci` (**QG-49**).
  - **Forbidden overrides**: no `--no-verify` (QG-38), no `--allow-local-degraded` (QG-56), no `[*-acknowledged]` bypass markers (QG-50 — this feature introduces no condition that would need one).
  - Required exit code: `0`.
  - **Pass 2 lock — recovery procedure**: on any pre-push failure, diagnose the root cause and fix in place:
    - If the failure is inside the terminal Phase 3 commit (T016–T020): amend the terminal commit with the fix. Rerun `check_ratchet_bump.py` to confirm floor_delta still equals actual_delta. Single-commit-ratchet lock preserved.
    - If the failure originates in a Phase 1/2 commit (e.g., mypy error, suppression drift, formatting): rebase interactively onto the failing commit, amend it with the fix, resolve any subsequent rebase conflicts. This preserves per-commit cleanliness (QG-43 per-commit rule), at the cost of rewriting branch history prior to push.
    - If the failure requires adding a NEW test as part of the fix (rare): that test counts as a new test for its containing commit under QG-43 — the same commit must carry its own `+1` floor bump. Do NOT place the new test in an unrelated commit. Add it to whichever commit introduces the code the test covers, and bump `.test-floor-contract.json` in that same commit.
    - **Forbidden**: `--no-verify` bypass, `[ratchet-realignment]` subject-line markers (this feature introduces no condition that warrants one), or skipping the pre-push gate entirely.
  - FR refs: **VR-28**, **VR-29**, **VR-30**, **QG-43**, **QG-45**.
  - Gates: **VR-28 BINDING** (final pre-merge readiness signal).

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1** (T001–T007) has no dependency on Phase 2/3/4; must complete before Phase 2 begins. Within Phase 1, T004–T007 are marked `[P]` (different files or non-overlapping regions of `cli.py`); T001 → T002 → T003 is strictly sequential (T001 declares the dataclass used by T002's signature; T002 declares the helper used by T003's call site).
- **Phase 2** (T008–T015) depends on Phase 1 complete. Within Phase 2, T008/T009 are [P] (two different insertion points in `cli.py`, no order dependency); T010 is [P] (different helper function). T011–T015 are strictly sequential (same function `cmd_backfill_comments`, progressively filled in).
- **Phase 3** (T016–T020) depends on Phase 2 complete — the tests reference symbols (`_fetch_and_upsert_threads_for_pr`, `_BACKFILL_WARNING_PREFIX`, `cmd_backfill_comments`, etc.) that must exist before the test module imports parse.  Within Phase 3, T016/T017/T018/T019 are [P] (4 different files); T020 is strictly last within Phase 3 (needs the test files staged to measure the delta).
- **Phase 4** (T021–T022) depends on Phase 3 complete. T021/T022 are [P] in principle but T022 is the binding pre-push gate — run T022 last.

### Single-commit lock (T016–T020)

These 5 tasks MUST land in a single atomic git commit. The commit composition recipe is spelled out in T020's procedure. No partial splits, no intermediate commits, no amended-upstream shuffling.

### Intermediate-commit cleanliness

Every commit on this branch — including Phase 1 and Phase 2 intermediate commits — MUST independently pass:

- `python scripts/run_repo_hook.py pre-commit`
- `mypy src/ tests/ scripts/ .github/scripts/`
- `ruff check . && ruff format --check .`
- existing pytest suite (18-method `test_extract_comments.py` bit-for-bit unchanged + full 1814-collected-item suite otherwise)

No temporary relaxations. No `[version-override-acknowledged]` / `[ratchet-realignment]` / `[threshold-update]` markers on this branch — none apply.

### Parallel-work grid (where `[P]` is allowed within a phase)

| Phase | Parallel tasks | Sequential tasks |
|---|---|---|
| 1 | T004, T005, T006, T007 | T001 → T002 → T003 |
| 2 | T008, T009, T010 | T011 → T012 → T013 → T014 → T015 |
| 3 | T016, T017, T018, T019 | T020 (last) |
| 4 | T021 | T022 (last) |

### Cross-task decision-drift prevention

- T001 + T002 + T006 + T007 must all pre-declare their public symbols before T008–T015 references them. The plan's §1 helper-signature drafting (plan.md:189–218) is the ground truth for each helper's name and signature; tasks reference plan text, not each other.
- T004 + T005 (shared filter parsers) must be complete before T008 references the symbols in argparse wiring and before T010 passes filter values into the SQL.
- T002 must be complete before T003 (extract's refactor depends on the helper existing).

---

## Constitution Check (per-task-category traceback — matches plan's post-design gate evaluation)

| Task | Primary Principle(s) / Gate(s) | Binding? | Test method(s) locking |
|---|---|---|---|
| T001 FetchOutcome | QG-40, INV-7 | P | structural + #8, #20–24 |
| T002 `_fetch_and_upsert_threads_for_pr` | FR-015a/b, FR-025a, QG-40, QG-49 | **B** | FR-034 regression + #20–24 |
| T003 extract refactor | FR-025, FR-025a, FR-034 | **B** | `test_extract_comments.py` 20 methods (incl. 2 post-#289-fix tests at lines 163, 201) |
| T004 `_parse_projects_list` | FR-004, FR-025a, FR-030d | P | #11 |
| T005 `_parse_iso_date` | FR-005, FR-025a, FR-030d | P | #12 |
| T006 `_append_backfill_warning` | FR-019a–d, plan §4, QG-49 | **B** | #19a |
| T007 `_legacy_schema_missing_thread_tables` | FR-017, FR-028, INV-11 | P | #15, #16, #28 |
| T008 backfill argparse | FR-020–024a, Issue #285, INV-9, INV-12 | **B** | #17, #29–32 |
| T009 main() dispatch | FR-020, QG-49 | P | transitively by #25–28 |
| T010 selection SQL | FR-002–006, FR-011a, INV-1–5 | **B** | #1–7 |
| T011 cmd skeleton + D1/D2/D3 | FR-019a–d, plan §4 Sites D1–D3, INV-8 | **B** | #34 |
| T012 pre-loop + Site B | FR-017, FR-017a, FR-028, INV-8, INV-11 | **B** | #15, #16, #28 |
| T013 opening anchor + snapshot | FR-018a, FR-011a, INV-4, INV-5 | P | #7, #25–28 |
| T014 per-PR loop + A + C | FR-012, FR-013, FR-013a, FR-014, FR-015, FR-016, FR-018b, FR-018c, FR-019a–d, INV-6, INV-8 | **B** | #8–10, #14, #20–24, #25–28, #33–34 |
| T015 D4/D5 fatal handlers | FR-019a–d, plan §4 Sites D4/D5, INV-8 | **B** | #34 |
| T016 test_backfill_comments.py | QG-42, Principle XXVI, FR-030 base, FR-030a/b/c/d/g/h/i/j, FR-031, FR-032, FR-033, plan §4 | **B** | self (32 + #19a methods) |
| T017 test_run_summary_parity.py | FR-025b, FR-030e, plan §4, QG-42, Principle XXVI | **B** | self (#33, #34) |
| T018 test_run_summary_snapshot.py | FR-025c, FR-030f, QG-42, Principle XXVI | **B** | self (#35, #36, #37) |
| T019 goldens | FR-025c, FR-030f | P | paired with T018 |
| T020 ratchet bump | QG-43, QG-44, QG-45, VR-30 | **B** | `check_ratchet_bump.py` |
| T021 quickstart smoke | FR-032, VR-28 | P | self |
| T022 pre-push gate chain | VR-28, VR-29, VR-30, QG-43, QG-45, QG-40, QG-41, QG-42, QG-49, QG-51, QG-55, QG-56 | **B** | composite |

*(Every task traces to at least one FR or INV or QG or VR, plus a named test method or measurement command. No orphans.)*

### Complexity Tracking

*(Empty — consistent with plan.md. Every architectural decision was locked at spec Pass 4 or plan Pass 2/2.5; no deferred choice appears in any task.)*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| *(none)* | | |

---

## Scope-exclusion assertions (re-stated at task-draft time so no task accidentally widens scope)

- ❌ No task modifies `tests/unit/test_extract_comments.py` (T003 refactor guarantees it still passes bit-for-bit; FR-034 lock).
- ❌ No task regresses the #289 fix (commit `740810fd`). Extract's pre-iteration snapshot read (cli.py:517-526) and Case 2 sub-decision (cli.py:627-640) are preserved bit-for-bit by T002/T003. Header lock #5 is the binding rule.
- ❌ No task writes under `docs/`, `extension/`, `tasks/`, `.github/workflows/`, `sample-pipeline.yml`, `insights-verification-test.yml`, or any Azure DevOps task manifest. FR-030g test method #13 enforces mechanically.
- ❌ No task introduces `typing.Any` (QG-40). All new annotations use precise types.
- ❌ No task introduces `# noqa` / `# type: ignore` / `// eslint-disable` / `// @ts-ignore` (QG-41). No new suppressions.
- ❌ No task introduces platform-conditional test definitions (QG-46 trivially N/A — feature adds no OS-specific code paths).
- ❌ No task carries a bypass marker on a commit subject line (QG-50). No version-field changes (QG-51). No coverage-threshold changes (QG-52).
- ❌ No task amends a pushed commit to alter its floor-delta relationship to `.test-floor-contract.json` (QG-43 per-commit invariant).

---

## Planning cadence status (tasks phase)

- **Pass 1 (draft from plan)**: **COMPLETE**.
- **Pass 2 (hardening)**: **COMPLETE**. Every Pass-1 inline `Pass 2 hardening` note has been resolved into a specific locked decision:
  - T005 error-translation site → argparse wrapper `_parse_iso_date_argtype` (exit 2 on malformed input).
  - T008 placement → elif immediately after `extract` in main() dispatch.
  - T012 execution order → DB connect → legacy-schema check → load_config → test_connection → loop.
  - T013 test_connection probe-project fallback chain (4-level: args.projects / config.projects / DB sample / skip).
  - T014 terminal summary → subcommand-specific `logger.info` + shared `print_final_line()`, mirroring extract's pattern.
  - T015 #34 corpus → 9 backfill states + 1 extract state = 10 parametrized cases; one state per Site + 1 extract-negative.
  - T016 #13 base-ref → `git merge-base origin/main HEAD`; list-form subprocess call; cross-OS via `.subprocess-allowlist.json`.
  - T016 #17/#18/#19 forbidden-keyword regex forms locked (negative-lookbehind for atomic/complete; proximity-based qualifier check for resumable).
  - T018 #35 golden assertion → byte-equality of `write()` output; no separate serialization kwargs.
  - T019 golden generation → throwaway script invokes `RunSummary.write()`; UTF-8/LF via `.gitattributes`.
  - T020 recovery procedure → amend-in-place; per-commit QG-43 rule; no `--no-verify`, no bypass markers.
  - T014 is NOT split at Pass 2; Pass 3 code-validation re-evaluates if the real diff exceeds ~100 lines, splitting into T014a (loop body + Sites A/C) and T014b (review-timestamp hook + RunSummary construction) only if warranted.
  - **Ratchet estimate refresh**: #34 grew from ~6 to **10 parametrized cases** (9 backfill states + 1 extract). Other parametrize counts unchanged (#11: 8, #12: 10, #37: 5). Refined collected-items delta: 34 non-parametrized × 1 + 8 (#11) + 10 (#12) + 10 (#34) + 5 (#37) = **67** new items → new floor ≈ **1816 + 67 = 1883**. Authoritative number comes from `check_ratchet_bump.py` at T020.
- **Pass 3 (code-validation)**: **COMPLETE** (at HEAD `4055541e`). Validated:
  - All `cli.py` line numbers match HEAD: insertion point 163 ✓, pre-iteration snapshot 517-526 ✓, stamp block 621-647 with Case 2 sub-decision 627-640 ✓, end-of-loop commit 672 ✓, fatal handlers 875-897 ✓, `_dropped_threads_all_stored` 979-1015 ✓, summary_path 2154 ✓, main's D4/D5 handlers 2180-2203 ✓. cli.py still 2207 LOC.
  - Shared helpers all exist at cited paths: `safe_join` (utils/path_security.py:58), `normalize_error_message` (utils/run_summary.py:19), `RunCounts`/`RunTimings`/`RunSummary` (utils/run_summary.py:43/52/62), `get_tool_version` (147), `get_git_sha` (238), `create_minimal_summary` (261), `_backfill_review_timestamps_if_needed` (cli.py:942).
  - Exception class imports traced: `ConfigurationError` (config.py:19), `DatabaseError` (database.py:27), `ExtractionError` (extractor/ado_client.py:105 — NOT utils/safe_extract.py:47). T011 body annotated with the disambiguation.
  - `ADOClient`, `DatabaseManager`, `PRRepository` all exist at cited paths.
  - Test fixture pattern `test_extract_comments.py` uses real SQLite on tmp_path + MagicMock ADOClient + PRRepository. Backfill test file T016 mirrors this pattern; 20 methods in the regression lock confirmed.
  - `AdoThread` lives in `types.py:143` (TypedDict), already TYPE_CHECKING-imported in cli.py:28. cli.py has `from __future__ import annotations` — no runtime import needed. T001 body updated.
  - The 2 post-#289-fix tests at test file lines 163 (preserve-when-null→SET) and 201 (operator-reset recovery) remain unmodified — primary teeth against Lock-5 regression.
  - `scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml` accepts the flags T020 references; verified via `--help` output. Current measurement: floor=1816, actual=1816 (Pass 3 baseline).
  - `.subprocess-allowlist.json` does NOT currently have a `tests/unit/test_backfill_comments.py` entry; T016 MUST add one for test #13's `subprocess.run(["git", …])` call in the same commit. T016 body updated.
  - No cli.py line drift since commit `740810fd` (the #289 fix); zero new commits affecting cli.py since Pass 1 completed.
  - **Pass 3 finding count: 3 refinements** (AdoThread import path + ExtractionError disambiguation + subprocess allowlist entry requirement). All applied to tasks.md inline.
  - **T014 split decision**: Pass 3 estimates the real T014 diff at ~60-80 lines (loop body ~40 + RunSummary construction ~25-40). Under the ~100-line threshold. T014 stays as one task.
- **Pass 4 (readiness-for-implementation)**: **COMPLETE**. Walked all 22 tasks against the 5 Pass 4 criteria:
  - **Self-contained**: every task body contains file path + function/method name + acceptance criteria without requiring cross-reference to plan.md. Spot-verified T001 (dataclass shape + imports), T008 (argparse wiring + Pass 2 elif placement lock), T014 (full code pseudo-shape with Case 2 sub-decision), T016 (32 method declarations with corpus locks), T020 (commit-composition recipe). ✓
  - **No cross-task decision drift**: dependent tasks consistent. T005 wrapper + T008 `type=_parse_iso_date_argtype` ✓. T011 outer try + T012 DB-connect-first ordering ✓. T014 Sites A+C + T015 Sites D4+D5 + T017 #34's 10-case corpus covers all 9 backfill sites ✓. T018 #35 byte-equality + T019 golden generation via `write()` round-trip ✓.
  - **Dependencies named explicitly**: Parallel-work grid in the "Dependencies & Execution Order" section lists `[P]`-parallel vs sequential per phase. Phase ordering explicit (Phase 1 → 2 → 3 → 4). Single-commit lock on T016-T020 restated.
  - **Acceptance criteria testable in isolation**: each task's "Tests locking this" list names specific method(s) in plan §5 that assert the acceptance. T020's acceptance is `check_ratchet_bump.py` exit 0; T022's is `run_repo_hook.py pre-push` exit 0. Every task's criterion is checkable without running subsequent tasks (subject to the stated dependencies).
  - **Ratchet-bump is terminal**: T020 is the last task in Phase 3 and the single-commit lock bundles T016-T020. ✓
  - **Pre-push gate is final**: T022 is the last task overall; VR-28/29/30/QG-43/45 all checked via one command. ✓
- **/speckit.analyze**: pending — final cross-artifact consistency sweep across spec.md + plan.md + tasks.md. Runs as the next step.

### Ready-for-implementation signature

At HEAD `08cf7b10`, all 4 planning passes complete. Spec (Pass 1-4 hardened), plan (Pass 1+2+2.5 locked), tasks.md (Pass 1-4 locked). Three feature-branch commits (740810fd #289 fix, 79d49b14 planning refresh, 84148695 tasks Pass 1, 4055541e tasks Pass 2, 08cf7b10 tasks Pass 3) staged before implementation begins. Zero deferred architectural decisions. Complexity Tracking empty. Implementation may proceed in the order T001 → T002 → T003 → [P: T004, T005, T006, T007] → [P: T008, T009, T010] → T011 → T012 → T013 → T014 → T015 → [P: T016, T017, T018, T019 all bundled with T020 in one terminal commit] → [P: T021] → T022.

---

## Notes

- `[P]` tasks within a phase can be worked in parallel; tasks without `[P]` have at least one same-file / same-function dependency on an earlier task in the phase.
- Every requirement-traceback claim in this document was checked against plan.md and the constitution at draft time; Pass 3 re-validates against HEAD.
- Pass 2 (hardening) is now complete — every inline "Pass 2 hardens…" annotation from the Pass 1 draft has been resolved into a locked decision (see Planning Cadence Status above for the one-line summary per resolved spot).
- Signing discipline on every commit this feature produces: "Sloppy Claude" per memory. Never `--no-verify`. No push until user says push.
