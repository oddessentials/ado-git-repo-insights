# Feature Specification: CLI Distribution Hardening

**Feature Branch**: `003-cli-distribution`
**Created**: 2026-01-26
**Status**: Draft
**Input**: User description: "Implement Flight 20260126C - Harden and expand the distribution of the CLI tool, ado-insights beyond pip install, with enterprise-grade best practices. Required that cross-platform users have ado-insights automatically added to their PATH upon installation or have CLI feedback with a command to run to do so. Include optional plan to distribute using other popular methods such as uv or other free, frictionless options."

## Clarifications

### Session 2026-01-26

- Q: What are the officially supported install methods and their priority? → A: Primary (P1): `pipx install`; Primary (P1/P2): `uv tool install`; Supported-but-not-frictionless: `pip install` with excellent PATH detection + copy/paste instructions
- Q: What is the scope of PATH cleanup on uninstall? → A: PATH cleanup only applies to changes made via an explicit `ado-insights setup-path` action; pipx/uv manage their own PATH entries and cleanup is not feasible for those installs
- Q: What does "works identically regardless of installation method" mean? → A: CLI commands and features behave the same; environment location may differ
- Q: How to handle multiple package managers with conflicting installs? → A: Add `ado-insights doctor` command with deterministic output: executable location, Python environment, and recommended fix commands if conflicts detected
- Q: Which shells are officially supported? → A: Supported (full): bash, zsh, PowerShell; Best-effort guidance: fish, nushell, and others
- Q: How does silent/non-interactive install work? → A: Install commands are non-interactive by design; log deterministic "next steps" text; provide `setup-path --print-only` for scripts that need the PATH command without modifying files

## User Scenarios & Testing _(mandatory)_

### User Story 1 - First-Time Installation via pipx (Priority: P1)

A new user installs the ado-insights CLI tool using `pipx install ado-git-repo-insights`. After installation completes, the user opens a new terminal and types `ado-insights --version`. The command executes successfully without any manual PATH configuration because pipx handles PATH management automatically.

**Why this priority**: This is the recommended frictionless installation path. pipx is purpose-built for CLI tool installation, provides automatic PATH management, and isolates dependencies. This delivers the best "first 5 minutes" experience.

**Independent Test**: Can be tested by performing a fresh pipx installation on each supported platform and verifying the CLI is immediately available in a new terminal session.

**Acceptance Scenarios**:

1. **Given** a user has pipx installed, **When** they run `pipx install ado-git-repo-insights`, **Then** the `ado-insights` command is available in new terminal sessions without manual PATH configuration
2. **Given** a user completes pipx installation, **When** they open a new terminal, **Then** `ado-insights --version` executes successfully
3. **Given** pipx is properly configured, **When** installation completes, **Then** the tool is isolated from the user's other Python environments

---

### User Story 2 - First-Time Installation via uv tool (Priority: P1)

A developer installs ado-insights using `uv tool install ado-git-repo-insights`. After installation completes, the CLI is immediately available without PATH configuration because uv handles tool installation with automatic PATH management.

**Why this priority**: uv is a modern, fast alternative to pipx that many developers prefer. Supporting `uv tool install` as a primary method aligns with current best practices and provides another frictionless option.

**Independent Test**: Can be tested by installing via uv tool on each supported platform and verifying immediate CLI availability.

**Acceptance Scenarios**:

1. **Given** a user has uv installed, **When** they run `uv tool install ado-git-repo-insights`, **Then** the `ado-insights` command is available in new terminal sessions without manual PATH configuration
2. **Given** uv tool installation completes, **When** the user opens a new terminal, **Then** `ado-insights --version` executes successfully
3. **Given** a user installs via uv tool, **When** installation completes, **Then** CLI commands and features behave identically to pipx installation (environment location may differ)

---

### User Story 3 - Installation via pip with PATH Guidance (Priority: P2)

A developer or advanced user prefers to install using `pip install ado-git-repo-insights` directly. The installation completes, but if the console script directory is not on PATH, the CLI emits deterministic, copy/paste PATH guidance so the user can add it manually.

**Why this priority**: pip install is the familiar method for Python developers but does not manage PATH automatically. This method remains supported for advanced users who prefer direct pip installation or need it for development workflows.

**Independent Test**: Can be tested by performing pip install in an environment where scripts directory is NOT on PATH and verifying clear, actionable instructions are displayed.

**Acceptance Scenarios**:

1. **Given** a user runs `pip install ado-git-repo-insights`, **When** the console script directory is already on PATH, **Then** `ado-insights` works immediately
2. **Given** a user runs `pip install ado-git-repo-insights`, **When** the console script directory is NOT on PATH, **Then** the installation emits deterministic, platform-specific, copy/paste instructions to add the scripts directory to PATH
3. **Given** pip install detects PATH issue, **When** instructions are displayed, **Then** they include the exact command for the user's shell (bash, zsh, or PowerShell)

---

### User Story 4 - Manual PATH Setup via CLI Command (Priority: P2)

A pip user who received PATH guidance wants to automate the PATH configuration. They can run `ado-insights setup-path` to have the tool modify their shell configuration file. This explicit action is the only PATH modification the tool itself makes.

**Why this priority**: Provides an optional convenience for pip users while keeping PATH modification explicit and auditable.

**Independent Test**: Can be tested by running setup-path command and verifying shell configuration is updated correctly.

**Acceptance Scenarios**:

1. **Given** a user installed via pip, **When** they run `ado-insights setup-path`, **Then** the appropriate shell configuration file is modified to include the scripts directory
2. **Given** a user runs `ado-insights setup-path`, **When** the command completes, **Then** it reports which file was modified and what was added
3. **Given** a user runs `ado-insights setup-path` when PATH is already configured, **When** the command completes, **Then** it reports no changes were needed
4. **Given** a user runs `ado-insights setup-path --print-only`, **When** the command completes, **Then** it outputs the PATH command without modifying any files (useful for scripts)

---

### User Story 5 - Diagnosing Installation Issues (Priority: P2)

A user experiences unexpected behavior or suspects they have multiple conflicting installations. They run `ado-insights doctor` to get a deterministic diagnostic report showing where the executable is located, which environment it's using, and recommended fix commands if problems are detected.

**Why this priority**: Multiple package managers installing different versions is a common "footgun." Proactive diagnostics reduce support burden and help users self-resolve issues.

**Independent Test**: Can be tested by creating a conflicting install scenario and verifying doctor detects and reports the issue with actionable fix commands.

**Acceptance Scenarios**:

1. **Given** a user has a single, clean installation, **When** they run `ado-insights doctor`, **Then** they see a summary confirming executable location and environment with no issues
2. **Given** a user has multiple installations (e.g., pipx and pip both installed the tool), **When** they run `ado-insights doctor`, **Then** the output shows all detected installations and exact commands to resolve the conflict
3. **Given** a user has a broken PATH configuration, **When** they run `ado-insights doctor`, **Then** the output identifies the issue and provides the fix command

---

### User Story 6 - Upgrade Experience (Priority: P2)

An existing user wants to upgrade ado-insights to the latest version. The upgrade process works seamlessly with whichever installation method was originally used.

**Why this priority**: Smooth upgrades encourage users to stay current with security patches and new features. Upgrade commands should match the original installation method.

**Independent Test**: Can be tested by installing an older version via each method, then upgrading and verifying continuity.

**Acceptance Scenarios**:

1. **Given** a user installed via pipx, **When** they run `pipx upgrade ado-git-repo-insights`, **Then** the upgrade completes and CLI remains available
2. **Given** a user installed via uv tool, **When** they run the appropriate uv upgrade command, **Then** the upgrade completes and CLI remains available
3. **Given** a user installed via pip, **When** they run `pip install --upgrade ado-git-repo-insights`, **Then** the upgrade completes and PATH guidance is re-emitted if needed

---

### User Story 7 - Uninstallation (Priority: P3)

A user decides to remove ado-insights from their system. The uninstallation process removes the tool using the matching uninstall command for their installation method. PATH entries managed by pipx/uv are handled by those tools; PATH entries added via `ado-insights setup-path` can be cleaned up via `ado-insights setup-path --remove`.

**Why this priority**: Clean uninstallation is important for system hygiene but is a less common operation than installation or upgrade.

**Independent Test**: Can be tested by installing via each method, then uninstalling, and verifying appropriate cleanup.

**Acceptance Scenarios**:

1. **Given** a user installed via pipx, **When** they run `pipx uninstall ado-git-repo-insights`, **Then** the CLI is removed (pipx manages its own PATH)
2. **Given** a user installed via uv tool, **When** they run the appropriate uv uninstall command, **Then** the CLI is removed (uv manages its own PATH)
3. **Given** a user installed via pip and used `setup-path`, **When** they run `ado-insights setup-path --remove` before uninstalling, **Then** the PATH entry added by setup-path is removed
4. **Given** a user installed via pip, **When** they run `pip uninstall ado-git-repo-insights`, **Then** the package is removed (manual PATH cleanup may be needed if setup-path was used)

---

### User Story 8 - Enterprise/Scripted Deployment (Priority: P3)

An IT administrator needs to deploy ado-insights across multiple workstations in an enterprise environment using configuration management tools or scripted installation. Installation commands are non-interactive by design, with deterministic "next steps" output that can be captured and processed.

**Why this priority**: Enterprise deployments have different requirements but represent significant adoption opportunities. Non-interactive installation with scriptable output enables automation.

**Independent Test**: Can be tested by running installation in a script and verifying deterministic output that can be parsed.

**Acceptance Scenarios**:

1. **Given** an IT administrator runs pipx or uv tool installation in a script, **When** installation completes, **Then** no interactive prompts are displayed and the CLI is available
2. **Given** a script needs to capture the PATH setup command without modifying files, **When** it runs `ado-insights setup-path --print-only`, **Then** it receives the exact command to stdout
3. **Given** an enterprise environment with restricted permissions, **When** installation is attempted, **Then** clear error messages indicate what permissions are required

---

### Edge Cases

- What happens when the user's shell configuration file is read-only or missing?
- How does the system handle existing PATH entries that point to old versions?
- What happens when multiple package managers have installed different versions? (Handled by `doctor` command)
- How does installation behave when disk space is insufficient?
- What happens on systems with non-standard shell configurations (fish, nushell)? (Best-effort guidance only)
- What if pip install PATH detection incorrectly identifies the scripts directory?
- What if `setup-path` is run when the tool was installed via pipx/uv?
- What if `doctor` is run from a different installation than the one on PATH?

## Requirements _(mandatory)_

### Functional Requirements

**Official Installation Methods (Frictionless):**

- **FR-001**: After following an officially supported install method (`pipx install` or `uv tool install`), `ado-insights` MUST be available in a new terminal without manual PATH edits
- **FR-002**: Installation via `pipx install ado-git-repo-insights` MUST be officially supported and documented as a primary (P1) method
- **FR-003**: Installation via `uv tool install ado-git-repo-insights` MUST be officially supported and documented as a primary (P1/P2) method

**pip install (Supported, Not Frictionless):**

- **FR-004**: `pip install ado-git-repo-insights` MUST be supported for dev/advanced users
- **FR-005**: When `ado-insights` is invoked and the console script directory is not on PATH, the CLI MUST emit deterministic, copy/paste PATH guidance. Note: This check occurs at CLI startup (first command execution), not during `pip install` itself, since pip does not provide reliable post-install hooks.
- **FR-006**: PATH guidance MUST target supported shells: bash, zsh, PowerShell (full support); other shells receive best-effort guidance
- **FR-007**: PATH guidance MUST include the exact scripts directory path for the user's environment

**Explicit PATH Management (setup-path command):**

- **FR-008**: The CLI MUST provide an `ado-insights setup-path` command for users who want automated PATH configuration
- **FR-009**: `setup-path` MUST modify the appropriate shell configuration file for supported shells:
  - bash: `~/.bashrc` (or `~/.bash_profile` on macOS if it exists)
  - zsh: `~/.zshrc`
  - PowerShell: `$PROFILE` if set; otherwise `$HOME/Documents/PowerShell/Microsoft.PowerShell_profile.ps1` (Windows) or `~/.config/powershell/Microsoft.PowerShell_profile.ps1` (Unix). If the profile file does not exist, `setup-path` MUST create it.
- **FR-010**: `setup-path` MUST report which file was modified and what changes were made
- **FR-011**: `setup-path --remove` MUST undo PATH changes made by a previous `setup-path` invocation
- **FR-012**: `setup-path` MUST be idempotent (running twice does not duplicate PATH entries)
- **FR-013**: `setup-path --print-only` MUST output the PATH modification command without modifying any files

**Installation Diagnostics (doctor command):**

- **FR-014**: The CLI MUST provide an `ado-insights doctor` command for diagnosing installation issues
- **FR-015**: `doctor` MUST report the executable location (full path)
- **FR-016**: `doctor` MUST report which environment the CLI is running from
- **FR-017**: `doctor` MUST detect conflicting installations from multiple package managers
- **FR-018**: When conflicts are detected, `doctor` MUST provide exact commands to resolve the conflict

**Cross-Platform Support:**

- **FR-019**: All installation methods MUST work across Windows, macOS, and Linux
- **FR-020**: The CLI MUST be accessible via the same command name (`ado-insights`) on all platforms

**Installation Behavior:**

- **FR-021**: All installation methods MUST result in equivalent CLI behavior (commands and features work the same; environment location may differ)
- **FR-022**: Installation MUST complete without requiring elevated/administrator privileges for user-level installation
- **FR-023**: Installation commands MUST be non-interactive (no prompts)
- **FR-024**: Installation MUST log deterministic "next steps" text that can be captured by scripts

**Shell Support:**

- **FR-025**: Supported shells (full support): bash, zsh, PowerShell
- **FR-026**: Other shells (fish, nushell, etc.) receive best-effort guidance only

**Upgrade and Uninstall:**

- **FR-027**: Upgrade MUST work via the same tool used for installation (pipx upgrade, uv upgrade, pip install --upgrade)
- **FR-028**: Uninstallation via pipx and uv removes the tool; those tools manage their own PATH entries
- **FR-029**: pip uninstall removes the package; PATH cleanup for `setup-path` changes is via `setup-path --remove`

### Key Entities

- **Installation Method**: The tool used to install ado-insights (pipx, uv tool, pip)
- **Console Script Directory**: Platform-specific location where pip/pipx/uv places executable scripts
- **PATH Entry**: A directory path in the system or user PATH environment variable
- **PATH Guidance**: Platform-specific instructions emitted when scripts directory is not on PATH
- **Shell Configuration File**: Platform-specific file modified by `setup-path` (bash: ~/.bashrc, zsh: ~/.zshrc, PowerShell: profile)
- **Doctor Report**: Diagnostic output showing installation state, conflicts, and recommended fixes

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of users installing via pipx or uv tool can run `ado-insights --version` within 60 seconds of installation completing, without manual PATH configuration
- **SC-002**: Users installing via pip receive deterministic PATH guidance when scripts directory is not on PATH
- **SC-003**: PATH guidance includes exact, copy/paste commands for supported shells (bash, zsh, PowerShell)
- **SC-004**: All three installation methods (pipx, uv tool, pip) result in identical CLI behavior (commands work the same)
- **SC-005**: Upgrade from any prior version via the matching tool completes without breaking CLI access
- **SC-006**: Installation commands complete without interactive prompts
- **SC-007**: `setup-path` successfully modifies shell configuration on supported shells (bash, zsh, PowerShell)
- **SC-008**: `setup-path --remove` successfully removes only the entries it previously added
- **SC-009**: `setup-path --print-only` outputs the command without modifying any files
- **SC-010**: `doctor` correctly detects and reports conflicting installations with actionable fix commands

## Assumptions

- Users have basic terminal/command-line familiarity
- Users have permission to install packages at user level (not system-wide)
- For frictionless installation, users have pipx or uv already installed (documented as prerequisite)
- Users can open a new terminal session after installation to pick up PATH changes
- pip install users are expected to be developers/advanced users comfortable with PATH configuration
- Shell configuration files exist in standard locations or can be created by `setup-path`
- Users with unsupported shells (fish, nushell, etc.) are advanced users who can adapt the provided guidance

## Out of Scope

- System-wide installation requiring administrator privileges (focus is on user-level installation)
- Distribution via OS-specific package managers (apt, brew, chocolatey) - may be considered for future flights
- Container-based distribution (Docker images)
- Integration with specific IDE extensions or plugins
- Automatic updates or self-update functionality
- Automatic PATH modification for pip install (use `setup-path` for explicit opt-in)
- PATH cleanup for pipx/uv installs (those tools manage their own PATH)
- Full support for shells beyond bash, zsh, and PowerShell (best-effort only)
