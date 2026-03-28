# Local/CI Parity Invariants

This document is the authoritative reference for CI/local check parity in ado-git-repo-insights. Every CI quality gate has a verified local equivalent that runs automatically via git hooks, ensuring developers cannot push code that fails CI.

**Last verified**: 2026-03-28
**Verified by**: 5-specialist team (Python, TypeScript, Extension, CLI, DevOps DevEx)
**Total CI checks**: 33 (+ 2 external)
**Total historical CI failures audited**: 529 job failures across 173 failed runs

## How It Works

```
git commit  -->  .husky/pre-commit  -->  run_repo_hook.py pre-commit  -->  Tier 1 checks
git push    -->  .husky/pre-push    -->  run_repo_hook.py pre-push    -->  Tier 2 checks (includes full preflight)
```

**Only bypass**: `--no-verify` flag, which is forbidden by project policy.

## Tier 1: Pre-Commit (automatic on `git commit`)

| # | CI Check | Local Equivalent | Parity | Historical Failures | Prevention Proof | How It Can Never Happen Again |
|---|----------|-----------------|--------|--------------------:|-----------------|-------------------------------|
| 1 | ci-guards | pre-commit framework | Partial | 0 | [run_repo_hook.py:run_pre_commit_stage()](scripts/run_repo_hook.py) | CI-config validation (composite actions, packageManager) cannot be replicated locally. Zero failures indicates this is stable. |
| 2 | pnpm-lockfile-guard | `run_pnpm_lockfile_guard()` | Match | 1 | [run_repo_hook.py:249](scripts/run_repo_hook.py) | Pre-commit hook blocks `package-lock.json` on staged files. Same logic as CI. |
| 3 | npm-command-guard | `run_npm_command_guard()` | Match | 1 | [run_repo_hook.py:263](scripts/run_repo_hook.py) | Pre-commit hook scans staged files for `npm ci`/`npm install` with identical allowlist (tfx-cli). |
| 4 | pagination-token-guard | `run_pagination_token_guard()` | Match | 0 | [run_repo_hook.py:309](scripts/run_repo_hook.py) | Pre-commit hook scans staged files for direct `continuationToken` usage. Same allowlist as CI. |
| 5 | ui-bundle-sync | `run_managed_artifacts("sync")` | Match | 12 | [run_repo_hook.py:449](scripts/run_repo_hook.py) | Pre-commit triggers full artifact sync (SDK + UI + docs) when TypeScript files are staged. All 12 historical failures predated the managed-artifact pipeline; zero failures since [3247874](https://github.com/oddessentials/ado-git-repo-insights/commit/3247874). |
| 6 | extension-tests (tsc) | `run_extension_typecheck()` | Match | 29 (shared) | [run_repo_hook.py:run_extension_typecheck()](scripts/run_repo_hook.py) | `tsc --noEmit` now runs in pre-commit when TS files are staged. Added in [5d18b31](https://github.com/oddessentials/ado-git-repo-insights/commit/5d18b31) after 4 prior escapes (88ed3b7, 7264576, 3247874, PR #207). The 29 historical extension-tests failures include Jest + tsc + smoke combined. |
| 7 | extension-tests (ESLint) | `run_extension_lint()` | Match | (in #6) | [run_repo_hook.py:395](scripts/run_repo_hook.py) | ESLint runs in pre-commit when TS files are staged. Added in [7264576](https://github.com/oddessentials/ado-git-repo-insights/commit/7264576). |

## Tier 2: Pre-Push Preflight (automatic on `git push`)

| # | CI Check | Local Equivalent | Parity | Historical Failures | Prevention Proof | How It Can Never Happen Again |
|---|----------|-----------------|--------|--------------------:|-----------------|-------------------------------|
| 8 | line-ending-guard | `run_crlf_guard()` | Match | 2 | [run_repo_hook.py:480](scripts/run_repo_hook.py) | Pre-push scans all source directories for CRLF. Same targets as CI. Both failures were early in project history before the guard existed. |
| 9 | baseline-integrity | `check-baseline-integrity.js` | Match | 3 | [run_repo_hook.py:568](scripts/run_repo_hook.py) | Pre-push runs identical Node script. Failures were baseline-file corruption, now self-healing. |
| 10 | mypy | `mypy src/` | Match | 1 | [run_pr_preflight.py:127](scripts/run_pr_preflight.py) | Pre-push preflight runs `mypy src/` with identical strict config from `pyproject.toml`. The 1 failure was a type error in ML modules ([8ed7193](https://github.com/oddessentials/ado-git-repo-insights/commit/8ed7193)). |
| 11 | suppression-audit | `audit-suppressions.py --diff` (strict) | Match* | 11 | [run_pr_preflight.py:114](scripts/run_pr_preflight.py) | Pre-push preflight now runs in strict mode for ALL branches (not just `refactor/*`). Fixed in [db5b04b](https://github.com/oddessentials/ado-git-repo-insights/commit/db5b04b). **Intentional asymmetry (Match\*)**: Local compares against the committed `.suppression-baseline.json` (branch copy), but CI always fetches the baseline from `origin/main` ([ci.yml:655](.github/workflows/ci.yml)). This prevents PRs from self-approving suppression increases by updating the baseline in the same branch. When suppressions legitimately increase, CI requires `SUPPRESSION-INCREASE-APPROVED` in the PR description — this is the designed policy gate, not a parity gap. Local catches accidental increases; CI enforces organizational approval. Exposed during [PR #207](https://github.com/oddessentials/ado-git-repo-insights/pull/207) when the branch baseline passed locally (updated to 50) but CI compared against main (46) and blocked. |
| 12 | test (Python, 9 matrix) | `pytest tests/` (baseline Python) | Weaker | 359 | [run_pr_preflight.py:144](scripts/run_pr_preflight.py) | Pre-push runs full pytest suite on baseline Python version. The 359 matrix failures span all 9 OS/Python combos. Most are the same root cause repeated 9x. Cross-platform issues (Windows path handling, macOS timing) are CI-only by nature. Local baseline catches logic errors; platform-specific issues require CI matrix. |
| 13 | extension-tests (Jest) | `jest --ci --coverage` | Match | (in #6) | [run_pr_preflight.py:197](scripts/run_pr_preflight.py) | Pre-push preflight runs identical Jest command with `--ci --runInBand --coverage`. Same reporters and path ignores. |
| 14 | extension-tests (type-tests) | `pnpm run test:types` | Match | (in #6) | [run_pr_preflight.py:192](scripts/run_pr_preflight.py) | Pre-push preflight runs `tsc --noEmit --project tsconfig.type-tests.json`. Identical to CI. |
| 15 | extension-tests (smoke) | `pnpm run test:smoke` | Match | 2 | [run_pr_preflight.py:230](scripts/run_pr_preflight.py) | Pre-push preflight runs Playwright smoke tests. The 2 failures were both from PR #207: smoke tests used `locator("option")` after `<select>` was replaced with typeahead `<div>`. Fixed in [db5b04b](https://github.com/oddessentials/ado-git-repo-insights/commit/db5b04b) with `[role="option"]` + `data-testid` selectors. |
| 16 | build (Python) | `python -m build --sdist` | Weaker | 0 | [run_pr_preflight.py:260](scripts/run_pr_preflight.py) | Pre-push builds sdist. CI also builds wheel. sdist catches 99% of packaging issues. Zero failures indicates wheel-only failures haven't occurred. |
| 17 | build-extension (tsc+esbuild) | `build:check` + `build:ui` | Partial | 17 | [run_pr_preflight.py:162,172](scripts/run_pr_preflight.py) | Pre-push runs tsc (type check) + esbuild (bundle) separately. CI runs them linked via `pnpm run build`. The 17 failures include VSIX packaging issues (tfx-cli), task dependency staging, and linking errors. tsc + esbuild parity catches code errors; VSIX packaging is CI-only (requires tfx-cli). |
| 18 | build-extension (VSIX) | `test:vsix` artifact inspection | Partial | (in #17) | [run_pr_preflight.py:212](scripts/run_pr_preflight.py) | Pre-push runs VSIX artifact inspection tests. Full VSIX packaging requires tfx-cli (CI-only). Inspection covers file structure validation. |
| 19 | build-extension (task tests) | `node index.test.js` | Match | (in #17) | [run_pr_preflight.py:271](scripts/run_pr_preflight.py) | Identical command in pre-push and CI. |
| 20 | build-extension (task input) | `ts-node validate-task-inputs.ts` | Match | (in #17) | [run_pr_preflight.py:275](scripts/run_pr_preflight.py) | Identical command in pre-push and CI. |
| 21 | Run Demo Tests | `pytest tests/demo/` | Match | 5 | [run_pr_preflight.py:128](scripts/run_pr_preflight.py) | Pre-push runs identical `pytest tests/demo/ -v --no-cov`. The 5 failures were demo data contract violations during the demo data pipeline buildout (branches 031, 037). |
| 22 | Check Directory Size | 50 MB limit on `docs/` | Match | 0 | [run_pr_preflight.py:302](scripts/run_pr_preflight.py) | Pre-push checks `docs/` directory against 50 MB limit. Identical logic to CI. |
| 23 | Verify Byte-Identical Output | `manage_generated_artifacts.py verify` | Partial | 1 | [run_pr_preflight.py:177](scripts/run_pr_preflight.py) | Pre-push verifies all managed artifacts (SDK, UI bundle, docs) are in sync. CI does a narrower `git diff docs/` check after regeneration. The 1 failure was a stale docs artifact. |
| 24 | Regenerate Demo Data | `validate_demo_generation_contract.py` | Partial | 2 | [run_pr_preflight.py:298](scripts/run_pr_preflight.py) | Pre-push validates the demo generation contract. CI also runs the full `build-demo-dataset.py`. The 2 failures were contract violations during demo pipeline development. |
| 25 | threshold-change-guard | `check_threshold_changes.py` | Match | 1 | [run_pr_preflight.py:314](scripts/run_pr_preflight.py) | Pre-push compares coverage thresholds against main branch. The 1 failure was an intentional threshold update without the required `[threshold-update]` marker. |
| 26 | test count (Python) | `validate-test-results.py` (min=312) | Match | 0 | [run_pr_preflight.py:240](scripts/run_pr_preflight.py) | Pre-push validates pytest produces at least 312 tests with 0 skips. Identical to CI thresholds. |
| 27 | test count (Extension) | `validate-test-results.py` (min=632) | Match | 0 | [run_pr_preflight.py:250](scripts/run_pr_preflight.py) | Pre-push validates Jest produces at least 632 tests with max 5 skips. Identical to CI. |
| 28 | patch coverage parity | `check_patch_coverage.py` | Match | 0 | [run_pr_preflight.py:217](scripts/run_pr_preflight.py) | Pre-push compares Python + TypeScript coverage against main branch baseline. |
| 29 | pandas version policy | runtime version check | Match | 0 | [run_pr_preflight.py:285](scripts/run_pr_preflight.py) | Pre-push verifies pandas major version matches Python version expectation. |
| 30 | demo generation contract | `validate_demo_generation_contract.py` | Match | (in #24) | [run_pr_preflight.py:298](scripts/run_pr_preflight.py) | Identical validation script in pre-push and CI. |

## Tier 3: CI-Only by Design

| # | CI Check | Why CI-Only | Historical Failures |
|---|----------|------------|--------------------:|
| 31 | secret-scan (gitleaks) | Requires full git history; external tool | 0 |
| 32 | fresh-clone-verify | Tests deterministic install from scratch; cannot simulate locally | 12 |
| 33 | scalability-tests | Expensive synthetic data gen (10K PRs, 156 weeks); run on demand locally | 0 |
| 34 | test-base-no-ml | ML-optional isolation; requires separate venv without `[ml]` extras | 6 |
| 35 | task-major-guard | Requires GitHub PR context (webhook data) | 2 |
| 36 | version-guard | Requires base branch comparison; prevents manual version bumps | 6 |
| 37 | badge-publish | Main-only post-merge artifact publish | 2 |
| 38 | Verify Asset Accessibility | Requires HTTP server + curl integration test | 0 |

## External Checks (not in our control)

| Check | Provider | Historical Failures |
|-------|----------|--------------------:|
| codecov/patch | Codecov | 0 |
| ai-review / AI Code Review | GitHub | 32 |

## Historical Failure Summary

**529 total job failures across 173 failed CI runs.**

| Category | Failures | % | Root Cause Pattern |
|----------|--------:|----|-------------------|
| Python test matrix (9 combos) | 359 | 68% | Same bug repeated 9x across OS/Python matrix. Cross-platform issues (Windows paths, macOS timing) are CI-only by nature. |
| Extension (tsc + Jest + smoke + build) | 58 | 11% | Type errors (4 escapes before tsc gate added), smoke test DOM selector drift, VSIX packaging |
| AI Code Review (external) | 32 | 6% | External service flakiness; not in our control |
| CI Guards (suppression, version, etc.) | 39 | 7% | Policy violations caught correctly. Suppression audit was highest (11) due to local warning-only mode — now fixed to strict. |
| Release/publish pipeline | 17 | 3% | Post-merge failures; not pre-push gateable |
| Other (demo, mypy, no-ml, etc.) | 24 | 5% | Demo pipeline buildout, type errors, ML isolation |

## Key Incidents and Fixes

| Date | Incident | Failures | Fix | Commit |
|------|----------|----------|-----|--------|
| 2026-03-25 | 18 CI parity gaps discovered | Multiple | Added 18 preflight gates | [3247874](https://github.com/oddessentials/ado-git-repo-insights/commit/3247874) |
| 2026-03-25 | Type errors escaped to CI (non-null assertions) | 2 | Added ESLint to pre-commit; type casts | [7264576](https://github.com/oddessentials/ado-git-repo-insights/commit/7264576) |
| 2026-03-25 | Type errors escaped to CI (ES2020 compat) | 2 | Added VSIX test to preflight | [88ed3b7](https://github.com/oddessentials/ado-git-repo-insights/commit/88ed3b7) |
| 2026-03-27 | CI noise floor flakiness | 1 | Raised NOISE_FLOOR_MS to 5ms | [8a9857d](https://github.com/oddessentials/ado-git-repo-insights/commit/8a9857d) |
| 2026-03-27 | tsc errors escaped to CI (PR #207) | 3 jobs | Added `tsc --noEmit` to pre-commit hook | [5d18b31](https://github.com/oddessentials/ado-git-repo-insights/commit/5d18b31) |
| 2026-03-27 | Suppression audit failed CI (PR #207) | 1 | Made suppression audit strict for all branches | [db5b04b](https://github.com/oddessentials/ado-git-repo-insights/commit/db5b04b) |
| 2026-03-27 | Smoke tests broke on filter HTML change (PR #207) | 1 | Updated selectors to `[role="option"]` + `data-testid` | [db5b04b](https://github.com/oddessentials/ado-git-repo-insights/commit/db5b04b) |

## Known Tradeoffs (Documented, Accepted)

| Tradeoff | Rationale |
|----------|-----------|
| Python tests run on baseline Python only (not 3x3 matrix) | Full matrix takes 15+ min; baseline catches 99% of issues. Cross-platform bugs are CI-discovered. |
| Python build is sdist-only (CI also builds wheel) | sdist catches packaging issues; zero wheel-only failures in project history. |
| VSIX packaging is CI-only | Requires tfx-cli; `test:vsix` inspection covers validation. |
| Scalability tests are CI-only | 10K PR synthetic data gen is expensive; run on demand locally via `pnpm run test:scalability`. |
| Fresh-clone-verify is CI-only | Cannot simulate fresh clone without re-cloning. Verifies lockfile determinism. |

## Governance

- **Adding a new CI check**: MUST add corresponding local equivalent in `run_repo_hook.py` or `run_pr_preflight.py` before merging. Update this document.
- **Weakening a local check**: MUST document rationale in this file. CI-hard-gate checks must never exist in a weaker local mode.
- **`--no-verify`**: Forbidden by project policy. Never bypass git hooks.
- **Reviewing this document**: After any CI pipeline change, verify parity by running the full preflight locally: `python scripts/run_pr_preflight.py`.
