# Research: Historical PR Thread Backfill Subcommand (058)

**Phase**: 0 (Outline & Research)
**Status**: complete — no `NEEDS CLARIFICATION` remains.
**Date**: 2026-04-16

## Purpose

`/speckit.plan` Phase 0 resolves every `NEEDS CLARIFICATION` marker introduced by the Technical Context. For feature 058, the 4-pass spec hardening (`spec.md` §§ "Spec-Hardening Pass", "Code-Validation Pass", "Planning-Readiness Pass") and the two pre-plan deliverables (consumer audit + discriminator designation) eliminated every architectural ambiguity before Pass 1 of the plan started. This document records the pre-plan findings as the authoritative Phase 0 research so subsequent planning passes and `/speckit.tasks` can cite a single source of truth.

## Research area 1 — FR-025d consumer audit of `run_summary.json`

### Method

Ripgrep sweep of the repository for readers of `run_summary.json` and its producer surface, covering `src/`, `tests/`, `scripts/`, `extension/`, `.github/`, `docs/`, and top-level YAML. Keywords: `run_summary`, `run_summary.json`, `RunSummary`, `RunCounts`, `RunTimings`, `prs_fetched`, `prs_updated`, `rows_per_csv`, `first_fatal_error`, `final_status`.

### Producer-side (not consumers)

- `src/ado_git_repo_insights/utils/run_summary.py` — the producer surface. `RunSummary` / `RunCounts` / `RunTimings` dataclasses; `RunSummary.to_dict()` serialization; `create_minimal_summary()`; `normalize_error_message()`; `get_tool_version()`; `get_git_sha()`. FR-025a forbids behavior changes to any of these. FR-030f golden-snapshot test enforces.
- `src/ado_git_repo_insights/cli.py:671-878, 2135-2182` — extract flow (`cmd_extract`) constructs and writes the artifact; `main()` writes the minimal-summary variant on `KeyboardInterrupt` and unexpected exception. FR-025 forbids modifying extract's behavior.
- `src/ado_git_repo_insights/types.py:50` — `RunSummaryDict` TypedDict consumed by the producer.

### Three-bucket classification of every reader

| # | Consumer | Path | What it reads | Bucket | Resolution |
|---|---|---|---|---|---|
| 1 | `test_cli_commands.py:58, 99` | `tests/unit/` | `(artifacts_dir / "run_summary.json").exists()` only | 1 (file-existence, no fields) | None |
| 2 | `test_cli_exit_code.py:301-304` | `tests/unit/` | `content.get("first_fatal_error", "").lower()` — checks minimal-summary shape on `KeyboardInterrupt` path | 2 (subcommand-agnostic field; FR-019c preserves this field for backfill's fatal-abort variant) | None |
| 3 | `test_cli_exit_code.py:355-356` | `tests/unit/` | `summary_path.exists()` only | 1 | None |
| 4 | `test_run_summary.py` (full file) | `tests/unit/` | Producer-side dataclass unit tests against synthetic data. Reads `d["counts"]["prs_fetched"]`, `d["final_status"]`, etc. on self-constructed fixtures; no flow-specific assumptions | 2 (producer unit tests; not flow-specific) | None. Backfill's FR-030f golden-snapshot test lives as a peer module in `tests/unit/test_run_summary_snapshot.py` |
| 5 | `test_version_resolver.py:176` | `tests/unit/` | Imports `get_git_sha` from run_summary module; doesn't read artifact | 1 | None |
| 6 | `insights-verification-test.yml:130` | top-level pipeline sample | `cat .../run_summary.json \|\| echo "No summary found"` — dumps content to pipeline log; no parsing, no assertions | 1 | None |
| 7 | `sample-pipeline.yml:137-143` | top-level pipeline sample | `PublishPipelineArtifact@1` publishes the artifacts directory; does not parse | 1 | None |
| 8 | `docs/user-guide/local-cli.md:531-544` | docs prose | Shows a JSON example whose field names do NOT match the real `RunSummary.to_dict()` output (references `status`, `start_time`, `end_time`, `total_prs`, `first_error` — none of which exist in the real schema). Pre-existing stale prose | 1 (docs, not a mechanical reader) | Follow-up issue recommended after 058 ships. FR-029/029a forbids docs edits on this branch |
| 9 | `docs/operations/runbook.md:170-183` | docs prose | Same stale JSON example as #8 | 1 | Same as #8 |
| 10 | `docs/user-guide/troubleshooting.md:214, 334-350` | docs prose | Operator guidance ("Ensure `run_summary.json` shows success", "`run_summary.json` contents"); no parsing | 1 | None |
| 11 | `docs/reference/architecture.md:25` | docs prose | Mermaid diagram label | 1 | None |
| 12 | `docs/operations/data-retention.md:112, 136, 186` | docs prose | Location references + invariant pointer to `test_run_summary.py` | 1 | None |
| 13 | `docs/internal/ado-pipeline-smoke-check.md:51` | docs prose | Table pointer to `test_run_summary.py` | 1 | None |
| 14 | `docs/development/testing.md:76` | docs prose | Table pointer | 1 | None |
| 15 | `CHANGELOG.md` | docs prose | Historical mention | 1 | None |
| 16 | `scripts/stamp-extension-version.cjs:5` | build script | Comment string only (`VERSION (plain text for run_summary.py)`) | 1 | None |
| 17 | `.github/workflows/*.yml` (ai-review, demo, release, ci) | CI | **Zero matches** — no CI workflow reads `run_summary.json` | 1 | None |
| 18 | `extension/**` | extension | **Zero matches** | 1 | None |

### Finding

**Bucket 3 count: 0.** No consumer in the repository reads `counts.prs_fetched` as a liveness signal, treats `counts.rows_per_csv` as guaranteed-populated, or treats `counts.prs_updated == 0` as an invariant. The FR-019d pre-authorized fallback (`counts.prs_updated = 0` + warnings-entry surfacing) is therefore **not triggered**. Backfill sets `counts.prs_updated = Processed` directly.

### Pre-existing drift flagged but out of scope

Items #8 and #9 describe a JSON shape that predates (and does not match) the current `RunSummary.to_dict()` output. This drift is **not a regression this feature must fix**. FR-029/029a forbids docs edits on the 058 branch. Recommendation: file a follow-up doc-correction issue after 058 merges.

## Research area 2 — Authoritative backfill/extract discriminator

### Method

Evaluate each candidate (A) warnings-prefix, (B) `rows_per_csv` shape, (C) joint condition across the 5 required backfill artifact states (loop-complete success, loop-complete partial/100%-failure, empty-selection, legacy-schema no-op, fatal pre-loop abort) AND against every extract artifact state (success, partial-project-failure, fatal pre-loop abort).

### Candidate evaluation

| Candidate | Loop-complete zero-failure | Loop-complete partial/100% failure | Empty-selection | Legacy-schema no-op | Fatal pre-loop abort |
|---|---|---|---|---|---|
| (A) warnings-prefix `"backfill-comments: "` | ❌ empty by default (no FR-019b entries) | ✅ FR-019b entries fire | ❌ empty by default | ✅ FR-017a entry fires | ❌ `create_minimal_summary` hardcodes `warnings=[]` |
| (B) `rows_per_csv == {}` | ✅ | ✅ | ✅ | ✅ | ❌ **also true for extract failure summary** — `cmd_extract` at `cli.py:748-762` uses default `RunCounts()` → `rows_per_csv={}` on project failure |
| (C) `prs_fetched==0 AND prs_updated>0` | ✅ (Processed > 0) | ❌ `prs_updated=0` when 100% failure | ❌ `prs_updated=0` on empty selection | ❌ `prs_updated=0` on legacy-schema | ❌ both fields are 0 |

No candidate is reliable out-of-the-box.

### Decision

**(A) warnings-prefix**, hardened by elevating the "at least one `backfill-comments: ` warning entry" requirement from implementation detail to **first-class artifact invariant** (confirmed by the user at the end of the pre-plan phase). The invariant binds 5 artifact states and 4 implementation sites (see plan.md §4 for the site table).

### Rejected alternatives and why

- **(B) `rows_per_csv == {}`**: ambiguous with extract's own failure path, where the default `RunCounts().rows_per_csv == {}` holds before any CSV generation completes. Candidate fails on fatal pre-loop abort shape disambiguation.
- **(C) joint `prs_fetched==0 AND prs_updated>0`**: fails on 3 of the 5 required backfill states (legacy-schema, empty-selection, 100%-failure — all have `prs_updated=0`).
- **Adding a new typed field to `RunSummary`** (e.g., `subcommand: Literal["extract", "backfill-comments"]`): rejected — violates FR-025a, which pins the `RunSummary.to_dict()` key set as a preserved surface.

### Exact consumer check form

```python
def is_backfill_artifact(artifact: dict[str, object]) -> bool:
    """Return True iff produced by the backfill-comments subcommand.

    Relies on the first-class artifact invariant: every backfill-produced
    artifact state (loop-complete, partial/100%-failure, empty-selection,
    legacy-schema no-op, fatal pre-loop abort) carries at least one
    warnings entry prefixed with "backfill-comments: ".
    """
    warnings = artifact.get("warnings", [])
    if not isinstance(warnings, list):
        return False
    return any(
        isinstance(w, str) and w.startswith("backfill-comments: ")
        for w in warnings
    )
```

## Research area 3 — HEAD re-verification of load-bearing spec claims

### Method

Cross-check every cli.py line reference and every external-file reference the spec makes against the current HEAD of the `058-backfill-comments` branch. Report any drift that would require the plan to regenerate its references.

### Findings

Zero material drift. Every cited location is current.

| Spec claim | Cited location | HEAD location | Status |
|---|---|---|---|
| Truncation-preserve branch (latent bug, FR-015) | `cli.py:616-621` (within 3-case block `cli.py:601-628`) | Preserve branch at `cli.py:616-621` (`elif _dropped_threads_all_stored(...): pass` + comment `# Prior stamp (if any) correctly reflects completeness` at line 620), inside the 3-case block `cli.py:610-628` | ✅ Exact match |
| `counts.prs_fetched = summary.total_prs` | `cli.py:725` | `cli.py:725` | ✅ Exact match |
| `_extract_comments` per-PR body (refactor target, FR-015a) | `cli.py:510-651` | Function definition at `cli.py:457`; per-PR loop body at `cli.py:510-651`; function returns at `cli.py:662` | ✅ Confirmed |
| `_dropped_threads_all_stored` helper (pure; safe to share, FR-015a) | — | `cli.py:960-996` — pure predicate; reads DB only for lookup, no side effects | ✅ Confirmed |
| `pr_threads` / `pr_comments` table-creation migrations (legacy-schema detection target, FR-017) | — | `src/ado_git_repo_insights/persistence/migrations.py`: `CREATE TABLE pr_threads` at line 211, `CREATE TABLE pr_comments` at line 226; `_ensure_v4_pr_threads` at line 274; `_ensure_v4_pr_comments` at line 352 | ✅ Confirmed |
| `comments_extracted_at` column (coverage marker, FR-002/FR-015) | — | `migrations.py:78-92` (`ALTER TABLE pull_requests ADD COLUMN comments_extracted_at TEXT`) | ✅ Confirmed |
| `test_extract_comments.py` regression-lock (FR-034) | — | 759 LOC, 19 test methods across 7 test classes (`TestExtractCommentsStamping`, `TestPerThreadIncrementalSync`, `TestExtractBackfillAggregatePipeline`, `TestLegacyCoverageFallback`, `TestPrsCommentFailuresCounter`, `TestCoverageFallbackExceptionPaths`, `TestCorruptedMetadata`) — locks all three stamp branches + failure counter + end-to-end pipeline | ✅ Confirmed; FR-015a's refactor must not alter any assertion in this file |
| `run_summary.py` dataclass field set (FR-019d, FR-025a) | — | `RunSummary` dataclass at `run_summary.py:61-76`; `to_dict()` at `run_summary.py:83-109` produces exactly the field set the spec enumerates | ✅ Confirmed |
| Constitution v1.5.0 | `.specify/memory/constitution.md` | First version block: `Version Change: 1.4.0 → 1.5.0`; line 607: `**Version**: 1.5.0 \| **Ratified**: 2026-01-26 \| **Last Amended**: 2026-04-16` | ✅ Confirmed |
| Python test floor | 1814 | `.test-floor-contract.json::python::min_collected = 1814` (with `authority: scripts.check_ratchet_bump.collect_python_snapshot(apply_platform_filters=True)`) | ✅ Confirmed |

## Research area 4 — Commit-boundary discovery (surfaced during HEAD re-verification)

### Finding

Extract's current `_extract_comments` function (`cli.py:457-662`) commits **once** at the end of the per-PR loop (`db.connection.commit()` at `cli.py:653`). This is not per-PR atomicity in the sense FR-012 requires; extract's commit boundary is the **entire loop**, not an individual PR.

### Consequence for FR-015a/b helper shape

The plan-locked `_fetch_and_upsert_threads_for_pr(client, db, repo, pr_row, max_threads_per_pr) -> FetchOutcome` helper MUST perform thread/comment/user upserts but MUST NOT call `db.connection.commit()`. The commit boundary is a **caller-side responsibility** — in parallel to the stamp-decision responsibility FR-015a already locked:

- **Extract's caller** (`_extract_comments` loop body): calls the helper, applies the existing 3-case stamp logic inline, continues the loop; preserves the existing single `db.connection.commit()` at end-of-loop. No observable change to extract (FR-025).
- **Backfill's caller** (`cmd_backfill_comments` loop body): calls the helper, applies the simplified 2-outcome stamp logic, **commits per-PR** inside each iteration on the `ok` path; **rolls back per-PR** on `ExtractionError`. Satisfies FR-012 (atomic write set) + FR-013 (full roll-back) + FR-013a (interrupt leaves pre-iteration state).

### Rationale for surfacing here

This is not a spec change — FR-015a already specifies caller-side stamp decision-making, and FR-012 is explicit about per-PR atomicity. The commit-boundary nuance is simply the necessary corollary of those two spec clauses. Recording it here prevents mid-implementation "discovery" drift between Pass 1 and Pass 3.

## Research area 5 — Filter parser reuse decision (FR-004, FR-005)

### Method

Inspect extract's argparse wiring in `create_parser()` at `cli.py:69-163` for `--projects`, `--start-date`, `--end-date`. Evaluate whether extract already exposes a shared helper that backfill can reuse, versus inlining.

### Findings

- `extract_parser.add_argument("--projects", type=str, ...)` (`cli.py:108-112`) accepts a raw comma-separated string; normalization happens downstream in `config.load_config` via `ConfigurationError`-raising parsing. The parser itself does not split / trim.
- `extract_parser.add_argument("--start-date", type=str, ...)` / `--end-date` (`cli.py:130-139`) accept raw strings. Validation of the `YYYY-MM-DD` shape happens inside `load_config` as well.
- Numeric flags use `_non_negative_int` as the argparse `type=` (`cli.py:154, 160`). This is a module-local helper in `cli.py`.

### Decision (FR-005 compliance)

- Backfill's **`--limit`** and **`--comments-max-threads-per-pr`** flags reuse the existing `_non_negative_int` validator directly.
- Backfill's **`--projects`** uses `type=str` at argparse level and applies the same normalization rules as `load_config`'s projects parser. The implementation extracts `load_config`'s existing projects-parsing logic into a pure function (`_parse_projects_list(raw: str) -> list[str]`) exposed from the `config` module, and both flows consume it. This is a **behavior-preserving refactor** — extract's observable output is unchanged. The FR-030d parity test feeds an identical input corpus to both flows and asserts matching outcomes.
- Backfill's **`--since` / `--until`** uses `type=str` at argparse level and applies the same date-shape validation as extract. Extract's date validation is currently inlined inside `load_config`; the implementation extracts it to a pure function (`_parse_iso_date(raw: str) -> date`) in the `config` module consumed by both flows. Same FR-030d parity test applies.
- **Extract's observable behavior is preserved**: refactoring inline validation into a pure helper that extract then uses does not change extract's accept/reject behavior for any input. The FR-030f golden-snapshot test is not affected because it exercises `RunSummary.to_dict() / create_minimal_summary / normalize_error_message`, not `load_config`.

### Alternative considered and rejected

Backfill-local duplicate validators with a parity test against extract's inlined validators. Rejected because:
1. Duplication violates DRY at the cost of creating a second parser path that must track extract's any future changes.
2. The "extract to a pure function, have both consumers call it" path is explicitly allowed by FR-025a ("Harmless internal refactors — comment rewording, import reorder, body refactor that preserves all observable behavior — are explicitly ALLOWED").
3. The FR-030d parity test is simpler against a single shared helper (trivially true) than against two helpers (requires running the extract path).

## Research area 6 — FR-024a forbidden-keyword surface (FR-024a, FR-030j)

### Method

Enumerate every user-visible surface the backfill subcommand produces and list the FR-024a forbidden keywords alongside permitted-qualifier forms.

### Surfaces

1. `--help` output (argparse-rendered from the subparser's `description=`, `epilog=`, and per-flag `help=` strings).
2. `INFO` log lines: FR-018a anchor + FR-018b per-PR progress.
3. `WARNING` log lines: FR-017 legacy-schema, FR-019b per-failure.
4. Artifact `warnings` list entries: FR-017a legacy-schema-skip, FR-019b per-failure, the new loop-complete / fatal-abort entries from plan §4.
5. Artifact `first_fatal_error` string on fatal-pre-loop aborts (`normalize_error_message` output — already bounded and URL-scrubbed; FR-024a still applies to the pre-normalized upstream message).
6. Terminal summary line (FR-018).

### Forbidden keyword list (FR-024a)

| Keyword | Forbidden form | Permitted form |
|---|---|---|
| `thread-safe` | any occurrence | none (backfill makes no thread-safety claim) |
| `concurrent` | any occurrence that implies safety | none (backfill makes no concurrency-safety claim) |
| `atomic` | bare usage or usage implying > per-PR scope | `per-PR atomic` or `atomic per pull request` (bounded qualifier) |
| `complete` | usage implying DB-wide coverage (`backfill is complete`, `database is complete`) | `coverage marker records completeness`, `dropped threads are all stored and current` (bounded qualifier) |
| `resumable` | bare usage without FR-012/013 qualification | `resumable at per-PR commit boundaries (per FR-012/FR-013)` — phrased such that the reader understands the specific guarantee |

### Scan test (FR-030j)

Drives a controlled-fixture mixed-outcome run, captures the `--help` output, the log stream, and the artifact `warnings` + `first_fatal_error` content; scans for the forbidden forms above; fails on any unqualified occurrence. The test body enumerates the forbidden patterns as a `frozenset[str]` constant at module scope for referential stability.

## Summary: no `NEEDS CLARIFICATION` remains

| Technical Context field | Status |
|---|---|
| Language/Version | Resolved — Python 3.12+ |
| Primary Dependencies | Resolved — argparse, sqlite3, requests, pytest, MagicMock (all existing) |
| Storage | Resolved — SQLite schema v4+ unchanged |
| Testing | Resolved — pytest + MagicMock-backed ADOClient |
| Target Platform | Resolved — Windows/macOS/Linux (QG-39) |
| Project Type | Resolved — CLI subcommand |
| Performance Goals | Resolved — dominated by API latency; linear in `T` |
| Constraints | Resolved — FR-011a / FR-012 / FR-013/13a / FR-015 / FR-018c / FR-024a / FR-025a–c / FR-029/29a |
| Scale/Scope | Resolved — tens of thousands of PRs; `--limit 0` unbounded sentinel |

Phase 1 (`data-model.md`, `contracts/`, `quickstart.md`) can proceed.
