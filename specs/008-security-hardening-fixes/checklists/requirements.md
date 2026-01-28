# Requirements Checklist: Security Hardening Fixes

**Feature Branch**: `008-security-hardening-fixes`
**Generated**: 2026-01-28

## Pre-Implementation Checklist

- [ ] Review current `.husky/pre-push` for all grep/find usage patterns
- [ ] Identify all locations using `find | xargs grep` pattern
- [ ] Review `scripts/env_guard.py` for error handling gaps
- [ ] Audit `.ai-review.yml` current settings
- [ ] Identify all detect-object-injection false positive locations in codebase
- [ ] Verify CI workflows have --max-warnings=0

## Functional Requirements

### FR-001: NUL-delimited File Iteration
- [ ] Replace `find ... | xargs grep` with `find ... -print0 | xargs -0 grep`
- [ ] Replace `grep -rlI` with NUL-safe alternative
- [ ] Test with filenames containing special characters

### FR-002: Pipeline Failure Detection
- [ ] Add `set -o pipefail` after `set -e`
- [ ] Verify pipefail is POSIX-compatible with target shells
- [ ] Test pipeline failure detection

### FR-003: ERR Trap or Explicit Checks
- [ ] Evaluate ERR trap vs explicit `|| exit 1` pattern
- [ ] Implement chosen error handling pattern
- [ ] Test error propagation

### FR-004: Git Path Validation
- [ ] Add `if git_path is None` check after `shutil.which("git")`
- [ ] Provide clear error message for missing git
- [ ] Test with git not in PATH (if possible)

### FR-005: Explicit Try/Except for File Operations
- [ ] Wrap file open() calls in try/except
- [ ] Handle FileNotFoundError specifically
- [ ] Handle PermissionError specifically
- [ ] Handle UnicodeDecodeError specifically

### FR-006: Graceful Error Handling
- [ ] Log warnings for unreadable files
- [ ] Continue processing other files on individual errors
- [ ] Return appropriate exit code based on overall result

### FR-007: AI Review Configuration
- [ ] Verify trusted_only setting exists
- [ ] Add documentation comment if missing
- [ ] Confirm setting aligns with security requirements

### FR-008: Re-enable detect-object-injection
- [ ] Change rule from 'off' to 'error' in eslint.config.mjs
- [ ] Run ESLint to identify all violations
- [ ] Document each violation for triage

### FR-009: Inline Suppressions
- [ ] Add `// eslint-disable-next-line security/detect-object-injection` where needed
- [ ] Include justification comment for each suppression
- [ ] Verify no true positives are suppressed

### FR-010: CI Lint Strictness
- [ ] Verify --max-warnings=0 in all CI lint commands
- [ ] Verify pre-push hook matches CI strictness
- [ ] Document lint strictness policy

### FR-011: Passing Checks
- [ ] All pre-commit checks pass
- [ ] All pre-push checks pass
- [ ] All CI checks pass

## Success Criteria Verification

- [ ] SC-001: Grep `find.*-print0.*xargs.*-0` pattern present
- [ ] SC-002: Grep `set -o pipefail` present in pre-push
- [ ] SC-003: `git_path is None` check present in env_guard.py
- [ ] SC-004: `try:` blocks around file operations in env_guard.py
- [ ] SC-005: `detect-object-injection.*error` in eslint.config.mjs
- [ ] SC-006: All suppressions have adjacent comments
- [ ] SC-007: `npm run lint` exits 0
- [ ] SC-008: CI workflow passes
- [ ] SC-009: .ai-review.yml has documentation

## Post-Implementation Verification

- [ ] Create test file with special characters in name
- [ ] Verify CRLF guard handles it safely
- [ ] Simulate file permission error for env_guard
- [ ] Verify graceful handling
- [ ] Introduce true object injection vulnerability
- [ ] Verify ESLint catches it
- [ ] Remove vulnerability
- [ ] Final `git push` succeeds with all hooks passing
