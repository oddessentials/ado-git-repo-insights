# Dependency Audit & Update Plan

**Audited**: 2026-02-10
**Branch**: 027-public-preview
**Open Dependabot PRs**: 7

---

## Summary

All dependencies were audited across Python, TypeScript/Node, test infrastructure, and CI tooling. Updates are categorized as **SAFE** (merge Dependabot PR or bump directly), **NEEDS REVIEW** (minor risk, test carefully), or **SEPARATE SESSION** (breaking changes requiring focused migration work).

---

## 1. Python Dependencies

| Dependency | Current | Target | Risk | Notes |
|---|---|---|---|---|
| `ruff` | `0.14.14` | `0.15.0` | **SEPARATE SESSION** | Major formatting style change ("2026 style guide"), new block suppression comments. Will reformat entire codebase. Stabilized rule **B912** (`map-without-explicit-strict`) may trigger new violations since `B` is in our selected rule set. PR #142. |
| `requests` | `>=2.28.0` | latest | SAFE | No pinned version; pip resolves latest compatible. No action needed. |
| `pyyaml` | `>=6.0` | latest | SAFE | No pinned version; pip resolves latest compatible. No action needed. |
| `pandas` | `>=2.2.0,<3` / `>=3.0.0` | latest | SAFE | Version policy already handles 2.x vs 3.x split by Python version. CI validates. |
| `azure-storage-blob` | `>=12.0.0` | latest | SAFE | Optional fallback storage. No action needed. |
| `pytest` | `>=7.0` | latest | SAFE | No breaking changes in minor bumps. |
| `pytest-cov` | `>=4.0` | latest | SAFE | No breaking changes. |
| `mypy` | `>=1.0` | latest | SAFE | Floating range allows latest. Strict mode already enforced. |
| `pre-commit` | `>=3.0` | latest | SAFE | Floating range. |
| `types-requests` | `>=2.28.0` | latest | SAFE | Type stubs, follows requests. |
| `types-PyYAML` | `>=6.0` | latest | SAFE | Type stubs. |
| `pandas-stubs` | `>=2.0.0` | `3.0.0` | NEEDS REVIEW | Major version aligning with pandas 3.0. May surface new type errors (str dtype changes, CoW semantics). Run `mypy src/` after upgrading. |
| `jsonschema` | `>=4.0` | latest | SAFE | Floating range. |
| `defusedxml` | `0.7.1` | `0.7.1` | SAFE | Exactly pinned, no new release. |
| `prophet` | `>=1.1.0` (optional) | `1.3.0` | NEEDS REVIEW | Breaking: `prophet.hdays` module removed; must use `holidays` package instead. Check for `prophet.hdays` imports before upgrading. |
| `openai` | `>=1.0.0` (optional) | latest | SAFE | ML extra, floating range. |

### Pre-commit Hooks

| Hook | Current | Target | Risk | Notes |
|---|---|---|---|---|
| `ruff-pre-commit` | `v0.14.14` | `v0.15.0` | **SEPARATE SESSION** | Must update in lockstep with `ruff` in `pyproject.toml`. CI enforces version parity. |
| `pre-commit-hooks` | `v4.5.0` | `v5.0.0` | NEEDS REVIEW | Check changelog for breaking changes in v5. |

---

## 2. TypeScript / Node Dependencies (extension/)

### Runtime Dependencies

| Dependency | Current | Target | Risk | Notes |
|---|---|---|---|---|
| `vss-web-extension-sdk` | `^5.141.0` | latest 5.x | SAFE | Patch/minor only. ADO SDK is stable. |

### Dev Dependencies

| Dependency | Current | Target | Risk | Dependabot PR | Notes |
|---|---|---|---|---|---|
| `@playwright/test` | `1.50.0` | `1.58.2` | **SEPARATE SESSION** | #145 (UNSTABLE) | Exactly pinned per version guard test. Major jump (8 minor versions). Playwright downloads browser binaries — must verify smoke tests pass. `postinstall` script installs chromium. mergeStateStatus=UNSTABLE. |
| `glob` | `^10.4.0` | `13.0.1` | **SEPARATE SESSION** | #144 (MERGEABLE) | Major version jump (10 → 13). Drops Node <20 support. CLI split to `glob-bin`. Check all `glob` usage in test files and scripts. |
| `dependency-cruiser` | `^17.3.7` | `17.3.8` | SAFE | #148 (MERGEABLE) | Patch release, bug fix for Svelte only. Safe to merge. |
| `serve` | `14.2.0` | `14.2.5` | SAFE | #146 (UNSTABLE) | Exactly pinned per version guard test. Patch updates only (compression bump, ajv fix). Update pin in `package.json` and version guard test. |
| `@types/node` | `^25.0.0` | `25.2.2` | SAFE | #147 (CONFLICTING) | Type definitions only. Needs rebase to resolve conflicts. |
| `esbuild` | `^0.27.3` | latest 0.27.x | SAFE | No PR. Minor/patch within range. |
| `eslint` | `^9.18.0` | latest 9.x | SAFE | No PR. Minor within range. |
| `jest` | `^30.0.0` | latest 30.x | SAFE | No PR. Minor within range. |
| `@jest/globals` | `^30.0.0` | latest 30.x | SAFE | No PR. Coupled with jest. |
| `@types/jest` | `^30.0.0` | latest 30.x | SAFE | No PR. Coupled with jest. |
| `jest-environment-jsdom` | `^30.0.0` | latest 30.x | SAFE | No PR. Coupled with jest. |
| `ts-jest` | `^29.2.5` | latest 29.x | SAFE | No PR. Must stay on 29.x while jest is 30.x (ts-jest 30 not yet released). |
| `typescript` | `^5.7.3` | latest 5.x | SAFE | No PR. Minor within range. |
| `typescript-eslint` | `^8.53.1` | latest 8.x | SAFE | No PR. Minor within range. |
| `@typescript-eslint/eslint-plugin` | `^8.20.0` | latest 8.x | SAFE | No PR. Coupled with typescript-eslint. |
| `@typescript-eslint/parser` | `^8.20.0` | latest 8.x | SAFE | No PR. Coupled with typescript-eslint. |
| `eslint-plugin-security` | `^3.0.0` | latest 3.x | SAFE | No PR. Minor within range. |
| `prettier` | `^3.8.1` | latest 3.x | SAFE | No PR. Minor within range. |
| `jest-junit` | `^16.0.0` | latest 16.x | SAFE | No PR. Minor within range. |
| `ts-node` | `^10.9.2` | latest 10.x | SAFE | No PR. Minor within range. |
| `@types/glob` | `^8.1.0` | latest | SAFE | No PR. Type definitions. |
| `@types/jsdom` | `^21.1.7` | `27.0.0` | **SEPARATE SESSION** | Major jump (21 → 27). Tracks jsdom version; may need jsdom major update too. Low priority (types-only). |

### Root Dependencies (release tooling)

| Dependency | Current | Target | Risk | Notes |
|---|---|---|---|---|
| `semantic-release` | `^25.0.3` | latest 25.x | SAFE | Minor within range. |
| `@semantic-release/changelog` | `^6.0.3` | latest 6.x | SAFE | Stable. |
| `@semantic-release/commit-analyzer` | `^13.0.0` | latest 13.x | SAFE | Stable. |
| `@semantic-release/exec` | `^7.0.0` | latest 7.x | SAFE | Stable. |
| `@semantic-release/git` | `^10.0.1` | latest 10.x | SAFE | Stable. |
| `@semantic-release/github` | `^12.0.5` | latest 12.x | SAFE | Stable. |
| `@semantic-release/release-notes-generator` | `^14.0.0` | latest 14.x | SAFE | Stable. |
| `husky` | `^9.1.7` | latest 9.x | SAFE | Stable. |
| `@oddessentials/repo-standards` | `^7.1.1` | latest 7.x | SAFE | Internal package. |

---

## 3. Test Infrastructure

### Version Coupling Constraints

| Constraint | Current State | Notes |
|---|---|---|
| `ts-jest` ↔ `jest` | ts-jest@29.x with jest@30.x | ts-jest 30.x not yet released. Must stay on 29.x. Works via compatibility mode. |
| `@playwright/test` pinning | Exactly `1.50.0` | Version guard test (`playwright-version-guard.test.ts`) enforces exact pin. Update requires changing both `package.json` and verifying smoke tests. |
| `serve` pinning | Exactly `14.2.0` | Version guard test enforces exact pin. Update requires changing both `package.json` and the guard test. |
| `jest` ↔ `@jest/globals` ↔ `jest-environment-jsdom` | All `^30.0.0` | Must be updated together. |

### Test Config Considerations

- `jest.config.ts`: Coverage thresholds enforced via COVERAGE_RATCHET.md formula. No config changes needed for dep bumps.
- `playwright.config.ts`: Smoke tests run against `serve` on localhost. Playwright bump may change browser behavior.

---

## 4. CI / GitHub Actions

| Action | Current | Target | Risk | Dependabot PR | Notes |
|---|---|---|---|---|---|
| `actions/cache` | `v4` | `v5` | NEEDS REVIEW | #141 | Requires Node.js 24 runtime, minimum runner `2.327.1`. GitHub-hosted runners should support this. Verify before merging. |
| `actions/checkout` | `v4` | `v4` | SAFE | — | Already latest major. |
| `actions/setup-python` | `v5` | `v5` | SAFE | — | Already latest major. |
| `actions/setup-node` | `v4` | `v4` | SAFE | — | Already latest major. |
| `actions/upload-artifact` | `v4` | `v4` | SAFE | — | Already latest major. |
| `actions/download-artifact` | `v4` | `v4` | SAFE | — | Already latest major. |
| `pnpm/action-setup` | `v4` | `v4` | SAFE | — | Already latest major. |
| `codecov/codecov-action` | `v5` | `v5` | SAFE | — | Already latest major. |
| `gitleaks/gitleaks-action` | `v2.3.9` | latest v2 | SAFE | — | Minor within range. |
| `cycjimmy/semantic-release-action` | `v4` | `v4` | SAFE | — | Already latest major. |
| `pypa/gh-action-pypi-publish` | `release/v1` | `release/v1` | SAFE | — | Branch-pinned. |
| `softprops/action-gh-release` | `v1` | `v2` | NEEDS REVIEW | — | v2 available. Check for breaking API changes. Non-urgent. |
| `actions/create-github-app-token` | `v1` | latest | SAFE | — | Used in release workflow only. |

---

## 5. Recommended Merge Order

### Batch 1: Safe Dependabot PRs (merge now)

1. **PR #148** — `dependency-cruiser` 17.3.7 → 17.3.8 (patch, MERGEABLE)
2. **PR #146** — `serve` 14.2.0 → 14.2.5 (patch, update version guard test, pinned)
3. **PR #147** — `@types/node` 25.1.0 → 25.2.2 (rebase needed to resolve conflicts)

### Batch 2: Needs Review

4. **PR #141** — `actions/cache` v4 → v5 (verify runner compatibility)

### Batch 3: Separate Session Required

These updates have breaking changes and need focused migration work:

5. **PR #142** — `ruff` 0.14.14 → 0.15.0
   - New 2026 formatting style will reformat entire Python codebase
   - Must update `.pre-commit-config.yaml` rev in lockstep
   - Estimated effort: 1 session (run ruff format, review diff, update suppressions baseline)

6. **PR #145** — `@playwright/test` 1.50.0 → 1.58.2
   - 8 minor versions of changes; browser binary downloads
   - Update pinned version in `package.json`
   - Run full smoke test suite to verify
   - Estimated effort: 1 session

7. **PR #144** — `glob` 10.5.0 → 13.0.1
   - 3 major versions. CLI removed, Node <20 dropped
   - Audit all glob usage in tests and scripts
   - Estimated effort: 1 session

---

## 6. Quick Wins (run `pnpm update`)

These are already within declared ranges and just need a lockfile refresh:

```bash
# Extension
cd extension && pnpm update

# Root
cd .. && pnpm update
```

This picks up: `typescript-eslint` 8.54→8.55, `esbuild` 0.27.2→0.27.3, `semantic-release` 25.0.2→25.0.3, `@semantic-release/github` 12.0.2→12.0.5.

---

## 7. Future Watch

| Item | Notes |
|---|---|
| **ESLint 10.0.0** | Just released. Major version; requires flat config migration and typescript-eslint compat check. Wait for ecosystem to stabilize. |
| **ts-jest 30.x** | Not yet released. Currently ts-jest@29.x works with Jest@30 via peer dep compatibility. Adopt ts-jest 30.x when available to align majors. |
| **pre-commit-hooks v5.0.0** | Available. Check changelog for breaking changes before upgrading from v4.5.0. |

---

## 8. Items NOT Requiring Updates

- **pnpm**: `9.15.0` — pinned in `engines` and `packageManager`. No Dependabot PR. Latest 9.x is fine but version is locked for deterministic builds.
- **tfx-cli**: `0.17.0` — pinned in CI for supply chain security. Only update if newer version needed.
- **Node.js**: `22` — LTS, current and supported. No change needed.
- **Python**: `3.10+` — supporting 3.10, 3.11, 3.12 per CI matrix. No change needed.
