# Feature Specification: Coverage Threshold Ratchet System

**Feature Branch**: `016-coverage-ratchet`
**Created**: 2026-01-30
**Status**: Implemented
**Input**: User description: "Establish a rigorous, deterministic coverage threshold ratcheting system with explicit math rules, single source of truth for actual coverage, canonical CI environment designation, and guards against accidental threshold changes."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Developer Computes Recommended Thresholds (Priority: P1)

A developer wants to know what the coverage thresholds should be set to based on current actual coverage, so they can propose appropriate threshold updates during code reviews.

**Why this priority**: This is the foundation of the ratchet system. Without a way to compute recommended thresholds from actual coverage, no other functionality can operate correctly.

**Independent Test**: Can be fully tested by running a script that outputs JSON with actual coverage and recommended thresholds. Delivers value by eliminating manual calculation errors and providing a single source of truth.

**Acceptance Scenarios**:

1. **Given** coverage artifacts exist (coverage.xml for Python, lcov.info for TypeScript), **When** the developer runs the coverage actuals script, **Then** the system outputs JSON containing actual coverage percentages and recommended thresholds computed using the formula `floor(actual - 2.0)`.

2. **Given** the developer runs the script without coverage artifacts present, **When** the script executes, **Then** the system displays a clear error message indicating which artifacts are missing and how to generate them.

3. **Given** actual coverage is 75.65% for Python, **When** the script computes the recommended threshold, **Then** the output shows `threshold_recommended: 73` (floor(75.65 - 2.0) = floor(73.65) = 73).

---

### User Story 2 - CI Blocks Unauthorized Threshold Changes (Priority: P2)

A team lead wants the CI system to prevent accidental threshold changes, so that coverage standards are not lowered without explicit approval and documentation.

**Why this priority**: Guards prevent drift and enforce the policy. Without guards, thresholds can be silently lowered, defeating the purpose of the ratchet system.

**Independent Test**: Can be fully tested by creating a PR that modifies threshold values without the required marker, verifying CI fails, then adding the marker and verifying CI passes.

**Acceptance Scenarios**:

1. **Given** a pull request modifies `fail_under` in pyproject.toml without `[threshold-update]` in any commit message, **When** CI runs the threshold guard check, **Then** CI fails with an error message instructing the developer to add `[threshold-update]` to the commit message if the change is intentional.

2. **Given** a pull request modifies coverage thresholds in jest.config.ts without `[threshold-update]` marker, **When** CI runs, **Then** CI fails with the same instructional error message.

3. **Given** a pull request modifies thresholds AND includes `[threshold-update]` in a commit message, **When** CI runs, **Then** CI passes with a confirmation message that the threshold change was approved via marker.

4. **Given** a pull request modifies jest.config.ts but only changes non-threshold settings (e.g., testMatch), **When** CI runs, **Then** CI passes without requiring any marker.

---

### User Story 3 - Developer References Documented Policy (Priority: P3)

A developer wants to understand the coverage ratchet policy, including the formula, canonical environment, and update process, so they can follow proper procedures when updating thresholds.

**Why this priority**: Documentation ensures consistency and enables self-service. Developers can follow the policy without requiring synchronous communication with team leads.

**Independent Test**: Can be fully tested by reviewing documentation and verifying it contains all required sections: formula definition, canonical environment specification, and update procedures.

**Acceptance Scenarios**:

1. **Given** a developer opens the coverage ratchet documentation, **When** they look for the threshold formula, **Then** they find `threshold = floor(actual_coverage - 2.0)` with examples and clear rules.

2. **Given** a developer needs to know which CI environment produces authoritative coverage numbers, **When** they consult the documentation, **Then** they find the canonical environment explicitly specified (Python: ubuntu-latest + Python 3.11, TypeScript: ubuntu-latest + Node 22).

3. **Given** a developer wants to update thresholds, **When** they follow the documented process, **Then** they can successfully complete the update using the `[threshold-update]` marker convention.

---

### User Story 4 - Maintainer Updates Thresholds After Coverage Improvement (Priority: P4)

A maintainer has improved test coverage and wants to ratchet up the thresholds to prevent regression, following the documented policy and using the provided tooling.

**Why this priority**: This is the operational use case that ties everything together. It depends on all previous stories being complete.

**Independent Test**: Can be fully tested by running the coverage script, updating thresholds to match recommendations, committing with the `[threshold-update]` marker, and verifying CI passes.

**Acceptance Scenarios**:

1. **Given** the maintainer has run tests and generated fresh coverage artifacts, **When** they run the coverage actuals script, **Then** they receive current actual coverage and recommended thresholds for both Python and TypeScript.

2. **Given** the maintainer updates thresholds to match recommendations and commits with `[threshold-update]` marker, **When** CI runs, **Then** all tests pass and the threshold guard approves the change.

3. **Given** the maintainer attempts to set thresholds higher than recommended (violating the 2% buffer), **When** tests run, **Then** tests fail due to actual coverage being below the new threshold, preventing over-aggressive ratcheting.

---

### Edge Cases

- What happens when coverage.xml or lcov.info is corrupted or has invalid format?
  - System displays a clear parsing error with the specific file and line causing the issue.

- What happens when a developer commits threshold changes across multiple commits, only one having the marker?
  - System accepts this, as the marker indicates intentionality anywhere in the PR's commit history.

- What happens when threshold files are renamed or moved?
  - Guard patterns must be updated to match new file paths. Documentation should note this dependency.

- What happens when actual coverage drops below current threshold?
  - Tests fail (existing behavior). The ratchet system does not address this - it only manages threshold updates.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a script that parses coverage artifacts and outputs JSON containing actual coverage percentages and recommended thresholds.

- **FR-002**: System MUST compute recommended thresholds using the formula `threshold = floor(actual_coverage - 2.0)` for all coverage metrics.

- **FR-003**: System MUST parse Python coverage from `coverage.xml` (line-rate attribute) using the same source as the `fail_under` enforcement.

- **FR-004**: System MUST parse TypeScript coverage from `lcov.info` (LF/LH line totals) using the same source as Jest threshold enforcement.

- **FR-005**: CI MUST include a job that detects changes to coverage threshold configuration files (pyproject.toml, jest.config.ts).

- **FR-006**: CI MUST fail pull requests that modify threshold values without `[threshold-update]` marker in any commit message.

- **FR-007**: CI MUST pass pull requests that modify threshold values when `[threshold-update]` marker is present in any commit message.

- **FR-008**: CI MUST pass pull requests that modify threshold configuration files but do not change actual threshold values.

- **FR-009**: Documentation MUST specify the canonical CI environment for coverage measurement (Python: ubuntu-latest + Python 3.11, TypeScript: ubuntu-latest + Node 22).

- **FR-010**: Documentation MUST include the ratchet formula with worked examples.

- **FR-011**: CI workflow MUST include a comment marking the canonical coverage leg to prevent accidental changes to the authoritative environment.

- **FR-012**: Coverage actuals script MUST read current thresholds from configuration files and include them in output for comparison.

- **FR-013**: Coverage actuals script MUST display clear error messages when required coverage artifacts are missing.

### Key Entities

- **Coverage Artifact**: Source data for actual coverage (coverage.xml for Python, lcov.info for TypeScript). Contains raw coverage metrics from test execution.

- **Threshold Configuration**: Settings in pyproject.toml (fail_under) and jest.config.ts (coverageThreshold) that enforce minimum coverage requirements.

- **Coverage Report**: JSON output from the actuals script containing actual coverage, current thresholds, and recommended thresholds for both Python and TypeScript.

- **Threshold Change Guard**: CI job that monitors PRs for threshold modifications and enforces the `[threshold-update]` marker requirement.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Coverage threshold drift is reduced from current 6-13% to maximum 2% buffer, measured by comparing actual coverage to enforced thresholds.

- **SC-002**: 100% of threshold changes in pull requests are detected by the guard job (no false negatives).

- **SC-003**: 0% of non-threshold changes to configuration files trigger guard failures (no false positives).

- **SC-004**: Developers can compute recommended thresholds in under 30 seconds by running a single command.

- **SC-005**: All documentation sections (formula, canonical environment, update process) are present and pass review by at least one team member unfamiliar with the system.

- **SC-006**: The threshold update workflow completes successfully on first attempt when following documented procedures.

## Assumptions

- Coverage artifacts (coverage.xml, lcov.info) are generated as part of the standard test execution process.
- The canonical CI environment (ubuntu-latest, Python 3.11, Node 22) remains stable and will not change without coordinated updates.
- The `[threshold-update]` marker convention is acceptable to the team as the gating mechanism.
- Existing tiered thresholds (per-file thresholds in jest.config.ts) will be preserved; this feature addresses global threshold management.
- The 2% buffer is appropriate for this project's refactoring cadence; teams with different needs may adjust the formula.

## Out of Scope

- Automated threshold updates (thresholds are updated manually with tooling assistance).
- Per-file threshold ratcheting (only global thresholds are managed by this system).
- Coverage trend analysis or historical tracking.
- Integration with external coverage reporting services (Codecov, Coveralls, etc.).
- Notification systems for coverage changes.
