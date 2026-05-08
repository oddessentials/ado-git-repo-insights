# Development Setup

How to set up a development environment for contributing to ado-git-repo-insights.

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| uv | 0.9+ | Canonical Python + project venv manager. [install](https://docs.astral.sh/uv/getting-started/installation/). Provides `uv python install 3.12`, which is **required for CI-pinned gates** (CLI-reference-drift skips on non-3.12). |
| Python | 3.12 | Acquire via `uv python install 3.12`. Runtime supports 3.12/3.13/3.14 but CI-canonical is 3.12. |
| Node.js | 22 | For extension development. |
| pnpm | 9.15.0 | Enforced by `packageManager` field. Enable via `corepack enable`. |
| Git | Any recent version | Windows: must include Git Bash (Husky requires `sh`). |
| gitleaks | Any recent version | Secret scanning (CI parity). Preflight fails closed if missing — no silent skip. Install: `winget install -e --id Gitleaks.Gitleaks` (Windows), `brew install gitleaks` (macOS), `apt install gitleaks` or a [release binary](https://github.com/gitleaks/gitleaks/releases) (Linux). **Windows note:** winget updates PATH for future shells only; if `gitleaks --version` fails in your current shell after install, restart it. |
| unzip | Any recent version | macOS/Linux only — used by the VSIX-artifact inspection test (`extension/tests/vsix-artifact-inspection.test.ts`) to read the packaged extension contents. Windows uses PowerShell instead. Install: `apt install unzip` (Linux) or pre-installed on macOS. The test fails with an explicit remediation message if `unzip` is missing under `VSIX_REQUIRED=true`. |
| Chromium system libs (Playwright) | (system packages) | macOS/Linux only — Playwright smoke tests load `chrome-headless-shell`, which links against system shared libraries (`libnspr4`, `libnss3`, …). The `extension/` postinstall fetches the Chromium binary but not these libs; CI installs them via `playwright install --with-deps`. We deliberately keep `--with-deps` out of the local postinstall so routine `pnpm install` never prompts for sudo. On a Linux/WSL workstation with nvm-managed Node, install the libs once: `cd extension && NODE_BIN="$(dirname "$(which node)")" && sudo env "PATH=$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" "$NODE_BIN/npx" playwright install-deps chromium`. This pattern hands sudo a controlled PATH containing the nvm-installed Node and invokes `npx` directly, avoiding the `sudo pnpm: command not found` trap (sudo strips PATH; the nvm-managed pnpm shim is not on root's default `$PATH`). macOS: typically pre-installed. |

---

## Quick Setup

```bash
# Clone the repository
git clone https://github.com/oddessentials/ado-git-repo-insights.git
cd ado-git-repo-insights

# 1. Install uv if you don't already have it
#    https://docs.astral.sh/uv/getting-started/installation/

# 2. Acquire the canonical Python interpreter (3.12)
#    Some CI-hard gates (e.g. CLI-reference-drift) are pinned to 3.12
#    and will SKIP locally on any other interpreter.
uv python install 3.12

# 3. Install root Node dependencies and activate Husky git hooks
#    This MUST be the first Node step — hooks enforce all quality gates.
pnpm install

# 4. Create the project venv and install Python dev deps
uv sync --extra dev

# 5. Install extension Node dependencies
#    This also auto-downloads the pinned Playwright browser (~110 MB)
#    via the extension's `postinstall` script — watch for the progress bar.
cd extension && pnpm install && cd ..
```

> **Not using uv?** You can substitute `python -m venv .venv` + `pip install -e .[dev]` for step 4, **but** you must first ensure your `python` resolves to 3.12 — otherwise gates pinned to 3.12 will silently skip locally while CI (always 3.12) remains authoritative.

---

## Python Development

### Install Options

The `Quick Setup` section above uses `uv sync --extra dev`, which installs every
optional group needed for development. If you need a narrower surface:

| Goal | Command |
|------|---------|
| Runtime only (no dev tools) | `uv sync` |
| Development (tests, lint, type-check) | `uv sync --extra dev` |
| With ML extras (Prophet, OpenAI) | `uv sync --extra dev --extra ml` |

Non-uv users can substitute `pip install -e .[dev]` / `pip install -e .[ml]`
after activating a Python 3.12 venv, with the caveat noted in Quick Setup.

### Code Quality Tools

**Linting:**
```bash
ruff check .
```

**Auto-format:**
```bash
ruff format .
```

**Type checking:**
```bash
mypy src/
```

### Running Tests

Use the launcher — it isolates coverage paths so Windows file locking
cannot brick future runs:

```bash
# All tests (with coverage)
python scripts/run_pytest.py

# Specific test file
python scripts/run_pytest.py tests/unit/test_cli_args.py

# Verbose output
python scripts/run_pytest.py -v
```

---

## Extension Development

### Setup

```bash
cd extension
pnpm install
```

### Running Tests

```bash
pnpm test
```

### Building the VSIX

From the `extension/` directory:

```bash
pnpm run package:vsix
```

This builds the UI bundles, stages pipeline task dependencies, and creates
`OddEssentials.ado-git-repo-insights-X.Y.Z.vsix` in the `extension/` directory.
No global tool install is needed — `tfx-cli` is a repo devDependency.

### Local Testing

Upload the VSIX to a test Azure DevOps organization:
1. Go to `https://dev.azure.com/{test-org}/_settings/extensions`
2. Click **Browse local extensions** → **Manage extensions**
3. Click **Upload extension** → select the `.vsix` file from `extension/`

---

## Repo Hooks

Repo-owned hooks run automatically on `git commit` and `git push` through
Husky wrapper files under `.husky/`.
The authoritative implementation lives in:

- `scripts/run_repo_hook.py`
- `scripts/manage_generated_artifacts.py`

Authoritative local parity now fails closed. If `python scripts/run_pr_preflight.py`
cannot run a CI-hard gate such as Node-backed extension checks or `gitleaks`, it
exits nonzero instead of silently skipping that gate.

You do not need to run `pre-commit install` manually for normal repo usage.
`pre-commit` is still required because the repo hooks delegate Python lint/format
checks to it.

The commit/push workflow currently includes:

| Hook | Purpose |
|------|---------|
| `pre-commit` | Python formatting/lint checks, ACL health on Windows, VSS SDK drift sync, compiled artifact guard, invariant artifact contract verification, managed UI/demo artifact sync when UI files are staged |
| `pre-push` | version guard, baseline integrity, `pre-commit --all-files`, CRLF guard, marketplace asset validation, invariant artifact contract verification, and local PR preflight |

### Manual Run

```bash
python scripts/run_repo_hook.py pre-commit
python scripts/run_repo_hook.py pre-push

# Optional: strict preflight with explicit base ref (hook runs non-strict by default)
BASE_REF=main python scripts/run_pr_preflight.py --strict

# Or via the extension package scripts
cd extension
pnpm run hooks:precommit
pnpm run hooks:prepush
```

### Skip Hooks (Not Recommended)

```bash
git commit --no-verify -m "message"
```

---

## Line Endings

This repo uses **LF line endings** for cross-platform compatibility.

**Recommended Git config:**
```bash
# Let .gitattributes be the source of truth
git config core.autocrlf false
```

If you see "CRLF will be replaced by LF" warnings, that's expected behavior.

**Bulk-edit scripts must write LF explicitly** (`Path.write_bytes()` with
`\n`, or `open(path, 'w', newline='\n')`). Windows default text mode emits
CRLF; `git add` normalizes to LF in the index but leaves CRLF in the
worktree until something rewrites the file, which can confuse Windows-only
diagnostics.

---

## Project Structure

```
ado-git-repo-insights/
├── src/ado_git_repo_insights/    # Python package source
│   ├── cli.py                    # CLI entry point
│   ├── ado_client.py             # Azure DevOps API client
│   ├── pr_extractor.py           # Extraction logic
│   ├── repository.py             # SQLite operations
│   ├── csv_generator.py          # CSV generation
│   ├── aggregates.py             # Dashboard aggregates
│   └── ui_bundle/                # Dashboard UI (synced from extension)
├── extension/                     # Azure DevOps extension
│   ├── task/                      # Pipeline task
│   ├── ui/                        # Dashboard UI (source of truth)
│   └── hub/                       # Extension hub
├── tests/                         # Test suite
│   ├── unit/                      # Unit tests
│   ├── integration/               # Integration tests
│   └── fixtures/                  # Test data
├── scripts/                       # Build and utility scripts
├── agents/                        # Governance documents
└── docs/                          # Documentation
```

---

## See Also

- [Testing Guide](testing.md) — Test organization and patterns
- [UI Bundle Sync](ui-bundle-sync.md) — Dashboard UI synchronization
- [Contributing Guide](../../CONTRIBUTING.md) — Contribution workflow
