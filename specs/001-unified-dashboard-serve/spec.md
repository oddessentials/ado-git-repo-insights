# Feature Specification: Unified Dashboard Launch

**Feature Branch**: `001-unified-dashboard-serve`
**Created**: 2026-01-26
**Status**: Draft
**Input**: User description: "Implement Flight 260127A — Unified Dashboard Launch with build-aggregates --serve flag. The feature adds an optional convenience flow so developers can run one command to build aggregates and serve/open the local dashboard. Must preserve existing two-step workflow. The --serve flag only runs after successful build. --open and --port require --serve (hard error if used without). No duplication of server code."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One-Command Dashboard Launch (Priority: P1)

A developer wants to quickly view their PR metrics dashboard after extracting data. Instead of running two separate commands (`build-aggregates` then `dashboard`), they want to run a single command that builds the aggregates and immediately launches the dashboard in their browser.

**Why this priority**: This is the primary convenience feature being requested. It reduces the workflow from two commands to one, improving developer experience for the most common local usage pattern.

**Independent Test**: Can be fully tested by running `ado-insights build-aggregates --db <db> --out <dir> --serve --open` and verifying both the aggregate files are created AND the browser opens to a working dashboard.

**Acceptance Scenarios**:

1. **Given** a valid SQLite database with extracted PR data, **When** the user runs `build-aggregates --db <db> --out <dir> --serve --open`, **Then** aggregates are built to the output directory, the dashboard server starts, and a browser window opens to the dashboard URL.

2. **Given** a valid SQLite database, **When** the user runs `build-aggregates --db <db> --out <dir> --serve --port 3000`, **Then** aggregates are built and the dashboard server starts on port 3000 (without auto-opening browser).

3. **Given** a valid SQLite database, **When** the user runs `build-aggregates --db <db> --out <dir> --serve`, **Then** aggregates are built and the dashboard server starts on the default port (8080).

---

### User Story 2 - Preserved Two-Step Workflow (Priority: P2)

A developer or CI pipeline prefers the existing two-step workflow where `build-aggregates` only generates files and `dashboard` is run separately (or not at all). The existing behavior MUST remain unchanged when `--serve` is not provided.

**Why this priority**: Backward compatibility is essential. Existing scripts, pipelines, and documentation rely on the current behavior. Breaking changes would violate project invariants.

**Independent Test**: Can be fully tested by running `build-aggregates` without `--serve` and verifying no server is started and the command exits after generating files.

**Acceptance Scenarios**:

1. **Given** a valid SQLite database, **When** the user runs `build-aggregates --db <db> --out <dir>` (without --serve), **Then** aggregates are built and the command exits immediately without starting any server.

2. **Given** the existing `dashboard` command, **When** the user runs `dashboard --dataset <dir>`, **Then** the dashboard server starts exactly as it does today, with no changes in behavior.

---

### User Story 3 - Clear Error for Invalid Flag Combinations (Priority: P3)

A developer accidentally uses `--open` or `--port` without `--serve`. The system provides a clear, actionable error message explaining that these flags require `--serve`.

**Why this priority**: Good error messages prevent confusion and reduce support burden. This is a usability safeguard, not core functionality.

**Independent Test**: Can be fully tested by running `build-aggregates --db <db> --out <dir> --open` (without --serve) and verifying a clear error is displayed.

**Acceptance Scenarios**:

1. **Given** any valid build-aggregates arguments, **When** the user provides `--open` without `--serve`, **Then** the command fails immediately with an error message stating "--open requires --serve".

2. **Given** any valid build-aggregates arguments, **When** the user provides `--port 3000` without `--serve`, **Then** the command fails immediately with an error message stating "--port requires --serve".

3. **Given** any valid build-aggregates arguments, **When** the user provides both `--open` and `--port` without `--serve`, **Then** the command fails immediately with an error message indicating both flags require `--serve`.

---

### Edge Cases

- What happens when aggregate build fails? The server MUST NOT start; the error from the build process is surfaced.
- What happens when the specified port is already in use? Standard server error handling applies (same as `dashboard` command today).
- What happens when `--serve` is used but database has no data? Aggregates build succeeds (possibly with empty/minimal output), then server starts normally.
- What happens when user presses Ctrl+C during server? Server shuts down gracefully (same as `dashboard` command today).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `build-aggregates` command MUST accept a new `--serve` flag that, when provided, starts the dashboard server after successful aggregate generation.
- **FR-002**: The `build-aggregates` command MUST accept `--open` flag (only valid with `--serve`) that automatically opens the default browser to the dashboard URL.
- **FR-003**: The `build-aggregates` command MUST accept `--port` option (only valid with `--serve`) that specifies the server port, defaulting to 8080.
- **FR-004**: When `--open` or `--port` are provided without `--serve`, the command MUST fail with a clear error message before any processing begins.
- **FR-005**: The server functionality MUST reuse the existing dashboard server implementation with no code duplication.
- **FR-006**: When `--serve` is provided and aggregate build fails, the server MUST NOT start and the command MUST exit with a non-zero status code.
- **FR-007**: Without `--serve`, the `build-aggregates` command MUST behave exactly as it does today (backward compatible).
- **FR-008**: The existing `dashboard` command MUST remain unchanged and fully functional.

### Constraints

- **C-001**: No duplication of server code between `build-aggregates --serve` and `dashboard` command.
- **C-002**: The `--serve` functionality MUST only execute after successful completion of aggregate building.
- **C-003**: Error messages for invalid flag combinations MUST be actionable and reference the correct flag dependencies.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can launch the dashboard with a single command, reducing the local workflow from 2 commands to 1.
- **SC-002**: 100% of existing `build-aggregates` and `dashboard` command invocations continue to work without modification (backward compatibility).
- **SC-003**: Invalid flag combinations (`--open` or `--port` without `--serve`) are rejected with clear error messages before any processing begins.
- **SC-004**: The combined workflow completes within the same total time as running the two commands separately (no performance regression).

## Assumptions

- The existing `dashboard` command's server implementation can be invoked programmatically from within the `build-aggregates` command flow.
- The default port (8080) is consistent between `dashboard` command and `build-aggregates --serve`.
- Browser auto-open behavior follows the same logic as the existing `dashboard --open` implementation.
