# Quickstart: Roadmap Closure Program

**Feature**: 034-roadmap-closure
**Branch**: `034-roadmap-closure`

## What This Plan Delivers

This program closes the remaining roadmap by shipping:

1. Author filters end to end
2. Exact author x repository support
3. Comments completion from extraction outputs through dashboard/docs
4. Reviewer follow-through plus evidence-backed roadmap closure

## Files Expected To Change

### Backend

| File | Change |
|------|--------|
| `src/ado_git_repo_insights/transform/aggregators.py` | Add `by_author`, bounded `by_author_and_repo`, comments metrics, capability/truncation signals |
| `src/ado_git_repo_insights/transform/csv_generator.py` | Add auxiliary comments CSV export without touching core contract CSVs |
| `src/ado_git_repo_insights/cli.py` | Ensure comments capped-state propagation and CLI docs alignment |
| `scripts/generate-synthetic-dataset.py` | Generate author/cross-dim/comments scenarios and capability metadata |
| `tests/unit/test_aggregators.py` | Add author, author x repository, identity, truncation, and comments coverage tests |
| `tests/unit/test_csv_contract.py` | Prove no regression in core contract CSVs |
| `tests/unit/test_csv_determinism.py` | Extend determinism coverage for auxiliary outputs if applicable |

### Frontend

| File | Change |
|------|--------|
| `extension/ui/schemas/rollup.schema.ts` | Add author and author x repository additive fields |
| `extension/ui/schemas/manifest.schema.ts` | Add capability/version handling for additive author/comments metadata |
| `extension/ui/dataset-loader.ts` | Normalize capability-aware author/comments/reviewer state |
| `extension/ui/modules/metrics.ts` | Resolve author-only and author x repository exact behavior; enforce reviewer-mode contract |
| `extension/ui/modules/filters.ts` | Add author filter state and serialization behavior |
| `extension/ui/dashboard.ts` / `extension/ui/index.html` | Add author UI and comments panel behavior |
| `extension/tests/...` | Extend schema, loader, metrics, dashboard, and compatibility coverage |

### Governance / Docs

| File | Change |
|------|--------|
| `TODO/ROADMAP.md` | Mark roadmap complete with evidence references |
| `TODO/AUTHOR_CONTRIBUTOR_FILTERS.md` | Move from open TODO to shipped/deferred state |
| `TODO/COMMENTS.md` | Move from backend-complete note to fully closed roadmap item |
| `TODO/TEAM_REVIEWER_FILTERS.md` | Record reviewer combination decision and post-roadmap latency deferment |
| `docs/reference/cli-reference.md` | Document comment flags and auxiliary output status |
| `docs/reference/dataset-contract.md` | Document additive author/comments/capability surfaces without changing core CSV contract |

## Development Order

1. Implement author slices and loader capability handling.
2. Add exact bounded author x repository support.
3. Complete comments auxiliary exports, aggregate metrics, manifest coverage, and dashboard rendering.
4. Finalize reviewer combination mode behavior.
5. Produce closure evidence and update roadmap/TODO docs.

## Verification Workflow

### Python

```powershell
ruff check .
ruff format --check .
pytest tests/unit
pytest tests/integration/test_backfill_convergence.py
pytest tests/integration/test_golden_outputs.py
```

### Extension

```powershell
cd extension
pnpm run build:check
pnpm run test:types
pnpm run test:unit
```

### Targeted Closure Checks

```powershell
pytest tests/unit/test_csv_contract.py
pytest tests/unit/test_csv_determinism.py
pytest tests/unit/test_aggregators.py -k "author or comments"
cd extension
pnpm run test:unit -- --testPathPatterns="schema|metrics|dashboard|dataset-loader"
```

## Design Rules To Keep In Mind

- Do not change the six core PowerBI contract CSVs.
- Key author aggregates by canonical `user_id`, not display name.
- Treat comments CSVs as auxiliary outputs.
- Write auxiliary comments CSVs only to `csv-output/auxiliary/comments/`.
- Use explicit capability/version detection in the loader boundary.
- Loader precedence is manifest capability flags first, schema-version support second, safe defaults last.
- Author filter UX is searchable single-select only.
- Author+team constrained mode resolves metrics as author-only with explicit UI signaling.
- Reviewer combination behavior must be `exact`, `constrained`, or `disallowed-with-ux-signal`; never proportional.
- Deterministic truncation and explicit coverage state are mandatory when data is partial or bounded.

## Closure Checklist

- [ ] `by_author` shipped with backend + frontend support
- [ ] `by_author_and_repo` shipped with bounded exact support and explicit truncation semantics
- [ ] comments auxiliary exports and metrics surfaced end to end
- [ ] reviewer combination behavior locked and tested
- [ ] core CSV non-regression proven
- [ ] legacy dataset compatibility proven at loader boundary
- [ ] deterministic recomputation and backfill convergence proven for new outputs
- [ ] evidence pack populated for every roadmap item
- [ ] roadmap and TODO docs updated to final state
