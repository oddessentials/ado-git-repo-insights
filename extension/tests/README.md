# Extension Tests

This document explains the test architecture for the Azure DevOps Git Repo Insights extension.

## Test Suites

| Command | Description | Requires Python |
|---------|-------------|-----------------|
| `pnpm test` | Unit tests (default) | No |
| `pnpm test:unit` | Unit tests (explicit) | No |
| `pnpm test:all` | Unit + integration tests | Yes |
| `pnpm test:ci` | CI mode with JUnit output | Yes |
| `pnpm test:vsix` | VSIX artifact inspection | No (requires built VSIX) |
| `pnpm test:watch` | Watch mode for unit tests | No |
| `pnpm test:coverage` | Unit tests with coverage | No |

## Directory Structure

```
tests/
├── python-integration/      # Tests requiring Python (excluded from test:unit)
│   ├── synthetic-fixtures.test.ts
│   └── performance.test.ts
├── fixtures/                # Test data and JSON fixtures
├── harness/                 # Test utilities and mocks
├── integration/             # TypeScript-only integration tests
├── modules/                 # Module-level tests
├── schema/                  # Schema validation tests
├── mocks/                   # Mock implementations
├── setup.ts                 # Jest global setup
└── *.test.ts               # Unit tests (no external dependencies)
```

## Python Dependencies

Tests in `python-integration/` require:

- **Python 3.11+**
- **pandas** and other dependencies via `pip install -e .[dev]` from repository root

These tests call `scripts/generate-synthetic-dataset.py` to generate test fixtures for performance and synthetic data validation.

## Running Tests Locally

### Quick feedback (no Python required)

```bash
cd extension
pnpm test          # Runs unit tests only
pnpm test:watch    # Watch mode
```

### Full test suite (Python required)

```bash
# From repository root
pip install -e .[dev]

cd extension
pnpm test:all      # Runs all tests including Python integration
```

### VSIX inspection tests

```bash
cd extension
pnpm run build
pnpm run stage:tasks
tfx extension create --manifest-globs vss-extension.json
VSIX_REQUIRED=true pnpm test:vsix
```

## CI Jobs

| Job | Python | Tests | Purpose |
|-----|--------|-------|---------|
| `extension-tests` | Yes | `test:ci` (all) | Full test coverage with JUnit output |
| `fresh-clone-verify` | No | `test:unit` | Verify fresh clone works without cache |
| `build-extension` | No | `test:vsix` | VSIX artifact inspection |

## Adding New Tests

- **Unit tests**: Add to `tests/` directory (will run with `pnpm test`)
- **Python integration tests**: Add to `tests/python-integration/` (will run with `pnpm test:all`)
- **VSIX tests**: Add to `tests/vsix-artifact-inspection.test.ts` (requires built VSIX)

## Test Configuration

- **Jest config**: `jest.config.ts`
- **TypeScript test config**: `tsconfig.test.json`
- **Global setup**: `tests/setup.ts`
- **JUnit output**: `test-results.xml` (for CI)
