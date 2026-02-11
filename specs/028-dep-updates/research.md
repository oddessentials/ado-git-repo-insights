# Research: Dependency Updates

**Feature**: 028-dep-updates
**Date**: 2026-02-10

## Decision Log

### D-001: Ruff 0.15.0 Breaking Changes

**Decision**: Upgrade ruff from 0.14.14 to 0.15.0 in a dedicated atomic commit.

**Rationale**: The 2026 formatting style is the new default going forward. Delaying adoption increases merge conflict risk as future PRs will need to reconcile two formatting styles. The formatting changes are purely cosmetic (whitespace, line breaks) and do not alter code semantics.

**Alternatives considered**:
- Skip 0.15.0 and wait for 0.15.1+ — rejected because 0.15.0 is the style cutover point; waiting doesn't reduce the reformatting scope.
- Pin `format.style = "2025"` to opt out of new formatting — rejected because it delays the inevitable and creates tech debt.

**Key risks**:
- Stabilized rule B912 (`map-without-explicit-strict`) may trigger violations. Our `pyproject.toml` selects `B` rules. Mitigation: run `ruff check .` after format and fix/suppress individually.
- Block suppression comments are a new feature (not a breaking change for existing code). No action needed.

### D-002: Playwright 1.50.0 → 1.58.2 Compatibility

**Decision**: Upgrade in a single step from 1.50.0 to 1.58.2 (latest).

**Rationale**: Playwright follows semver for its minor versions. Browser binaries are tightly coupled to the framework version. Stepping through intermediate versions would multiply the testing effort without reducing risk — the smoke tests either pass or they don't.

**Alternatives considered**:
- Step through 1.52 → 1.55 → 1.58 incrementally — rejected because Playwright binary downloads are version-locked. Each step requires a full download + smoke test cycle.
- Stay on 1.50.0 — rejected because older Playwright versions lag behind browser security patches.

**Key risks**:
- Smoke test selectors may need adjustment if Chromium rendering changes (e.g., element bounding boxes shift by pixels).
- The `postinstall` script automatically downloads the matching Chromium binary, so no manual binary management is needed.

### D-003: glob v10 → v13 Migration Path

**Decision**: Upgrade directly from v10 to v13 (skip v11, v12).

**Rationale**: The project requires Node 22, so the Node <20 support drop (v11) is irrelevant. The `--shell` removal (v12) and CLI split (v13) are features we don't use. The core globbing API (`glob()`, `globSync()`) is stable across all versions.

**Alternatives considered**:
- Step through v11 → v12 → v13 — rejected because the intermediate versions don't add value and the breaking changes are in features we don't use.
- Replace glob with fast-glob or tinyglobby — rejected because glob is only used in test infrastructure and the upgrade is straightforward.

**Key risks**:
- Usage audit needed to confirm no test file or script relies on removed APIs.
- `@types/glob` at v8 may not be compatible with glob v13. May need to switch to glob's built-in types (glob v11+ includes TypeScript types).

### D-004: actions/cache v4 → v5

**Decision**: Upgrade from v4 to v5.

**Rationale**: v5 moves to Node.js 24 runtime. GitHub-hosted runners (ubuntu-latest, windows-latest, macos-latest) already meet the minimum Actions Runner version of 2.327.1. The project does not use self-hosted runners.

**Alternatives considered**:
- Stay on v4 — rejected because v4 will eventually reach end-of-life. The longer we wait, the more likely a forced migration under time pressure.

**Key risks**:
- If runner version is below 2.327.1, the action will fail. Mitigation: verify runner version from recent CI run logs before merging.

### D-005: serve 14.2.0 → 14.2.5 Version Guard

**Decision**: Update both the package.json pin and the version guard test in the same commit.

**Rationale**: The version guard test (`playwright-version-guard.test.ts`) enforces exact pinning. Updating one without the other would fail CI.

**Alternatives considered**: None — this is the only correct approach given the version guard enforcement.

### D-006: Manual Updates Over Dependabot PRs

**Decision**: Close all 7 Dependabot PRs and apply all dependency updates manually in a single feature branch.

**Rationale**: Manual application gives full control over grouping, commit structure, and testing order. Avoids merge conflict churn from sequential PR merges and ensures all changes are validated together.

**Alternatives considered**:
- Merge Dependabot PRs individually — rejected because sequential merging creates unnecessary CI wait cycles and merge conflicts between PRs.

### D-007: pandas-stubs 3.0.0 Upgrade (Deferred)

**Decision**: Defer pandas-stubs upgrade to a follow-up after Batch 1.

**Rationale**: The jump to pandas-stubs 3.0.0 aligns with pandas 3.0 but may surface type errors from stricter annotations (str dtype changes, CoW semantics). This should be tested with `mypy src/` in isolation rather than bundled with other changes.

**Alternatives considered**:
- Include in Batch 1 — rejected because type error churn would complicate the safe merge batch.

### D-008: prophet 1.3.0 Breaking Change (Deferred)

**Decision**: Defer prophet upgrade to a follow-up investigation.

**Rationale**: prophet 1.3.0 removes the `prophet.hdays` module. Need to verify no imports exist before upgrading. This is an optional ML dependency and low priority.

**Alternatives considered**:
- Include in Batch 3 — rejected because ML dependencies are optional and independently testable.
