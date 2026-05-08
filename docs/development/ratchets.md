<!-- RULE: Every file path governed by a ratchet appears exactly once — in the source-of-truth table below. Narrative sections reference the table by anchor link, not by restating paths. If a future edit duplicates a file path anywhere else in this doc, delete the duplicate. -->

# Ratchets

How the test-count and coverage-threshold gates work, how to update them, and how to recover when one fails. Gate-by-gate authority lives in [`LOCAL_CI_PARITY_INVARIANTS.md`](/LOCAL_CI_PARITY_INVARIANTS.md) (rows 25, 26, 27, 27a, 32); this doc is the contributor workflow for those gates.

---

## Source of truth

| Policy | Python | TypeScript | Model | Marker |
|---|---|---|---|---|
| [Coverage threshold](#i-changed-a-coverage-threshold) | [`pyproject.toml::fail_under`](/pyproject.toml) | [`extension/jest.config.ts`](/extension/jest.config.ts) (global + per-file tiers) | Strict floor, raise-only | [`[threshold-update]`](#markers) — applies to both |
| [Test-count floor](#i-added-tests) | [`.test-floor-contract.json`](/.test-floor-contract.json) → `python.min_collected` | same file → `extension.min_collected` | Strict equality; per-commit (Python), HEAD-only (Extension) | [`[ratchet-realignment]`](#markers) / [`[ratchet-test-removal]`](#markers) — **Python only** |
| [Partial branches (TS-only, different model)](#partial-branches-different-model) | *n/a* | [`.coverage-partial-branches-baseline.json`](/.coverage-partial-branches-baseline.json) + `LOCKED_ZERO_FILES` in [`scripts/check_partial_branches.py`](/scripts/check_partial_branches.py) | **Baseline co-change** (counts move in both directions; several files locked at zero) | none |

---

## Markers

| Marker | What it waives | Applies to |
|---|---|---|
| `[threshold-update]` | Coverage threshold value change | Python + TypeScript, global and per-file alike |
| `[ratchet-realignment]` | Test-count floor jumped past the test-add delta (catching up historical drift) | **Python only** — Extension equality drift is never waived |
| `[ratchet-test-removal]` | Test-count floor decreased intentionally | **Python only** |

**Placement**: must appear in a commit **subject line** within the PR's base-to-head range. Markers in commit bodies are NOT honored. Marker scope is commit-local — a marker on a later commit does not retroactively cover an earlier un-marked commit.

---

## I added tests

### Python

```bash
python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml
```

The output line `actual=N (cross-platform (Windows-filtered))` is the correct floor regardless of the developer's OS. A bare `pytest --collect-only` on Windows over-reports by the platform-conditional delta and is not a valid measurement.

Update `python.min_collected` in the test-floor contract to `N` and stage with the test additions.

### TypeScript

```bash
cd extension && pnpm test:coverage          # writes extension/test-results.xml
cd .. && python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml
```

Update `extension.min_collected` in the test-floor contract to the printed count and stage together.

### Python-only contributors

The ratchet-bump gate always reads `extension/test-results.xml` even when your change touches no TypeScript. Run `cd extension && pnpm test:coverage` once to populate that file, or the gate exits with SETUP.

---

## I changed a coverage threshold

1. Compute the new threshold from actual coverage on the [canonical env](#canonical-env): `threshold = floor(actual − 2.0)`.
2. Edit the threshold at source — Python via `pyproject.toml::fail_under`, TypeScript via `extension/jest.config.ts` (global `coverageThreshold` or any per-file key).
3. Add `[threshold-update]` to a commit subject line.

Per-file thresholds are enforced identically to globals. Authoritative per-metric values (statements / branches / functions / lines) live in [`extension/jest.config.ts`](/extension/jest.config.ts).

---

## Partial branches (different model)

Extension-only. Not marker-waivable. Not a floor — a strict **baseline co-change** contract.

**Both directions fail the gate.** A count increase is a regression (`COVERAGE_REGRESSION`). A count decrease also fails (`BASELINE_COCHANGE_REQUIRED`) because the baseline must move downward in the same commit that drove the count down.

**Several files are locked at zero forever** via `LOCKED_ZERO_FILES` in [`scripts/check_partial_branches.py`](/scripts/check_partial_branches.py). Any non-zero baseline entry for those paths is rejected. To recover from a locked-file regression, drive the partial-branch count back to zero — no marker exists.

When the gate fails it prints the exact JSON patch to apply to the baseline. Copy it verbatim and stage in the same commit as the code change.

---

## Recovery

### Python test-count drift

| State | Fix |
|---|---|
| Drift introduced on **HEAD**, not yet pushed | Update contract and `git commit --amend` |
| Drift introduced **earlier** in the branch, not yet pushed | `git commit --fixup=<sha>`, then `git rebase -i --autosquash origin/main` |
| Drift-introducing commit **already pushed** | New commit with `[ratchet-realignment]` (catch-up bump) or `[ratchet-test-removal]` (intentional reduction) in the subject |

### Extension test-count drift

`cd extension && pnpm test:coverage` to refresh the JUnit, then re-measure with `check_ratchet_bump.py` and update `extension.min_collected`. Markers don't apply — `extension/test-results.xml` is not tracked in git so per-commit historical snapshots cannot be materialized.

### Partial-branches regression or co-change required

`cd extension && pnpm test:coverage && pnpm test:partial-branches`. Apply the printed JSON patch to the baseline. For locked-zero files, drive the count to zero instead.

### Coverage threshold drift

Recompute the threshold on the canonical env (`floor(actual − 2.0)`) and add `[threshold-update]` to the commit subject.

---

## Canonical env

```
Python     : ubuntu-latest + Python 3.12
Extension  : ubuntu-latest + Node 22
```

Local measurements on other OS/runtime combinations may differ — re-compute on the canonical leg before filing a ratchet change. This block is co-located in the failure output of `check_threshold_changes.py`, `check_ratchet_bump.py`, and the `threshold-change-guard` CI echo; if it changes here, grep all four copies and update them in the same commit.
</content>
