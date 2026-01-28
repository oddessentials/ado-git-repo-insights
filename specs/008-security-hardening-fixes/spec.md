# Feature Specification: Security Hardening Fixes

**Feature Branch**: `008-security-hardening-fixes`
**Created**: 2026-01-28
**Status**: Complete
**Input**: User description: Security hardening fixes for shell injection vulnerabilities, brittle error handling, and ESLint security rule enforcement

## Clarifications

### Session 2026-01-28
- Q: What should env_guard.py do when a staged file cannot be scanned (permission error, missing, encoding error)? → A: Fail-closed - exit non-zero if ANY staged file cannot be scanned (no silent partial scans)
- Q: How should pre-push hook handle shell compatibility for pipefail? → A: Require bash - change shebang to `#!/usr/bin/env bash` and use pipefail
- Q: What is the correct invariant for safe filename handling in pre-push hook? → A: Flow-based - require `find -print0 | xargs -0` pattern with `--` separators; no specific grep flags mandated
- Q: How should env_guard.py validate the git executable? → A: Behavior validation - run `git --version` and verify it returns version string matching `git version X.Y.Z`
- Q: How should ESLint suppression creep be prevented? → A: Justification tag - require `// eslint-disable-next-line security/detect-object-injection -- SECURITY: <reason>` format; CI can grep for tag

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Shell Injection Prevention in Pre-push Hook (Priority: P0)

As a security-conscious maintainer, I want the pre-push hook to handle filenames safely so that malicious filenames cannot cause option injection, word splitting, or newline-based argument manipulation.

**Why this priority**: Unsafe filename handling can cause option injection (filename starting with `-`), word splitting (spaces/tabs), or newline attacks (filename with embedded newline treated as multiple arguments). NUL-delimited handling prevents all three.

**Independent Test**: Can be tested by creating a file with special characters in the name and verifying the CRLF guard handles it without command injection.

**Acceptance Scenarios**:

1. **Given** a file named `test$'\n'.txt` exists in the repo, **When** the pre-push hook runs the CRLF guard, **Then** the check completes without shell injection and reports accurate results
2. **Given** the pre-push hook uses NUL-delimited file handling, **When** processing files with special characters, **Then** filenames flow through `find -print0 | xargs -0` with `--` separators
3. **Given** a crafted filename attempting command injection, **When** the pre-push hook processes it, **Then** only the filename itself is checked, not executed as a command

---

### User Story 2 - Robust Error Handling in Pre-push Hook (Priority: P0)

As a developer, I want the pre-push hook to fail reliably on any error so that silent failures cannot result in broken code reaching CI.

**Why this priority**: The current `set -e` does not catch failures in pipelines. A `find | xargs` failing silently could allow CRLF-tainted files to be pushed.

**Independent Test**: Can be tested by simulating a command failure in a pipeline and verifying the hook exits with non-zero status.

**Acceptance Scenarios**:

1. **Given** the pre-push hook uses piped commands, **When** any command in the pipeline fails, **Then** the hook exits with non-zero status (via `set -o pipefail`)
2. **Given** an unexpected error occurs during hook execution, **When** the error is caught, **Then** a meaningful error message is displayed before exit
3. **Given** a command in the middle of a pipeline fails, **When** using pipefail, **Then** the overall pipeline exit code reflects the failure

---

### User Story 3 - Secure Git Executable Resolution (Priority: P1)

As a security engineer, I want the env_guard.py script to validate the git executable path so that a malicious git binary in PATH cannot be used for attacks.

**Why this priority**: `shutil.which("git")` can return any executable in PATH. If an attacker places a malicious `git` earlier in PATH, env_guard would execute it.

**Independent Test**: Can be tested by verifying the script runs `git --version` and validates the output format.

**Acceptance Scenarios**:

1. **Given** `shutil.which("git")` returns a path, **When** env_guard validates it, **Then** it runs `git --version` and verifies output matches `git version X.Y.Z` pattern
2. **Given** `shutil.which("git")` returns `None`, **When** env_guard runs, **Then** it exits non-zero with a clear error message about git not being found
3. **Given** `git --version` returns unexpected output (not a real git binary), **When** env_guard validates it, **Then** it exits non-zero with error about invalid git executable

---

### User Story 4 - Robust File Error Handling in env_guard.py (Priority: P1)

As a developer, I want env_guard.py to handle file errors gracefully so that permission errors or missing files don't cause cryptic failures.

**Why this priority**: The current bare `open()` call can raise various exceptions that should be caught and reported meaningfully.

**Independent Test**: Can be tested by running env_guard on a file with restricted permissions and verifying graceful error handling.

**Acceptance Scenarios**:

1. **Given** a staged file that cannot be read due to permissions, **When** env_guard processes it, **Then** it exits non-zero with a clear error message identifying the unreadable file
2. **Given** a staged file that is deleted before env_guard reads it, **When** env_guard processes it, **Then** it exits non-zero with a FileNotFoundError message
3. **Given** an encoding error reading a file, **When** env_guard processes it, **Then** it exits non-zero indicating the file could not be scanned (fail-closed behavior)

---

### User Story 5 - AI Review Configuration Verification (Priority: P2)

As a security maintainer, I want to verify and lock the .ai-review.yml trusted_only setting so that AI-assisted reviews only run on trusted code.

**Why this priority**: This is a verification task to ensure existing configuration is correct rather than introducing new functionality.

**Independent Test**: Can be verified by inspecting .ai-review.yml and confirming trusted_only is set appropriately.

**Acceptance Scenarios**:

1. **Given** the .ai-review.yml file exists, **When** inspected, **Then** it has `trusted_only: true` or equivalent security setting
2. **Given** the trusted_only setting is configured, **When** reviewing the configuration, **Then** comments explain why this setting is important

---

### User Story 6 - ESLint Security Rule Re-enablement (Priority: P1)

As a security engineer, I want the detect-object-injection rule re-enabled with inline suppressions so that true positives are caught while false positives are documented.

**Why this priority**: The rule was disabled entirely due to false positives. Re-enabling with targeted suppressions maintains security coverage while addressing known false positives.

**Independent Test**: Can be tested by introducing a true object injection vulnerability and verifying ESLint catches it.

**Acceptance Scenarios**:

1. **Given** detect-object-injection rule is enabled, **When** ESLint runs on code with true object injection risk, **Then** ESLint reports an error
2. **Given** known false positive locations in the codebase, **When** ESLint runs, **Then** those locations have `// eslint-disable-next-line security/detect-object-injection -- SECURITY: <reason>` with mandatory justification tag
3. **Given** the rule is re-enabled with suppressions, **When** running `npm run lint`, **Then** no warnings are reported (--max-warnings=0 passes)

---

### User Story 7 - CI Lint Strictness Maintenance (Priority: P2)

As a CI maintainer, I want --max-warnings=0 maintained in CI so that new warnings cannot be introduced without explicit acknowledgment.

**Why this priority**: This is configuration verification to maintain existing strictness rather than new functionality.

**Independent Test**: Can be verified by checking CI workflow files for --max-warnings=0 flag.

**Acceptance Scenarios**:

1. **Given** the CI workflow runs ESLint, **When** a new warning would be introduced, **Then** the CI build fails
2. **Given** --max-warnings=0 is set in CI, **When** a developer pushes code with warnings, **Then** CI reports the failure clearly

---

### Edge Cases

- What happens if a file has NUL bytes in its content (not just filename)?
  - NUL-delimited handling is for filenames only; file content scanning uses standard text processing
- How does the hook handle extremely long filenames that might exceed argument limits?
  - Using `xargs` with `-0` handles this by processing in batches
- What if git is installed via an unusual package manager (e.g., scoop, chocolatey)?
  - Validation uses behavior check (`git --version`), not path location, so any valid git installation works regardless of install method
- How are inline ESLint suppressions documented for future maintainers?
  - Each suppression requires `-- SECURITY: <reason>` tag format; CI can verify all suppressions have tags by comparing grep counts

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Pre-push hook MUST use NUL-delimited filename flow (`find -print0 | xargs -0`) with `--` separators to prevent option injection
- **FR-002**: Pre-push hook MUST use `#!/usr/bin/env bash` shebang and enable `set -o pipefail` to catch pipeline failures
- **FR-003**: Pre-push hook MUST include an ERR trap or explicit exit code checks for critical commands
- **FR-004**: env_guard.py MUST validate git by checking `shutil.which("git")` is not None AND `git --version` output matches expected pattern
- **FR-005**: env_guard.py MUST use explicit try/except blocks around file operations
- **FR-006**: env_guard.py MUST exit non-zero (fail-closed) on FileNotFoundError, PermissionError, or UnicodeDecodeError with clear error message
- **FR-007**: .ai-review.yml MUST have trusted_only setting verified and documented
- **FR-008**: ESLint security/detect-object-injection MUST be re-enabled as error (not warn or off)
- **FR-009**: Known false positives MUST use format `// eslint-disable-next-line security/detect-object-injection -- SECURITY: <reason>` with mandatory justification tag
- **FR-010**: CI workflows MUST maintain --max-warnings=0 for ESLint
- **FR-011**: All changes MUST pass existing pre-push checks and CI

### Key Entities

- **Pre-push Hook**: `.husky/pre-push` shell script that mirrors CI checks
- **Environment Guard**: `scripts/env_guard.py` Python script for secret detection
- **ESLint Configuration**: `extension/eslint.config.mjs` defining security rules
- **AI Review Configuration**: `.ai-review.yml` controlling AI-assisted review behavior
- **CI Workflows**: GitHub Actions workflows enforcing lint strictness

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Pre-push hook uses `find -print0 | xargs -0` pattern with `--` separators for all file iteration
- **SC-002**: Pre-push hook has `#!/usr/bin/env bash` shebang and `set -o pipefail` at the top
- **SC-003**: env_guard.py validates git via `git --version` output check before any git subprocess calls
- **SC-004**: env_guard.py has try/except around all open() calls that exit non-zero on any file error (fail-closed)
- **SC-005**: detect-object-injection rule is set to 'error' in eslint.config.mjs
- **SC-006**: All suppressions use `-- SECURITY: <reason>` tag format; grep for tag returns same count as grep for disable comment
- **SC-007**: `npm run lint` passes with zero warnings after changes
- **SC-008**: All CI checks pass on the feature branch
- **SC-009**: .ai-review.yml trusted_only setting is documented

## Assumptions

- The existing false positives for detect-object-injection are truly false positives that can be safely suppressed
- The pre-push hook runs in bash (explicitly required via shebang); bash is available on all target platforms including Windows (Git Bash)
- Git is installed and accessible via PATH on developer machines
- The .ai-review.yml file exists and is actively used for AI review configuration
