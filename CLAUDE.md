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
```

## Code Style

Python 3.12+ (backend), TypeScript 6.x (frontend): Follow standard conventions

## Recent Changes
- 060-throughput-pr-drilldown: Added Python 3.12+ (backend, aggregator, scripts, tests) and TypeScript 6.0.3 (extension UI). Matches existing invariants. + existing. Backend: `argparse`, `sqlite3`, `pandas`, `pytest`. Extension: `@types/node`, Jest 30.x, jsdom 28.x, VSS SDK (`azure-devops-extension-sdk`). No new third-party runtime dependencies.
- 059-chart-drill-down: Added TypeScript 6.0.3 (extension UI), Jest 30.x test runner, jsdom 28.x test environment. + No new runtime dependencies. Reuses `extension/ui/modules/shared/{render,security,chart-layout,host-resize,svg-path}.ts` (shared primitives), `extension/ui/modules/tooltip-manager.ts` (overlay lifecycle pattern reference), `extension/ui/modules/typeahead-dropdown.ts` (combobox/listbox a11y pattern reference), `extension/ui/modules/charts/{throughput,cycle-time,reviewer-activity,summary-cards}.ts` (click target hosts).
- 058-backfill-comments: Added Python 3.12+ (backend, scripts, tests) — matches existing CLI and `cli.py` annotation set. + existing — `argparse` (parser), `sqlite3` via `DatabaseManager` (persistence), `requests` via `ADOClient` (upstream API), `pytest` + `unittest.mock.MagicMock` (tests). No new third-party dependencies.

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
