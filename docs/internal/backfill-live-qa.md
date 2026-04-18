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

- Working directory (`$qaRoot` below) where artifacts, the DB, and any
  manufactured fixture files live side-by-side
- PAT exported to environment, not a file
- Scenarios 0a and 0b run against a **production-vintage** DB pulled from
  pipeline 15. Scenarios 1–15 run against a separate fresh DB at
  `$qaRoot\qa.sqlite`. Keep the two DBs on different paths so 0b can
  assert against the vintage without scenarios downstream perturbing it.

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

### 0. Production-vintage gate (MUST run first — blocks every downstream scenario)

Scenarios 1–15 operate on a freshly-created DB whose schema matches the
current `SCHEMA_SQL` exactly. That setup **cannot surface schema-drift bugs
between `SCHEMA_SQL` and the `MIGRATIONS` registry** — any table added to
`SCHEMA_SQL` without a paired migration will be present on every fresh DB
the runbook creates, masking the crash that fires only on DBs whose file
predates the `SCHEMA_SQL` change (issue #295, oddessentials build 332:
`sqlite3.OperationalError: no such table: comments_extraction_metadata`).

Scenarios 0a + 0b close that loophole by replaying the pipeline command
path against the real production vintage DB pulled from pipeline 15's
`ado-insights-db` artifact. If either 0a or 0b exits non-zero,
**stop the runbook** — downstream scenarios will not detect the
regression either.

**Fixture specificity (do NOT substitute org/pipeline values in 0a/0b):**
Unlike scenarios 1–15 where `oddessentials` is a maintainer example
substitutable for any target org, scenarios 0a + 0b are hardcoded to
`oddessentials` + `--pipeline-id 15` + the four-project list by design.
The production-vintage DB fixture that makes this gate useful lives on
that specific pipeline. A fork maintainer running this against a
different org would need to provision an equivalent vintage fixture
upstream and update these two commands — substituting values without
provisioning the fixture will false-fail. The rest of the runbook's
"substitute your own" guidance applies from scenario 1 onward.

#### 0a. Stage the production-vintage DB

> **PAT scope:** Build (Read) for artifact download

```powershell
ado-insights stage-artifacts `
  --org oddessentials --project oddessentials `
  --pipeline-id 15 --artifact ado-insights-db `
  --pat $env:PAT --out "$qaRoot\staged"
```

**Verify (CLI exit 0 + filesystem + schema post-condition):** 0a passes
when `stage-artifacts` exits 0 **and** the Python post-condition script
below asserts cleanly. Build the path in PowerShell, `Test-Path` it,
then hand it to Python as `argv[1]`. The Python one-liner is wrapped in
**single quotes** so PowerShell does no variable expansion inside it —
the path only enters Python via argv, avoiding any quoting /
interpolation trap that would make 0a false-fail on a correctly staged
fixture.

```powershell
$stagedDb = Join-Path $qaRoot "staged\ado-insights-db\ado-insights.sqlite"

if (-not (Test-Path $stagedDb)) {
    throw "0a FAILED: staged SQLite file not present at $stagedDb"
}

python -c 'import sys, sqlite3; p = sys.argv[1]; c = sqlite3.connect(p); v = c.execute("SELECT MAX(version) v FROM schema_version").fetchone()[0]; pr = c.execute("SELECT COUNT(*) FROM pull_requests").fetchone()[0]; has_meta = any(r[0] == "comments_extraction_metadata" for r in c.execute("SELECT name FROM sqlite_master WHERE type=?", ("table",)).fetchall()); assert pr > 0 and v is not None, "0a FAILED: fixture empty or unreadable"; print(f"schema_version={v}, pull_requests={pr}, has_metadata_table={has_meta}")' "$stagedDb"
```

If `Test-Path` returned true, `stage-artifacts` exited 0, and the Python
one-liner printed a line without raising `AssertionError`, 0a passed.

**Vintage check:** if the staged DB already lacks
`comments_extraction_metadata` (as pipeline 15's artifact did on
2026-04-17), `has_metadata_table` prints `False` — no synthetic strip is
needed, proceed straight to 0b. If `has_metadata_table=True` (fixture
pipeline refreshed after a migration bump), drop it explicitly so 0b
exercises the pre-migration shape — same argv-based pattern:

```powershell
python -c 'import sys, sqlite3; c = sqlite3.connect(sys.argv[1]); c.execute("DROP TABLE IF EXISTS comments_extraction_metadata"); c.commit(); c.close()' "$stagedDb"
```

Record the baseline row counts from `pull_requests`, `pr_threads`,
`pr_comments`, and the count of `comments_extracted_at IS NOT NULL` rows
for comparison after 0b.

#### 0b. Pipeline command path against the vintage DB

> **PAT scope:** Code (Read) for extraction

Mirrors the extension's `mode: extract` task with `includeComments=true`
— the exact invocation that crashed oddessentials build 332. Run
directly against the staged DB (no copy — we want any schema change made
by the migration to persist for inspection):

```powershell
ado-insights --artifacts-dir "$qaRoot\artifacts\0b-extract-with-comments" `
  extract `
  --organization oddessentials --projects "oddessentials,marketing,engineering,hospitality" `
  --pat $env:PAT `
  --database "$stagedDb" `
  --backfill-days 15 `
  --include-comments `
  --comments-max-prs-per-run 100 `
  --comments-max-threads-per-pr 50
```

Reusing `$stagedDb` set in 0a rather than rebuilding the path inline —
keeps the two scenarios pointing at the same file and avoids drift.

**Pre-written expected outcome** (post-#295 fix — this is what green
looks like):
- `exit_code == 0`
- Log line `Extracting PR comments (--include-comments enabled)` present
- No `sqlite3.OperationalError: no such table: comments_extraction_metadata`
  in stderr — this is the build-332 regression signature
- Terminal summary `[OK] SUCCESS: <N> PRs extracted, 0 CSVs written (<T>s)`

**DB post-state assertions:** same argv-based pattern as 0a — path
entered via `sys.argv[1]`, Python `-c` string single-quoted so PowerShell
cannot interpolate into it, SQL parameterized to sidestep quote-escape
issues.

```powershell
python -c 'import sys, sqlite3; p = sys.argv[1]; c = sqlite3.connect(p); c.row_factory = sqlite3.Row; v = c.execute("SELECT MAX(version) v FROM schema_version").fetchone()[0]; assert v == 6, f"0b FAILED: schema_version={v} (expected 6)"; has_meta = any(r[0] == "comments_extraction_metadata" for r in c.execute("SELECT name FROM sqlite_master WHERE type=?", ("table",)).fetchall()); assert has_meta, "0b FAILED: comments_extraction_metadata absent post-run"; row = c.execute("SELECT * FROM comments_extraction_metadata").fetchone(); assert row is not None, "0b FAILED: metadata singleton row never written"; processed = row["prs_processed"]; assert processed > 0, f"0b FAILED: prs_processed={processed} (expected > 0)"; print(f"0b verification passed: {dict(row)}")' "$stagedDb"
```

Only double-quoted strings inside the Python code so PowerShell's
single-quoted `-c` argument passes them through unchanged; the
`processed` local dodges the need for any `row['...']` key access that
would otherwise collide with the PowerShell string delimiter.

**Stop-and-report signals** (what build 332 produced pre-fix — any of
these means the #295 fix regressed):
- `sqlite3.OperationalError: no such table: comments_extraction_metadata`
- `exit_code != 0` despite a clean PR-extraction summary
- Post-run DB at `schema_version < 6`
- `comments_extraction_metadata` still absent post-run
- `prs_processed == 0` in the metadata row

If 0a + 0b both pass, the migration is honored against the real
production vintage. Scenarios 1–15 can proceed against `$qaRoot\qa.sqlite`.

---

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
- Scenario 0a's Python post-condition script raising an
  `AssertionError` — indicates the staged DB is empty, unreadable, or
  otherwise unusable and downstream scenarios have nothing to run against
- Scenario 0b exiting non-zero, producing a
  `sqlite3.OperationalError: no such table` traceback, leaving
  `schema_version < 6` post-run, or leaving `comments_extraction_metadata`
  absent — this is the #295 regression signature (oddessentials build 332)
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
