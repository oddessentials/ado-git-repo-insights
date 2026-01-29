# Quickstart: Fix CI pnpm Version Specification

**Feature**: 011-fix-ci-pnpm-version
**Date**: 2026-01-29

## Overview

This fix resolves CI build failures caused by `pnpm/action-setup@v4` not finding a pnpm version specification. The root cause is a missing `packageManager` field in the root `package.json`.

## The Fix

Add one line to root `package.json`:

```json
{
  "name": "ado-git-repo-insights-release",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  ...
}
```

## Why This Works

1. `pnpm/action-setup@v4` runs at repository root
2. It looks for `packageManager` in `package.json` to determine which pnpm version to install
3. The root `package.json` was missing this field (while `extension/package.json` had it)
4. Adding the field at root level satisfies the action's requirement

## Files Changed

| File | Change |
|------|--------|
| `package.json` (root) | Add `"packageManager": "pnpm@9.15.0"` |

## Verification

After the fix, verify:

1. **Local**: Run `pnpm --version` from repo root
2. **CI**: All these jobs should pass:
   - `ui-bundle-sync`
   - `build-extension`
   - `extension-tests`
   - `fresh-clone-verify`

## Related Files (No Changes Needed)

- `extension/package.json` - Already has correct `packageManager` field
- `extension/pnpm-lock.yaml` - Compatible with pnpm 9.15.0
- `.github/workflows/*.yml` - No workflow changes required
