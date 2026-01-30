# Plan: Coverage Threshold Ratchet System (Enterprise-Grade)

## Goal

Establish a rigorous, deterministic coverage threshold ratcheting system with:

- Explicit math rules (no ambiguity)
- Single source of truth for "actual" coverage
- Canonical CI environment designation
- Guard against accidental threshold changes

---

## Problem Statement

Current state:

- **TypeScript**: 61% actual, 48% threshold = **13% drift** (should be 2%)
- **Python**: 76% actual, 70% threshold = **6% drift** (should be 2%)
- Documentation says "2% buffer" but thresholds haven't been ratcheted
- No automation or guards prevent drift

---

## Changes

### 1. Define Ratchet Math Rule

**Rule**: `threshold = floor(actual - 2.0)` where actual is line coverage percentage

**Rationale**:

- Jest thresholds are integers, floor provides safety margin
- 2% buffer absorbs minor refactoring fluctuations
- floor() ensures we never set threshold higher than intended

**Document in**: `extension/COVERAGE_RATCHET.md`

```markdown
## Ratchet Formula

threshold = floor(actual_coverage - 2.0)

Example: If actual is 75.65%, threshold = floor(73.65) = 73%

Rules:

- Always use floor() rounding (never ceil/round)
- Both Python and TypeScript use same formula
- Thresholds are always integers
```

---

### 2. Establish Source-of-Truth for Actual Coverage

**Python**: Parse `coverage.xml` line-rate attribute (same file used by `fail_under`)
**TypeScript**: Parse Jest's coverage summary output (same enforcement point)

**Create script**: `.github/scripts/get-coverage-actuals.py`

```python
#!/usr/bin/env python3
"""Print actual coverage values from CI artifacts (same source as enforcement)."""

# Python: parse coverage.xml line-rate
# TypeScript: parse lcov.info LF:/LH: totals
# Output: JSON with actual values and computed thresholds
```

**Output format**:

```json
{
    "python": {
        "actual": 75.65,
        "threshold_current": 70,
        "threshold_recommended": 73
    },
    "typescript": {
        "actual": 62.95,
        "threshold_current": 49,
        "threshold_recommended": 60
    }
}
```

---

### 3. Lock Canonical Environment

**Designate in CI comments and docs**:

- Python: `ubuntu-latest` + Python `3.11` (already the badge artifact source)
- TypeScript: `ubuntu-latest` + Node `22` (extension-tests job)

**Update**: `.github/workflows/ci.yml` with explicit comment:

```yaml
# CANONICAL LEG: Coverage thresholds are based on this environment
# Python: ubuntu-latest + 3.11 | TypeScript: ubuntu-latest + Node 22
# Do NOT change matrix without updating threshold baseline
```

**Update**: `extension/COVERAGE_RATCHET.md`:

```markdown
## Canonical Environment

Coverage numbers MUST come from CI's canonical leg:

- Python: ubuntu-latest, Python 3.11
- TypeScript: ubuntu-latest, Node 22

Local coverage may vary slightly due to platform differences.
Always use CI values when computing new thresholds.
```

---

### 4. Add Threshold Change Guard

**New CI job**: `threshold-change-guard` in `.github/workflows/ci.yml`

```yaml
threshold-change-guard:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
        - uses: actions/checkout@v4
          with:
              fetch-depth: 0

        - name: Check for threshold changes
          run: |
              # Detect changes to threshold files
              CHANGED=$(git diff origin/${{ github.base_ref }}...HEAD --name-only | \
                grep -E "(jest.config.ts|pyproject.toml)" || true)

              if [ -n "$CHANGED" ]; then
                # Check for threshold-specific changes
                JEST_THRESHOLD=$(git diff origin/${{ github.base_ref }}...HEAD -- extension/jest.config.ts | \
                  grep -E "^\+.*statements:|^\+.*branches:|^\+.*functions:|^\+.*lines:" || true)
                PY_THRESHOLD=$(git diff origin/${{ github.base_ref }}...HEAD -- pyproject.toml | \
                  grep -E "^\+.*fail_under" || true)

                if [ -n "$JEST_THRESHOLD" ] || [ -n "$PY_THRESHOLD" ]; then
                  # Require explicit marker
                  if ! git log --oneline origin/${{ github.base_ref }}...HEAD | grep -q "\[threshold-update\]"; then
                    echo "::error::Coverage threshold changed without [threshold-update] marker"
                    echo "::error::Add [threshold-update] to commit message if intentional"
                    exit 1
                  fi
                  echo "[OK] Threshold change approved via [threshold-update] marker"
                fi
              fi
              echo "[OK] No threshold changes detected"
```

---

### 5. Update Thresholds to Match Policy

After guards are in place, update thresholds using the formula:

**Python** (`pyproject.toml`):

```toml
fail_under = 73  # floor(75.65 - 2.0) = floor(73.65) = 73
```

**TypeScript** (`extension/jest.config.ts`):

```typescript
global: {
  statements: 59,  // floor(61.25 - 2.0) = floor(59.25) = 59
  branches: 53,    // floor(55.88 - 2.0) = floor(53.88) = 53
  functions: 55,   // floor(57.37 - 2.0) = floor(55.37) = 55
  lines: 60,       // floor(62.95 - 2.0) = floor(60.95) = 60
}
```

---

## Files to Modify

| File                                      | Change                                                  |
| ----------------------------------------- | ------------------------------------------------------- |
| `extension/COVERAGE_RATCHET.md`           | Add ratchet formula, canonical env                      |
| `.github/workflows/ci.yml`                | Add `threshold-change-guard` job, canonical leg comment |
| `.github/scripts/get-coverage-actuals.py` | NEW: Script to compute recommended thresholds           |
| `pyproject.toml`                          | Update `fail_under` (after guards in place)             |
| `extension/jest.config.ts`                | Update `coverageThreshold` (after guards in place)      |

---

## Implementation Order

1. **Phase 1: Documentation** - Update COVERAGE_RATCHET.md with rules
2. **Phase 2: Tooling** - Add `get-coverage-actuals.py` script
3. **Phase 3: Guards** - Add `threshold-change-guard` CI job
4. **Phase 4: Threshold Update** - Apply new thresholds with `[threshold-update]` marker

---

## Verification Checklist

- [ ] `COVERAGE_RATCHET.md` defines `floor(actual - 2.0)` formula
- [ ] `COVERAGE_RATCHET.md` specifies canonical CI leg
- [ ] `get-coverage-actuals.py` outputs JSON with actual + recommended thresholds
- [ ] CI job `threshold-change-guard` exists and requires `[threshold-update]` marker
- [ ] Threshold update PR includes `[threshold-update]` in commit message
- [ ] CI passes after threshold update

---

## Test Plan

1. **Guard verification**: Create test PR changing `fail_under` without marker → should fail
2. **Guard verification**: Create test PR changing `fail_under` with `[threshold-update]` → should pass
3. **Script verification**: Run `get-coverage-actuals.py` → outputs correct JSON
4. **Threshold verification**: After update, `pytest --cov` and `jest --coverage` both pass
5. **Pre-push verification**: Local `git push` enforces new thresholds
