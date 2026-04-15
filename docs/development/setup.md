# Development Setup

How to set up a development environment for contributing to ado-git-repo-insights.

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Python | 3.12, 3.13, or 3.14 | Demo generation requires exactly 3.12 |
| Node.js | 22 | For extension development |
| pnpm | 9.15.0 | Enforced by `packageManager` field |
| Git | Any recent version | Windows: must include Git Bash |
| gitleaks | Any recent version | Secret scanning (CI parity) — [install](https://github.com/gitleaks/gitleaks#installing) |

---

## Quick Setup

```bash
# Clone the repository
git clone https://github.com/oddessentials/ado-git-repo-insights.git
cd ado-git-repo-insights

# 1. Install root Node dependencies and activate Husky git hooks
#    This MUST be the first step — hooks enforce all quality gates.
pnpm install

# 2. Create and activate Python virtual environment
python -m venv .venv
source .venv/bin/activate  # Linux/macOS
# .venv\Scripts\activate   # Windows

# 3. Install Python dependencies (including dev tools)
pip install -e .[dev]

# 4. Install extension Node.js dependencies
cd extension && pnpm install && cd ..
```

---

## Python Development

### Install Options

**Basic (for running the tool):**
```bash
pip install -e .
```

**Development (includes testing and linting tools):**
```bash
pip install -e .[dev]
```

**ML features (includes Prophet and OpenAI):**
```bash
pip install -e .[ml]
```

### Code Quality Tools

**Linting:**
```bash
ruff check .
```

**Auto-format:**
```bash
ruff format .
```

**Type checking:**
```bash
mypy src/
```

### Running Tests

Use the launcher — it isolates coverage paths so Windows file locking
cannot brick future runs:

```bash
# All tests (with coverage)
python scripts/run_pytest.py

# Specific test file
python scripts/run_pytest.py tests/unit/test_cli_args.py

# Verbose output
python scripts/run_pytest.py -v
```

---

## Extension Development

### Setup

```bash
cd extension
pnpm install
```

### Running Tests

```bash
pnpm test
```

### Building the VSIX

From the `extension/` directory:

```bash
pnpm run package:vsix
```

This builds the UI bundles, stages pipeline task dependencies, and creates
`OddEssentials.ado-git-repo-insights-X.Y.Z.vsix` in the `extension/` directory.
No global tool install is needed — `tfx-cli` is a repo devDependency.

### Local Testing

Upload the VSIX to a test Azure DevOps organization:
1. Go to `https://dev.azure.com/{test-org}/_settings/extensions`
2. Click **Browse local extensions** → **Manage extensions**
3. Click **Upload extension** → select the `.vsix` file from `extension/`

---

## Repo Hooks

Repo-owned hooks run automatically on `git commit` and `git push` through
Husky wrapper files under `.husky/`.
The authoritative implementation lives in:

- `scripts/run_repo_hook.py`
- `scripts/manage_generated_artifacts.py`

Authoritative local parity now fails closed. If `python scripts/run_pr_preflight.py`
cannot run a CI-hard gate such as Node-backed extension checks or `gitleaks`, it
exits nonzero instead of silently skipping that gate.

You do not need to run `pre-commit install` manually for normal repo usage.
`pre-commit` is still required because the repo hooks delegate Python lint/format
checks to it.

The commit/push workflow currently includes:

| Hook | Purpose |
|------|---------|
| `pre-commit` | Python formatting/lint checks, ACL health on Windows, VSS SDK drift sync, compiled artifact guard, managed UI/demo artifact sync when UI files are staged |
| `pre-push` | baseline integrity, `pre-commit --all-files`, CRLF guard, marketplace asset validation, and local PR preflight |

### Manual Run

```bash
python scripts/run_repo_hook.py pre-commit
python scripts/run_repo_hook.py pre-push

# Explicit strict preflight outside the repo-owned hook still needs a base ref
BASE_REF=main python scripts/run_pr_preflight.py --strict

# Or via the extension package scripts
cd extension
pnpm run hooks:precommit
pnpm run hooks:prepush
```

### Skip Hooks (Not Recommended)

```bash
git commit --no-verify -m "message"
```

---

## Line Endings

This repo uses **LF line endings** for cross-platform compatibility.

**Recommended Git config:**
```bash
# Let .gitattributes be the source of truth
git config core.autocrlf false
```

If you see "CRLF will be replaced by LF" warnings, that's expected behavior.

---

## Project Structure

```
ado-git-repo-insights/
├── src/ado_git_repo_insights/    # Python package source
│   ├── cli.py                    # CLI entry point
│   ├── ado_client.py             # Azure DevOps API client
│   ├── pr_extractor.py           # Extraction logic
│   ├── repository.py             # SQLite operations
│   ├── csv_generator.py          # CSV generation
│   ├── aggregates.py             # Dashboard aggregates
│   └── ui_bundle/                # Dashboard UI (synced from extension)
├── extension/                     # Azure DevOps extension
│   ├── task/                      # Pipeline task
│   ├── ui/                        # Dashboard UI (source of truth)
│   └── hub/                       # Extension hub
├── tests/                         # Test suite
│   ├── unit/                      # Unit tests
│   ├── integration/               # Integration tests
│   └── fixtures/                  # Test data
├── scripts/                       # Build and utility scripts
├── agents/                        # Governance documents
└── docs/                          # Documentation
```

---

## See Also

- [Testing Guide](testing.md) — Test organization and patterns
- [UI Bundle Sync](ui-bundle-sync.md) — Dashboard UI synchronization
- [Contributing Guide](../../CONTRIBUTING.md) — Contribution workflow
