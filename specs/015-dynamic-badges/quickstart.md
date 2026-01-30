# Quickstart: Dynamic CI Badges

**Feature**: 015-dynamic-badges
**Date**: 2026-01-29

## One-Time Setup

### 1. Enable GitHub Pages

1. Go to repository Settings → Pages
2. Set Source to "Deploy from a branch"
3. Set Branch to `gh-pages` / `/ (root)`
4. Save

> **Note**: The `gh-pages` branch will be created automatically by the first CI run after this feature is merged.

### 2. Verify GITHUB_TOKEN Permissions

The default GITHUB_TOKEN has sufficient permissions for:
- Creating/pushing to `gh-pages` branch
- GitHub Pages deployment

No additional secrets or PATs required.

## Post-Merge Verification

After merging to `main`:

1. **Check CI run**: Verify `badge-publish` job succeeds
2. **Check gh-pages branch**: Should contain `badges/status.json`
3. **Check Pages URL**: `https://oddessentials.github.io/ado-git-repo-insights/badges/status.json`
4. **Check README badges**: Should display current values

## Troubleshooting

### Badge shows "invalid" or "not found"

1. Verify GitHub Pages is enabled
2. Check `gh-pages` branch exists
3. Check `badges/status.json` exists in branch
4. Wait 1-2 minutes for Shields.io cache

### CI job fails with "Pages not enabled"

1. Enable GitHub Pages in repository settings
2. Re-run the failed workflow

### Determinism check fails

1. Check for non-deterministic output (timestamps, random ordering)
2. Ensure `sort_keys=True` in JSON generation
3. Check for floating-point precision issues (use `round(x, 1)`)

## File Locations

| File | Location | Purpose |
|------|----------|---------|
| Badge JSON generator | `.github/scripts/generate-badge-json.py` | Parses reports, outputs JSON |
| CI job | `.github/workflows/ci.yml` | `badge-publish` job |
| Published JSON | `gh-pages:badges/status.json` | Shields.io data source |
| README badges | `README.md` | Dynamic badge markdown |
