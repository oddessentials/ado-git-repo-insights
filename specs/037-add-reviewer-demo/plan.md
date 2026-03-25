# Implementation Plan: Reviewer Demo Coverage

**Branch**: `037-add-reviewer-demo` | **Date**: 2026-03-23 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/037-add-reviewer-demo/spec.md`

## Summary

Close the last canonical demo coverage gap by hardening the synthetic dataset contract for reviewer-driven flows. The work is centered in the deterministic demo generator and parity pipeline: generate unique realistic human names with no numeric suffixes, guarantee reviewer breakdown coverage and fixture metadata in the canonical dataset, strengthen capability and publication validation, and extend automated tests so the reviewer demo contract is enforced before docs promotion.

## Technical Context

**Language/Version**: Python 3.10+ backend scripts, JSON artifact contracts, existing TypeScript 5.9 dashboard consumer
**Primary Dependencies**: Existing demo generation scripts, `demo_generation_common`, pytest-based demo parity tests
**Storage**: Generated JSON files under `artifacts/demo-enterprise/data`, mirrored to `docs/data`, plus report and metadata files under `artifacts/demo-enterprise`
**Testing**: pytest (`tests/demo`, `tests/unit` as needed), canonical demo build script, existing parity validation reports
**Target Platform**: GitHub Pages demo, CLI demo surface, shared extension/dashboard data contract
**Project Type**: Data-generation and validation workflow for a web dashboard demo surface
**Performance Goals**: Preserve deterministic regeneration and existing enterprise demo scale (260 weeks, 200 users, 23 repos, 8 projects) with no regression in build success or parity checks
**Constraints**: No manual edits to `docs/data`; shared canonical dataset remains single source of truth; reviewer fixtures must be deterministic and easy to validate; existing author/team/repo/comment/prediction/insight coverage must remain intact
**Scale/Scope**: Primary changes in 2 Python scripts and 3-5 pytest files, plus generated planning contracts and no expected dashboard UI code changes

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Relevance | Status |
|------|-----------|--------|
| III / QG-04 | Deterministic output is the primary invariant for the demo dataset | PASS — plan keeps seeded generation and adds reviewer contract checks rather than introducing runtime variability |
| QG-25 | Synthetic data must support 156+ weeks | PASS — no change to week count or history generation |
| QG-26 | Synthetic data must support 200+ reviewers | PASS — user/reviewer population remains 200 and becomes more realistic, not smaller |
| QG-27 | Synthetic data includes comment generation | PASS — comments pipeline is preserved explicitly in scope boundaries |
| QG-30 | CLI and extension dashboards use one shared UI bundle contract | PASS — dataset changes remain compatible with existing shared dashboard contract |
| QG-31 | Canonical enterprise demo dataset builds under `artifacts/demo-enterprise/` | PASS — plan strengthens the canonical build path and manifest contract |
| QG-32 | `docs/data/` is a clean promoted mirror | PASS — publication validation is tightened, not bypassed |
| QG-33 | Enterprise demo capability matrix passes for supported dashboard features | PASS — reviewer coverage gaps are the direct target of this work |
| QG-34 | Startup-state parity passes for docs and CLI demo surfaces | PASS — no HTML surface divergence is planned |

**All gates PASS.** No constitution violations are expected.

### Post-Design Re-Check

| Gate | Status |
|------|--------|
| III / QG-04 | PASS — name generation and reviewer fixtures are based on deterministic tables and manifest metadata |
| QG-26 | PASS — user count stays fixed at 200 while removing numeric suffixes from demo-facing names |
| QG-31 | PASS — build script remains the canonical artifact producer and gains stricter reviewer validation |
| QG-32 | PASS — docs promotion remains generated-only and byte-identical to canonical artifact output |
| QG-33 | PASS — capability report is upgraded to assert reviewer fixture completeness, not just surface presence |
| QG-34 | PASS — startup parity checks remain unchanged because consumer surfaces are not split or customized |

## Project Structure

### Documentation (this feature)

```text
specs/037-add-reviewer-demo/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── reviewer-demo-contract.md
│   └── publication-validation-contract.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
scripts/
├── generate-demo-data.py            # PRIMARY: deterministic synthetic users, reviewer rollups, manifest fixture metadata
└── build-demo-dataset.py            # PRIMARY: capability matrix, publication validation, report generation

tests/
├── demo/
│   ├── test_demo_parity_pipeline.py # PRIMARY: canonical build + reviewer coverage assertions
│   ├── test_regeneration.py         # Deterministic rebuild expectations
│   └── test_schema_guard.py         # Rollup/manifests stay aligned with dashboard schema
└── unit/
    └── test_synthetic_dataset.py    # Synthetic dataset invariants and scale checks

docs/
└── data/                            # Generated-only published mirror; never hand-edited
```

**Structure Decision**: The feature is a single-project data-generation change. Implementation stays in the existing Python demo generator and pytest parity pipeline, with no new runtime surfaces and no manual edits to generated demo artifacts.

## Complexity Tracking

No constitution violations. No complexity justification needed.

## Implementation Phases

### Phase 0: Lock the Reviewer Demo Contract

**Goal**: Convert the spec into an explicit generator and validation contract so every later phase targets the same fixture rules.

**Files**:
- `specs/037-add-reviewer-demo/research.md`
- `specs/037-add-reviewer-demo/data-model.md`
- `specs/037-add-reviewer-demo/contracts/reviewer-demo-contract.md`
- `specs/037-add-reviewer-demo/contracts/publication-validation-contract.md`

**Key outputs**:
- Canonical reviewer artifact fields to require in rollups and manifest metadata
- Minimum reviewer fixture strength and discoverability rules
- Publication surface definition for deterministic comparisons

### Phase 1: Deterministic Identity and Reviewer Fixture Generation

**Goal**: Update the synthetic data generator to emit unique realistic user names without numeric suffixes and guarantee reviewer fixture coverage in rollups and manifest metadata.

**Files**:
- `scripts/generate-demo-data.py`

**Implementation focus**:
- Replace numeric-suffix name generation with a deterministic unique-name strategy using fixed name tables or equivalent repeatable mapping
- Preserve 200-user scale while keeping all display names unique and realistic
- Guarantee reviewer breakdown coverage in weekly rollups
- Add deterministic reviewer fixture metadata to the manifest for:
  - valid reviewer-filter walkthroughs
  - reviewer-constrained walkthrough
  - disallowed reviewer-plus-team example
- Ensure at least five active reviewers and at least one multi-repo reviewer are encoded by generation rules, not by incidental randomness

### Phase 2: Capability Matrix and Publication Validation Hardening

**Goal**: Make the build pipeline fail for missing reviewer fixtures and define exactly which published artifacts participate in determinism and promotion checks.

**Files**:
- `scripts/build-demo-dataset.py`

**Implementation focus**:
- Enrich capability evidence for reviewer coverage from manifest metadata and sample rollups
- Validate the documented reviewer fixture metadata before report generation and promotion
- Treat missing reviewer breakdowns or fixture metadata as a blocking error with an explicit failure reason
- Lock deterministic publication scope to dataset payloads, manifest files, and metadata artifacts used by the canonical demo flow

### Phase 3: Automated Test Expansion

**Goal**: Encode the reviewer demo contract into automated tests so incomplete reviewer coverage cannot pass CI or local preflight.

**Files**:
- `tests/demo/test_demo_parity_pipeline.py`
- `tests/demo/test_regeneration.py`
- `tests/demo/test_schema_guard.py`
- `tests/unit/test_synthetic_dataset.py`

**Test additions**:
- Unique realistic synthetic user names with no numeric suffixes
- Reviewer fixture metadata exists and is discoverable
- Minimum reviewer counts and multi-repo reviewer evidence are present
- Disallowed reviewer-plus-team example is deterministic and documented
- Regeneration compares the full published artifact scope, not just a subset
- Build fails with a clear reason when reviewer contract data is removed

### Phase 4: Canonical Demo Verification

**Goal**: Rebuild the demo and prove that reviewer coverage, deterministic regeneration, and docs promotion all remain green.

**Verification steps**:
1. `python scripts/build-demo-dataset.py --no-promote`
2. `pytest tests/demo/test_demo_parity_pipeline.py -v`
3. `pytest tests/demo/test_regeneration.py -v`
4. `pytest tests/unit/test_synthetic_dataset.py -v`
5. `python scripts/build-demo-dataset.py`

**Expected outcomes**:
- Canonical artifacts rebuild successfully
- Capability matrix passes with reviewer evidence
- Promotion remains byte-identical
- Synthetic names remain realistic and unique

### Phase 5: Repository Verification Gates

**Goal**: Carry the feature through the constitution-mandated verification gates so deterministic reviewer coverage remains part of the normal automated developer workflow rather than a one-time dataset success.

**Verification steps**:
1. `ruff check .`
2. `ruff format --check .`
3. `mypy src/` (if enabled for this repository)
4. `pytest tests/unit tests/integration`

**Expected outcomes**:
- Repo-level lint and format checks pass
- Type checking passes when enabled
- Unit and integration suites remain green alongside demo-specific verification
- The feature meets constitution-aligned completion criteria

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Unique-name generation reintroduces duplicates at 200 users | Use deterministic Cartesian name generation or equivalent fixed mapping with an explicit uniqueness test |
| Reviewer fixtures appear valid in one week but weak in others | Encode fixture rules in manifest metadata and assert them in tests instead of relying on spot-check discovery |
| Publication determinism check misses related metadata drift | Define full artifact scope in the validation contract and compare all canonical published files |
| Generator changes accidentally reduce existing feature coverage | Keep capability-matrix assertions for author, team, comments, predictions, and insights intact while adding reviewer-specific checks |
| Tests pass on current demo artifacts but not on rebuilds | Run build-driven tests from generator output and reuse canonical build paths under `artifacts/demo-enterprise/` |

## Dependencies

- **Existing generators**: `scripts/generate-demo-data.py`, `scripts/generate-demo-predictions.py`, `scripts/generate-demo-insights.py`
- **Existing build pipeline**: `scripts/build-demo-dataset.py`
- **Existing verification**: `tests/demo/test_demo_parity_pipeline.py`, `tests/demo/test_regeneration.py`, `tests/unit/test_synthetic_dataset.py`
- **Existing shared consumer contract**: `extension/ui` dashboard schema and filter surfaces
- **No new external dependencies** expected
