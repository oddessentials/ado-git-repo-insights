# Contract: Roadmap Closure Evidence Pack

**Feature**: 034-roadmap-closure
**Status**: Draft

## Purpose

Define the minimum repeatable artifact required to declare the roadmap closed.

## Required Location

Evidence files must be checked in under:

`specs/034-roadmap-closure/evidence/`

Required filename pattern:

`NNN-<roadmap-item>-evidence.md`

where `NNN` is a stable ordering prefix matching the roadmap closure sequence.

## Required Entry Format

Each remaining roadmap item must have one evidence entry containing:

| Field | Required | Description |
|-------|----------|-------------|
| `roadmap_item` | Yes | Feature name or roadmap identifier |
| `status` | Yes | `complete`, `deferred`, or `blocked` |
| `implementation_files` | Yes | Absolute or repo-relative file references for code changes |
| `test_files` | Yes | File references for validating tests |
| `docs_files` | Yes | File references for docs/TODO updates |
| `commands` | Yes | Exact verification commands run |
| `outcomes` | Yes | Pass/fail result per command |
| `constitution_gates` | Yes | Relevant QG / VR identifiers exercised |
| `residual_risks` | No | Explicit remaining risks or post-roadmap work |

## Review Rules

- A roadmap item may not be marked `complete` without at least one passing verification command.
- `deferred` items must point to their post-roadmap destination doc/spec.
- `blocked` items are not allowed at final roadmap closure.
- Closure is invalid if any remaining roadmap item lacks an evidence entry.

## Minimum Roadmap Items Covered

The closure artifact must cover:

1. Author filters
2. Exact author x repository
3. Comments completion
4. Reviewer follow-through
5. Roadmap/TODO finalization

## Example Skeleton

```text
roadmap_item: Author filters
status: complete
implementation_files:
  - src/ado_git_repo_insights/transform/aggregators.py
  - extension/ui/modules/metrics.ts
test_files:
  - tests/unit/test_aggregators.py
  - extension/tests/modules/metrics.test.ts
docs_files:
  - TODO/ROADMAP.md
commands:
  - pytest tests/unit/test_aggregators.py -k author
  - cd extension && pnpm run test:unit -- --testPathPatterns=metrics
outcomes:
  - pass
  - pass
constitution_gates:
  - QG-01
  - QG-04
  - QG-19
residual_risks:
  - author+team UX still limited to single-select search
```

## Merge Gate

Roadmap closure is not sign-off ready until this evidence pack exists and is fully populated for every roadmap item.

The implementation branch owner is responsible for generating and maintaining these checked-in evidence files as part of roadmap closure.
