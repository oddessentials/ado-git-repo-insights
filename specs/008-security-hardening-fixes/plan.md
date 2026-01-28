# Implementation Plan: Security Hardening Fixes

**Branch**: `008-security-hardening-fixes` | **Date**: 2026-01-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/008-security-hardening-fixes/spec.md`

## Summary

Harden the pre-push hook against shell injection vulnerabilities (option injection, word splitting, newline attacks) by using NUL-delimited filename handling and bash-specific error handling. Additionally, create env_guard.py with fail-closed semantics and re-enable the ESLint detect-object-injection rule with mandatory justification tags for suppressions.

## Technical Context

**Language/Version**: Bash (for pre-push hook), Python 3.10+ (for env_guard.py), TypeScript/JavaScript (for ESLint config)
**Primary Dependencies**: GNU coreutils (find, xargs), Git, ESLint with eslint-plugin-security
**Storage**: N/A (configuration files only)
**Testing**: Manual verification of hook behavior, ESLint rule testing
**Target Platform**: Windows (Git Bash), macOS, Linux - all developer environments
**Project Type**: Single project - configuration and script hardening
**Performance Goals**: N/A (hooks should complete in <30s)
**Constraints**: Must work in Git Bash on Windows; bash shebang required for pipefail
**Scale/Scope**: 4 files modified, 1 file created

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| XVIII. Actionable Failure Logs | PASS | env_guard.py fail-closed with clear error messages |
| XIX. PAT Secrecy | PASS | env_guard.py protects secrets; no PAT logging |
| QG-17. Lint + format checks | PASS | ESLint rule re-enablement strengthens linting |
| VR-02. Lint/format | PASS | Changes improve lint strictness |

**No constitution violations detected.** All changes strengthen existing compliance.

## Project Structure

### Documentation (this feature)

```text
specs/008-security-hardening-fixes/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
.husky/
└── pre-push             # MODIFY: bash shebang, pipefail, NUL-delimited file handling

scripts/
└── env_guard.py         # CREATE: secret detection with fail-closed semantics

extension/
└── eslint.config.mjs    # MODIFY: re-enable detect-object-injection as error

.ai-review.yml           # VERIFY: trusted_only already set, add documentation comment
```

**Structure Decision**: Single project - modifying existing configuration files and creating one new Python script.

## Complexity Tracking

No complexity violations. All changes are straightforward hardening of existing patterns.
