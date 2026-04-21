# Feature Specification: Synthetic Demo Exercises PR-Level Detail

**Feature Branch**: `309-demo-pr-drilldown`
**Created**: 2026-04-20
**Status**: Draft
**Input**: User description: "Issue #315 — Demo generator emits PR-level detail; FR-023 narrowed from destination-identity to provenance-based."
**Closes**: #315 (GitHub issue)
**Related**: #318 (Phase 2 drill-down catalog — downstream; narrowest-shippable scope for this feature is explicitly captured at https://github.com/oddessentials/ado-git-repo-insights/issues/318#issuecomment-4285663430)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Public demo viewer sees PR-level drill-down working (Priority: P1)

A prospective adopter visits the public demo at https://oddessentials.github.io/ado-git-repo-insights/, clicks a throughput bar on a week with PR activity, and sees the PR-detail section of the drill-down panel populated: individual PR rows with cycle time and a clickable link — the feature-060 surface as the extension delivers it against a real tenant, but without requiring the viewer to run the extension or have tenant credentials.

**Why this priority**: This is the central value delivery of the whole feature. Without it, the public demo silently misrepresents what the extension does. Every day it stays broken is a day prospective adopters form a wrong impression of the feature set.

**Independent Test**: Visit the public demo surface, click a throughput bar on any non-empty week, confirm the drill-down panel's PR-detail section renders ≥ 1 PR row with cycle_time and a link target. Delivers the "demo exercises the feature" outcome on its own, independent of truncation or filter behavior.

**Acceptance Scenarios**:

1. **Given** the public demo is loaded and the viewer has an unfiltered throughput chart, **When** the viewer clicks a bar corresponding to a week with ≥ 1 PR, **Then** the drill-down panel opens with a PR list showing at least one row, each row containing the PR's cycle time and a link.
2. **Given** the viewer applies a repository filter to the throughput chart, **When** the viewer clicks a non-empty bar, **Then** the rendered PR count matches the chart's filtered count.
3. **Given** the viewer applies an author filter, **When** the viewer clicks a non-empty bar, **Then** the rendered PR count matches the chart's filtered count.

---

### User Story 2 — Tenant PR data never leaks to the public demo surface (Priority: P1)

A tenant of the extension extracts PR data from their own Azure DevOps organization, aggregates it, and either (a) publishes a private dashboard for their team, or (b) operates the demo-build pipeline locally with their tenant data present. In either case, the public demo surface served at the project's GitHub Pages URL must NEVER contain any PR-level field sourced from their tenant.

**Why this priority**: This is the privacy / compliance invariant that feature 060's FR-023 was written to enforce. Relaxing it without a provenance distinction was the gap that kept the demo empty; narrowing it without a rigorous fail-closed mechanism would leak tenant PR titles, ids, authors, repos, or cycle-times into a world-readable static site. P1 because privacy regressions are irreversible once published.

**Independent Test**: Run the demo-build pipeline end-to-end against a source artifact that contains PR-level fields shaped like tenant output (i.e., no synthetic-authorization provenance signal). Verify the published artifact surface has zero rollups carrying `prs`, `_prs_truncated`, or `_prs_cap`. Delivers the privacy invariant on its own, independent of whether synthetic PR data ever reaches the surface.

**Acceptance Scenarios**:

1. **Given** a source artifact with PR-level fields and no synthetic-authorization provenance, **When** the pipeline promotes the artifact to the public-surface destination, **Then** every rollup at the destination has `prs`, `_prs_truncated`, and `_prs_cap` absent.
2. **Given** a source artifact shaped like tenant output, **When** any failure occurs during promotion, **Then** the public-surface destination is byte-identical to its pre-run state (no partial publishes).
3. **Given** any code path under the tenant extraction or aggregation surface, **When** reviewed for synthetic-authorization signal writes, **Then** no such write exists (only the demo-orchestrator script is authorized to emit the provenance signal).

---

### User Story 3 — Truncation indicator is observable on the public demo (Priority: P1)

A prospective adopter examining the public demo navigates to a week where PR volume exceeds the display cap and sees the truncation indicator rendered with both the "showing" and "total" counts; on neighboring weeks they see a full un-truncated list, giving them an obvious visual contrast that demonstrates the indicator exists.

**Why this priority**: The truncation indicator (`_prs_truncated`) is a distinct user-visible surface that must be observable on the demo or its existence cannot be verified by prospective adopters. Paired with Story 1 it forms the complete throughput drill-down demo. Priority P1 because the indicator is a first-class part of feature 060's contract, not an edge case.

**Independent Test**: On the public demo, navigate to the contracted truncation-exercise week (2025-W26) and confirm the truncation indicator renders. Navigate to each contracted neighbor week (2025-W25, 2025-W27) and confirm no truncation indicator renders. Delivers the truncation-indicator verification outcome on its own.

**Acceptance Scenarios**:

1. **Given** the synthetic demo is published, **When** the viewer opens the drill-down panel for week 2025-W26, **Then** the truncation indicator renders with the cap value (500) and a displayed count at the cap.
2. **Given** the synthetic demo is published, **When** the viewer opens the drill-down panel for week 2025-W25 or 2025-W27, **Then** the truncation indicator does NOT render, and the displayed count equals the actual PR count (< 500).

---

### User Story 4 — Developer regenerates the demo and sees byte-deterministic, non-PR-field content stability (Priority: P2)

A developer running a release or a local demo rebuild on the baseline Python interpreter expects the regenerated artifact set to differ from the previous committed set ONLY by the addition of the three PR-level fields on weekly rollups. Every other field — aggregate counts, per-author / per-repo / per-reviewer / per-team breakdowns, cycle-time percentiles, review-time percentiles — must be byte-identical to the prior committed state.

**Why this priority**: A byte-determinism regression would break an existing invariant that the feature-060 and earlier features depend on. Priority P2 because detection is CI-side rather than user-side, but if the invariant breaks silently the cost is downstream test / dashboard drift.

**Independent Test**: Regenerate the demo artifact set on the baseline Python interpreter. For every committed rollup, remove the three PR-level fields from the regenerated version, re-serialize using the aggregator's canonical JSON formatting, and byte-compare to the committed bytes. Every week's non-PR content MUST byte-match.

**Acceptance Scenarios**:

1. **Given** the committed demo artifact set at the atomic regen commit, **When** the demo is regenerated on the baseline Python version with the same seed, **Then** for every rollup, the content excluding PR-level fields is byte-identical to the committed version (key order, whitespace, trailing newline, unicode-escape policy all match).
2. **Given** a post-regen artifact set, **When** the PR-level fields are removed and the rollup re-serialized, **Then** the byte-compare against the committed rollup passes.

---

### User Story 5 — Engineer working in tenant-producer code cannot accidentally bypass the privacy gate (Priority: P2)

An engineer modifying code in the tenant extraction or aggregation surface accidentally writes the synthetic-authorization signal (copy-pasted helper, misplaced test fixture, etc.). The repository's automated gates MUST catch this before merge and explain what went wrong in terms the engineer can act on.

**Why this priority**: Defense-in-depth on the privacy invariant. The sentinel mechanism works IF only the authorized orchestrator writes it. If any tenant path can write it, the narrowing regresses to blanket-publishing tenant data. P2 because it's a containment rule, not a user-visible behavior.

**Independent Test**: Introduce a line in any file under the tenant producer surface that writes the synthetic-authorization signal. Run the negative-provenance gate locally. The gate MUST fail with a clear diagnostic naming the offending file and line.

**Acceptance Scenarios**:

1. **Given** a commit adds a synthetic-authorization signal write under the tenant-producer surface, **When** the negative-provenance gate runs, **Then** the gate fails with the offending file path and a message explaining which source trees may authorize synthetic publication.
2. **Given** the orchestrator script writes the signal as part of its normal flow, **When** the negative-provenance gate runs, **Then** the gate passes (the orchestrator is the single authorized writer).

---

### User Story 6 — Developer rebuilding demo with uncommitted changes cannot accidentally publish undefined state (Priority: P3)

A developer iterating on the demo generator locally has pending edits in their working tree or index when they kick off the promotion step. The promotion MUST refuse to run until the inputs are either fully committed or the developer explicitly acknowledges the dirty state via an override flag intended for local dev only.

**Why this priority**: Without this guard, a demo rebuild can publish a snapshot that corresponds to no reviewable commit, making post-hoc diagnosis of "what produced this output" impossible. P3 because it's primarily a developer-experience / auditability concern, not a user-visible behavior.

**Independent Test**: Make an uncommitted change to a demo-input file. Run the demo-build promotion step without any override flag. The step MUST exit with an error distinguishing between "unstaged" and "staged-but-not-in-HEAD" inputs.

**Acceptance Scenarios**:

1. **Given** an unstaged change in a demo-input file, **When** the demo-build promotion runs, **Then** the step exits with a diagnostic naming the unstaged files.
2. **Given** a staged change in a demo-input file that is NOT yet in HEAD, **When** the demo-build promotion runs, **Then** the step exits with a diagnostic naming the staged files.
3. **Given** a clean worktree AND a clean index for all demo-input files, **When** the demo-build promotion runs, **Then** the step proceeds.

---

### Edge Cases

- **Manually-planted signal in the published tree**: someone commits or manually creates the synthetic-authorization signal file under the public demo surface directly. The pre-push gate MUST refuse the push; the gate is pre-push-local AND CI-side (defense in depth).
- **Partial promotion failure after the authorization signal is consumed**: the pipeline unlinks the signal as the first mutation, then the copy step fails. The authorization signal is already gone; a retry without re-authoring the signal MUST fall back to the strip path (fail-closed), NOT silently publish PR data from the source.
- **Tenant source artifact that coincidentally also contains the signal file**: the gate MUST NOT trust source-origin alone. The combined check is: signal present AND source shape matches synthetic contract (assert-shape check). A signal placed on a tenant-shaped source raises a gate error, not a silent bypass.
- **RNG-stream drift from new randomness elsewhere**: any code change that calls the shared RNG before the synthetic PR generator runs shifts the stream and breaks byte-determinism. Mitigation is an isolated seed offset for the PR generator's RNG.
- **ISO week-boundary drift in the contracted truncation week**: if the synthetic calendar ever changes how 2025-W26 is computed, the truncation-exercise hard-codes become misaligned. The contracted weeks must be defined by their literal ISO-week labels, not by a date offset.
- **Demo contract version pinning in downstream consumers**: if a dashboard or a downstream CI pins the demo profile version, bumping the version without coordinating is a breaking change. The bump is explicit and atomic with the schema change so the version is the sole drift-detection signal.
- **Shape drift between the aggregator's PR record type and the synthetic output**: if the aggregator ever adds a field to its PR record, the synthetic generator will byte-mismatch. The synthetic generator imports the canonical PR record type from the aggregator's source module rather than redefining it, so type-shape drift is caught at static-analysis time.
- **Committed distribution fixture leaks a tenant identifier**: a statistical-summary JSON derived from tenant data accidentally retains a title fragment, author id, repo name, or team label. A privacy-review gate at commit time asserts zero tenant tokens leak into the committed fixture.

## Requirements *(mandatory)*

### Functional Requirements

#### Synthetic demo output

- **FR-001**: The synthetic demo MUST emit PR-level detail fields (PR records array, truncation flag, cap value) on every weekly rollup that has PR activity.
- **FR-002**: Synthetic PR records MUST conform to the aggregator's existing PR record shape — id (integer), title (string), author id (string), repository id (string), cycle time (float) — with zero tenant-identifying content in any field.
- **FR-003**: Synthetic week 2025-W26 MUST produce more than 500 qualified PRs so the truncation flag is true and the displayed count equals the cap.
- **FR-004**: Synthetic weeks 2025-W25 and 2025-W27 MUST each produce at most 500 qualified PRs so the truncation flag is false for both.
- **FR-005**: Synthetic PR records on every rollup MUST be sorted stably by descending cycle time, tiebreak by ascending id.
- **FR-006**: The synthetic generator MUST reuse the aggregator's canonical PR record type from the shared type module; it MUST NOT redefine the shape.
- **FR-007**: The synthetic generator MUST derive PR titles, cycle times, author / repository assignments, and per-week counts from committed statistical distribution fixtures — not from hard-coded literals and not from live tenant data.

#### Privacy gate (FR-023 narrowing)

- **FR-008**: Promotion to the public demo surface MUST be governed by a binary, fail-closed gate keyed on a synthetic-authorization provenance signal carried alongside the source artifact.
- **FR-009**: When the provenance signal is absent, promotion MUST strip PR-level fields from every rollup (preserving the feature-060 FR-023 tenant privacy invariant).
- **FR-010**: When the provenance signal is present, promotion MUST additionally verify the source has the synthetic-contract shape before proceeding; if the shape check fails, promotion MUST abort and leave the destination byte-identical to its pre-call state.
- **FR-011**: The provenance signal MUST NOT reach the public demo surface under any pathway (success, failure, or retry).
- **FR-012**: The provenance signal MUST be written by the demo-orchestrator surface only; every other code surface (tenant extraction, aggregation, dashboard, extension) MUST NOT write it.
- **FR-013**: The privacy anchor in the dataset contract document MUST continue to precede producer code that emits PR-level detail (preserve FR-014 ordering invariant from feature 060).

#### Determinism and auditability

- **FR-014**: Demo artifact regeneration on the baseline Python interpreter with the committed seed MUST be byte-deterministic, including key insertion order, whitespace, trailing newlines, and unicode-escape policy.
- **FR-015**: The byte-equality invariant MUST hold for all non-PR rollup content compared to the previously committed state; only the three PR-level fields may differ between the old committed set and a freshly regenerated set at the atomic commit boundary.
- **FR-016**: The synthetic PR generator MUST use an isolated random-number stream so that adding synthetic PR generation does not perturb any other random stream in the demo pipeline.
- **FR-017**: The demo contract version identifier MUST bump atomically with any schema-visible change to synthetic rollups, and MUST NOT bump without a schema-visible change.
- **FR-018**: The promotion step MUST refuse to run if inputs to the synthetic generation (the generator script, the distribution fixtures, the orchestrator) have unstaged OR staged-but-not-in-HEAD differences, unless an explicit local-dev override is provided.

#### Verification gates

- **FR-019**: An automated gate MUST detect any code path under the tenant-producer surface that writes the synthetic-authorization signal and fail the build with a diagnostic naming the offending path.
- **FR-020**: An automated gate MUST verify the synthetic-authorization signal is absent from the public demo surface and fail the build if present, at both the pre-push boundary AND as a first step of any continuous-integration job that invokes the demo builder.
- **FR-021**: An automated gate MUST verify the binary gate behavior by running the same entrypoint command locally (pre-push) and in continuous integration against a fixture matrix containing both signal-present and signal-absent cases; the local and CI outcomes MUST match per fixture.
- **FR-022**: An automated contract test MUST verify the truncation boundary at exactly (499 qualified → not truncated, length 499), (500 qualified → not truncated, length 500), and (501 qualified → truncated, length 500).
- **FR-023**: An automated contract test MUST assert the literal truncation-exercise week (2025-W26) is truncated and the literal contrast weeks (2025-W25 and 2025-W27) are not.
- **FR-024**: A privacy-review gate MUST assert the committed distribution fixture contains no tenant-identifying strings.

### Key Entities

- **Synthetic PR Record**: A PR-level detail entry emitted on weekly rollups, conforming to the aggregator's canonical 5-field shape. Distinct from tenant PR records in that its content is synthesized from statistical distributions and contains no tenant-identifying information.
- **Synthetic-Authorization Signal**: A zero-length provenance marker placed alongside the source artifact by the demo orchestrator, consumed and removed at the publish boundary. Its presence attests that the source PR-level detail is synthetic and may be published; its absence signals tenant provenance and mandates stripping.
- **Statistical Distribution Fixture**: An anonymized summary (token frequencies, cycle-time distributions per repository size class, author-per-week / author-per-repo concentration, PR-count-per-week per repository) derived one-time from a real tenant extract and committed to the repo. Source of truth for synthetic generator randomness shape; never contains tenant-identifying strings.
- **Demo Contract Version**: A semantic version identifier on the dataset manifest signaling the synthetic demo schema revision. Bumps atomically with schema-visible changes; serves as the single drift-detection signal for downstream consumers.
- **Weekly Rollup**: The existing aggregated demo artifact (one JSON per ISO week). Extended in this feature with three PR-level fields when published from a synthetic source.
- **Public Demo Surface**: The subset of the repository published to the GitHub Pages endpoint at https://oddessentials.github.io/ado-git-repo-insights/. Privacy invariant applies only to this destination; private tenant artifacts are unaffected.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every feature-060 user-visible drill-down surface (PR rows, truncation indicator, filter-consistent counts on unfiltered / author-only / repo-only / author+repo filter states, PR-link click target, inline gated message under team / reviewer filters) is observable on the public demo surface without running the extension against a real tenant.
- **SC-002**: 100% of source artifacts lacking the synthetic-authorization provenance signal have PR-level fields stripped before reaching the public demo surface (tenant-privacy invariant preserved end-to-end).
- **SC-003**: 0% of provenance signal markers appear in the public demo surface across any promotion outcome (success, partial failure, retry).
- **SC-004**: Demo artifact regeneration on the baseline Python interpreter produces, for every rollup, byte-identical non-PR-field content compared to the prior committed state.
- **SC-005**: Week 2025-W26 exhibits the truncation indicator with the cap value 500; weeks 2025-W25 and 2025-W27 do not exhibit the truncation indicator.
- **SC-006**: 0 code paths outside the demo-orchestrator script write the synthetic-authorization provenance signal.
- **SC-007**: The demo contract version identifier bumps exactly once, atomically co-committed with the schema change; no intermediate commit exhibits version-schema drift.
- **SC-008**: The binary privacy gate produces identical outcomes (pass/fail + diagnostic keyword) locally and in continuous integration across a fixture matrix containing both signal-present and signal-absent cases.
- **SC-009**: The committed statistical distribution fixture contains zero tenant-identifying strings (titles, author ids, repo names, team labels, email patterns).
- **SC-010**: The truncation contract holds at the exact boundaries 499 / 500 / 501 qualified PRs.

## Assumptions

- Baseline Python interpreter for deterministic demo regeneration remains 3.12.x (unchanged from feature 060 and prior demo builds).
- The existing extension UI (delivered in feature 060) renders any rollup carrying the 5-field PR record shape without further UI work; the feature's scope stops at making those rollups available on the demo surface.
- The one-time tenant extract used to derive the statistical distribution fixture operates on a developer-controlled local SQLite database; only the derived anonymized summary is committed.
- The developer running the distribution derivation holds a valid Azure DevOps Personal Access Token with read scope for the tenant organization, passed via environment variable — never persisted to the repository, never embedded in argv.
- Prospective adopters visiting the public demo have modern browsers supporting the existing extension SDK rendering requirements (no new browser capability is introduced by this feature).
- The synthetic demo's truncation-exercise week is identified by its ISO-week label (2025-W26), which is stable across the project's canonical calendar computations.
- Downstream consumers of the dataset manifest use the demo contract version identifier as their drift-detection signal and will treat a bump as a breaking change.
- The repository's existing pre-commit, pre-push, and CI gate infrastructure is the enforcement surface for all new automated gates introduced by this feature; no new enforcement infrastructure is required.
- The PR links emitted on synthetic demo rows are intentionally non-resolvable (they point at a synthetic organization / project / repository namespace); the link-rendering surface is observable but clicked URLs return 404 from Azure DevOps. This is acknowledged as a known limitation of a synthetic demo.
- The distribution-derivation step is one-time and reproducible from the committed fixture onward; re-running the demo build does not re-contact the tenant.
- **Tenant extract richness is a non-goal.** The one-time tenant SQLite is a minimal provenance/blocklist seed for shape-safe derivation — not a representative population sample. Synthetic richness (volume, author/repo diversity, title variety) is the product surface and lives in `scripts/generate-demo-data.py` plus the committed distribution fixtures, not in the upstream extract. Future work MUST NOT widen the extract (date range, projects, `--include-comments`, etc.) for the purpose of "improving" the seed.
