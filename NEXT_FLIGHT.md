## Flight 260127A — Unified Dashboard Launch (`build-aggregates --serve`)

### Objective

Add an **optional convenience flow** so developers can run **one command** to (1) build aggregates and then (2) serve/open the local dashboard, while **preserving the existing two-step workflow** and keeping build vs serve concerns clearly separated.

---

## Non-Negotiable Invariants

- `ado-insights build-aggregates` must remain a valid **standalone build** command.
- `ado-insights dashboard` must remain a valid **standalone serve** command.
- `--serve` must only run **after a successful build**.
- `--open` and `--port` are **serve-only options** and must not be silently accepted without `--serve`.
- No duplication of server code: the HTTP serving logic must live in **one reusable module**.

---

## User-Facing CLI Contract

### New syntax

```bash
# Single-step workflow (NEW)
ado-insights build-aggregates --db ./ado-insights.sqlite --out ./dataset --serve

# With auto-open browser (NEW)
ado-insights build-aggregates --db ./ado-insights.sqlite --out ./dataset --serve --open

# Existing two-step workflow (UNCHANGED)
ado-insights build-aggregates --db ./ado-insights.sqlite --out ./dataset
ado-insights dashboard --dataset ./dataset --open
```

### Flag rules (enforced)

- `--serve`: starts dashboard server after successful build.
- `--open`: **requires** `--serve` (hard error if used without).
- `--port`: **requires** `--serve` (hard error if used without).

---

## Implementation Phases (Ordered)

### Phase 1 — Extract server logic into a reusable module

**Goal:** Make dashboard serving callable from both `cmd_dashboard` and `cmd_build_aggregates`.

**[NEW] `src/ado_git_repo_insights/dashboard_server.py`** (or existing project’s canonical module dir)

- Implement:

    ```python
    def serve_dashboard(
        dataset_path: Path,
        ui_source: Path,
        port: int = 8080,
        open_browser: bool = False,
    ) -> int:
        """
        Serve the dashboard for dataset_path using ui_source.
        Returns exit code: 0 success, 1 error.
        """
    ```

- Requirements:
    - Must validate `dataset_path` exists and contains required dataset files before serving (same checks `cmd_dashboard` currently performs).
    - Must bind to `port` and return `1` on bind failure / startup failure.
    - Must only auto-open browser when `open_browser=True`.
    - Must not depend on CLI argparse objects or global CLI state.

**[MODIFY] `cli.py`**

- Refactor existing `cmd_dashboard` to call `serve_dashboard(...)` instead of hosting server logic inline.
- Keep `cmd_dashboard` behavior intact (args parsing, defaults, logging, exit codes).

**DoD (Phase 1)**

- `ado-insights dashboard --dataset ./dataset --open` behaves exactly as before.
- Unit tests still pass.

---

### Phase 2 — Add `--serve` chaining to `build-aggregates`

**Goal:** Keep build command behavior unchanged unless `--serve` is explicitly set.

**[MODIFY] `cli.py` — argparse changes**
In the `build-aggregates` subparser:

```python
build_parser.add_argument(
    "--serve",
    action="store_true",
    default=False,
    help="After building aggregates, start the dashboard server",
)
build_parser.add_argument(
    "--open",
    action="store_true",
    default=False,
    help="Open browser automatically (requires --serve)",
)
build_parser.add_argument(
    "--port",
    type=int,
    default=8080,
    help="Dashboard server port (requires --serve, default: 8080)",
)
```

**[MODIFY] `cmd_build_aggregates`**

- After successful build completion:
    - If `args.serve` is `False`: return build exit code exactly as today.
    - If `args.serve` is `True`: call `serve_dashboard(dataset_path=args.out, ui_source=<same source used by cmd_dashboard>, port=args.port, open_browser=args.open)`.

**Validation (hard fail)**

- If `args.open` is True and `args.serve` is False → exit `2` (arg error) with clear message.
- If `args.port` is explicitly set and `args.serve` is False → exit `2` with clear message.

**Exit code semantics (required)**

- Build failures return the same non-zero code as today and **must not** start the server.
- If build succeeds but server fails to start, return `1` (serve failure).
- If build succeeds and server starts, the process becomes the foreground server process (same as `dashboard` command).

**DoD (Phase 2)**

- `ado-insights build-aggregates --db X --out Y --serve` starts server using `Y`.
- `ado-insights build-aggregates --open` fails fast with clear CLI error.
- Existing `build-aggregates` behavior (without `--serve`) is unchanged.

---

### Phase 3 — Tests

**[NEW] `tests/unit/test_cli_build_serve.py`**
Add unit tests covering:

1. **Serve only after successful build**

- Mock build path to succeed and ensure `serve_dashboard()` invoked.
- Mock build path to fail and ensure `serve_dashboard()` NOT invoked.

2. **Output path wiring**

- Ensure `--out` is passed as `dataset_path` to `serve_dashboard()`.

3. **Flag validation**

- `--open` without `--serve` => exit code `2` and message.
- `--port` without `--serve` => exit code `2` and message.

4. **Port forwarding**

- Ensure `--port` value is passed through.

**Test guidance**

- Mock `serve_dashboard` and the build function so tests don’t open sockets or spawn servers.
- Keep tests deterministic and fast.

**DoD (Phase 3)**

- `pytest tests/` passes.
- No flaky tests; no real port binding during unit tests.

---

### Phase 4 — Documentation

**[MODIFY] `README.md`**
Update “Basic Usage” to include the new single-step dashboard flow:

```bash
ado-insights build-aggregates --db ./ado-insights.sqlite --out ./dataset --serve --open
```

**[MODIFY] `docs/reference/cli-reference.md`**
In `build-aggregates` section:

- Add options table rows for `--serve`, `--open`, `--port`.
- Add example showing one-command build+serve.

**[MODIFY] `docs/local-cli.md`**
Update “Option B: Local Database (Dev Mode)” with:

- Recommended single-step example
- Two-step alternative for advanced control

**DoD (Phase 4)**

- Docs match actual CLI behavior and validation rules (no “open ignored” language).

---

## Verification Checklist (Must Run)

### Automated

- `pytest tests/`
- `ado-insights build-aggregates --help` (verify flags appear under the correct command)
- `npm run test:ci` (must remain green)

### Manual smoke tests

1. Happy path:

```bash
ado-insights build-aggregates --db ./ado-insights.sqlite --out ./dataset --serve --open
```

- Browser opens
- Dashboard loads dataset successfully

2. Build failure path:

```bash
ado-insights build-aggregates --db ./nonexistent.sqlite --out ./dataset --serve
```

- Exits non-zero
- No server start attempt

3. Arg validation:

```bash
ado-insights build-aggregates --db ./ado-insights.sqlite --out ./dataset --open
```

- Exits with arg error (code 2), clear message

---

## PR Slicing (Recommended)

1. PR 1: Extract `serve_dashboard()` + refactor `cmd_dashboard` to use it.
2. PR 2: Add `--serve/--open/--port` to `build-aggregates` + enforce validation + chain call.
3. PR 3: Add unit tests for chaining and validation.
4. PR 4: Docs updates.

---

## Exit Criteria

- ✅ `ado-insights build-aggregates --serve --open` works end-to-end
- ✅ Two-step workflow unchanged
- ✅ `--open/--port` without `--serve` hard-fails with clear error
- ✅ All Python + extension tests green
- ✅ Docs updated and accurate
