# Comprehensive Dependency Update Plan

**Date**: 2026-03-25
**Branch**: `deps/comprehensive-update-2026-03`
**Supersedes**: Dependabot PRs #186, #187, #188, #189, #190

## Context

Five Dependabot PRs are open with individual dependency bumps. Each is incomplete in isolation:
- PR #186 bumps ruff in `pyproject.toml` but misses `.pre-commit-config.yaml` (version parity hook will reject)
- PR #188 bumps ESLint to 10 but doesn't handle the `@eslint/js` unbundling (config will fail to load)
- PRs #187 and #190 both touch `extension/pnpm-lock.yaml` and conflict with each other

This plan consolidates all updates into a single well-tested PR.

## Changes Summary

| Package | Current | Target | Risk | Notes |
|---|---|---|---|---|
| **serve** | 14.2.5 | 14.2.6 | Patch | Security fix (ReDoS vulnerability in serve-handler) |
| **jest** | ^30.2.0 | ^30.3.0 | Minor | New features (defineConfig, setTimerTickMode), no breaking |
| **jest-environment-jsdom** | ^30.2.0 | ^30.3.0 | Minor | Paired with jest |
| **@jest/globals** | ^30.2.0 | ^30.3.0 | Minor | Paired with jest |
| **@typescript-eslint/eslint-plugin** | ^8.57.0 | ^8.57.2 | Patch | Adds ESLint 10 peer support |
| **@typescript-eslint/parser** | ^8.57.0 | ^8.57.2 | Patch | Adds ESLint 10 peer support |
| **typescript-eslint** | ^8.57.0 | ^8.57.2 | Patch | Adds ESLint 10 peer support |
| **eslint** | ^9.39.2 | ^10.1.0 | **MAJOR** | `@eslint/js` unbundled from eslint |
| **@eslint/js** | (implicit) | ^10.0.1 | New dep | Must be added explicitly for ESLint 10 |
| **ruff** | ==0.15.6 | ==0.15.7 | Patch | Must sync pyproject.toml + .pre-commit-config.yaml |
| **Python transitive deps** | various | latest | Low | uv.lock refresh (pandas, numpy, coverage, certifi, etc.) |

## Implementation (3 commits)

### Commit 1: Security patch — serve 14.2.6

**Files modified:**
- `extension/package.json`: `"serve": "14.2.5"` → `"serve": "14.2.6"`
- `extension/pnpm-lock.yaml`: regenerated

**Verification:**
- `pnpm run test:smoke` (Playwright smoke tests use serve)

### Commit 2: Patches — Jest 30.3, typescript-eslint 8.57.2, ruff 0.15.7

**Files modified:**
- `extension/package.json`: bump `@jest/globals`, `jest`, `jest-environment-jsdom` to `^30.3.0`; bump `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `typescript-eslint` to `^8.57.2`
- `extension/pnpm-lock.yaml`: regenerated
- `pyproject.toml`: `ruff==0.15.6` → `ruff==0.15.7`
- `.pre-commit-config.yaml`: `rev: v0.15.6` → `rev: v0.15.7`
- `uv.lock`: regenerated via `uv lock --upgrade`

**Critical note:** `pyproject.toml` and `.pre-commit-config.yaml` MUST be updated together. The `scripts/check_tool_versions.py` hook enforces version parity and will block commits if they diverge.

**Verification:**
- `pnpm run test:unit` — Jest 30.3 test suite passes
- `pnpm run lint` — ESLint still works (still v9 at this point)
- `pnpm run build:check` — TypeScript type-check passes
- `pytest` — Python test suite passes
- `ruff check .` / `ruff format --check .` — new ruff version lints/formats correctly

### Commit 3: Major bump — ESLint 9 → 10

**Files modified:**
- `extension/package.json`: add `"@eslint/js": "^10.0.1"`, change `"eslint": "^9.39.2"` → `"eslint": "^10.1.0"`
- `extension/pnpm-lock.yaml`: regenerated

**ESLint 10 breaking change analysis:**
- `@eslint/js` was a bundled dependency of ESLint 9 but is unbundled in ESLint 10
- The existing `eslint.config.mjs` does `import eslint from '@eslint/js'` — this import continues to work because we add `@eslint/js` as an explicit devDependency
- `typescript-eslint@8.57.2` explicitly supports `eslint: ^8.57.0 || ^9.0.0 || ^10.0.0` in its peerDeps
- `eslint-plugin-security@4.0.0` has no eslint peer constraint
- **No changes to `eslint.config.mjs` are needed**

**Verification:**
- `pnpm run lint` — ESLint 10 linting passes on `ui/`
- `pnpm run lint:all` — Also lint test files
- `pnpm run test:ci` — Full CI test suite (build + type-check + lint + tests + smoke)

## PR Details

- **Title**: `build: comprehensive dependency update (eslint 10, jest 30.3, ruff 0.15.7, serve security fix)`
- **Closes**: #186, #187, #188, #189, #190
- **CI matrix**: Python 3.10-3.12 x ubuntu/windows, TypeScript build+lint+test+smoke

## Rollback Strategy

The 3-commit structure enables surgical rollback:

| Scenario | Action |
|---|---|
| ESLint 10 breaks CI | `git revert <commit-3>` — only ESLint reverted, patches survive |
| Jest 30.3 breaks tests | `git revert <commit-2>` — reverts Jest + ts-eslint + ruff together |
| serve 14.2.6 regresses | `git revert <commit-1>` — unlikely for security patch |
| Everything fails | `git revert HEAD~3..HEAD` — clean revert of all 3 |

## Explicitly Excluded (and Why)

| Package | Current | Available | Reason |
|---|---|---|---|
| **TypeScript** | 5.9.3 | 6.0.2 | `typescript-eslint@8.x` requires `<6.0.0`; `ts-jest` requires `<6`. Blocked until ecosystem catches up. |
| **vss-web-extension-sdk** | 5.141.0 | Deprecated | Azure DevOps SDK — no replacement package exists |
| **pre-commit-hooks** | v4.5.0 | v6.0.0 | 2-major-version jump, deserves its own PR with careful review |
| **Root package.json deps** | — | — | All already at latest (semantic-release 25.0.3, husky 9.1.7, commitlint 20.5.0) |
