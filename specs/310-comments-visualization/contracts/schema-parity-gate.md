# Contract: PrRecord schema parity gate (Feature 310)

**Scope**: enforcement contract for DIRECTIVE 2 — the atomic cross-surface expansion of the PrRecord schema. This gate detects drift between the four surfaces listed in [data-model.md §6](../data-model.md) and fails the build.

**Authoritative spec refs**: [spec.md FR-3-01 / FR-3-06](../spec.md), INV-08. Data model: [`data-model.md`](../data-model.md) §6. Sibling contract: [`pr-record-comments-fields.md`](./pr-record-comments-fields.md).

**Parent gates**: Constitution [`.specify/memory/constitution.md`](../../../.specify/memory/constitution.md) QG-47 (trigger scope), QG-48 (worktree-clean guard), QG-49 (one command, many callers).

---

## The canonical command

One authoritative command — defined once, invoked by name everywhere:

```bash
python scripts/check_pr_record_schema_parity.py
```

Exit status: `0` = parity held, non-zero = drift detected (with human-readable diff on stderr/stdout).

---

## What the command checks

The script parses each of the four surfaces and asserts they enumerate the identical set of field names with compatible types. Note: four surfaces but **only three files** — `rollup.schema.ts` contributes two of the four surfaces (the interface + the required-fields array).

1. **Python `PrRecord` TypedDict** at `src/ado_git_repo_insights/types.py` — Python AST walk; read the `class PrRecord(TypedDict):` block, collect field names and annotations.
2. **TypeScript `PrRecord` interface** at `extension/ui/schemas/rollup.schema.ts` — TypeScript AST parse via the project-local `typescript` devDep; read the `export interface PrRecord { ... }` block, collect field names and type nodes.
3. **TypeScript `PR_RECORD_REQUIRED_FIELDS`** at `extension/ui/schemas/rollup.schema.ts` — same AST parse; read the `const PR_RECORD_REQUIRED_FIELDS: ... = [...]` array literal, collect the string values.
4. **310 sibling contract** at `specs/310-comments-visualization/contracts/pr-record-comments-fields.md` — parse the **§1 Canonical field declaration** section's markdown table; collect field names from the `Field` column and types from the `Python type` and `TypeScript type` columns. Backtick characters around cell contents are stripped before comparison. The specific anchor text `## §1 Canonical field declaration` is the parser's entry point — the script fails if that heading is not found in the file (prevents silent-pass drift).

### Type compatibility rules

Rules are split by presence-kind. In TypeScript, presence-requirement is encoded by the `?:` marker: a field declared `name: T` is presence-required; `name?: T` is presence-optional. In Python TypedDicts, presence-requirement is encoded by the `NotRequired[...]` wrapper: a field declared `name: T` in a `TypedDict(total=True)` class is presence-required; `name: NotRequired[T]` is presence-optional. Value-nullability is orthogonal (encoded by `T | None` in Python and `T | null` in TS).

**Presence-required fields** (TS: `name: T`; Python: `name: T` in a `TypedDict(total=True)` class, **without** `NotRequired`):

| Python | TypeScript | Compatible? |
|---|---|---|
| `int` | `number` | ✅ |
| `float` | `number` | ✅ |
| `str` | `string` | ✅ |
| `bool` | `boolean` | ✅ |
| `int \| None` | `number \| null` | ✅ |
| `str \| None` | `string \| null` | ✅ |
| `int` | `number \| null` | ❌ (nullability mismatch) |
| `int \| None` | `number` | ❌ (nullability mismatch) |
| `int \| None` | `?: number \| null` | ❌ (presence mismatch — Python required, TS optional; capability-off path would violate Python type) |

**Presence-optional fields** (TS: `name?: T`; Python: `name: NotRequired[T]`):

| Python | TypeScript | Compatible? |
|---|---|---|
| `NotRequired[int]` | `?: number` | ✅ |
| `NotRequired[int \| None]` | `?: number \| null` | ✅ |
| `NotRequired[str \| None]` | `?: string \| null` | ✅ |
| `NotRequired[int]` | `number` | ❌ (presence mismatch — Python optional, TS required) |
| `NotRequired[int \| None]` | `number \| null` | ❌ (presence mismatch reversed) |

**`PR_RECORD_REQUIRED_FIELDS` cross-check**: `PR_RECORD_REQUIRED_FIELDS` lists only presence-required entries. The gate asserts:

- Presence-required field set from the Python TypedDict (i.e., fields **without** a `NotRequired[...]` wrapper) equals the string entries in `PR_RECORD_REQUIRED_FIELDS`. Presence is encoded by `NotRequired`, **not** by nullability — a `str | None` field without `NotRequired` is presence-required even though its value is nullable.
- All fields present in any of the four surfaces are present in all four (regardless of presence-requirement).
- Each field's type satisfies the presence-specific compatibility table above (presence-required fields use the first table; presence-optional fields use the second).

**§1 "Emitted when..." column is informational**: the `Emitted when comments_metrics=true` column in the 310 sibling contract's §1 table is prose narrative about producer runtime emission obligation (INV-08). The parity gate does NOT parse this column, does NOT cross-check it against `PR_RECORD_REQUIRED_FIELDS`, and does NOT use it to infer presence-requirement. Presence-requirement is derived solely from the Python `NotRequired[...]` wrapper, the TypeScript `?:` marker, and the `PR_RECORD_REQUIRED_FIELDS` array.

### Output on drift

Human-readable diff listing:

- Fields present in surface N but absent in surface M.
- Fields with type mismatches across surfaces.
- Fields present in interface but missing from `PR_RECORD_REQUIRED_FIELDS` despite being non-optional (or vice versa).

Exit non-zero.

---

## Entry-point invocations (QG-49 parity)

Every one of Constitution QG-49's four enumerated entry points invokes the SAME command string. No duplicated logic.

### Pre-commit (`scripts/run_repo_hook.py`)

Integrate via the existing predicate-plus-runner pattern used by `is_ui_trigger` / `is_test_trigger` (see `scripts/run_repo_hook.py:625` and `:893`). **There is no `CommandSpec` abstraction in `run_repo_hook.py`** — that dataclass lives only in `scripts/run_pr_preflight.py:71`. The pre-commit handler collects `staged_paths()`, filters via predicate functions, calls clean-worktree guards, then invokes runner functions directly.

Concretely, three additions in `scripts/run_repo_hook.py`:

```python
# (a) trigger predicate — place alongside is_ui_trigger (line 625) and
# is_test_trigger (line 893).
def is_pr_record_parity_trigger(path: str) -> bool:
    return path in {
        "src/ado_git_repo_insights/types.py",
        "extension/ui/schemas/rollup.schema.ts",
        "specs/310-comments-visualization/contracts/pr-record-comments-fields.md",
    }


# (b) runner function — place alongside existing runners such as
# run_extension_typecheck() at line 888.
def run_pr_record_schema_parity_check() -> None:
    safe_print("[pre-commit] running PR-record schema parity gate")
    run_command([sys.executable, "scripts/check_pr_record_schema_parity.py"])


# (c) wiring — two surgical insertions into the existing body of
# run_pre_commit_hook() (defined at line 1041). The function already
# collects triggers at lines 1060-1067 and early-returns at 1069-1070
# when both ui_triggers AND test_triggers are empty. Below, "# existing
# (line NNNN)" marks lines already in the file (do NOT duplicate them);
# "# ADD" marks the new lines this task inserts.

    staged = staged_paths()                                                         # existing (line 1060)
    ui_triggers = [path for path in staged if is_ui_trigger(path)]                  # existing (line 1061)
    test_triggers = [path for path in staged if is_test_trigger(path)]              # existing (line 1062)
    parity_triggers = [path for path in staged if is_pr_record_parity_trigger(path)]  # ADD — reuses `staged`
    tsconfig_triggers = [                                                           # existing (lines 1063-1067)
        path
        for path in staged
        if path.startswith("extension/tsconfig") and path.endswith(".json")
    ]

    if parity_triggers:                                                             # ADD — block goes BEFORE the early-return
        safe_print("")
        safe_print("[pre-commit] PR-record schema parity triggers detected")
        for path in parity_triggers:
            safe_print(f"  - {path}")
        require_clean_pr_record_parity_scope()
        run_pr_record_schema_parity_check()

    if not ui_triggers and not test_triggers:                                       # existing (line 1069)
        return                                                                      # existing (line 1070)

    # existing ui_triggers / test_triggers / tsconfig_triggers dispatch at :1072-:1094 (unchanged)

# WHY the parity dispatch MUST precede the early-return: staging only
# src/ado_git_repo_insights/types.py or only the 310 contract md (neither
# matches is_ui_trigger or is_test_trigger) would otherwise hit the
# early-return at line 1069-1070 and silently skip the gate — the same
# silent-pass failure mode the parity gate was designed to prevent.
```

Triggers cover every file the command reads (QG-47). Three paths, matching the three files listed in "What the command checks" above (surface #2 and #3 share a single file). Ratchet bump guard does not apply (this is not a test-count gate).

**060 contract deliberately excluded from triggers**: `specs/060-throughput-pr-drilldown/contracts/pr-record.md` is NOT parsed by the parity gate. It receives a one-line human-readable pointer update ("the 5 fields declared here are extended by the three additional fields in the 310 sibling contract when `capabilities.comments_metrics=true`") as part of this feature's commits, but that update is documentation continuity for future readers, not a machine-checked surface. Triggering on it would over-declare the gate's coverage; parsing it would require a second non-tabular markdown parse for a file that has no canonical table to drift against. The content-continuity update is tracked as a tasks.md obligation.

### Worktree-clean guard (QG-48)

Add `require_clean_pr_record_parity_scope()` to `scripts/run_repo_hook.py` alongside the existing `require_clean_ui_sources()` / `require_clean_test_compilation_scope()` / `require_clean_tsconfigs()` helpers at lines 644 / 659 / 686. Blocks commit when unstaged changes exist in any of the three trigger paths (same set as the `is_pr_record_parity_trigger` predicate above — 060 contract excluded, same rationale). Called from `run_pre_commit_hook()` (defined at `run_repo_hook.py:1041`) immediately before `run_pr_record_schema_parity_check()` when parity triggers are detected; placement MUST precede the existing early-return at `:1069` so single-file edits to `types.py` or the 310 contract md don't skip the guard. Ensures the gate validates the staged snapshot (QG-48 compliance).

### Pre-push preflight (`scripts/run_pr_preflight.py`)

Add a new `CommandSpec` with identical command string. The existing `CommandSpec` `@dataclass(frozen=True)` at `scripts/run_pr_preflight.py:71-76` has **exactly five fields**: `name`, `command`, `cwd`, `extra_env`, `show_output_on_success` — use only those (no `triggers_any_of`, no `degraded_fallback`):

```python
CommandSpec(
    name="PR-record schema parity",
    command=(sys.executable, "scripts/check_pr_record_schema_parity.py"),
)
```

Defaults per `run_pr_preflight.py:71-76`: `cwd=REPO_ROOT`, `extra_env=None`, `show_output_on_success=False`. Append this `CommandSpec` to the existing preflight command list and follow the sequential-execution pattern used by every other preflight gate.

### CI (`.github/workflows/ci.yml`)

Add a step in the existing Python job (both Ubuntu and Windows lanes per QG-45 cross-OS):

```yaml
- name: PR-record schema parity
  run: python scripts/check_pr_record_schema_parity.py
```

### `pnpm test:ci`

Add a new pnpm script in `extension/package.json` that wraps the canonical command, and chain it into the existing `test:ci` definition. Mirrors the existing `test:partial-branches` precedent at `extension/package.json:34` (which already shells from `pnpm test:ci` into `python ../scripts/check_partial_branches.py`):

```jsonc
"scripts": {
  // ... existing scripts ...
  "test:partial-branches": "python ../scripts/check_partial_branches.py --lcov coverage/lcov.info --baseline ../.coverage-partial-branches-baseline.json",
  "test:schema-parity": "python ../scripts/check_pr_record_schema_parity.py",
  "test:ci": "pnpm run build:check && pnpm run lint:tests && pnpm run build:check-tests && pnpm run test:config-parity && pnpm run format:check && pnpm run test:types && pnpm run test:coverage && pnpm run test:partial-branches && pnpm run test:schema-parity && pnpm run test:smoke"
  // ... remaining scripts ...
}
```

Exact command string matches the other three entry points — no duplicated logic; the pnpm wrapper's body is a single shell-out. Cross-OS: `python` is on PATH in CI (existing test:ci on Windows + Ubuntu already invokes it via `test:partial-branches`).

QG-49 compliance: gate defined ONCE (the Python script), invoked by NAME from all four entry points Constitution QG-49 enumerates (pre-commit, pre-push preflight, `pnpm test:ci`, CI).

### pytest wrapper (for coverage credit + ratchet alignment)

`tests/unit/test_pr_record_schema_parity.py` imports the script as a module and asserts its `main()` returns zero:

```python
from scripts import check_pr_record_schema_parity

def test_pr_record_schema_parity_holds() -> None:
    exit_code = check_pr_record_schema_parity.main([])
    assert exit_code == 0, (
        "PrRecord schema parity drift detected — see stdout for diff."
    )
```

The pytest wrapper and the CLI command both call the same `main()` function. No duplicated logic; they share the same AST-parsing codepath.

---

## Failure modes and diagnostics

- **Python AST parse fails** (e.g., types.py syntax error): script exits non-zero with the Python traceback; pre-commit fails fast; developer fixes syntax error.
- **TypeScript AST parse fails** (e.g., missing `typescript` devDep): script exits non-zero with a hint to run `pnpm install` under `extension/`; pre-commit fails fast.
- **Markdown parse fails** (e.g., contract file's field table malformed): script exits non-zero with a hint to the contract file location.
- **All parses succeed; drift detected**: human-readable diff.
- **All parses succeed; no drift**: exit zero, no output.

---

## What this gate does NOT enforce

- Runtime invariants INV-08 / INV-09 / INV-10. Those are asserted by pytest / Jest tests per [data-model.md §5](../data-model.md).
- Validator permissive behavior on malformed PR records. That is asserted by `extension/tests/schemas/pr-record-comments-fields.test.ts`.
- The existence of `capabilities.comments_metrics` on the manifest. That is Pass 3 already-verified (A-01 CONFIRMED).

The gate is narrowly about schema-shape parity across surfaces. It catches the specific failure mode of "someone updated one surface and forgot the other three" at commit time.
