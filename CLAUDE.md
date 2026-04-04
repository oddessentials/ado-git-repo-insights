# ado-git-repo-insights Development Guidelines

## Active Technologies
- Python 3.12+ (backend, scripts, tests)
- TypeScript 6.x (extension UI, tests)
- pandas (aggregation), pytest (Python tests), Jest (TypeScript tests)
- ruff (Python linting), ESLint (TypeScript linting), mypy (type checking)
- esbuild (IIFE bundler), Playwright (smoke tests)

## Project Structure

```text
src/
tests/
```

## Commands

```bash
pytest                                    # Python tests
cd extension && pnpm test                 # Extension tests
python scripts/run_pr_preflight.py        # Authoritative local PR gate
```

## Code Style

Python 3.12+ (backend), TypeScript 6.x (frontend): Follow standard conventions

## Recent Changes
- 049-cross-platform-hardening: Replaced PowerShell ACL check with Python, build-demo.sh with build_demo.py, added SETUP/INFRA/GATE error categories, Node engine enforcement
- 048-https-github-com: mypy strict mode on src/ with disallow_any_generics = true
- 047-close-suppression-blindspot: Zero suppressions baseline, rule-disable audit infrastructure
- 046-migrate-ado-sdk: TypeScript 5.9.3, azure-devops-extension-sdk 4.x, esbuild 0.27.4

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
