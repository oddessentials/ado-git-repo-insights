# Feature Specification: Throughput chart PR-level drill-down

**Feature Branch**: `060-throughput-pr-drilldown`
**Created**: 2026-04-19
**Status**: Draft (Pass 1)
**Input**: User description: "Throughput chart PR-level drill-down: extend the existing throughput drill-down panel with an inline, top-500-truncated list of individual PR records (id, title, author_id, repository_id, cycle_time) sourced inline from the weekly rollup JSON. URL derived client-side. Supported under unfiltered/author-only/repository-only/author+repo filters; disabled with an advisory toast when team, reviewer, or comparison mode is active. Supported-but-empty opens a normal empty-state section. Demo publish boundary strips PR arrays. First slice of Phase 2 from #205/#300."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Explain a weekly throughput spike with individual PRs (Priority: P1)

A user viewing the weekly PR-throughput chart sees a week with an unusually high bar and wants to understand what drove it. They click the bar and the drill-down panel opens with the set of individual pull requests that contributed to that week's count, showing each PR's title, time-to-close, and a clickable link to the pull request in Azure DevOps. The user can quickly scan titles and click through to the PRs that look most relevant to their investigation.

**Why this priority**: This is the direct realization of the owner's product principle from #205 — "every data point is an entry point into an explanation." Aggregate breakdowns (Phase 1) answered "who and where"; PR-level detail answers "which specific work." Without this, the throughput drill-down stops one step short of the decision the user is actually trying to make.

**Independent Test**: Load the dashboard with no active filter, click any throughput bar whose week has PRs. The panel opens; the "PRs" section shows a list of individual pull requests for that week with titles, cycle times, and links that navigate to the correct Azure DevOps PR URL.

**Acceptance Scenarios**:

1. **Given** the dashboard is loaded with no filter active, **When** the user clicks a throughput bar for a week with 47 PRs, **Then** the drill-down panel opens and the "PRs" section lists 47 pull requests with each PR's title, cycle time, and a working link.
2. **Given** a week has more than 500 PRs contributing, **When** the user clicks that throughput bar, **Then** the panel opens, the list shows 500 pull requests ordered by cycle time (longest first), and a truncation indicator communicates that additional PRs were omitted.
3. **Given** the user clicks a PR link inside the panel, **When** the click is activated, **Then** a new tab or window opens to that pull request's page in Azure DevOps.

---

### User Story 2 - Filtered drill-down agrees with the filtered count (Priority: P1)

A user has applied a repository and/or author filter at the dashboard level and is looking at throughput under that filter. They click a throughput bar; the drill-down panel opens and the PR list shows exactly the pull requests that contributed to the filtered weekly count — nothing more, nothing less. The number of PRs displayed in the list equals the weekly count shown on the chart.

**Why this priority**: Filter-consistent data is a correctness contract. If the PR list disagreed with the chart's count, users would lose trust in both. Co-priority with Story 1 because the filter-consistent case is the most common real-world usage pattern — users explore specific teams / projects / people, not the unfiltered global view.

**Independent Test**: Apply a repository filter at the dashboard; read the weekly count shown on the filtered throughput bar; click the bar; verify the count of PRs listed in the panel equals the filtered weekly count. Repeat for an author filter and for both filters combined.

**Acceptance Scenarios**:

1. **Given** a repository filter is active and the filtered throughput bar for a given week shows 12 PRs, **When** the user clicks that bar, **Then** the panel lists exactly 12 pull requests, all attributed to the filtered repository.
2. **Given** an author filter is active and the filtered throughput bar for a given week shows 5 PRs, **When** the user clicks that bar, **Then** the panel lists exactly 5 pull requests, all authored by the filtered user.
3. **Given** repository and author filters are both active and the filtered weekly count shows 3 PRs, **When** the user clicks the bar, **Then** the panel lists exactly 3 pull requests matching both criteria.

---

### User Story 3 - Explicit disable under unsupported filters and comparison mode (Priority: P1)

A user has applied a team filter, a reviewer filter, or is in comparison mode. They click a throughput bar. Rather than opening a panel with misleading or partial data, the system displays a short, explanatory advisory near the bar they clicked, stating which filter needs to be cleared or which mode needs to be exited to view PR-level detail. The throughput bar itself still visibly appears interactive (so the user knows where to click when ready), but the panel does not open.

**Why this priority**: Silent removal of affordance would confuse users ("why did drill-down stop working?"); "best effort" partial data would violate the filter-identity contract. An explicit disable + message is the only approach that keeps the user oriented and the data trustworthy. Co-priority with Stories 1 & 2 because unsupported-filter states are reachable in normal usage and a misleading experience in any of these states undermines the whole feature.

**Independent Test**: Apply a team filter. Click any throughput bar. Verify no panel opens, the advisory message appears near the bar, and the message names "team filter" as the thing to clear. Repeat with a reviewer filter; repeat with comparison mode.

**Acceptance Scenarios**:

1. **Given** a team filter is active, **When** the user clicks a throughput bar, **Then** no drill-down panel opens and an advisory appears near the bar directing the user to clear the team filter to view PR-level detail.
2. **Given** a reviewer filter is active, **When** the user clicks a throughput bar, **Then** no drill-down panel opens and an advisory appears directing the user to clear the reviewer filter.
3. **Given** comparison mode is active, **When** the user clicks a throughput bar, **Then** the existing comparison-mode advisory appears (unchanged from Phase 1).
4. **Given** the user activates the bar via keyboard (Enter or Space) instead of mouse click, **Then** the same disable behavior applies and the advisory appears.

---

### User Story 4 - Empty supported filter opens the panel with an empty state (Priority: P2)

A user has applied a supported filter (author, repository, or both) that yields zero matching PRs for a given week. They click that week's throughput bar. The panel opens normally and shows an "empty state" section explaining that no pull requests match the active filter in this week. This is clearly distinct from the advisory shown when drill-down is disabled under unsupported filters.

**Why this priority**: Zero matches under a supported filter is a legitimate empty result, not a disabled state. Using the wrong UX (advisory toast) here would confuse users into thinking drill-down was blocked when it simply had nothing to show. Lower than P1 because the frequency is low (most non-zero bars have some PRs), but important for internal consistency.

**Independent Test**: Choose a fixture where a repository filter yields zero matching PRs for a given week. Click that week's throughput bar. Verify the panel opens and displays an empty-state section titled "PRs" with explanatory detail, not an advisory toast.

**Acceptance Scenarios**:

1. **Given** a supported filter is active and a given week has no matching PRs, **When** the user clicks that throughput bar, **Then** the panel opens and shows an empty-state section rather than an advisory toast.
2. **Given** the empty-state section is displayed, **When** the user reads the section, **Then** the title and detail text clearly indicate that zero PRs match the active filter for the week — not that drill-down is disabled.

---

### User Story 5 - Public demo remains aggregate-only (Priority: P1)

An external visitor views the public demo dashboard. The demo shows the same Phase 1 drill-down panels with aggregate author/repository breakdowns, but no PR titles, IDs, URLs, or any other PR-level identifying data appear in any published artifact. The PR-level detail surfaces only for end-users inside Azure DevOps, where each viewer's ADO permissions already govern what they can see.

**Why this priority**: PR titles and IDs are tenant-sensitive content. Leaking them through public demo artifacts would violate the privacy posture, be effectively irrecoverable once published, and create trust/compliance risk with real customers. Co-priority with the functional P1 stories because a single accidental publication could undo weeks of user trust.

**Independent Test**: Inspect every weekly-rollup artifact in the published demo surface. Verify no artifact contains a PR-record array, a truncation flag, or any PR-identifying text. Verify the demo dashboard continues to render Phase 1 aggregate drill-down panels without errors.

**Acceptance Scenarios**:

1. **Given** the demo publish process has run, **When** an auditor inspects any published weekly-rollup artifact, **Then** no PR-record array, truncation flag, or PR-identifying field is present.
2. **Given** a user loads the public demo dashboard, **When** they click a throughput bar, **Then** the drill-down panel opens with Phase 1 aggregate breakdowns only (the "PRs" section is absent) and no error is displayed.
3. **Given** the demo publish process is re-run idempotently, **When** output is inspected, **Then** results remain PR-free regardless of how many times the process runs.

---

### Edge Cases

- **Exactly at truncation boundary**: a week with exactly 500 PRs renders all 500 and no truncation indicator is shown. A week with 501 PRs renders the 500 longest-cycle-time PRs and the truncation indicator is shown.
- **Tied cycle times**: when two PRs have identical cycle times, the tie is broken deterministically by PR id ascending, so ordering is reproducible across runs on the same data.
- **Multiple unsupported filters active together** (e.g. team AND reviewer): a single advisory appears naming one filter to clear; clicking again does not stack additional advisories (consistent with Phase 1 advisory-toast behavior).
- **Comparison mode AND a team filter active**: comparison-mode advisory takes precedence (matches Phase 1 precedence; Phase 1's advisory is unchanged).
- **PR record with missing or empty title**: renders as an empty title cell; the PR row is still present and the link still resolves via PR id.
- **PR record with null cycle time**: excluded from the PR list for that week (the record cannot be ordered under the cycle-time sort key and would not be part of the closed-PR population that the weekly count represents).
- **Repository name missing from the repositories dimension**: the PR link falls back to a numeric-id-only URL form that Azure DevOps still resolves correctly, so the user can still navigate to the PR.
- **Filter changes while panel is open**: hard-dismissal behavior from Phase 1 applies (panel closes; no content revalidation). Opening after a filter change reflects the new filter state.
- **Tab switch or comparison mode toggled while panel is open**: existing Phase 1 dismissal semantics apply unchanged.
- **Same bar activated twice in succession**: second activation follows Phase 1's retarget / re-open behavior; no divergence from the existing contract.
- **Rollup artifact missing the PR array entirely** (e.g. demo publish output or older artifact): the panel opens without the "PRs" section, matching the Phase 1 aggregate-only view.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each weekly rollup artifact MUST carry an optional list of per-PR records for the weeks that have contributing pull requests. Each record carries exactly five fields: PR id (integer), title (string), author identifier, repository identifier, and cycle time in minutes.
- **FR-002**: The per-PR list MUST be limited to at most 500 records per week, ordered by cycle time descending, with ties broken deterministically by PR id ascending.
- **FR-003**: When a weekly rollup's PR list is truncated, the rollup MUST carry a truncation marker at the rollup level that any consumer can read.
- **FR-004**: The throughput drill-down panel MUST display the PR list as a distinct section alongside (after) the Phase 1 aggregate breakdown sections. Each row MUST show the PR title, its cycle time, and a way to navigate to the pull request in Azure DevOps.
- **FR-005**: The system MUST NOT persist the pull-request web URL in any rollup artifact. Navigation URLs are composed at render time from the PR id, the repository identifier, and the active Azure DevOps context.
- **FR-006**: When no filter is active, or when only an author filter, only a repository filter, or both author and repository filters are active, clicking a throughput bar MUST open the drill-down panel with the PR list rendered.
- **FR-007**: When a team filter is active, when a reviewer filter is active, or when comparison mode is active, clicking a throughput bar MUST NOT open the drill-down panel. The system MUST instead display an explanatory advisory near the clicked bar identifying which filter or mode must be cleared to view PR-level detail.
- **FR-008**: Under any supported filter state, the count of PR records displayed in the panel MUST equal the filtered weekly count displayed on the chart for that week.
- **FR-009**: Under a supported filter state with zero matching PRs for a given week, the panel MUST open normally and render a distinct "empty" presentation for the PR section, not an advisory-style disable message.
- **FR-010**: The advisory presentation used for the unsupported-filter disable states MUST match the existing comparison-mode advisory pattern in visual form, ARIA announcement behavior, dismissal timing, and idempotent stacking behavior.
- **FR-011**: The throughput bar's visible affordance (cursor, accessible name, keyboard focusability) MUST remain in place in both supported and unsupported filter states. Only the outcome of activation changes.
- **FR-012**: The system MUST produce byte-identical rollup artifacts across independent runs given identical source data, including identical PR ordering and content.
- **FR-013**: Weekly rollup artifacts published to any public or demo surface MUST NOT contain PR record arrays, the truncation marker, or any field derived from a PR record.
- **FR-014**: The project documentation MUST include a written privacy posture declaring PR titles and ids to be tenant-sensitive content and requiring their removal from any public or demo surface before publication. The posture MUST be general enough to extend to other tenant-sensitive fields in the future.
- **FR-015**: All Phase 1 drill-down behavior — including panel open/close semantics, focus management, dismissal reasons, existing aggregate breakdown rendering, sparkline navigation, cycle-time and reviewer drill-downs, and existing advisory-toast copy — MUST remain unchanged by this feature.
- **FR-016**: Keyboard activation of a throughput bar (Enter or Space) MUST exhibit the same supported / disabled / empty behavior as mouse-click activation.
- **FR-017**: When a PR list is truncated, the panel MUST display a visible truncation indicator consistent in placement and copy pattern with the Phase 1 truncation indicator used for other chart surfaces.
- **FR-018**: The classification of a filter state as supported or unsupported MUST depend only on which filter dimensions are active — not on whether those filters produce matches — so that an empty supported filter opens the panel (per FR-009) while an unsupported filter disables it (per FR-007) even when the disabled case would have had matches.

### Key Entities *(include if feature involves data)*

- **PR Record**: A single pull request attributed to a weekly rollup. Carries exactly five attributes: numeric PR id (navigation key), title (human-readable subject), author identifier (ties to the Author dimension), repository identifier (ties to the Repository dimension and is the input to URL composition), cycle time in minutes (the sort key).
- **Weekly Rollup (extended)**: The existing aggregate artifact for one ISO week, now optionally carrying a PR Record list and, when applicable, a truncation marker. All Phase 1 fields remain unchanged.
- **Filter State (classified)**: The existing dashboard filter construct. For drill-down purposes, filter states are classified as supported (none, author-only, repository-only, author + repository) or unsupported (team active, reviewer active, comparison mode active). No new fields are added to the filter state itself.
- **Drill-down Advisory**: The existing short, transient, explanatory message component introduced in Phase 1 for comparison mode. Reused with new copy variants for the team-filter and reviewer-filter disable cases.
- **Privacy Posture (new documented contract)**: A project-level written declaration identifying classes of tenant-sensitive fields and prescribing their removal from public/demo publication surfaces. First instance covers PR titles and ids; written to extend to future fields.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user clicking a throughput bar under a supported filter state (including unfiltered) sees the PR list rendered within the panel open animation — no distinct loading state, no additional round-trip — in at least 99% of activations on typical datasets.
- **SC-002**: Across every test fixture week and every supported filter combination (unfiltered, author-only, repository-only, author + repository), the count of PR records rendered in the drill-down panel equals the filtered weekly pr_count for that week in 100% of cases.
- **SC-003**: In every test case where a team filter, reviewer filter, or comparison mode is active, clicking a throughput bar produces 0 opened panels and exactly 1 advisory message naming a specific filter or mode to clear.
- **SC-004**: Every weekly-rollup artifact published to the public/demo surface contains 0 PR record arrays, 0 PR title fields, 0 PR id fields (at PR granularity), and 0 URL fields derived from a PR, verified by an automated check across the full published set.
- **SC-005**: Two independent aggregate-generation runs against the same database state produce byte-identical weekly-rollup output, verified by hash comparison in automated tests.
- **SC-006**: Every Phase 1 drill-down acceptance scenario continues to pass without modification — measured by the existing Phase 1 test set running green unchanged after this feature ships.
- **SC-007**: For every week in the test dataset whose PR count exceeds the truncation cap, the rendered panel contains exactly the cap number of records and the truncation indicator is visible; for every week at or below the cap, the truncation indicator is absent.
- **SC-008**: Keyboard-only users can reach, activate, and dismiss the PR-level drill-down with the same outcomes as mouse users across supported, disabled, and empty states.

## Assumptions

- Users viewing PR-level drill-down inside the Azure DevOps extension already have ADO permission to view the underlying pull requests; PR titles and ids are not newly exposed to them by this feature.
- Public and demo surfaces are assumed to have zero tenant-data access rights; therefore stripping PR records at the publish boundary is sufficient privacy mitigation for the Phase 1 public surface.
- The existing repositories dimension carries sufficient repository-name information to compose human-navigable pull-request URLs from a PR id and repository identifier at render time.
- The Azure DevOps web context available to the running extension provides the organization and project identifiers needed for URL composition.
- A per-week cap of 500 PR records is sufficient to satisfy the "explain the spike" user value even for very high-throughput weeks, validated against the M1 measurement where real-seed weeks peaked at 464 PRs.
- Cycle time in minutes is well-defined for every PR that contributes to the weekly count; PRs without cycle time are not part of the weekly count population and are therefore not part of the PR list.
- The extension runtime supports stable Array.prototype.sort (ECMAScript 2019 and later), which Azure DevOps's Chromium-based environment provides; determinism of client-side ordering relies on this.
- Adding the PR-record array to the rollup artifact stays within the existing 500 KB per-file cap even at worst-case enterprise scales (validated by M2 measurement).
- Phase 1's existing aggregate breakdown drill-down behavior (unfiltered breakdowns under active filters) is retained as-is in this slice and is explicitly out of scope for upgrade; any future unification is a separate change.

## Out of Scope

- Team-filter support for the PR-level drill-down (the user must clear the team filter to view PR-level detail).
- Reviewer-filter support for the PR-level drill-down (the user must clear the reviewer filter to view PR-level detail).
- Comparison-mode PR-level drill-down (deferred; Phase 1 comparison-mode behavior preserved unchanged).
- PR-level drill-down for the cycle-time, reviewer-activity, or summary-card-sparkline chart surfaces.
- URL-bookmarkable drill-down state carrying a selected PR.
- PR-level detail on the CSV or PowerBI export surfaces.
- Upgrading Phase 1's `by_author` and `by_repository` aggregate breakdowns to also honor the stricter filter-identity invariant introduced here.
- Expansion of PR-record field set beyond the five explicitly scoped fields (id, title, author identifier, repository identifier, cycle time).
- Cross-dimensional aggregates needed to expand supported filters in future slices.
- Snapshot-cadence changes: PR titles may lag between an upstream edit and the next aggregate-generation run; this matches the existing pipeline snapshot cadence and is not tightened here.

## Source References

- Issue #205 (closed, Phase 1 shipped): the original drill-down request and the 2026-03-29 owner comment establishing PR-level detail as the Phase 2 "high-value unlock."
- Issue #300 (open): the Phase 2 deferred-items tracker; this feature is the first Phase 2 delivery against that catalog.
- Phase 1 spec (`specs/059-chart-drill-down/`): the contract this feature inherits and extends (DetailPanel lifecycle, lifecycle signals, advisory-toast pattern, dismissal reasons, truncation UI conventions).
- In-session measurement pass M1–M5: worst-case historical PRs/week, projected rollup byte envelope with the locked field set at 500-PR truncation, public-surface privacy audit, filter-path traversability analysis that motivated the expanded field scope, and schema parity inventory.
