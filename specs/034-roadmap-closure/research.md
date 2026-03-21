# Research: Roadmap Closure Program

**Feature**: 034-roadmap-closure
**Date**: 2026-03-21

## Phase 0 Research Findings

### R-01: Core CSV Contract Boundary

**Decision**: Keep the six existing PowerBI-facing CSVs as the only core contract CSVs. Any comments CSVs added by this program are auxiliary outputs and must be validated separately.

**Rationale**:
- The constitution makes the CSV boundary non-negotiable.
- Current downstream consumers rely on exact names and column order for `organizations`, `projects`, `repositories`, `pull_requests`, `users`, and `reviewers`.
- Author filtering and comments analytics do not require core CSV mutation because their primary user-facing surfaces are JSON aggregates, manifest capabilities, and dashboard behavior.

**Alternatives considered**:
1. Extend existing core CSVs with comment or author-specific columns
   Rejected: violates constitution risk boundary and creates needless PowerBI migration cost.
2. Promote comments CSVs to core contract immediately
   Rejected: unnecessary for roadmap closure and would force wider contract, docs, and compatibility churn.

---

### R-02: Canonical Author Identity

**Decision**: Use immutable Azure DevOps `user_id` as the canonical author key for author slices and author x repository joins. Display names and emails remain labels only.

**Rationale**:
- The constitution already establishes “names as labels, IDs as identity”.
- The current repository persists PR authors with `pull_requests.user_id` and dimensions data from `users`.
- Name-keyed author slices would fragment when display names change and would make FR-006 invariants unstable.

**Fallback rules**:
- If `display_name` changes, aggregate identity stays with the same `user_id`.
- If no stable display label is available, use a deterministic fallback label while keeping the real key as `user_id`.
- Cross-project references must still honor org/project scoping in aggregate interpretation.

**Alternatives considered**:
1. Key by display name
   Rejected: rename collisions and fragmentation risk.
2. Dual-key author aggregates (name plus id) as primary storage
   Rejected: added complexity without solving any roadmap requirement better than ID-first design.

---

### R-03: Additive Slice Cardinality Control

**Decision**: Use bounded additive slice generation with deterministic truncation for high-cardinality cross-dimensional outputs. Exactness is guaranteed only for retained entries, and truncation must be explicitly signaled.

**Rationale**:
- Existing code already uses `_CROSS_DIM_MAX_ENTRIES = 5000` and truncation for team x repository work.
- Author x repository can grow faster than team x repository and must not introduce unbounded cartesian expansion in generation or loader cost.
- Enterprise-scale synthetic dataset gates require predictable performance, not best-effort full expansion.

**Policy**:
- Root `by_author` slices remain fully generated because they scale with weekly distinct authors, not author-repository pairs.
- `by_author_and_repo` uses a configured entry ceiling, deterministic ranking, and explicit truncation/capability signal.
- Reviewer combined semantics cannot introduce unbounded nested slice expansion; if bounded exact support is not viable, use `constrained` or `disallowed-with-ux-signal`.

**Locked truncation rule**:
- retain highest `pr_count` entries first
- for ties, sort by `author_id` ascending
- for remaining ties, sort by `repository_name` ascending
- emit an explicit truncation signal whenever entries were dropped

**Alternatives considered**:
1. Generate all intersections always
   Rejected: unbounded growth in dense enterprise datasets.
2. Lazy frontend computation from root slices
   Rejected: root slices are insufficient for exact intersections and would reintroduce estimation ambiguity.

---

### R-04: Comments Contract Status

**Decision**: Lock comments CSVs as auxiliary outputs for this roadmap program.

**Rationale**:
- This removes a major source of downstream churn before implementation begins.
- The roadmap can complete comment user value through auxiliary CSV exports, aggregate JSON, manifest coverage metadata, and dashboard rendering without changing the established PowerBI contract.
- This preserves future optionality: a later explicitly versioned contract change can promote comments CSVs if needed.

**Alternatives considered**:
1. Leave the decision open until Slice C
   Rejected: causes schema, docs, and test churn during implementation.
2. Make comments part of the core contract now
   Rejected: larger governance scope than needed for roadmap closure.

---

### R-05: Reviewer Combination Decision Space

**Decision**: Restrict reviewer combination behavior to three allowed modes only:
- `exact`
- `constrained`
- `disallowed-with-ux-signal`

Proportional fallback is prohibited.

**Locked roadmap outcome**:
- reviewer + repository = `constrained`
- reviewer + team = `disallowed-with-ux-signal`

**Rationale**:
- Reviewer metrics are activity-oriented and already use a dedicated breakdown contract.
- Feature 029 removed ambiguity by introducing explicit exactness for supported combinations; proportional reviewer fallback would reintroduce ambiguous behavior that is hard to explain and test.
- A constrained or disallowed mode is preferable to silently estimated reviewer activity.

**Alternatives considered**:
1. Allow proportional fallback for reviewer combinations
   Rejected: ambiguous semantics and misleading activity metrics.
2. Require exact support for all reviewer combinations
   Rejected: may not be safely bounded or justified for roadmap closure.

---

### R-06: Loader-Boundary Compatibility Strategy

**Decision**: Use explicit capability flags and/or schema-version detection in the manifest/loader boundary for additive author, author x repository, reviewer, and comments features.

**Rationale**:
- The extension already normalizes optional additive fields in schema validators and dataset loading.
- Compatibility logic belongs at the loader edge, not spread across UI modules, to avoid brittle conditional behavior.
- Capability detection lets the frontend preserve legacy-dataset compatibility while still surfacing newer exactness or comments features.

**Alternatives considered**:
1. Infer capability from scattered field presence throughout the UI
   Rejected: brittle and repetitive.
2. Break legacy datasets and require re-generation
   Rejected: violates backward-compatibility expectations and existing version-adapter patterns.

**Locked precedence rule**:
1. manifest capability flags first
2. schema-version support second
3. safe defaults only when both are absent

---

### R-07: Determinism And Convergence For New Aggregations

**Decision**: Treat author, author x repository, and comments outputs as deterministic pure projections of SQLite state and require convergence under bounded backfill.

**Rationale**:
- The constitution already requires deterministic outputs and verified backfill behavior.
- Additive outputs cannot be allowed to drift independently from the existing persisted state model.
- Deterministic truncation and persisted comments coverage state keep comparisons meaningful across repeated runs.

**Alternatives considered**:
1. Best-effort comments coverage inferred from counts
   Rejected: can misrepresent capped extraction as full coverage.
2. Non-deterministic truncation or ordering
   Rejected: breaks repeatability and makes regression verification unreliable.

---

### R-08: Closure Evidence Operationalization

**Decision**: Roadmap closure requires a repeatable evidence pack format containing checklist status, exact commands, pass/fail outcomes, constitution gate mapping, and file references.

**Rationale**:
- Without a standard artifact, roadmap closure becomes subjective and difficult to review.
- The repo already values traceability through specs, contracts, and targeted tests; the closure artifact should match that standard.
- This also lets roadmap completion be audited later without reconstructing the intent from commit history.

**Alternatives considered**:
1. Human-readable summary only
   Rejected: too subjective and hard to re-run.
2. Raw CI links only
   Rejected: insufficiently granular for mapping roadmap items to code and docs.

**Locked storage rule**:
- checked-in evidence files live under `specs/034-roadmap-closure/evidence/`
- filenames follow `NNN-<roadmap-item>-evidence.md`
