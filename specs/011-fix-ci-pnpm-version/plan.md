# Implementation Plan: Fix CI pnpm Version Specification

**Branch**: `011-fix-ci-pnpm-version` | **Date**: 2026-01-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/011-fix-ci-pnpm-version/spec.md`

## Summary

Fix GitHub Actions CI failures caused by `pnpm/action-setup@v4` not finding a pnpm version specification. The root cause is a missing `packageManager` field in the root `package.json`. The fix adds this field to match the existing specification in `extension/package.json`.

## Technical Context

**Language/Version**: JSON (package.json), YAML (GitHub Actions workflows)
**Primary Dependencies**: pnpm@9.15.0 (already in use per extension/package.json)
**Storage**: N/A
**Testing**: GitHub Actions workflow execution
**Target Platform**: GitHub Actions runners (ubuntu-latest, windows-latest, macos-latest)
**Project Type**: Hybrid (Python backend + TypeScript extension)
**Performance Goals**: N/A (CI configuration)
**Constraints**: Must not change pnpm version from what lockfile expects
**Scale/Scope**: Configuration fix affecting 3 workflow files, 11 jobs total

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| XVII. Cross-Agent Compatibility | ✅ PASS | Fix ensures consistent pnpm version across all CI runners |
| XVIII. Actionable Failure Logs | ✅ PASS | Error messages from pnpm/action-setup are already actionable |
| QG-17. Lint + format checks pass | ✅ MAINTAINED | No code changes affect lint/format |
| QG-18. Type checking passes | ✅ MAINTAINED | No TypeScript changes |
| QG-19. Unit + integration tests pass | ✅ GOAL | This fix enables tests to run |
| QG-22. VSIX extension builds | ✅ GOAL | This fix enables extension build |

**Pre-Design Gate Result**: ✅ PASS - No constitution violations. Change is configuration-only.

## Project Structure

### Documentation (this feature)

```text
specs/011-fix-ci-pnpm-version/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── quickstart.md        # Phase 1 output (implementation guide)
└── checklists/
    └── requirements.md  # Specification quality checklist
```

### Source Code (repository root)

```text
# Files to modify:
package.json                      # Add packageManager field (ROOT CAUSE FIX)

# Files for reference (no changes needed):
extension/package.json            # Already has packageManager: "pnpm@9.15.0"
extension/pnpm-lock.yaml          # Lockfile version 9.0 (compatible with pnpm 9.x)
.github/workflows/ci.yml          # Uses pnpm/action-setup@v4 (no changes needed)
.github/workflows/release.yml     # Uses pnpm/action-setup@v4 (no changes needed)
```

**Structure Decision**: Single file modification at repository root. The fix is surgical: add one JSON field to root `package.json` to satisfy `pnpm/action-setup@v4` requirements.

## Complexity Tracking

No complexity violations. This is a minimal configuration fix.

## Root Cause Analysis

### Problem

`pnpm/action-setup@v4` fails in CI with error:
```
Error: No pnpm version is specified.
Please specify it by one of the following ways:
  - in the GitHub Action config with the key "version"
  - in the package.json with the key "packageManager"
```

### Investigation Findings

1. **extension/package.json** (line 6) already has `"packageManager": "pnpm@9.15.0"`
2. **Root package.json** does NOT have a `packageManager` field
3. `pnpm/action-setup@v4` runs at the repository root before `working-directory: extension`
4. The action looks for `packageManager` in the **root** `package.json`, not nested directories

### Solution

Add `"packageManager": "pnpm@9.15.0"` to root `package.json` to match `extension/package.json`.

## Implementation Steps

### Step 1: Add packageManager to root package.json

**File**: `package.json` (root)
**Change**: Add `"packageManager": "pnpm@9.15.0"` field

**Before**:
```json
{
  "name": "ado-git-repo-insights-release",
  "private": true,
  "devDependencies": { ... },
  "version": "5.11.0",
  "scripts": { ... }
}
```

**After**:
```json
{
  "name": "ado-git-repo-insights-release",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "devDependencies": { ... },
  "version": "5.11.0",
  "scripts": { ... }
}
```

### Step 2: Verify lockfile compatibility

**Check**: Ensure `extension/pnpm-lock.yaml` is compatible with pnpm@9.15.0
**Evidence**: Lockfile shows `lockfileVersion: '9.0'` which is compatible with pnpm 9.x

### Step 3: Local validation

Run the following to verify the fix works locally:
```bash
# From repository root
pnpm --version  # Should report 9.x

# Verify extension install works
cd extension && pnpm install --frozen-lockfile
```

### Step 4: CI validation

Push the change and verify all CI jobs pass.

**Jobs that were failing** (from incident report):
| Workflow | Job | Line | Error |
|----------|-----|------|-------|
| ci.yml | ui-bundle-sync | 126 | "No pnpm version is specified" |
| ci.yml | build-extension | 467 | "No pnpm version is specified" |
| ci.yml | extension-tests | 544 | "No pnpm version is specified" + "test-results.xml not found" (downstream) |
| ci.yml | fresh-clone-verify | 651 | "No pnpm version is specified" |
| release.yml | build-extension | 85 | "No pnpm version is specified" |

**Expected after fix**: All 5 jobs should pass pnpm setup step. The `extension-tests` job should also produce `test-results.xml` once pnpm installs successfully.

## Verification Checklist

- [ ] Root `package.json` has `"packageManager": "pnpm@9.15.0"`
- [ ] Version matches `extension/package.json` (`9.15.0`)
- [ ] CI workflow `ui-bundle-sync` job passes
- [ ] CI workflow `build-extension` job passes
- [ ] CI workflow `extension-tests` job passes
- [ ] CI workflow `fresh-clone-verify` job passes
- [ ] Jest produces `extension/test-results.xml`
- [ ] No quality checks were removed or bypassed

## Post-Design Constitution Re-check

| Principle | Status | Notes |
|-----------|--------|-------|
| XVII. Cross-Agent Compatibility | ✅ PASS | pnpm version now explicitly specified at root |
| QG-19. Unit + integration tests pass | ✅ ENABLED | Fix allows tests to execute |
| QG-22. VSIX extension builds | ✅ ENABLED | Fix allows extension build |
| FR-007 (no quality reduction) | ✅ PASS | All existing checks remain unchanged |

**Post-Design Gate Result**: ✅ PASS

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
