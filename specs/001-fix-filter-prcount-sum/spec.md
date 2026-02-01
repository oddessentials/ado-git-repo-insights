# Feature Specification: Fix Dashboard Filter PR Count Summation Bug

**Feature Branch**: `001-fix-filter-prcount-sum`
**Created**: 2026-01-31
**Status**: Draft
**Input**: User description: "Fix dashboard filter PR count object concatenation bug - when selecting repository/team filters, Total PRs displays '0[object Object]0[object Object]...' instead of numeric sum"

## Clarifications

### Session 2026-01-31

- Q: What is the exact fix surface area? → A: Confined to `extension/ui/modules/metrics.ts::applyFiltersToRollups()` and any direct helpers it calls. No changes to schemas or rollup structures.
- Q: How should defensive coercion be implemented? → A: Single canonical helper `toFiniteNumber(value): number` using rule `Number(value)` then `Number.isFinite(n) ? n : 0`. Reuse everywhere, no ad-hoc coercion.
- Q: Runtime guards vs type-level enforcement? → A: Require type-level enforcement. Update TypeScript types so `by_repository`/`by_team` map values are `BreakdownEntry | undefined`, remove any code paths allowing `number` to type-check. Compiler must fail if number assumptions reintroduced.
- Q: How should regression test be structured? → A: Separate test that intentionally feeds objects into reducer, asserts output is finite number and does not include `"[object Object]"`. Keep isolated from "correct sum" tests to prevent dilution by fixture changes.
- Q: How to verify demo rebuild? → A: Add check that `docs/dashboard.js` content differs after fix, plus smoke test loading demo with filters asserting Total PRs parses to finite number.
- Q: What files are in scope beyond metrics.ts? → A: Tests (`extension/tests/**`), demo bundle output (`docs/dashboard.js`), and the `toFiniteNumber()` helper (same file as `applyFiltersToRollups()` in `metrics.ts`).
- Q: Where should toFiniteNumber() be defined? → A: In the same file: `extension/ui/modules/metrics.ts`. Only this helper may be added outside `applyFiltersToRollups()` itself.
- Q: How to verify demo bundle changed? → A: `git diff` shows `docs/dashboard.js` updated (content differs from baseline). No hash checks.
- Q: How to handle formatted numbers in smoke test? → A: DOM text parses to finite number after stripping commas/whitespace, and does not contain `[` or `object`.
- Q: What is minimum BreakdownEntry shape for test fixtures? → A: `{ pr_count: number }` minimum; additional fields allowed but not required.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Repository Filter Shows Correct PR Totals (Priority: P1)

A dashboard user selects a repository from the filter dropdown to view metrics for just that repository. The "Total PRs" summary card displays the correct numeric sum of PR counts for the selected repository, not corrupted string output.

**Why this priority**: This is the core bug being fixed. Without this, the dashboard is unusable when filters are applied - the primary metric display shows garbage data that misleads users and breaks trust in the tool.

**Independent Test**: Can be fully tested by selecting any repository filter and verifying the Total PRs card shows a valid number. Delivers immediate value by restoring basic filter functionality.

**Acceptance Scenarios**:

1. **Given** a dashboard with rollup data containing `by_repository` breakdown objects, **When** user selects a single repository filter, **Then** Total PRs displays the numeric `pr_count` value for that repository
2. **Given** a dashboard with multiple repositories in breakdown data, **When** user selects multiple repository filters, **Then** Total PRs displays the sum of all selected repositories' `pr_count` values
3. **Given** a dashboard with repository filter active, **When** the selected repository has `pr_count: 0`, **Then** Total PRs displays "0" (not empty or corrupted)

---

### User Story 2 - Team Filter Shows Correct PR Totals (Priority: P1)

A dashboard user selects a team from the filter dropdown to view metrics for just that team. The "Total PRs" summary card displays the correct numeric sum of PR counts for the selected team.

**Why this priority**: Same severity as repository filtering - both filter types are equally broken and equally critical for dashboard usability.

**Independent Test**: Can be fully tested by selecting any team filter and verifying the Total PRs card shows a valid number.

**Acceptance Scenarios**:

1. **Given** a dashboard with rollup data containing `by_team` breakdown objects, **When** user selects a single team filter, **Then** Total PRs displays the numeric `pr_count` value for that team
2. **Given** a dashboard with multiple teams in breakdown data, **When** user selects multiple team filters, **Then** Total PRs displays the sum of all selected teams' `pr_count` values

---

### User Story 3 - Malformed Data Does Not Corrupt Display (Priority: P2)

When the dashboard receives unexpected or malformed breakdown data (missing `pr_count`, non-numeric values, null entries), the Total PRs display gracefully handles the situation without showing string concatenation artifacts like `[object Object]`.

**Why this priority**: Defensive programming prevents future regressions and handles edge cases where data may drift from expected schema.

**Independent Test**: Can be tested by providing rollup fixtures with missing/null/non-numeric `pr_count` values and verifying display remains numeric.

**Acceptance Scenarios**:

1. **Given** breakdown entry with missing `pr_count` property, **When** filter is applied, **Then** Total PRs treats that entry as 0 and displays valid numeric result
2. **Given** breakdown entry with `pr_count: null`, **When** filter is applied, **Then** Total PRs treats that entry as 0
3. **Given** breakdown entry with non-numeric `pr_count`, **When** filter is applied, **Then** Total PRs treats that entry as 0 (no string concatenation)

---

### User Story 4 - Demo Dashboard Reflects Production Fix (Priority: P2)

After the source fix is applied and tests pass, the demo dashboard bundle deployed to GitHub Pages reflects the same corrected behavior.

**Why this priority**: Users evaluating the tool via the demo site must see correct behavior, not the bug.

**Independent Test**: Can be tested by rebuilding the bundle and verifying repo/team filter behavior on the demo site via automated smoke test.

**Acceptance Scenarios**:

1. **Given** the fix is merged and tests pass, **When** the demo bundle is rebuilt, **Then** selecting a repository filter on the demo dashboard shows numeric Total PRs
2. **Given** the rebuilt demo bundle, **When** selecting a team filter, **Then** Total PRs displays a valid number
3. **Given** a smoke test loads the demo with filters applied, **When** Total PRs DOM text is inspected, **Then** it parses to a finite number (after stripping commas/whitespace) and does not contain `[` or `object`

---

### Edge Cases

- What happens when `by_repository` or `by_team` is empty object `{}`? → Display 0 PRs
- What happens when selected filter matches no keys in breakdown? → Display 0 PRs (existing behavior)
- What happens when breakdown entry is the object itself (not just `pr_count`)? → Extract `pr_count` property via `toFiniteNumber()`, never sum the object
- What happens when `pr_count` is a string like `"50"`? → `toFiniteNumber()` coerces safely to 50
- What happens when `pr_count` is `NaN` or `Infinity`? → `toFiniteNumber()` returns 0

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Production fix MUST be confined to `extension/ui/modules/metrics.ts`. The only changes permitted are within `applyFiltersToRollups()` and the addition of a `toFiniteNumber()` helper in the same file. No changes to schemas or rollup structures.
- **FR-002**: System MUST treat `by_repository` values as `BreakdownEntry` objects containing a `pr_count` property, not as primitive numbers
- **FR-003**: System MUST treat `by_team` values as `BreakdownEntry` objects containing a `pr_count` property, not as primitive numbers
- **FR-004**: System MUST extract `.pr_count` from each breakdown entry before summation using the canonical `toFiniteNumber()` helper
- **FR-005**: System MUST implement `toFiniteNumber(value): number` in `extension/ui/modules/metrics.ts` with rule: `const n = Number(value); return Number.isFinite(n) ? n : 0`. All summations MUST use this helper. This is the only helper that may be added outside `applyFiltersToRollups()`.
- **FR-006**: TypeScript types MUST enforce `by_repository` and `by_team` map values as `BreakdownEntry | undefined`. Code paths allowing `number` to type-check MUST be removed. Compiler MUST fail if number assumptions are reintroduced.
- **FR-007**: Unit test fixtures in `extension/tests/**` MUST use `BreakdownEntry` objects with minimum shape `{ pr_count: number }`. Additional fields are allowed but not required.
- **FR-008**: System MUST include a dedicated regression test in `extension/tests/**` that intentionally feeds objects into the reducer and asserts output is a finite number and does not include `"[object Object]"`. This test MUST be separate from "correct sum" tests.
- **FR-009**: Demo bundle (`docs/dashboard.js`) MUST be rebuilt after the fix
- **FR-010**: Verification MUST confirm `git diff` shows `docs/dashboard.js` content differs from baseline after applying the fix
- **FR-011**: Smoke test MUST load the demo with filters and assert Total PRs DOM text parses to a finite number (after stripping commas/whitespace) and does not contain `[` or `object`

### Key Entities

- **Rollup**: Weekly metrics aggregate containing PR count, cycle time percentiles, and optional per-repository/per-team breakdowns
- **BreakdownEntry**: Per-repository or per-team metrics slice. Minimum shape for test fixtures: `{ pr_count: number }`. Additional fields allowed.
- **Filter State**: User-selected repository and team filters that determine which breakdown entries to aggregate
- **toFiniteNumber()**: Canonical coercion helper in `extension/ui/modules/metrics.ts` ensuring all numeric conversions follow the same safe rule

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Selecting any repository filter displays a numeric Total PRs value (no object string representation in output)
- **SC-002**: Selecting any team filter displays a numeric Total PRs value (no object string representation in output)
- **SC-003**: All existing unit tests pass after fixture correction to use proper `BreakdownEntry` schema (minimum `{ pr_count: number }`)
- **SC-004**: Dedicated regression test passes: feeds objects into reducer, asserts finite number output, asserts no `"[object Object]"` substring
- **SC-005**: TypeScript compilation fails if any code path treats `by_repository`/`by_team` values as `number` instead of `BreakdownEntry`
- **SC-006**: `git diff` shows `docs/dashboard.js` content differs from baseline after source fix is applied
- **SC-007**: Demo smoke test with repo/team filters shows Total PRs that parses to finite number (after stripping commas/whitespace) and contains no `[` or `object`
- **SC-008**: Defensive fallback handles malformed data without producing string concatenation (100% of edge cases return finite numbers via `toFiniteNumber()`)

## Constraints

- **Surface Area Constraint**: Production code changes MUST be limited to `extension/ui/modules/metrics.ts`. Test changes are permitted in `extension/tests/**`. Demo bundle output `docs/dashboard.js` will change as a build artifact. No schema or rollup structure modifications.
- **Helper Location Constraint**: `toFiniteNumber()` MUST be defined in `extension/ui/modules/metrics.ts`. No other new helpers or files may be added.
- **Type Safety Constraint**: Type-level enforcement is required, not just runtime guards. The compiler must catch regressions.
- **Test Isolation Constraint**: Regression test for historical failure mode MUST remain separate from functional correctness tests to prevent dilution
- **Test Fixture Constraint**: `BreakdownEntry` fixtures require minimum shape `{ pr_count: number }`; additional fields are optional

## Assumptions

- The `BreakdownEntry` interface defined in `extension/ui/schemas/rollup.schema.ts` is the authoritative schema for `by_repository` and `by_team` values
- The existing integration test that correctly accesses `.pr_count` represents the intended behavior
- The production code diverged from the schema during initial implementation and was never caught due to incorrect test fixtures
- Rebuilding the demo bundle is a standard part of the release process and can be done via existing build scripts
- This is intended to be a one-commit fix with strong regression coverage
