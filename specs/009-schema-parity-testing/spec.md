# Feature Specification: Schema Parity Testing & Test Coverage

**Feature Branch**: `009-schema-parity-testing`
**Created**: 2026-01-28
**Status**: Draft
**Input**: User description: "Schema parity tests ensuring dashboard renders identically across extension, local prod, and local dev modes, plus TypeScript test coverage increase to 70%"

## Clarifications

### Session 2026-01-28

- Q: Should unknown fields in JSON artifacts cause validation to fail (strict mode) or be silently allowed (permissive mode)? → A: Per-file rules: Strict for manifest/dimensions, permissive for rollup/predictions
- Q: When should runtime validation execute (performance concern for large rollups)? → A: Validate-once-and-cache: Validate first load per session, cache result
- Q: How should coverage thresholds be structured for DOM-heavy codebase? → A: Tiered by path: 80% for logic modules, 50% for UI/DOM modules, ratchet UI upward over time
- Q: How should the VSS SDK mock surface area be constrained? → A: Enumerated allowlist: Document exact functions used, mock only those in single shared harness
- Q: How should test skips be governed in CI? → A: Zero skips with tagged exceptions: No skips allowed unless tagged with SKIP_REASON, CI reports all skips
- Q: Should modules/index.ts (barrel export) be included in coverage thresholds? → A: Exclude from thresholds entirely (no testable logic)
- Q: Should "70%" references be updated to "tiered thresholds" for consistency? → A: Yes, update all references to "tiered thresholds (80% logic, 50% UI/DOM)"
- Q: How should schema validation handle an empty JSON object `{}`? → A: Fail validation with "missing required field" error
- Q: How should nested objects with partial schema compliance be handled? → A: Validate recursively, fail on any nested violation
- Q: Should SC-003's "within 1 second" timing requirement be kept? → A: Remove timing requirement (correctness over speed; validate-once-and-cache already addresses performance)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Validate Data Consistency Across Modes (Priority: P1)

As a developer, I want to ensure that the JSON data loaded in extension mode has the same structure as the JSON data loaded in local mode, so that the dashboard renders identically regardless of where it runs.

**Why this priority**: This is the foundational requirement. Without schema parity, all other testing is unreliable because test fixtures may not match production data structures, leading to false positives or missed bugs.

**Independent Test**: Can be fully tested by creating schema definitions and validating fixture files against them. Delivers confidence that test data matches production data structure.

**Acceptance Scenarios**:

1. **Given** a dataset-manifest.json file from local fixtures, **When** the schema validator runs, **Then** the file validates successfully against the shared schema definition
2. **Given** a weekly rollup JSON file from local fixtures, **When** the schema validator runs, **Then** the file validates successfully against the rollup schema
3. **Given** a dimensions.json file from local fixtures, **When** the schema validator runs, **Then** the file validates successfully against the dimensions schema
4. **Given** a predictions.json file from local fixtures, **When** the schema validator runs, **Then** the file validates successfully against the predictions schema
5. **Given** an invalid JSON file that doesn't match the schema, **When** the schema validator runs, **Then** the validation fails with a clear error message describing the schema violation
6. **Given** captured extension-mode artifacts and local fixtures, **When** both are loaded and validated, **Then** both pass the same schema and produce identical normalized in-memory shapes for rendering

---

### User Story 2 - Runtime Data Validation in DatasetLoader (Priority: P2)

As a dashboard user, I want the DatasetLoader to validate incoming data against the schema at runtime, so that corrupted or malformed data is caught early with helpful error messages rather than causing cryptic rendering failures.

**Why this priority**: Builds on P1's schema definitions to provide runtime protection. Important for production reliability but requires P1's schemas to exist first.

**Independent Test**: Can be tested by passing valid and invalid JSON to the DatasetLoader and verifying it accepts valid data and rejects invalid data with appropriate errors.

**Acceptance Scenarios**:

1. **Given** the DatasetLoader receives valid JSON matching the schema, **When** it processes the data, **Then** the data loads successfully and is available for rendering
2. **Given** the DatasetLoader receives JSON with missing required fields, **When** it processes the data, **Then** it rejects the data with an error message indicating which fields are missing
3. **Given** the DatasetLoader receives JSON with incorrect field types, **When** it processes the data, **Then** it rejects the data with an error message indicating the type mismatch

---

### User Story 3 - Comprehensive DOM Test Coverage (Priority: P3)

As a developer, I want comprehensive test coverage for DOM-dependent modules, so that rendering logic is verified automatically and regressions are caught before deployment.

**Why this priority**: Depends on P1 (schema parity) to ensure test fixtures are valid. Once fixtures are reliable, coverage can be expanded with confidence.

**Independent Test**: Can be tested by running the test suite and verifying coverage metrics meet tiered thresholds (80% for logic modules, 50% for UI/DOM modules) across statements, branches, functions, and lines.

**Acceptance Scenarios**:

1. **Given** the test suite runs on logic modules, **When** coverage is measured, **Then** all metrics (statements, branches, functions, lines) exceed 80%
2. **Given** the test suite runs on UI/DOM modules, **When** coverage is measured, **Then** all metrics exceed 50%
3. **Given** the coverage configuration, **When** reviewed, **Then** a documented ratchet-up plan exists for UI modules to incrementally increase thresholds
5. **Given** a DOM-dependent module like dashboard.ts, **When** its tests run, **Then** key rendering paths are exercised with mocked DOM and SDK

---

### User Story 4 - CI Schema Validation Gate (Priority: P4)

As a team lead, I want CI to fail if schema validation fails, so that schema drift is caught automatically before merging to main.

**Why this priority**: Quality gate that depends on P1 and P2 being implemented. Prevents regressions once the foundation is in place.

**Independent Test**: Can be tested by introducing a schema violation in a test branch and verifying the CI pipeline fails.

**Acceptance Scenarios**:

1. **Given** all JSON fixtures match their schemas, **When** the CI pipeline runs, **Then** the schema validation step passes
2. **Given** a JSON fixture has a schema violation, **When** the CI pipeline runs, **Then** the schema validation step fails and blocks merge
3. **Given** coverage drops below tiered thresholds (80% logic, 50% UI/DOM), **When** the CI pipeline runs, **Then** the coverage check fails and blocks merge

---

### Edge Cases

- What happens when a JSON file is valid JSON but completely empty? → Resolved: Fail validation with "missing required field" error (empty object lacks required fields like manifest_schema_version or week)
- How does the system handle extra fields in the JSON that aren't in the schema? → Resolved: Per-file strictness (manifest/dimensions=strict, rollup/predictions=permissive with warnings)
- What happens when the predictions.json file is missing? → Resolved: File optional at schema/type level; downstream types use `predictions?: ...`; tests cover both present and absent cases
- How does the system handle nested objects with partial schema compliance? → Resolved: Validate recursively, fail on any nested violation (e.g., missing `week` in `aggregate_index.weekly_rollups[0]` fails validation)
- What happens when local fixtures exist but ADO artifacts are unavailable during development?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST define shared schema definitions for dataset-manifest.json, rollup JSON, dimensions.json, and predictions.json
- **FR-002**: System MUST validate local fixture files against schema definitions during test execution
- **FR-003**: DatasetLoader MUST validate incoming JSON data against schemas at runtime using validate-once-and-cache strategy (validate on first load per session, skip validation for subsequent loads of cached data)
- **FR-004**: DatasetLoader MUST provide clear, actionable error messages when schema validation fails
- **FR-005**: CI pipeline MUST include a schema validation step that fails the build on schema violations
- **FR-006**: Test suite MUST achieve tiered coverage thresholds: 80% (statements, branches, functions, lines) for logic modules; 50% for UI/DOM modules (dashboard.ts, settings.ts, comparison.ts, errors.ts) with documented ratchet-up plan; barrel exports (modules/index.ts) excluded from thresholds
- **FR-007**: System MUST provide a single shared DOM test harness for testing modules that manipulate the DOM; per-test bespoke mocks are prohibited
- **FR-008**: System MUST provide mock implementations of VSS SDK via enumerated allowlist: document exact SDK functions used in codebase, mock only those functions in single shared harness, require explicit approval to add new mocked functions
- **FR-009**: Predictions.json MUST be defined as optional at schema and type level: file may be absent, but if present MUST validate; downstream types MUST represent as optional (`predictions?: ...`); tests MUST cover both present and absent cases
- **FR-010**: Schema validation errors MUST identify the specific field and expected vs. actual type
- **FR-011**: Schema validation MUST enforce per-file strictness: dataset-manifest.json and dimensions.json reject unknown fields; rollup JSON and predictions.json allow unknown fields but log warnings
- **FR-012**: Test suite MUST enforce skip tagging: any skipped test requires explicit `SKIP_REASON` tag; CI MUST report all skipped tests with their reasons in build output
- **FR-013**: Test suite MUST include cross-source parity test: load both captured extension-mode artifacts and local fixtures, validate both against same schemas, assert both produce identical normalized in-memory shapes used by rendering

### Key Entities

- **Schema Definition**: A formal structure definition for each JSON artifact type, specifying required fields, field types, and nested object structures
- **JSON Artifact**: Data files (dataset-manifest.json, rollup JSON, dimensions.json, predictions.json) loaded by the dashboard
- **DatasetLoader**: Component responsible for loading and parsing JSON artifacts, now enhanced with validation
- **DOM Test Harness**: Single shared reusable test infrastructure for setting up JSDOM environment; bespoke per-test mocks prohibited
- **VSS SDK Mock Allowlist**: Enumerated list of exact VSS SDK functions used in codebase; only these functions are mocked in the shared harness; additions require explicit approval. **Allowlist**: `VSS.init()`, `VSS.ready()`, `VSS.notifyLoadSucceeded()`, `VSS.getWebContext()`, `VSS.getService(ServiceIds.ExtensionData)`, `VSS.require(["TFS/Build/RestClient"])`

## Assumptions

- The existing TypeScript interfaces in the codebase accurately reflect the expected JSON structure and can inform schema definitions
- JSDOM is an acceptable DOM simulation for testing purposes
- The VSS SDK methods used are mockable without significant architectural changes
- Local fixtures currently exist and can serve as the baseline for schema validation
- Schema strictness is per-file: dataset-manifest.json and dimensions.json use strict validation (unknown fields fail); rollup JSON and predictions.json use permissive validation (unknown fields allowed with logged warnings) to support forward compatibility

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All four JSON artifact types (dataset-manifest, rollup, dimensions, predictions) have schema definitions that can be used for validation
- **SC-002**: 100% of local fixture files pass schema validation
- **SC-003**: DatasetLoader rejects invalid JSON with error messages that identify the specific validation failure
- **SC-004**: Test coverage metrics meet tiered thresholds: logic modules exceed 80% (statements, branches, functions, lines); UI/DOM modules exceed 50% with ratchet baseline documented for future increases
- **SC-005**: CI pipeline blocks merges when schema validation or coverage thresholds fail
- **SC-006**: DOM test utilities enable testing of previously untested modules (dashboard.ts, settings.ts, comparison.ts, errors.ts)
- **SC-007**: No untagged test skips exist in CI; any skip MUST have explicit `SKIP_REASON` tag; CI reports all skipped tests with reasons
