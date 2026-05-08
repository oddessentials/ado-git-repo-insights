# Development Setup

How to set up a development environment for ado-git-repo-insights.

---

## Recommended: Dev Container

Open the repo in any [Dev Containers-compatible runtime](https://containers.dev/supporting) — VS Code with the **Dev Containers** extension, JetBrains Gateway, etc. The container handles every per-platform variance (Node 22, Python 3.12, pnpm 9.15.0 via Corepack, gitleaks, unzip, Playwright Chromium runtime libraries) and the IDE runs `postCreateCommand` to install repo dependencies automatically.

**Prerequisite**: a runtime — Docker Desktop, OrbStack, Rancher Desktop, or Podman with Dev Containers integration.

**Open**:
- VS Code: install the **Dev Containers** extension, then run "Dev Containers: Reopen in Container."
- Other IDEs: follow your runtime's Dev Containers instructions.
- Ad-hoc `docker run`: see [`.devcontainer/README.md`](../../.devcontainer/README.md) — `--user "$(id -u):$(id -g)"` and a temp clone are required to avoid root-owned host artifacts.

**Verify**:
```bash
python scripts/run_pr_preflight.py
```

This is the recommended path for **all platforms**. It is the only supported path on Apple Silicon Mac (the dev container is multi-arch) and any host where modifying the system Python/Node toolchain is undesirable.

---

## Advanced: Native setup

Use this when you can't run a container. The dev container is the canonical source — these steps reproduce its layered installs on the host.

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| uv | 0.9+ | https://docs.astral.sh/uv/getting-started/installation/ |
| Python | 3.12 | `uv python install 3.12`. CI-pinned gates require 3.12 specifically. |
| Node.js | 22 (LTS) | `nvm install 22 && nvm use 22 && nvm alias default 22`. CI pins to 22. |
| pnpm | 9.15.0 | `corepack enable` activates it via `package.json::packageManager`. |
| Git | any recent | Windows: include Git Bash (Husky requires `sh`). |
| gitleaks | any recent | `apt install gitleaks` (Linux), `brew install gitleaks` (macOS), `winget install Gitleaks.Gitleaks` (Windows). |
| unzip | any recent | macOS/Linux only. `apt install unzip`; pre-installed on macOS. |
| Chromium system libs (Playwright) | system pkgs | Linux/WSL only. One-time: `cd extension && NODE_BIN="$(dirname "$(which node)")" && sudo env "PATH=$NODE_BIN:$PATH" "$NODE_BIN/npx" playwright install-deps chromium`. |

### Quick Setup

```bash
# 1. Repo-local LF policy
git config core.autocrlf false

# 2. Canonical Python interpreter
uv python install 3.12

# 3. Root pnpm install — MUST be first Node step (activates Husky hooks)
pnpm install

# 4. Project venv + Python dev deps
uv sync --extra dev

# 5. Extension deps (Playwright Chromium downloads ~110 MB)
pnpm --dir extension install

# 6. Verify with the authoritative gate
python scripts/run_pr_preflight.py
```

Step 6 should print `[OK] Local PR preflight passed`.

### Platform notes

**WSL**: confirm `which -a pnpm` resolves the Linux-native pnpm first. A Windows-side `pnpm.cmd` leaked through `/mnt/c/...` PATH integration breaks repo scripts that resolve pnpm by name.

**Apple Silicon Mac**: native setup may require manual workarounds for some system libraries. Prefer the dev container.

**Windows native**: requires Git Bash for Husky (`sh`). The dev container or WSL is recommended.

---

## Hooks

Repo-owned git hooks fire automatically through Husky on `git commit` and `git push`. Implementation lives in [`scripts/run_repo_hook.py`](../../scripts/run_repo_hook.py); see [`LOCAL_CI_PARITY_INVARIANTS.md`](../../LOCAL_CI_PARITY_INVARIANTS.md) for the gate-by-gate parity contract.

To run hooks manually:

```bash
python scripts/run_repo_hook.py pre-commit
python scripts/run_repo_hook.py pre-push
```

`--no-verify` is forbidden by project policy. If a hook fails, fix the underlying issue and re-commit.

---

## See also

- [`docs/development/testing.md`](testing.md) — running and writing tests
- [`docs/development/ratchets.md`](ratchets.md) — test floor & coverage gate workflow
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — PR workflow & commit conventions
</content>
