# Contract: Byte-Determinism and Regeneration Invariant

**Feature**: `309-demo-pr-drilldown`

Defines the byte-level determinism contract for demo artifact regeneration, the canonical re-serialization recipe, and the staged-vs-worktree guard that protects the promotion step from running on undefined input state.

**Authoritative spec refs**: FR-014, FR-015, FR-016, FR-018 (from [`spec.md`](../spec.md)).

## 1. Byte-determinism contract

**Statement**: For every committed weekly rollup at `docs/data/aggregates/weekly_rollups/*.json`, regenerating the demo artifact set on the baseline Python interpreter (3.12.x) with the committed seed MUST produce a rollup whose non-PR-field content is BYTE-IDENTICAL to the committed version.

"Non-PR-field content" means: the rollup with `prs`, `_prs_truncated`, and `_prs_cap` removed, re-serialized using the aggregator's canonical formatting (§2 below), MUST byte-match the committed file bytes.

**Baseline Python**: 3.12.x. Pinned by `COMMITTED_DEMO_BASELINE_PYTHON_VERSION` in `scripts/demo_generation_common.py`.

**Seed**: `SEED = 42` (existing constant in `scripts/generate-demo-data.py`). No change.

## 2. Canonical re-serialization recipe

```python
import json

def canonical_serialize(payload: dict[str, object]) -> bytes:
    return (
        json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True)
        + "\n"
    ).encode("utf-8")
```

**Parameter lock**:
- `indent=2` — exact two-space indentation, no alternate forms.
- `ensure_ascii=False` — unicode characters emitted as UTF-8 raw bytes, not `\uXXXX` escapes.
- `sort_keys=True` — alphabetically sorts keys, normalizing insertion-order drift out of the byte stream. Matches the aggregator (`aggregators.py:1705`) and the demo writer (`demo_generation_common.canonical_json:210`).
- Trailing `\n` — single LF at end of file. No CRLF on Windows.

**Encoding**: UTF-8 explicit. Never the default encoding.

## 3. Byte-equality regen test

**Test**: `tests/demo/test_regen_byte_stability.py`.

**Procedure** (strip BOTH sides; committed and regen both carry PR fields post-slice-2d):

```python
def strip_pr(payload: dict[str, object]) -> dict[str, object]:
    out = dict(payload)
    for key in ("prs", "_prs_truncated", "_prs_cap"):
        out.pop(key, None)
    return out

for committed_path in sorted((DOCS_DATA / "aggregates" / "weekly_rollups").glob("*.json")):
    regen_path = REGEN_OUTPUT / committed_path.relative_to(DOCS_DATA)
    committed_bytes = canonical_serialize(strip_pr(json.loads(committed_path.read_text("utf-8"))))
    regen_bytes = canonical_serialize(strip_pr(json.loads(regen_path.read_text("utf-8"))))
    assert regen_bytes == committed_bytes, (
        f"Byte-determinism regression: {committed_path.name} non-PR content drifted."
    )
```

**Fails on**: whitespace drift, unicode-escape drift, trailing-newline drift, or any content change in non-PR fields. Key-order drift cannot surface because both sides are serialized with `sort_keys=True`.

**Runs during**: slice 2d CI + pre-push (once the regen commit lands); can be run manually via `python scripts/run_pytest.py tests/demo/test_regen_byte_stability.py`.

## 4. Synthetic generator's key invariant

To satisfy the byte-equality contract, the synthetic generator emits the three PR-level keys on every non-empty rollup:

```python
# Existing rollup construction (unchanged): all other keys assigned here

# Feature 309: emit the three PR-level keys in rollup_dict:
rollup_dict["prs"] = synthetic_prs
rollup_dict["_prs_truncated"] = prs_truncated
rollup_dict["_prs_cap"] = _PR_DETAIL_CAP
```

**Insertion order is not load-bearing**: the writer uses `sort_keys=True`, so the serialized layout is alphabetically normalized. This makes byte-determinism robust to insertion-order changes.

**Test coverage**:
- `tests/demo/test_synthetic_pr_contract.py::test_key_insertion_order_matches_aggregator` asserts the three keys are PRESENT in committed rollups via `json.loads(text, object_pairs_hook=list)`.
- `tests/demo/test_synthetic_pr_contract.py::test_committed_rollup_bytes_survive_round_trip` asserts the committed bytes exactly match `json.dumps(..., sort_keys=True, ensure_ascii=False, indent=2) + "\n"` on round-trip — the load-bearing writer-recipe invariant.

## 5. Isolated RNG stream (FR-016)

To prevent synthetic PR generation from perturbing existing random streams:

```python
# Existing pattern from review-time extension (preserved):
_REVIEW_TIME_SEED_OFFSET = 1000
rt_rng = random.Random(SEED + _REVIEW_TIME_SEED_OFFSET)

# New for feature 309:
_PR_RECORD_SEED_OFFSET = 2000
pr_record_rng = random.Random(SEED + _PR_RECORD_SEED_OFFSET)
```

**Invariant**: the synthetic PR generator consumes ONLY `pr_record_rng`. It MUST NOT call the shared `RNG` instance or any other seeded stream.

**Test coverage**: `tests/demo/test_synthetic_pr_contract.py::test_rng_isolation` runs the generator twice with different pre-PR-generation RNG-stream consumption patterns and asserts the produced `prs` arrays are byte-identical (proving the PR generator's stream is independent).

## 6. Staged-vs-worktree guard (FR-018)

**Purpose**: ensures the promotion step runs on the staged snapshot only. Without this guard, a developer with uncommitted or staged-but-not-in-HEAD edits to demo inputs could produce an artifact tree corresponding to no reviewable commit.

**Signature**:

```python
class UncommittedInputsError(RuntimeError):
    """Raised when demo-build inputs have unstaged or staged-but-not-in-HEAD changes."""

def assert_inputs_clean(repo_root: Path, inputs: list[Path], allow_dirty: bool = False) -> None:
    """Verify every path in `inputs` is byte-identical to HEAD in both staging and worktree.

    Args:
        repo_root: repository root (where git commands run)
        inputs: list of relative paths (from repo_root) to demo-build input files
        allow_dirty: escape hatch for local dev only; never used in CI

    Raises:
        UncommittedInputsError with distinct messages for staged vs unstaged diffs
    """
```

## 7. Dual git diff

```python
def _run_git(args: list[str], repo_root: Path) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=str(repo_root),
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()

# Check 1: staged vs HEAD
staged = _run_git(
    ["diff", "--cached", "--name-only", "HEAD", "--", *[str(p) for p in inputs]],
    repo_root,
)
if staged:
    raise UncommittedInputsError(
        f"[demo-build] staged changes in inputs: {staged}"
    )

# Check 2: worktree vs staged
unstaged = _run_git(
    ["diff", "--name-only", "--", *[str(p) for p in inputs]],
    repo_root,
)
if unstaged:
    raise UncommittedInputsError(
        f"[demo-build] unstaged changes in inputs: {unstaged}"
    )
```

## 8. Input set

The `inputs` list passed to `assert_inputs_clean` by `build-demo-dataset.py`:

```python
DEMO_BUILD_INPUTS: list[Path] = [
    Path("scripts/build-demo-dataset.py"),
    Path("scripts/generate-demo-data.py"),
    Path("scripts/generate-demo-insights.py"),
    Path("scripts/generate-demo-predictions.py"),
    Path("scripts/demo_generation_common.py"),
    Path("scripts/strip_pr_arrays.py"),
    # All committed distribution fixtures:
    Path("scripts/demo-distributions/title-tokens.json"),
    Path("scripts/demo-distributions/cycle-time-per-repo-size.json"),
    Path("scripts/demo-distributions/author-concentration.json"),
    Path("scripts/demo-distributions/pr-count-per-week-per-repo.json"),
    Path("scripts/demo-distributions/truncation-exercise-week.json"),
]
```

Adding a new demo input (future change) requires appending to this list. The list is LOCAL to `build-demo-dataset.py`; no external consumer depends on it.

## 9. Cross-OS invariants (QG-39)

- `subprocess.run` with forward-slash paths (converted via `pathlib.Path(...).as_posix()` where needed).
- No shell=True invocations.
- `git` is assumed in PATH on all platforms (standard dev environment assumption).

## 10. Typing invariants (QG-40)

- `DEMO_BUILD_INPUTS: list[Path]` — typed precisely, not `list[object]` or `list[Any]`.
- `assert_inputs_clean` return type `None`; raises on failure.
- `_run_git` return type `str`; never returns bytes or `Any`.

## 11. Override semantics

`allow_dirty=True` is permitted only when:
- The developer is iterating locally AND
- The resulting build is NOT promoted (i.e., `--no-promote` flag is set on `build-demo-dataset.py`)

**Enforcement**: `build-demo-dataset.py` entry MUST NOT pass `allow_dirty=True` together with promotion. If both are passed, the script aborts with a diagnostic.

CI workflows NEVER set `allow_dirty`. This is enforced at workflow-definition review (manual), not at test time.
