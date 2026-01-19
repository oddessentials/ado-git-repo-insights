# Contributing to ADO Git Repo Insights

Thank you for your interest in contributing! This document covers the essential guidelines for contributing to this project.

## Development Setup

1. Clone the repository
2. Install Python dependencies:
   ```bash
   pip install -e .[dev]
   ```
3. Install Node.js dependencies for extension development:
   ```bash
   cd extension && npm ci
   ```
4. Install pre-commit hooks:
   ```bash
   pip install pre-commit
   pre-commit install
   ```

## Running Tests

### Python Tests
```bash
pytest
```

### Extension Tests
```bash
cd extension && npm test
```

---

## UI Bundle Synchronization (IMPORTANT)

The dashboard UI files exist in **two locations** that must stay synchronized:

| Location | Purpose |
|----------|---------|
| `extension/ui/` | Source of truth for Azure DevOps extension |
| `src/ado_git_repo_insights/ui_bundle/` | Copy for Python pip package |

### Why Two Locations?

- **Symlinks don't work with pip packages**: When building Python wheels with setuptools, symlinks are not preserved. The wheel would contain broken symlinks instead of actual files.
- **The `ado-insights dashboard` command requires bundled UI files**: When users install via `pip install ado-git-repo-insights`, the UI files must be physically present in the package.

### Synchronization Process

UI bundle synchronization is automated:

- The `scripts/sync_ui_bundle.py` script mirrors `extension/ui/` into `ui_bundle/`.
- The pre-commit hook runs the sync automatically when UI files are staged.
- CI enforces that the synchronized files are committed.

If you need to sync manually (for example, when running outside of Git hooks), run:

```bash
python scripts/sync_ui_bundle.py
```

Then commit both locations together.

### CI Enforcement

The `ui-bundle-sync` CI job automatically verifies synchronization on every PR. If the directories are out of sync, the job will fail and display:
- A patch-format diff showing the differences
- Instructions on how to fix the issue

### Files Ignored During Sync Check

The following file patterns are ignored during synchronization checks:
- `*.map` (source maps)
- `.DS_Store` (macOS metadata)
- `*.swp`, `*~`, `*.bak` (editor backup files)

---

## Commit Message Format

This project uses [Conventional Commits](https://www.conventionalcommits.org/) for semantic versioning:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types
- `feat`: New feature (triggers minor version bump)
- `fix`: Bug fix (triggers patch version bump)
- `docs`: Documentation only
- `test`: Adding or updating tests
- `chore`: Maintenance tasks
- `refactor`: Code changes that neither fix bugs nor add features
- `perf`: Performance improvements
- `ci`: CI/CD changes

### Breaking Changes

For breaking changes, add `BREAKING CHANGE:` in the commit body or append `!` after the type:

```
feat(api)!: change response format

BREAKING CHANGE: The API now returns dates in ISO 8601 format.
```

### Task Version Changes

Changes to the Azure DevOps task Major version require special approval. Include `BREAKING TASK CHANGE:` in the PR title or commit message to acknowledge the breaking change.

---

## Pull Request Guidelines

1. **Create a feature branch** from `main`
2. **Write tests** for new functionality
3. **Run the full test suite** before submitting
4. **Keep PRs focused** - one feature or fix per PR
5. **Update documentation** if behavior changes

### CI Checks

All PRs must pass:
- Secret scanning (gitleaks)
- Line ending checks (no CRLF in Unix-executed files)
- UI bundle synchronization check
- Python tests (matrix: 3 OSes × 3 Python versions)
- Extension tests
- Pre-commit hooks (ruff, formatting)

---

## Architecture Notes

### Dataset Contract

The dataset format is documented in `docs/dataset-contract.md`. Changes to the dataset schema require:
1. Version bump in manifest
2. Update to schema documentation
3. Backward compatibility consideration

### ML Features

ML features are optional and gated behind the `[ml]` extra:
```bash
pip install ado-git-repo-insights[ml]
```

The base package must function without ML dependencies. See `tests/unit/test_ml_cli_flags.py` for isolation tests.

---

## Questions?

- Check existing issues for similar questions
- Open a new issue with the `question` label
