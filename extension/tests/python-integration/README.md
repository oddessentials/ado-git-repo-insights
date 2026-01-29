# Python Integration Tests

Tests in this directory require Python 3.11+ with specific dependencies.

## Why Separate?

These tests call `scripts/generate-synthetic-dataset.py` to generate test fixtures dynamically. This creates a cross-language dependency that would break builds for developers who only have Node.js installed.

By separating them:

1. **Developers** can run `pnpm test` without Python
2. **CI** can run `pnpm test:all` with Python installed
3. **Test isolation** prevents accidental Python dependencies in unit tests

## Requirements

- Python 3.11+
- pandas and other dependencies: `pip install -e .[dev]` from repository root

## Running These Tests

These tests are **not** included in the default `pnpm test` command.

```bash
# Install Python dependencies first (from repo root)
pip install -e .[dev]

# Run all tests including these
cd extension
pnpm test:all
```

## CI Job

The `extension-tests` CI job installs Python automatically and runs `pnpm test:ci`, which includes these tests.

## Tests in This Directory

| Test | Purpose |
|------|---------|
| `synthetic-fixtures.test.ts` | Validates DatasetLoader can parse generated fixtures |
| `performance.test.ts` | Performance baseline tests with generated datasets |

## Adding New Python-Dependent Tests

If your test needs to spawn Python processes:

1. Add it to this directory (`tests/python-integration/`)
2. It will automatically be excluded from `pnpm test` and `pnpm test:unit`
3. It will run with `pnpm test:all` and `pnpm test:ci`
