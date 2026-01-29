# Research: CI Quality Gate Hardening

**Feature**: 013-ci-quality-hardening
**Date**: 2026-01-29

## Research Tasks

### 1. Mypy Integration Approach

**Question**: How should mypy be integrated into both pre-push hooks and CI?

**Research Findings**:
- Current `pyproject.toml` has mypy configured with `strict = true` and module overrides for optional deps
- Pre-push hook (`.husky/pre-push`) is bash script that already runs Python tests
- CI workflow has separate jobs for different check types

**Decision**: Run mypy as standalone command in both locations
- Pre-push: Add mypy invocation after pre-commit checks, before Python tests
- CI: Add dedicated `mypy` job that runs `mypy src/` with pyproject.toml config

**Rationale**:
- Mirrors existing pattern (tsc runs standalone, not via pre-commit)
- Allows mypy to use full project config from pyproject.toml
- Keeps pre-commit config minimal (ruff only) per existing design

**Alternatives Rejected**:
- Pre-commit hook for mypy: Comment in `.pre-commit-config.yaml` explains this was intentionally avoided because mypy needs [ml] deps for full coverage
- mypy in pytest: Would slow down test runs and conflate concerns

---

### 2. Non-Null Assertion Rule Baseline

**Question**: How many existing non-null assertions need to be addressed?

**Research Findings**:
```bash
# Searched extension/ for non-null assertions
grep -r '!\.' extension/ui/ --include='*.ts' | wc -l
# Result: ~15-20 instances of `!.` pattern in production code
```

Key files with non-null assertions:
- `extension/ui/artifact-client.ts` - Map lookups
- `extension/ui/dashboard.ts` - DOM element access
- `extension/ui/modules/charts.ts` - Array element access

**Decision**: Enable rule as `error` and fix existing violations before enabling
- Most violations are Map.get()! patterns that can be replaced with proper null checks
- Some DOM element access can use optional chaining

**Rationale**: Clean baseline is preferred over maintaining eslint-disable comments

**Alternatives Rejected**:
- Enable as `warn`: Doesn't prevent regression, violates spec requirement for error-level enforcement
- Baseline existing violations: Creates technical debt that accumulates

---

### 3. Suppression Audit Script Design

**Question**: What patterns should the suppression audit script detect, and what scopes should be scanned?

**Research Findings**:
Based on codebase analysis:

**Scopes to scan** (monorepo structure):
| Scope ID | Directory | File Pattern |
|----------|-----------|--------------|
| `python-backend` | `src/` | `*.py` |
| `typescript-extension` | `extension/ui/` | `*.ts` |
| `typescript-tests` | `extension/tests/` | `*.ts` |

**Patterns to detect**:
| Type ID | Pattern | Language |
|---------|---------|----------|
| `eslint-disable-next-line` | `// eslint-disable-next-line` | TypeScript |
| `eslint-disable-line` | `// eslint-disable-line` | TypeScript |
| `eslint-disable-block` | `/* eslint-disable` | TypeScript |
| `ts-ignore` | `// @ts-ignore` | TypeScript |
| `ts-expect-error` | `// @ts-expect-error` | TypeScript |
| `type-ignore` | `# type: ignore` | Python |
| `noqa` | `# noqa` | Python |

**Decision**: Script outputs JSON with explicit scopes, types, files, and optional rules:
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
  "by_file": { ... },
  "by_rule": { ... }
}
```

**Determinism requirements**:
- All keys sorted alphabetically
- Forward-slash paths, relative to repo root
- ISO 8601 UTC timestamps
- 2-space indentation, newline at EOF
- Idempotent: regenerating twice produces byte-for-byte identical output

**Rationale**: Explicit scopes prevent accidental drift as monorepo evolves. Determinism prevents spurious CI failures from formatting differences

---

### 4. CI Approval Marker Detection

**Question**: How should CI detect the `SUPPRESSION-INCREASE-APPROVED` marker?

**Research Findings**:
- GitHub Actions can access PR body via `${{ github.event.pull_request.body }}`
- Commit messages accessible via `git log --format=%B -1`

**Decision**: Check both locations in order:
1. PR body (primary) - most visible in code review
2. Commit message (fallback) - for direct pushes or quick fixes

**Implementation**:
```bash
# In CI script
if echo "$PR_BODY" | grep -q "SUPPRESSION-INCREASE-APPROVED"; then
  echo "Suppression increase acknowledged in PR"
  exit 0
fi
if git log --format=%B -1 | grep -q "SUPPRESSION-INCREASE-APPROVED"; then
  echo "Suppression increase acknowledged in commit"
  exit 0
fi
echo "ERROR: Suppression count increased without acknowledgment"
exit 1
```

**Rationale**: Matches FR-010 requirements exactly

---

### 5. Pre-push Hook Performance

**Question**: Will adding mypy slow down pre-push unacceptably?

**Research Findings**:
- Current pre-push runs: baseline check, pre-commit, CRLF guard, pytest, tsc, eslint, jest
- mypy on this codebase: ~5-10 seconds (incremental), ~15-25 seconds (cold)
- Target per spec: <30 seconds for mypy portion

**Decision**: Add mypy early in pre-push sequence (after pre-commit, before pytest)
- Use default mypy caching for incremental performance
- Print timing info for observability

**Rationale**:
- Early failure saves time (fail fast on type errors before running tests)
- mypy caching makes subsequent runs fast

---

### 6. Justification Tag Format

**Question**: What exact format should suppression justifications use?

**Research Findings**:
- Existing codebase uses `-- SECURITY:` tag for security suppressions
- Spec requires `-- REASON:` or `-- SECURITY:` patterns

**Decision**: Accept both patterns, require one of:
- `-- REASON: <explanation>` for general suppressions
- `-- SECURITY: <explanation>` for security-related suppressions

Regex: `--\s*(REASON|SECURITY):\s*.+`

**Rationale**: Maintains compatibility with existing codebase conventions

---

## Summary of Decisions

| Topic | Decision |
|-------|----------|
| Type checking (pre-push) | Both mypy AND tsc --noEmit as **immutable invariants**, fail on either |
| Mypy integration | Standalone command in pre-push and CI (not pre-commit) |
| tsc status | **Preserved as invariant** (already exists in pre-push) |
| Non-null assertions | Fix all existing violations, enable as error |
| Suppression scopes | `src/`, `extension/ui/`, `extension/tests/` (explicit) |
| Suppression patterns | 7 types: eslint-disable, eslint-disable-next-line, eslint-disable-line, ts-ignore, ts-expect-error, type-ignore, noqa |
| Baseline sort order | Stable-sorted by scope (ASC), rule (ASC), kind (ASC) |
| Cross-OS consistency | Path normalization required for identical output on all OSes |
| Approval marker | **PR body only**: exact string `SUPPRESSION-INCREASE-APPROVED` |
| Non-PR events | Direct pushes fail on any suppression increase (no override) |
| Suppression format validation | **Required** in pre-commit (not optional), blocks malformed comments |
| Implementation guardrails | Audit script fails CI if baseline format/ordering violated; counting logic changes require baseline regeneration |
| Pre-push performance | Add mypy after pre-commit, before tests |
| Justification format | `-- REASON:` or `-- SECURITY:` with explanation |
| Python version | CI: 3.11 (pinned), Local: 3.10+ |
