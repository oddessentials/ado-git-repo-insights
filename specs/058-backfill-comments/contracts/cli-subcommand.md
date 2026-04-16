# Contract: `backfill-comments` subcommand

**Kind**: CLI argparse subcommand + exit codes + log/artifact surface.
**Parent command**: `ado-insights`.
**Source spec**: [../spec.md](../spec.md).
**Companion docs**: [../plan.md](../plan.md), [../research.md](../research.md), [../data-model.md](../data-model.md).

This document is the authoritative contract for the `backfill-comments` subcommand's public surface. Every string below (description, flag help, epilog example, terminal summary line, log line shape, artifact warning-entry forms) is the exact wording that will ship in the subparser definition and the runtime code. **Issue [#285](https://github.com/oddessentials/ado-git-repo-insights/issues/285) will generate `docs/reference/cli-reference.md` from these strings**; every phrase here is eventual public documentation.

Every user-visible phrase was drafted to satisfy FR-024a — no unqualified use of `thread-safe`, `concurrent`, `atomic` (outside the permitted "per-PR atomic" qualifier), `complete` (in database-wide context), or `resumable` (without the FR-012/013 qualification).

## 1. Parser wiring

Inserted in `src/ado_git_repo_insights/cli.py::create_parser()` after the existing `extract_parser` block (currently ends at line 163, before the `csv_parser` block at line 165). Root-parser global flags (`--log-format`, `--artifacts-dir`, `--version`) apply to this subcommand unchanged.

```python
backfill_parser = subparsers.add_parser(
    "backfill-comments",
    help="Backfill PR thread coverage for historical completed PRs (oldest uncovered first)",
    description=_BACKFILL_DESCRIPTION,          # see §2
    epilog=_BACKFILL_EPILOG,                     # see §3
    formatter_class=argparse.RawDescriptionHelpFormatter,
)
```

## 2. Subcommand description (FR-021, FR-024a-compliant)

```
Drain historical PR thread coverage for completed pull requests whose thread
data has never been fetched. The subcommand selects the oldest uncovered pull
request first, breaks ties by the pull request's stable identifier, and skips
any pull request whose coverage marker is already set.

The selection set is materialized once at run start; pull requests inserted or
modified during the run cannot enter the working set. Each selected pull
request is processed inside its own per-PR atomic database transaction: on
success the thread rows, comment rows, user rows, and the coverage marker
update commit together; on per-pull-request failure or mid-iteration
interruption (SIGINT/SIGTERM), the transaction rolls back and the pull
request's database state is left bit-identical to its pre-iteration state, so
the next invocation will reselect it. Pull requests whose transactions
committed before a failure or interruption persist.

Upstream rate-limit and retry behavior is inherited from the configured
extraction API client: per-pull-request retries are bounded, and per-pull-
request failures after retry exhaustion are isolated (the run continues with
the next pull request; the failed pull request is recorded in the run-summary
artifact and remains selectable on the next invocation). A run whose loop
reaches completion exits with status code zero regardless of the per-pull-
request failure rate; non-zero exit codes are reserved for fatal pre-loop
errors.
```

Length: 1,223 characters — fits RawDescriptionHelpFormatter rendering without wrapping artefacts.

### 2.1 FR-024a self-check of the description

- `per-PR atomic` — qualified (scope bounded to one pull request). PERMITTED.
- `commit together` — describes the transaction unit; no DB-wide claim.
- `isolated` — scoped to per-pull-request failure handling; no DB-wide claim.
- No occurrence of `thread-safe`, `concurrent`, `complete` (DB-wide), or `resumable`.

### 2.2 When to use this versus `extract --include-comments`

Deliberately narrated inline in §2 via the "oldest uncovered first" and "pull requests inserted or modified during the run cannot enter the working set" phrasing — distinguishing backfill's historical-drainage selection from extract's "newest-first with fixed per-run cap". No separate "when to use" paragraph is added; the description's selection-ordering sentence tells operators everything they need.

## 3. Epilog (FR-022 — concrete usage example)

```
Examples:

  # Drain every uncovered completed PR in the database (no filters):
  ado-insights backfill-comments \
      --organization myorg --pat "$ADO_PAT" \
      --database ado-insights.sqlite

  # Limit a single run to 500 oldest PRs, closed on or after 2024-01-01:
  ado-insights backfill-comments \
      --organization myorg --pat "$ADO_PAT" \
      --database ado-insights.sqlite \
      --since 2024-01-01 --limit 500

  # Scope to two projects, closed in Q1 2025:
  ado-insights backfill-comments \
      --organization myorg --pat "$ADO_PAT" \
      --database ado-insights.sqlite \
      --projects "ProjectA, ProjectB" \
      --since 2025-01-01 --until 2025-04-01
```

## 4. Flag definitions (with exact `help=` prose)

Each flag's `help=` string states the effect, the default (where applicable), the permitted shape or range, and any interaction with other flags (FR-023).

### 4.1 `--organization` (required, FR-008)

```python
backfill_parser.add_argument(
    "--organization", required=True, type=str,
    help=(
        "Azure DevOps organization name (required). Must match the "
        "organization the target pull requests belong to; used to construct "
        "the upstream thread-fetch URL."
    ),
)
```

### 4.2 `--pat` (required, FR-008)

```python
backfill_parser.add_argument(
    "--pat", required=True, type=str,
    help=(
        "Personal Access Token with Code (Read) scope (required). The token "
        "MUST have read access to every repository whose pull requests fall "
        "within the run's selection scope; pull requests in repositories the "
        "token cannot read will surface as per-pull-request failures in the "
        "run-summary artifact."
    ),
)
```

### 4.3 `--database` (optional, default `ado-insights.sqlite`, FR-009)

```python
backfill_parser.add_argument(
    "--database", type=Path, default=Path("ado-insights.sqlite"),
    help=(
        "Path to the SQLite database file to operate on (default: "
        "'ado-insights.sqlite'). The database MUST already exist and MUST "
        "contain the pull_requests, pr_threads, and pr_comments tables. "
        "Databases that lack pr_threads and pr_comments (legacy schema) "
        "trigger a successful no-op with a legacy-schema-skip warning."
    ),
)
```

### 4.4 `--projects` (optional, FR-004)

```python
backfill_parser.add_argument(
    "--projects", type=str, default=None,
    help=(
        "Comma-separated list of project names to restrict the run to "
        "(default: no filter — all projects are eligible). Entries are "
        "trimmed of surrounding whitespace, empty entries are dropped, and "
        "input order is preserved; the match against each pull request's "
        "stored project_name is case-sensitive and exact. Parsing is "
        "behaviorally identical to the project-list input accepted by "
        "'extract'; invalid entries do not raise — they simply match zero "
        "pull requests."
    ),
)
```

### 4.5 `--since` (optional, FR-005)

```python
backfill_parser.add_argument(
    "--since", type=str, default=None,
    help=(
        "Inclusive closed-date lower bound, in YYYY-MM-DD form (default: "
        "no lower bound). Pull requests with closed_date strictly less than "
        "this value are excluded from the selection. Combines with --until "
        "to form the half-open interval [since, until). Date-shape "
        "validation is behaviorally identical to 'extract --start-date'; "
        "malformed values (e.g., 2024-13-99 or not-a-date) are rejected "
        "before any database or network work begins."
    ),
)
```

### 4.6 `--until` (optional, FR-005)

```python
backfill_parser.add_argument(
    "--until", type=str, default=None,
    help=(
        "Exclusive closed-date upper bound, in YYYY-MM-DD form (default: "
        "no upper bound). Pull requests with closed_date greater than or "
        "equal to this value are excluded from the selection. Combines with "
        "--since to form the half-open interval [since, until); "
        "'--since X --until X' matches zero pull requests (valid but empty "
        "filter, not an error). Date-shape validation is behaviorally "
        "identical to 'extract --end-date'; malformed values are rejected "
        "before any database or network work begins."
    ),
)
```

### 4.7 `--limit` (optional, default `0` = unbounded, FR-006)

```python
backfill_parser.add_argument(
    "--limit", type=_non_negative_int, default=0,
    help=(
        "Maximum number of pull requests to process in this run (default: 0, "
        "which means unbounded — every uncovered pull request matching the "
        "filters is processed). Negative values are rejected. The limit is "
        "applied after the --projects / --since / --until filters, so "
        "'--limit N' bounds the count of processed pull requests, not the "
        "count of candidate pull requests before filtering. Use a finite "
        "--limit to bound a single invocation's API budget; re-invoke with "
        "the same arguments to continue draining from where the last run "
        "stopped."
    ),
)
```

### 4.8 `--comments-max-threads-per-pr` (optional, default `50`, FR-007)

```python
backfill_parser.add_argument(
    "--comments-max-threads-per-pr", type=_non_negative_int, default=50,
    help=(
        "Maximum number of threads to fetch per pull request (default: 50, "
        "matching the extract flow's default; 0 means unlimited). When a "
        "pull request's thread count exceeds this cap, the earliest threads "
        "returned by the upstream API are persisted and the dropped "
        "remainder is inspected against local storage to decide whether "
        "the pull request's coverage marker can be set (when every dropped "
        "thread is already stored and current) or MUST be left unchanged "
        "(when any dropped thread is missing or stale locally). Negative "
        "values are rejected."
    ),
)
```

## 5. Exit code contract (FR-019)

| Exit code | Condition |
|---|---|
| `0` | The per-pull-request loop ran to completion, regardless of per-pull-request failure rate. Includes: all-success, partial-failure, 100%-failure, empty-selection, legacy-schema no-op. |
| `1` | Fatal pre-loop error — invalid configuration, database file missing or unopenable, upstream authentication failed, unexpected exception. `run_summary.json` carries `final_status="failed"` with a non-null `first_fatal_error`. |
| `2` | Argparse rejection — malformed date, negative numeric value, missing required flag. Argparse emits its own error text to stderr; no `run_summary.json` is written because `main()` has not entered its side-effecting phase yet. |
| `130` | `KeyboardInterrupt` (Ctrl-C). `run_summary.json` is written with `final_status="failed"`, `first_fatal_error="Operation cancelled by user"`, and the warning entry `"backfill-comments: fatal-abort: Operation cancelled by user"`. |

## 6. Log-stream contract (FR-017, FR-018, FR-018a, FR-018b, FR-018c, FR-019)

### 6.1 Opening anchor (FR-018a)

Emitted immediately after the selection snapshot materializes, before any API call:

```
INFO  backfill-comments: backfill run over <T> pull request(s)
```

- `T` is the selection-snapshot size.
- `T=0` is a valid value; the subsequent loop iterates zero times and the run proceeds directly to the closing summary.

### 6.2 Per-PR progress line (FR-018b, FR-018c)

One line per Attempted pull request, emitted **strictly after** the per-PR transaction commits or rolls back (FR-018c):

```
INFO  backfill-comments: covered PR <pr_uid> (<N> of <T>) [Processed]
INFO  backfill-comments: covered PR <pr_uid> (<N> of <T>) [Failed]
```

- `<pr_uid>` is `pull_request_uid` (stable identifier).
- `<N>` is the 1-based ordinal within the materialized snapshot.
- `<T>` is the snapshot size emitted in §6.1.
- The outcome token matches the post-commit / post-rollback outcome with certainty.

### 6.3 Per-failure warning (FR-019b — existing per-PR warning shape preserved)

```
WARNING  Failed to extract comments for PR <pr_uid>: <normalized_error>
```

Existing shape from `_extract_comments`'s per-PR ExtractionError handler (`cli.py:633-637`) — mirrored here for consistency. Emitted **in addition to** the FR-018b progress line, not in place of it.

### 6.4 Legacy-schema warning (FR-017)

```
WARNING  backfill-comments: pr_threads and pr_comments tables not present; run a migration or extract with --include-comments first
```

Emitted once, pre-loop, when legacy-schema detection triggers. Loop does not execute.

### 6.5 Terminal summary lines (FR-018, FR-017)

| State | Terminal summary line |
|---|---|
| Loop-completed, non-empty selection | `backfill-comments: processed <P> pull requests (<F> failures)` |
| Loop-completed, empty selection (`T=0`) | `backfill-comments: processed 0 pull requests (0 failures)` |
| Loop-completed, legacy-schema no-op | `backfill-comments: skipped (legacy schema; no thread storage tables)` |
| Fatal pre-loop abort | (no terminal summary — `RunSummary.print_final_line()` from `create_minimal_summary()` emits the standard `[FAIL] FAILED:` form) |

The visual distinction between `skipped (legacy schema; no thread storage tables)` and `processed 0 pull requests (0 failures)` satisfies FR-017's "visibly distinct" requirement without needing the operator to parse the artifact.

## 7. Artifact contract (`run_summary.json`)

The artifact shape is produced by `RunSummary.to_dict()` unchanged (FR-025a). Field-by-field backfill value mapping is authoritative in [plan.md §4](../plan.md#4--artifact-composition-and-the-first-class-discriminator-invariant-fr-019a-d-pre-plan-deliverable-2); reproduced here for the generator.

### 7.1 Required fields and types (unchanged from extract)

See [../data-model.md §5.1](../data-model.md#51-top-level-schema-unchanged). Every field present; no backfill-specific schema extension.

### 7.2 First-class discriminator invariant

**Every `run_summary.json` artifact produced by `backfill-comments` contains at least one `warnings` entry whose literal prefix is `"backfill-comments: "`.** This is a non-negotiable contract, not an implementation detail. The [FR-030e test](../plan.md#5--test-surface-every-fr-030-bound-to-a-test-file-and-a-locked-invariant) locks this across all 5 backfill artifact states.

### 7.3 Required warning-entry prefixes (by state)

| State | Required `warnings` entry or entries | Entry form |
|---|---|---|
| Loop-completed (any outcome mix, including `T=0`) | **Exactly one** loop-complete entry | `"backfill-comments: loop-complete: processed=<P> failed=<F>"` |
| Loop-completed, `F > 0` | **One per Failed PR**, time-ordered (prepended to the loop-complete entry) | `"backfill-comments: failed to process PR <pr_uid>: <normalized_error>"` |
| Loop-completed, legacy-schema no-op | **Exactly one** legacy-schema-skip entry (no loop-complete entry because the loop did not run) | `"backfill-comments: legacy-schema-skip: pr_threads and pr_comments tables not present; run a migration or extract with --include-comments first"` |
| Fatal pre-loop abort | **Exactly one** fatal-abort entry appended to the `create_minimal_summary()` return value before write | `"backfill-comments: fatal-abort: <normalized_error>"` |

### 7.4 FR-017a discriminator uniqueness

No warning entry other than the legacy-schema entry may use the `"legacy-schema-skip:"` sub-prefix. FR-030i test enforces.

### 7.5 Consumer check form (exact)

```python
def is_backfill_artifact(artifact: dict[str, object]) -> bool:
    """Return True iff produced by the backfill-comments subcommand.

    Relies on the first-class artifact invariant: every backfill-produced
    artifact state carries at least one warnings entry prefixed
    "backfill-comments: ".
    """
    warnings = artifact.get("warnings", [])
    if not isinstance(warnings, list):
        return False
    return any(
        isinstance(w, str) and w.startswith("backfill-comments: ")
        for w in warnings
    )
```

## 8. Input validation contract (FR-010, FR-033)

| Flag | Validator | Rejects |
|---|---|---|
| `--organization` | argparse default (non-empty string) | Missing flag → argparse usage error (exit 2) |
| `--pat` | argparse default (non-empty string) | Missing flag → argparse usage error (exit 2) |
| `--database` | `type=Path` (argparse built-in) | Any string parses to `Path`; existence is checked later in `cmd_backfill_comments` with a clean error message (exit 1) |
| `--projects` | `type=str` + downstream `_parse_projects_list` (pure function) | Parser is tolerant: trims, drops empties, preserves order. Invalid entries match zero PRs (not an error — Edge Case "A filter combination that matches no pull requests") |
| `--since` / `--until` | `type=str` + downstream `_parse_iso_date` (pure function) | Shape validation rejects `YYYY-MM-DD` mismatches (e.g., `2024-13-99`, `not-a-date`) with argparse `error` → exit 2 |
| `--limit` | `_non_negative_int` (existing `cli.py` helper) | Negative values → argparse `error` → exit 2 |
| `--comments-max-threads-per-pr` | `_non_negative_int` (existing `cli.py` helper) | Negative values → argparse `error` → exit 2 |

FR-005 contract: "Date-shape validation MUST reuse the existing extraction flow's date-validation helper if one is exposed; if the existing flow inlines its validation, the backfill implementation MUST introduce a new helper whose accept/reject set is provably identical to the existing flow's behavior for every date string (proven by a parity test that feeds the same input set to both paths and asserts matching outcomes)." Implementation approach: refactor extract's inline date validation into a pure `_parse_iso_date` helper exported from the `config` module; both flows call it. Parity is trivially satisfied; FR-030d parity test exercises the shared helper + extract's path to guarantee no regression.

## 9. Flag interaction summary (referenced from §4 help prose)

| Interaction | Notes |
|---|---|
| `--since X --until X` | Matches zero PRs (half-open interval is empty). Exits zero with empty-selection artifact. |
| `--since X --until Y` with `X > Y` | Matches zero PRs. Exits zero with empty-selection artifact. Treated as valid, per Edge Case §"`--since` greater than `--until`". |
| `--limit 0` | Unbounded — no cap beyond what the database contains after filtering. |
| `--limit N` with `N < total uncovered` | Processes oldest `N`; remaining reselectable on next invocation. |
| `--comments-max-threads-per-pr 0` | Unlimited threads per PR. Truncation branch of FR-015 never fires; every iteration takes the full-success path. |
| `--projects A,B` + `--since 2025-01-01` | Both filters ANDed against the selection predicate. |
| No filters | Selects all completed, uncovered PRs in the database, ordered by `closed_date ASC, pull_request_uid ASC`. |

## 10. Non-interactions (FR-025, FR-028)

Backfill's argparse surface does not expose and does not honor:

- `--include-comments` — backfill always fetches thread data; there is no feature-flag variant.
- `--comments-max-prs-per-run` — superseded by the semantically clearer `--limit`.
- `--start-date` / `--end-date` — superseded by `--since` / `--until`, which explicitly filter on `closed_date` rather than on creation date.
- `--backfill-days` — backfill's selection ordering (oldest uncovered first) is inherently historical; no day-window control is needed.
- `--config` (not included in Pass 1) — backfill's required flag set is small enough that a YAML config adds more complexity than it saves. A future issue MAY revisit.

The absence of these flags is intentional and part of the contract; operators familiar with `extract` MUST NOT expect any of them to parse on the backfill subcommand (argparse will emit "unrecognized arguments").
