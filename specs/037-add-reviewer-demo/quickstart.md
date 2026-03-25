# Quickstart: Reviewer Demo Coverage

**Branch**: `037-add-reviewer-demo`

## Setup

```bash
git checkout 037-add-reviewer-demo
pip install -e .[dev]
```

## Key Files to Edit

### Generator
- `scripts/generate-demo-data.py` — unique realistic synthetic names, reviewer breakdown guarantees, manifest fixture metadata

### Build and validation
- `scripts/build-demo-dataset.py` — reviewer capability evidence, blocking validation, deterministic publication scope

### Tests
- `tests/demo/test_demo_parity_pipeline.py` — reviewer fixture presence and canonical build assertions
- `tests/demo/test_regeneration.py` — deterministic regeneration scope
- `tests/demo/test_schema_guard.py` — manifest and schema expectations remain aligned
- `tests/unit/test_synthetic_dataset.py` — synthetic naming and reviewer coverage invariants

## Build & Test

```bash
# Canonical demo build without docs promotion
python scripts/build-demo-dataset.py --no-promote

# Demo parity and reviewer contract tests
pytest tests/demo/test_demo_parity_pipeline.py -v
pytest tests/demo/test_regeneration.py -v

# Synthetic dataset invariant tests
pytest tests/unit/test_synthetic_dataset.py -v

# Full canonical build and promotion
python scripts/build-demo-dataset.py
```

## Verification Checklist

1. Generated users remain at 200 and all display names are unique realistic names with no numeric suffixes.
2. Canonical rollups include reviewer breakdowns with at least five active reviewers.
3. At least one reviewer fixture spans multiple repositories.
4. Manifest metadata declares one constrained reviewer walkthrough and one deterministic disallowed reviewer-plus-team example.
5. Build validation fails with a clear reason if reviewer fixture metadata or reviewer breakdowns are removed.
6. Promotion to `docs/data` remains byte-identical to the canonical artifact output.
7. Known optional ML coverage and extension artifact parity concerns remain documented as out of scope unless they block reviewer demo coverage.

## Out of Scope

- Optional ML coverage gaps remain acceptable unless they block reviewer demo coverage.
- Skipped extension artifact parity checks remain acceptable unless they block reviewer demo coverage.
