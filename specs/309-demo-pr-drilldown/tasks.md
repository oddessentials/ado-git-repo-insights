---

description: "Task list for feature 309-demo-pr-drilldown — synthetic demo exercises PR-level detail (v2, post-analyze remediation)"
---

# Tasks: Synthetic Demo Exercises PR-Level Detail

**Input**: Design documents from `specs/309-demo-pr-drilldown/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED — adversarial cell mapping for gates + enterprise test coverage (QG-42). Every gate / contract / behavior invariant has a failing test before production code; guard-style invariants are labeled as guards (not fail-first) since they pass vacuously against pre-implementation state.

**Organization**: Tasks are grouped by delivery slice (each a separate commit) AND tagged with user-story labels. Slice boundaries are locked. Per `/speckit.analyze` remediation: slice 2c is helpers + scaffolding ONLY; all PR-field emission and `docs/data/` regeneration land atomically in slice 2d.

**Terminology**: "Feature-060 FR-023" refers to the destination-identity privacy gate introduced in feature 060 and narrowed here. This feature (309) has its own FR-023 (see spec.md) about the literal truncation-exercise week — DO NOT confuse the two.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks in the current phase)
- **[Story]**: User-story label from spec.md (US1..US6) — present on story-scoped tasks; absent on setup / foundational-infrastructure / polish tasks
- Every task includes exact file paths

## Slice → phase mapping

| Phase | Slice | Commit scope |
|---|---|---|
| Phase 1 | 2a | Distribution fixtures + extract script + privacy-review gate |
| Phase 2 | 2b | Feature-060 FR-023 narrowed to binary gate (dead-code sentinel branch) + tenant-privacy infrastructure (US2, US5) |
| Phase 3 | 2c | Synthetic PR generator helpers + scaffolding ONLY — NO artifact shape change; `docs/data/` and artifact-tree PR fields unchanged (US1 scaffolding, US3 scaffolding, US6) |
| Phase 4 | 2d | Atomic: wire emission + write sentinel + flip schema-guard test + bump version + regen 260 rollups + byte-determinism test (US1, US3, US4) |
| Phase 5 | — | Polish / cross-cutting verification (no code changes) |

---

## Phase 1: Setup (Slice 2a — Distribution Fixtures)

**Purpose**: Derive and commit anonymized statistical distribution fixtures from a one-time tenant extract. Prerequisite for Slice 2d's synthetic generator emission.

**Depends on**: nothing (entry slice).

- [ ] T001 Add `.tmp/` entry to repo-root `.gitignore` to prevent the developer-local tenant-extract SQLite from being staged
- [ ] T002 [P] Create derivation script `scripts/extract_distribution_fixtures.py` with CLI flags `--db <path>` and `--output <dir>`; per `contracts/distribution-fixture-schema.md` §3
- [ ] T003 [P] Write failing privacy-review test at `tests/unit/test_distribution_fixture_privacy.py` — per contract (`contracts/distribution-fixture-schema.md` §4), one `def test_*` function per invariant (blocklist tokens, schema shape for the three percentile files, literal values on `truncation-exercise-week.json`, privacy-review-date presence). Test MUST fail until T006 derives fixtures
- [ ] T004 [P] Create `scripts/demo-distributions/truncation-exercise-week.json` with locked literal values per `contracts/distribution-fixture-schema.md` §2.5: `week: "2025-W26"`, `target_qualified_pr_count: 520`, `contrast_weeks: ["2025-W25","2025-W27"]`, `contrast_max_pr_count: 300`
- [ ] T005 Run one-time tenant extract locally (manual; NOT committed). Cross-OS instruction REQUIRED (QG-39):
    - **POSIX (bash/zsh)**: `export ADO_PAT='<token>' && python -m ado_git_repo_insights.cli extract-prs --org oddessentials --db .tmp/oddessentials-extract.sqlite`
    - **Windows PowerShell**: `$env:ADO_PAT='<token>'; python -m ado_git_repo_insights.cli extract-prs --org oddessentials --db .tmp/oddessentials-extract.sqlite`
    - Exit code 0 required. The SQLite output stays in `.tmp/` (gitignored by T001)
- [ ] T006 Derive fixtures locally: `python scripts/extract_distribution_fixtures.py --db .tmp/oddessentials-extract.sqlite --output scripts/demo-distributions/`. Produces: `title-tokens.json`, `cycle-time-per-repo-size.json`, `author-concentration.json`, `pr-count-per-week-per-repo.json`
- [ ] T007 Verify `python scripts/run_pytest.py tests/unit/test_distribution_fixture_privacy.py` passes (previously failing at T003)
- [ ] T008 Ratchet-bump procedure: run `python scripts/run_pytest.py tests/unit/test_distribution_fixture_privacy.py --collect-only` to count collected entries; open `.test-floor-contract.json`; bump the Python floor by EXACTLY that count; verify via `python scripts/check_ratchet_bump.py --base-ref origin/main`
- [ ] T009 Stage and commit slice 2a. Explicit file list to stage:
    - `.gitignore`
    - `scripts/extract_distribution_fixtures.py`
    - `scripts/demo-distributions/title-tokens.json`
    - `scripts/demo-distributions/cycle-time-per-repo-size.json`
    - `scripts/demo-distributions/author-concentration.json`
    - `scripts/demo-distributions/pr-count-per-week-per-repo.json`
    - `scripts/demo-distributions/truncation-exercise-week.json`
    - `tests/unit/test_distribution_fixture_privacy.py`
    - `.test-floor-contract.json`
    - Message subject: `feat(#315): derive distribution fixtures for synthetic demo PR generator`
    - Body: full self-checklist (Changed / Could-break / Proven-by / Surfaces-moved). Rotate `ADO_PAT` after commit

**Checkpoint Slice 2a**: distribution fixtures committed; privacy-review test green; no behavior change to demo build or existing artifacts.

---

## Phase 2: Foundational (Slice 2b — Feature-060 FR-023 Binary Gate + Tenant-Privacy Infrastructure)

**Purpose**: Narrow **feature-060 FR-023** from destination-identity-based stripping to provenance-based binary stripping. Sentinel branch is dead code in this slice (no writer yet). Lands US2 and US5 fully.

**User Stories in this phase**:
- **US2** (P1) — Tenant PR data never leaks: atomicity tests + fail-closed shape verifier
- **US5** (P2) — Engineer cannot bypass privacy gate: negative-provenance test + pre-push + CI absence guards

**Depends on**: Phase 1 complete.

### Guard invariants and failing tests (write FIRST)

- [ ] T010 [P] [US5] Create guard invariant `tests/unit/test_tenant_provenance_negative.py` — uses `subprocess.run(["git", "ls-files", "--cached", "src/", "scripts/"])`, greps each file for the sentinel string literal, asserts ZERO matches except in `scripts/strip_pr_arrays.py`. Currently passes vacuously; includes a negative-fixture subtest that temporarily stages a file under `src/` containing the literal (cleanup in teardown) to prove the gate catches violations
- [ ] T011 [P] [US5] Create guard invariant `tests/unit/test_sentinel_absence_in_docs_data.py` — uses `Path("docs/data").rglob(".synthetic-prs-authorized")`, asserts empty. Constant name imported from `scripts/strip_pr_arrays` (per U2 relocation — see T016)
- [ ] T012 [P] [US2] Write failing test `tests/unit/test_assert_synthetic_shape.py` — parametrized over four fixture paths from T014. Asserts: synthetic-shaped → no raise; tenant-shaped → `SyntheticShapeError` with file path in message; missing `_prs_cap` raises; `_prs_cap != 500` raises
- [ ] T013 [P] [US5] Write failing test `tests/unit/test_promote_data_unlink_ordering.py` — `unittest.mock.MagicMock` records call order on `sentinel.unlink`, `destination.mkdir`, `shutil.copytree`, `strip_pr_arrays_from_rollups`; asserts unlink is FIRST mutating call. Second test case: patches `unlink` to raise `PermissionError`; asserts destination byte-identical (no mkdir, no copytree). Pattern mirrors `test_demo_parity_pipeline.py::TestPromoteDataStripGateAtomicity:741-795`
- [ ] T014 [P] [US2] Create four fixture trees under `tests/demo/fixtures/strip_gate/`:
    - `sentinel-present-synthetic-shaped/aggregates/weekly_rollups/*.json` + `aggregates/.synthetic-prs-authorized`
    - `sentinel-present-tenant-shaped/aggregates/weekly_rollups/*.json` (wrong shape) + `aggregates/.synthetic-prs-authorized`
    - `sentinel-absent-clean/aggregates/weekly_rollups/*.json` (no PR fields, no sentinel)
    - `sentinel-absent-with-residue/aggregates/weekly_rollups/*.json` (has PR fields, no sentinel)
- [ ] T015 [US2] Extend `tests/demo/test_demo_parity_pipeline.py::TestPromoteDataStripGateAtomicity` with two new methods using T014 fixtures (method names under 80 chars):
    - `test_sentinel_present_synthetic_preserves_prs`
    - `test_sentinel_present_tenant_raises_atomic`

### Implementation for Phase 2

- [ ] T016 Add constant to `scripts/strip_pr_arrays.py` (NOT `build-demo-dataset.py` which has a hyphen and cannot be imported): `SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME: Final[str] = ".synthetic-prs-authorized"`. Update `scripts/build-demo-dataset.py:34` import to include the new constant: `from strip_pr_arrays import strip_pr_arrays_from_rollups, SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME`
- [ ] T017 Implement `SyntheticShapeError` class and `assert_synthetic_shape(aggregates_dir: Path) -> None` helper in `scripts/build-demo-dataset.py` per `contracts/demo-strip-gate-v2.md` §3. Verify T012 passes
- [ ] T018 Refactor `scripts/build-demo-dataset.py::promote_data` to the binary gate per `contracts/demo-strip-gate-v2.md` §1 including the `else: assert not sentinel.exists()` third-path guard. Sentinel-present branch is dead code in this slice. Verify T010, T011, T013, T015 pass
- [ ] T019 [US5] In `scripts/run_repo_hook.py` add a named subcommand and rewire the pre-push chain to use it (enables clean entrypoint-parity testing per F4 fix):
    - (a) Add a named function `run_sentinel_absence_check() -> None`: `from strip_pr_arrays import SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME`; `matches = sorted(Path("docs/data").rglob(SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME))`; `if matches: raise SystemExit(f"[sentinel-absence] sentinel leaked to docs/data/: {matches}")`; else `safe_print("[sentinel-absence] ok")`
    - (b) Extend argparse at line 1215: `parser.add_argument("hook", choices=("pre-commit", "pre-push", "sentinel-absence"))`
    - (c) Extend `main()` dispatch at line 1220 to call `run_sentinel_absence_check()` when `args.hook == "sentinel-absence"`
    - (d) Insert `run_sentinel_absence_check()` call inside `run_pre_push_hook` between line 1209 (`run_command([sys.executable, "scripts/run_pr_preflight.py"])`) and line 1210 (`safe_print("[pre-push] all pre-push checks passed")`)
    Result: one named CLI subcommand `python scripts/run_repo_hook.py sentinel-absence` invokable from pre-push internally AND by CI and the entrypoint-parity test externally — satisfies entrypoint-command parity (not helper-parity). Pre-push order becomes: version guard → baseline integrity → pre-commit checks → CRLF guard → asset validation → invariant artifact guards → PR preflight → **sentinel-absence (new)** → final print
- [ ] T020 [US5] Edit `.github/workflows/demo.yml` (NOT `ci.yml` — demo-build is invoked in `demo.yml:85`, not `ci.yml`). Add a first-step `sentinel-absence` check to the `build-demo` job (around line 83, before the `build-demo-dataset.py` run at line 85), invoking the named subcommand from T019: `- name: Sentinel absence guard` with `run: python scripts/run_repo_hook.py sentinel-absence`. Also audit `.github/workflows/release.yml` for any additional demo-build invocations; add the same first-step there if found. Using the subcommand (not an inline Python one-liner) is mandatory — it gives the entrypoint-parity test (T032) a shared target between local and CI paths
- [ ] T021 Audit `scripts/regenerate-demo.py` — grep for any direct writes to `docs/data/` that bypass `promote_data`. If found, route them through `promote_data` (which now carries the binary gate). If the script only invokes `build-demo-dataset.py` as a subprocess (and no direct writes), add a one-line comment confirming the pattern. Commit finding either way
- [ ] T022 Update `docs/reference/dataset-contract.md` privacy-posture section to describe provenance-based narrowing. PRESERVE the `<!-- anchor: privacy-posture-tenant-sensitive-fields -->` anchor at its current line (required by `tests/unit/test_privacy_posture_ordering.py`). Body extension: reference "feature-060 FR-023" explicitly (disambiguates from this spec's own FR-023 about the truncation week); link to `specs/309-demo-pr-drilldown/contracts/demo-strip-gate-v2.md`
- [ ] T023 Add supersedure note at the top of `specs/060-throughput-pr-drilldown/contracts/demo-strip-gate.md`: "Superseded by `specs/309-demo-pr-drilldown/contracts/demo-strip-gate-v2.md` (provenance-based binary gate; the destination-identity-based gate described below — feature-060 FR-023 — was narrowed to a binary fail-closed gate keyed on a synthetic-authorization sentinel). The file-level strip helper (`strip_pr_arrays_from_rollups`) is preserved and invoked on the sentinel-absent branch." Do NOT rewrite the body
- [ ] T024 Verify full pre-push chain: `python scripts/run_repo_hook.py pre-push`. If it fails: triage per memory `feedback_preflight_for_triage_not_pre_push.md` — pivot to `python scripts/run_pr_preflight.py` + targeted gates; do NOT re-run pre-push in a loop
- [ ] T025 Ratchet-bump procedure for slice 2b: for each new/extended test file (`test_tenant_provenance_negative.py`, `test_sentinel_absence_in_docs_data.py`, `test_assert_synthetic_shape.py`, `test_promote_data_unlink_ordering.py`, `test_demo_parity_pipeline.py::TestPromoteDataStripGateAtomicity`), run `pytest --collect-only` BEFORE and AFTER the slice-2b edits; sum the deltas; bump `.test-floor-contract.json` Python floor by EXACTLY that sum. Verify via `python scripts/check_ratchet_bump.py --base-ref origin/main`
- [ ] T026 Stage and commit slice 2b. Subject: `feat(#315): narrow feature-060 FR-023 to provenance-based binary gate (dead-code sentinel branch)`. Body: full self-checklist; Proven-by enumerates T010-T015 + integration with existing feature-060 atomicity tests

**Checkpoint Slice 2b**: binary gate shaped; sentinel-present branch unreachable (no writer yet); committed `docs/data/` unchanged; existing feature-060 tests green (including `test_demo_stripped_fields_are_absent` which still reads committed rollups without PR fields); new guard invariants green; tenant-privacy infrastructure fully deployed.

---

## Phase 3: Synthetic Generator Helpers + Scaffolding (Slice 2c — NO Artifact Shape Change)

**Purpose**: Land `generate_pr_records()` helper and inputs-clean guard as TESTABLE UNITS. Explicitly NO emission into the main pipeline, NO sentinel write from the orchestrator, NO artifact shape change. Contract tests drive the helper directly via import. Committed `docs/data/` and artifact-tree rollup shapes remain unchanged — guaranteeing `test_demo_stripped_fields_are_absent` and `test_docs_promotion_matches_canonical_bytes` (on every Python interpreter lane) continue to pass.

**User Stories in this phase (scaffolding; visible surface lands in slice 2d)**:
- **US1** (P1) — Helper + RNG + `PrRecord` import; emission deferred to slice 2d
- **US3** (P1) — (no direct work in this slice; lands in slice 2d via the `truncation-exercise-week.json` override)
- **US6** (P3) — Inputs-clean guard fully operational

**Depends on**: Phase 2 complete.

### Failing tests for Phase 3 (write FIRST)

- [ ] T027 [P] [US1] Write failing test `tests/demo/test_synthetic_pr_contract.py::test_prs_conform_to_pr_record_shape` — imports `generate_pr_records` from `scripts/generate-demo-data.py` via importlib (same pattern `test_demo_parity_pipeline.py` uses at line 128); drives it with fixture inputs; asserts every returned record has exactly the 5 keys `{"id","title","author_id","repository_id","cycle_time"}` with correct types. Unit-level; does NOT invoke the full build
- [ ] T028 [P] [US1] Add `tests/demo/test_synthetic_pr_contract.py::test_prs_cap_and_sort_invariant` — drives `generate_pr_records` with 501 synthesizable qualified PRs; asserts `len(result) <= 500`; asserts stable sort by `(-cycle_time, id)` via explicit tuple comparison on the returned list
- [ ] T029 [P] [US1] Add `tests/demo/test_synthetic_pr_contract.py::test_truncation_boundary_parametrized` — parametrized over `[(499, False, 499), (500, False, 500), (501, True, 500)]`; constructs synthetic per-week qualified-PR inputs; drives `generate_pr_records` + applies the truncation decision locally (matches the aggregator pattern at `aggregators.py:793-795`); asserts each tuple
- [ ] T030 [P] [US1] Add `tests/demo/test_synthetic_pr_contract.py::test_rng_isolation` — builds two `pr_record_rng` instances with the same seed; consumes from one before calling `generate_pr_records`; asserts the two invocations produce byte-identical outputs (proves no dependency on the shared `RNG`)
- [ ] T031 [P] [US6] Write failing test `tests/unit/test_assert_inputs_clean.py` — uses pytest `tmp_path` + `subprocess.run(["git","init","-q"], cwd=tmp_path)` to build a test git repo; three scenarios: (a) worktree-unstaged-change in a tracked input → raises with stderr containing `unstaged changes in inputs:`; (b) staged-change-not-in-HEAD → raises with `staged changes in inputs:`; (c) clean worktree + clean index → no raise
- [ ] T032 [US2] Write failing test `tests/unit/test_strip_gate_entrypoint_parity.py` — targets the named `sentinel-absence` subcommand from T019 (NOT full `pre-push`, which has 7 earlier stages that can false-fail and mask the sentinel behavior). Two fixtures at `docs/data/`-like scope (use `tmp_path` + `monkeypatch.chdir(tmp_path)` with a scratched `docs/data/` subtree):
    - (a) sentinel PRESENT under scratched `docs/data/` → BOTH `subprocess.run([sys.executable, "scripts/run_repo_hook.py", "sentinel-absence"], cwd=tmp_path)` (local entrypoint) AND a CI-equivalent invocation (same subcommand with env matching `.github/workflows/demo.yml` first-step) return non-zero with stderr containing `sentinel leaked`
    - (b) sentinel ABSENT → both return zero
    Asserts identical `returncode` and stderr-keyword set per fixture. This is TRUE entrypoint-command parity: both sides invoke the same CLI subcommand; neither short-circuits through a shared helper. DO NOT use T014's aggregates-level fixtures — they exercise `promote_data`, a different surface

### Implementation for Phase 3

- [ ] T033 [US1] Add constants to `scripts/generate-demo-data.py`: `_PR_RECORD_SEED_OFFSET: Final[int] = 2000` and `pr_record_rng = random.Random(SEED + _PR_RECORD_SEED_OFFSET)` (module scope). Isolated per `contracts/byte-determinism-regen.md` §5
- [ ] T034 [US1] Add `from ado_git_repo_insights.types import PrRecord` to `scripts/generate-demo-data.py` top imports. DO NOT redefine `PrRecord`; DO NOT use `typing.Any`
- [ ] T035 [US1] Implement `generate_pr_records(week: str, repo_entries: list[object], author_entries: list[object], pr_record_rng: random.Random) -> list[PrRecord]` as a MODULE-LEVEL function in `scripts/generate-demo-data.py`. Behavior per `contracts/byte-determinism-regen.md` §4-5:
    - Sample titles from `scripts/demo-distributions/title-tokens.json` (weighted token sequence, max length 72 chars)
    - Draw cycle times from `scripts/demo-distributions/cycle-time-per-repo-size.json` lognormal per repo category
    - Assign authors/repos consistent with existing `TEAM_PRIMARY_REPOS` affinity
    - Globally unique `id` via a monotonic counter threaded through the generator state
    - Return records in `(-cycle_time, id)` stable-sorted order, capped at 500
    - NOT yet wired into the rollup-emission loop (that happens in slice 2d)
- [ ] T036 [US6] In `scripts/build-demo-dataset.py`:
    - Define `UncommittedInputsError(RuntimeError)` class
    - Define `assert_inputs_clean(repo_root: Path, inputs: list[Path], allow_dirty: bool = False) -> None` per `contracts/byte-determinism-regen.md` §6-§8 (dual `git diff --cached` AND `git diff` with distinct error messages)
    - Add argparse flag `--allow-dirty-inputs` (default: False) to `build-demo-dataset.py::main`'s argument parser
    - If `--allow-dirty-inputs` is true AND the run includes `--promote-dir` or other promotion path, abort with diagnostic (override is local-dev only)
- [ ] T037 [US6] Add module-level `DEMO_BUILD_INPUTS: list[Path]` to `scripts/build-demo-dataset.py` with exactly the 11 paths from `contracts/byte-determinism-regen.md` §8. Type-annotate precisely; no `typing.Any`
- [ ] T038 [US6] Call `assert_inputs_clean(REPO_ROOT, DEMO_BUILD_INPUTS, allow_dirty=args.allow_dirty_inputs)` at the entry of `build-demo-dataset.py::main`, AFTER argparse and BEFORE the `GENERATOR_STEPS` loop

### Verification and commit for Phase 3

- [ ] T039 Verify unit contract tests pass: `python scripts/run_pytest.py tests/demo/test_synthetic_pr_contract.py tests/unit/test_assert_inputs_clean.py tests/unit/test_strip_gate_entrypoint_parity.py`
- [ ] T040 Verify committed `docs/data/` is UNCHANGED in this slice (git diff should not show any file under `docs/data/`); verify committed `artifacts/` is gitignored so scratch regen won't stage anything by accident
- [ ] T041 Ratchet-bump procedure: run `pytest --collect-only` before and after edits on each new file (`test_synthetic_pr_contract.py`, `test_assert_inputs_clean.py`, `test_strip_gate_entrypoint_parity.py`); sum the deltas; bump `.test-floor-contract.json` Python floor by EXACTLY that sum; verify via `python scripts/check_ratchet_bump.py --base-ref origin/main`
- [ ] T042 Stage and commit slice 2c. Subject: `feat(#315): add synthetic PR generator helpers; scaffold sentinel & inputs-clean guards`. Body: full self-checklist. Proven-by enumerates T027-T032 as the 6 failing tests that now pass at unit level; Surfaces-moved notes "emission + sentinel-write deferred to slice 2d"

**Checkpoint Slice 2c**: generator helper + RNG isolation + inputs-clean guard all unit-testable; committed `docs/data/` BYTE-UNCHANGED; `test_demo_stripped_fields_are_absent` and `test_docs_promotion_matches_canonical_bytes` STILL PASS on every Python interpreter lane; artifact-tree rollup shapes UNCHANGED (generator helper not wired into emission yet).

---

## Phase 4: Atomic Wire-Up + Regen (Slice 2d — Completes US1, US3, US4)

**Purpose**: SINGLE ATOMIC COMMIT containing:
- (a) wire `generate_pr_records()` into the rollup-emission loop;
- (b) apply the 2025-W26 truncation spike override;
- (c) write the sentinel from the orchestrator between generator completion and `promote_data`;
- (d) flip the schema-guard test from "absent" to "present";
- (e) bump `DEMO_PROFILE_VERSION`;
- (f) regenerate all 260 rollup JSONs under `docs/data/`;
- (g) add the byte-determinism regen test.

Splitting any of these across commits causes intermediate states with schema-vs-data drift and breaks the per-commit ratchet guard (QG-43).

**User Stories completed in this phase**:
- **US1** (P1) — Public demo viewer sees PR drill-down working: finalized
- **US3** (P1) — Truncation indicator observable: finalized
- **US4** (P2) — Byte-determinism regen: test landed and passing

**Depends on**: Phase 3 complete.

**⚠️ ATOMIC**: T043-T056 MUST all land in a single commit (T056 is the commit operation).

### Failing tests for Phase 4 (write FIRST)

- [ ] T043 [P] [US4] Write failing test `tests/demo/test_regen_byte_stability.py` per `contracts/byte-determinism-regen.md` §3. For every committed rollup under `docs/data/aggregates/weekly_rollups/`: regen into scratch artifact root; parse; `pop("prs"); pop("_prs_truncated"); pop("_prs_cap")`; re-serialize with `json.dumps(..., indent=2, ensure_ascii=False, sort_keys=False) + "\n"`; `assert regen_stripped_bytes == committed_bytes`. Currently fails because regen produces rollups WITHOUT the three keys (until T048 wires emission), so byte-compare SHOULD match pre-wire, then FAIL after T048, then PASS again after T052 regens committed rollups
- [ ] T044 [P] [US3] Write failing test `tests/demo/test_synthetic_pr_contract.py::test_truncation_exercise_week_locked` — reads committed rollups for `2025-W26.json`, `2025-W25.json`, `2025-W27.json` directly; asserts W26 `_prs_truncated == True` and `len(prs) == 500`; asserts W25 and W27 `_prs_truncated == False`. Fails pre-regen because committed rollups don't have the fields yet; passes post-T052
- [ ] T045 [P] [US1] Write failing test `tests/demo/test_synthetic_pr_contract.py::test_key_insertion_order_matches_aggregator` — reads a committed rollup from `docs/data/aggregates/weekly_rollups/` via `json.loads(text, object_pairs_hook=list)` to get ORDERED key-value tuples; asserts the last three tuples' keys are exactly `("prs", _, "_prs_truncated", _, "_prs_cap", _)` in that sequence. Uses a structured parser (NOT substring search) to avoid false matches on value-embedded `"prs":` literals

### Atomic-commit tasks for Phase 4

- [ ] T046 [US1] Modify the weekly-rollup emission loop in `scripts/generate-demo-data.py` to invoke `generate_pr_records(...)` and append the three keys LAST to `rollup_dict` (matches aggregator insertion order at `aggregators.py:832-834`):
    - `rollup_dict["prs"] = synthetic_prs_capped`
    - `rollup_dict["_prs_truncated"] = total_qualified > 500`
    - `rollup_dict["_prs_cap"] = 500`
- [ ] T047 [US3] Read `scripts/demo-distributions/truncation-exercise-week.json` at generator init; assert the file exists and its literals match (`week == "2025-W26"`, `target_qualified_pr_count == 520`, `contrast_weeks == ["2025-W25","2025-W27"]`, `contrast_max_pr_count == 300`); when emitting the week whose label equals the loaded `week`, override the per-week qualified-PR count to `target_qualified_pr_count`. Contrast weeks use natural distribution values but are soft-capped at `contrast_max_pr_count` for visual contrast
- [ ] T048 [US1] Modify `scripts/build-demo-dataset.py` to write the sentinel file between `generate-demo-data.py` completion and the `promote_data` invocation:
    - Location: inside the `with scratch...` block at `build-demo-dataset.py:~1095-1115` after the generator loop and before `promote_data(ARTIFACT_DATA_DIR, promote_dir)`
    - Code: `(ARTIFACT_DATA_DIR / "aggregates" / SYNTHETIC_PRS_AUTHORIZED_SENTINEL_NAME).touch(exist_ok=False)` (exist_ok=False ensures a stale sentinel from an aborted prior run fails loudly; recovery procedure is to purge the scratch artifact root via `_fresh_artifact_env` pattern)
- [ ] T049 [US1] Flip `tests/demo/test_schema_guard.py::test_demo_stripped_fields_are_absent` to `test_synthetic_demo_has_prs`. New assertions: for a sample rollup from a non-empty week (`pr_count > 0`), all three keys `{"prs", "_prs_truncated", "_prs_cap"}` are PRESENT; `_prs_cap == 500`; `prs` is a non-empty list. For weeks with `pr_count == 0`, the three keys MAY be absent OR `prs` MAY be empty. Update also: `DEMO_STRIPPED_ROOT_FIELDS` set in `test_schema_guard.py:56` — rename to `DEMO_REQUIRED_ROOT_FIELDS` since the schema now REQUIRES the fields on non-empty weeks
- [ ] T050 [US1] Bump `scripts/build-demo-dataset.py::DEMO_PROFILE_VERSION` constant from `"2.0.0"` to `"2.1.0"`
- [ ] T051 [US1] Run regen on baseline Python 3.12.x (verify via `python -c "import sys; assert sys.version_info[:2]==(3,12)"`): `python scripts/build-demo-dataset.py`. Produces regenerated artifacts and promotes to `docs/data/`
- [ ] T052 [US1] **Explicit verification sub-steps** for T051 (U4 fix — prevents silent partial regen):
    - (a) T051 exit code == 0
    - (b) `ls docs/data/aggregates/weekly_rollups/*.json | wc -l` == 260
    - (c) `python -c "import json; d=json.load(open('docs/data/aggregates/weekly_rollups/2025-W26.json')); assert d['_prs_truncated'] is True; assert len(d['prs'])==500"`
    - (d) `python -c "import json; d=json.load(open('docs/data/aggregates/weekly_rollups/2025-W25.json')); assert d.get('_prs_truncated') is False"`
    - (e) No sentinel anywhere in published tree: `python -c "from pathlib import Path; assert not list(Path('docs/data').rglob('.synthetic-prs-authorized'))"`
    - (f) No sentinel left in artifact tree post-promotion: `python -c "from pathlib import Path; assert not list(Path('artifacts/demo-enterprise/data').rglob('.synthetic-prs-authorized'))"`
    - (g) Manifest deterministic fields intact (CA1 check) — derive expected value from the single source of truth (`scripts/demo_generation_common.py:FIXED_GENERATED_AT`), NOT a hardcoded literal: `python -c "import sys, json; sys.path.insert(0, 'scripts'); from demo_generation_common import FIXED_GENERATED_AT; m=json.load(open('docs/data/dataset-manifest.json')); assert m['generated_at']==FIXED_GENERATED_AT, f'generated_at drift: {m[\"generated_at\"]} vs {FIXED_GENERATED_AT}'; assert m['run_id']=='demo-static'; assert m['demo_profile']['version']=='2.1.0'"`
    - ALL sub-steps MUST pass before staging
- [ ] T053 [US4] Verify T043, T044, T045 now pass against the regenerated committed tree: `python scripts/run_pytest.py tests/demo/test_regen_byte_stability.py tests/demo/test_synthetic_pr_contract.py`
- [ ] T054 Verify all existing feature-060 parity tests still pass: `python scripts/run_pytest.py tests/demo/test_demo_parity_pipeline.py`. Specifically `test_docs_promotion_matches_canonical_bytes` MUST pass on both baseline and non-baseline Python (non-baseline test run requires a scratch-dir orchestration — follow existing `_fresh_artifact_env` pattern)
- [ ] T055 Ratchet-bump procedure for slice 2d: run `pytest --collect-only` before and after on `test_regen_byte_stability.py` + `test_synthetic_pr_contract.py` (new additions T044/T045) + `test_schema_guard.py` (T049 rename is NET ZERO — one removed, one added). Sum the deltas; bump `.test-floor-contract.json` Python floor by EXACTLY that sum; verify via `python scripts/check_ratchet_bump.py --base-ref origin/main`
- [ ] T056 Stage and commit slice 2d AS ONE ATOMIC COMMIT. Files to stage:
    - `scripts/generate-demo-data.py` (T046, T047)
    - `scripts/build-demo-dataset.py` (T048, T050)
    - `tests/demo/test_schema_guard.py` (T049)
    - `tests/demo/test_regen_byte_stability.py` (T043 new file)
    - `tests/demo/test_synthetic_pr_contract.py` (T044, T045 additions)
    - `docs/data/aggregates/weekly_rollups/*.json` (260 files regenerated by T051)
    - `docs/data/dataset-manifest.json` (manifest regenerated by T051)
    - `artifacts/demo-enterprise/data/*` — these are gitignored; DO NOT stage
    - `.test-floor-contract.json` (T055)
    - Subject: `feat(#315): publish synthetic PR-level detail to docs/data/; bump demo profile 2.0.0 -> 2.1.0`
    - Body: full self-checklist with explicit "Proven-by: T052 sub-steps (a)-(g), T053 regen tests green, T054 feature-060 parity unchanged"

**Checkpoint Slice 2d**: public demo surface carries synthetic PR records; `test_synthetic_demo_has_prs` passes; byte-determinism test passes; truncation-exercise-week test passes (W26 truncated; W25/W27 not); key-order test passes; schema version bumped atomically with content; sentinel absent from `docs/data/` and artifact tree; manifest's deterministic fields unchanged.

---

## Phase 5: Polish & Cross-Cutting Verification

**Purpose**: Branch-wide readiness checks before PR. No code changes land in this phase.

**Depends on**: all prior phases complete.

- [ ] T057 Run `python scripts/run_repo_hook.py pre-push` on the full branch (VR-28). Expect exit 0. On failure: triage per memory `feedback_preflight_for_triage_not_pre_push.md` — pivot to targeted gates; do NOT retry pre-push in a loop
- [ ] T058 [P] Run `python scripts/run_pr_preflight.py`; confirm zero-exit (VR-29)
- [ ] T059 [P] Run `python scripts/check_ratchet_bump.py --base-ref origin/main --junit-extension extension/test-results.xml`; confirm floor == actual on every commit in the branch range (VR-30)
- [ ] T060 [P] Verify `artifacts/demo-enterprise/report/capability-matrix.json` reports `all_passed == true` (VR-25) — requires a fresh `python scripts/build-demo-dataset.py --no-promote` run to generate
- [ ] T061 [P] Verify `artifacts/demo-enterprise/report/startup-parity.json` reports `parity_passed == true` (VR-26) — same fresh-run prerequisite
- [ ] T062 [P] Run `python scripts/check_coverage_delta.py` against `.coverage-baseline.json`; confirm coverage drop ≤ 2% (QG-52). If new tests bump coverage, update baseline via `--update` flag; baseline update requires `[threshold-update]` commit subject marker per QG-50
- [ ] T063 Browser verification via `pnpm --dir extension run serve:docs` + click-through (per `quickstart.md` §"Browser verification"):
    - Week 2025-W26 throughput bar → panel opens → PR list renders → truncation indicator visible with cap value (500) and total count (520)
    - Week 2025-W25 throughput bar → panel opens → PR list renders → NO truncation indicator
    - Week 2025-W27 throughput bar → same contrast as W25
    - Repository filter applied → rendered PR count matches chart's filtered count
    - Author filter applied → rendered PR count matches chart's filtered count
    - PR link click → opens Azure DevOps URL (expected 404 from ADO; synthetic org — known limitation)
- [ ] T064 Rotate the ADO PAT used in T005 (developer-local; no repo change). Core Principle XIX standing operating procedure
- [ ] T065 Update `quickstart.md` with any gotchas discovered during implementation. Commit as `docs(#315): onboarding refinements from implementation learnings` if edits are non-trivial; else skip
- [ ] T066 Prepare PR body with confidence-level disclosure (per memory `feedback_confidence_level_pr_readiness.md`):
    - **Verified locally**: Windows 3.12, pre-push green, regen byte-stable, browser click-through
    - **Strong-by-design**: binary gate with `else: assert not sentinel.exists()` third-path guard; unlink-ordering atomicity; aggregator lockup
    - **CI-only**: cross-OS byte-stability (Linux/macOS), `python-collection-parity`, `ratchet-bump-guard`, gitleaks scan

**Checkpoint Phase 5**: branch PR-ready.

---

## Dependencies & Execution Order

```text
Phase 1 (Setup / Slice 2a)        ← no dependencies
        │
        ▼
Phase 2 (Foundational / Slice 2b) ← ordered after 2a for reviewability (no hard dep)
        │
        ▼
Phase 3 (Slice 2c — scaffolding)  ← needs binary gate (2b); fixtures ready (2a)
        │                           Committed docs/data/ UNCHANGED ← guarantees no feature-060 test break
        ▼
Phase 4 (Slice 2d — atomic wire)  ← needs helper (2c), gate (2b), fixtures (2a)
        │                           Single atomic commit; 260 rollup regen; version bump
        ▼
Phase 5 (Polish)                  ← needs all code committed
```

### User Story Dependencies

- **US2** (tenant privacy): Phase 2 only.
- **US5** (negative-provenance containment): Phase 2 only.
- **US1** (synthetic generator, public-surface observable): Phase 3 scaffolding + Phase 4 wire-up.
- **US3** (truncation indicator): Phase 4 only (literal-week contract test requires committed docs/data/ with PR fields).
- **US4** (byte-determinism): Phase 4 only (requires committed rollups to compare against).
- **US6** (dirty-inputs guard): Phase 3 only.

### Parallel Opportunities

- **Phase 1**: T002/T003/T004 parallel; T005→T006 sequential (derivation needs extract).
- **Phase 2**: T010-T014 parallel (different files); T016→T017→T018 sequential (constant → helper → gate); T019/T020 parallel (hook vs CI workflow); T022/T023 parallel (different docs).
- **Phase 3**: T027-T030 parallel (same file, different methods); T031/T032 parallel; T033→T034→T035 sequential (constant → import → helper); T036→T037→T038 sequential (helper → constant → call).
- **Phase 4**: T043/T044/T045 parallel (write failing tests); T046/T047/T048/T049/T050 mostly sequential (same files); T051→T052 sequential (regen → verify); T053 after T051; T054 after T051.
- **Phase 5**: T058/T059/T060/T061/T062 parallel (different verification surfaces); T057 runs first (authoritative).

---

## Implementation Strategy

### Slice-by-slice (REQUIRED — do not reorder or merge)

1. **Slice 2a** (Phase 1, ~30-60 min): derive fixtures; commit; pause for review.
2. **Slice 2b** (Phase 2, ~1-2 hr): reshape gate; dead-code sentinel branch; all tenant-privacy tests + guards; pause for review.
3. **Slice 2c** (Phase 3, ~1-2 hr): helpers + scaffolding; UNIT-TESTABLE; committed `docs/data/` unchanged; pause for review.
4. **Slice 2d** (Phase 4, ~1 hr plus regen time): ATOMIC wire + regen; single commit with ratchet bump; pause for review.
5. **Phase 5** (polish, ~30 min): cross-cutting verification; PR body prep.

### MVP Boundary

**MVP is Phase 4 complete** — all three P1 stories (US1, US2, US3) observable on the public demo. P2 (US4, US5) and P3 (US6) are non-negotiable hardening that lands in the same slices.

---

## Notes

- [P] tasks = different files, no dependencies within the current phase
- [Story] label maps to `spec.md` user stories for traceability
- Every slice is one commit; subjects prefixed `feat(#315):` or `docs(#315):`
- Subject-line bypass markers (if needed): `[ratchet-realignment]`, `[ratchet-test-removal]`, `[threshold-update]` per QG-50 — in SUBJECT only, never body
- PAT secrecy: environment variable only; never argv; never committed; rotate post-extract (Core Principle XIX)
- Cross-OS (QG-39): pathlib + UTF-8 explicit; no shell invocations; git subprocess with forward-slash paths; every OS-specific command provided in both POSIX and PowerShell forms
- No `typing.Any` (QG-40); `PrRecord` imported from `src/ado_git_repo_insights/types.py:289`, never redefined
- Ratchet bumps (QG-43): every commit that adds tests bumps `.test-floor-contract.json` by the exact pytest-collect-only delta; `check_ratchet_bump.py` verifies per-commit
- Stop at any checkpoint to validate slice independently; do NOT bundle slices
- Memory `feedback_drop_plan_ceremony_on_locked_tasks.md`: tasks above are the authoritative execution script; do NOT re-plan during execution
- Memory `feedback_confidence_level_pr_readiness.md`: PR body must separate verified-locally from strong-by-design from CI-only
