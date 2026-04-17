# Backfill Comments — Live QA Runbook

End-to-end manual validation for the `backfill-comments` CLI subcommand and
its Azure DevOps extension task wrapper. Run this after material changes to
the backfill selection, transaction, probe, or schema-classification paths,
and before merging any branch that touches those surfaces.

Unit tests assert behavior against mocks. This runbook asserts the same
behavior against the live ADO API, against deliberately damaged SQLite
files, and against the full extension task wrapper. Scenarios cover every
failure-classification site the extract + backfill flow can produce, so
regressions surface here rather than in production pipelines.

> **Flag asymmetry warning:** `extract` and `backfill-comments` both accept
> `--organization` / `--projects` (plural, comma-separated). `stage-artifacts`
> accepts `--org` / `--project` (singular). Do not mix them. See the
> [CLI Command Reference](../reference/cli-reference.md) for the authoritative
> surface.

---

## Discipline: pre-write expectations before every scenario

**This is mandatory.** Running a scenario first and interpreting the output
afterward is how interpretation fights start. For each scenario below,
write down all five fields **before** executing the command:

1. **Command** — the full invocation you will run
2. **Expected exit code** — `0` or `1`
3. **Expected artifact shape** — `final_status`, `first_fatal_error`,
   `counts.prs_updated`, and the shape of `warnings[]`
4. **Expected DB delta** — which tables change and by how many rows, or
   "no change"
5. **Stop-and-report condition** — the specific signal that would halt QA

Any divergence between actual and expected on any of the five fields is a
stop-and-report.

---

## Prerequisites

- Python development environment set up per
  [Development Setup](../development/setup.md)
- `ado-insights` installed (`uv tool install -e .` or `pip install -e .`)
- `sqlite3` CLI for DB inspection
- `curl` for the project-name discovery step
- Azure DevOps PAT — scope noted per scenario; most use Code (Read)
- For the extension-parity scenarios: Node 22+ and the extension's
  `pnpm install` completed per [Development Setup](../development/setup.md)

---

## Target configuration

Run against a multi-project organization. The `oddessentials` values below
are maintainer examples — substitute your own. `--projects` match is
**case-sensitive and exact**, so discover the canonical project names via
the org's `_apis/projects` endpoint before running:

```powershell
curl -u ":$env:PAT" "https://dev.azure.com/<org>/_apis/projects?api-version=7.1-preview.4"
```

Choose a recent 7-day window so the total PR count stays bounded and
scenario 2 completes within a single QA session. The extension's
user-guide documents a typical backfill rate; use that to size your window
if you are unsure.

---

## Setup (every run)

- Fresh temp DB path — delete any existing file at this path before the
  first scenario
- PAT exported to environment, not a file
- A working directory (`$qaRoot` below) where artifacts, the DB, and any
  manufactured fixture files live side-by-side

```powershell
$env:PAT = "<your-pat>"
$qaRoot = "$env:TEMP\ado-qa-full"
Remove-Item -Recurse -Force $qaRoot -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $qaRoot -Force | Out-Null
```

The CLI creates per-scenario subdirectories under `--artifacts-dir` as
needed.

---

## Scenario catalog

### A. Happy paths

#### 1. Extract baseline

> **PAT scope:** Code (Read)

Mirrors the extension's `mode: extract` task (no `--include-comments`).
Establishes the uncovered-PR universe that scenario 2 drains.

```powershell
ado-insights --artifacts-dir "$qaRoot\artifacts\extract" `
  extract `
  --organization <org> --projects "<csv>" `
  --pat $env:PAT --database "$qaRoot\qa.sqlite" `
  --start-date <YYYY-MM-DD> --end-date <YYYY-MM-DD>
```

**Verify:** exit 0; `counts.prs_fetched` is non-negative; every row in
`pull_requests` has `comments_extracted_at IS NULL`; `pr_threads` and
`pr_comments` are empty.

#### 2. Backfill all projects

> **PAT scope:** Code (Read)

Mirrors the extension's `mode: backfill-comments` task. Omits `--limit`
to match the extension's default when `backfillLimit` is left blank.

```powershell
ado-insights --artifacts-dir "$qaRoot\artifacts\backfill-1" `
  backfill-comments `
  --organization <org> --projects "<csv>" `
  --pat $env:PAT --database "$qaRoot\qa.sqlite"
```

**Verify:** exit 0; a `Successfully connected to organization <org>` log
line is present (the pre-loop organization probe fired);
`counts.prs_updated` equals the total from scenario 1;
`comments_extracted_at IS NOT NULL` on every PR; `pr_threads` and
`pr_comments` are non-empty; `first_fatal_error` is `null`;
`warnings[]` contains only the informational loop-complete entry.

Note: `counts.prs_updated` counts PRs that finished their loop iteration
without raising `ExtractionError`; `comments_extracted_at` reflects
whether the coverage marker was written. They are **not** equivalent —
a truncated PR increments `counts.prs_updated` but leaves
`comments_extracted_at NULL`. In a no-truncation run the two counts
align; do not assume they always will.

#### 3. Backfill re-run — idempotency

Identical command to scenario 2, different artifacts subdirectory.

**Verify:** exit 0; `counts.prs_updated == 0`; `backfill run over 0 pull
request(s)` appears in the log; `pr_threads` and `pr_comments` row counts
unchanged vs end of scenario 2.

#### 4. Empty selection with future `--since`

> **PAT scope:** Code (Read)

```powershell
ado-insights --artifacts-dir "$qaRoot\artifacts\backfill-future" `
  backfill-comments `
  --organization <org> --pat $env:PAT --database "$qaRoot\qa.sqlite" `
  --since 2099-01-01
```

**Verify:** exit 0; the pre-loop probe log line is still present (empty
selection does not skip connectivity validation); `counts.prs_updated == 0`.

---

### B. Pre-loop fatals

These scenarios test the failure modes that abort before the per-PR loop
begins. The safety net for operator error — invalid PAT, wrong database
path, partial schema corruption — lives entirely in pre-loop checks.

#### 5. Invalid PAT

```powershell
ado-insights --artifacts-dir "$qaRoot\artifacts\bad-pat" `
  backfill-comments `
  --organization <org> --pat "invalid-test-pat" --database "$qaRoot\qa.sqlite"
```

**Verify:** exit 1; `first_fatal_error` starts with `Extraction error:`;
the DB file at `$qaRoot\qa.sqlite` is unchanged.

#### 6. Wrong DB path

Two sub-cases.

**(a) Missing file:**

```powershell
ado-insights --artifacts-dir "$qaRoot\artifacts\missing-db" `
  backfill-comments `
  --organization <org> --pat $env:PAT `
  --database "$qaRoot\does-not-exist.sqlite"
```

**(b) File that is not a SQLite database:**

```powershell
"not a db" | Out-File "$qaRoot\not-a-db.sqlite"
ado-insights --artifacts-dir "$qaRoot\artifacts\not-sqlite" `
  backfill-comments `
  --organization <org> --pat $env:PAT `
  --database "$qaRoot\not-a-db.sqlite"
```

**Verify (both):** exit 1; fatal database error; **no silent
legacy-schema skip**; in sub-case (a), **no new SQLite file created** at
the target path.

#### 7. Partial schema corruption

Drop one of the comment tables from an otherwise-valid DB (use the DB
from end of scenario 3 and make a copy first if you want to preserve
it):

```powershell
sqlite3 "$qaRoot\qa.sqlite" "DROP TABLE pr_threads"
ado-insights --artifacts-dir "$qaRoot\artifacts\partial-schema" `
  backfill-comments `
  --organization <org> --pat $env:PAT --database "$qaRoot\qa.sqlite"
```

**Verify:** exit 1; fatal database error; **NOT classified as a
legacy-schema skip** (the legacy path requires both `pr_threads` and
`pr_comments` absent, not just one); `pr_comments` remains present but
unusable.

---

### C. Legacy path

#### 8. Pre-comments (legacy) database

Seed a SQLite file that has `pull_requests` but lacks `pr_threads` and
`pr_comments` entirely. One approach is to dump the schema from an older
version of the tool and seed a minimal `pull_requests` row; another is
to hand-construct the minimum required schema via `sqlite3`.

```powershell
ado-insights --artifacts-dir "$qaRoot\artifacts\legacy" `
  backfill-comments `
  --organization <org> --pat $env:PAT --database "$qaRoot\legacy.sqlite"
```

**Verify:** exit 0; successful no-op; a legacy-schema warning in
`warnings[]`; **no `pr_threads` or `pr_comments` tables are created as a
side effect**:

```powershell
sqlite3 "$qaRoot\legacy.sqlite" "SELECT name FROM sqlite_master WHERE type='table'"
```

The listed tables after the run must match the legacy fixture's tables.

---

### D. In-loop failure handling

These scenarios exercise the per-PR atomic transaction contract: each
PR's thread fetch is independent; a per-PR failure isolates to that PR,
does not abort the run, and keeps the PR selectable on the next
invocation.

#### 9. All-failed loop

Seed PR rows pointing at repositories the PAT cannot read (403) or that
do not exist upstream (404), so every `get_pr_threads` call fails.

**Pre-written expected outcome.** Every value below is pinned by the
feature's contract spec at
`specs/058-backfill-comments/contracts/cli-subcommand.md` and locked by
unit tests in `tests/unit/test_backfill_comments.py`. Record these
values per the Discipline section at the top of this doc before
running:

- `exit_code == 0` — contract §5 (Exit code contract, FR-019): the
  exit-0 row explicitly lists "100%-failure" as a loop-completion
  state. Also surfaced in `backfill-comments --help`.
- `final_status == "success"` — contract §7 (Artifact contract) and
  the FR-019 exit-0 row; every loop-completed run carries this value.
- `first_fatal_error == null` — same; fatal errors are reserved for
  pre-loop aborts (exit 1 row).
- `counts.prs_updated == 0` — SC-012: downstream consumers enforce
  their own failure-rate policy by reading `counts.prs_updated`; when
  every PR raises `ExtractionError`, `processed_count` never
  increments, so the field is `0`.
- `warnings[]`:
  - One `"backfill-comments: failed to process PR <pr_uid>: <normalized_error>"`
    entry per failed PR — contract §7.3 required-warning-entry form
    for the "Loop-completed, `F > 0`" state.
  - Exactly one `"backfill-comments: loop-complete: processed=0 failed=<N>"`
    entry — contract §7.3 required-warning-entry form for any
    loop-completed state.
  - The `loop-complete:` string is an **artifact warning** entry per
    §7.3. It is a separate surface from the **stdout terminal summary
    line** specified by contract §6.5 — the latter reads
    `"backfill-comments: processed <P> pull requests (<F> failures)"`,
    different wording, and is not the loop-complete warning.

#### 10. Mixed success/failure

Seed two or more PRs where the PAT can read one PR's repository but not
another's (cross-project PRs with asymmetric PAT scope, or hand-seeded
rows pointing at a mix of reachable and unreachable repositories).

**Verify:** exit 0; no fatal abort; the successful PR has
`comments_extracted_at IS NOT NULL` with its threads and comments
persisted; the failed PR has `comments_extracted_at IS NULL` and
**remains selectable on the next invocation** — a re-run with the same
arguments picks up only the failed PR.

#### 11. Comments cap and the truncation-preserve contract

Pick a PR with more than one thread and run with a cap below that count.
The PR must not be marked complete, because threads beyond the cap were
not stored and cannot be proven covered.

```powershell
ado-insights --artifacts-dir "$qaRoot\artifacts\cap" `
  backfill-comments `
  --organization <org> --pat $env:PAT --database "$qaRoot\qa.sqlite" `
  --comments-max-threads-per-pr 1
```

**Verify:** threads are truncated (only one thread row persists for the
capped PR); `comments_extracted_at IS NULL` on that PR; the PR
**remains reselectable** — a follow-up run without the cap completes it.

Marking the PR complete after a truncated fetch with any missing
dropped thread is the regression signature this scenario locks.

---

### E. Scope and multi-org

#### 12. Wrong organization against a mixed-org database

Seed a DB containing PRs from both `orgA` and `orgB`, then run with
`--organization orgA`:

```powershell
sqlite3 "$qaRoot\qa.sqlite" "INSERT INTO pull_requests (organization_name, ...) VALUES ('orgB', ...)"
ado-insights --artifacts-dir "$qaRoot\artifacts\wrong-org" `
  backfill-comments `
  --organization orgA --pat $env:PAT --database "$qaRoot\qa.sqlite"
```

**Verify:** exit 0 — the previous mixed-org fatal abort was intentionally
removed in favor of silent scoping. `orgA` PRs are touched and their
markers set; `orgB` PRs are unchanged, their markers still `NULL`; no
threads or comments are created for `orgB` PRs.

---

### F. Extension parity (task wrapper)

These scenarios run the Azure DevOps task wrapper end-to-end, with the
Python CLI invoked exactly as a pipeline would invoke it. They prove
the task-wrapper contract and the CLI contract still line up.

#### 13. Task-wrapper happy path

> **PAT scope:** Code (Read)

Populate the task-lib input shape via `INPUT_*` environment variables
and run the wrapper directly:

```powershell
$env:INPUT_ORGANIZATION = "<org>"
$env:INPUT_PROJECTS = "<csv>"
$env:INPUT_PAT = $env:PAT
$env:INPUT_DATABASE = "$qaRoot\qa.sqlite"
$env:INPUT_MODE = "backfill-comments"

node .\extension\tasks\extract-prs\index.js
```

**Verify:** the task wrapper exits success; the CLI probe fires; PRs
get updated; the run artifact shape matches scenario 2.

#### 14. Task-wrapper failure path

Same environment shape as scenario 13, but break either the PAT or the
database:

```powershell
$env:INPUT_PAT = "invalid-test-pat"           # or
$env:INPUT_DATABASE = "$qaRoot\does-not-exist.sqlite"

node .\extension\tasks\extract-prs\index.js
```

**Verify:** the task fails with the same fatal-error classification as
scenarios 5 or 6 respectively; no silent success.

---

### G. Post-run aggregate sanity

#### 15. Aggregate metadata reflects the backfill run

After a bounded backfill, regenerate aggregates and verify the metadata
surfaces the backfill outcome, not stale extract metadata:

```powershell
ado-insights --artifacts-dir "$qaRoot\artifacts\bounded-backfill" `
  backfill-comments `
  --organization <org> --pat $env:PAT --database "$qaRoot\qa.sqlite" `
  --limit 5

ado-insights generate-aggregates `
  --database "$qaRoot\qa.sqlite" --output "$qaRoot\aggregates"
```

**Verify:** the aggregate output's `comments_extraction_metadata`
reflects the bounded backfill (timestamps, row counts); dashboard-facing
`capped` and coverage fields show the backfill's actual outcome; no
field is left at an extract-run placeholder value. Backfill must refresh
every metadata field it owns.

---

## Artifact inspection checklist

For every scenario, read `run_summary.json` inside the scenario's
`--artifacts-dir` subdirectory and compare these fields to the
pre-written expectation:

- Exit code of the process
- `final_status`
- `first_fatal_error`
- `warnings[]` shape and count
- `counts.prs_updated`
- `counts.prs_fetched` (scenario 1 only)
- `date_range.start` and `date_range.end`

This small set surfaces most churn immediately.

---

## Stop-and-report triggers

Halt QA and surface findings on any of the following:

- Python traceback in stdout or stderr
- Non-zero exit code outside the designed pre-loop-fatal scenarios
  (5, 6, 7, 14)
- `counts.prs_updated` does not match the pre-written expectation
- `comments_extracted_at IS NULL` on a PR that scenario 2 should have
  covered
- `pr_threads` empty after scenario 2 despite `counts.prs_updated > 0` —
  broad "backfill persistence" regression signal (successful per-PR
  iterations but no thread rows persisted anywhere). Note:
  `counts.prs_updated` counts PRs that finished without raising
  `ExtractionError`, not PRs whose coverage marker was set, so this
  trigger does **not** prove marker-set semantics; it only flags a
  wholesale persistence failure.
- Scenario 11 PR marked complete despite truncation — this is the
  true truncation-preserve (#289) regression signature
- Scenario 12 `orgB` rows touched
- Scenario 8 legacy DB picking up new tables as a side effect
- Scenario 6 silently creating a new DB file at the target path
- Scenario 7 classified as a legacy skip instead of a fatal error
- Scenario 10 failed PR not reselectable on re-run
- Scenario 15 aggregate metadata reflecting the extract run instead of
  the backfill run
- Database lock errors or interleaved writes
- Any `warnings[]` entry that is not the expected shape for the
  scenario

---

## See also

- [CLI Command Reference](../reference/cli-reference.md) — authoritative
  command and flag surface
- [Manual Testing Walkthrough](manual-walkthrough.md) — full-product
  manual tests
- [ADO Pipeline Smoke Check](ado-pipeline-smoke-check.md) — pipeline-side
  validations
- [Testing Guide](../development/testing.md) — automated test
  organization and preflight
- [Extension User Guide](../user-guide/extension.md) — user-facing
  extension documentation including the Backfilling section
- [Troubleshooting](../user-guide/troubleshooting.md) — installation,
  auth, extraction, and data issues
