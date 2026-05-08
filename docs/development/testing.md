# Testing Guide

How tests are organized and how to run them.

---

## Organization

```
tests/
├── unit/                  # Isolated component tests (mocks)
├── integration/           # End-to-end workflow tests
└── fixtures/              # Test data (golden output, staged artifacts)
```

`extension/tests/` mirrors this layout for TypeScript/Jest tests, plus `extension/tests/smoke/` for Playwright smoke tests.

---

## Running tests

### Python

```bash
python scripts/run_pytest.py                    # all tests, with coverage
python scripts/run_pytest.py tests/unit/test_cli_args.py
python scripts/run_pytest.py -v -k test_foo
```

The launcher isolates per-run coverage paths to avoid Windows file-locking issues. Bare `python -m pytest` works for advanced/manual use but is not the supported local dev path on Windows.

### Extension

```bash
cd extension && pnpm test                       # unit tests
cd extension && pnpm test:coverage              # with coverage + JUnit (needed for ratchet-bump-guard)
cd extension && pnpm run test:smoke             # Playwright smoke
```

### Authoritative local gate

```bash
python scripts/run_pr_preflight.py
```

This is the source of truth for "what CI will run." It fails closed on missing tooling (`gitleaks`, Node child-processes, `unzip`) rather than silently degrading. Pre-push hooks invoke it automatically; run it standalone when pushing from an environment that skips hooks.

---

## CI parity

CI runs each gate as a separate job in [`.github/workflows/ci.yml`](/.github/workflows/ci.yml). The local equivalents and the parity contract are documented in [`LOCAL_CI_PARITY_INVARIANTS.md`](/LOCAL_CI_PARITY_INVARIANTS.md). To reproduce a specific CI failure, look up the failing job name in the workflow and run its documented local equivalent — the fastest single-command reproduction is `python scripts/run_pr_preflight.py`.

For higher-confidence cross-version parity (full Python OS × version matrix locally), use:

```bash
python scripts/run_ci_parity.py                 # subset, fast
python scripts/run_ci_parity.py --mode full     # per-version venvs
```

`--mode full` requires Python 3.12, 3.13, and 3.14 installed on the host.

---

## Coverage

Floor and threshold management — when to bump, what marker to use, how to recover from drift — is in [`docs/development/ratchets.md`](ratchets.md).

To check coverage locally:

```bash
python scripts/run_pytest.py --cov=src --cov-report=html
open htmlcov/index.html
```

The launcher accepts arbitrary pytest args and forwards them, while adding launcher-managed coverage settings (per-run `COVERAGE_FILE` under the OS temp directory, `--cov-fail-under=0` for subset runs like `-k`/`-m`/`--lf`/explicit paths). Full-suite runs, preflight, and CI still enforce the real floor.

---

## Cleaning ephemeral state

```bash
pnpm clean:dry                                  # preview
pnpm clean                                      # apply
```

The registry of eligible paths lives in [`scripts/ephemeral_registry.json`](/scripts/ephemeral_registry.json). Exit codes (cross-OS-enforced by the `ephemeral-cleaner-smoke` CI job): `0` = clean or sweep succeeded, `3` = dry-run found work pending (informational), `2` = setup failure, `1` = validation/refusal.

---

## Conventions

- File: `test_{module}.py`
- Function: `test_{behavior}_when_{condition}`
- Many tests verify invariants from [`agents/INVARIANTS.md`](../../agents/INVARIANTS.md). Reference that file for the full list.
- Golden tests use **dynamic fixtures** — temporary SQLite DBs created at test time; no pre-baked reference files on disk. See `tests/fixtures/golden/` for reference data.
- Drift guards (e.g. `test_summary_drift_guard.py`) lock documentation against silent rot.

---

## See also

- [`docs/development/setup.md`](setup.md) — environment setup
- [`docs/development/ratchets.md`](ratchets.md) — test floor / coverage threshold workflow
- [`agents/INVARIANTS.md`](../../agents/INVARIANTS.md) — system invariants to test against
</content>
