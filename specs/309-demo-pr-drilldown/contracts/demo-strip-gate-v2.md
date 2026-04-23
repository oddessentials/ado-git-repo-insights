# Contract: Demo-Publish Strip Gate v2 (Provenance-Based)

**Feature**: `309-demo-pr-drilldown`
**Supersedes**: [`specs/060-throughput-pr-drilldown/contracts/demo-strip-gate.md`](../../060-throughput-pr-drilldown/contracts/demo-strip-gate.md) — the feature-060 contract is a direct precursor; this v2 contract REPLACES the destination-identity-based gate with a provenance-based binary gate. The v1 contract's file-level helper (`strip_pr_arrays_from_rollups`) is PRESERVED unchanged and invoked on the sentinel-absent branch.

**Scope**: `promote_data` in `scripts/build-demo-dataset.py`. The gate lives exactly ONCE, at this single call site (QG-47/49).

**Authoritative spec refs**: FR-008, FR-009, FR-010, FR-011, FR-012, FR-013 (from [`spec.md`](../spec.md)).

## 1. Binary gate semantics

`promote_data(source_dir, destination_dir)` branches exactly once on sentinel presence when the destination is the public demo surface. Every other destination (private tenant artifacts, non-production scratch paths) preserves the existing non-gated `promote_data` behavior.

```python
def promote_data(source_dir: Path, destination_dir: Path) -> None:
    if destination_dir.resolve() != DOCS_DATA_DIR.resolve():
        # Non-public-surface destination: existing behavior unchanged.
        destination_dir.mkdir(parents=True, exist_ok=True)
        shutil.copytree(source_dir, destination_dir, dirs_exist_ok=True)
        _stale_file_cleanup(destination_dir)
        _content_match_validation(source_dir, destination_dir)
        return

    aggregates = source_dir / "aggregates"
    sentinel = aggregates / ".synthetic-prs-authorized"

    if sentinel.exists():
        # SYNTHETIC BRANCH — preserve PR-level fields, fail-closed on shape.
        assert_synthetic_shape(aggregates)   # raises SyntheticShapeError on tenant-shaped residue
        sentinel.unlink()                    # FIRST mutation; before any mkdir/copytree/strip
    else:
        # TENANT BRANCH — strip PR-level fields. Existing fail-closed helper.
        assert not sentinel.exists()         # third-path regression guard (load-bearing)
        strip_pr_arrays_from_rollups(aggregates)

    destination_dir.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source_dir, destination_dir, dirs_exist_ok=True)
    _stale_file_cleanup(destination_dir)
    _content_match_validation(source_dir, destination_dir)
```

## 2. Sentinel protocol (referenced)

The sentinel file semantics are fully specified in [`synthetic-authorization-signal.md`](./synthetic-authorization-signal.md). This gate contract only defines how `promote_data` reads and consumes it.

## 3. `assert_synthetic_shape` contract

**Purpose**: fail-closed on sentinel-present path. Ensures that even if a sentinel is present by mistake, tenant-shaped residue cannot slip through.

**Signature**:

```python
class SyntheticShapeError(RuntimeError):
    """Raised when sentinel-present source does not match the synthetic contract."""

def assert_synthetic_shape(aggregates_dir: Path) -> None:
    """Verify every weekly rollup under aggregates_dir matches the synthetic PR-level contract.

    For each rollup in aggregates_dir/weekly_rollups/*.json:
    - if pr_count == 0: MUST have no 'prs'/'_prs_truncated'/'_prs_cap' keys, OR have them all
      present with len(prs)==0 and _prs_truncated==False and _prs_cap==500
    - if pr_count > 0: MUST have all three keys; len(prs) <= _prs_cap; sorted by (-cycle_time, id)
    - _prs_cap MUST equal 500 everywhere

    Raises SyntheticShapeError on ANY deviation, listing every offending file.
    """
```

**Cross-OS**: `pathlib` only; UTF-8; no shell.

**Typing**: full annotations; no `typing.Any`.

## 4. Gate placement invariants (QG-47/49)

- **Single site**: only `promote_data` invokes the gate logic. No duplicate gate at generator-script or extract-CLI call sites.
- **Trigger scope match (QG-47)**: pre-commit triggers on this gate cover every file the gate reads: the source aggregates tree, the sentinel path, the destination candidate. Defined in `.pre-commit-config.yaml`.
- **Clean-worktree guard (QG-48)**: `assert_inputs_clean()` runs before the gate and verifies staged-vs-worktree parity via dual `git diff --cached` + `git diff`. Specified in `byte-determinism-regen.md` §3.
- **Name-invocation across entry points (QG-49)**: `strip_pr_arrays_from_rollups`, `assert_synthetic_shape`, and `assert_inputs_clean` are each defined ONCE and invoked by name from:
  - `scripts/build-demo-dataset.py::promote_data`
  - `scripts/run_repo_hook.py::run_pre_push_hook`
  - `scripts/run_pr_preflight.py` CommandSpecs
  - `.github/workflows/demo.yml` build-demo job (`demo.yml:85` invokes `build-demo-dataset.py`; NOT `ci.yml`)

## 5. Atomicity guarantees

On ANY of the following failure modes, the destination directory MUST be byte-identical to its pre-call state:

1. `assert_synthetic_shape` raises `SyntheticShapeError`
2. `sentinel.unlink()` raises `PermissionError` or `OSError`
3. `strip_pr_arrays_from_rollups` raises `PrArrayResidueError`
4. `destination_dir.mkdir` fails
5. `shutil.copytree` fails mid-copy

**Test coverage**: `tests/demo/test_demo_parity_pipeline.py::TestPromoteDataStripGateAtomicity` and `tests/unit/test_promote_data_unlink_ordering.py` lock every failure path's atomicity.

## 6. Backward compatibility

The feature-060 strip helper (`strip_pr_arrays_from_rollups`) is unchanged. Its unit tests in `tests/unit/test_strip_pr_arrays.py` still pass without modification.

The feature-060 atomicity tests in `tests/demo/test_demo_parity_pipeline.py::TestPromoteDataStripGateAtomicity` are EXTENDED by this feature with two new cases (sentinel-present-synthetic-shaped, sentinel-present-tenant-shaped). Existing cases (sentinel-absent-clean, sentinel-absent-with-residue) MUST still pass unchanged.

## 7. Supersedure notice for feature 060

At slice 2b, `specs/060-throughput-pr-drilldown/contracts/demo-strip-gate.md` gets a supersedure note added at the top:

> **Superseded by**: [`specs/309-demo-pr-drilldown/contracts/demo-strip-gate-v2.md`](../../309-demo-pr-drilldown/contracts/demo-strip-gate-v2.md). The destination-identity-based gate described below was narrowed to a provenance-based binary gate; the file-level strip helper is preserved and invoked on the sentinel-absent branch.

The body of the feature-060 contract is NOT rewritten. Its file-level helper contract remains authoritative for the helper behavior.

## 8. Gate-behavior fixture matrix

The following matrix drives `tests/unit/test_strip_gate_entrypoint_parity.py`:

| Fixture | Sentinel | Source shape | Expected outcome |
|---|---|---|---|
| `sentinel-present-synthetic-shaped/` | present | synthetic | Pass; PR fields preserved in destination; sentinel absent in destination |
| `sentinel-present-tenant-shaped/` | present | tenant-shaped (has PR fields but violates synthetic contract) | `SyntheticShapeError`; destination byte-identical to pre-call |
| `sentinel-absent-clean/` | absent | clean (no PR fields) | Pass; destination copied without mutation |
| `sentinel-absent-with-residue/` | absent | tenant (has PR fields) | Pass with strip; destination has PR fields stripped |

Each fixture runs through BOTH `run_repo_hook.py sentinel-absence` (the dedicated subcommand — NOT full `pre-push`, which has seven earlier stages that can false-fail and mask the sentinel behavior) AND the CI-workflow equivalent (same subcommand invocation from the `demo.yml` first-step); outcomes MUST match per fixture (entrypoint-command parity).
