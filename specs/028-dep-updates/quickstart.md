# Quickstart: Dependency Updates

**Feature**: 028-dep-updates
**Date**: 2026-02-10

## Prerequisites

- Access to merge PRs on the GitHub repository
- Local development environment with Python 3.11+, Node 22, pnpm 9.15.0
- All current CI checks passing on main

## Execution Order

### Batch 1: Safe Patch Updates + Lockfile Refresh

**Time estimate**: ~20 minutes

1. **Apply patch-level updates** in `extension/package.json`:
   - `dependency-cruiser` 17.3.7 → 17.3.8
   - `serve` 14.2.0 → 14.2.5
   - `@types/node` 25.1.0 → 25.2.2
   - Update `extension/tests/meta/playwright-version-guard.test.ts` serve version assertion

2. **Install and verify**: `cd extension && pnpm install && pnpm test:ci`

3. **Refresh lockfiles**
   - In `extension/`: run lockfile refresh and verify tests pass
   - In root: run lockfile refresh
   - Commit all changes, push, verify CI

### Batch 2: CI Action Upgrade

**Time estimate**: ~15 minutes

1. **Verify runner compatibility**
   - Check a recent CI run log for runner version (should be ≥2.327.1)

2. **Update workflow**
   - Change `actions/cache@v4` to `actions/cache@v5` in `.github/workflows/ci.yml`
   - Commit, push to feature branch, verify all CI jobs pass
   - Merge to main

### Batch 3a: Ruff Migration (Separate Session)

**Time estimate**: ~1 hour

1. Update `pyproject.toml`: change `ruff==0.14.14` to `ruff==0.15.0`
2. Update `.pre-commit-config.yaml`: change rev `v0.14.14` to `v0.15.0`
3. Install: `pip install -e .[dev]`
4. Format: `ruff format .`
5. Check: `ruff check .` — fix any new violations from stabilized rules
6. Type check: `mypy src/`
7. Test: `pytest tests/`
8. Regenerate baseline: `python scripts/audit-suppressions.py > .suppression-baseline.json`
9. Final check: `pre-commit run --all-files`
10. Commit as single atomic commit

### Batch 3b: Playwright Migration (Separate Session)

**Time estimate**: ~30 minutes

1. Update `extension/package.json`: change `@playwright/test` from `1.50.0` to `1.58.2`
2. Install: `cd extension && pnpm install` (auto-downloads Chromium)
3. Smoke test: `pnpm test:smoke`
4. Full test: `pnpm test:ci`
5. If smoke tests fail: adjust selectors/timeouts as needed
6. Commit and push

### Batch 3c: glob Migration (Separate Session)

**Time estimate**: ~45 minutes

1. Audit: search for all `glob` imports and usages in extension/ and scripts/
2. Update `extension/package.json`: change `glob` version to `^13.0.1`
3. Remove `@types/glob` if glob v13 includes built-in types
4. Install: `cd extension && pnpm install`
5. Fix any compilation errors from API changes
6. Full test: `pnpm test:ci`
7. Commit and push

## Validation Checklist

After all batches are complete:

- [ ] All 7 audited dependency updates are applied (Dependabot PRs closed)
- [ ] CI is green on main
- [ ] `pnpm test:ci` passes in extension/
- [ ] `pytest tests/` passes with coverage threshold
- [ ] `mypy src/` passes
- [ ] `pre-commit run --all-files` passes
- [ ] No open security advisories on direct dependencies
