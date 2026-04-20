# Teams Extraction — Live QA Runbook

End-to-end manual validation for `_extract_teams()` in `cmd_extract`, the
`AdoTeamMember` / `AdoTeam` TypedDicts, and the `teams` / `team_members`
migration path. Run this before merging any branch that touches those
surfaces.

## What this QA catches that unit tests cannot

- **Migration gaps** — A new `CREATE TABLE` in `models.py` `SCHEMA_SQL`
  without a paired migration slips past every unit test that uses a
  fresh DB (#295 pattern, caught by scenario 0).
- **API shape drift** — Unit tests use mocks. If a mock mirrors a wrong
  TypedDict, every unit test passes for the wrong reason. Live probes
  against real ADO responses are the only surface that can falsify the
  assumed shape (#296 pattern, caught by scenario 1 in a single run).
- **Caller wiring gaps** — A data plane (`ADOClient.get_teams` etc.)
  that no caller invokes produces no runtime errors; the dimension
  stays silently empty for months (#296 symptom, caught by scenario 4).

> **Invariant this QA protects:** end-to-end parity between ADO API
> responses and the persisted DB shape. Unit tests may pass with
> incorrect mocks. This runbook is the only layer that cannot.

For the pre-write discipline that applies to every scenario below, see
[Backfill Comments — Live QA Runbook §Discipline][backfill-discipline].

---

## Prerequisites

- Python development environment per [Development Setup][setup]
- `ado-insights` installed (`uv tool install -e .` or `pip install -e .`)
- `sqlite3` CLI for DB inspection
- `curl` for the API probe in scenario 1
- Azure DevOps PAT with **Build (Read)** + **Code (Read)** +
  **Project and Team (Read)** scopes
- Node 22+ only if scenario 5 is being explicitly re-verified

---

## Target configuration

Run against a multi-project organization. The `oddessentials` values
below are maintainer examples. Project names are case-sensitive and
exact; discover them before running:

```bash
AUTH=$(printf ":%s" "$ADO_PAT" | base64 -w 0)
curl -s -H "Authorization: Basic $AUTH" \
  "https://dev.azure.com/<org>/_apis/projects?api-version=7.1-preview.1" \
  | python -c "import sys,json; print([p['name'] for p in json.load(sys.stdin).get('value',[])])"
```

Use a tight `--backfill-days 1` window: team extraction is project-scoped
and does not depend on PR volume, so bundled PR extract stays fast.

---

## Setup (every run)

- `$qaRoot` = working directory (staged DB + aggregates output)
- `ADO_PAT` exported to environment; not written to disk
- Scenario 0 runs against a **production-vintage** DB pulled from
  pipeline 15. Scenarios 1–4 run against the same staged DB so the
  migration gate from 0 is load-bearing

---

## STOP-AND-REPORT

**If, at any point during scenario 1, the API team count for any
project does not equal the DB team count for that project, halt
immediately.** Do not proceed to scenarios 2 / 4 / 5. Capture the
divergence (project, API count, DB count), attach the most recent
`extract` log, and stop. Parity divergence is the exact signal the
mocks-passed-for-the-wrong-reason bug class produces.

---

## Scenario 0 — Production-vintage migration gate

Stage the real pipeline 15 artifact and run `extract` against it. On a
pre-Phase-3.3 vintage DB this exercises the `migrate_v6_to_v7` path that
creates `teams` / `team_members`. On a post-Phase-3.3 vintage DB (the
current pipeline 15 shape) the migration is a no-op; either way the
post-migration `_REQUIRED_TABLES` sweep and `_extract_teams()` wiring
both run.

```bash
python -m ado_git_repo_insights.cli stage-artifacts \
  --org <org> --project <project> \
  --pipeline-id 15 --artifact ado-insights-db \
  --pat "$ADO_PAT" --out "$qaRoot/staged"

python -m ado_git_repo_insights.cli \
  --artifacts-dir "$qaRoot/artifacts/s0" \
  extract \
  --organization <org> --projects <one project> \
  --pat "$ADO_PAT" \
  --database "$qaRoot/staged/ado-insights-db/ado-insights.sqlite" \
  --backfill-days 1
```

**Assertions** (pre- vs post-):

- `schema_version` = 7 after the run (migration chain terminates at latest)
- `teams` and `team_members` tables present
- No uncaught Python exception in the log (the `KeyError: 'identity'`
  incident below is a regression indicator)
- Log contains `teams: extracting teams across N PR-successful project(s)`
  and `teams: extracted X teams / Y members across N PR-successful
  projects (K skipped)`

---

## Scenario 1 — Fresh multi-project extract + API parity

Run `extract` with all discovered projects, then probe each project's
team count via the ADO API and compare to the DB. **This is the primary
shape-drift detector.**

```bash
python -m ado_git_repo_insights.cli \
  --artifacts-dir "$qaRoot/artifacts/s1" \
  extract \
  --organization <org> --projects <comma-separated project list> \
  --pat "$ADO_PAT" \
  --database "$qaRoot/staged/ado-insights-db/ado-insights.sqlite" \
  --backfill-days 1

# API ground truth per project
for p in <project list>; do
  curl -s -H "Authorization: Basic $AUTH" \
    "https://dev.azure.com/<org>/_apis/projects/$p/teams?api-version=7.1-preview.1" \
    | python -c "import sys,json; d=json.load(sys.stdin); print(f'API $p: {len(d.get(\"value\",[]))} teams')"
done

# DB count per project
sqlite3 "$qaRoot/staged/ado-insights-db/ado-insights.sqlite" \
  "SELECT project_name, COUNT(*) FROM teams GROUP BY project_name"
```

**Assertions**:

- API count and DB count match for **every** project (see
  STOP-AND-REPORT above)
- `team_members` total > 0 and `user_id` values in `team_members` join
  cleanly to `users`
- No WARNING matching `skipping malformed member in` (indicates
  `AdoTeamMember` shape drift — see real-incident log below)

---

## Scenario 2 — Idempotent re-run

Re-run the exact command from scenario 1 without modifying the DB.

**Assertions**:

- `teams` and `team_members` row counts unchanged from scenario 1
  (upsert + clear-then-refill semantics)
- `SELECT COUNT(DISTINCT team_id) FROM teams` unchanged
- No migration log entries (already at v7)

---

## Scenario 3 — Per-project 403 (permission skip)

Unit-test covered by
`tests/unit/test_team_extraction.py::TestExtractTeamsPipeline::test_project_team_fetch_403_logs_and_continues`
via `get_teams` raising `ExtractionError`. Live-simulating a 403
requires a scope-restricted PAT, which adds setup churn without adding
confidence. Do not duplicate here unless investigating a specific
permission-related regression.

---

## Scenario 4 — Aggregator features.teams flip

```bash
python -m ado_git_repo_insights.cli \
  --artifacts-dir "$qaRoot/artifacts/s4" \
  generate-aggregates \
  --database "$qaRoot/staged/ado-insights-db/ado-insights.sqlite" \
  --output "$qaRoot/aggregates-out"

python -c "import json; m=json.load(open(r'$qaRoot/aggregates-out/dataset-manifest.json')); \
  print('features.teams =', m['features']['teams']); \
  print('coverage.teams_count =', m['coverage']['teams_count'])"
```

**Assertions**:

- `features.teams == True`
- `coverage.teams_count` equals `SELECT COUNT(*) FROM teams` from
  scenario 1's DB

---

## Scenario 5 — Extension wrapper parity (structural)

Option (a) in the #296 plan: team extraction is always-on via the
existing `extract` code path. There is no new task input, no new env
var, no task.json change. The extension wrapper at
`extension/tasks/extract-prs/index.js` invokes the Python CLI unchanged.

**Assertion** — a single grep, not a run:

```bash
grep -E 'team|includeTeam|extract_teams' extension/tasks/extract-prs/*.{js,json}
```

Must return no matches. Any hit means the wrapper has started making
team-specific decisions and the shape-drift blast radius has widened
past the CLI.

---

## Done criteria

- [ ] Scenario 0: `schema_version` at latest, teams / team_members
      tables present
- [ ] Scenario 1: API / DB team count parity for every project
- [ ] Scenario 2: row counts stable across re-run
- [ ] Scenario 4: `features.teams=True`, `coverage.teams_count`
      matches DB
- [ ] Scenario 5: grep returns no team-specific decision in the
      extension wrapper

If any item fails, STOP-AND-REPORT above applies.

---

## Real incident log

- **2026-04-19** — First live run of scenario 0 for PR #296 surfaced
  `KeyError: 'identity'` in `_extract_teams` immediately after the
  migration completed cleanly. Root cause: Phase 3.3 `AdoTeamMember`
  TypedDict assumed a nested `{identity: {id, displayName}, isTeamAdmin}`
  shape. Real ADO `GET _apis/projects/{p}/teams/{t}/members` returns a
  flat IdentityRef (`id`, `displayName`, `uniqueName`, ...). Every unit
  test in `test_team_extraction.py` passed because mocks mirrored the
  wrong TypedDict. Fix: types.py + cli.py + all 5 affected mocks
  updated in a single commit; a defensive per-field skip with specific
  WARNING prose was added so any future shape drift logs instead of
  crashing. Time-to-detection: ~3 seconds after the first
  `get_team_members` call. **This is the canonical example of why this
  QA exists.**

[backfill-discipline]: backfill-live-qa.md#discipline-pre-write-expectations-before-every-scenario
[setup]: ../development/setup.md
