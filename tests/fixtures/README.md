# Test Fixtures

This directory contains test fixtures for ado-git-repo-insights.

## Directory Contents

| Path | Purpose |
|------|---------|
| `golden/` | Golden reference data for regression tests (e.g., `constant-series-forecast.json`) |
| `nested_artifacts/` | Fixtures simulating nested artifact layouts for staging normalization tests |
| `staged_artifacts/` | Fixtures simulating staged pipeline artifacts (manifest + aggregates) |

## Usage

```python
from pathlib import Path

FIXTURES_DIR = Path(__file__).parent
```

## Notes

Golden output tests (`tests/integration/test_golden_outputs.py`) use **dynamic fixtures** --
they create temporary SQLite databases and generate CSVs at test time rather than
comparing against pre-baked files on disk.
