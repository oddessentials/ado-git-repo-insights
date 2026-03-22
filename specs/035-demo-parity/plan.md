# Demo Parity Implementation Plan

**Feature Branch**: `035-demo-parity`
**Working Branch**: `034-roadmap-closure`
**Created**: 2026-03-21
**Status**: Draft
**Purpose**: Capture the implementation plan for making the CLI dashboard demo and GitHub Pages demo a single, enterprise-grade parity surface backed by one canonical synthetic dataset pipeline.

## Objective

The public demo must stop being a best-effort preview and become a governed product surface.

The target state is:

1. The extension dashboard and CLI dashboard use the same UI bundle and expose the same supported feature set.
2. The CLI synthetic demo and GitHub Pages synthetic demo use the same generated dataset bytes.
3. The synthetic demo dataset is intentionally designed to exercise the full breadth of supported dashboard capabilities.
4. Demo drift becomes a CI failure, not a manual review concern.

## Non-Negotiable Contracts

These contracts govern the implementation. If a design choice conflicts with them, the contract wins.

### Contract 1: Single UI Bundle Parity

The extension dashboard and CLI dashboard MUST render from the same bundled UI assets. No demo-only dashboard code path may fork feature behavior, defaults, or rendering logic.

### Contract 2: Single Canonical Demo Dataset

There is exactly one canonical generated demo dataset for synthetic enterprise preview use. The CLI demo and GitHub Pages demo MUST consume the same dataset bytes from the same build output.

### Contract 3: Canonical Build Output And Promotion Flow

The canonical build output directory MUST be:

`artifacts/demo-enterprise/`

The promotion flow MUST be:

1. Generate into `artifacts/demo-enterprise/`
2. Validate contract, parity, and coverage gates against `artifacts/demo-enterprise/`
3. Atomically replace `docs/data/` from `artifacts/demo-enterprise/data/`
4. Fail if any generated file is not manifest-addressable or any stale file survives promotion

No second build output root is allowed for the enterprise demo profile.

### Contract 4: Generated-Only Published Demo Data

`docs/data/` is generated-only. It MUST NOT be hand-edited. The only supported refresh path is the canonical demo build command followed by promotion.

### Contract 5: Enterprise Demo Capability Matrix

"Exercises all supported dashboard capabilities" is defined by the explicit capability matrix in this plan. CI MUST validate the expected user-visible state for every matrix row, not merely the presence of source data.

### Contract 6: Versioned Demo Profile

The enterprise demo profile is deterministic and versioned. Silent behavioral changes are not allowed.

The demo profile version MUST live in:

- the generator profile definition
- `dataset-manifest.json` under a dedicated `demo_profile` metadata block
- `docs/DEMO-DATA-VERSIONING.md`

Version bump rules:

- PATCH: deterministic refresh with no user-visible behavior change and no capability matrix change
- MINOR: additive capability coverage, richer scenarios, or increased scale with backward-compatible behavior
- MAJOR: removed capability coverage, changed startup behavior, changed canonical paths, changed schema/semantics, or any user-visible demo behavior change that would alter expected manual walkthrough results

### Contract 7: Atomic Promotion With Destination Cleanup

Promotion to `docs/data/` MUST clean the destination root before replacement. No stale files may survive between refreshes.

Every generated file under the canonical build output MUST be enumerated either:

- directly in `dataset-manifest.json`, or
- by a manifest-declared glob/pattern for additive collections such as comments batches

Any extra file in `docs/data/` after promotion is a release defect.

### Contract 8: Normalized Startup-State Parity

Using the same dataset and UI bundle is necessary but not sufficient. Parity tests MUST compare normalized startup state across surfaces, including:

- local mode flags
- dataset root resolution
- default date range behavior
- feature/capability interpretation
- default selected filters
- query parameter precedence
- synthetic preview banners and notices

Differences are only acceptable when explicitly declared as hosting-only concerns with no effect on rendered dashboard behavior.

## Canonical Artifact Boundary

### Canonical Build Command

Implementation should introduce a single orchestrator command, either:

- `python scripts/build-demo-dataset.py`

or

- `ado-insights build-demo-dataset`

This command becomes the only supported entrypoint for enterprise demo regeneration.

### Canonical Output Layout

The canonical output layout is:

```text
artifacts/demo-enterprise/
├── data/
│   ├── dataset-manifest.json
│   ├── aggregates/
│   ├── predictions/
│   └── insights/
├── report/
│   ├── capability-matrix.json
│   ├── startup-parity.json
│   └── generation-summary.md
└── metadata/
    └── demo-profile.json
```

`docs/data/` is a promoted copy of `artifacts/demo-enterprise/data/` only.

The CLI local demo should consume `artifacts/demo-enterprise/data/` directly during development, and `docs/data/` only as the published mirror.

## Enterprise Demo Capability Matrix

The enterprise demo profile MUST deliberately exercise the following capabilities. Presence of data alone is not sufficient; each row defines the expected user-visible state that tests must validate.

| Capability | Dataset Requirement | Expected User-Visible State |
|------------|---------------------|-----------------------------|
| Long history | 156+ weekly rollups | Throughput and cycle-time charts render multi-year history without truncation defects |
| Large user population | 200+ users/reviewers | Author and reviewer filters remain usable at enterprise scale |
| Author filtering | `capabilities.author_filters = true` and populated `by_author` | Author filter control is visible and materially changes summary cards and charts |
| Exact author x repository | `capabilities.author_repo_exact = true` and populated `by_author_and_repo` | Selecting author + repository yields exact metrics, not fallback-only behavior |
| Deterministic truncation | bounded intersections with explicit metadata | UI exposes the intended truncated state or deterministic bounded result consistently |
| Comments enabled | `features.comments = true` and auxiliary comment data present | Comments coverage state is visible in run info/banner and metrics use comment-aware data |
| Comments partial coverage | dedicated scenario in generated data | Partial-coverage banner/notice is rendered and labeled correctly |
| Reviewer + repository constrained mode | `capabilities.reviewer_repository_mode = constrained` | Reviewer + repository interaction shows the constrained-mode notice, not silent ambiguity |
| Reviewer + team disallowed mode | `capabilities.reviewer_team_mode = disallowed` | Reviewer + team interaction clears or blocks unsupported state with explicit UX signal |
| Team filtering | populated `by_team` | Team selection materially changes metrics and charts |
| Cross-dimensional team x repo | populated `by_team_and_repo` | Team + repository selection yields exact cross-dimensional data |
| Predictions tab | predictions files present | Predictions tab loads deterministic synthetic predictions |
| AI insights tab | insights files present | AI Insights tab loads deterministic synthetic insights |
| Synthetic preview disclosure | synthetic metadata present | Demo banner/disclaimer is always visible on docs and CLI-hosted demo surfaces |

The implementation MUST add a machine-readable version of this matrix under:

`artifacts/demo-enterprise/report/capability-matrix.json`

## Enterprise Demo Profile Requirements

The enterprise demo profile should be implemented as a named generator profile rather than a loose set of flags.

Recommended profile name:

`enterprise-demo`

Minimum profile properties:

- `weeks >= 156`
- `users >= 200`
- comments enabled
- author filtering enabled
- exact author x repository intersections enabled
- team and repository breakdowns enabled
- reviewer constrained/disallowed semantics represented
- deterministic seed
- enough sparsity and bounded intersections to exercise truncation and notice paths

The profile should be scenario-aware, not just statistically random. It must intentionally create:

- weeks with strong author-specific activity
- exact author x repository intersections
- at least one partial comments-coverage scenario
- at least one reviewer + repository constrained-mode path
- at least one reviewer + team disallowed path
- enterprise-scale filter populations where search/select usability matters

## Promotion And Publishing Flow

### Build

Generate all demo artifacts into `artifacts/demo-enterprise/`.

### Validate

Run, at minimum:

1. dataset contract validation
2. capability matrix validation
3. startup-state parity validation
4. dashboard interaction parity validation
5. deterministic regeneration check

### Promote

Promotion must:

1. remove all existing contents of `docs/data/`
2. copy only `artifacts/demo-enterprise/data/` contents into `docs/data/`
3. verify destination file set exactly matches source file set
4. fail if any stale file remains

### Publish

GitHub Pages serves `docs/` as the public mirror.

## Test Strategy

### 1. Generator Contract Tests

Add tests that verify:

- enterprise profile emits the required manifest capabilities
- enterprise profile emits 156+ weeks and 200+ users/reviewers
- deterministic re-runs are byte-identical
- every published file is manifest-addressable
- promotion removes stale files

### 2. Capability Matrix Tests

Add tests that load the generated dataset and assert every matrix row above is exercised by at least one explicit scenario.

These tests must validate rendered behavior where applicable, not just raw JSON presence.

### 3. Startup-State Parity Tests

Add parity tests that compare normalized startup state for:

- CLI-hosted local mode
- docs/GitHub Pages local mode
- extension dataset-loading mode where relevant

Normalization should compare:

- resolved dataset root
- effective capability interpretation
- effective default date range
- default filter state
- visible startup notices/banners

### 4. Interaction Parity Tests

Run the same interaction suite against:

- CLI-hosted enterprise demo dataset
- docs-hosted enterprise demo dataset

Required interaction coverage:

- author filter
- author + repository exactness
- reviewer + repository constrained notice
- reviewer + team disallowed notice
- comments coverage states
- team + repository exact cross-dimensional behavior

### 5. Drift Tests

CI must fail when:

- `docs/data/` differs from promoted canonical output
- capability matrix report changes unexpectedly without checked-in updates
- startup parity report changes unexpectedly without checked-in updates

## Required Documentation Updates

Implementation should update:

- `.specify/memory/constitution.md`
- `docs/DEMO-DATA-VERSIONING.md`
- `docs/reference/dataset-contract.md`
- `docs/user-guide/local-cli.md`
- `docs/user-guide/extension.md`
- `README.md`

The constitution update should explicitly codify:

- CLI and extension dashboard parity
- single canonical synthetic demo dataset
- demo capability coverage as a release gate

## Implementation Phases

### Phase 1: Governance And Artifact Boundary

- add parity governance to the constitution
- add demo profile versioning rules
- lock canonical output root and promotion flow
- document generated-only status for `docs/data/`

### Phase 2: Generator Refactor

- refactor synthetic generation into named profiles
- implement `enterprise-demo` profile
- emit machine-readable metadata and reports
- make generator scenario-aware for feature coverage

### Phase 3: Promotion Pipeline

- implement canonical build command
- implement clean promotion into `docs/data/`
- verify destination cleanup and manifest-addressable outputs

### Phase 4: Parity Test Hardening

- add startup-state parity tests
- add interaction parity tests
- add capability matrix tests
- add drift/freshness tests for `docs/data/`

### Phase 5: CI And Developer Workflow

- wire canonical demo generation into CI
- fail on drift or stale output
- document local regeneration and parity verification workflow

## Acceptance Criteria

The follow-up implementation is complete only when all of the following are true:

1. One canonical command regenerates the enterprise demo deterministically into `artifacts/demo-enterprise/`.
2. `docs/data/` is a clean promoted mirror of `artifacts/demo-enterprise/data/`, with no stale files.
3. CLI and GitHub Pages demo surfaces consume the same dataset bytes.
4. The capability matrix is fully exercised and validated by automated tests.
5. Startup-state parity is validated in automated tests, not assumed.
6. Demo profile version metadata exists and version bump rules are documented.
7. CI fails on demo drift, stale promoted output, or missing capability coverage.
8. The public demo remains enterprise-scale and reflects the latest supported dashboard feature set.

## Risks To Watch

- Overfitting generator logic to tests rather than to user-visible realism
- Adding data presence without adding the exact user-visible state the matrix requires
- Allowing CLI and docs hosting wrappers to diverge in startup defaults
- Treating `docs/data/` as a checked-in fixture instead of a promoted artifact
- Allowing versionless demo behavior changes to slip through as routine refreshes

## Immediate Follow-Up

The next implementation pass should start by converting this plan into executable spec/tasks artifacts and then implementing on the current branch.
