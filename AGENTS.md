# ado-git-repo-insights Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-23

## Active Technologies
- TypeScript 5.x (UI rendering), CSS (styling) + Jest + JSDOM (testing), existing dom-harness.ts (test utilities) (036-dashboard-ux-polish)
- N/A — no data layer changes (036-dashboard-ux-polish)
- Python 3.10+ backend scripts, JSON artifact contracts, existing TypeScript 5.9 dashboard consumer + Existing demo generation scripts, `demo_generation_common`, pytest-based demo parity tests (037-add-reviewer-demo)
- Generated JSON files under `artifacts/demo-enterprise/data`, mirrored to `docs/data`, plus report and metadata files under `artifacts/demo-enterprise` (037-add-reviewer-demo)

- Python 3.10+ backend, TypeScript 5.9 frontend, PowerShell helper scripts + pandas/numpy for aggregation, requests/PyYAML for CLI runtime, pytest/ruff/mypy for Python verification, pnpm/jest/eslint/playwright for extension verification, VSS web extension SDK for dashboard runtime (034-roadmap-closure)

## Project Structure

```text
src/
tests/
```

## Commands

cd src; pytest; ruff check .

## Code Style

Python 3.10+ backend, TypeScript 5.9 frontend, PowerShell helper scripts: Follow standard conventions

## Recent Changes
- 037-add-reviewer-demo: Added Python 3.10+ backend scripts, JSON artifact contracts, existing TypeScript 5.9 dashboard consumer + Existing demo generation scripts, `demo_generation_common`, pytest-based demo parity tests
- 036-dashboard-ux-polish: Added TypeScript 5.x (UI rendering), CSS (styling) + Jest + JSDOM (testing), existing dom-harness.ts (test utilities)

- 034-roadmap-closure: Added Python 3.10+ backend, TypeScript 5.9 frontend, PowerShell helper scripts + pandas/numpy for aggregation, requests/PyYAML for CLI runtime, pytest/ruff/mypy for Python verification, pnpm/jest/eslint/playwright for extension verification, VSS web extension SDK for dashboard runtime

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
