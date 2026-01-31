# Feature Specification: Security Hardening - Zip Slip Protection & Token Encoding

**Feature Branch**: `017-security-fixes`
**Created**: 2026-01-30
**Status**: Draft
**Input**: User description: "Harden ZIP extraction against Zip Slip and URL-encode Azure DevOps continuation tokens"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Safe Artifact Extraction (Priority: P1)

As a system administrator, I need the artifact extraction process to be protected against malicious ZIP files that attempt to write files outside the designated extraction directory (Zip Slip attack), so that the system remains secure even when processing untrusted artifacts.

**Why this priority**: Security vulnerability - Zip Slip attacks can lead to arbitrary file overwrites, potentially compromising the entire system. This is the highest priority security fix.

**Independent Test**: Can be fully tested by providing a ZIP file containing path traversal entries (e.g., `../../../etc/malicious.txt`) and verifying the system rejects extraction with a clear error message.

**Acceptance Scenarios**:

1. **Given** a ZIP file with all entries contained within the extraction directory, **When** the system extracts the artifact, **Then** all files are extracted successfully to the designated output directory
2. **Given** a ZIP file containing a path traversal entry (e.g., `../../malicious.txt`), **When** the system attempts to extract the artifact, **Then** extraction is aborted and a clear error message indicates the security violation
3. **Given** a ZIP file containing an entry with an absolute path (e.g., `/etc/passwd`), **When** the system attempts to extract the artifact, **Then** extraction is aborted and a clear error message indicates the security violation

---

### User Story 2 - Reliable Pagination with Special Characters (Priority: P2)

As a data analyst, I need the system to reliably paginate through all Azure DevOps API results even when continuation tokens contain special characters, so that I receive complete datasets without missing records.

**Why this priority**: Data reliability - Improperly encoded tokens can cause pagination failures, resulting in incomplete data retrieval. This affects data integrity but is less severe than the security vulnerability.

**Independent Test**: Can be fully tested by simulating API responses with continuation tokens containing special characters (spaces, plus signs, ampersands, equals signs) and verifying all pages are retrieved successfully.

**Acceptance Scenarios**:

1. **Given** an API response with a continuation token containing special characters (e.g., spaces, `+`, `&`, `=`), **When** the system makes the next paginated request, **Then** the token is properly encoded in the query string and the request succeeds
2. **Given** a multi-page dataset spanning multiple API calls, **When** the system retrieves all pages, **Then** all records are returned without duplicates or omissions
3. **Given** a continuation token that would break URL parsing if not encoded (e.g., containing `&foo=bar`), **When** the system appends it to the request URL, **Then** the token is treated as a single parameter value, not as multiple parameters

---

### Edge Cases

- What happens when a ZIP contains a symlink entry?
  - If symlink is detectable via Unix mode bits (`external_attr`), the system rejects the ZIP before extraction; if symlink metadata is missing/ambiguous, the entry is treated as a regular file and path containment validation applies
- What happens when a ZIP entry has a valid relative path but resolves outside the output directory due to traversal sequences?
  - The system validates the final resolved (canonical) path in the temp directory and rejects entries that escape containment
- What happens when extraction is aborted due to a malicious entry?
  - No files are written to the final output directory; extraction uses a temp directory that is discarded on failure
- What happens when the temp→final rename fails (Windows file locks, permissions)?
  - The backup (if created) is restored to `out_dir`; the temp directory is discarded; a clear error is raised identifying the failure reason
- What happens when a continuation token is empty or null?
  - The system treats this as the final page and does not append a continuation token parameter
- What happens when a continuation token is already URL-encoded or embedded in a URL?
  - Implementation must audit all token sources first; if all are raw, enforce rejection of pre-encoded tokens; if pre-encoded usage exists, document and either refactor callers or add narrow compatibility path

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST scan all ZIP entries before extraction begins and reject any entry that is definitively a symlink via Unix mode bits in `ZipInfo.external_attr`; entries with ambiguous or missing metadata are treated as regular files and validated via path containment
- **FR-002**: System MUST extract into a newly created empty temporary directory under the same parent as the output directory
- **FR-003**: System MUST validate every non-symlink ZIP entry's target path by resolving it to a canonical absolute path and confirming it remains within the temporary extraction directory
- **FR-004**: System MUST reject entries with absolute paths or path traversal sequences (`..`) even if they appear to normalize safely
- **FR-005**: System MUST abort ZIP extraction immediately upon detecting any entry that would extract outside the temporary directory, with no files written to the final output directory
- **FR-006**: System MUST use backup-then-swap to finalize extraction: if `out_dir` exists, rename it to `out_dir.bak.<timestamp>` (same filesystem), then rename temp directory to `out_dir`; delete backup only after successful rename; if rename fails, restore backup and fail with clear error
- **FR-007**: System MUST provide a clear, actionable error message when aborting extraction, identifying the offending entry
- **FR-008**: System MUST centralize continuation token handling in a single helper function used by all paginated endpoints (PRs, teams, team members, PR threads)
- **FR-009**: System MUST URL-encode continuation tokens exactly once at the point where the query string is constructed
- **FR-010**: System MUST audit all token sources during implementation to confirm they originate as raw ADO response values; if confirmed, enforce hard rule (reject pre-encoded tokens); if pre-encoded usage found, document and decide on refactoring callers or narrow compatibility path
- **FR-011**: System MUST use standard URL encoding that handles spaces, plus signs, ampersands, equals signs, and other special characters
- **FR-012**: System MUST continue to paginate correctly when continuation tokens contain no special characters (no regression)
- **FR-015**: CI MUST include a guard step that fails if `continuationToken` literal appears outside allowlisted paths (helper module, its unit test, test fixtures)
- **FR-013**: System MUST preserve existing extraction behavior for valid ZIP files with no path traversal attempts or symlinks
- **FR-014**: System MUST preserve existing pagination behavior and data shape for API responses

### Key Entities

- **ZIP Entry**: A file or directory path within a ZIP archive; key attributes include the entry name (path) and whether it resolves to a safe location within the output directory
- **Continuation Token**: An opaque string returned by Azure DevOps APIs indicating the position for the next page of results; must be treated as untrusted data requiring encoding
- **Output Directory**: The designated safe extraction location; all extracted content must remain within this boundary

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of ZIP extraction attempts with path traversal entries are blocked with appropriate error messages and no files written to output directory
- **SC-002**: 100% of ZIP extraction attempts containing symlink entries are blocked before any extraction occurs
- **SC-003**: 100% of valid ZIP files (no symlinks, no traversal) extract successfully without behavioral changes
- **SC-004**: Pagination completes successfully for all API endpoints regardless of special characters in continuation tokens
- **SC-005**: No data loss or duplication occurs during paginated API calls with encoded tokens
- **SC-006**: Zero security vulnerabilities related to ZIP extraction or URL parameter injection after implementation
- **SC-007**: Regression tests exist for: (1) ZIP with symlink entry, (2) ZIP with traversal/absolute path entry - both confirming no files written outside extraction boundary
- **SC-008**: Regression test exists for continuation token containing `&foo=bar` (or similar special characters) confirming it is treated as a single parameter value and pagination succeeds
- **SC-009**: CI guard prevents `continuationToken` usage outside allowlisted helper module paths

## Clarifications

### Session 2026-01-30

- Q: How should symlinks be handled during ZIP extraction? → A: Option D - Reject symlinks AND extract into fresh empty temp directory with atomic move on success. Symlink entries detected via ZipInfo metadata must abort before any extraction. Non-symlink entries still require canonical-path containment validation. Two regression tests required: one for symlink entry (must fail before extraction), one for traversal/absolute paths (must fail with offending entry named).
- Q: How should continuation token encoding handle already-encoded tokens? → A: Option A - Encode exactly once at query string boundary. Centralize in a single helper used by all paginated endpoints. Only raw tokens from ADO response headers/body accepted; pre-encoded URLs rejected. Regression test required for token containing `&foo=bar` to confirm single-parameter treatment.
- Q: How should symlink detection handle unreliable/missing metadata across platforms? → A: Option B - Use Unix mode-bit detection (`(external_attr >> 16) & 0o170000 == 0o120000`) to reject definitive symlinks; treat ambiguous/no-metadata entries as regular files and rely on canonical-path containment check for safety. Regression test must include ZIP with preserved symlink mode bits.
- Q: How should existing output directory be handled during atomic move? → A: Option C - Backup-then-swap: if `out_dir` exists, rename to `out_dir.bak.<timestamp>` (same filesystem), then rename temp to `out_dir`; delete backup only after successful rename. If temp→final rename fails, restore backup to `out_dir` and fail with clear error. Prevents "empty or missing out_dir" state on failure.
- Q: How to enforce all call sites use the centralized token helper? → A: Option B - CI guard step using `rg`/`grep` to fail if `continuationToken` appears outside allowlisted paths (helper module + its unit test + test fixtures); pair with code review checklist line: "Pagination must use token helper; do not concatenate continuationToken into URLs."
- Q: How to handle pre-encoded tokens without breaking existing flows? → A: Option B - Audit first: trace every token source during implementation to confirm they originate only as raw ADO response values. If confirmed, enforce hard rule (reject pre-encoded). If pre-encoded usage found, document explicitly and decide: refactor caller to pass raw tokens, or adapt helper with narrowly scoped compatibility path. Keep change deterministic and reviewable.

## Assumptions

- The system uses a standard ZIP library that provides access to entry names and `external_attr` metadata before extraction; symlink detection relies on Unix mode bits which may not be preserved by all ZIP creators
- The Azure DevOps API accepts standard URL-encoded continuation tokens (encoded exactly once)
- The existing codebase has identifiable locations where `extractall()` is called and where continuation tokens are appended to URLs
- All paginated endpoints (PRs, teams, team members, PR threads) can be refactored to use a centralized token helper
- Token source audit during implementation will determine whether pre-encoded token handling is needed
