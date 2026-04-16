# Data Model: Historical PR Thread Backfill Subcommand (058)

**Phase**: 1 (Design & Contracts)
**Source spec**: [spec.md](./spec.md) (4-pass hardened)
**Companion docs**: [plan.md](./plan.md), [research.md](./research.md), [contracts/cli-subcommand.md](./contracts/cli-subcommand.md)

This document enumerates every entity, dataclass, state-machine, and invariant the backfill subcommand operates on. No new database table, column, or index is introduced — backfill uses only the schema that already exists on HEAD (FR-027).

## 1. Existing domain entities (unchanged by this feature)

### 1.1 `pull_requests` row (read-only input to selection)

Columns this feature reads (other columns exist but are not touched by backfill):

| Column | SQL type | Meaning for backfill | Constraint for selection |
|---|---|---|---|
| `pull_request_uid` | TEXT (PK) | Stable identifier (`repository_id` + `pull_request_id`); used as tie-break key in ordering; used as iteration identifier in FR-018b progress lines and FR-019b failure entries | Required not-null |
| `pull_request_id` | INTEGER | ADO PR identifier; passed to `ADOClient.get_pr_threads(... pull_request_id=...)` | Required |
| `repository_id` | TEXT | ADO repository identifier; passed to `ADOClient.get_pr_threads` | Required |
| `project_name` | TEXT | Used by `--projects` filter matching (case-sensitive exact match, FR-004); used as key in `per_project_status` artifact field | Required |
| `closed_date` | TEXT (ISO-8601) | Primary sort key (ASC); compared against `--since`/`--until` in half-open `[since, until)` interval | Required non-null |
| `status` | TEXT | Filtered to `'completed'` (FR-002) | Required |
| `comments_extracted_at` | TEXT NULL | **Coverage marker** — the 3-state field whose value determines selection eligibility and whose transitions are the subject of FR-015 | Selection requires `IS NULL`; see §2 for state machine |

Source: `src/ado_git_repo_insights/persistence/migrations.py:78-92` (`comments_extracted_at` column added in a prior migration); PR schema defined in earlier migrations.

### 1.2 `pr_threads` row (write target via helper)

Composite PK `(pull_request_uid, thread_id)` (migrations.py:274-349). Helper upserts via `repo.upsert_thread` (existing method at `cli.py:562-570` usage site).

### 1.3 `pr_comments` row (write target via helper)

Composite FK → `pr_threads(pull_request_uid, thread_id)` (migrations.py:226-249). Helper upserts via `repo.upsert_comment` (existing method at `cli.py:586-596` usage site).

### 1.4 `users` row (write target via helper)

Helper upserts via `repo.upsert_user` (existing method at `cli.py:580-584` usage site) before each `pr_comments` insert to preserve FK integrity.

### 1.5 Legacy-schema detection (FR-017)

Pre-loop check: both `pr_threads` and `pr_comments` tables MUST exist in the database's `sqlite_master`. Pattern (mirrors existing extract-flow check at `cli.py:807-813`):

```python
def _legacy_schema_missing_thread_tables(db: DatabaseManager) -> bool:
    threads_exists = db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='pr_threads'"
    ).fetchone() is not None
    comments_exists = db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='pr_comments'"
    ).fetchone() is not None
    return not (threads_exists and comments_exists)
```

Returns `True` → backfill short-circuits into the FR-017 legacy-schema no-op path (emits the `legacy-schema-skip` warning, writes the full-shape `success` artifact, exits zero).

## 2. Coverage marker state machine (FR-002, FR-015)

The `pull_requests.comments_extracted_at` column is a 3-state field:

```
                    ┌─────────────────────┐
          select ──►│   NULL / unset      │── truncation-clear ──┐
                    │ (selection eligible)│                      │
                    └──────────┬──────────┘                      │
                               │ backfill-iteration              │
                               │ ok + (not truncated             │
                               │       or dropped-stored)        │
                               ▼                                 │
                    ┌─────────────────────┐                      │
                    │ ISO-8601 timestamp  │                      │
                    │(selection excluded) │                      │
                    └──────────┬──────────┘                      │
                               │                                 │
                               │ extract-iteration:              │
                               │ truncation-clear                │
                               ▼                                 │
                    ┌─────────────────────┐                      │
                    │   NULL / cleared    │◄─────────────────────┘
                    │ (selection eligible)│
                    └─────────────────────┘
```

The two NULL states (never-set vs cleared-after-truncation) are indistinguishable at the column level — both satisfy `IS NULL` and are selected on the next run. This is intentional (FR-015 truncation-clear branch: "will be reselected on the next run (FR-002)").

### 2.1 Backfill's per-PR transitions (simplified 2-outcome rule, FR-015a)

| Pre-iteration state | Fetch outcome | Post-iteration state | Outcome Taxonomy |
|---|---|---|---|
| NULL | `FetchOutcome(status="ok", truncated=False)` | ISO-8601 timestamp (set) | Processed, Newly Covered |
| NULL | `FetchOutcome(status="ok", truncated=True, dropped_threads=[all_stored_and_current])` | ISO-8601 timestamp (set) | Processed, Newly Covered |
| NULL | `FetchOutcome(status="ok", truncated=True, dropped_threads=[at_least_one_missing_or_stale])` | NULL (unchanged; no-op update not executed) | Processed (but not Newly Covered); reselected next run |
| NULL | `ExtractionError` raised (caught by caller) | NULL (rollback restores pre-iteration state) | Failed; reselected next run |

### 2.2 Forbidden transition (FR-015 preserved-unset)

The transition `NULL → NULL (unchanged; Processed)` in the row "fetch completed without error, marker unchanged" is the latent infinite-loop bug. Backfill's rule prevents this by making the second row above (truncation-verified-complete) ALWAYS set the marker. The marker is unchanged ONLY on the third row (truncation-clear) and the fourth row (Failed), both of which are intentional outcomes on the Outcome Taxonomy.

### 2.3 Extract's per-PR transitions (3-outcome rule; preserved unchanged by this feature, FR-025)

Extract keeps its existing logic at `cli.py:610-628` — full-success set / truncation-preserve `pass` / truncation-clear NULL — without modification under this feature. Extract's observable behavior is locked by `tests/unit/test_extract_comments.py` (830 LOC, 20 tests, FR-034).

**Coverage precision on the preserve branch** (called out so that planning / tasks do not overclaim): the existing test `TestExtractCommentsStamping::test_truncated_fetch_preserves_stamp_when_dropped_stored` (lines 141-160) locks the preserve-when-**set** case — pre-iteration stamp non-null, post-iteration stamp non-null. **No existing test exercises the preserve-when-null case.** The current `pass` behavior on preserve-when-null is not locked as intentional by any assertion. This is a latent bug shape for any caller whose selection predicate filters on `comments_extracted_at IS NULL` (the shape backfill uses) — backfill sidesteps it by construction via the simplified 2-outcome rule (§2.1). Whether extract's own workload ever reaches preserve-when-null in practice is **not known** and **not audited by this feature**. The audit is tracked in follow-up issue [#289](https://github.com/oddessentials/ado-git-repo-insights/issues/289). Extract's preserve-when-null `pass` behavior MUST be left bit-for-bit unchanged by 058 tasks.

## 3. New dataclass: `FetchOutcome`

Placed in `cli.py` between the existing `_extract_comments` (cli.py:457-662) and `_dropped_threads_all_stored` (cli.py:960-996). Frozen dataclass; immutable by contract.

```python
@dataclass(frozen=True)
class FetchOutcome:
    """Outcome of a per-PR thread fetch + upsert operation.

    Carries enough information for the caller to apply its own
    coverage-marker stamp decision and commit/rollback policy.
    """
    status: Literal["ok", "failed"]
    truncated: bool
    dropped_threads: list[AdoThread]
```

| Field | Type | Meaning |
|---|---|---|
| `status` | `Literal["ok", "failed"]` | `"ok"` when the fetch completed without raising. `"failed"` is an internal enum value — the helper does NOT return `status="failed"`; it RAISES `ExtractionError` instead. The enum value exists in the shape for future-proofing (e.g., if a later feature decides to return a failure descriptor instead of raising). On HEAD, every non-raising return has `status="ok"` |
| `truncated` | `bool` | `True` iff `max_threads_per_pr > 0 AND len(all_threads) > max_threads_per_pr` (identical condition to current `pr_threads_truncated` at cli.py:528-530) |
| `dropped_threads` | `list[AdoThread]` | Slice `all_threads[max_threads_per_pr:]` — the threads the helper did NOT upsert because of the truncation cap. Empty list when `truncated=False`. Required input to `_dropped_threads_all_stored(db, pr_uid, dropped_threads)` for the caller's stamp decision |

**Why `Literal["ok", "failed"]` and not `Literal["ok"]`**: keeps the dataclass shape future-compatible without constraining HEAD's behavior. FR-030j's forbidden-claim scan does not flag `"ok"`/`"failed"` strings — they are machine tokens, not operator-facing prose.

**Why `frozen=True`**: the outcome is observed by the caller for decision-making; mutating it after return would make the caller's decision chain ambiguous.

## 4. Selection snapshot (FR-011a)

**Shape**: `list[BackfillSelectionRow]` where `BackfillSelectionRow` is a `TypedDict` exposing the columns the loop body consumes (see §1.1).

```python
class BackfillSelectionRow(TypedDict):
    """Row shape from the backfill selection query (plan §3)."""
    pull_request_uid: str
    pull_request_id: int
    repository_id: str
    project_name: str
    closed_date: str
```

**Lifecycle**:
1. **Constructed** exactly once, after legacy-schema detection returns False, by executing the plan §3 SQL query and fully draining the cursor via `cursor.fetchall()`. The resulting list's length is `T`.
2. **Iterated** via `for ordinal, row in enumerate(selection_snapshot, start=1):` so the `ordinal` (== `N`) is stable and monotonic across the run.
3. **Released** at the end of the loop; garbage-collected with the `cmd_backfill_comments` stack frame.

**Invariants**:
- `T = len(selection_snapshot)` is set once and never mutated.
- `N = ordinal` for any given row is set once per iteration; identical re-invocation from a drained fixture produces `T=0` (FR-032 resumability test).
- Rows inserted into `pull_requests` between step 1 and the end of the loop CANNOT enter the snapshot (already materialized; new rows appear only in a subsequent invocation's snapshot).

## 5. `RunSummary` artifact (unchanged schema; FR-019d value mapping)

The artifact schema is produced by `src/ado_git_repo_insights/utils/run_summary.py::RunSummary.to_dict()` (run_summary.py:83-109) and its dataclass definition (run_summary.py:61-76). **Backfill conforms to this schema; it does NOT modify it** (FR-025a).

### 5.1 Top-level schema (unchanged)

```jsonc
{
  "tool_version": string,
  "git_sha": string | null,
  "organization": string,
  "projects": string[],
  "date_range": { "start": string, "end": string },
  "counts": { "prs_fetched": int, "prs_updated": int, "rows_per_csv": object },
  "timings": { "total_seconds": float, "extract_seconds": float,
               "persist_seconds": float, "export_seconds": float },
  "warnings": string[],
  "final_status": "success" | "failed",
  "per_project_status": { [project_name: string]: string },
  "first_fatal_error": string | null
}
```

### 5.2 Backfill value mapping (FR-019d, locked)

See [plan.md §4 — Artifact composition](./plan.md#4--artifact-composition-and-the-first-class-discriminator-invariant-fr-019a-d-pre-plan-deliverable-2) for the full field-by-field table.

### 5.3 First-class artifact invariant (per user confirmation)

**Every `run_summary.json` artifact produced by the `backfill-comments` subcommand contains at least one `warnings` entry whose literal prefix is `"backfill-comments: "`.** The invariant binds 5 artifact states; each state has a specific required entry (see [plan.md §4 table](./plan.md#4--artifact-composition-and-the-first-class-discriminator-invariant-fr-019a-d-pre-plan-deliverable-2)).

## 6. Outcome Taxonomy (binding for FR-018, FR-019b, SC-004/013)

Authoritative vocabulary from spec.md's "Outcome Taxonomy" table:

| Term | Set-theoretic relation | Coverage-marker end state |
|---|---|---|
| Attempted | `= Processed + Failed` | any (unchanged if Failed) |
| Processed | per-iteration returned without raising | set (full-success, truncation-verified-complete) or cleared (truncation-clear) |
| Failed | per-iteration raised `ExtractionError` | unchanged from pre-iteration state |
| Newly Covered | `⊆ Processed`; marker transitioned from unset-or-cleared → set | set |
| Covered (post-run) | marker holds ISO-8601 timestamp at run end (irrespective of this run setting it) | set |

Invariants:
- `Attempted = Processed + Failed` (no third outcome).
- `Newly Covered ⊆ Processed` (must attempt without error to become newly covered).
- `Processed ⊉ Newly Covered`: truncation-clear branch counts as Processed but NOT Newly Covered.
- **No processed-but-no-progress state exists** — FR-015's truncation-verified-complete branch always produces a non-null stamp; preserved-unset is forbidden.

### 6.1 Surface-to-taxonomy mapping

| Surface | Term used | Notes |
|---|---|---|
| Terminal summary line (FR-018) | Processed / Failed | Primary count pair. Newly Covered MAY be appended as supplementary visibility but MUST NOT replace the Processed / Failed pair |
| FR-018a anchor `INFO` line | `T` (= Attempted, stable for the run) | Emitted immediately after selection snapshot materializes, before first iteration |
| FR-018b progress `INFO` lines | Processed or Failed (per-iteration) | One line per Attempted PR with `(N of T)` counter and outcome token |
| FR-019b warnings entries | Failed | One entry per Failed PR; `counts.prs_updated = Processed` (Bucket 3 empty, no fallback) |
| Artifact discriminator invariant (plan §4) | N/A | At least one `"backfill-comments: "` entry; not a taxonomy term |

## 7. State-machine: run-level lifecycle

```
[Entry: cmd_backfill_comments(args)]
  │
  ├── args validation (FR-010, FR-033)
  │     ├── invalid numeric / malformed date → parser.error → exit 2
  │     └── valid → continue
  │
  ├── load_config (FR-009 default path resolution)
  │     ├── ConfigurationError → create_minimal_summary + append "backfill-comments: fatal-abort:" → exit 1
  │     └── ok → continue
  │
  ├── DatabaseManager.connect + legacy-schema detection (FR-017)
  │     ├── DatabaseError → create_minimal_summary + append "backfill-comments: fatal-abort:" → exit 1
  │     ├── legacy schema → emit legacy-schema WARNING + write full-shape success artifact
  │     │                    with "backfill-comments: legacy-schema-skip:" warning → exit 0
  │     └── modern schema → continue
  │
  ├── ADOClient.test_connection (FR-008)
  │     ├── auth failure → create_minimal_summary + append "backfill-comments: fatal-abort:" → exit 1
  │     └── ok → continue
  │
  ├── Materialize selection snapshot (FR-011a)  ─────►  T = len(snapshot)
  │
  ├── Emit FR-018a anchor: "backfill-comments: backfill run over T pull request(s)" [INFO]
  │
  ├── For each (ordinal N, pr_row) in enumerate(snapshot, start=1):
  │     ├── try:
  │     │     ├── outcome = _fetch_and_upsert_threads_for_pr(...)
  │     │     ├── apply simplified 2-outcome stamp decision (§2.1)
  │     │     ├── db.connection.commit()          ← FR-012 per-PR atomicity
  │     │     ├── outcome_token = "Processed"
  │     │     └── processed_count += 1
  │     ├── except ExtractionError as e:
  │     │     ├── db.connection.rollback()        ← FR-013 rollback
  │     │     ├── warnings.append("backfill-comments: failed to process PR <uid>: ...")
  │     │     ├── outcome_token = "Failed"
  │     │     └── failed_count += 1
  │     └── emit FR-018b: "backfill-comments: covered PR <uid> (N of T) [<token>]" [INFO]
  │              (FR-018c: emitted AFTER commit/rollback resolves)
  │
  ├── Trigger review-time recomputation hook (FR-016)
  │
  ├── Compose warnings list:
  │     ├── per-Failed-PR entries (already appended in loop)
  │     └── append "backfill-comments: loop-complete: processed=P failed=F"  ← first-class invariant
  │
  ├── Compose RunSummary and write run_summary.json
  │
  └── emit terminal summary line: "backfill-comments: processed <P> pull requests (<F> failures)"
        └── exit 0
```

## 8. Invariants (consolidated)

| ID | Invariant | Enforced at |
|---|---|---|
| INV-1 | Selection snapshot is materialized exactly once per run, before any API call | §4 lifecycle step "Materialize selection snapshot"; FR-030a test |
| INV-2 | `T` is stable for the run's duration; `N` is monotonic 1 to T | enumerate() + immutable snapshot; FR-030a test |
| INV-3 | Each per-PR iteration is a single atomic DB unit: all-or-nothing | `db.connection.commit()` / `db.connection.rollback()` in caller; FR-030b test |
| INV-4 | Interrupted iteration leaves DB bit-identical to pre-iteration state; committed iterations persist | SQLite transaction semantics + caller commit boundary; FR-030c test |
| INV-5 | Backfill's stamp decision never traverses the preserve branch → preserved-unset outcome unreachable | Caller's simplified 2-outcome rule; FR-031 truncation-verified-complete tests (both sub-cases) |
| INV-6 | Extract's observable behavior unchanged | `test_extract_comments.py` passes bit-for-bit (FR-034); `test_run_summary_snapshot.py` golden match |
| INV-7 | Every terminated backfill run writes a `run_summary.json` | Try/except envelope in `cmd_backfill_comments` + `main()` interrupt handler; FR-019a/b/c |
| INV-8 | Every backfill artifact carries at least one `"backfill-comments: "` warning entry (first-class discriminator) | Mechanism: **single shared helper** `_append_backfill_warning(warnings, body)` backed by module-level constant `_BACKFILL_WARNING_PREFIX`; all 8 code sites (plan §4 A / B / C / D1–D5) MUST route through it. Enforcement layers: **(a)** AST parity test #19a (`TestBackfillWarningEmissionParity::test_discriminator_prefix_literal_appears_only_inside_helper`) asserts the discriminator literal appears only inside the helper — catches any site that copy-pastes the inline prefix; **(b)** FR-030e artifact-state test #34 drives every backfill artifact state and asserts `is_backfill_artifact()` returns True — catches any site that forgets to emit. Layers overlap deliberately: the AST test prevents drift at code time; the artifact test prevents drift at runtime. A missing site fails both. |
| INV-9 | Progress line carries the post-commit/rollback outcome token (never the optimistic token) | Ordering: commit/rollback ─► outcome_token set ─► logger.info; FR-030h test |
| INV-10 | Legacy-schema warning prefix uniquely identifies the legacy-schema no-op state; empty-selection does NOT emit it | Pre-loop check + FR-017a contract; FR-030i test |
| INV-11 | No user-visible surface makes an unqualified FR-024a-forbidden claim | Drafted help text + log strings + artifact strings; FR-030j scan test |
| INV-12 | No file under `docs/` is touched on the feature branch | FR-029/029a; FR-030g diff test |

## 9. Out-of-scope (deferred, not a data-model concern for this feature)

- ADO pipeline task wrapper for `backfill-comments` (deferred to follow-up issue per Assumption §8 of spec.md; FR-028).
- Process-level locking of concurrent invocations (explicit scope decision per Edge Cases §"Two concurrent invocations"; the subcommand is unfenced).
- Schema migrations (FR-027 forbids).
- Modifications to `docs/user-guide/local-cli.md:531-544` and `docs/operations/runbook.md:170-183` stale JSON examples (pre-existing drift flagged in research.md §1 — to be addressed by a follow-up doc-correction issue after 058 merges).
