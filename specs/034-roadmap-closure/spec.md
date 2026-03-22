# Feature Specification: Roadmap Closure Program

**Feature Branch**: `034-roadmap-closure`
**Created**: 2026-03-21
**Status**: Draft
**Input**: User request to create an enterprise-grade specification for `TODO/ROADMAP.md` that defines the remaining roadmap work, research tracks, test plans, implementation sequencing, and closure criteria.

## Summary

This specification defines the final delivery program required to close `TODO/ROADMAP.md` based on the current repository state as of 2026-03-21.

What is already true:
- Reviewer Phase 1 is implemented across backend, schema, UI, and tests.
- Cross-dimensional team x repo accuracy is implemented.
- Comment extraction backend and coverage metadata exist.
- The roadmap still contains four remaining delivery areas, but one of them is now only follow-through work, not a full feature build.

What remains to close the roadmap:
- implement author filtering end to end,
- add exact author x repository cross-dimensional filtering once author slices exist,
- complete comment exports, aggregates, dashboard presentation, and documentation,
- finish reviewer follow-through by resolving unsupported combined semantics and documenting the Phase 2 latency boundary,
- update roadmap artifacts so they reflect shipped work and close with explicit evidence rather than aspirational TODOs.

This spec treats roadmap closure as a single coordinated program with independently shippable slices.

## Non-Negotiable Decisions

The following decisions are locked by this specification and are not deferred to later planning:

- Existing PowerBI-facing CSVs remain the core contract surface. Author and comments work MUST NOT mutate column names, column order, or required headers in existing core CSVs.
- New comment CSVs, if emitted, are auxiliary exports rather than part of the existing PowerBI compatibility boundary unless a future separately-versioned contract change explicitly promotes them.
- Author identity is keyed by immutable Azure DevOps `user_id` from persisted PR data. Display names are labels only.
- Author filter UX for this roadmap program is a searchable single-select control. Multi-select author filtering is out of scope.
- Author + team combinations use `constrained` mode with author as the dominant applied dimension. If both are selected, metrics resolve as author-only and the UI must signal that team filtering is not being combined.
- New cross-dimensional slices must remain additive and bounded. No unbounded cartesian expansion is allowed.
- Author x repository truncation uses this exact retained-entry order: `pr_count DESC`, then `author_id ASC`, then `repository_name ASC`.
- Reviewer combined-filter behavior must use one of three explicit modes only: `exact`, `constrained`, or `disallowed-with-ux-signal`. Proportional fallback is forbidden for reviewer combinations in this roadmap program.
- Reviewer + repository is locked to `constrained`. Reviewer + team is locked to `disallowed-with-ux-signal`.
- Legacy dataset compatibility must be handled through explicit capability/version detection at the loader boundary, not through ad hoc downstream conditional logic.
- Loader capability detection uses manifest capability flags first, schema-version support second, and safe defaults only when both are absent.
- Auxiliary comments CSVs must be emitted only under `csv-output/auxiliary/comments/` as `pr_threads.csv` and `pr_comments.csv`.
- Roadmap closure evidence must be produced in a repeatable artifact format that can be reviewed and re-run.
- Checked-in roadmap closure evidence must live under `specs/034-roadmap-closure/evidence/` using the filename pattern `NNN-<roadmap-item>-evidence.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Filter by PR Author (Priority: P1)

A dashboard user can filter weekly metrics by PR author using the same quality bar currently applied to repository, team, and reviewer filters.

**Why this priority**: Author filtering is the highest-value unfinished user-facing capability, it reuses existing team-slice patterns, and it unlocks exact author x repository filtering.

**Independent Test**: Generate weekly rollups with `by_author`, load them in the extension, select a single author, and verify backend and UI metrics match the authored PR subset without affecting existing repository/team/reviewer behavior.

**Acceptance Scenarios**:

1. **Given** rollups contain authored PRs for multiple users, **When** aggregates are generated, **Then** each weekly rollup includes a `by_author` breakdown keyed by stable author identity with display-safe labels.
2. **Given** dimensions data includes users, **When** the dashboard loads, **Then** an author filter is shown only when author slices are available and selecting an author updates charts and summary metrics correctly.
3. **Given** legacy datasets do not contain author slices, **When** the extension loads them, **Then** the author filter remains hidden and existing views continue to work without schema errors.

---

### User Story 2 - Exact Author x Repository Filtering (Priority: P1)

A dashboard user who selects both an author and a repository gets exact intersection metrics rather than proportional estimates.

**Why this priority**: Feature 029 already established the exact cross-dimensional pattern for team x repository. Finishing the author analogue closes the only intentionally deferred cross-dimensional work still called out in the roadmap.

**Independent Test**: Generate rollups with `by_author` and `by_author_and_repo`, select an author plus repository, and verify the extension resolves the exact nested slice and exposes the correct exact-versus-estimated behavior.

**Acceptance Scenarios**:

1. **Given** rollups include `by_author_and_repo`, **When** a user selects one author and one repository, **Then** the dashboard uses the exact nested breakdown instead of the proportional fallback path.
2. **Given** an author has PRs in several repositories, **When** the nested slices are summed across repositories for that author, **Then** the total equals that author’s `by_author.pr_count` for the same week.
3. **Given** a legacy dataset lacks `by_author_and_repo`, **When** an author and repository are selected, **Then** the extension preserves backward compatibility by using the current fallback behavior and exposing the non-exact state consistently.

---

### User Story 3 - Complete Comments Pipeline With User Value (Priority: P1)

A user who enables comment extraction can export, validate, and view comment analytics through supported CSV, JSON, CLI, and dashboard surfaces.

**Why this priority**: The repository already incurs the extraction/storage complexity for comments, but the feature remains effectively invisible to users until exports, aggregates, UI, and documentation are finished.

**Independent Test**: Run extraction with `--include-comments`, generate outputs, validate comment-related CSV and JSON artifacts, then load the dataset in the dashboard and confirm comment metrics and capped coverage state render correctly.

**Acceptance Scenarios**:

1. **Given** comment extraction is enabled, **When** CSV generation runs, **Then** comment tables are exported under stable schemas that preserve deterministic output and do not break existing PowerBI imports.
2. **Given** comment data exists in SQLite, **When** aggregate JSON is generated, **Then** comment summary metrics, weekly trend data, repository breakdowns, and coverage/capped metadata are present.
3. **Given** extraction hit configured comment caps, **When** the manifest and dashboard load, **Then** both surfaces signal that comment coverage is partial rather than silently implying completeness.
4. **Given** users ask for raw comment browsing, search, sentiment, or engagement scoring, **When** roadmap closure ships, **Then** those items remain explicitly outside this roadmap and do not block completion.

---

### User Story 4 - Finish Reviewer Follow-Through And Close The Roadmap (Priority: P2)

A maintainer can point to a final evidence-backed roadmap state where reviewer combined semantics are handled deliberately, stale TODO claims are removed, and roadmap closure is justified by tests and documentation.

**Why this priority**: Reviewer Phase 1 is already shipped, so the remaining work is governance, supported-combination behavior, and roadmap hygiene rather than greenfield implementation. It should close after the unfinished user-facing features, not before.

**Independent Test**: Review `TODO/ROADMAP.md`, reviewer behavior in the extension, and final verification artifacts to confirm unsupported combinations are either implemented or intentionally constrained and that roadmap completion is evidenced rather than asserted.

**Acceptance Scenarios**:

1. **Given** reviewer filters are selected with unsupported secondary dimensions, **When** the dashboard computes metrics, **Then** behavior is either explicitly implemented with tests or explicitly constrained and documented with no ambiguous silent fallback.
2. **Given** review latency is still blocked on persisted `reviewed_at`, **When** roadmap closure is declared, **Then** review latency is documented as a post-roadmap Phase 2 capability rather than an unresolved hidden dependency.
3. **Given** all roadmap features are shipped or intentionally reclassified, **When** `TODO/ROADMAP.md` is updated, **Then** it records closure evidence, remaining non-roadmap follow-ups, and no obsolete “ready” or “blocked” statements that contradict the codebase.

### Edge Cases

- Author display names may collide or change. Identity MUST remain stable even if labels are not unique.
- Large author and reviewer sets may exceed practical dropdown UX. The roadmap must define a supported scalable interaction rather than assume small datasets.
- Legacy datasets may lack `by_author`, `by_author_and_repo`, reviewer fields, or comments aggregates. New work MUST preserve version-adapter behavior.
- Comment extraction may be disabled entirely, partially enabled, or capped by CLI safeguards. Outputs and UI MUST distinguish all three states.
- CSV additions for comments must not break the existing PowerBI contract for current CSV consumers.
- Cross-dimensional exactness must remain optional and additive. Absence of nested slices in older artifacts MUST not break metrics rendering.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The roadmap closure program MUST treat current repository state as authoritative and MUST NOT re-spec already shipped reviewer Phase 1 or team x repository work as unfinished implementation.
- **FR-002**: The program MUST deliver author filtering as a full-stack feature across aggregation, schema, dataset loading, dashboard state, UI controls, and tests.
- **FR-003**: Author filtering MUST use immutable Azure DevOps `user_id` as the canonical author identity key for aggregation and cross-dimensional joins.
- **FR-004**: The program MUST implement locked author filter semantics: searchable single-select author UX and `constrained` author + team behavior where author remains the applied dimension and the UI signals the constraint explicitly.
- **FR-005**: The program MUST deliver exact author x repository support via additive nested slices and MUST preserve backward-compatible fallback behavior for datasets where those slices are absent.
- **FR-006**: The sum of all repository entries within `by_author_and_repo[author]` MUST equal the same author’s `by_author.pr_count` for the same rollup.
- **FR-007**: The comments program MUST complete the feature across SQLite-derived auxiliary CSV export, aggregate JSON output, extension rendering, and CLI/reference documentation without mutating the existing core contract CSVs.
- **FR-008**: Existing core contract CSVs (`organizations`, `projects`, `repositories`, `pull_requests`, `users`, `reviewers`) MUST remain byte-for-byte contract-stable in schema and order. Any new comment CSVs MUST be tested as auxiliary exports under separate contract assertions.
- **FR-009**: Comment aggregate output MUST include summary metrics, weekly trend data, repository-level breakdowns, and an explicit coverage state with capped-awareness.
- **FR-010**: The comments dashboard MUST present a metrics-first experience and MUST NOT require raw thread browsing, full-text comment search, sentiment analysis, or engagement scoring for roadmap closure.
- **FR-011**: The program MUST define how capped comment extraction is recorded during extraction and propagated through manifests and dashboard presentation.
- **FR-012**: Reviewer follow-through MUST implement the locked reviewer combination contract: reviewer + repository is `constrained`, reviewer + team is `disallowed-with-ux-signal`, and no reviewer combination may use proportional fallback.
- **FR-013**: Reviewer follow-through MUST preserve the existing Phase 1 reviewer contract: dedicated `ReviewerBreakdownEntry`, approval-rate semantics based on final stored vote, and exclusion of review-latency metrics until persisted `reviewed_at` exists.
- **FR-014**: Roadmap closure MUST include updates to `TODO/ROADMAP.md` and any subordinate TODO files so they match actual shipped state and remaining post-roadmap research.
- **FR-015**: The closure package MUST include an evidence pack in a required repeatable format: checklist status, exact verification commands, pass/fail outcomes, and file references for code, tests, and docs touched by each roadmap item.
- **FR-016**: All implementation work under this program MUST preserve constitution principles I through XXV, especially CSV contract stability, SQLite-as-source-of-truth, deterministic outputs, backfill convergence, and no silent data loss.
- **FR-017**: Author identity resolution MUST define fallback and merge rules for renamed users, deleted accounts, missing display names, and cross-project references. Those rules MUST preserve canonical identity and prevent silent aggregate fragmentation.
- **FR-018**: New additive dimensions and cross-dimensional slices MUST define and enforce bounded cardinality limits for generation, persistence, and frontend loading.
- **FR-019**: The extension loader MUST use explicit manifest capability flags or schema-version checks to detect availability of author, author x repository, reviewer, and comments surfaces.
- **FR-020**: New author and comments aggregations MUST be idempotent and convergent. Recomputing from the same SQLite state MUST yield identical outputs, and backfill runs MUST converge to the same final aggregates as incremental runs over equivalent final data.
- **FR-021**: Roadmap closure MUST include explicit PowerBI regression confidence for unchanged core contract CSVs, including evidence for import safety or equivalent non-regression proof aligned with constitution verification expectations.

### Contract Boundary Requirements

- **CB-001**: The spec distinguishes two output classes only:
  - `core-contract-csvs`: the existing PowerBI boundary and its tests.
  - `auxiliary-additive-outputs`: new comment CSVs, JSON aggregates, manifest capability fields, and dashboard-only additive slices.
- **CB-002**: `by_author`, `by_author_and_repo`, reviewer combination metadata, and comments aggregate data MUST be emitted only in additive JSON/manifest/dashboard surfaces unless a future explicitly versioned contract says otherwise.
- **CB-003**: Auxiliary comment CSVs, if generated, MUST live under separate schema assertions and MUST NOT alter expectations for the six core contract CSVs.
- **CB-004**: Tests MUST fail if any roadmap-closure implementation changes the column names, order, or required headers of the core contract CSVs.

### Identity Requirements

- **IR-001**: Canonical author identity MUST be the persisted Azure DevOps `user_id`; display name and email are descriptive fields only.
- **IR-002**: If a display name changes across runs, aggregates MUST remain attached to the same canonical `user_id`.
- **IR-003**: If a display name is missing, deleted, or redacted, the system MUST still aggregate by canonical `user_id` and surface a stable fallback label.
- **IR-004**: If multiple projects reference the same canonical `user_id`, aggregation MUST preserve existing organization/project scoping rules and MUST NOT merge cross-scope facts incorrectly.
- **IR-005**: Identity merge or fallback logic MUST be tested explicitly at the aggregation and loader boundaries.

### Scalability And Cardinality Requirements

- **SR-001**: `by_author` and `by_author_and_repo` generation MUST use bounded strategies for high-cardinality datasets.
- **SR-002**: The implementation MUST define a deterministic truncation or pruning policy for author x repository slices when cardinality exceeds a configured ceiling.
- **SR-003**: Any truncation policy MUST preserve exactness for retained entries, expose that truncation occurred, and avoid silent partial semantics.
- **SR-004**: Reviewer combined-filter support MUST not introduce unbounded nested slice growth. If exact support cannot be bounded safely, the combination MUST use `constrained` or `disallowed-with-ux-signal`.
- **SR-005**: Frontend loading and metrics resolution MUST use capability-aware access patterns that avoid scanning unbounded nested structures when a required feature is absent.

### Research Requirements

- **RR-001**: Closed by this spec: author + team semantics are `constrained`, with author as the dominant applied dimension and explicit UI signaling.
- **RR-002**: Closed by this spec: author filtering uses searchable single-select UX for this roadmap program.
- **RR-003**: Closed by this spec: reviewer + repository is `constrained` and reviewer + team is `disallowed-with-ux-signal`.
- **RR-004**: Closed by this spec: comment CSV export is auxiliary, not part of the current PowerBI contract surface. Implementation must follow that decision.
- **RR-005**: Before comments coverage is declared complete, the team MUST design how the extraction path records capped/partial state so aggregate generation does not guess completeness from row counts alone.
- **RR-006**: Before roadmap closure is declared, the team MUST classify post-roadmap work explicitly, including review latency Phase 2 and comments advanced analytics, so roadmap completion is not blocked by research-only follow-ons.
- **RR-007**: Before implementation of bounded cross-dimensional slices, the team MUST record the deterministic truncation and capability-signaling policy for high-cardinality author x repository data.
- **RR-008**: Closed by this spec: reviewer combination mode selection is fixed and proportional fallbacks are prohibited.

### Test And Verification Requirements

- **TR-001**: Author filtering MUST have backend unit coverage for slice generation, empty-input behavior, stable identity handling, and any combined-semantics rules chosen by product.
- **TR-002**: Author filtering MUST have extension coverage for schema validation, dataset normalization, filter-state serialization, metrics resolution, and end-to-end dashboard interaction.
- **TR-003**: Author x repository exactness MUST have invariant tests proving author totals equal the sum of nested repository totals and that exact lookup takes precedence when available.
- **TR-004**: Comments completion MUST have unit and integration coverage for CSV schema validation, deterministic export ordering, aggregate generation, coverage-state propagation, and dashboard rendering.
- **TR-005**: Comments completion MUST include tests for disabled, full, and partial/capped coverage modes.
- **TR-006**: Reviewer follow-through MUST include tests for every supported reviewer combination and for every explicitly unsupported combination path, including the expected UX or sanitization behavior.
- **TR-007**: The final roadmap-closure branch MUST pass the existing Python, TypeScript, integration, schema, and scalability gates that are relevant to touched surfaces.
- **TR-008**: The final roadmap-closure evidence set MUST identify which constitution quality gates and verification requirements were exercised for each remaining feature.
- **TR-009**: Core contract CSV regression tests MUST explicitly prove that roadmap-closure work did not alter existing CSV schemas or column order.
- **TR-010**: Auxiliary comment CSV tests MUST validate their own schema and determinism separately from the core contract suite.
- **TR-011**: Identity tests MUST cover renamed users, missing labels, and stable aggregation by canonical `user_id`.
- **TR-012**: Loader tests MUST cover capability/version detection for legacy datasets and additive feature availability without brittle downstream branching.
- **TR-013**: Aggregation tests MUST prove idempotent recomputation and backfill convergence for new author and comments-derived outputs.
- **TR-014**: Verification must include explicit PowerBI regression-confidence evidence for unchanged core contract CSVs.

### Documentation Requirements

- **DR-001**: CLI documentation MUST describe all supported comment-extraction flags and their capped-data implications.
- **DR-002**: Dataset and dashboard documentation MUST describe new author and comments surfaces, including backward-compatibility expectations for legacy artifacts.
- **DR-003**: Reviewer documentation MUST describe supported reviewer combinations and keep review latency explicitly deferred until the persisted timestamp prerequisite exists.
- **DR-004**: `TODO/ROADMAP.md` MUST end in a closure-ready state with completed items removed or marked complete, post-roadmap research separated, and no stale blocker claims that contradict `specs/032-roadmap-blocker-resolution/` or shipped code.
- **DR-005**: Documentation MUST explicitly distinguish core contract CSVs from auxiliary outputs and state that comment CSVs are auxiliary in this roadmap program.
- **DR-006**: Documentation MUST publish the evidence-pack format used for roadmap closure review.

### Key Entities *(include if feature involves data)*

- **Author Breakdown Entry**: Per-author weekly metric slice derived from PR author identity and surfaced as an additive dashboard filter dimension.
- **Author x Repository Breakdown**: Nested exact cross-dimensional slice keyed by author and repository, used when both filters are active.
- **Comment Metrics Aggregate**: Weekly and aggregate comment analytics derived from SQLite comment tables and emitted for dashboard consumption.
- **Comment Coverage State**: Explicit completeness metadata indicating `disabled`, `full`, or `partial/capped` comment availability.
- **Reviewer Combination Contract**: The product and UX rule that defines how reviewer filters behave when paired with repository or team filters.
- **Roadmap Closure Evidence Pack**: The final mapping of shipped features to code, tests, docs, and verification results used to justify closing `TODO/ROADMAP.md`.

## Delivery Strategy

### Slice A - Author Filters

Scope:
- backend `by_author` slice generation,
- dimensions and rollup schema support,
- dataset-loader normalization,
- dashboard filter state and UI wiring,
- author filter metrics tests,
- author-specific documentation.

Primary dependencies:
- existing `pull_requests.user_id`,
- existing `users` dimension data,
- existing team-slice and reviewer-filter patterns.

Open research gates:
- author + team semantics,
- large-author-list UX.

Locked implementation constraints:
- aggregate by canonical `user_id`,
- preserve label fallback rules,
- expose capability/version signal for author support,
- keep core CSV contract untouched.

### Slice B - Exact Author x Repository

Scope:
- backend `by_author_and_repo`,
- extension schema/type support,
- exact nested lookup in metrics resolution,
- compatibility fallback behavior,
- invariants and regression tests.

Primary dependency:
- Slice A must ship first because author root slices are prerequisite.

Locked implementation constraints:
- bounded cardinality with deterministic truncation policy,
- exactness only for retained entries,
- explicit capability or truncation signal when exact coverage is incomplete.

### Slice C - Comments Completion

Scope:
- CSV export contract,
- aggregate JSON contract,
- manifest coverage-state propagation,
- dashboard metrics-first presentation,
- CLI and operator documentation,
- deterministic export and coverage-state tests.

Open research gates:
- how capped extraction is persisted as first-class metadata.

Locked implementation constraints:
- comment CSVs are auxiliary outputs,
- existing PowerBI core CSV contract must not change,
- comments coverage state must be persisted rather than inferred from counts.

### Slice D - Reviewer Follow-Through And Roadmap Closure

Scope:
- finalize reviewer-combination product contract,
- implement or constrain those combinations,
- preserve explicit Phase 2 latency deferment,
- update roadmap and subordinate TODOs,
- publish closure evidence pack.

Primary dependency:
- should land after slices A through C so roadmap status reflects the true final state.

Locked implementation constraints:
- allowed reviewer modes are `exact`, `constrained`, or `disallowed-with-ux-signal`,
- proportional reviewer fallback is prohibited in this roadmap program,
- closure evidence must be emitted in the required format before roadmap sign-off.

## Implementation Sequence

1. Finish research decisions that block stable acceptance criteria.
2. Implement Slice A author filtering end to end.
3. Implement Slice B exact author x repository support.
4. Implement Slice C comments completion from exports through dashboard.
5. Implement Slice D reviewer follow-through and roadmap cleanup.
6. Produce closure evidence and update `TODO/ROADMAP.md` to completed state.

Recommended parallelization:
- One engineer can own Slice A then Slice B while another owns Slice C.
- Reviewer follow-through should begin only after product decisions are recorded, but documentation prep can happen earlier.
- Roadmap finalization should happen last so it reflects verified shipped state rather than intent.

## Research Plan

### Research Track 1 - Author Semantics And UX

Questions to resolve:
- What is the supported behavior for author + team combinations?
- Is author filtering single-select, multi-select, or searchable multi-select?
- What is the minimum enterprise-ready UX for 200+ authors?
- What deterministic truncation or top-N policy applies when author x repository cardinality exceeds limits?

Required output:
- a short design decision record,
- explicit acceptance scenarios for supported and unsupported combinations,
- test implications for metrics resolution and URL state.

### Research Track 2 - Comments Contract And Coverage

Questions to resolve:
- What exact summary and breakdown metrics belong in the aggregate JSON?
- How does extraction persist “capped” so downstream consumers can trust coverage state?

Required output:
- aggregate field definitions,
- extraction-to-manifest propagation rules,
- acceptance scenarios for disabled/full/partial comment modes.

### Research Track 3 - Reviewer Combination Contract

Questions to resolve:
- What should reviewer + repository do?
- What should reviewer + team do?
- Which allowed mode applies to each combination: `exact`, `constrained`, or `disallowed-with-ux-signal`?

Required output:
- a supported-combinations matrix,
- explicit behavior for unsupported combinations,
- documentation and regression-test obligations.

### Research Track 4 - Roadmap Closure Boundaries

Questions to resolve:
- Which items are truly required for roadmap closure versus future enhancement?
- Where do review latency Phase 2 and advanced comment analytics live after closure?
- What file and checklist structure is required for the closure evidence pack?

Required output:
- a post-roadmap backlog classification,
- final roadmap closure criteria,
- evidence checklist for sign-off.

## Test Plan

### Backend Tests

- extend `tests/unit/test_aggregators.py` for `by_author` and `by_author_and_repo`,
- add identity-stability tests keyed on canonical `user_id`,
- add deterministic truncation and capability-signaling tests for bounded author x repository slices,
- add comments aggregate tests covering disabled/full/partial coverage,
- extend core CSV non-regression tests to prove no existing contract drift,
- add auxiliary comment CSV schema and determinism tests,
- preserve backfill and convergence behavior for all touched derivations.

### Frontend Tests

- extend rollup schema tests for author and author x repository shapes,
- add dataset-loader normalization tests for additive fields, legacy absence, and manifest capability/version detection,
- extend metrics/filter tests for author-only, author + repository exactness, and chosen reviewer-combination behavior,
- add dashboard tests for author UI visibility, comment panel rendering, and capped coverage messaging.

### Integration Tests

- generate synthetic datasets that exercise author filters, author x repository, reviewer combinations, and comments enabled/capped states,
- verify cross-stack round-trips from generated artifacts into extension fixtures,
- run targeted integration checks for legacy-dataset compatibility,
- prove idempotent recomputation and backfill convergence for new additive outputs.

### Verification Commands

- Python quality gates: `ruff check .`, `ruff format --check .`, `pytest tests/unit`, targeted `pytest tests/integration/...`
- TypeScript quality gates: extension lint/type/test commands already used by repo CI
- Cross-stack parity: targeted schema, dashboard, and synthetic-fixture tests
- Scalability: preserve author/reviewer/comments behavior under 156-week and 200-user/reviewer synthetic datasets when relevant

## Evidence Pack Format

Roadmap closure review requires a repeatable evidence artifact, stored with the closure work, containing:

- roadmap item identifier and status,
- implementation file references,
- test file references,
- documentation file references,
- exact verification commands run,
- recorded pass/fail result for each command,
- constitution gates exercised,
- residual risks or explicit post-roadmap deferments.

The merge is not closure-ready until every remaining roadmap item has a completed evidence entry in this format.

## Compatibility Strategy

- Manifests or dataset metadata MUST expose explicit capability flags or schema version needed for author, author x repository, reviewer, and comments features.
- The extension loader MUST perform feature detection at load time and normalize missing additive surfaces to safe defaults.
- Legacy datasets MUST continue to render without author/comments/reviewer additive surfaces present.
- New additive behavior MUST be introduced through the loader adapter layer first, with UI and metrics modules consuming normalized capability-aware state.

## Determinism And Convergence

- Author, author x repository, and comments aggregates MUST be pure functions of the SQLite source state.
- Re-running aggregation against unchanged SQLite input MUST produce identical JSON and auxiliary CSV outputs.
- Incremental runs plus bounded backfill MUST converge to the same final additive aggregates as a full recomputation over equivalent final persisted data.
- Any truncation, capability loss, or partial-coverage state MUST be explicit in outputs so deterministic comparison remains meaningful.

## Roadmap Closure Definition

The roadmap is considered professionally closed only when all of the following are true:

- author filtering is shipped and tested,
- exact author x repository support is shipped and tested,
- comments completion is shipped from extraction outputs through dashboard/docs,
- reviewer combined-semantics behavior is either shipped or intentionally constrained with tests and docs,
- `TODO/ROADMAP.md` and related TODO files match actual shipped state,
- post-roadmap work is explicitly reclassified rather than left as hidden blockers,
- constitution-sensitive evidence exists for every changed contract surface,
- an evidence pack entry exists for each roadmap item in the required format,
- CI-relevant verification for touched areas passes.

## Out of Scope

- Implementing review latency metrics before persisted `reviewed_at` exists and is backfilled
- Raw comment browsing, full-text search, sentiment analysis, or engagement scoring
- New persistence backends or changes to SQLite-as-source-of-truth architecture
- Breaking existing CSV contracts without an explicit versioning and migration plan
- Reworking already shipped reviewer Phase 1 behavior unless required by the reviewer-combination decision

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `TODO/ROADMAP.md` no longer contains unfinished feature work that contradicts the codebase’s actual shipped state.
- **SC-002**: Author filtering and author x repository exactness are both covered by backend and extension tests with no regression to legacy dataset compatibility.
- **SC-003**: Comment extraction produces user-visible value across CSV or documented export surfaces, aggregate JSON, dashboard rendering, and CLI docs, with explicit coverage-state signaling.
- **SC-004**: Reviewer combined behavior is no longer ambiguous; every supported or unsupported combination has a documented contract and corresponding test coverage.
- **SC-005**: Final roadmap closure can be justified by a traceable evidence pack linking each remaining feature to implementation, tests, docs, and verification commands.
