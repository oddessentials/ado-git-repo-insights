# ado-git-repo-insights Development Guidelines

## Active Technologies
- Python 3.12+ (backend, scripts, tests)
- TypeScript 6.x (extension UI, tests)
- pandas (aggregation), pytest (Python tests), Jest (TypeScript tests)
- ruff (Python linting), ESLint (TypeScript linting), mypy (type checking)
- esbuild (IIFE bundler), Playwright (smoke tests)
- Python 3.12+ (backend, scripts, tests) — matches existing CLI and `cli.py` annotation set. + existing — `argparse` (parser), `sqlite3` via `DatabaseManager` (persistence), `requests` via `ADOClient` (upstream API), `pytest` + `unittest.mock.MagicMock` (tests). No new third-party dependencies. (058-backfill-comments)
- SQLite via `DatabaseManager`. Reuses schema v4+; no schema changes introduced (FR-027). Uses `pull_requests.comments_extracted_at`, `pr_threads`, `pr_comments`, `users` tables that already exist (migrations.py:78-92, 211, 226). (058-backfill-comments)
- TypeScript 6.0.3 (extension UI), Jest 30.x test runner, jsdom 28.x test environment. + No new runtime dependencies. Reuses `extension/ui/modules/shared/{render,security,chart-layout,host-resize,svg-path}.ts` (shared primitives), `extension/ui/modules/tooltip-manager.ts` (overlay lifecycle pattern reference), `extension/ui/modules/typeahead-dropdown.ts` (combobox/listbox a11y pattern reference), `extension/ui/modules/charts/{throughput,cycle-time,reviewer-activity,summary-cards}.ts` (click target hosts). (059-chart-drill-down)
- N/A. Panel state is ephemeral per session view; nothing persists across reloads (FR-009). URL / localStorage are NOT touched by drill-down code. (059-chart-drill-down)
- Python 3.12+ (backend, aggregator, scripts, tests) and TypeScript 6.0.3 (extension UI). Matches existing invariants. + existing. Backend: `argparse`, `sqlite3`, `pandas`, `pytest`. Extension: `@types/node`, Jest 30.x, jsdom 28.x, VSS SDK (`azure-devops-extension-sdk`). No new third-party runtime dependencies. (060-throughput-pr-drilldown)
- SQLite via existing `DatabaseManager`. No schema changes; no migrations. All PR fields already present on `pull_requests` table (models.py:72-90). (060-throughput-pr-drilldown)
- Python 3.12+ (backend, aggregator, scripts, tests). Matches existing baseline. TypeScript 6.0.3 is present (extension UI) but THIS FEATURE MAKES NO EXTENSION CODE CHANGES — the extension already renders whatever `prs` payload arrives; scope stops at backend + demo generator. + existing only — `argparse`, `pathlib`, `json`, `random`, `sqlite3` via `DatabaseManager`, `requests` via `ADOClient` (one-time extract only), `pytest` + `unittest.mock.MagicMock`. No new third-party runtime or dev dependencies. (309-demo-pr-drilldown)
- Python 3.12+ (backend, aggregator, scripts, tests) and TypeScript 6.0.3 (extension UI). Matches existing invariants. + existing only — `argparse`, `pathlib`, `json`, `sqlite3` via `DatabaseManager`, `pandas` (aggregator group-by), `pytest` + `unittest.mock.MagicMock` (Python tests), Jest 30.x + jsdom 28.x (extension tests). No new third-party runtime or dev dependencies. (310-comments-visualization)
- SQLite via existing `DatabaseManager`. No schema changes; no migrations. Reads `pr_threads`, `pr_comments`, `pull_requests.comments_extracted_at` — all present since Feature 058. INV-06 (extractor frozen) preserved. (310-comments-visualization)
- Python 3.12+ (backend, aggregator, scripts, tests) and TypeScript 6.0.3 (extension UI). Matches existing baseline per `CLAUDE.md`. + existing only — Backend: `argparse`, `sqlite3` via `DatabaseManager`, `pandas` (aggregator group-by), `pytest` + `unittest.mock.MagicMock`. Extension: Jest 30.x + jsdom 28.x test environment, esbuild bundler, VSS SDK runtime. **No new third-party runtime or dev dependencies.** (feat/334-comments-author-density)
- SQLite via existing `DatabaseManager`. **No schema changes; no migrations.** Reads `pr_threads`, `pr_comments`, `pull_requests.comments_extracted_at`, `users` (LEFT JOIN for sentinel detection per FR-1-03 / CL-03) — all present since Feature 058. INV-2-05 (extractor frozen, inherits 310 INV-06 / 333 INV-1-05) preserved. (feat/334-comments-author-density)
- Python 3.12+ (backend, aggregator, scripts, tests) and TypeScript 6.0.3 (extension UI). Matches existing baseline. + existing only — Backend: `argparse`, `sqlite3` via `DatabaseManager`, `pandas` (aggregator group-by), `pytest` + `unittest.mock.MagicMock`. Extension: Jest 30.x + jsdom 28.x test environment, esbuild bundler, VSS SDK runtime. **No new third-party runtime or dev dependencies.** (feat/335-comments-repo-density)
- SQLite via existing `DatabaseManager`. **No schema changes; no migrations.** Reads `pr_threads`, `pr_comments`, `pull_requests.repository_id`, `pull_requests.comments_extracted_at` — all present since Feature 058. INV-3-05 (extractor frozen, inherits 310 INV-06 / 333 INV-1-05 / 334 INV-2-05) preserved. NO LEFT JOIN `users` (no sentinel — `repository_id` is FK-protected per CL-03 / INV-3-12). (feat/335-comments-repo-density)

## Project Structure

```text
src/
tests/
```

## Commands

```bash
python scripts/run_pytest.py              # Python tests (coverage-safe launcher)
cd extension && pnpm test                 # Extension tests
python scripts/run_pr_preflight.py        # Authoritative local PR gate
pnpm clean:dry                            # Preview ephemeral sweep (exit 0=empty, 3=work pending, 2=setup error)
pnpm clean                                # Apply ephemeral sweep (delegates to scripts/clean_ephemeral.py)
```

## Code Style

Python 3.12+ (backend), TypeScript 6.x (frontend): Follow standard conventions

## Recent Changes
- 361-cycle-time-pr-drilldown: Added TypeScript 6.0.3 (extension UI). Matches existing baseline. Python 3.12+ baseline applies repo-wide but is not exercised by this feature (no producer-side change). + existing only — Jest 30.x + jsdom 28.x test environment, esbuild bundler, VSS SDK runtime. **No new third-party runtime or dev dependencies.**
- feat/335-comments-repo-density: Added per-repo comments-density breakdown spec + plan + research + data-model + contract + quickstart. New rollup-root `by_repository_comments` outer dict (4 fields, gated, atomic per INV-3-08); NEW FR-2-03 cross-aggregate sum-coherence contract on truncated W26 closes deferred 333/334 cross-aggregate parity. NO sentinel concept (CL-03 — `repository_id` FK-protected); display label = `repository_name` from dimension with raw-ID fallback (CL-04). Pattern duplicated from #334 per A-08; abstraction extraction deferred to #336.
- feat/334-comments-author-density: Added Python 3.12+ (backend, aggregator, scripts, tests) and TypeScript 6.0.3 (extension UI). Matches existing baseline per `CLAUDE.md`. + existing only — Backend: `argparse`, `sqlite3` via `DatabaseManager`, `pandas` (aggregator group-by), `pytest` + `unittest.mock.MagicMock`. Extension: Jest 30.x + jsdom 28.x test environment, esbuild bundler, VSS SDK runtime. **No new third-party runtime or dev dependencies.**

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
specs/361-cycle-time-pr-drilldown/plan.md
<!-- SPECKIT END -->
