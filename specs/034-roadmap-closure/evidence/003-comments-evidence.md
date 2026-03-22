# Comments Evidence

- roadmap_item: comments-completion
- status: complete

## implementation_files

- `src/ado_git_repo_insights/transform/csv_generator.py`
- `src/ado_git_repo_insights/transform/aggregators.py`
- `src/ado_git_repo_insights/cli.py`
- `src/ado_git_repo_insights/persistence/models.py`
- `src/ado_git_repo_insights/persistence/repository.py`
- `extension/ui/schemas/manifest.schema.ts`
- `extension/ui/dataset-loader.ts`
- `extension/ui/dashboard.ts`
- `extension/ui/index.html`

## test_files

- `tests/unit/test_comments_cli.py`
- `tests/unit/test_csv_contract.py`
- `tests/unit/test_csv_determinism.py`
- `tests/unit/test_aggregators.py`
- `extension/tests/schema/manifest.test.ts`
- `extension/tests/dashboard/ml-state-rendering.test.ts`

## docs_files

- `docs/roadmap/comments.md`
- `docs/reference/cli-reference.md`
- `docs/reference/dataset-contract.md`

## commands

- `pnpm run build:check`
- `pnpm run test:unit -- tests/modules/metrics.test.ts tests/version-adapter-integration.test.ts --runInBand`
- `.venv\Scripts\python.exe -m pytest -o addopts='-ra -q' tests/unit/test_comments_cli.py tests/unit/test_csv_contract.py tests/unit/test_csv_determinism.py tests/unit/test_aggregators.py`

## outcomes

- Auxiliary comments CSVs are emitted only under `csv-output/auxiliary/comments/`.
- Manifest and loader expose deterministic `disabled`, `full`, and `partial` comments coverage state.
- Dashboard surfaces comments coverage and capped extraction messaging.

## constitution_gates

- core PowerBI CSV contract unchanged
- additive outputs isolated from contract CSVs
- comments coverage derived from persisted extraction metadata

## residual_risks

- advanced comment analytics remain intentionally deferred
