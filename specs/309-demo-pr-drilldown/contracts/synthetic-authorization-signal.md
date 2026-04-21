# Contract: Synthetic-Authorization Signal

**Feature**: `309-demo-pr-drilldown`

Defines the lifecycle, placement, writer authorization, reader expectations, and absence guarantees of the synthetic-authorization signal (sentinel file).

**Authoritative spec refs**: FR-011, FR-012, FR-019, FR-020 (from [`spec.md`](../spec.md)).

## 1. Identity

- **Path**: `artifacts/demo-enterprise/data/aggregates/.synthetic-prs-authorized`
- **Content**: zero-length (empty file). Content is ignored; only existence matters.
- **Constant name (Python)**: `SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME = ".synthetic-prs-authorized"` — defined in `scripts/strip_pr_arrays.py` only (because `scripts/build-demo-dataset.py` is hyphenated and cannot be imported by other modules). Imported by `scripts/build-demo-dataset.py` (alongside the existing `strip_pr_arrays_from_rollups` import at line 34) and `scripts/run_repo_hook.py` (new import for the `sentinel-absence` subcommand). No duplicate definitions.

## 2. Writer authorization

**Single authorized writer**: `scripts/build-demo-dataset.py` (the demo orchestrator).

**Prohibited writers**: ANY file under:
- `src/ado_git_repo_insights/**` (backend, aggregator, types)
- `scripts/**` EXCEPT `scripts/build-demo-dataset.py`
- `extension/**` (extension UI)
- `tests/**` EXCEPT test fixture-setup helpers that use a different name (tests MAY write `.synthetic-prs-authorized` into scratch directories outside the repo tree, but MUST NOT commit such files)

**Enforcement**: `tests/unit/test_tenant_provenance_negative.py` greps `git ls-files --cached src/ scripts/` for the sentinel string literal. Only `scripts/strip_pr_arrays.py` is allowed to match (the constant-definition site). The orchestrator `scripts/build-demo-dataset.py` is the sentinel WRITER but imports the constant name — it does not contain the literal string.

## 3. Write timing

**When**: immediately after `generate-demo-data.py` completes successfully and before `promote_data` runs.

**How**:

```python
sentinel = ARTIFACT_DATA_DIR / "aggregates" / SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME
sentinel.touch(exist_ok=False)
```

`exist_ok=False` ensures a double-write (a retry that failed to clean up from the prior run) fails loudly rather than silently overwriting.

## 4. Reader expectations

**Single authorized reader**: `scripts/build-demo-dataset.py::promote_data`.

**Read operation**: `sentinel.exists()` — returns `bool`. No content is read.

**Read timing**: once, at the start of `promote_data`, after the destination-identity check has confirmed `destination_dir == DOCS_DATA_DIR`. See [`demo-strip-gate-v2.md`](./demo-strip-gate-v2.md) §1 for the exact call site.

## 5. Consumption

After `sentinel.exists()` returns True AND `assert_synthetic_shape` passes, the sentinel is consumed:

```python
sentinel.unlink()
```

**Ordering invariant**: `sentinel.unlink()` is the FIRST mutating operation after the branch decision. It executes BEFORE any `destination.mkdir`, `shutil.copytree`, or strip operation. Test coverage: `tests/unit/test_promote_data_unlink_ordering.py`.

**Failure-mode invariant**: if `sentinel.unlink()` raises (`PermissionError`, `OSError`, file-not-found due to race), `promote_data` re-raises immediately. No downstream mutation occurs. The destination directory is byte-identical to its pre-call state.

## 6. Absence guarantees at `docs/data/`

The sentinel MUST NOT appear anywhere under `docs/data/` at any time.

**Guards** (defense in depth):

1. **Demo pipeline self-consistency**: `promote_data` unlinks the sentinel from the source BEFORE `shutil.copytree` runs, so the copy cannot pick up the sentinel.
2. **Pre-push local gate**: `scripts/run_repo_hook.py::run_pre_push_hook` runs a sentinel-absence check at the END of the hook (after all other pre-push steps, last check before `push` succeeds). Implementation: `Path("docs/data").rglob(SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME)` MUST yield empty.
3. **CI first-step gate**: every `.github/workflows/demo.yml` job that invokes `build-demo-dataset.py` (and any `release.yml` job doing the same) runs the same absence check as its FIRST step (invoking `python scripts/run_repo_hook.py sentinel-absence`) before any build/promote/validate work.

**Test coverage**: `tests/unit/test_sentinel_absence_in_docs_data.py` asserts the committed `docs/data/` tree contains no sentinel file.

## 7. Sentinel lifecycle state machine

```text
                    [scripts/build-demo-dataset.py writes]
                                  │
                                  ▼
       ┌───────────────────────────────────────────────┐
       │  Sentinel present at                           │
       │  artifacts/demo-enterprise/data/aggregates/    │
       │  .synthetic-prs-authorized                     │
       └───────────────────────────────────────────────┘
                                  │
                                  ▼  (promote_data entry; sentinel.exists() == True)
                                  │
                      [assert_synthetic_shape checks]
                                  │
                 ┌────────────────┴────────────────┐
                 ▼                                 ▼
         [shape OK]                         [shape fails]
                 │                                 │
                 ▼                                 ▼
         sentinel.unlink()              SyntheticShapeError raised
                 │                                 │
                 ▼                                 ▼
         mkdir / copytree          Source + destination unchanged;
                 │                 sentinel STILL present in source
                 ▼                 (operator clears source state before retry)
         Destination has no sentinel
         Source has no sentinel
                 │
                 ▼
          (end state)
```

**Retry semantics**: if the shape check fails, the sentinel remains present in the source. The operator is expected to diagnose the shape anomaly, correct the source artifacts, and re-run. Re-running `promote_data` will again enter the sentinel-present branch and re-verify shape.

**Retry after `sentinel.unlink()` success but copytree failure**: the sentinel is already gone. A plain re-run of `promote_data` will now enter the SENTINEL-ABSENT branch and strip PR-level fields from the source — fail-closed to the tenant behavior. The operator MUST re-run the full `build-demo-dataset.py` flow (which re-runs the generator and re-writes the sentinel) rather than re-running `promote_data` in isolation.

## 8. Cross-OS invariants (QG-39)

- `pathlib.Path` only; no `os.path` string manipulation.
- `Path.touch(exist_ok=False)` and `Path.unlink()` are cross-platform.
- `Path.rglob(name)` on `docs/data/` works identically on Windows, macOS, Linux.
- No shell invocations, no `subprocess` calls against filesystem primitives.

## 9. Typing invariants (QG-40)

- `SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME: Final[str] = ".synthetic-prs-authorized"` — typed as `Final[str]`, never `typing.Any`.
- No function signature touching the sentinel returns `Any`. All return types are precise (`bool`, `None`, `Path`).
