<!-- RULE: Every file path governed by a ratchet appears exactly once — in the source-of-truth table below. Narrative sections reference the table by anchor link, not by restating paths. If a future edit duplicates a file path anywhere else in this doc, delete the duplicate. -->

# Ratchets

How the test-count and coverage-threshold gates work, how to update them, and how to recover when one fails.

> **CI is authoritative. Local success does not prove CI correctness.**
> Thresholds and floors are computed on the canonical CI leg. If CI disagrees
> with your local run, trust CI and re-compute against the canonical leg before
> filing a ratchet change.

> **TypeScript test-count drift does NOT accept marker waivers.**
> `[ratchet-realignment]` and `[ratchet-test-removal]` apply to the Python
> suite only. For extension drift, re-measure and bump the floor directly —
> there is no marker escape. See [Recovery](#recovery) for why.

---

## Source of truth

| Policy | Python | TypeScript | Model | Marker |
|---|---|---|---|---|
| [Coverage threshold](#i-changed-a-coverage-threshold) | [`pyproject.toml::fail_under`](/pyproject.toml) | [`extension/jest.config.ts`](/extension/jest.config.ts) (global + per-file tiers) | Strict floor, raise-only | [`[threshold-update]`](#markers) — applies to both |
| [Test-count floor](#i-added-tests) | [`.test-floor-contract.json`](/.test-floor-contract.json) → `python.min_collected` | same file → `extension.min_collected` | Strict equality; per-commit (Python), HEAD-only (Extension) | [`[ratchet-realignment]`](#markers) / [`[ratchet-test-removal]`](#markers) — **Python only** |
| [Partial branches (TS-only, different model)](#partial-branches-different-model) | *n/a* | [`.coverage-partial-branches-baseline.json`](/.coverage-partial-branches-baseline.json) + `LOCKED_ZERO_FILES` in [`scripts/check_partial_branches.py`](/scripts/check_partial_branches.py) | **Baseline co-change** (counts move in both directions; several files locked at zero) | none |

---

## Markers

| Marker | What it waives | Gate that honors it | Applies to |
|---|---|---|---|
| `[threshold-update]` | Coverage threshold value change | [`threshold-change-guard`](/.github/workflows/ci.yml) + [`scripts/check_threshold_changes.py`](/scripts/check_threshold_changes.py) | Python + TypeScript, global and per-file alike |
| `[ratchet-realignment]` | Test-count floor jumped past the test-add delta (catching up historical drift) | [`ratchet-bump-guard`](/.github/workflows/ci.yml) via [`scripts/check_ratchet_bump.py`](/scripts/check_ratchet_bump.py) | **Python only** — Extension equality drift is never waived |
| `[ratchet-test-removal]` | Test-count floor decreased intentionally | `ratchet-bump-guard` | **Python only** |

**Placement rules for every marker above:**

- Must appear in a commit **subject line** within the PR's base-to-head range.
  Scanned via `git log --oneline`; markers placed in commit bodies are NOT honored.
- Marker scope is commit-local. `[ratchet-realignment]` on a later commit does
  not retroactively cover an earlier un-marked commit, because the gate walks
  first-parent history and checks each commit against its parent.

Governance: [`LOCAL_CI_PARITY_INVARIANTS.md`](/LOCAL_CI_PARITY_INVARIANTS.md)
Rows 25 (`threshold-change-guard`), 26/27 (test count), 27a (`ratchet-bump-guard`),
32 (coverage-delta) own the full gate contracts.

---

## I added tests

### Python

1. Measure the authoritative floor on any OS:

    ```
    python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml
    ```

    The output line `actual=N (cross-platform (Windows-filtered))` is the
    correct floor regardless of the developer's OS. A bare
    `pytest --collect-only` on Windows over-reports by the platform-conditional
    delta and is not a valid measurement.

2. Update `python.min_collected` in the test-floor contract to `N`.
3. Stage the test additions and the contract bump in the same commit.

### TypeScript

1. Produce the canonical JUnit artifact:

    ```
    cd extension && pnpm test:coverage
    ```

    `pnpm test:coverage` is the minimum command — it enables `--reporters=jest-junit`
    which writes `extension/test-results.xml`. `pnpm test:ci` also works but
    additionally runs partial-branches, smoke, and format checks you may not
    want in the same step.

2. Run the ratchet gate (step 1 of the Python flow) to print the authoritative
   extension count.
3. Update `extension.min_collected` in the test-floor contract.
4. Stage together.

### Python-only contributors

The ratchet-bump gate always reads `extension/test-results.xml`, even when
your change touches no TypeScript. Run `cd extension && pnpm test:coverage`
once to populate that file, or the gate exits with a SETUP error complaining
about a missing or stale JUnit artifact.

---

## I changed a coverage threshold

1. Compute the new threshold from actual coverage on the canonical leg
   (see [Canonical env](#canonical-env)):
   `threshold = floor(actual − 2.0)`.
2. Edit the threshold at source (see the [Source of truth](#source-of-truth)
   table) — Python via `pyproject.toml` → `fail_under`, TypeScript via
   `extension/jest.config.ts` (global `coverageThreshold` or any per-file
   key).
3. Add `[threshold-update]` to a commit subject line in the PR.

**Per-file thresholds are enforced identically to globals.** Bumping
`ui/modules/ml.ts`, `ui/artifact-client.ts`, or any other per-file entry
requires the same marker — the threshold-change-guard's regex matches indented
per-file values exactly the same way as the top-level global. The TypeScript
per-file tier table, phase schedule, and history live in
[`extension/COVERAGE_RATCHET.md`](/extension/COVERAGE_RATCHET.md).

---

## Partial branches (different model)

Extension-only. Not marker-waivable. Not a floor — a strict **baseline co-change**
contract.

**Both directions fail the gate.** A count increase is a regression
(`COVERAGE_REGRESSION`). A count decrease also fails (`BASELINE_COCHANGE_REQUIRED`)
because the baseline must move downward in the same commit that drove the count
down. "Lowering is good" is not how this gate works — the baseline tracks strict
per-file equality, not an upper bound.

**Several files are locked at zero forever** via `LOCKED_ZERO_FILES` in
[`scripts/check_partial_branches.py`](/scripts/check_partial_branches.py).
Any non-zero baseline entry for those paths is rejected with `SETUP`. To recover
from a locked-file regression, drive the partial-branch count back to zero —
no marker exists.

When the gate fails it prints the exact JSON patch to apply to the baseline file.
Copy it in verbatim and stage in the same commit as the code change.

---

## Recovery

### Python test-count drift

The drift direction determines the fix, and the commit's push state determines
whether a marker is needed.

| State | Fix |
|---|---|
| Drift introduced on **HEAD**, not yet pushed | Update the contract and `git commit --amend` |
| Drift introduced **earlier** in the branch, not yet pushed | `git commit --fixup=<sha>` with the fix, then `git rebase -i --autosquash origin/main` |
| Drift-introducing commit **already pushed** | New commit with `[ratchet-realignment]` (catch-up bump) or `[ratchet-test-removal]` (intentional reduction) in the subject |

A follow-up commit without a marker does **not** retroactively waive an
earlier commit's drift. Marker scope is per-commit first-parent.

### Extension test-count drift

One path:

1. `cd extension && pnpm test:coverage` — refresh `extension/test-results.xml`.
2. `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml` —
   prints the authoritative extension count.
3. Update the `extension.min_collected` key in the test-floor contract to
   that count; stage with the code change that caused the drift.

Markers are ignored for extension drift because `extension/test-results.xml`
is not tracked in git, so per-commit historical snapshots cannot be
materialized.

### Partial-branches regression or co-change required

Regenerate the Jest LCOV artifact first (`cd extension && pnpm test:coverage`)
so `extension/coverage/lcov.info` reflects HEAD, then run
`cd extension && pnpm test:partial-branches`. Apply the printed JSON patch
to the baseline. Stage in the same commit. For locked-zero files, drive the
count to zero instead of raising the baseline.

### Coverage threshold drift

Recompute the threshold on the canonical leg (`floor(actual − 2.0)`) and add
`[threshold-update]` to the commit subject.

---

## Two floor scripts, distinct jobs

| Script | What it checks | When it runs | Marker |
|---|---|---|---|
| [`scripts/check_test_floor_contract.py`](/scripts/check_test_floor_contract.py) | HEAD snapshot equals the test-floor contract (Python + Extension) | Preflight, CI | — always factual; not marker-waivable |
| [`scripts/check_ratchet_bump.py`](/scripts/check_ratchet_bump.py) | Per-commit first-parent `floor_delta == actual_delta`; inter-file parity between [`run_pr_preflight.py`](/scripts/run_pr_preflight.py) and [`.github/workflows/ci.yml`](/.github/workflows/ci.yml) | Pre-push, preflight, CI (`ratchet-bump-guard` job) | `[ratchet-realignment]` / `[ratchet-test-removal]` — Python only |

---

## Canonical env

```
Canonical env (authoritative for threshold values and floor values):
  Python     : ubuntu-latest + Python 3.12
  Extension  : ubuntu-latest + Node 22
Local measurements on other OS/runtime combinations may differ — re-compute
on the canonical leg before filing a ratchet change.
```

This exact block appears in the failure output of
[`check_threshold_changes.py`](/scripts/check_threshold_changes.py),
[`check_ratchet_bump.py`](/scripts/check_ratchet_bump.py), and the
`threshold-change-guard` CI echo so the canonical leg is surfaced at every
drift event. If the block needs to change, grep all four copies and update
them in the same commit.

The canonical leg is not enforced by a gate — it is enforced by doc,
co-location with the CI matrix, and reviewer discipline. Altering the matrix
in [`.github/workflows/ci.yml`](/.github/workflows/ci.yml) without
recomputing thresholds and floors is a silent correctness break.

---

## See also

- [`LOCAL_CI_PARITY_INVARIANTS.md`](/LOCAL_CI_PARITY_INVARIANTS.md) — governance contract for every gate; rows 25 / 26 / 27 / 27a / 32 own the policies in this doc
- [`extension/COVERAGE_RATCHET.md`](/extension/COVERAGE_RATCHET.md) — TypeScript per-file tier table, TS phase schedule, TS history
- [`specs/016-coverage-ratchet/spec.md`](/specs/016-coverage-ratchet/spec.md) — policy origin for the coverage-threshold ratchet
- [`extension/tests/meta/`](/extension/tests/meta/) — meta-gates that can fire on test-adding commits but are not ratchets (config-parity, any-type, build-output-format, smoke-determinism, suppression-ratchet)
- [Testing guide](testing.md) — test organization and local run recipes
