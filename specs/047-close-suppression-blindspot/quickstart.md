# Quickstart: Close Suppression Audit Blind Spot

## Prerequisites
- Python 3.10+ with project installed: `pip install -e .[dev]`
- All existing gates passing: `python scripts/run_pr_preflight.py`

## Development Workflow

### Phase 1: Scanner Hardening
```bash
# Run current audit to see preliminary count (untrusted)
python scripts/audit-suppressions.py

# After tokenize-based scanner is implemented, run verified census
python scripts/audit-suppressions.py --check-coverage
python scripts/audit-suppressions.py
```

### Phase 2: Suppression Cleanup
```bash
# Remove noqa comments in batches, verify each passes
ruff check src/ scripts/ tests/ .github/scripts/
mypy src/ --strict

# After each batch, verify audit count drops
python scripts/audit-suppressions.py
```

### Phase 3: Gate Activation
```bash
# Update baseline to include new scopes (Phase 2 enforcement)
python scripts/audit-suppressions.py --update-baseline

# Verify all gates pass
python scripts/run_pr_preflight.py
```

## Key Files
| File | Purpose |
|------|---------|
| `scripts/audit-suppressions.py` | Suppression audit tool (modified) |
| `.suppression-baseline.json` | Baseline (extended to v2) |
| `scripts/check_rule_disable_invariants.py` | Compensating guardrails (new) |
| `.rule-disable-audit-S603.json` | S603 full-tree audit artifact (new) |
| `.rule-disable-audit-S311.json` | S311 full-tree audit artifact (new) |
| `tests/conftest.py` | Typed test doubles (modified) |
| `LOCAL_CI_PARITY_INVARIANTS.md` | Parity documentation (updated) |

## Verification
```bash
# Full preflight (runs all gates including new ones)
python scripts/run_pr_preflight.py

# Specific checks
python scripts/audit-suppressions.py --diff          # Suppression gate
python scripts/audit-suppressions.py --check-coverage # File coverage
python scripts/check_rule_disable_invariants.py --diff # Rule guardrails
```
