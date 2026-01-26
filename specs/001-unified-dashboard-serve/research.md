# Research: Unified Dashboard Launch

**Feature**: 001-unified-dashboard-serve
**Date**: 2026-01-26

## Research Questions

### Q1: How should server code be shared between commands?

**Decision**: Extract a private `_serve_dashboard(dataset_path: Path, port: int, open_browser: bool) -> int` function from `cmd_dashboard`.

**Rationale**:
- The existing `cmd_dashboard` function (lines 1215-1387) contains all the logic for serving: UI bundle location, dev mode sync, temp directory creation, HTTP server setup, browser opening.
- Extracting this into a reusable function allows `cmd_build_aggregates` to call it after successful aggregate generation.
- The function takes `dataset_path` (output directory from build), `port`, and `open_browser` as parameters.
- Returns exit code (0 for success, 1 for error) consistent with other command handlers.

**Alternatives Considered**:
1. **Duplicate code**: Rejected - violates C-001 constraint and maintainability.
2. **Import `cmd_dashboard` and call it**: Rejected - `cmd_dashboard` expects `args.dataset`, not `args.out`; mixing namespace attributes is error-prone.
3. **Create a new module**: Rejected - overkill for ~100 lines; keeping in cli.py maintains locality.

### Q2: How should flag validation be implemented?

**Decision**: Validate flags at the start of `cmd_build_aggregates`, before any processing.

**Rationale**:
- argparse doesn't natively support "flag A requires flag B" constraints.
- Manual validation in the command handler is the standard pattern in this codebase (see lines 782-800 for `enable_insights` validation).
- Fail-fast with clear error message before any aggregate generation begins.

**Implementation Pattern**:
```python
def cmd_build_aggregates(args: Namespace) -> int:
    # Flag validation (FR-004)
    serve = getattr(args, "serve", False)
    open_browser = getattr(args, "open", False)
    port = getattr(args, "port", 8080)

    if not serve and (open_browser or port != 8080):
        flags = []
        if open_browser:
            flags.append("--open")
        if port != 8080:
            flags.append("--port")
        logger.error(f"{', '.join(flags)} requires --serve")
        return 1

    # ... rest of function
```

**Alternatives Considered**:
1. **argparse custom action**: Rejected - complex and less readable than explicit validation.
2. **Validate after build completes**: Rejected - wastes time if flags are invalid.

### Q3: What is the argument parsing structure?

**Decision**: Add three new arguments to `build_parser` in `create_parser()`:

```python
build_parser.add_argument(
    "--serve",
    action="store_true",
    default=False,
    help="Start local dashboard server after building aggregates",
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
    help="Local server port (requires --serve, default: 8080)",
)
```

**Rationale**:
- Consistent with existing `dashboard` command flags.
- Default port (8080) matches `dashboard` command.
- `--open` and `--port` mirror existing dashboard behavior exactly.

### Q4: How should the extracted server function handle dataset path?

**Decision**: `_serve_dashboard` accepts the resolved dataset path directly, not an argparse namespace.

**Rationale**:
- `cmd_build_aggregates` knows `args.out` is the output directory.
- `cmd_dashboard` knows `args.dataset` is the input directory.
- The extracted function shouldn't care about argparse; it just serves files from a path.

**Function Signature**:
```python
def _serve_dashboard(
    dataset_path: Path,
    port: int = 8080,
    open_browser: bool = False,
) -> int:
    """Serve the PR Insights dashboard from the given dataset path.

    This is the core server logic extracted from cmd_dashboard for reuse.

    Args:
        dataset_path: Path to directory containing dataset-manifest.json
        port: HTTP server port (default: 8080)
        open_browser: Whether to open browser automatically

    Returns:
        Exit code (0 for success, 1 for error)
    """
```

### Q5: What about dev mode UI sync?

**Decision**: Keep dev mode UI sync in the extracted function.

**Rationale**:
- Dev mode sync ensures developers always see the latest UI.
- The logic is self-contained and idempotent (checks `sync_needed` before copying).
- No reason to skip it when serving from `build-aggregates`.

## Implementation Summary

1. **Add arguments** (lines ~226-261 in cli.py):
   - Add `--serve`, `--open`, `--port` to `build_parser`

2. **Extract server function** (new private function):
   - Move lines 1230-1387 from `cmd_dashboard` into `_serve_dashboard()`
   - Replace `args.dataset` → `dataset_path` parameter
   - Replace `args.port` → `port` parameter
   - Replace `args.open` → `open_browser` parameter

3. **Refactor cmd_dashboard** (lines 1215-1387):
   - Keep argument resolution (`args.dataset.resolve()`)
   - Call `_serve_dashboard(input_path, args.port, args.open)`

4. **Modify cmd_build_aggregates** (lines 763-855):
   - Add flag validation at top
   - After successful build, conditionally call `_serve_dashboard(args.out, port, open_browser)`

5. **Update CLI reference docs** (docs/reference/cli-reference.md):
   - Add new flags to build-aggregates section

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Regression in dashboard command | Low | Medium | Unit tests for both code paths |
| Server fails after build succeeds | Low | Low | User can re-run dashboard command manually |
| Port collision not caught | Low | Low | Existing socket error handling sufficient |
