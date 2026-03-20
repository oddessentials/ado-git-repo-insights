# Quickstart: Demo Data Realism & Branch Cleanup

**Date**: 2026-02-21
**Feature**: 030-demo-data-branch-cleanup

## Prerequisites

- Git with the 029-cross-dimensional-accuracy branch checked out
- Python 3.14 with project dependencies installed (`pip install -e .[dev]`)
- Node.js with pnpm and extension dependencies (`cd extension && pnpm install`)

## Implementation Order

### Step 1: Fix demo data generator (P1)

1. Switch to branch `029-cross-dimensional-accuracy`
2. Edit `scripts/generate-demo-data.py`:
   - Replace `max(1, int(repo_pr_count * 0.3))` (line 610) with a distribution-based formula
   - Replace `max(1, int(repo_pr_count * 0.45))` (line 611) with a distribution-based formula
   - Same for `by_team` entries (lines 637-638)
   - Ensure counts are bounded by parent rollup values
3. Regenerate demo data: `python scripts/generate-demo-data.py`
4. Rebuild UI bundles: `cd extension && pnpm run build:ui`
5. Sync bundles: `python scripts/sync_ui_bundle.py` + copy to `docs/`
6. Add programmatic invariant assertions to tests
7. Run all tests to verify

### Step 2: Remove compiled artifact (P3)

1. Remove `extension/ui/dashboard.js` from git tracking: `git rm extension/ui/dashboard.js`
2. Add pre-commit guard to `.husky/pre-commit` rejecting `extension/ui/*.js` (except `VSS.SDK.min.js`)

### Step 3: Squash commits (P2)

1. Tag pre-squash tip: `git tag pre-squash/029-cross-dimensional-accuracy`
2. Soft reset to main: `git reset --soft main`
3. Recommit in 9 logical groups (see research.md for group definitions)
4. Force-push: `git push --force-with-lease origin 029-cross-dimensional-accuracy`
5. Verify all quality gates pass

## Verification

```bash
# Python tests
cd /e/projects/ado-git-repo-insights && python -m pytest --tb=short

# JS tests
cd /e/projects/ado-git-repo-insights/extension && pnpm test

# Full pre-push gate
git push  # triggers pre-push hooks
```

## Key Files

| File | Purpose |
|------|---------|
| `scripts/generate-demo-data.py` | Demo data generator (lines 610-611, 637-638) |
| `.husky/pre-commit` | Pre-commit hook (add artifact guard) |
| `docs/data/aggregates/weekly_rollups/*.json` | Generated demo data |
| `extension/ui/dashboard.js` | Compiled artifact to remove |
| `tests/unit/test_synthetic_dataset.py` | Add realism invariant assertions |
