# Contributing to ADO Git Repo Insights

Thank you for your interest in contributing! This document covers the essential guidelines.

---

## Quick Start

```bash
# Clone and setup
git clone https://github.com/oddessentials/ado-git-repo-insights.git
cd ado-git-repo-insights

# Python environment
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -e .[dev]

# Pre-commit hooks
pip install pre-commit
pre-commit install

# Extension (if working on ADO extension)
cd extension && npm ci && cd ..
```

**Detailed setup:** [Development Setup Guide](docs/development/setup.md)

---

## Running Tests

```bash
# Python
pytest

# Extension
cd extension && npm test
```

**Detailed testing:** [Testing Guide](docs/development/testing.md)

---

## Pull Request Guidelines

1. **Create a feature branch** from `main`
2. **Write tests** for new functionality
3. **Run the full test suite** before submitting
4. **Keep PRs focused** — one feature or fix per PR
5. **Update documentation** if behavior changes

### CI Checks

All PRs must pass:
- Secret scanning (gitleaks)
- Line ending checks
- UI bundle synchronization
- Python tests (9 OS/version combinations)
- Extension tests
- Pre-commit hooks (ruff)

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

## UI Bundle Synchronization

The dashboard UI exists in two locations that must stay synchronized:
- `extension/ui/` — Source of truth
- `src/ado_git_repo_insights/ui_bundle/` — Copy for pip package

**Always edit `extension/ui/`** and run sync before committing:

```bash
python scripts/sync_ui_bundle.py
git add extension/ui/ src/ado_git_repo_insights/ui_bundle/
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

| Document | Description |
|----------|-------------|
| [Invariants](agents/INVARIANTS.md) | 25 non-negotiable system invariants |
| [Definition of Done](agents/definition-of-done.md) | Completion criteria |
| [Victory Gates](agents/victory-gates.md) | Verification checkpoints |

---

## Questions?

- Check existing [GitHub Issues](https://github.com/oddessentials/ado-git-repo-insights/issues)
- Open a new issue with the `question` label
