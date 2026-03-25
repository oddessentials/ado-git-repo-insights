# Research: Reviewer Demo Coverage

**Branch**: `037-add-reviewer-demo` | **Date**: 2026-03-23

## R-01: Synthetic User Naming Strategy

**Decision**: Replace numeric-suffixed synthetic display names with a deterministic unique-name mapping derived from fixed first-name and last-name tables.

**Rationale**: The current generator already uses realistic names but appends numeric suffixes once the first-name table is exhausted. That violates the updated spec and weakens demo credibility. A fixed Cartesian mapping or similarly deterministic lookup preserves seeded reproducibility, keeps names human-readable, and scales to the required 200 users without introducing randomness at runtime.

**Implementation point**: `scripts/generate-demo-data.py:generate_users()`

**Alternatives considered**:
- Expanding the existing first-name list only: Rejected because uniqueness would still depend on table length and would regress if counts changed.
- Randomly sampling from a larger name corpus: Rejected because it adds unnecessary determinism risk and makes fixture reasoning harder.

---

## R-02: Reviewer Fixture Metadata Location

**Decision**: Store canonical reviewer walkthrough and disallowed-combination metadata in `dataset-manifest.json`, while keeping weekly reviewer statistics in each rollup's `by_reviewer` section.

**Rationale**: Rollups are the right place for week-specific metrics, but they are poor discoverability surfaces for named walkthroughs or canonical disallowed examples. The manifest already carries capability metadata and publication contract details, so adding reviewer fixture metadata there makes build validation, demos, and automated tests target the same authoritative description.

**Implementation points**:
- `scripts/generate-demo-data.py:generate_manifest()`
- `scripts/build-demo-dataset.py:build_capability_matrix()`

**Alternatives considered**:
- Inferring walkthroughs only from rollup contents: Rejected because tests and demos would have to search for a valid case, which is fragile.
- Separate metadata file outside the manifest: Rejected because it would enlarge the publication surface without a clear need and would complicate promotion validation.

---

## R-03: Minimum Reviewer Coverage Rule

**Decision**: Enforce reviewer fixture strength through deterministic generation rules and tests: at least five active reviewers, at least one reviewer spanning multiple repositories, one documented constrained walkthrough, and one documented disallowed reviewer-plus-team example.

**Rationale**: Reviewer coverage must be demo-worthy, not merely technically non-empty. These minimums translate the spec into enforceable data quality thresholds while remaining small enough to preserve existing generator structure.

**Implementation points**:
- `scripts/generate-demo-data.py:_generate_reviewer_breakdown()`
- `tests/demo/test_demo_parity_pipeline.py`
- `tests/unit/test_synthetic_dataset.py`

**Alternatives considered**:
- Using only capability booleans: Rejected because booleans say a feature exists, not that it is meaningfully demoable.
- Raising the minimum far beyond five reviewers: Rejected because the demo already has 200 users and existing reviewer dimensions; the issue is contract certainty, not population scarcity.

---

## R-04: Blocking Validation Behavior

**Decision**: Missing reviewer breakdowns or reviewer fixture metadata should raise build-time errors before promotion, not warnings in the report.

**Rationale**: The constitution treats the canonical demo as a governed product surface. If reviewer coverage is incomplete, promotion to `docs/data` must stop. A warning-only path would allow the exact defect this feature is intended to prevent.

**Implementation points**:
- `scripts/build-demo-dataset.py`
- `tests/demo/test_demo_parity_pipeline.py`

**Alternatives considered**:
- Report-only warnings: Rejected because they satisfy observability but not governance.
- Post-promotion drift checks only: Rejected because they catch problems too late.

---

## R-05: Deterministic Publication Scope

**Decision**: Deterministic comparison and promotion validation should cover the full canonical published artifact set: generated dataset payloads, `dataset-manifest.json`, report files used for demo validation, and metadata files that describe the canonical demo profile.

**Rationale**: The current pipeline already validates canonical data and promotion bytes, but the updated spec explicitly requires related metadata to remain stable too. Locking the scope avoids a false pass where the data files are stable but supporting metadata drifts.

**Implementation points**:
- `scripts/build-demo-dataset.py`
- `tests/demo/test_regeneration.py`

**Alternatives considered**:
- Comparing data files only: Rejected because it leaves report and metadata drift ungoverned.
- Comparing the entire repository tree: Rejected because it would be noisy and unrelated to the demo publication contract.
