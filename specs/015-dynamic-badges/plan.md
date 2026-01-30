# Implementation Plan: Dynamic CI Badges

**Branch**: `015-dynamic-badges` | **Date**: 2026-01-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/015-dynamic-badges/spec.md`

## Summary

Replace broken Codecov badges with 4 deterministic Shields.io dynamic JSON badges (Python Coverage, TypeScript Coverage, Python Tests, TypeScript Tests). CI generates `status.json` from existing test/coverage reports and publishes to a dedicated `badges` branch (raw GitHub URL, NOT GitHub Pages).

## Technical Context

**Language/Version**: Bash (CI scripts), Python 3.11 (JSON generation script)
**Primary Dependencies**: GitHub Actions, Shields.io dynamic JSON badges
**Storage**: Dedicated `badges` branch - single JSON file (raw GitHub URL)
**Testing**: Determinism check (generate twice, diff), curl verification, schema validation
**Target Platform**: GitHub Actions (ubuntu-latest)
**Project Type**: CI/CD enhancement (no source code changes)
**Performance Goals**: Badge publish completes within 60 seconds of test jobs
**Constraints**: GITHUB_TOKEN only (no PAT), main-branch only (no PR publishes), MUST NOT touch `/docs`, `gh-pages`, or `main`
**Scale/Scope**: 1 JSON file, 4 badges, ~1KB payload

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| III. Deterministic Output | ✅ ALIGNED | FR-004, FR-018 enforce determinism with diff check |
| VII. No Publish on Failure | ✅ ALIGNED | FR-015 ensures failed tests block badge generation |
| XII. No Silent Data Loss | ✅ ALIGNED | FR-008, FR-009 fail CI on generation/publish errors |
| XVIII. Actionable Failure Logs | ✅ ALIGNED | FR-010 prints URL and curls for verification |
| QG-17 to QG-20 | ✅ ALIGNED | Badge publish runs after all quality gates pass |

**No violations.** This feature adds observability without modifying core extraction/CSV pipelines.

## Project Structure

### Documentation (this feature)

```text
specs/015-dynamic-badges/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (JSON schema)
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (badge URL contracts)
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
.github/
├── workflows/
│   └── ci.yml           # Add badge-publish job (main-only)
├── scripts/
│   └── generate-badge-json.py  # Parse coverage/test reports → JSON
└── actions/
    └── setup-pnpm/      # Existing (reuse for extension tests)

# Dedicated badges branch (orphan branch - created by workflow)
# Root of badges branch:
status.json              # Published badge data
```

**Structure Decision**: Minimal footprint - one Python script in `.github/scripts/`, one new CI job, one JSON file on dedicated `badges` branch (not `gh-pages`).

## Complexity Tracking

No violations. Single-purpose CI job with no architectural complexity.

---

## Phase 0: Research

### Research Tasks

1. **Publishing to dedicated branch from CI** - How to push to `badges` branch using only GITHUB_TOKEN
2. **Shields.io dynamic JSON badge format** - Exact URL pattern with raw GitHub URL
3. **Coverage XML parsing** - Extract `line-rate` from Cobertura XML
4. **LCOV parsing** - Extract LF/LH from lcov.info
5. **JUnit XML parsing** - Extract tests/failures/errors/skipped totals

### Findings

See [research.md](./research.md) for detailed findings.

---

## Phase 1: Design

### Data Model

See [data-model.md](./data-model.md) for JSON schema.

### Contracts

See [contracts/](./contracts/) for badge URL specifications.

### Quickstart

See [quickstart.md](./quickstart.md) for one-time setup steps.
