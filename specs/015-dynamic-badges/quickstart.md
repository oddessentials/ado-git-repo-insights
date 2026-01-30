# Quickstart: Dynamic CI Badges

**Feature**: 015-dynamic-badges
**Date**: 2026-01-29

## One-Time Setup

### 1. No GitHub Pages Configuration Required

Unlike the previous approach, this implementation uses raw GitHub URLs instead of GitHub Pages:
- GitHub Pages remains available for `/docs` (future dashboard demo)
- Badge data goes to a dedicated `badges` branch
- The `badges` branch is created automatically by CI

### 2. Verify GITHUB_TOKEN Permissions

The default GITHUB_TOKEN has sufficient permissions for:
- Creating/pushing to `badges` branch
- No additional secrets or PATs required

## Post-Merge Verification

After merging to `main`:

1. **Check CI run**: Verify `badge-publish` job succeeds
2. **Check badges branch**: Should contain `status.json`
3. **Check raw URL**: `https://raw.githubusercontent.com/oddessentials/ado-git-repo-insights/badges/status.json`
4. **Check README badges**: Should display current values (may take 5 min for Shields.io cache)

## Troubleshooting

### Badge shows "invalid" or "not found"

1. Verify `badges` branch exists
2. Check `status.json` exists in branch root
3. Verify raw URL is accessible: `curl https://raw.githubusercontent.com/oddessentials/ado-git-repo-insights/badges/status.json`
4. Wait 1-5 minutes for Shields.io cache refresh

### CI job fails with permission error

1. Check GITHUB_TOKEN has write permissions (default for push events)
2. Verify branch protection rules don't block `badges` branch

### Determinism check fails

1. Check for non-deterministic output (timestamps, random ordering)
2. Ensure `sort_keys=True` in JSON generation
3. Check for floating-point precision issues (use `round(x, 1)`)

## File Locations

| File | Location | Purpose |
|------|----------|---------|
| Badge JSON generator | `.github/scripts/generate-badge-json.py` | Parses reports, outputs JSON |
| CI job | `.github/workflows/ci.yml` | `badge-publish` job |
| Published JSON | `badges` branch: `status.json` | Shields.io data source |
| README badges | `README.md` | Dynamic badge markdown |

## Key Differences from GitHub Pages Approach

| Aspect | Old (gh-pages) | New (badges branch) |
|--------|----------------|---------------------|
| URL format | `*.github.io` | `raw.githubusercontent.com` |
| Pages required | Yes | No |
| Branch | `gh-pages` | `badges` |
| Conflicts with `/docs` | Possible | None |
| Setup complexity | Enable Pages | None (automatic) |
