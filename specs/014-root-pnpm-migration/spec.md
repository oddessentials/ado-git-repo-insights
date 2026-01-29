# Feature Specification: Complete Root pnpm Migration

**Feature Branch**: `014-root-pnpm-migration`
**Created**: 2026-01-29
**Status**: Draft
**Input**: User description: "Finish root migration from npm to pnpm, fix release.yml, extend CI lockfile guards, enforce single package manager invariant"

## Clarifications

### Session 2026-01-29

- Q: How should CI handle package-lock.json in ignored directories like tmp/? → A: CI MUST fail if package-lock.json exists anywhere in the workspace; no exclusions (simplest rule).
- Q: What exact mechanism blocks npm usage (FR-007)? → A: Preinstall script that errors when npm_config_user_agent contains "npm/" (hard wall approach).
- Q: Should "pnpm lockfile" be normalized to exact filename? → A: Yes, use `pnpm-lock.yaml` consistently everywhere.
- Q: Should SC-004 (npm grep check) be enforced as a CI step? → A: Yes, add CI job that runs `git grep` and fails if matches found (except allowlisted tfx-cli).
- Q: Should release workflow explicitly verify no lockfile changes? → A: Yes, add `git diff --exit-code` step after install/release to prove no lockfile regeneration.
- Q: How strict should the git diff check be in release.yml? → A: Hard-fail on any lockfile mutation. Do not mask exit codes. Fail if pnpm-lock.yaml changes OR package-lock.json appears.
- Q: Should npm blocking have multiple enforcement layers? → A: Yes, use BOTH preinstall script AND `engines.pnpm` + `engine-strict=true` in .npmrc for defense-in-depth.
- Q: What scope should the npm command grep check cover? → A: Scan .github/workflows/, root package.json scripts, AND scripts/ directory to catch npm in helper scripts.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Developer Runs pnpm Install at Root (Priority: P1)

A developer clones the repository and runs `pnpm install` at the repository root. The install completes successfully using `pnpm-lock.yaml`, and no npm artifacts (package-lock.json) are created.

**Why this priority**: This is the fundamental change that enables all other stories. Without a valid `pnpm-lock.yaml` at root, nothing else works.

**Independent Test**: Clone repository, run `pnpm install` at root, verify `pnpm-lock.yaml` exists and package-lock.json does not exist.

**Acceptance Scenarios**:

1. **Given** a fresh clone of the repository, **When** a developer runs `pnpm install` at the repository root, **Then** dependencies install successfully using `pnpm-lock.yaml`
2. **Given** dependencies are installed at root, **When** developer runs `pnpm install` a second time, **Then** no changes occur to `pnpm-lock.yaml` (stable lockfile)
3. **Given** the repository root, **When** any developer operation completes, **Then** no package-lock.json file exists at root

---

### User Story 2 - Release Workflow Uses pnpm Exclusively (Priority: P1)

The release workflow runs semantic-release using pnpm for all package management operations. The workflow uses the shared pnpm setup action and installs dependencies with `pnpm install --frozen-lockfile`. After install and release steps, the workflow hard-fails if any lockfile mutation is detected.

**Why this priority**: The release workflow currently uses npm, which generates package-lock.json on every release. This must be fixed to prevent recurring lockfile conflicts.

**Independent Test**: Trigger release workflow manually, verify it completes without running any npm commands (except approved global tool installs) and lockfile verification passes with no swallowed exit codes.

**Acceptance Scenarios**:

1. **Given** a push to main branch, **When** release workflow runs, **Then** it uses pnpm for all dependency installation
2. **Given** release workflow execution, **When** semantic-release runs, **Then** it does not create or modify package-lock.json
3. **Given** release workflow, **When** any lockfile changes (pnpm-lock.yaml modified OR package-lock.json created), **Then** workflow hard-fails immediately (no exit code masking)
4. **Given** release workflow, **When** no lockfile changes occur, **Then** verification step passes

---

### User Story 3 - CI Rejects npm Lockfiles Anywhere (Priority: P2)

The CI pipeline detects and fails if package-lock.json exists anywhere in the repository workspace. No exclusions - the rule is absolute. The failure message clearly indicates the problem and resolution.

**Why this priority**: This is a safety net that prevents accidental npm usage from being merged. It builds on the migration work but isn't required for the migration itself.

**Independent Test**: Create package-lock.json at root, push to branch, verify CI fails with actionable error message.

**Acceptance Scenarios**:

1. **Given** package-lock.json exists at repository root, **When** CI runs, **Then** it fails with error message: "This repository uses pnpm exclusively. Remove package-lock.json and use pnpm install."
2. **Given** package-lock.json exists in extension/, **When** CI runs, **Then** it fails with the same actionable error message
3. **Given** package-lock.json exists anywhere in the workspace (including subdirectories), **When** CI runs, **Then** it fails
4. **Given** no package-lock.json files exist anywhere, **When** CI runs, **Then** the lockfile check passes

---

### User Story 4 - Repository Enforces Single Package Manager (Priority: P2)

The repository configuration ensures only pnpm can be used through multiple enforcement layers: preinstall script, engines field, and engine-strict .npmrc. CI enforces no npm commands exist in workflows, package.json scripts, or helper scripts.

**Why this priority**: This prevents future regressions by making npm usage impossible through defense-in-depth. It depends on the migration being complete first.

**Independent Test**: Run `npm install` at root, verify it fails with error. CI job scans .github/workflows/, package.json scripts, and scripts/ directory for npm commands and fails if matches found (except allowlisted tfx-cli).

**Acceptance Scenarios**:

1. **Given** root package.json has preinstall script checking npm_config_user_agent, **When** developer runs `npm install`, **Then** it fails with error: "Use pnpm, not npm"
2. **Given** root package.json has `engines.pnpm` and .npmrc has `engine-strict=true`, **When** developer runs `npm install`, **Then** it fails with engine mismatch error
3. **Given** all workflow files, package.json scripts, and scripts/ directory, **When** CI grep job searches for `npm ci` or `npm install`, **Then** zero matches are found (except tfx-cli global installs which are allowlisted)
4. **Given** repository documentation, **When** searching for npm references, **Then** all references use pnpm terminology *(advisory - full audit deferred)*

---

### Edge Cases

- What happens when semantic-release plugins internally call npm? (Answer: Standard semantic-release plugins respect the lockfile present; npm is not invoked if `pnpm-lock.yaml` exists)
- How does the system handle existing package-lock.json in any directory? (Answer: CI fails if package-lock.json exists anywhere in the workspace - no exclusions, absolute rule)
- What happens if `pnpm-lock.yaml` becomes corrupted or out of sync? (Answer: CI --frozen-lockfile flag will fail fast, developer must regenerate lockfile locally)
- What if git diff check has a non-zero exit code? (Answer: Workflow hard-fails immediately; no exit code masking with `|| true`)
- What if npm commands exist in scripts/ helpers but not workflows? (Answer: CI npm-command-guard scans scripts/ directory too, so it would be caught)
- Why does the CI guard exclude node_modules from the search? (Answer: node_modules/ contains transient dependencies installed at runtime, not version-controlled files. The "no exclusions" rule applies to tracked/committed files only.)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Repository root MUST have `pnpm-lock.yaml` as the sole lockfile
- **FR-002**: Repository root MUST NOT have package-lock.json checked into version control
- **FR-003**: release.yml MUST use `.github/actions/setup-pnpm` action before any Node.js operations
- **FR-004**: release.yml MUST use `pnpm install --frozen-lockfile` instead of `npm ci` for root dependencies
- **FR-005**: CI MUST fail if package-lock.json exists anywhere in the repository workspace (no exclusions for tracked files)
- **FR-006**: Repository MUST have a preinstall script in root package.json that errors when `npm_config_user_agent` contains "npm/" (hard block)
- **FR-007**: All workflow files MUST NOT contain `npm ci` or `npm install` commands for project dependencies
- **FR-008**: Global tool installs (tfx-cli) MAY use npm as they do not affect project lockfiles (allowlist pattern: `npm install -g tfx-cli`)
- **FR-009**: CI MUST have a job that runs `git grep` to verify no npm install/ci commands exist in workflows, package.json scripts, AND scripts/ directory (except allowlisted)
- **FR-010**: release.yml MUST include lockfile verification step that hard-fails if pnpm-lock.yaml changes OR package-lock.json appears (no exit code masking)
- **FR-011**: Root package.json MUST have `"engines": { "pnpm": "9.15.0" }` field
- **FR-012**: Root .npmrc MUST have `engine-strict=true` for defense-in-depth npm blocking

### Key Entities

- **Root package.json**: Contains semantic-release dependencies, declares `packageManager: pnpm@9.15.0`, includes preinstall npm-blocking script, has `engines.pnpm` field
- **pnpm-lock.yaml (root)**: New lockfile to be created, replaces package-lock.json
- **release.yml**: Workflow that must be updated to use pnpm and hard-fail on any lockfile mutation
- **ci.yml**: Workflow with lockfile guards that must be extended to check entire workspace
- **.npmrc**: Configuration file with `engine-strict=true` for defense-in-depth enforcement

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Running `pnpm install` twice at root produces identical `pnpm-lock.yaml` (zero diff on second run)
- **SC-002**: Release workflow hard-fails if any lockfile mutation detected (no masked exit codes)
- **SC-003**: CI fails within first 60 seconds when package-lock.json is present anywhere in workspace (fast feedback)
- **SC-004**: CI job running npm grep check on .github/workflows/, package.json scripts, AND scripts/ returns zero matches (except allowlisted tfx-cli step)
- **SC-005**: All existing CI checks pass after migration is complete
- **SC-006**: Running `npm install` at root fails with BOTH preinstall script error AND engine mismatch error

## Assumptions

- The root package.json already has `packageManager: pnpm@9.15.0` declared (verified in prior analysis)
- The `.github/actions/setup-pnpm` action exists and is working correctly for extension builds
- Semantic-release and its plugins are compatible with pnpm (industry-standard tooling)
- The tfx-cli global install can continue using npm as it installs to system path, not project

## Scope Boundaries

**In Scope**:
- Root `pnpm-lock.yaml` creation
- Root package-lock.json deletion
- release.yml pnpm migration with strict lockfile verification (no exit code masking)
- CI lockfile guard extension to check entire workspace
- Preinstall script for npm blocking
- engines.pnpm field and engine-strict .npmrc for defense-in-depth
- CI job for npm command grep check covering workflows, package.json scripts, and scripts/ directory

**Out of Scope**:
- Extension directory changes (already using pnpm correctly)
- Modifying semantic-release plugin configuration
- Changing Node.js or pnpm versions
- Documentation terminology audit (deferred; US4 acceptance #4 is advisory, not blocking)
