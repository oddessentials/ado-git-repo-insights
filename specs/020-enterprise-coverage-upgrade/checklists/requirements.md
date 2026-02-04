# Requirements Checklist: Enterprise Coverage Upgrade

**Feature Branch**: `009-enterprise-coverage-upgrade`
**Generated**: 2026-01-28

## Pre-Implementation Checklist

- [ ] Audit current Python coverage percentage
- [ ] Audit current TypeScript coverage percentage
- [ ] Review existing badge setup in README.md
- [ ] Verify mypy strict mode is active in pyproject.toml
- [ ] Verify TypeScript strict flags in tsconfig.json
- [ ] Identify free badge solutions for TypeScript coverage
- [ ] Document any intentionally skipped tests

## Functional Requirements

### FR-001: Python Coverage >= 80%
- [ ] Identify low-coverage Python modules
- [ ] Write tests for uncovered happy paths
- [ ] Write tests for uncovered edge cases
- [ ] Verify coverage reaches 80%+

### FR-002: TypeScript Coverage >= 80%
- [ ] Identify low-coverage TypeScript modules
- [ ] Write tests for uncovered happy paths
- [ ] Write tests for uncovered edge cases
- [ ] Verify coverage reaches 80%+

### FR-003: TypeScript noImplicitAny Enforcement
- [ ] Verify noImplicitAny: true in tsconfig.json
- [ ] Add eslint rule for explicit any if needed
- [ ] Fix any existing any types in codebase

### FR-004: Python mypy Strict Mode
- [ ] Verify strict = true in pyproject.toml [tool.mypy]
- [ ] Run mypy and fix any violations
- [ ] Verify CI runs mypy check

### FR-005: Separate Coverage Badges
- [ ] Add TypeScript coverage badge to README.md
- [ ] Ensure visual distinction from Python badge
- [ ] Label badges clearly (Python Coverage, TypeScript Coverage)

### FR-006: Automatic Badge Updates
- [ ] Configure CI to generate coverage report in parseable format
- [ ] Configure badge service to read coverage report
- [ ] Verify badge updates after successful CI run

### FR-007: Cost-Free Badge Solution
- [ ] Research free options (shields.io + coverage file, codecov free, gist-based)
- [ ] Select solution that meets automatic update requirement
- [ ] Document solution for future maintainers

### FR-008: Local/CI Threshold Parity
- [ ] Ensure jest.config.ts threshold matches CI expectation
- [ ] Ensure pyproject.toml fail_under matches CI expectation
- [ ] Verify pre-push hook runs tests with coverage threshold

### FR-009: Single Source of Truth for Thresholds
- [ ] Python: thresholds in pyproject.toml only
- [ ] TypeScript: thresholds in jest.config.ts only
- [ ] CI workflows read from these files (no duplicate threshold values)

### FR-010: Happy Path and Edge Case Coverage
- [ ] Document test coverage strategy
- [ ] Each new test file covers positive scenarios
- [ ] Each new test file covers negative/error scenarios

### FR-011: Skipped Tests Documentation
- [ ] Audit any skipped tests (.skip, pytest.mark.skip)
- [ ] Document reason for each skip
- [ ] Adjust thresholds if skips cause local/CI divergence

### FR-012: Passing Checks
- [ ] All pre-commit checks pass
- [ ] All pre-push checks pass
- [ ] All CI checks pass

## Success Criteria Verification

- [ ] SC-001: `pytest --cov` shows >= 80%
- [ ] SC-002: `npm run test:coverage` shows >= 80% all metrics
- [ ] SC-003: grep `fail_under = 80` in pyproject.toml
- [ ] SC-004: jest.config.ts has coverageThreshold at 80%
- [ ] SC-005: README has TypeScript coverage badge visually distinct
- [ ] SC-006: Badge reflects latest coverage after CI run
- [ ] SC-007: Pre-push runs coverage threshold check
- [ ] SC-008: `grep -r "any" extension/ui` returns 0 explicit any types
- [ ] SC-009: CI workflow passes
- [ ] SC-010: No paid service subscriptions required

## Post-Implementation Verification

- [ ] Push code change that reduces coverage
- [ ] Verify local pre-push blocks the push
- [ ] Verify CI would also fail (if push were forced)
- [ ] Make small change and merge to main
- [ ] Verify TypeScript badge updates automatically
- [ ] Verify Python badge still works independently
