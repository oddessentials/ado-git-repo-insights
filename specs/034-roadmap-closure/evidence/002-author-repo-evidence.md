# Author Repository Evidence

- roadmap_item: author-repository
- status: complete

## implementation_files

- `src/ado_git_repo_insights/transform/aggregators.py`
- `scripts/generate-synthetic-dataset.py`
- `extension/ui/modules/metrics.ts`
- `extension/ui/schemas/rollup.schema.ts`
- `extension/ui/dataset-loader.ts`

## test_files

- `tests/unit/test_aggregators.py`
- `tests/unit/test_csv_determinism.py`
- `extension/tests/modules/metrics.test.ts`

## docs_files

- `TODO/AUTHOR_CONTRIBUTOR_FILTERS.md`
- `docs/reference/dataset-contract.md`

## commands

- `pnpm run test:unit -- tests/modules/metrics.test.ts tests/version-adapter-integration.test.ts --runInBand`
- `.venv\Scripts\python.exe -m pytest -o addopts='-ra -q' tests/unit/test_aggregators.py tests/unit/test_csv_determinism.py`

## outcomes

- Exact `by_author_and_repo` lookup is used when present.
- Deterministic truncation is enforced as `pr_count DESC`, `author_id ASC`, `repository_name ASC`.
- Legacy datasets continue to fall back safely without breaking current dashboards.

## constitution_gates

- bounded additive growth preserved
- deterministic recomputation preserved
- no core CSV contract mutation

## residual_risks

- none material for roadmap closure
