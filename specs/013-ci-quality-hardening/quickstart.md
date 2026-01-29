# Quickstart: CI Quality Gate Hardening

**Feature**: 013-ci-quality-hardening
**Date**: 2026-01-29

## Overview

This feature adds three quality gates:
1. **Mypy enforcement** - Python type checking in pre-push and CI
2. **Non-null assertion rule** - ESLint blocks `value!` patterns
3. **Suppression auditing** - CI tracks and gates suppression comment growth

## Local Development

### Prerequisites

Ensure you have:
- Python 3.10+ with mypy: `pip install mypy`
- Node.js 22+ with pnpm: `pnpm install` in `extension/`
- Husky hooks installed: run `pnpm install` at repo root

### Running Checks Locally

**Type checking**:
```bash
# Python (from repo root)
mypy src/

# TypeScript (from extension/)
cd extension && npx tsc --noEmit
```

**Suppression audit**:
```bash
# Count current suppressions
python scripts/audit-suppressions.py

# Compare to baseline
python scripts/audit-suppressions.py --diff
```

**Full pre-push check** (what CI runs):
```bash
.husky/pre-push
```

## Common Scenarios

### Scenario 1: Mypy Error on Push

**Symptom**: Pre-push fails with mypy error

```
[pre-push] Running mypy type check...
src/ado_git_repo_insights/api/client.py:42: error: Incompatible return type
[pre-push] ❌ Push blocked: mypy type check failed
[pre-push] Run 'mypy src/' to see full output
```

**Fix**: Correct the type error in the indicated file.

---

### Scenario 2: Non-Null Assertion Blocked

**Symptom**: ESLint fails with no-non-null-assertion error

```
extension/ui/feature.ts:15:20 error @typescript-eslint/no-non-null-assertion
  Forbidden non-null assertion
```

**Fix options**:
1. Add null check: `if (value) { use(value); }`
2. Use optional chaining: `value?.property`
3. If unavoidable, add justified suppression:
   ```typescript
   // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- REASON: SDK guarantees non-null after init
   const element = document.getElementById('app')!;
   ```

---

### Scenario 3: Suppression Count Increased

**Symptom**: CI fails with suppression audit error

```
❌ Suppression count increased: 34 → 36 (+2)
New suppressions require acknowledgment.
Add 'SUPPRESSION-INCREASE-APPROVED' to PR description to proceed.
```

**Fix options**:
1. **Remove the suppressions** - preferred if the underlying issue can be fixed
2. **Acknowledge the increase** - add `SUPPRESSION-INCREASE-APPROVED` to your PR description
3. **Update the baseline** - if suppressions are permanent:
   ```bash
   python scripts/audit-suppressions.py --update-baseline
   git add .suppression-baseline.json
   git commit -m "chore: update suppression baseline"
   ```

---

### Scenario 4: Missing Justification Tag

**Symptom**: CI warns about unjustified suppressions

```
⚠️ Suppression missing justification tag:
extension/ui/feature.ts:15: eslint-disable-next-line @typescript-eslint/no-explicit-any

Required format: -- REASON: <explanation> or -- SECURITY: <explanation>
```

**Fix**: Add justification to the suppression comment:
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- REASON: ADO SDK returns untyped JSON
```

---

### Scenario 5: Python Suppression Missing Justification

**Symptom**: Pre-commit fails with Python suppression format error

```
[FAIL] 1 suppressions missing justification tag:
  src/ado_git_repo_insights/utils/example.py:42: noqa

Required format: -- REASON: <explanation> or -- SECURITY: <explanation>
```

**Fix**: Add justification to the Python suppression:
```python
# Before (blocked):
import unused_module  # noqa: F401

# After (allowed):
import unused_module  # noqa: F401 -- REASON: imported for side effects
```

## CI Integration

### Workflow Jobs

| Job | Purpose | Blocks Merge |
|-----|---------|--------------|
| `mypy` | Python type checking | Yes |
| `suppression-audit` | Count + diff suppressions | Yes (if delta > 0 without approval) |

### Approval Markers

To acknowledge suppression increases:

**In PR description** (required):
```markdown
## Notes
Adding API client suppressions for untyped SDK responses.

SUPPRESSION-INCREASE-APPROVED
```

> **Note**: The marker MUST be in the PR body. Commit messages are not checked.
> Direct pushes to main with suppression increases will always fail (no override).

## Updating Baselines

### Suppression Baseline

When suppressions are legitimately added/removed:

```bash
# Generate new baseline
python scripts/audit-suppressions.py --update-baseline

# Commit the change
git add .suppression-baseline.json
git commit -m "chore: update suppression baseline

SUPPRESSION-INCREASE-APPROVED"
```

### Performance Baseline

If pre-push performance changes significantly:

```bash
cd extension
pnpm run perf:update-baseline
```
