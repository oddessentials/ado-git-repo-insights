# Contributing to ADO Git Repo Insights

Thank you for your interest in contributing! This document covers the essential guidelines.

---

## Required Tools

| Tool | Version | Windows | macOS/Linux |
|------|---------|---------|-------------|
| Git (with Git Bash) | any | [git-scm.com](https://git-scm.com/download/win) | Package manager |
| Python | >= 3.12 | [python.org](https://python.org) (includes `py` launcher) | Package manager |
| Node.js | 22 | [nodejs.org](https://nodejs.org) | Package manager |
| pnpm | 9.15.0 | `corepack enable` | `corepack enable` |

**Windows note:** Git for Windows must include Git Bash (provides `sh` for
Husky hooks). Python for Windows includes the `py` launcher, which is the
primary Python resolution mechanism on Windows.

## Quick Start

See [Development Setup Guide](docs/development/setup.md#quick-setup) for the full
environment bootstrap (uv-managed Python 3.12, root + extension Node deps, Husky
hooks, Playwright browsers). In brief:

```bash
git clone https://github.com/oddessentials/ado-git-repo-insights.git
cd ado-git-repo-insights
pnpm install                 # activates Husky; MUST be first
uv python install 3.12       # canonical interpreter for CI-hard gates
uv sync --extra dev          # project venv + Python dev deps
cd extension && pnpm install # extension deps + Playwright browsers
```

---

## Running Tests

```bash
# Python (use the launcher — it isolates coverage paths on all platforms)
python scripts/run_pytest.py

# Python with arguments
python scripts/run_pytest.py tests/unit/ -v
python scripts/run_pytest.py -k test_foo

# Extension
cd extension && pnpm test

# Authoritative local PR gate
python scripts/run_pr_preflight.py

# High-confidence CI parity for supported Python versions
python scripts/run_ci_parity.py

# Deeper parity with isolated per-version environments
python scripts/run_ci_parity.py --mode full
```

`run_pytest.py` isolates coverage paths to avoid Windows repo-root lock
issues. See [Testing Guide](docs/development/testing.md#running-tests)
for the full rationale and when to use bare `pytest` instead.

`run_pr_preflight.py` resolves Python 3.12 explicitly, so it stays on a
supported baseline interpreter even if your shell default points elsewhere.
It is authoritative by default: if CI-hard local tooling such as Node-backed
extension gates or `gitleaks` is unavailable, the command fails instead of
silently degrading. Use `--allow-local-degraded` only for diagnostics on a
broken workstation. Pre-push hooks invoke the preflight automatically; run
it standalone when pushing from an environment that skips hooks.

**Detailed testing:** [Testing Guide](docs/development/testing.md)

---

## Pull Request Guidelines

1. **Create a feature branch** from `main`
2. **Write tests** for new functionality
3. **Run the full test suite** before submitting
4. **Keep PRs focused** — one feature or fix per PR
5. **Update documentation** if behavior changes

### Documentation Drift Prevention

When updating docs, never hardcode values that are derived from a source of truth
elsewhere. Hardcoded counts, line numbers, and matrix dimensions rot silently.

| Instead of | Do this |
|------------|---------|
| Counting items ("26 invariants") | Describe the property; the linked file has the count |
| Line number references ("line 245") | Name the function or code block; lines shift on every edit |
| Derived totals ("9 OS/version combos") | Describe the property + link to source ("see CI workflow") |
| Enumerating volatile lists ("ruff, mypy, ...") | Point to the authoritative script or config |

Prerequisite versions users must install (Node.js 22, Python 3.12+) are fine to state
directly — they are actionable requirements, not derived counts.

### Test-Count Floor & Coverage Thresholds

Adding tests requires bumping the matching suite in `.test-floor-contract.json`
in the same commit. Changing a coverage threshold (`pyproject.toml::fail_under`
or any `extension/jest.config.ts` threshold, global or per-file) requires
`[threshold-update]` in the commit subject. Bypass markers for test-count drift
(`[ratchet-realignment]`, `[ratchet-test-removal]`) apply to Python only —
extension drift has no marker escape. See
[docs/development/ratchets.md](docs/development/ratchets.md) for the full
workflow, recovery decision tree, and the partial-branches baseline gate.

### CI Checks

All PRs must pass the discrete CI jobs declared in
[`.github/workflows/ci.yml`](/.github/workflows/ci.yml). The workflow is the
source of truth; the list is intentionally not enumerated here to avoid drift.
Gate families that land on PRs include:

- Security scanning (e.g. gitleaks)
- Repository policy gates (line endings, pnpm lockfile, UI bundle parity,
  invariant guards, version guards, commitlint, etc.)
- Python tests across the OS/Python matrix declared in the workflow
- Extension tests (Jest, type-tests, smoke)
- Lint/format/suppression audits (one CI step invokes `pre-commit run
  --all-files` alongside standalone jobs)
- Release packaging checks

CI enforces each of these as a **separate job**, not as a single "pre-commit"
step. To reproduce a given failure locally, look up the failing job name in
the workflow and run its documented local equivalent -- some map to
`pre-commit run --all-files --hook-stage pre-push`, others to `python
scripts/run_repo_hook.py pre-push`, and the authoritative full check is
`python scripts/run_pr_preflight.py`. See
[`LOCAL_CI_PARITY_INVARIANTS.md`](/LOCAL_CI_PARITY_INVARIANTS.md) for the
gate-by-gate parity contract.

---

## Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

### Types

| Type | Purpose | Version Bump |
|------|---------|--------------|
| `feat` | New feature | Minor |
| `fix` | Bug fix | Patch |
| `docs` | Documentation only | None |
| `test` | Adding/updating tests | None |
| `chore` | Maintenance | None |
| `refactor` | Code changes (no behavior change) | None |
| `perf` | Performance improvements | Patch |
| `ci` | CI/CD changes | None |

### Breaking Changes

Add `BREAKING CHANGE:` in body or `!` after type:

```
feat(api)!: change response format

BREAKING CHANGE: The API now returns dates in ISO 8601 format.
```

### Task Version Changes

Changes to the Azure DevOps task Major version require special approval. Include `BREAKING TASK CHANGE:` in the PR title or commit message.

---

## Generated UI And Demo Artifacts

The dashboard UI exists in two locations that must stay synchronized:
- `extension/ui/` — Source of truth
- `src/ado_git_repo_insights/ui_bundle/` — Copy for pip package

Additional published/demo mirrors are also managed:
- `docs/` — published demo shell and built UI assets
- `extension/tests/fixtures/broken-docs/` — broken-docs fixture shell/assets

**Always edit `extension/ui/`** and use the managed artifact sync before committing:

```bash
python scripts/manage_generated_artifacts.py sync --scope ui
git add extension/ui/ src/ado_git_repo_insights/ui_bundle/
```

If your change affects the published demo or you want the full generated surface
refreshed explicitly:

```bash
python scripts/manage_generated_artifacts.py sync --scope all
```

To run the repo-owned hooks directly:

```bash
python scripts/run_repo_hook.py pre-commit
python scripts/run_repo_hook.py pre-push

# Optional: strict preflight with explicit base ref (hook runs non-strict by default)
BASE_REF=main python scripts/run_pr_preflight.py --strict
```

**Details:** [UI Bundle Sync Guide](docs/development/ui-bundle-sync.md)

---

## Line Endings

This repo uses LF line endings. Configure Git:

```bash
git config core.autocrlf false
```

---

## Architecture Notes

### Dataset Contract

Changes to the dataset schema require:
1. Version bump in manifest
2. Update to schema documentation
3. Backward compatibility consideration

**Details:** [Dataset Contract](docs/reference/dataset-contract.md)

### ML Features

ML features are optional and gated behind `[ml]`:

```bash
pip install ado-git-repo-insights[ml]
```

The base package must function without ML dependencies.

---

## Development Documentation

| Document | Description |
|----------|-------------|
| [Development Setup](docs/development/setup.md) | Environment setup |
| [Testing Guide](docs/development/testing.md) | Test organization and patterns |
| [UI Bundle Sync](docs/development/ui-bundle-sync.md) | Dashboard synchronization |

---

## Governance

Internal development principles (for agents and maintainers):

| Document | Description |
|----------|-------------|
| [Invariants](agents/INVARIANTS.md) | Non-negotiable system invariants |
| [Definition of Done](agents/definition-of-done.md) | Completion criteria |
| [Verification Gates](agents/definition-of-done.md#end-to-end-verification-gates) | Verification checkpoints |

**How to use these docs:** Invariants are organized by category (Output
Contract, Persistence, Extraction, etc.) — read the category that matches
your change area. Definition of Done maps each category to its evidence
(test files and CI gates), so use it to find which tests cover your change.
Victory Gates is the end-to-end verification checklist to run before
declaring a feature complete.

---

## Questions?

- Check existing [GitHub Issues](https://github.com/oddessentials/ado-git-repo-insights/issues)
- Open a new issue with the `question` label
