# Testing Guide

How tests are organized and how to run them.

---

## Test Organization

```
tests/
├── unit/                  # Isolated component tests
│   ├── test_cli_args.py
│   ├── test_config_validation.py
│   ├── test_secret_redaction.py
│   └── ...
├── integration/           # End-to-end workflow tests
│   ├── test_golden_outputs.py
│   ├── test_incremental_run.py
│   └── ...
└── fixtures/              # Test data
    ├── golden_db.sqlite   # Golden database for regression
    ├── expected/          # Expected output files
    └── README.md          # Fixtures documentation
```

---

## Running Tests

### Python Tests

```bash
# All tests
pytest

# With coverage
pytest --cov=src --cov-report=term-missing

# Specific file
pytest tests/unit/test_cli_args.py

# Specific test
pytest tests/unit/test_cli_args.py::test_parse_args_minimal

# Verbose
pytest -v

# Stop on first failure
pytest -x
```

### Extension Tests

```bash
cd extension
pnpm test
```

---

## Test Categories

### Unit Tests

Isolated component tests using mocks.

**Key files:**
| File | Tests |
|------|-------|
| `test_cli_args.py` | CLI argument parsing |
| `test_config_validation.py` | Configuration loading |
| `test_secret_redaction.py` | PAT is never logged |
| `test_logging_config.py` | Logging formatters |
| `test_run_summary.py` | Summary file generation |

### Integration Tests

End-to-end workflow validation.

**Key files:**
| File | Tests |
|------|-------|
| `test_golden_outputs.py` | CSV contract compliance |
| `test_incremental_run.py` | Incremental extraction |
| `test_db_operations.py` | SQLite UPSERT semantics |

### Drift Guards

CI guards that prevent documentation from going stale.

**Example:** `test_summary_drift_guard.py` verifies documentation accuracy.

---

## Golden Tests

The `test_golden_outputs.py` tests verify CSV output against known-good baselines.

**Golden fixtures:**
- `tests/fixtures/golden_db.sqlite` — Reference database
- `tests/fixtures/expected/*.csv` — Expected CSV output

**Updating golden fixtures:**

```bash
# Regenerate expected outputs
pytest tests/integration/test_golden_outputs.py --golden-update

# Or manually:
ado-insights generate-csv \
  --database tests/fixtures/golden_db.sqlite \
  --output tests/fixtures/expected
```

---

## Mocking

### ADO API Mocks

Integration tests use mocked API responses:

```python
@pytest.fixture
def mock_ado_client(mocker):
    client = mocker.Mock()
    client.get_pull_requests.return_value = [
        {"pullRequestId": 1, ...}
    ]
    return client
```

### Extension Mocks

Extension tests mock the ADO SDK:

```typescript
jest.mock('azure-devops-extension-sdk', () => ({
  init: jest.fn().mockResolvedValue(undefined),
  getConfiguration: jest.fn().mockReturnValue({}),
}));
```

---

## CI Integration

### Python CI Matrix

Tests run across:
- 3 operating systems (Ubuntu, Windows, macOS)
- 3 Python versions (3.10, 3.11, 3.12)

### Local CI Parity

The default pre-push hook is a strong workstation gate, but it is not a full
replacement for the CI matrix. Before high-risk pushes, run the repo parity
runner:

```bash
python scripts/run_ci_parity.py
```

What it verifies:
- CI-critical Python scripts under the supported interpreter matrix
- drift checks such as tool-version parity and suppression auditing
- version-specific import/runtime issues in CI-invoked Python entrypoints

For stronger confidence on machines with healthy local interpreter installs:

```bash
python scripts/run_ci_parity.py --mode full
```

Requirements:
- Local Python 3.10, 3.11, and 3.12 must be installed, or the script will fail
- `compatibility` mode runs directly on those interpreters and is the minimum
  pre-push cross-version gate
- `full` mode additionally creates per-version virtual environments and runs
  targeted smoke tests
- Docker Desktop can be used for future Linux parity expansion, but the script
  currently only checks whether Docker is reachable
- If interpreter discovery differs on your machine, set environment overrides
  such as `CI_PARITY_PYTHON_3_10`, `CI_PARITY_PYTHON_3_11`, and
  `CI_PARITY_PYTHON_3_12`

For the current machine, treat a missing interpreter as a blocker rather than a
warning if you need CI-grade confidence before pushing.

### Local PR Preflight

Before any push that is expected to keep an open PR green, run the repo-owned
preflight:

```bash
python scripts/run_pr_preflight.py
```

What it verifies:
- `mypy src/`
- `tests/demo/` with `--no-cov` so demo dashboard validation is exercised
- full Python suite with coverage
- extension `build:check`
- extension lint
- extension UI build
- managed generated artifact parity
- extension type tests
- extension Jest CI
- extension smoke tests

Why this exists:
- it uses stable temp/cache/coverage paths under the OS temp directory
- it avoids the Windows repo-root lock problems that can make ad hoc pytest runs
  noisy or misleading
- it makes demo validation a required local gate instead of a remembered extra step
- it resolves Python 3.10 explicitly, so the gate runs on a supported baseline
  interpreter even if your shell default points elsewhere

Recommended workflow:
1. `python scripts/run_repo_hook.py pre-commit`
2. `python scripts/run_repo_hook.py pre-push`
3. `python scripts/run_ci_parity.py` for higher-confidence matrix parity when needed
4. push only after the relevant gates pass for the change you made

### CI Checks

All PRs must pass:

| Check | Purpose |
|-------|---------|
| Secret scanning (gitleaks) | No secrets in code |
| Line ending checks | No CRLF in Unix files |
| UI bundle sync | Dashboard files synchronized |
| Python tests | Full test suite |
| Extension tests | Jest test suite |
| Pre-commit hooks | Ruff linting/formatting |

---

## Test Coverage

**Target:** 70%+ code coverage (enforced in CI)

**Check coverage:**
```bash
pytest --cov=src --cov-report=html
open htmlcov/index.html
```

---

## Writing Tests

### Naming Conventions

```python
# File: test_{module}.py
# Function: test_{behavior}_when_{condition}

def test_extract_returns_empty_when_no_prs():
    ...

def test_csv_columns_match_schema():
    ...
```

### Test Invariants

Many tests verify system invariants:

```python
def test_pat_not_logged(caplog):
    """Invariant 19: PAT is never logged."""
    # ... test implementation
```

Reference `agents/INVARIANTS.md` for the full list.

---

## Fixtures

### Test Database

`tests/fixtures/golden_db.sqlite` contains sample data for testing.

### Expected Outputs

`tests/fixtures/expected/` contains expected CSV outputs.

### Legacy Datasets

`extension/tests/fixtures/legacy-datasets/` contains old schema versions for backward compatibility testing.

---

## See Also

- [Development Setup](setup.md) — Environment setup
- [Invariants](../../agents/INVARIANTS.md) — System guarantees to test
- [Definition of Done](../../agents/definition-of-done.md) — Completion criteria
