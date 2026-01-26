# Feature Specification: Address Review Feedback for Unified Dashboard Serve

**Feature Branch**: `002-serve-review-fixes`
**Created**: 2026-01-26
**Status**: Draft
**Input**: User description: "Implement Flight 20260126B — Address review feedback for Unified Dashboard Launch (build-aggregates --serve). The core feature is already implemented; this flight is limited to resolving the identified review findings across PowerShell scripts, Speckit docs, and CLI refactors. Apply targeted fixes only (logging, validation hardening, collision safety, regex escaping, DRY flag validation, and dashboard function decomposition). No behavioral changes to the --serve feature itself."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Developer Diagnoses Git Fallback Behavior (Priority: P1)

A developer encounters unexpected behavior when using Speckit scripts outside a git repository or when git operations fail. Currently, the system silently falls back to alternative behavior, making debugging difficult. The developer needs clear feedback when fallback behavior is triggered.

**Why this priority**: Silent failures are the most difficult to diagnose and can lead to incorrect branch numbering or unexpected script behavior. This directly impacts developer productivity and trust in the tooling.

**Independent Test**: Can be tested by running Speckit scripts in a non-git directory and verifying that warning messages appear in the output.

**Acceptance Scenarios**:

1. **Given** a developer runs a Speckit script outside a git repository, **When** the script falls back to using script location, **Then** a warning message is logged indicating the fallback occurred
2. **Given** a git fetch operation fails during branch creation, **When** the script continues execution, **Then** a warning is logged about potentially missing remote branches

---

### User Story 2 - Developer Creates Feature with Long Branch Name (Priority: P1)

A developer creates a new feature with a very long description that would result in a truncated branch name. Another developer later creates a different feature that would truncate to the same name, creating a collision.

**Why this priority**: Branch name collisions can cause serious confusion and potential code loss. This is a data integrity issue that must be prevented.

**Independent Test**: Can be tested by attempting to create two features with descriptions that would truncate to identical branch names and verifying the system prevents or resolves the collision.

**Acceptance Scenarios**:

1. **Given** a feature description that exceeds branch name length limits, **When** the branch name is truncated, **Then** the system ensures the resulting name is unique (via hash suffix or collision detection)
2. **Given** a truncated branch name would collide with an existing branch, **When** the collision is detected, **Then** the system automatically generates a unique alternative name

---

### User Story 3 - Developer Uses Speckit Templates with Special Characters (Priority: P1)

A developer creates a feature specification where template values contain characters that have special meaning in regular expressions (e.g., `$`, `^`, `*`, `.`). The template replacement must handle these safely.

**Why this priority**: Regex failures can cause scripts to crash or produce corrupted output. This is a correctness issue affecting all template operations.

**Independent Test**: Can be tested by creating a feature with description containing regex special characters and verifying template replacement completes without errors.

**Acceptance Scenarios**:

1. **Given** a template value contains regex special characters, **When** the template replacement executes, **Then** the special characters are properly escaped and replaced literally
2. **Given** a template file contains malformed placeholders, **When** replacement is attempted, **Then** the system validates placeholders before replacement and reports errors clearly

---

### User Story 4 - Maintainer Reviews CLI Flag Validation Code (Priority: P2)

A maintainer reviews the CLI codebase and notices duplicate flag validation logic between `cmd_build_aggregates` and `cmd_stage_artifacts` functions. They want to refactor this for better maintainability.

**Why this priority**: Code duplication creates maintenance burden and increases risk of inconsistent behavior. While not user-facing, this improves long-term codebase health.

**Independent Test**: Can be tested by verifying that both commands share the same validation function and that modifying validation in one place affects both commands.

**Acceptance Scenarios**:

1. **Given** the CLI codebase contains duplicate flag validation, **When** validation logic is extracted to a shared function, **Then** both commands use the same validation logic
2. **Given** a bug is found in flag validation, **When** the fix is applied to the shared function, **Then** both commands exhibit corrected behavior

---

### User Story 5 - Maintainer Reviews Dashboard Serve Code (Priority: P2)

A maintainer reviews the `_serve_dashboard` function and finds it handles multiple responsibilities (UI sync, server setup, request handling), making it difficult to understand and modify.

**Why this priority**: Long functions with multiple responsibilities are harder to test, debug, and extend. Decomposition improves maintainability without changing user-facing behavior.

**Independent Test**: Can be tested by verifying the dashboard serve functionality works identically before and after refactoring, with no changes to external behavior.

**Acceptance Scenarios**:

1. **Given** the `_serve_dashboard` function handles multiple responsibilities, **When** it is decomposed into smaller functions, **Then** each function has a single, clear responsibility
2. **Given** the dashboard serve feature is refactored, **When** all existing tests are run, **Then** all tests pass without modification (behavior preservation)

---

### User Story 6 - Speckit Template Patterns Configuration (Priority: P3)

A developer working with a new technology stack finds that Speckit's hardcoded ignore patterns don't cover their tech stack. They want patterns to be configurable.

**Why this priority**: While useful for future extensibility, this is lower priority as it affects a smaller subset of users and the current patterns work for most common stacks.

**Independent Test**: Can be tested by verifying that technology patterns can be loaded from a configuration file and that the system falls back gracefully when no configuration exists.

**Acceptance Scenarios**:

1. **Given** technology-specific ignore patterns are needed, **When** a configuration file is provided, **Then** the system loads patterns from the configuration
2. **Given** no configuration file exists, **When** the system needs ignore patterns, **Then** it uses sensible built-in defaults

---

### Edge Cases

- What happens when git commands fail mid-operation (partial fetch, interrupted checkout)?
- How does the system handle concurrent branch creation with collision potential?
- What happens when template files are corrupted or have mismatched placeholders?
- How does the system behave when regex escaping encounters null or extremely long strings?

## Requirements *(mandatory)*

### Functional Requirements

**Logging and Diagnostics:**
- **FR-001**: System MUST log a warning when falling back from git-based path resolution to script-based path resolution
- **FR-002**: System MUST log a warning when git fetch operations fail, indicating that remote branches may not be current
- **FR-003**: All warning messages MUST include actionable context (what failed, potential impact, suggested remediation)

**Collision Safety:**
- **FR-004**: System MUST detect when a truncated branch name would collide with an existing branch
- **FR-005**: System MUST generate unique branch names when collision is detected (via hash suffix or alternative naming)
- **FR-006**: Collision detection MUST check both local and remote branches

**Template Validation and Safety:**
- **FR-007**: System MUST validate that all required placeholders exist in templates before attempting replacement
- **FR-008**: System MUST escape regex special characters in user-provided values before using them in regex replacements
- **FR-009**: System MUST report clear error messages when template validation fails

**Code Quality (DRY Principle):**
- **FR-010**: CLI flag validation logic MUST be extracted into a shared function used by both `cmd_build_aggregates` and `cmd_stage_artifacts`
- **FR-011**: The `_serve_dashboard` function MUST be decomposed into smaller functions with single responsibilities

**Configuration (Lower Priority):**
- **FR-012**: Technology-specific ignore patterns SHOULD be loadable from an external configuration file
- **FR-013**: System MUST provide sensible defaults when no configuration file exists

### Key Entities

- **Warning Log Entry**: A logged message containing severity level, context, impact description, and suggested action
- **Branch Name**: A git branch identifier with maximum length constraints and uniqueness requirements
- **Template Placeholder**: A marker in template files that gets replaced with actual values during processing
- **Validation Function**: A shared code unit that validates CLI flags and can be invoked from multiple commands

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All git fallback scenarios produce visible warning messages in script output
- **SC-002**: Zero branch name collisions occur when creating features with truncated names
- **SC-003**: Template replacement succeeds for values containing any printable ASCII characters
- **SC-004**: Flag validation code exists in exactly one location (no duplication)
- **SC-005**: The `_serve_dashboard` function is decomposed into 3 or more focused sub-functions
- **SC-006**: All existing tests pass without modification after refactoring (100% behavior preservation)
- **SC-007**: No user-facing behavioral changes to the --serve feature itself

## Assumptions

- The existing `--serve` feature implementation is complete and functioning correctly
- Git is the only version control system that needs to be supported
- PowerShell 5.1+ and PowerShell Core 7+ are the supported PowerShell versions
- Python 3.10+ is the supported Python runtime for CLI refactoring
- Warning messages should go to stderr to avoid interfering with JSON output
- Branch name length limit follows git's default maximum (approximately 250 characters)
- The refactoring scope is limited to the specific files identified in the review findings

## Out of Scope

- Changes to the core `--serve` functionality or behavior
- New features or capabilities beyond the review feedback items
- Changes to test infrastructure or CI/CD pipelines (unless required to pass existing tests)
- Documentation updates beyond inline code comments
- Performance optimizations not related to the review findings
