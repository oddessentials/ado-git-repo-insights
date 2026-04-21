# Contract: Demo-Publish Strip Gate

> **Superseded by**: [`specs/309-demo-pr-drilldown/contracts/demo-strip-gate-v2.md`](../../309-demo-pr-drilldown/contracts/demo-strip-gate-v2.md) (provenance-based binary gate; the destination-identity-based gate described below — feature-060 FR-023 — was narrowed to a binary fail-closed gate keyed on a synthetic-authorization sentinel). The file-level strip helper (`strip_pr_arrays_from_rollups`) is preserved unchanged and is invoked on the sentinel-absent branch of the new gate.

**Scope**: new helper module `scripts/strip_pr_arrays.py`, with ONE gate-integration site (inside `promote_data` at `scripts/build-demo-dataset.py:1044`) and ONE separate bypass-closure site (`scripts/generate-demo-data.py` — NOT a second gate; default-dir change + early-exit guard). This contract plus the invariant test in tasks T050 are the sole authoritative enforcement for FR-023.

**Authoritative spec refs**: FR-013, FR-014, FR-023. Data-model: `data-model.md` §2 publish transitions.

## Helper contract

### File location

`scripts/strip_pr_arrays.py`

### Public API

```python
def strip_pr_arrays_from_rollups(rollup_dir: Path) -> StripReport:
    """Strip PR-level fields from every weekly rollup JSON under rollup_dir and re-verify.

    The gate is strip-AND-re-verify (not strip-OR-verify): after mutation, every
    rollup JSON is re-scanned and the helper RAISES if any residue remains.

    Args:
        rollup_dir: Path to the SOURCE directory containing weekly_rollups/*.json
                    files that are about to be promoted. In production this is
                    `ARTIFACT_DATA_DIR/aggregates` passed by `promote_data` as its
                    first step. The helper is NEVER invoked against `docs/data/`
                    directly — the gate ALWAYS runs on source before the copy
                    into `docs/data/` happens.

    Returns:
        StripReport with per-file field-removal counts. Informational only;
        callers MUST NOT branch on counts — the raise-on-residue is the gate.

    Raises:
        PrArrayResidueError: if any file under rollup_dir still contains a
                             `prs`, `_prs_truncated`, or `_prs_cap` field after
                             the strip pass. The error message lists every
                             offending file:field pair.
        FileNotFoundError: if rollup_dir does not exist.
    """
```

```python
@dataclass(frozen=True)
class StripReport:
    files_scanned: int
    files_modified: int
    fields_removed: dict[str, int]   # { "prs": N, "_prs_truncated": M, "_prs_cap": K }
```

```python
class PrArrayResidueError(RuntimeError):
    """Raised if any rollup retains a PR-level field after strip-and-re-verify."""
```

### Behavior

For every file matching `rollup_dir/weekly_rollups/*.json` (recursive glob):

1. Load JSON.
2. Remove keys `"prs"`, `"_prs_truncated"`, `"_prs_cap"` from the top-level dict if present.
3. If the file was modified, write back preserving the existing JSON formatting (sorted keys / indent level / trailing newline) to maintain byte-stability invariant with pre-feature outputs.
4. After the whole directory has been processed, re-scan every file and assert no residue. Raise `PrArrayResidueError` on any match.

### Gate placement (inside `promote_data`)

The strip gate is invoked as the first step of `promote_data` (before the existing `shutil.copytree` call), so every code path that publishes to `docs/data/` via `promote_data` is automatically gated. `promote_data` becomes the single authoritative write boundary for this invariant.

- `scripts/build-demo-dataset.py` orchestrates the production flow: `GENERATOR_STEPS` (line 54) → `run_generator(script, ARTIFACT_DATA_DIR)` (line 1095) → `promote_data(ARTIFACT_DATA_DIR, DOCS_DATA_DIR)` (line 1120). The gate fires inside `promote_data` before copy; on gate failure, the copy does not run, and `docs/data/` is byte-identical to its pre-run state.
- `scripts/generate-demo-data.py` when orchestrated receives `ARTIFACT_DATA_DIR` and never writes to `docs/data/` directly. Its standalone `DEFAULT_OUTPUT_DIR = docs/data/` is a developer-convenience bypass; that path is closed by a separate change (moving the default to a scratch location and adding an early-exit guard that rejects `--output-root == DOCS_DATA_DIR`). See tasks T050.

The helper (`strip_pr_arrays_from_rollups`) itself is flow-neutral — given a directory, it either leaves it clean or raises. The flow-safety comes from WHERE it is called (inside `promote_data`), not from anything the helper does.

### Cross-OS invariants (QG-39)

- `Path` / `pathlib` for every filesystem operation.
- `glob.glob` with `recursive=True` OR `Path.rglob`.
- No shell-invoked tools.
- UTF-8 explicit in every file open.
- Linux / macOS / Windows all supported.

### Typing (QG-40)

- Full type annotations on all public functions, no `typing.Any`.
- `StripReport` is a frozen dataclass.
- `PrArrayResidueError` is a subclass of `RuntimeError` (follows existing helper convention).

### Suppressions (QG-41)

None introduced.

## Integration contract — caller sites

### `promote_data` (extend — this is where the gate lives)

Current: `DOCS_DATA_DIR` defined at `build-demo-dataset.py:45`; `promote_data(source_dir, destination_dir)` at line 1044 does `destination_dir.mkdir(...)` → `shutil.copytree(source_dir, destination_dir, dirs_exist_ok=True)` → stale-file cleanup → content-match validation.

Required change: add the strip gate as the FIRST step of `promote_data`, before `destination_dir.mkdir`:

```python
from strip_pr_arrays import strip_pr_arrays_from_rollups, PrArrayResidueError

def promote_data(source_dir: Path, destination_dir: Path) -> None:
    """Replace docs/data atomically from the canonical artifact root."""
    # FR-023 gate: strip PR-level fields from source before copying to destination.
    # Only fires when destination is a public-surface root (currently DOCS_DATA_DIR).
    # On residue or gate error, raise — do NOT proceed to copy. docs/data untouched.
    if destination_dir.resolve() == DOCS_DATA_DIR.resolve():
        strip_pr_arrays_from_rollups(source_dir / "aggregates")

    destination_dir.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source_dir, destination_dir, dirs_exist_ok=True)
    # ... existing stale-file cleanup + content-match validation unchanged ...
```

This is the single authoritative gate site (QG-49). No separate gate at the `build-demo-dataset.py:1120` call site is needed — the gate is intrinsic to `promote_data` for public-surface destinations.

### `scripts/generate-demo-data.py` (bypass closure — NOT a gate add)

Current: `DEFAULT_OUTPUT_DIR = Path(__file__).parent.parent / "docs" / "data"` at line 105. Production-orchestrated flow passes `ARTIFACT_DATA_DIR` explicitly and never uses the default. Developer-standalone invocation DOES use the default, writing directly to `docs/data/` and bypassing `promote_data` entirely.

Required change (bypass closure, NOT a duplicate gate):

```python
# In scripts/generate-demo-data.py

# Change default away from docs/data/ to a scratch location. Orchestrated flow
# is unaffected because build-demo-dataset.py passes the output root explicitly.
DEFAULT_OUTPUT_DIR = Path(__file__).parent.parent / ".tmp" / "generate-demo-data-output"

def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    # Early-exit guard: refuse direct writes to docs/data/, even if requested
    # explicitly via --output-root. docs/data/ is managed exclusively by
    # scripts/build-demo-dataset.py via promote_data (which carries the
    # FR-023 gate).
    from build_demo_dataset import DOCS_DATA_DIR  # or wherever DOCS_DATA_DIR lives
    if args.output_root.resolve() == DOCS_DATA_DIR.resolve():
        raise SystemExit(
            "docs/data/ is managed by scripts/build-demo-dataset.py; "
            "use that script to publish. generate-demo-data.py writes its "
            "artifacts to a scratch directory for developer inspection."
        )

    # ... existing logic unchanged ...
```

No strip gate is added to `generate-demo-data.py` itself — the gate at `promote_data` is sufficient because the bypass path is now closed.

### CI workflows

`.github/workflows/ci.yml`, `.github/workflows/demo.yml`, `.github/workflows/release.yml` invoke `build-demo-dataset.py` via existing steps. Those workflows inherit the gate automatically because the gate is wired inside `promote_data` — every orchestrated publish from any CI workflow flows through that single helper. `generate-demo-data.py` standalone does not and cannot reach `docs/data/` once the bypass closure (T050) lands: its default output is a scratch dir and its early-exit guard refuses `--output-root == DOCS_DATA_DIR`. No workflow YAML changes required.

This satisfies QG-47 / QG-49 (entry-point alignment): the gate is defined exactly ONCE as an authoritative command (`strip_pr_arrays_from_rollups`) and invoked at exactly ONE site (inside `promote_data` — the single production write boundary). No copy-pasted inline checks, no duplicated invocations across scripts.

### Future new write paths

If any new script or workflow needs to land rollups in `docs/data/`, that path MUST go through `promote_data` — which already carries the gate. Direct writes to `docs/data/` that bypass `promote_data` are FORBIDDEN by the single-authoritative-boundary rule in FR-023. A repo-level invariant test (in `tests/unit/` or `tests/meta/`) MUST grep `scripts/*.py` and `.github/workflows/*.yml` for patterns that write to `docs/data/` outside a `promote_data` call, and fail the build on any match. This follows the existing invariant-test precedent (`tests/unit/test_hook_triggers.py`). Duplicating the strip gate at a second call site is also FORBIDDEN — the gate lives exactly once, inside `promote_data`.

## Test contract

### `tests/unit/test_strip_pr_arrays.py` (new)

Positive cases:
1. Directory with a mix of rollups — some with `prs`, some without — all correctly stripped; unaffected files byte-identical before/after.
2. Directory with `prs` + `_prs_truncated` + `_prs_cap` on every rollup — all three fields removed from all files.
3. Directory with zero files — returns 0/0/0 report, no error.
4. Directory with already-stripped rollups — no modifications, no error, report has `files_modified=0`.

Negative cases:
1. Synthetic corrupt state: helper re-verifies AFTER strip; if a test fixture bypasses the strip and inserts residue, re-verify MUST raise `PrArrayResidueError`.
2. Non-existent directory — raises `FileNotFoundError`.

Cross-OS:
- Run the same fixture directory through the helper on all three OSes; output byte-identical.

### Integration (inside `test_demo_parity_pipeline.py` extension)

- After `build-demo-dataset.py` runs end-to-end against a fixture, assert that `docs/data/aggregates/weekly_rollups/*.json` contain no `prs`, `_prs_truncated`, or `_prs_cap` keys.
- Synthetic leak test: inject an unstripped rollup into the canonical artifact root, run the promotion, assert the build fails hard with `PrArrayResidueError`.

## Non-functional

- The gate runs in seconds even at full 260-week demo scale (file I/O + small JSON parse/serialize per file).
- Memory usage bounded by per-file JSON size (max 500 KB per file by contract cap).
- No impact on build-demo-dataset's existing cross-OS promotion behavior.
