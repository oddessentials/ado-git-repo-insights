# Research: Fix CI pnpm Version Specification

**Feature**: 011-fix-ci-pnpm-version
**Date**: 2026-01-29

## Assumption Verification (Clarification Pass)

### Assumption 1: Root package.json exists

**Status**: ✅ Confirmed
**Evidence**: File exists at repo root with semantic-release dependencies but no `packageManager` field.

### Assumption 2: No workflows use `with: version:` for pnpm

**Status**: ✅ Confirmed
**Evidence**: All 5 `pnpm/action-setup@v4` uses have no version input:
- `ci.yml:126` - ui-bundle-sync job
- `ci.yml:467` - build-extension job
- `ci.yml:544` - extension-tests job
- `ci.yml:651` - fresh-clone-verify job
- `release.yml:85` - build-extension job

Adding `packageManager` is not redundant - it's the required mechanism.

### Assumption 3: No root pnpm-lock.yaml (monorepo check)

**Status**: ✅ Confirmed
**Evidence**: `ls pnpm-lock.yaml` returns "No such file". Only `extension/pnpm-lock.yaml` exists.
No lockfile version conflict risk.

### Assumption 4: Corepack compatibility

**Status**: ✅ Confirmed
**Evidence**: 5 jobs run `corepack enable`:
- `ci.yml:135, 476, 553, 659`
- `release.yml:95`

Root `packageManager` helps corepack resolve pnpm consistently. No conflicting versions set anywhere.

## Research Tasks

### Task 1: Why does pnpm/action-setup@v4 require explicit version specification?

**Decision**: The `pnpm/action-setup@v4` action requires a pnpm version because it needs to install a specific version of pnpm on the GitHub Actions runner. Without a version, it cannot proceed.

**Rationale**: The action supports two methods of specifying the version:
1. `version` input parameter in the workflow YAML
2. `packageManager` field in `package.json` (corepack standard)

The corepack approach (option 2) is preferred because:
- It's a Node.js standard (corepack is bundled with Node.js)
- It ensures consistency between local development and CI
- It's declarative (lives in the project, not workflow config)

**Alternatives considered**:
- Adding `version: '9.15.0'` to each workflow step using pnpm/action-setup@v4 → Rejected (DRY violation, harder to maintain)
- Using `version: 'latest'` → Rejected (non-deterministic, could break builds)

### Task 2: What pnpm version should be specified?

**Decision**: Use `pnpm@9.15.0` to match `extension/package.json`.

**Rationale**:
- `extension/package.json` already specifies `"packageManager": "pnpm@9.15.0"` (line 6)
- `extension/pnpm-lock.yaml` uses `lockfileVersion: '9.0'` which is compatible with pnpm 9.x
- Using the same version ensures consistency across the project

**Alternatives considered**:
- Using a newer pnpm version → Rejected (could cause lockfile incompatibility)
- Using pnpm 8.x → Rejected (lockfile version 9.0 requires pnpm 9.x)

### Task 3: Where should packageManager be specified?

**Decision**: Add `packageManager` field to root `package.json`.

**Rationale**:
- `pnpm/action-setup@v4` runs at repository root (before `working-directory: extension`)
- The action looks for `packageManager` in the current working directory's `package.json`
- Root `package.json` exists but lacks this field

**Alternatives considered**:
- Modifying workflow to change directory before pnpm setup → Rejected (would require changes to multiple workflow files)
- Using workflow input `version` parameter → Rejected (duplicates version in multiple places)

### Task 4: Verify lockfile compatibility

**Decision**: pnpm 9.15.0 is compatible with the existing lockfile.

**Evidence**:
- `extension/pnpm-lock.yaml` starts with `lockfileVersion: '9.0'`
- pnpm 9.x versions support lockfile version 9.0
- No root lockfile exists (no conflict)
- No lockfile migration needed

## Summary of Findings

| Unknown | Resolution |
|---------|------------|
| Why is pnpm version required? | pnpm/action-setup@v4 needs it to install specific version |
| What version to use? | 9.15.0 (matches extension/package.json) |
| Where to add it? | Root package.json (where action runs) |
| Is lockfile compatible? | Yes (lockfileVersion: 9.0 compatible with pnpm 9.x) |
| Corepack interaction? | Beneficial - root packageManager helps corepack resolve consistently |

## Remaining Unknowns

None. All technical questions resolved.

## Risk Assessment

**Blast radius**: Low
- Single file change (root package.json)
- No workflow YAML changes
- No code changes
- Reversible with one-line revert

**Contract safety**: ✅ No impact
- Does not touch PowerBI/CSV contract
- Does not affect runtime behavior
- Configuration-only change

**Determinism**: ✅ Improves consistency
- Explicit version pinning aligns with project's determinism goals
- Matches existing extension/package.json specification
