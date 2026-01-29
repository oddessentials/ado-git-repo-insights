# Data Model: CI Quality Gate Hardening

**Feature**: 013-ci-quality-hardening
**Date**: 2026-01-29

## Entities

This feature introduces one data entity: the **Suppression Baseline**.

### Suppression Baseline

Tracks the count and location of suppression comments in the codebase. Stored as JSON at repository root.

**File**: `.suppression-baseline.json`

## Scan Scope

The audit script scans these directories explicitly:

| Scope | Directory | Tool | File Pattern |
|-------|-----------|------|--------------|
| Python backend | `src/` | mypy, ruff | `*.py` |
| TypeScript extension | `extension/ui/` | eslint, tsc | `*.ts` |
| TypeScript tests | `extension/tests/` | eslint, tsc | `*.ts` |

**Excluded directories** (never scanned):
- `node_modules/`
- `dist/`
- `.venv/`
- `build/`
- `coverage/`
- Third-party vendored files (e.g., `VSS.SDK.min.js`)

## Suppression Types Detected

| Type ID | Pattern | Tool | Language |
|---------|---------|------|----------|
| `eslint-disable-next-line` | `// eslint-disable-next-line` | ESLint | TypeScript |
| `eslint-disable-line` | `// eslint-disable-line` | ESLint | TypeScript |
| `eslint-disable-block` | `/* eslint-disable` ... `*/` | ESLint | TypeScript |
| `ts-ignore` | `// @ts-ignore` | TypeScript | TypeScript |
| `ts-expect-error` | `// @ts-expect-error` | TypeScript | TypeScript |
| `type-ignore` | `# type: ignore` | mypy | Python |
| `noqa` | `# noqa` | ruff/flake8 | Python |

## Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["version", "generated_at", "total", "by_scope", "by_type", "by_file"],
  "properties": {
    "version": {
      "type": "integer",
      "description": "Schema version for future migrations",
      "const": 1
    },
    "generated_at": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 timestamp when baseline was generated"
    },
    "total": {
      "type": "integer",
      "minimum": 0,
      "description": "Total count of all suppression comments"
    },
    "by_scope": {
      "type": "object",
      "description": "Counts grouped by monorepo scope",
      "properties": {
        "python-backend": { "type": "integer", "minimum": 0 },
        "typescript-extension": { "type": "integer", "minimum": 0 },
        "typescript-tests": { "type": "integer", "minimum": 0 }
      },
      "additionalProperties": false
    },
    "by_type": {
      "type": "object",
      "description": "Counts grouped by suppression type (sorted alphabetically)",
      "properties": {
        "eslint-disable-block": { "type": "integer", "minimum": 0 },
        "eslint-disable-line": { "type": "integer", "minimum": 0 },
        "eslint-disable-next-line": { "type": "integer", "minimum": 0 },
        "noqa": { "type": "integer", "minimum": 0 },
        "ts-expect-error": { "type": "integer", "minimum": 0 },
        "ts-ignore": { "type": "integer", "minimum": 0 },
        "type-ignore": { "type": "integer", "minimum": 0 }
      },
      "additionalProperties": false
    },
    "by_file": {
      "type": "object",
      "description": "Counts grouped by file path (relative, forward-slash, sorted alphabetically)",
      "additionalProperties": {
        "type": "integer",
        "minimum": 0
      }
    },
    "by_rule": {
      "type": "object",
      "description": "Optional: counts grouped by specific rule being suppressed",
      "additionalProperties": {
        "type": "integer",
        "minimum": 0
      }
    }
  }
}
```

## Determinism Requirements

The baseline MUST be deterministic to prevent spurious diffs:

1. **Primary sort order**: Baseline JSON MUST be stable-sorted by:
   - `scope` (ASC) — e.g., `python-backend` < `typescript-extension` < `typescript-tests`
   - `rule` (ASC) — e.g., `@typescript-eslint/no-explicit-any` < `security/detect-object-injection`
   - `kind` (ASC) — e.g., `eslint-disable-line` < `eslint-disable-next-line`
2. **Key ordering**: Within each object, keys MUST be sorted alphabetically
3. **File paths**: MUST use forward slashes (`/`), relative to repo root
4. **Cross-OS consistency**: Suppression counting output MUST be identical across Windows/Linux/macOS (path normalization required)
5. **Timestamp**: `generated_at` MUST be ISO 8601 UTC (e.g., `2026-01-29T10:30:00Z`)
6. **JSON formatting**: 2-space indentation, no trailing whitespace, newline at EOF
7. **Regeneration**: Running `python scripts/audit-suppressions.py --update-baseline` twice in succession MUST produce identical output (byte-for-byte)

## Example

```json
{
  "version": 1,
  "generated_at": "2026-01-29T10:30:00Z",
  "total": 36,
  "by_scope": {
    "python-backend": 2,
    "typescript-extension": 32,
    "typescript-tests": 2
  },
  "by_type": {
    "eslint-disable-block": 0,
    "eslint-disable-line": 4,
    "eslint-disable-next-line": 30,
    "noqa": 2,
    "ts-expect-error": 0,
    "ts-ignore": 0,
    "type-ignore": 0
  },
  "by_file": {
    "extension/tests/modules/comparison.test.ts": 1,
    "extension/tests/modules/errors.test.ts": 1,
    "extension/ui/artifact-client.ts": 3,
    "extension/ui/dashboard.ts": 2,
    "extension/ui/dataset-loader.ts": 2,
    "extension/ui/error-codes.ts": 1,
    "extension/ui/html-helpers.ts": 2,
    "extension/ui/modules/charts.ts": 5,
    "extension/ui/modules/comparison.ts": 2,
    "extension/ui/modules/formatting.ts": 2,
    "extension/ui/modules/legend-item.ts": 2,
    "extension/ui/modules/modal.ts": 2,
    "extension/ui/modules/tabs.ts": 3,
    "extension/ui/types.ts": 8,
    "src/ado_git_repo_insights/persistence/database.py": 2
  },
  "by_rule": {
    "@typescript-eslint/no-explicit-any": 8,
    "security/detect-object-injection": 26,
    "UP006": 2
  }
}
```

## Validation Rules

1. **Version immutability**: Schema version must be 1 for this implementation
2. **Total consistency**: `total` must equal sum of all values in `by_scope`
3. **Scope consistency**: Sum of all values in `by_scope` must equal sum of `by_type`
4. **File consistency**: Sum of all values in `by_file` must equal `total`
5. **Path format**: File paths in `by_file` must be forward-slash separated, relative to repo root
6. **Timestamp validity**: `generated_at` must be valid ISO 8601 UTC format
7. **Alphabetical ordering**: All object keys must be sorted alphabetically

## State Transitions

The baseline is **immutable per commit**. It only changes via explicit regeneration:

```
[No baseline] --generate--> [Baseline v1]
[Baseline v1] --regenerate--> [Baseline v1 (updated counts)]
```

**Regeneration triggers**:
1. Manual: `python scripts/audit-suppressions.py --update-baseline`
2. CI comparison: CI generates current counts in memory, compares to committed baseline

## CI Diff Computation

The audit script computes diffs by comparing:
- **Baseline**: Committed `.suppression-baseline.json` on main branch
- **Current**: Live scan of PR branch

**Diff output** (not persisted, shown in CI logs):
```json
{
  "baseline_total": 34,
  "current_total": 36,
  "delta": 2,
  "new_files": ["extension/ui/new-feature.ts"],
  "increased_files": {
    "extension/ui/types.ts": { "was": 8, "now": 9, "delta": 1 }
  },
  "decreased_files": {},
  "approved": false
}
```

## CI Failure Message Format

When delta > 0 and no approval marker present:

```
❌ Suppression count increased: 34 → 36 (+2)

Changed files:
  extension/ui/types.ts: 8 → 9 (+1)
  extension/ui/new-feature.ts: 0 → 1 (+1)

New suppressions require acknowledgment.
Add 'SUPPRESSION-INCREASE-APPROVED' to PR description to proceed.
```
