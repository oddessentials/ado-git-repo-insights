# Feature Specification: Reviewer Demo Coverage

**Feature Branch**: `[037-add-reviewer-demo]`
**Created**: 2026-03-23
**Status**: Draft
**Input**: User description: "Close the synthetic demo data coverage gap by adding reviewer dimensional breakdowns so reviewer filtering, constrained reviewer mode, and incompatible reviewer plus team states can be demonstrated and validated while preserving deterministic demo regeneration."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Demonstrate Reviewer-Filtered Views (Priority: P1)

A product stakeholder opens the canonical demo dataset and uses reviewer-based filtering to inspect review activity without relying on ad hoc or manually altered data.

**Why this priority**: Reviewer-specific demo coverage is the identified functional gap, and closing it is necessary to claim complete demo coverage for supported dashboard paths.

**Independent Test**: Load the canonical demo dataset, apply reviewer filters, and confirm reviewer-specific views show meaningful results across supported dashboard screens.

**Acceptance Scenarios**:

1. **Given** the canonical demo dataset is loaded, **When** a stakeholder filters the dashboard to a reviewer represented in the dataset, **Then** the dashboard shows reviewer-specific activity rather than an empty or unsupported state.
2. **Given** the canonical demo dataset is loaded, **When** a stakeholder switches between reviewers, **Then** the displayed metrics and supporting views update to reflect the selected reviewer.
3. **Given** the canonical demo dataset includes synthetic users, **When** a stakeholder reviews reviewer or author names in demo-facing views, **Then** each synthetic user is represented by a unique realistic human-readable name with no numeric suffixes or placeholder numbering.

---

### User Story 2 - Demonstrate Reviewer Constraints (Priority: P2)

A product stakeholder uses the demo to show constrained reviewer mode and the signal shown when reviewer and team selections are not allowed together.

**Why this priority**: The dashboard already supports these reviewer-driven UX paths, but the current demo cannot exercise them, which limits credible demonstrations and acceptance review.

**Independent Test**: Use the canonical demo dataset to enter reviewer-constrained mode and attempt a disallowed reviewer-plus-team combination, confirming that each path is represented clearly.

**Acceptance Scenarios**:

1. **Given** the canonical demo dataset includes reviewer dimensional data, **When** a stakeholder enters a reviewer-constrained view, **Then** the dashboard presents a valid constrained-mode experience using demo data.
2. **Given** the canonical demo dataset includes reviewer and team dimensions, **When** a stakeholder selects a reviewer-plus-team combination that is disallowed by the product rules, **Then** the dashboard presents the expected disallowed-state signal.

---

### User Story 3 - Preserve Canonical Demo Trustworthiness (Priority: P3)

A release owner regenerates the canonical demo artifacts and needs confidence that reviewer coverage has been added without breaking deterministic output or existing demo guarantees.

**Why this priority**: The demo dataset is a published reference artifact, so coverage gains must not reduce reproducibility or confidence in release validation.

**Independent Test**: Regenerate the canonical demo dataset multiple times from the same seed and confirm the reviewer-enhanced outputs remain identical and continue to satisfy release validation checks.

**Acceptance Scenarios**:

1. **Given** the canonical demo dataset is regenerated from the approved seed and baseline inputs, **When** the regeneration process runs repeatedly, **Then** the published output remains identical between runs.
2. **Given** reviewer dimensional data has been added, **When** release validation is performed for the demo artifacts, **Then** the dataset is accepted as complete for reviewer-supported dashboard paths.

### Edge Cases

- A reviewer exists in the demo dataset but has sparse activity; the demo must still expose enough reviewer-linked information to avoid misleading empty-state behavior during reviewer filtering.
- A reviewer selection that is valid on its own becomes invalid when combined with a team constraint; the dataset must support the product's disallowed-state signal rather than silently returning unrelated data.
- If the demo is regenerated from the canonical seed after reviewer coverage is added, any accidental omission of reviewer breakdowns must be detectable before the demo is published.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The canonical demo dataset MUST include reviewer dimensional breakdowns for review activity so reviewer-based filtering can be demonstrated using published demo artifacts.
- **FR-002**: The reviewer dimensional breakdowns MUST be generated from the same canonical input scope as the rest of the demo dataset so reviewer views remain aligned with existing author, team, repository, and project slices.
- **FR-003**: The canonical demo dataset MUST expose a deterministic reviewer data contract that includes reviewer-level slices, reviewer-constrained walkthrough metadata, and explicit disallowed reviewer-plus-team fixture metadata so generation, validation, and UI verification target the same canonical reviewer surfaces.
- **FR-004**: The canonical demo dataset MUST include at least five reviewers with meaningful activity, where meaningful activity means each reviewer has at least 3 reviewed pull requests and at least 3 review actions within the canonical reviewer-filter walkthrough data.
- **FR-005**: At least one canonical reviewer in the demo dataset MUST span activity in two or more repositories so cross-repository reviewer behavior can be demonstrated credibly.
- **FR-006**: The canonical demo dataset MUST support at least one documented reviewer-constrained walkthrough in which reviewer-focused views can be demonstrated without manual data preparation.
- **FR-007**: The canonical demo dataset MUST include at least one deterministic, documented reviewer-plus-team combination that is always disallowed by the demo fixture rules so the dashboard's incompatible-selection signal can be demonstrated and validated without exploratory searching.
- **FR-008**: Regenerating the canonical demo dataset from the approved seed and baseline inputs MUST produce identical reviewer-enhanced outputs across repeated runs for all published demo artifacts, including the dataset payloads, demo metadata, and any manifest files used to serve or validate the canonical demo.
- **FR-009**: Demo publication validation MUST block release readiness with a failing result and a clear error reason whenever reviewer dimensional breakdowns, reviewer walkthrough metadata, or the documented disallowed reviewer fixture are missing from the canonical dataset.
- **FR-010**: Existing covered demo dimensions and walkthroughs, including author, team, repository, cross-dimensional slices, predictions, insights, and comments, MUST remain available after reviewer coverage is added.
- **FR-011**: Synthetic users represented in the canonical demo dataset MUST each have a unique realistic human-readable name and MUST NOT use numeric suffixes, numeric-only identifiers, or visibly generated placeholder numbering in demo-facing outputs.
- **FR-012**: Known non-blocking concerns about optional machine-learning coverage and skipped extension artifact parity checks MUST be documented as out of scope for this feature unless they directly prevent reviewer demo coverage.

### Key Entities *(include if feature involves data)*

- **Canonical Demo Dataset**: The published synthetic reference dataset used for demos, release validation, and GitHub Pages presentation.
- **Reviewer Breakdown**: Review activity summarized by reviewer so dashboard views can respond to reviewer selection and reviewer-constrained states.
- **Reviewer Fixture Metadata**: The canonical descriptive data that identifies which reviewer-focused walkthroughs are valid, which reviewer-plus-team combination is intentionally disallowed, and how those cases are discovered consistently in demos and validation.
- **Constraint State**: A supported dashboard condition that represents whether a reviewer selection is valid on its own or incompatible when combined with another dimension such as team.
- **Synthetic User Identity**: A demo-facing person record with a unique realistic name used consistently across reviewer, author, and related human-readable dashboard views.
- **Demo Validation Result**: The release-readiness outcome that confirms the canonical dataset is complete, reproducible, and publishable.

### Assumptions

- Reviewer coverage is required only for the canonical enterprise demo dataset that is published and used for stakeholder demonstrations.
- Existing deterministic generation inputs, including the approved seed and current baseline data scope, remain the source of truth for demo regeneration.
- Published demo artifacts include every canonical dataset, manifest, and metadata file required to serve, validate, or demonstrate the reviewer-enhanced demo through the normal publication path.
- The deterministic disallowed reviewer-plus-team example can be expressed as fixture metadata or an equivalent discoverable canonical marker, as long as demos and automated checks resolve the same documented case.
- The noted optional machine-learning coverage gaps and skipped extension artifact parity checks do not block this feature unless they prevent reviewer-specific demo paths from being demonstrated.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Stakeholders can complete 100% of the reviewer-supported demo walkthroughs defined in the canonical reviewer fixture metadata, including reviewer filtering, reviewer-constrained mode, and the documented disallowed reviewer-plus-team example, using the canonical published demo dataset without manual data edits.
- **SC-002**: The canonical demo dataset exposes at least five reviewers with non-empty reviewer-filtered experiences, at least one reviewer spanning multiple repositories, at least one valid reviewer-constrained walkthrough, and one documented disallowed reviewer-plus-team walkthrough that can each be demonstrated end to end.
- **SC-003**: Repeating canonical demo regeneration from the approved seed produces no differences across consecutive runs for every published canonical dataset, manifest, and metadata artifact included in the normal demo publication flow.
- **SC-004**: Release validation stops publication in 100% of runs where reviewer breakdowns, reviewer walkthrough metadata, or the documented disallowed reviewer fixture are missing, and reports an error reason that identifies the missing reviewer coverage artifact.
