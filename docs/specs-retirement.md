# Speckit `/specs` Retirement

On **2026-05-04** the `/specs` directory was removed from the active repo and added to `.gitignore`. This note explains why and where to look instead.

## What was removed

`/specs/` held ~450 files across ~60 Speckit feature directories (`001-*` through `363-*`) — planning artifacts, task breakdowns, evidence packs, and agent scratchpads accumulated during feature delivery.

## Why retire it

These artifacts were **planning, not source of truth**. Once a feature shipped, the spec was rarely updated to reflect what actually landed. Keeping stale plans next to live code created two specific risks:

1. Agents and contributors reading a spec believed it described current behavior when the implementation had diverged.
2. Old feature specs sometimes contradicted the project's locked invariants (`agents/INVARIANTS.md`, `LOCAL_CI_PARITY_INVARIANTS.md`), causing confusion during reviews.

The project's authority now lives in artifacts that are either generated, gated, or explicitly invariant:

| Authority | Lives in |
|---|---|
| Behavior contracts | `docs/CONTRACT.md`, `docs/reference/dataset-contract.md`, `docs/reference/csv-schema.md` |
| Non-negotiable system properties | `agents/INVARIANTS.md`, `LOCAL_CI_PARITY_INVARIANTS.md` |
| CLI surface | `docs/reference/cli-reference.md` (CI-gated parity with `--help`) |
| Operations | `docs/operations/runbook.md`, `docs/operations/data-retention.md` |
| Architecture | `docs/reference/architecture.md` |
| Tests + schemas + code | the source tree itself |

## How to recover historical specs

Two ways:

```bash
# 1. Read at the retirement boundary
git checkout pre-specs-retirement-2026-05-04 -- specs/

# 2. Read a single spec from history
git show pre-specs-retirement-2026-05-04:specs/333-comments-trend-chart/spec.md
```

The `pre-specs-retirement-2026-05-04` tag is local to this repo; nothing was deleted from history.

## Going-forward policy

- `/specs` is now gitignored. Future Speckit work uses it as a local scratch directory.
- A spec **graduates** to a committed doc only if it carries durable value:
  - Architecture decision → `docs/reference/architecture.md` (or a new `docs/adr/` if we adopt ADRs)
  - Contract or schema → `docs/reference/` or `schemas/`
  - Operational procedure → `docs/operations/`
  - User-facing behavior → `docs/user-guide/`
- Task breakdowns, planning notes, evidence packs, and agent scratchpads stay local.
