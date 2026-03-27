# Feature Specification: CLI Hardening — Core Usability and Reliability Fixes (Final)

**Feature Branch**: `039-cli-hardening`
**Created**: 2026-03-26
**Status**: Final (Execution-Locked)
**Input**: GitHub issue #200 + validated findings from local investigation

---

## 0. Implementation Boundaries (Non-Negotiable)

### In-Scope Files (ONLY these may be modified)

- `src/ado_git_repo_insights/cli.py`
- `src/ado_git_repo_insights/__main__.py` (NEW)
- `src/ado_git_repo_insights/__init__.py`
- `src/ado_git_repo_insights/utils/run_summary.py`
- `src/ado_git_repo_insights/commands/doctor.py`
- Tests under `tests/` directly impacted by CLI behavior

### Out-of-Scope (Forbidden)

- ❌ No command renaming or UX redesign (except `extract` validation fix)
- ❌ No packaging system redesign (setuptools_scm remains as-is)
- ❌ No installer workflow changes (pip/uv/etc.)
- ❌ No logging system refactor
- ❌ No command registry / architecture rewrite
- ❌ No new dependencies
- ❌ No changes to extraction, DB, or CSV logic

---

## 1. Required Implementation Order (Hard Gate)

Work MUST be completed in this exact sequence:

1. Version unification + `__main__.py`
2. `--version` flag
3. Parse-boundary validation for `extract`
4. Lazy import refactor
5. PATH diagnostics fix
6. Tests + CI updates

**Violation of order = reject PR**

---

## 2. User Scenarios & Testing *(mandatory)*

### User Story 1 — Version and Invocation Work Reliably (P1)

A user verifies installation immediately using standard CLI conventions.

**Acceptance Scenarios**

- `ado-insights --version` → exit 0, no subcommand required
- `python -m ado_git_repo_insights --version` → same output
- Output NEVER contains `"0.0.0"`

---

### User Story 2 — Help and Doctor Work in Broken Environments (P1)

CLI diagnostics must function even if dependencies are broken.

**Acceptance Scenarios**

- `ado-insights --help` → exit 0 with missing heavy deps
- `ado-insights doctor` → runs without import crash
- Heavy dependencies load ONLY when command executes

---

### User Story 3 — Extract Fails at Parse Boundary (P1)

Invalid CLI input fails immediately.

**Acceptance Scenarios**

- `ado-insights extract --pat x` → exit code 2 (argparse), NOT runtime error
- `--config` bypasses requirement for org/projects
- NO side effects occur before failure

---

### User Story 4 — PATH Diagnostics Are Accurate (P2)

No false warnings in virtual environments.

**Acceptance Scenarios**

- No PATH warning in active venv
- Warning still appears for real broken installs

---

### User Story 5 — Version Is Consistent Everywhere (P2)

All version outputs align.

**Acceptance Scenarios**

- CLI version == run_summary version
- Fallback is consistent and controlled
- `"0.0.0"` never appears

---

## 3. Edge Cases

- `python -m ado_git_repo_insights` → prints usage, exit 2
- Uninstalled source execution → allowed fallback `"unknown (dev)"`
- Lazy import failure → handled inside command, not at startup
- Config still validates programmatic usage independently

---

## 4. Functional Requirements *(mandatory)*

### Version and Invocation

- **FR-001**: CLI MUST support `--version` globally
- **FR-002**: No subcommand required for version
- **FR-003**: MUST support `python -m ado_git_repo_insights`
- **FR-004**: Exit codes MUST propagate correctly
- **FR-005**: `"0.0.0"` is FORBIDDEN in all outputs
- **FR-006**: Version source MUST be `importlib.metadata.version()` ONLY
- **FR-007**: Fallback string MUST be exactly `"unknown (dev)"`

---

### Parse-Boundary Validation

- **FR-008**: `extract` requires org/projects unless `--config`
- **FR-009**: Validation MUST occur immediately after `parse_args()`
- **FR-010**: Must use `parser.error()` (exit code 2)
- **FR-011**: ZERO side effects before validation passes

#### Side-Effect Definition (Explicit)

Before validation passes, the system MUST NOT:

- Initialize logging
- Load config
- Create directories
- Touch filesystem
- Connect to DB
- Make network calls

---

### Import Safety (Lazy Imports)

- **FR-012**: No heavy imports at module load in `cli.py`
- **FR-013**: Heavy imports MUST live inside command handlers
- **FR-014**: Exception classes MUST be imported BEFORE `try` block
- **FR-015**: `--help` and `doctor` MUST not import heavy deps

#### Command Import Map (Mandatory)

| Command             | Must Lazy Import      |
| ------------------- | --------------------- |
| extract             | config, extractor, DB |
| generate-csv        | DB, CSV generator     |
| generate-aggregates | DB, aggregators       |
| build-aggregates    | DB, aggregators       |
| stage-artifacts     | already correct       |
| dashboard           | none                  |

---

### PATH Diagnostics

- **FR-016**: Detect venv via `sys.prefix != sys.base_prefix`
- **FR-017**: Suppress PATH warnings in venv
- **FR-018**: Preserve warnings for real issues

---

### Validation Ownership (No Drift Rule)

- **FR-019**: CLI owns ALL user-facing validation
- **FR-020**: `Config` validates only object integrity
- **FR-021**: CLI error messaging MUST NOT live in `Config`

---

## 5. Testing & CI Requirements

### Required Tests

- **FR-022**: `--version` exits 0
- **FR-023**: `python -m` works
- **FR-024**: `"0.0.0"` never appears anywhere
- **FR-025**: `cli.py` import does NOT load pandas/requests/yaml
- **FR-026**: Parse failure returns exit code 2
- **FR-027**: Config path bypass works
- **FR-028**: Each exception path tested (forced failure)
- **FR-029**: Doctor suppresses PATH in venv
- **FR-030**: Replace broken version test
- **FR-031**: CI thresholds updated

---

## 6. Migration Rules

- Remove:
    - VERSION file reads
    - `"0.0.0"` usage

- Replace with:
    - `importlib.metadata.version()`
    - `"unknown (dev)"` fallback ONLY

---

## 7. Non-Goals (Hard Constraints)

- ❌ No CLI redesign
- ❌ No argument renaming (except validation behavior)
- ❌ No packaging overhaul
- ❌ No registry system
- ❌ No performance tuning
- ❌ No feature additions

---

## 8. Success Criteria *(mandatory)*

- **SC-001**: `--version` works universally
- **SC-002**: `python -m` works
- **SC-003**: Help/doctor resilient to broken deps
- **SC-004**: Extract fails at parse boundary
- **SC-005**: ZERO side effects before validation
- **SC-006**: No `"0.0.0"` anywhere
- **SC-007**: Version consistent across system
- **SC-008**: No false PATH warnings
- **SC-009**: No eager heavy imports
- **SC-010**: All tests + preflight pass

---

## 9. Assumptions

- Single active user (repo owner) — no backwards compatibility constraints
- Python 3.10+ baseline — `importlib.metadata` is stdlib, no backport needed
- setuptools_scm populates package metadata — `importlib.metadata.version()` works for editable and wheel installs without `write_to`
- VERSION file serves the Node/extension ecosystem only — not the Python version source
- Existing test infrastructure (pytest, ruff, mypy, 14-gate preflight) is stable and will validate changes
- No new pip dependencies are introduced — all changes use stdlib only
- `Config.__post_init__` may be called by programmatic callers who bypass the CLI — defense-in-depth validation is retained

---

## 10. Execution Guardrails (Churn Prevention)

- Every requirement is test-backed
- No speculative improvements allowed
- No additional refactors permitted during implementation
- Any deviation requires a new spec

---

## 11. Definition of Done

This work is complete ONLY when:

- All success criteria pass
- All tests pass
- Preflight passes
- No scope violations occurred
- No new tech debt introduced

---

## Final Note

This is a **hardening spec, not an architecture spec**.

It exists to:

- Fix broken CLI behavior
- Eliminate user confusion
- Restore trust in the tool

It explicitly avoids:

- Over-engineering
- Future-proofing beyond necessity
- Expanding scope beyond issue #200

**If it doesn’t directly fix the issue, it does not belong in this implementation.**
