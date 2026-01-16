# Test Fixtures

This directory contains test fixtures for ado-git-repo-insights.

## Golden Fixtures (DoD 1.3)

- `golden_db.sqlite` - Reference SQLite database with known data
- `expected_*.csv` - Expected CSV outputs for the golden database

## Sample Data

- `sample_pr_response.json` - Sample ADO API response for mocking
- `sample_config.yaml` - Sample configuration for testing

## Usage

```python
from pathlib import Path

FIXTURES_DIR = Path(__file__).parent
GOLDEN_DB = FIXTURES_DIR / "golden_db.sqlite"
```
