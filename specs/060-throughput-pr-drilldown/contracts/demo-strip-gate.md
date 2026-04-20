# Contract: Demo-Publish Strip Gate

**Scope**: new helper module `scripts/strip_pr_arrays.py` plus integration points in `scripts/build-demo-dataset.py` and `scripts/generate-demo-data.py`. This is the sole authoritative enforcement for FR-023.

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
        rollup_dir: Path to the directory containing weekly_rollups/*.json files
                    (typically docs/data/aggregates/weekly_rollups or the canonical
                    artifact root that is about to be promoted into docs/data/).

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

### Atomic failure semantics (FR-023 enforcement)

The helper runs against a STAGING location — NEVER directly against `docs/data/`. Callers are responsible for ensuring the staging-then-promote sequence:

- `scripts/build-demo-dataset.py` already promotes from a canonical artifact root via `atomic_replace_docs_data`; the gate runs on the canonical root BEFORE promotion. On gate failure, `atomic_replace_docs_data` is NOT called → `docs/data/` remains byte-identical to its pre-run state.
- `scripts/generate-demo-data.py` currently writes directly into `docs/data/`. To satisfy FR-023 atomic-failure semantics, this script MUST be refactored to write to a scratch directory first, run the strip gate against the scratch, and only rsync/copy into `docs/data/` on success. Writing directly into `docs/data/` and then running the gate is FORBIDDEN — a mid-run failure leaves `docs/data/` in an inconsistent state and violates persistence invariant VII ("No Publish on Failure").

The helper itself does NOT manage the staging-vs-production distinction — that's the caller's responsibility. The helper's contract is: given a directory, either leave it clean or raise. Callers that pass the production directory directly bear the atomicity risk themselves (and such callers MUST be flagged in code review / invariant tests as FR-023 violations).

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

### `scripts/build-demo-dataset.py` (extend)

Current: `DOCS_DATA_DIR` defined at line 45; `atomic_replace_docs_data` function at line ~1045+ promotes canonical artifact root to `docs/data/`.

Required change: immediately before `atomic_replace_docs_data` runs, invoke the strip gate on the canonical artifact root:

```python
from strip_pr_arrays import strip_pr_arrays_from_rollups, PrArrayResidueError

# ... existing build logic ...

# FR-023 gate: strip PR arrays from canonical output before promotion to docs/data/.
try:
    report = strip_pr_arrays_from_rollups(canonical_artifact_root / "aggregates")
    print(f"[demo-build] strip-gate: {report.files_modified} files modified, residue check passed")
except PrArrayResidueError as e:
    print(f"[demo-build] strip-gate FAILED: {e}", file=sys.stderr)
    sys.exit(1)

atomic_replace_docs_data(canonical_artifact_root, DOCS_DATA_DIR)
```

### `scripts/generate-demo-data.py` (extend)

Current: `DEFAULT_OUTPUT_DIR = Path(__file__).parent.parent / "docs" / "data"` at line 105; writes weekly rollups directly into it.

Required change: after the write phase completes, invoke the strip gate before the script exits:

```python
# FR-023 gate: strip PR arrays from the written docs/data output.
report = strip_pr_arrays_from_rollups(output_dir / "aggregates")
print(f"[generate-demo-data] strip-gate: {report.files_modified} files modified, residue check passed")
# (PrArrayResidueError propagates and fails the script.)
```

### CI workflows

`.github/workflows/ci.yml`, `.github/workflows/demo.yml`, `.github/workflows/release.yml` all invoke `build-demo-dataset.py` / `generate-demo-data.py` / `publish-demo-surface.py` via existing steps. Those workflows inherit the gate automatically through the two script entry points above — no workflow YAML changes required if the gate is wired inside the Python entry points.

This satisfies QG-47 / QG-49 (entry-point alignment): the gate is defined exactly ONCE as an authoritative command (`strip_pr_arrays_from_rollups`) and invoked by name from every publish-write entry point. No copy-pasted inline checks.

### Future new write paths

If any new script or workflow introduces a NEW path that writes weekly rollups into `docs/data/`, that path MUST import and invoke `strip_pr_arrays_from_rollups` at the same position in its flow (last step before files land in `docs/data/`). A repo-level invariant test (in `tests/unit/` or `tests/meta/`) SHOULD grep `scripts/*.py` for patterns that indicate rollup writes to `docs/data/` and fail if any such script does not also import the helper — this follows the existing invariant-test precedent (`tests/unit/test_hook_triggers.py`).

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
