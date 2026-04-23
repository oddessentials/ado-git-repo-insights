# Phase 0 Research: Synthetic Demo Exercises PR-Level Detail

**Feature**: `309-demo-pr-drilldown`
**Date**: 2026-04-20

All architectural decisions were locked upstream in the `/speckit.specify` input. This document records each decision with its rationale and the alternatives evaluated, so future readers can understand why the locked choices are load-bearing.

## Decision 1 — Provenance mechanism: sentinel file

**Decision**: A zero-length sentinel file `.synthetic-prs-authorized` at `artifacts/demo-enterprise/data/aggregates/` signals that the source artifact's PR-level content is synthetic and may be published to `docs/data/`. The sentinel is written by `scripts/build-demo-dataset.py` only, read and unlinked at the `promote_data` boundary, and never published.

**Rationale**:
- Decoupled from rollup JSON content — the aggregator output shape is locked (FR-006); embedding provenance in rollup fields would require aggregator edits.
- Single file system primitive (`Path.exists()`) is cross-OS reliable (QG-39) and stable across Windows, macOS, Linux.
- Unlink-at-boundary semantics guarantees absence in the published tree without requiring downstream exclusion rules.
- Satisfies the "single authoritative gate site" rule (QG-47/49) — the gate is intrinsic to `promote_data`; no second site needed.

**Alternatives considered**:
- **Manifest field** (e.g., `demo_profile.synthetic_prs_authorized = true`): rejected because the manifest is written at the END of the pipeline, AFTER rollups are produced, so the gate cannot read it at the promotion boundary without reordering the pipeline. Also would widen the `aggregates_schema_version` contract.
- **Parallel pipeline that bypasses `promote_data`**: rejected because it duplicates the `shutil.copytree` + stale-cleanup + content-validation logic, violating the single-authoritative-write-boundary rule from feature-060's `demo-strip-gate.md:155-159`. Churn-heavy and creates a second site tenant code would need to avoid.
- **Per-rollup key marker** (e.g., a boolean key on every rollup): rejected because it requires touching every rollup JSON and creating a stripping rule that distinguishes marker-keys from payload-keys — more surface to get wrong, and the aggregator lockup forbids aggregator-side edits to emit or filter it.

## Decision 2 — Binary gate with explicit unreachable-third-path assertion

**Decision**: `promote_data` becomes a two-branch decision with a belt-and-suspenders assertion:

```python
if sentinel.exists():
    assert_synthetic_shape(aggregates)
    sentinel.unlink()  # FIRST mutation, before any mkdir/copytree
else:
    assert not sentinel.exists()  # guards future third-path regression
    strip_pr_arrays_from_rollups(aggregates)
```

**Rationale**:
- Fail-closed on BOTH branches: sentinel-present path raises on tenant-shaped residue; sentinel-absent path raises on strip residue. No "best effort" path; no silent fall-through.
- The `else: assert not sentinel.exists()` is tautological at that point but load-bearing for future maintainers: any refactor that inserts a third branch (`elif some_other_condition:`) between them trips the assertion at runtime, revealing the change.
- Unlink-before-mutation ordering means the sentinel cannot leak into the destination via a retry after a post-copy failure: if unlink is the FIRST mutation and unlink fails, NOTHING else runs, so the destination is byte-identical to its pre-call state.

**Alternatives considered**:
- **Single-branch with inline predicate** (`if sentinel.exists(): skip_strip()`): rejected because refactor drift can introduce a third "maybe" branch that silently bypasses both code paths.
- **Strategy pattern with pluggable gate implementations**: rejected as over-abstract; the gate has exactly two states (signal present / absent) and one call site.
- **Skip the unreachable-third-path assertion**: rejected because the feedback_dead_code_might_be_regression rule applies — explicit assertions are cheap insurance against later refactors that break the binary contract.

## Decision 3 — Byte-equality (not structural) regen test

**Decision**: `test_regen_byte_stability.py` validates byte-equality after extracting the three new keys from regenerated rollups:
1. Regen rollup into scratch
2. `json.loads()` regen content
3. `pop("prs"); pop("_prs_truncated"); pop("_prs_cap")`
4. Re-serialize with `json.dumps(..., indent=2, ensure_ascii=False, sort_keys=False) + "\n"`
5. `assert regen_stripped_bytes == committed_bytes`

**Rationale**:
- Catches key-order / whitespace / unicode-escape / trailing-newline drift that structural `dict == dict` comparisons miss.
- Forces the synthetic generator to append the three new keys LAST in the rollup dict (matching aggregator's `rollup_dict[key] = ...` insertion order at `aggregators.py:832-834`), otherwise the test fails.
- Provides the strongest evidence that non-PR-field content is stable across regenerations — a regression in `by_author` ordering or `cycle_time_p50` formatting would surface immediately.

**Alternatives considered**:
- **Structural `dict == dict` comparison**: rejected because it would pass even if two JSON files with different byte representations parsed to the same Python dict; downstream byte-level tooling (git diffs, hash comparisons, downstream `shutil.copytree` mtime/size parity) would still see drift.
- **Full-file byte comparison** (no key extraction): rejected because regen WILL differ by three keys — some way of excluding expected additions is required.
- **Structured diff limited to named keys**: rejected as equivalent strength to byte-equality but harder to implement and less readable in test output.

## Decision 4 — Distribution source: fresh tenant extract (one-time)

**Decision**: Derive statistical distribution fixtures from a fresh one-time extract of `https://dev.azure.com/oddessentials/` via the existing `ado-insights extract-prs` CLI, PAT via `ADO_PAT` environment variable only.

**Rationale**:
- Avoids inheriting unknown completeness, date-range, or artifact-shape assumptions from the pipeline-15 seeded DB (memory pointer notes it is a test-data pointer, not a statistical-derivation source).
- Single authoritative provenance chain for the fixture: one developer, one extract, one committed fixture, one commit message documenting what was sampled and when.
- Minimizes surface area for later debugging — a single source ensures that subsequent revisions to the synthetic generator can be compared against one well-documented baseline.

**Alternatives considered**:
- **Reuse pipeline-15 seeded artifact**: rejected because the pipeline-15 artifact is pinned to a specific multi-year range and its completeness characteristics are not documented as suitable for statistical derivation. Memory `reference_oddessentials_test_data.md` explicitly flags it as "use stage-artifacts for E2E, never a multi-year extract" — the inverse use-case (distribution derivation) has no explicit endorsement.
- **Hand-crafted synthetic distributions**: rejected because synthetic distributions not grounded in real data tend to miss realism signals (burst weeks, author concentration patterns, repo-category cycle-time differences) that feature 060's UI implicitly assumes.

## Decision 5 — Truncation-exercise week: 2025-W26 (contrast neighbors 2025-W25, 2025-W27)

**Decision**: Week 2025-W26 is the single intentional spike producing > 500 qualified PRs. Weeks 2025-W25 and 2025-W27 are locked as non-truncated contrast neighbors. All three weeks' ISO-week labels are hard-coded in `tests/demo/test_synthetic_pr_contract.py::test_truncation_exercise_week_locked`.

**Rationale**:
- Mid-year (late June 2025) → late in the demo's growth curve so the BASE_PR_COUNT is elevated, requiring a smaller multiplier to spike past 500.
- Mid-year avoids holiday-season oddities (year-end / year-start distribution edges).
- Not at year boundaries → doesn't interact with the aggregator's yearly distribution calculations.
- Single spike → lowest-churn way to prove `_prs_truncated` deterministically with one obvious fixture, one obvious expected week, one obvious regression surface.
- Contrast neighbors (the adjacent weeks) → visual contrast on the demo makes the indicator's presence/absence obvious to a prospective adopter without needing to read docs.

**Alternatives considered**:
- **Blended 2-3 consecutive spiked weeks**: rejected — more realistic but increases regen, reasoning, and debugging surface without improving the invariant being locked.
- **Spike at year boundary** (e.g., 2024-W01 or 2025-W52): rejected because year-boundary weeks interact with the aggregator's yearly distribution rollups in ways that could mask byte-determinism regressions.
- **Dynamic week selection** (pick the first week whose PR count naturally exceeds 500): rejected because "natural" depends on RNG / growth_factor tuning, which makes the test brittle. Hard-coding the literal is what makes the contract auditable.

## Decision 6 — Scope containment: throughput-only

**Decision**: Synthetic generator emits only the 5 locked `PrRecord` fields on weekly rollups. No chart-agnostic abstraction. No speculative fields. The helper API is `generate_pr_records(week, repos, authors, rng) -> list[PrRecord]` — narrow and unshared.

**Rationale**:
- Feature 060 scoped the PR-level detail contract to the throughput chart. Cycle-time / reviewer / sparkline drill-downs (catalogued in #318) are each independent slices; generalizing now speculates on their needs.
- Narrowest-shippable reduces the correctness surface of the first landing and lets #318 slices pay their own cost when activated. Captured at https://github.com/oddessentials/ado-git-repo-insights/issues/318#issuecomment-4285663430.
- Import-not-redefine (`from ado_git_repo_insights.types import PrRecord`) locks type-shape parity with the aggregator; future aggregator-side expansion forces synthetic to track via mypy failure rather than silent drift.

**Alternatives considered**:
- **Chart-agnostic reusable layer** (a `SyntheticDrilldownGenerator` base class with per-chart subclasses): rejected as 2× implementation cost with no immediate payoff and no signal from #318 that the abstraction would actually fit all chart surfaces.
- **Generate for throughput + cycle-time + reviewer simultaneously**: rejected because it couples three chart contracts into one landing. Any defect surfaces across three surfaces; any rollback reverts three features.

## Decision 7 — Entrypoint-command parity (not helper-level parity)

**Decision**: Parity test invokes `subprocess.run([sys.executable, "scripts/run_repo_hook.py", "sentinel-absence"])` — a dedicated named subcommand introduced in T019 — AND the CI-workflow-equivalent command (same subcommand invocation from `.github/workflows/demo.yml` first-step); asserts identical `returncode` + stderr keywords per fixture. Internal helpers are NOT shared across the two invocations — each entrypoint runs the same CLI command. Rationale for the dedicated subcommand: `run_repo_hook.py pre-push` runs seven earlier stages before the sentinel-absence check; unrelated stage failures would mask sentinel behavior and produce false negatives on parity. The named subcommand isolates the check to the exact surface under parity test.

**Rationale**:
- Helper-level parity can pass while entrypoint-level parity fails: the two entrypoints may read arguments, environment variables, or configuration differently, and a helper-only test misses those discrepancies.
- Entrypoint-level parity proves the exact command a developer runs locally matches what CI runs, end-to-end.
- Follows QG-49 ("each gate defined once, invoked by name everywhere") — the test verifies the rule holds at the call site level, not just the implementation level.

**Alternatives considered**:
- **Extract a shared helper and test only the helper**: rejected per rationale above. Memory `feedback_local_ci_parity_always.md` and the QG-35/36 rules require end-to-end parity evidence.
- **Test-only-CI-workflow**: rejected because local-only developers would miss parity failures until push; blocking at pre-push is the contract.

## Decision 8 — Staged-vs-worktree dual check (`git diff --cached` AND `git diff`)

**Decision**: `assert_inputs_clean()` runs two separate git subprocesses and fails if EITHER reports differences on the input set:
- `git diff --cached --name-only HEAD -- <inputs>` (staged vs HEAD)
- `git diff --name-only -- <inputs>` (worktree vs staged)

Distinct error messages per case (`staged changes in inputs: ...` vs `unstaged changes in inputs: ...`).

**Rationale**:
- Dual check catches a scenario that `git diff HEAD` alone misses: a file with staged changes AND additional unstaged changes whose combined net equals HEAD would pass `git diff HEAD` but the staged snapshot is dirty.
- Distinct error messages help developers diagnose WHICH class of change is blocking (reviewer feedback: "add a staged-vs-worktree guard for demo promotion").
- Ensures strip/provenance decisions happen on the staged snapshot only — i.e., what gets committed and pushed matches what the gate evaluated.

**Alternatives considered**:
- **`git diff HEAD` single check**: rejected because it's subject to the "staged + unstaged cancels out" edge case described above.
- **Require `git status --porcelain` to be empty entirely**: rejected as overly strict — it would block on unrelated files (e.g., scratch notes in an untracked subdirectory).
- **Skip entirely, rely on pre-commit hooks**: rejected because pre-commit hooks do not run during `build-demo-dataset.py` — the gate needs its own check.

## Decision 9 — Negative-provenance test via `git ls-files --cached`

**Decision**: The negative-provenance test uses `git ls-files --cached src/ scripts/` (not filesystem glob) to enumerate candidate files, then greps each for the sentinel string literal. Asserts ZERO matches except in `scripts/strip_pr_arrays.py` — the single source-of-truth for the constant after the U2 relocation. The orchestrator `scripts/build-demo-dataset.py` is the sentinel WRITER but imports the constant name from `strip_pr_arrays.py`, so the literal string does not appear in the orchestrator file.

**Rationale**:
- `git ls-files --cached` sees staged-but-untracked files; filesystem glob only sees committed + new workspace files, missing a case where a sentinel-writing file is staged for commit but not yet in HEAD.
- Matches the principle "gate on what will be committed, not what exists ephemerally in the worktree."

**Alternatives considered**:
- **Filesystem glob via `Path.rglob("*.py")`**: rejected per rationale above.
- **Grep all tracked + untracked files**: rejected as too broad — would flag the sentinel string in committed tests (which is LEGITIMATE; the test itself references the sentinel name). The `--cached` scope limits to source-tree files that will be committed, and an explicit allow-list for `scripts/strip_pr_arrays.py` keeps the constant definition site allowed (the orchestrator `scripts/build-demo-dataset.py` imports the constant name but does not contain the literal string).

## Decision 10 — Aggregator lockup

**Decision**: Zero edits under `src/ado_git_repo_insights/transform/` or `src/ado_git_repo_insights/types.py`. Synthetic generator imports `PrRecord` from `types.py:289`.

**Rationale**:
- Aggregator output is a stability contract for both the tenant CLI and the extension UI. Any edit here risks regressing feature 060's existing invariants.
- Import-not-redefine forces type parity: if aggregator adds a 6th `PrRecord` field tomorrow, the synthetic generator's TypedDict construction fails mypy, surfacing drift immediately.
- Narrows the PR's review surface: changes live under `scripts/`, `tests/`, `docs/`. Reviewers can trust that `src/` is untouched.

**Alternatives considered**:
- **Extract `PrRecord` to a shared module**: rejected because it requires touching `types.py` — even a simple extraction is an edit to locked code.
- **Re-declare `PrRecord` in the synthetic generator**: rejected because two definitions drift independently.

---

**Phase 0 outcome**: all decisions resolved with evidence. No residual `NEEDS CLARIFICATION` markers. Ready for Phase 1.
