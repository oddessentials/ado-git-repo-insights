# Quickstart: `backfill-comments` subcommand

**Phase**: 1 (Design & Contracts)
**Audience**: operators evaluating the new subcommand post-merge; test authors seeding fixtures; reviewers walking the end-to-end flow.
**Purpose**: a minimal end-to-end smoke test demonstrating the three P1 user scenarios (drain historical backlog, resume after interruption, scope with project/date filters). Pairs with [contracts/cli-subcommand.md](./contracts/cli-subcommand.md) for the flag-level reference and with [data-model.md](./data-model.md) for the entity-level model.

> **Note.** This file describes the *expected* runtime behavior against a seeded database. The subcommand itself is introduced by this feature and is not yet on `main`; this quickstart will be runnable once the feature branch merges.

## 0. Prerequisites

- Python 3.12+ and the repository checked out with `pip install -e .[dev]`.
- A personal access token (PAT) with **Code (Read)** scope on every repository whose pull requests the run will backfill. Stored in `$ADO_PAT` for the examples below.
- An Azure DevOps organization name the PAT is valid for (e.g., `myorg`).
- An existing SQLite database produced by a prior `ado-insights extract` run; a small seeded fixture works for dry-runs.

## 1. Happy-path smoke test — drain a backlog

Given a database with three completed PRs whose `comments_extracted_at` is `NULL`:

```bash
ado-insights backfill-comments \
    --organization myorg --pat "$ADO_PAT" \
    --database ado-insights.sqlite
```

### Expected log stream

```
INFO  backfill-comments: backfill run over 3 pull request(s)
INFO  backfill-comments: covered PR repo1-17 (1 of 3) [Processed]
INFO  backfill-comments: covered PR repo1-42 (2 of 3) [Processed]
INFO  backfill-comments: covered PR repo2-8  (3 of 3) [Processed]
```

### Expected terminal summary

```
backfill-comments: processed 3 pull requests (0 failures)
```

### Expected `run_artifacts/run_summary.json` (abridged)

```json
{
  "tool_version": "...",
  "git_sha": "...",
  "organization": "myorg",
  "projects": [],
  "date_range": {"start": "", "end": ""},
  "counts": {
    "prs_fetched": 0,
    "prs_updated": 3,
    "rows_per_csv": {}
  },
  "timings": {"total_seconds": ..., "extract_seconds": ..., "persist_seconds": 0.0, "export_seconds": 0.0},
  "warnings": [
    "backfill-comments: loop-complete: processed=3 failed=0"
  ],
  "final_status": "success",
  "per_project_status": {"ProjectA": "success", "ProjectB": "success"},
  "first_fatal_error": null
}
```

### Expected database state

- `pull_requests.comments_extracted_at` is non-null ISO-8601 for all three PRs.
- `pr_threads` contains the upstream thread rows for all three PRs.
- `pr_comments` contains the comment rows.
- `review_time_minutes` (derived) is populated for each PR whose reviewer activity meets the existing eligibility rules (FR-016).

### Exit code

`0` — loop ran to completion.

## 2. Resumability smoke test — second run is a no-op

Re-run the exact same command:

```bash
ado-insights backfill-comments \
    --organization myorg --pat "$ADO_PAT" \
    --database ado-insights.sqlite
```

### Expected log stream

```
INFO  backfill-comments: backfill run over 0 pull request(s)
```

(No per-PR progress lines — the selection set is empty because all three PRs are now covered.)

### Expected terminal summary

```
backfill-comments: processed 0 pull requests (0 failures)
```

### Expected `run_summary.json` (abridged)

```json
{
  ...,
  "counts": {"prs_fetched": 0, "prs_updated": 0, "rows_per_csv": {}},
  "warnings": [
    "backfill-comments: loop-complete: processed=0 failed=0"
  ],
  "final_status": "success",
  "first_fatal_error": null
}
```

### Expected upstream call count

**Zero.** The selection query returns an empty snapshot; the loop never iterates; `ADOClient.get_pr_threads` is never called. This is the FR-032 resumability invariant.

## 3. Scoped smoke test — project + date filters

Given a database whose uncovered PRs span two projects and three quarters, drain only PRs in `ProjectA` closed in Q1 2025:

```bash
ado-insights backfill-comments \
    --organization myorg --pat "$ADO_PAT" \
    --database ado-insights.sqlite \
    --projects "ProjectA" \
    --since 2025-01-01 --until 2025-04-01 \
    --limit 50
```

### Expected behavior

- Selection query applies `project_name IN ('ProjectA') AND closed_date >= '2025-01-01' AND closed_date < '2025-04-01'` (half-open interval).
- Selection is capped at 50 rows.
- `ProjectB` PRs are not processed — their `comments_extracted_at` remains unchanged.
- Out-of-window PRs (closed `2024-12-*` or `2025-04-*`+) remain unchanged.
- `run_summary.json`:
  - `projects == ["ProjectA"]`
  - `date_range == {"start": "2025-01-01", "end": "2025-04-01"}`
  - `counts.prs_updated` reports the Processed count within this scope.
  - `per_project_status == {"ProjectA": "success"}` (or `"partial"` / `"failed"` per the Outcome Taxonomy; `"ProjectB"` is absent because zero PRs from it were selected).

### Exit code

`0` — loop ran to completion.

## 4. Partial-failure smoke test

Given a database with three uncovered PRs where the middle PR's repository is inaccessible to the current PAT:

```bash
ado-insights backfill-comments \
    --organization myorg --pat "$ADO_PAT" \
    --database ado-insights.sqlite
```

### Expected log stream

```
INFO   backfill-comments: backfill run over 3 pull request(s)
INFO   backfill-comments: covered PR repo1-17 (1 of 3) [Processed]
WARNING Failed to extract comments for PR repo2-42: <normalized error>
INFO   backfill-comments: covered PR repo2-42 (2 of 3) [Failed]
INFO   backfill-comments: covered PR repo3-8  (3 of 3) [Processed]
```

### Expected terminal summary

```
backfill-comments: processed 2 pull requests (1 failures)
```

### Expected `run_summary.json` (abridged)

```json
{
  ...,
  "counts": {"prs_fetched": 0, "prs_updated": 2, "rows_per_csv": {}},
  "warnings": [
    "backfill-comments: failed to process PR repo2-42: <normalized error>",
    "backfill-comments: loop-complete: processed=2 failed=1"
  ],
  "final_status": "success",
  "first_fatal_error": null
}
```

### Expected database state

- `repo1-17` and `repo3-8` have non-null `comments_extracted_at`.
- `repo2-42` retains `NULL` `comments_extracted_at`; no `pr_threads` or `pr_comments` rows were added for it (FR-013 rollback).
- Re-invoking the subcommand selects only `repo2-42`.

### Exit code

`0` — loop ran to completion (FR-019 strict parity with extract: non-zero exit is reserved for fatal pre-loop errors, not for per-PR failure rate).

## 5. Legacy-schema smoke test

Given a database that has the `pull_requests` table but predates the `pr_threads` / `pr_comments` migration:

```bash
ado-insights backfill-comments \
    --organization myorg --pat "$ADO_PAT" \
    --database legacy-ado-insights.sqlite
```

### Expected log stream

```
WARNING  backfill-comments: pr_threads and pr_comments tables not present; run a migration or extract with --include-comments first
```

### Expected terminal summary

```
backfill-comments: skipped (legacy schema; no thread storage tables)
```

### Expected `run_summary.json` (abridged)

```json
{
  ...,
  "counts": {"prs_fetched": 0, "prs_updated": 0, "rows_per_csv": {}},
  "warnings": [
    "backfill-comments: legacy-schema-skip: pr_threads and pr_comments tables not present; run a migration or extract with --include-comments first"
  ],
  "final_status": "success",
  "first_fatal_error": null
}
```

### Exit code

`0` — successful no-op.

### Distinguishing from an empty-selection run

The terminal summary line and the `"legacy-schema-skip:"` warning prefix both distinguish this state from `backfill-comments: processed 0 pull requests (0 failures)` — which is a modern-schema database with no uncovered PRs. The `run_summary.json` shape is identical between the two; only the warnings list differs.

## 6. Fatal pre-loop abort smoke test

Given an invalid PAT (or an unreachable organization):

```bash
ado-insights backfill-comments \
    --organization myorg --pat "INVALID_TOKEN" \
    --database ado-insights.sqlite
```

### Expected log stream

```
ERROR  Extraction error: <normalized error>
```

### Expected `run_summary.json` (abridged)

```json
{
  ...,
  "counts": {"prs_fetched": 0, "prs_updated": 0, "rows_per_csv": {}},
  "warnings": [
    "backfill-comments: fatal-abort: <normalized error>"
  ],
  "final_status": "failed",
  "first_fatal_error": "<normalized error>"
}
```

### Exit code

`1` — fatal pre-loop error.

## 7. Verification checklist

Run the commands above in sequence (cases 1 through 6 against appropriate fixtures); an operator comparing observed output against expected output should be able to check each line below:

- [ ] Happy-path run covers every uncovered PR and the second run is a zero-API-call no-op (cases 1–2).
- [ ] Filtered runs select only the PRs matching `--projects`, `--since`, `--until`, `--limit` (case 3).
- [ ] Partial-failure runs isolate failures to specific PRs; the run continues, exits zero, and re-invocation reselects only the failed PRs (case 4).
- [ ] Legacy-schema runs produce a full-shape success artifact with the `legacy-schema-skip:` warning (case 5).
- [ ] Fatal pre-loop aborts produce a failed-shape minimal artifact with the `fatal-abort:` warning (case 6).
- [ ] **Every** `run_summary.json` across cases 1–6 contains at least one `warnings` entry whose prefix is `"backfill-comments: "` (first-class discriminator invariant).
- [ ] No file under `docs/` was modified by any of the runs (FR-029/029a).
- [ ] No `INFO`, `WARNING`, terminal summary, or artifact string contains an unqualified `thread-safe`, `concurrent`, `atomic` (outside "per-PR atomic"), `complete` (in DB-wide context), or `resumable` (without FR-012/013 qualifier) claim (FR-024a).

Automated enforcement of each bullet is mapped to a test file in [plan.md §5](./plan.md#5--test-surface-every-fr-030-bound-to-a-test-file-and-a-locked-invariant).

## 8. Non-supported usage

The subcommand does **not** support or fence against:

- Concurrent invocations against the same database. The user is responsible for ensuring at most one backfill process runs against a given database at a time. Running two concurrently produces duplicate upstream calls, misleading progress lines, and last-write-wins on coverage-marker updates at commit boundaries; partial-thread writes are still prevented by per-PR atomicity. No process-level lock is introduced.
- Operating against a database that has no `pull_requests` table at all — this is outside the "legacy schema" definition and will surface as a fatal pre-loop error.
- Modifying already-covered PRs. Covered PRs are excluded from the selection predicate; the subcommand offers no flag to force-refresh them. Operators who need to refresh coverage MUST first clear `comments_extracted_at` for the target PRs and then re-invoke.
