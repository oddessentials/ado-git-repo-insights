## Flight 5 — CI Hardening & Python 3.10 Pandas Fix (Optimized Plan)

### Mission

Eliminate CI failures and prevent recurrence by:

1. fixing dependency-cruiser warnings **without weakening architecture rules**,
2. aligning test-count gating **without brittleness**,
3. restoring Python 3.10 CI passes by making pandas resolution **Python-version aware**, consistently across local + CI.

---

## Non-Negotiable Invariants (Hard Gates)

1. **Architecture invariants**

- `npm run depcruise` must produce **0 errors, 0 warnings**.
- Dependency-cruiser rules must remain **enforcing** (no broad allowlists that mask future coupling).

2. **Determinism invariants**

- CI results must be reproducible across OS matrix (`ubuntu`, `windows`, `macos`) and Python versions (3.10/3.11/3.12).
- Generated artifacts must never be “fixed in CI” via mutation; CI must **fail** if drift exists.

3. **Python compatibility invariants**

- Python **3.10 remains supported** in this PR.
- **Pandas major version policy:**
    - Python **3.10 → pandas 2.x**
    - Python **3.11+ → pandas 3.x**

- Packaging metadata must not block Python 3.10 (`Requires-Python` must include 3.10).

4. **Gating invariants**

- Test-count gating must detect real regressions without failing on legitimate growth.
- If thresholds are updated, the update must occur **in the same PR** as the test-suite change that necessitated it.

---

## Phase 0 — Preflight Inventory (Must Do First)

### Goal

Ensure changes apply everywhere pandas/test gates/packaging are defined so local and CI behave identically.

### Actions

- Repo-wide search for:
    - `pandas`, `pandas-stubs`
    - `Requires-Python`, `python_requires`
    - `min-collected`, `validate-test-results.py`
    - `pyproject.toml` (all copies)
    - lockfiles: `poetry.lock`, `uv.lock`, `requirements*.txt`, `constraints*.txt`, `pip-compile` outputs

- Record the authoritative packaging entrypoint(s) used by CI install (the one invoked by `pip install -e .` / `pip install .`).

### Exit Criteria

- You have a concrete list of every file that controls:
    - pandas dependency constraints
    - python supported versions
    - lock/constraints inputs
    - CI test-count validation parameters

---

## Phase 1 — Dependency-Cruiser Warning Resolution (Targeted Exceptions Only)

### Problem

Current warnings are legitimate under an overly broad rule but the fix must not weaken enforcement.

### Required Approach

**Do NOT blanket-exclude `charts/` from the rule.**
Instead, implement **targeted exceptions** for only the architecturally valid patterns:

#### Allowed Pattern A

`ui/modules/charts/*.ts` may import shared utilities from `ui/modules/charts.ts`.

#### Allowed Pattern B

`ui/modules/charts/index.ts` may import and export from `ui/modules/charts/*.ts` (barrel pattern).

### Changes

**[MODIFY] `extension/.dependency-cruiser.cjs`**

1. Keep `non-shared-modules-cross-import` intact (do not exclude `charts/`).
2. Add two explicit allow/exception rules (or refine existing rule with an explicit `from`+`to` exception list) that:
    - allow `^ui/modules/charts/[^/]+\.ts$` → `^ui/modules/charts\.ts$`
    - allow `^ui/modules/charts/index\.ts$` → `^ui/modules/charts/[^/]+\.ts$`

### Exit Criteria

- `cd extension && npm run depcruise` returns **0 warnings, 0 errors**
- Cross-imports outside those two patterns still produce warnings (rule remains meaningful).

---

## Phase 2 — Test Threshold Alignment (Hardening Without Brittleness)

### Problem

The current `--min-collected` for extension tests is far below reality and doesn’t detect regressions.
But hardcoding an exact number (e.g., 642) will cause future legitimate changes to break CI.

### Required Approach

Implement a gating policy that:

- prevents **material drops**
- allows **normal growth**
- requires explicit updates only when policy changes

### Changes

**[MODIFY] `.github/workflows/ci.yml`**

- Replace the single hard-coded `--min-collected=374` with one of these **non-brittle** mechanisms (pick one and implement fully):

#### Option 2A (Preferred): “No material regression” gate (tolerance-based)

- Set `--min-collected` to `LAST_KNOWN_GOOD - TOLERANCE`
- Example policy:
    - `min_collected = 642 - 10` (small tolerance)
    - Document that tolerance is intentional and small

- This will fail only when tests drop meaningfully.

**AND**

- Add an explicit documented rule: if tests intentionally decrease (rare), the PR must justify and update the threshold.

**[MODIFY] `.github/scripts/validate-test-results.py`** (only if needed)

- If the script cannot support the chosen policy cleanly, add support for:
    - `--tolerance=N` (preferred) or
    - `--min-collected-file=.github/test-thresholds.json` (centralized thresholds)

- Keep the script deterministic and OS-agnostic.

**[MODIFY] `README.md`**

- Do not publish brittle “642+” badges unless you commit to updating them with every change.
- Required change:
    - either remove the “count badge” entirely, or
    - convert it to a “tests passing” / “CI passing” badge that does not encode a fragile count.

### Exit Criteria

- CI fails on test-count regressions beyond tolerance
- CI does not fail merely because new tests were added
- README reflects the policy (not a snapshot that will rot)

---

## Phase 3 — Python 3.10 Pandas Compatibility (Repo-Wide, Not Just One File)

### Problem

`pandas>=3.0.0` cannot resolve on Python 3.10 because pandas 3 requires Python >=3.11. CI 3.10 jobs fail across OSes.

### Required Approach

- Use **PEP 508 environment markers** everywhere pandas is defined.
- Ensure packaging metadata (`Requires-Python`) still includes 3.10.
- Regenerate and commit any lockfiles/constraints used by CI.

### Changes

#### 3.1 Dependency rules (markers)

**[MODIFY] ALL packaging dependency definitions that include pandas**

- Replace any `pandas>=3.0.0` with:
    - `pandas>=2.2.0,<3.0.0; python_version < '3.11'`
    - `pandas>=3.0.0; python_version >= '3.11'`

**[MODIFY] ALL dev dependency definitions that include pandas-stubs**

- Do **not** leave 3.11+ unbounded.
- Mirror the pandas split explicitly with appropriate bounds:
    - `pandas-stubs>=2.0.0,<3.0.0; python_version < '3.11'`
    - `pandas-stubs>=3.0.0; python_version >= '3.11'`
      (If your ecosystem does not publish stubs at `3.0.0` yet, then adjust to the correct compatible major and still keep it bounded. Do not leave it unbounded.)

#### 3.2 Python support metadata

**[MODIFY] canonical package metadata**

- Ensure `Requires-Python` / `python_requires` includes **3.10** (e.g., `>=3.10`).
- Ensure no other packaging file contradicts this.

#### 3.3 Lock/constraints

**[MODIFY] lockfiles/constraints used by CI**

- Regenerate locks after markers are applied.
- Commit the updated lock artifacts.

#### 3.4 CI verification (Python-native, OS-agnostic)

**[MODIFY] `.github/workflows/ci.yml`**
Add a post-install step that validates pandas major version **in Python** (not `cut`, not shell parsing).

Required behavior:

- Python 3.10 job fails if pandas major != 2
- Python 3.11/3.12 job fails if pandas major != 3

Also ensure the step runs reliably on Windows by explicitly setting `shell: bash` only if truly needed, or avoid bash entirely by using `python -c` / a small inline Python snippet.

#### 3.5 Documentation

**[MODIFY] `README.md`**
Add an explicit compatibility note:

- Python 3.10 supported with pandas 2.x
- Python 3.11+ uses pandas 3.x
- 3.10 deprecation will be handled in a future separate PR (do not implement deprecation mechanics here)

### Exit Criteria

- All CI 3.10 jobs pass on ubuntu/windows/macos
- All CI 3.11/3.12 jobs pass on ubuntu/windows/macos
- Local fresh venv installs behave identically to CI for 3.10 and 3.11+

---

## Phase 4 — Verification Plan (Must Run and Must Pass)

### 4.1 Architecture validation

```bash
cd extension
npm run depcruise
```

**Expected:** 0 warnings, 0 errors

### 4.2 Extension tests

```bash
cd extension
npm run test:ci
```

**Expected:** all tests pass

### 4.3 Extension lint + typecheck

```bash
cd extension
npm run build:check
npm run lint
```

**Expected:** no errors

### 4.4 Python unit tests

```bash
python -m pytest -v --tb=short
```

**Expected:** all tests pass

### 4.5 Python lint + typecheck

```bash
ruff check .
mypy src/
```

**Expected:** no errors

### 4.6 Local install verification (required)

Run these in **fresh venvs**:

- Python 3.10: `pip install -e .` then run python tests + dashboard smoke test
- Python 3.11+: `pip install -e .` then run python tests + dashboard smoke test

### 4.7 Dashboard smoke test (required on 3.10 and 3.11+)

```bash
cd extension
npm run build:ui
cd ..
python scripts/sync_ui_bundle.py
python -m ado_git_repo_insights.cli dashboard
```

**Expected:** dashboard loads without errors

---

## CI Victory Gate (Must Be Green Before Merge)

All jobs must pass, including:

- `test(ubuntu-latest, 3.10)` → pandas 2.x
- `test(windows-latest, 3.10)` → pandas 2.x
- `test(macos-latest, 3.10)` → pandas 2.x
- `test(*, 3.11)` → pandas 3.x
- `test(*, 3.12)` → pandas 3.x
- `extension-tests` → gating works and does not flap
- No `depcruise` warnings

---

## Summary of File-Level Changes (Authoritative)

- `extension/.dependency-cruiser.cjs`
    - Keep enforcement
    - Add targeted exceptions:
        - `charts/*.ts → charts.ts`
        - `charts/index.ts → charts/*.ts`

- `.github/workflows/ci.yml`
    - Improve extension test-count gating to prevent regressions without brittleness
    - Add Python-native pandas major verification per Python version
    - Ensure the verification step runs on all OSes in matrix

- Packaging files (ALL occurrences)
    - Apply pandas + pandas-stubs PEP 508 markers everywhere
    - Ensure `Requires-Python` includes 3.10
    - Regenerate/commit any locks used by CI

- `README.md`
    - Remove or fix brittle test-count badges
    - Document pandas/Python split clearly

---

## Explicit Non-Goals for This PR

- Dropping Python 3.10 support (must occur in a future separate PR with a major bump)
- Weakening dependency-cruiser enforcement via broad exclusions
- Introducing CI “auto-fix” behavior that mutates tracked artifacts
