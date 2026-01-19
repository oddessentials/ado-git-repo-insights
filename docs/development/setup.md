# Development Setup

How to set up a development environment for contributing to ado-git-repo-insights.

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Python | 3.10, 3.11, or 3.12 |
| Node.js | 16+ (for extension development) |
| Git | Any recent version |

---

## Quick Setup

```bash
# Clone the repository
git clone https://github.com/oddessentials/ado-git-repo-insights.git
cd ado-git-repo-insights

# Create and activate virtual environment
python -m venv .venv
source .venv/bin/activate  # Linux/macOS
# .venv\Scripts\activate   # Windows

# Install Python dependencies (including dev tools)
pip install -e .[dev]

# Install pre-commit hooks
pip install pre-commit
pre-commit install

# Install Node.js dependencies (for extension development)
cd extension && npm ci && cd ..
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

```bash
# All tests
pytest

# With coverage
pytest --cov=src --cov-report=term-missing

# Specific test file
pytest tests/unit/test_cli_args.py

# Verbose output
pytest -v
```

---

## Extension Development

### Setup

```bash
cd extension
npm ci
```

### Running Tests

```bash
npm test
```

### Building the VSIX

```bash
npx tfx-cli extension create --manifest-globs vss-extension.json
```

This creates `OddEssentials.ado-git-repo-insights-X.Y.Z.vsix`.

### Local Testing

Upload the VSIX to a test Azure DevOps organization:
1. Go to `https://dev.azure.com/{test-org}/_settings/extensions`
2. Click **Browse local extensions** → **Manage extensions**
3. Click **Upload extension** → Select the `.vsix` file

---

## Pre-commit Hooks

Pre-commit hooks run automatically on `git commit`:

| Hook | Purpose |
|------|---------|
| `ruff` | Python linting and formatting |
| `sync_ui_bundle` | UI file synchronization (when UI files staged) |

### Manual Run

```bash
pre-commit run --all-files
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
