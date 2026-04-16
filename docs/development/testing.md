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
    ├── golden/            # Golden reference data
    ├── nested_artifacts/  # Staging normalization fixtures
    ├── staged_artifacts/  # Pipeline artifact fixtures
    └── README.md          # Fixtures documentation
```

---

## Running Tests

### Python Tests

```bash
# Supported local entrypoint (Windows-safe path, same pytest-cov semantics as CI)
python scripts/run_pytest.py

# Specific file
python scripts/run_pytest.py tests/unit/test_cli_args.py

# Specific test
python scripts/run_pytest.py tests/unit/test_cli_args.py::test_parse_args_minimal

# Verbose
python scripts/run_pytest.py -v

# Stop on first failure
python scripts/run_pytest.py -x
```

Bare `python -m pytest` remains available for advanced/manual use, but it is not
the hardened local dev path on Windows. Use the launcher above for routine local
runs so temp-path and coverage behavior match the supported workflow.

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
Golden tests use **dynamic fixtures** — they create temporary SQLite databases and
generate CSVs at test time, then validate schema, determinism, and column contracts
without pre-baked reference files on disk.

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

Tests run across all supported operating systems and Python versions
(see `.github/workflows/ci.yml` for the current matrix):
- Operating systems: Ubuntu, Windows, macOS
- Python versions: see `requires-python` in `pyproject.toml`

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
- Local Python 3.12, 3.13, and 3.14 must be installed, or the script will fail
- `compatibility` mode runs directly on those interpreters and is the minimum
  pre-push cross-version gate
- `full` mode additionally creates per-version virtual environments and runs
  targeted smoke tests
- Docker Desktop can be used for future Linux parity expansion, but the script
  currently only checks whether Docker is reachable
- If interpreter discovery differs on your machine, set environment overrides
  such as `CI_PARITY_PYTHON_3_12`, `CI_PARITY_PYTHON_3_13`, and
  `CI_PARITY_PYTHON_3_14`

For the current machine, treat a missing interpreter as a blocker rather than a
warning if you need CI-grade confidence before pushing.

### Local PR Preflight

Before any push that is expected to keep an open PR green, run the repo-owned
preflight:

```bash
python scripts/run_pr_preflight.py
```

What it verifies:
- `mypy src/ tests/ scripts/ .github/scripts/`
- `tests/demo/` with `--no-cov` so demo dashboard validation is exercised
- full Python suite with coverage
- extension `build:check`
- extension production lint for `ui/`, `scripts/`, and `tasks/_shared/`
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
- it resolves Python 3.12 explicitly, so the gate runs on a supported baseline
  interpreter even if your shell default points elsewhere
- it fails closed if CI-hard local tooling such as Node child-process support or
  `gitleaks` is unavailable, so local success cannot silently become weaker than CI

Diagnostic-only degraded mode:

```bash
python scripts/run_pr_preflight.py --allow-local-degraded
```

Use degraded mode only to gather partial diagnostics on a broken workstation. It
is non-authoritative and must not be treated as local/CI parity.

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
| Pre-commit hooks | Full gate suite (see `scripts/run_repo_hook.py`) |

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

### Golden Test Data

Golden output tests use dynamic fixtures -- temporary SQLite databases are created
and populated at test time. See `tests/fixtures/golden/` for reference data such as
constant-series forecasts.

### Staging Fixtures

`tests/fixtures/nested_artifacts/` and `tests/fixtures/staged_artifacts/` contain
artifact layout fixtures for staging normalization and pipeline artifact loading tests.

### Legacy Datasets

`extension/tests/fixtures/legacy-datasets/` contains old schema versions for backward compatibility testing.

---

## See Also

- [Development Setup](setup.md) — Environment setup
- [Invariants](../../agents/INVARIANTS.md) — System guarantees to test
- [Definition of Done](../../agents/definition-of-done.md) — Completion criteria
