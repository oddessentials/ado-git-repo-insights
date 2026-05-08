# Contributing to ADO Git Repo Insights

Thanks for contributing. This document covers PR workflow and commit conventions; environment setup lives in [`docs/development/setup.md`](docs/development/setup.md).

---

## Setup

**Recommended**: open the repo in a [Dev Container](.devcontainer/). It handles every per-platform tooling concern automatically.

**Native setup (advanced)**: see [`docs/development/setup.md`](docs/development/setup.md).

---

## Pull Requests

1. Branch from `main`.
2. Write tests for new behavior.
3. Run the authoritative local PR preflight before pushing:
   ```bash
   python scripts/run_pr_preflight.py
   ```
   Pre-push hooks invoke this automatically; run it standalone when pushing from an environment that skips hooks.
4. Keep PRs focused — one feature or fix per PR.
5. Update docs only when behavior changes.

### Documentation drift prevention

Don't hardcode counts, line numbers, or matrix dimensions that derive from a source of truth elsewhere. Describe the property and link to the authoritative file. Prerequisite versions a user must install (Node 22, Python 3.12) are fine to state directly — they're actionable, not derived.

### Test floor & coverage thresholds

- Adding tests requires bumping the matching suite in [`.test-floor-contract.json`](.test-floor-contract.json) **in the same commit**.
- Changing a coverage threshold (`pyproject.toml::fail_under` or any `extension/jest.config.ts` threshold) requires `[threshold-update]` in the commit subject.
- Bypass markers `[ratchet-realignment]` and `[ratchet-test-removal]` apply to Python only.
- Full workflow & recovery decision tree: [`docs/development/ratchets.md`](docs/development/ratchets.md).

### CI

All PRs pass the gates declared in [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Local equivalents and the gate-by-gate parity contract: [`LOCAL_CI_PARITY_INVARIANTS.md`](LOCAL_CI_PARITY_INVARIANTS.md).

---

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <description>`.

| Type | Purpose | Version bump |
|------|---------|--------------|
| `feat` | New feature | minor |
| `fix` | Bug fix | patch |
| `perf` | Performance | patch |
| `docs` / `test` / `chore` / `refactor` / `ci` | n/a | none |

**Breaking changes**: `feat!:` (or `fix!:`) AND `BREAKING CHANGE:` in the body.

**ADO task major-version bumps**: include `BREAKING TASK CHANGE:` in the PR title or commit message.

---

## Generated artifacts

The dashboard UI lives in two synced locations: `extension/ui/` (source of truth) and `src/ado_git_repo_insights/ui_bundle/` (pip package). Always edit `extension/ui/`; sync with:

```bash
python scripts/manage_generated_artifacts.py sync --scope ui
git add extension/ui/ src/ado_git_repo_insights/ui_bundle/
```

Details: [`docs/development/ui-bundle-sync.md`](docs/development/ui-bundle-sync.md).

---

## Governance

- [`agents/INVARIANTS.md`](agents/INVARIANTS.md) — system invariants, organized by category
- [`agents/definition-of-done.md`](agents/definition-of-done.md) — completion criteria
- [`LOCAL_CI_PARITY_INVARIANTS.md`](LOCAL_CI_PARITY_INVARIANTS.md) — gate-by-gate parity contract

---

## Questions?

- Existing issues: [GitHub Issues](https://github.com/oddessentials/ado-git-repo-insights/issues)
- Open a new issue with the `question` label.
</content>
