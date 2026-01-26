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
npm test
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
