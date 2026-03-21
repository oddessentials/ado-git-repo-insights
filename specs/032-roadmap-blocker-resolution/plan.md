# Implementation Plan: Roadmap Blocker Resolution

**Branch**: `032-roadmap-blocker-resolution` | **Date**: 2026-03-20 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/032-roadmap-blocker-resolution/spec.md`

## Summary

This planning branch resolves blocker decisions for reviewer filters and comments completion. The output is a set of explicit contracts, phased rollout guidance, and task decomposition that unblocks implementation work without reopening those design questions later.

## Technical Context

**Language/Version**: Markdown planning docs, grounded in Python 3.10-3.12 backend and TypeScript 5.x frontend code
**Primary Dependencies**: Existing SQLite schema, aggregation pipeline, dashboard schema contracts
**Storage**: Planning docs in `specs/032-roadmap-blocker-resolution/` plus cross-references in `TODO/`
**Testing**: Design-review level verification against current code and roadmap references
**Target Platform**: Repository documentation only on this branch
**Project Type**: Architecture/product planning
**Constraints**: Reviewer and comments decisions must be implementation-ready
**Scale/Scope**: B-04, B-05, B-06, and B-11 resolved now

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| Single source of truth | PASS | Planning decisions consolidated into one spec set |
| Deterministic output | PASS | No code execution path changed |
| No publish on failure | PASS | Documentation-only branch |

No constitution issues. This branch defines implementation direction but does not change runtime behavior.

## Project Structure

```text
specs/032-roadmap-blocker-resolution/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
└── tasks.md

TODO/
└── ROADMAP.md
```

## Resolution Strategy

### Phase 1: Reviewer Blockers

Resolve B-04, B-05, and B-06 together because they are coupled:
- defer review latency to Phase 2 until `reviewed_at` exists,
- define approval rate as final approval outcome per reviewed PR,
- create a dedicated `ReviewerBreakdownEntry`.

### Phase 2: Comments Blocker

Resolve B-11 by defining a narrow metrics-first dashboard slice:
- aggregate metrics only,
- no raw comment browsing,
- explicit capped/coverage signaling,
- CSV and JSON output added before dashboard UI work.

## File Impacts For Future Implementation

Reviewer follow-up implementation will likely touch:
- `src/ado_git_repo_insights/persistence/models.py`
- `src/ado_git_repo_insights/transform/aggregators.py`
- `tests/unit/test_aggregators.py`
- `extension/ui/schemas/rollup.schema.ts`
- `extension/ui/modules/metrics.ts`
- `extension/ui/modules/filters.ts`
- `extension/ui/dashboard.ts`

Comments follow-up implementation will likely touch:
- `src/ado_git_repo_insights/persistence/models.py`
- `src/ado_git_repo_insights/transform/csv_generator.py`
- `src/ado_git_repo_insights/transform/aggregators.py`
- `tests/unit/test_csv_contract.py`
- `extension/ui/schemas/rollup.schema.ts`
- `extension/ui/dashboard.ts`

## Verification Approach

1. Validate blocker decisions against current schema and TODO docs.
2. Update roadmap references so future implementation does not reopen the same questions.

## Complexity Tracking

No implementation complexity is added on this branch. Complexity is intentionally converted into explicit phase boundaries and contracts so later branches can execute without design drift.
