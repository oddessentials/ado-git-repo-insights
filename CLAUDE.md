# ado-git-repo-insights Development Guidelines

## Active Technologies
- Python 3.12+ (backend, scripts, tests)
- TypeScript 6.x (extension UI, tests)
- pandas (aggregation), pytest (Python tests), Jest (TypeScript tests)
- ruff (Python linting), ESLint (TypeScript linting), mypy (type checking)
- esbuild (IIFE bundler), Playwright (smoke tests)
- Python 3.12+ (backend, scripts, tests) — matches existing CLI and `cli.py` annotation set. + existing — `argparse` (parser), `sqlite3` via `DatabaseManager` (persistence), `requests` via `ADOClient` (upstream API), `pytest` + `unittest.mock.MagicMock` (tests). No new third-party dependencies. (058-backfill-comments)
- SQLite via `DatabaseManager`. Reuses schema v4+; no schema changes introduced (FR-027). Uses `pull_requests.comments_extracted_at`, `pr_threads`, `pr_comments`, `users` tables that already exist (migrations.py:78-92, 211, 226). (058-backfill-comments)

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
- 058-backfill-comments: Added Python 3.12+ (backend, scripts, tests) — matches existing CLI and `cli.py` annotation set. + existing — `argparse` (parser), `sqlite3` via `DatabaseManager` (persistence), `requests` via `ADOClient` (upstream API), `pytest` + `unittest.mock.MagicMock` (tests). No new third-party dependencies.
- 052-review-time-pipeline: Added Python 3.12+ (backend pipeline), TypeScript 6.x (extension UI — no changes needed) + pandas (aggregation), requests (ADO API client), sqlite3 (persistence), pytest (testing)
- 049-cross-platform-hardening: Replaced PowerShell ACL check with Python, build-demo.sh with build_demo.py, added SETUP/INFRA/GATE error categories, Node engine enforcement

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
