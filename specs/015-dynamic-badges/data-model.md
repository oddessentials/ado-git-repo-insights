# Data Model: Badge Status JSON

**Feature**: 015-dynamic-badges
**Date**: 2026-01-29

## JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Badge Status",
  "description": "CI-generated badge data for Shields.io dynamic badges",
  "type": "object",
  "properties": {
    "python": {
      "type": "object",
      "properties": {
        "coverage": {
          "type": "number",
          "minimum": 0,
          "maximum": 100,
          "description": "Line coverage percentage (1 decimal)"
        },
        "tests": {
          "type": "object",
          "properties": {
            "passed": { "type": "integer", "minimum": 0 },
            "skipped": { "type": "integer", "minimum": 0 },
            "total": { "type": "integer", "minimum": 0 },
            "display": {
              "type": "string",
              "description": "Pre-formatted display string for badge"
            }
          },
          "required": ["passed", "skipped", "total", "display"]
        }
      },
      "required": ["coverage", "tests"]
    },
    "typescript": {
      "type": "object",
      "properties": {
        "coverage": {
          "type": "number",
          "minimum": 0,
          "maximum": 100,
          "description": "Line coverage percentage (1 decimal)"
        },
        "tests": {
          "type": "object",
          "properties": {
            "passed": { "type": "integer", "minimum": 0 },
            "skipped": { "type": "integer", "minimum": 0 },
            "total": { "type": "integer", "minimum": 0 },
            "display": {
              "type": "string",
              "description": "Pre-formatted display string for badge"
            }
          },
          "required": ["passed", "skipped", "total", "display"]
        }
      },
      "required": ["coverage", "tests"]
    }
  },
  "required": ["python", "typescript"],
  "additionalProperties": false
}
```

## Example Output

```json
{
  "python": {
    "coverage": 89.2,
    "tests": {
      "passed": 312,
      "skipped": 0,
      "total": 312,
      "display": "312 passed"
    }
  },
  "typescript": {
    "coverage": 74.5,
    "tests": {
      "passed": 637,
      "skipped": 5,
      "total": 642,
      "display": "637 passed, 5 skipped"
    }
  }
}
```

## Key Ordering

Keys MUST be output in alphabetical order for determinism:
1. `python` before `typescript`
2. `coverage` before `tests`
3. `display`, `passed`, `skipped`, `total` (alphabetical)

Enforced via `json.dumps(..., sort_keys=True)`.

## Field Derivations

| Field | Source | Calculation |
|-------|--------|-------------|
| `python.coverage` | `coverage.xml` | `line-rate * 100`, rounded to 1 decimal |
| `python.tests.passed` | `test-results.xml` | `tests - failures - errors - skipped` |
| `python.tests.skipped` | `test-results.xml` | `skipped` attribute |
| `python.tests.total` | `test-results.xml` | `tests` attribute |
| `python.tests.display` | Computed | `"{passed} passed"` or `"{passed} passed, {skipped} skipped"` |
| `typescript.coverage` | `extension/coverage/lcov.info` | `(LH / LF) * 100`, rounded to 1 decimal |
| `typescript.tests.*` | `extension/test-results.xml` | Same as Python |

## Validation Rules

1. **Coverage range**: 0.0 to 100.0 (fail if outside)
2. **Test counts**: Non-negative integers (fail if negative)
3. **Passed consistency**: `passed = total - skipped` (fail if mismatch after accounting for failures/errors)
4. **Display format**: Must match regex `^\d+ passed(, \d+ skipped)?$`
