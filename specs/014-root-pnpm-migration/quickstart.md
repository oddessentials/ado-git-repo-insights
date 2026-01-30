# Quickstart: Complete Root pnpm Migration

**Branch**: `014-root-pnpm-migration` | **Date**: 2026-01-29

## Prerequisites

- pnpm 9.15.0 installed locally (via corepack: `corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- Git configured
- Access to push to the repository

## Implementation Checklist

### Phase 1: Lockfile Migration

- [ ] Delete `package-lock.json` at repository root
- [ ] Run `pnpm install` at repository root
- [ ] Verify `pnpm-lock.yaml` is created
- [ ] Run `pnpm install` again to verify stability (no changes)
- [ ] Stage changes: `git add -A && git status`

### Phase 2: Defense-in-Depth npm Blocking

- [ ] Edit `package.json` to add preinstall script
- [ ] Edit `package.json` to add `engines.pnpm` field
- [ ] Create/update `.npmrc` with `engine-strict=true`
- [ ] Test: `npm install` should fail with BOTH preinstall error AND engine mismatch
- [ ] Test: `pnpm install` should succeed

### Phase 3: Update release.yml (Strict Verification)

- [ ] Replace `setup-node@v4` with `.github/actions/setup-pnpm`
- [ ] Replace `npm ci` with `pnpm install --frozen-lockfile`
- [ ] Add strict lockfile verification step (NO `|| true` exit code masking)
- [ ] Remove standalone `setup-node` step (setup-pnpm handles it)

### Phase 4: Update ci.yml

- [ ] Update `pnpm-lockfile-guard` job to use `find` for workspace-wide check
- [ ] Add new `npm-command-guard` job with expanded grep check:
  - Scans `.github/workflows/`
  - Scans `package.json` scripts
  - Scans `scripts/` directory
- [ ] Verify job ordering (guards should run early)

### Phase 5: Verification

- [ ] Push branch and verify CI passes
- [ ] Manually trigger release workflow on a test branch (if possible)
- [ ] Verify `npm install` fails with both error types
- [ ] Verify grep check covers all required paths

## Quick Commands

```bash
# Delete old lockfile and generate new one
rm package-lock.json
pnpm install

# Verify lockfile stability
pnpm install  # Should show "Lockfile is up to date"

# Test npm blocking (should fail with BOTH errors)
npm install

# Verify no npm commands in expanded scope
git grep -n "npm ci\|npm install" .github/workflows/ package.json scripts/ | grep -v "npm install -g tfx-cli"
```

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `package-lock.json` | Delete | Remove npm lockfile |
| `pnpm-lock.yaml` | Create | New pnpm lockfile (auto-generated) |
| `package.json` | Modify | Add preinstall script + engines.pnpm |
| `.npmrc` | Modify/Create | Add engine-strict=true |
| `.github/workflows/release.yml` | Modify | Use pnpm, strict lockfile verification |
| `.github/workflows/ci.yml` | Modify | Extend guards with expanded scope |

## Key Implementation Details

### Strict Lockfile Verification (release.yml)

**DO NOT** use `|| true` to mask exit codes. The check must hard-fail:

```yaml
# CORRECT - Hard-fail on any change
- name: Verify no lockfile changes
  run: |
    set -euo pipefail
    if ! git diff --exit-code pnpm-lock.yaml; then
      echo "::error::pnpm-lock.yaml was modified during release"
      exit 1
    fi
    if [ -f "package-lock.json" ]; then
      echo "::error::package-lock.json was created during release"
      exit 1
    fi
```

```yaml
# WRONG - Masks failures, allows silent churn
- name: Verify no lockfile changes
  run: |
    git diff --exit-code pnpm-lock.yaml || true  # BAD!
```

### Expanded npm Command Check Scope

The CI guard must scan ALL of these locations:
1. `.github/workflows/` - workflow files
2. `package.json` - npm scripts in root package.json
3. `scripts/` - helper scripts used by CI

## Rollback

If anything goes wrong:

```bash
git checkout main -- package-lock.json
git checkout main -- package.json
git checkout main -- .npmrc
git checkout main -- .github/workflows/release.yml
git checkout main -- .github/workflows/ci.yml
rm pnpm-lock.yaml
npm install
```
