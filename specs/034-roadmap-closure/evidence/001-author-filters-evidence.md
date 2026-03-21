# Author Filters Evidence

- roadmap_item: author-filters
- status: complete

## implementation_files

- `src/ado_git_repo_insights/transform/aggregators.py`
- `extension/ui/modules/filters.ts`
- `extension/ui/modules/metrics.ts`
- `extension/ui/dashboard.ts`
- `extension/ui/index.html`
- `extension/ui/schemas/rollup.schema.ts`

## test_files

- `tests/unit/test_aggregators.py`
- `extension/tests/modules/filters.test.ts`
- `extension/tests/modules/metrics.test.ts`
- `extension/tests/version-adapter-integration.test.ts`

## docs_files

- `TODO/AUTHOR_CONTRIBUTOR_FILTERS.md`
- `docs/user-guide/extension.md`

## commands

- `pnpm run build:check`
- `pnpm run test:unit -- tests/modules/metrics.test.ts tests/version-adapter-integration.test.ts --runInBand`
- `.venv\Scripts\python.exe -m pytest -o addopts='-ra -q' tests/unit/test_aggregators.py`

## outcomes

- Author filtering is capability-aware and keyed by canonical immutable `user_id`.
- The dashboard supports searchable single-select author filtering with URL state.
- Author + team is explicitly constrained and signaled in the UI.

## constitution_gates

- additive-only contract preserved
- legacy dataset compatibility preserved
- deterministic filtering behavior verified

## residual_risks

- none material for roadmap closure
