# Data Model: Close Suppression Audit Blind Spot

## Entities

### SuppressionBaseline (v2)

The baseline schema is extended from v1 to v2 with scope policy metadata.

**Fields**:
- `version`: int — schema version (2)
- `generated_at`: string — ISO 8601 UTC timestamp
- `total`: int — total suppression count across all scopes
- `scope_policy`: dict[str, str] — per-scope enforcement policy (`"blocking"` | `"advisory"`)
- `by_scope`: dict[str, int] — suppression count per scope
- `by_type`: dict[str, int] — suppression count per type
- `by_file`: dict[str, int] — suppression count per file
- `by_rule`: dict[str, int] — suppression count per rule

**Validation rules**:
- All keys in `scope_policy` must match keys in `by_scope`
- `scope_policy` values must be `"blocking"` or `"advisory"` only
- v1 baselines are backward-compatible: treated as all-blocking when `scope_policy` is absent
- All other v1 validation rules still apply (totals match, keys sorted, forward slashes)

### Scope (expanded)

**Current scopes** (3):
| Scope Name | Directory | Pattern |
|------------|-----------|---------|
| python-backend | src/ | *.py |
| typescript-extension | extension/ui/ | *.ts |
| typescript-tests | extension/tests/ | *.ts |

**New scopes** (3):
| Scope Name | Directory | Pattern |
|------------|-----------|---------|
| python-scripts | scripts/ | *.py |
| python-tests | tests/ | *.py |
| python-ci-scripts | .github/scripts/ | *.py |

### RuleDisableAudit

Machine-readable artifact for each globally disabled lint rule.

**Fields**:
- `rule`: string — rule ID (e.g., "S603")
- `generated_at`: string — ISO 8601 UTC
- `total_call_sites`: int
- `call_sites`: list of CallSite objects

**CallSite fields**:
- `file`: string — forward-slash relative path
- `line`: int
- `code`: string — the source line
- `safety`: string — classification (`"safe-hardcoded"`, `"safe-literal-seed"`, `"unsafe"`)
- `reason`: string — justification for classification

### FileCoverageResult

Output of the file coverage check.

**Fields**:
- `total_files`: int
- `covered_files`: int
- `uncovered_files`: list[string] — paths not in any scope
- `overlapping_files`: list[string] — paths in multiple scopes (configuration error)

## State Transitions

### Two-Phase Gating

```
Phase 1 (deploy)                    Phase 2 (enforce)
┌─────────────────────┐            ┌─────────────────────┐
│ scope_policy:       │            │ scope_policy:       │
│   python-backend:   │            │   python-backend:   │
│     blocking        │  baseline  │     blocking        │
│   python-scripts:   │  update    │   python-scripts:   │
│     advisory    ────┼──────────>│     blocking        │
│   python-tests:     │            │   python-tests:     │
│     advisory    ────┼──────────>│     blocking        │
│   python-ci-scripts:│            │   python-ci-scripts:│
│     advisory    ────┼──────────>│     blocking        │
└─────────────────────┘            └─────────────────────┘
```

Transition trigger: verified census reaches 0 for all new scopes. Mechanism: `--update-baseline` + commit.
