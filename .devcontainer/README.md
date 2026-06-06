# Dev container

This directory provisions a reproducible development environment that absorbs the per-platform runtime + system-library variance native setups encounter. The published image carries the deterministic system layer (Python 3.12, uv, gitleaks, GitHub CLI, GitHub Spec Kit, entire.io CLI, Playwright runtime libs, unzip), and the Dev Container lifecycle layers Node 22, pnpm 9.15.0, and the project's Python venv on top at first-up time.

> [!IMPORTANT]
> **The published `:main` image is a Dev Containers-ready base, not a standalone testable development environment.** Per the spec author's image-reclassification decision (FR-009 of [`spec.md`](../specs/364-devcontainer-refactor/spec.md)):
>
> - **Node, pnpm, and the project's Python venv are NOT in the raw `ghcr.io/...:main` image.** They are provided by the Dev Container Feature (`ghcr.io/devcontainers/features/node`) + the Corepack activation in `postCreateCommand` + `uv sync` in `postCreateCommand`.
> - Running `docker run` against the raw image and expecting `node --version` / `pnpm --version` / `python scripts/run_pr_preflight.py` to work is **NOT a supported path**.
> - The supported paths to a working dev environment are: VS Code `Dev Containers: Reopen in Container`, JetBrains Gateway Dev Containers integration, or the `@devcontainers/cli` (`devcontainer up`). All three apply Features + `onCreateCommand` + `postCreateCommand` on top of the raw image.
> - Verification commands (`gh --version`, `entire --version`, `gitleaks detect`, `python scripts/run_pr_preflight.py`, etc.) MUST run inside the **post-lifecycle container** via `devcontainer exec`, not against the raw image.

## Recommended use — Dev Containers extension

Open the repo in any IDE that supports the [Dev Containers spec](https://containers.dev/) (VS Code with the **Dev Containers** extension, JetBrains Gateway, etc.). The IDE handles user mapping, the lifecycle hooks (`onCreateCommand`, `postCreateCommand`), port forwarding, and credential helper plumbing automatically.

`devcontainer.json` declares `"remoteUser": "vscode"`. Microsoft's base image creates `vscode` with `uid:gid 1000:1000`, which matches the typical host user uid on Linux/macOS. Files written through the bind mount end up owned by the host user — no root pollution.

## Container runtime — pick any

The dev container image is runtime-agnostic. Any [Dev Containers-compatible runtime](https://containers.dev/supporting) works:

- Docker Desktop (Mac, Windows, Linux)
- OrbStack (Mac)
- Rancher Desktop (cross-platform)
- Podman with Dev Containers integration

## Image source — GHCR by default

`devcontainer.json` references the multi-arch image published to GHCR by the [`publish-devcontainer` CI job](../.github/workflows/ci.yml) on every merge to `main`:

```
ghcr.io/oddessentials/ado-git-repo-insights-dev:main
```

Fresh clones pull this image (~30s on a warm cache) instead of building locally (~5 min, ~850 MB compressed). Both `linux/amd64` and `linux/arm64` are published, so Apple Silicon hosts get a native-arch image without QEMU emulation.

### When to fall back to a local build

Two scenarios require a local rebuild. Both involve editing `devcontainer.json` in your local checkout — **do not commit** these edits:

- **GHCR unreachable or the package is private** and you don't have pull access. VS Code will surface a clear pull error.
- **Iterating on `Dockerfile`** — the `:main` tag only reflects merged changes, so an in-progress Dockerfile edit will not appear there.

In either case, replace the `"image"` line with:

```jsonc
"build": { "dockerfile": "Dockerfile" }
```

and rebuild via the manual recipe below.

## Ad-hoc verification via Dev Container CLI

If you want to verify the container outside the IDE flow (debugging a build issue, re-running gates manually), use the [`@devcontainers/cli`](https://github.com/devcontainers/cli) — **not** `docker run`. Per the FR-009 reclassification above, the raw image does not have Node/pnpm/preflight; only the Dev Container lifecycle produces a working environment.

### Install the CLI (one-time)

```bash
npm i -g @devcontainers/cli
devcontainer --version
```

### Bring up the container against the tracked config

```bash
cd /path/to/your/checkout
devcontainer up --workspace-folder .
```

The CLI pulls the GHCR image (or builds locally if you've overridden `image` → `build`), applies the Node Feature, runs `onCreateCommand` (`sudo chown` of the gh + entire named volume mounts), then runs `postCreateCommand` (Corepack-pinned pnpm + `pnpm install` + `uv sync` + extension install). When the command returns, the container is in the same post-lifecycle state VS Code would produce. Agent-specific `entire` wiring (`entire enable --agent <yours>`) is intentionally **not** in `postCreateCommand` — it's a contributor-driven step documented in [Scenario E](#scenario-e--entire-first-run-login-named-volume-persistence-default).

### Run gates against the post-lifecycle container

```bash
devcontainer exec --workspace-folder . bash -c '
  set -euo pipefail
  # Image-property version checks (FR-013, Contract 4a):
  node --version            # provided by Feature
  pnpm --version            # validated by postCreateCommand FR-021 fail-closed
  python --version
  uv --version
  gh --version
  specify --version
  entire --version
  gitleaks version
  unzip -v >/dev/null

  # QG-56 authoritative scan:
  gitleaks detect --config=.gitleaks.toml

  # VR-29 authoritative preflight:
  python scripts/run_pr_preflight.py
'
```

A failing `gh auth status` here is documented baseline (image ships unauthenticated by design — see Authentication and credentials below); not a failure.

### Why not `docker run`?

A `docker run` invocation that bind-mounts the workspace and runs `pnpm install` against the raw image fails on the first `pnpm` call — Node is not in the image. The previous "Ad-hoc `docker run` verification" pattern in this README (pre-364-devcontainer-refactor) assumed Node and pnpm were image-installed; they no longer are. The Dev Container CLI is the canonical replacement.

## Build the image manually (fallback)

Use this when GHCR is unreachable or you are iterating on the Dockerfile (see [When to fall back to a local build](#when-to-fall-back-to-a-local-build)):

```bash
docker build -t ado-git-repo-insights-dev:test -f .devcontainer/Dockerfile .devcontainer/
```

No build context is needed beyond the `.devcontainer/` directory itself — the Dockerfile is self-contained.

## What's IN the image

The image carries the deterministic system layer — interpreters, system libraries, and pinned tools:

| Tool | Source | Pin |
|---|---|---|
| Python 3.12 | Base image (`mcr.microsoft.com/devcontainers/python:3.12-bookworm`) | major.minor |
| `uv` | Dockerfile install from `astral.sh/uv` | `UV_VERSION` ARG |
| `gh` (GitHub CLI) | Dockerfile install from `cli.github.com` apt + signed keyring + `apt-mark hold` | `GH_VERSION` ARG |
| `specify` (Spec Kit) | Dockerfile `uv tool install` from an immutable git commit pin against `github/spec-kit` | `SPECKIT_VERSION` + `SPECKIT_COMMIT` ARGs |
| `entire` (entire.io CLI) | Dockerfile install of SHA256-verified GitHub release-binary tarball (multi-arch dispatcher); install.sh disqualified for lack of version pinning | `ENTIRE_VERSION` + `ENTIRE_SHA256_AMD64` + `ENTIRE_SHA256_ARM64` ARGs |
| `gitleaks` | Dockerfile install of SHA256-verified release tarball (multi-arch dispatcher) | `GITLEAKS_VERSION` + per-arch SHA256 ARGs |
| Playwright Chromium apt deps | Dockerfile install via `pnpm dlx playwright@${PLAYWRIGHT_VERSION} install-deps chromium` (Node installed temporarily for this step, then purged) | `PLAYWRIGHT_VERSION` matches `extension/package.json::@playwright/test` |
| `unzip` | Dockerfile apt install | Debian-provided |

## What's NOT in the image

Provided by the Dev Container lifecycle (Feature + `postCreateCommand`):

- **Node.js 22** — installed at devcontainer-up time by `ghcr.io/devcontainers/features/node@sha256:fedd4c11…` (pinned by immutable digest).
- **pnpm 9.15.0** — activated at first-up time by Corepack in `postCreateCommand` (per FR-021); pinned to `package.json::packageManager` with fail-closed `pnpm --version` validation.
- Repo Python deps (`numpy`, `pandas`, `ado_git_repo_insights`, etc.) — installed by `postCreateCommand` via `uv sync --locked --extra dev`.
- Node deps (`pnpm install` at root and in `extension/`) — installed by `postCreateCommand`.
- The Playwright Chromium browser binary — downloaded by the extension's `postinstall` script during `pnpm --dir extension install`.

Excluded by policy (developer-personal tooling per `.gitignore` excludes `.codex`, `.claude/`, `CLAUDE.md`):

- **Claude Code, Codex, and any other personal AI assistant client tooling.** Install via your dotfiles repo or run `npm i -g @anthropic-ai/claude-code` etc. inside the container ephemerally; FR-008 of the spec.
- **`entire` is NOT excluded by this policy** — it is shared git observability infrastructure that captures AI agent sessions and indexes them alongside commits, distinct from personal AI clients. It is installed in the image per FR-020. The repo's `.husky/` scripts wire it up; the `.entire/settings.json` opts out of telemetry at the repo level.

The image carries the deterministic system layer; the lifecycle layers Node/pnpm/Python deps on top so the image stays portable across branches.

---

## Authentication and credentials

`git` and `gh` are **two separate auth surfaces**. So is `entire`. A failing `gh auth status` does NOT imply git push will fail, and vice versa. Each is documented separately below. Recovery for one does not require touching the others.

### Scenario A — `gh` first-run login (named-volume persistence default)

A contributor opens the container for the first time and wants to push or create a PR. The image ships `gh` unauthenticated by design.

**Expected baseline** before login:

```bash
$ gh auth status
You are not logged into any GitHub hosts. Run gh auth login to authenticate.
```

This is the documented baseline; not a failure. Run the one-time login:

```bash
$ gh auth login
? What account do you want to log into? GitHub.com
? What is your preferred protocol for Git operations? HTTPS
? Authenticate Git with your GitHub credentials? Yes
? How would you like to authenticate GitHub CLI? Login with a web browser
   First copy your one-time code: XXXX-XXXX
   Press Enter to open github.com in your browser...
   ✓ Authentication complete.
   - gh config set -h github.com git_protocol https
   ✓ Configured git protocol
   ✓ Logged in as <your-github-username>
```

After login, verify:

```bash
$ gh auth status
github.com
  ✓ Logged in to github.com account <your-github-username>
  - Active account: true
  - Git operations protocol: https
  - Token: gho_*****

$ ls -l /home/vscode/.config/gh/hosts.yml
-rw------- 1 vscode vscode 196 ... /home/vscode/.config/gh/hosts.yml
```

The `hosts.yml` lives in the named Docker volume `ado-git-repo-insights-gh-config`. It persists across container rebuilds — see Scenario B.

**Failure remediation**: if `gh auth login` reports `permission denied` writing to `hosts.yml`, the `onCreateCommand` chown did not run or did not target the gh mount path. Re-create the container; if the issue persists, inspect `.devcontainer/devcontainer.json::onCreateCommand` for the correct `sudo chown -R vscode:vscode /home/vscode/.config/gh /home/vscode/.entire` invocation.

### Scenario B — Subsequent container rebuilds (persistence verification)

A contributor rebuilds the container (`Dev Containers: Rebuild Container`, or `devcontainer up --remove-existing-container`) and expects `gh` to remain authenticated.

**Verify the volume persists** on the host:

```bash
$ docker volume ls | grep ado-git-repo-insights-gh-config
local     ado-git-repo-insights-gh-config
```

**Verify `gh` sees the persisted credentials** inside the rebuilt container:

```bash
$ gh auth status
github.com
  ✓ Logged in to github.com account <your-github-username>
  - Active account: true
  ...
```

**Failure remediation**: if `gh auth status` reports "not logged in" after rebuild but the named volume IS listed, inspect the tracked `.devcontainer/devcontainer.json::mounts` block — the entry MUST be `source=ado-git-repo-insights-gh-config,target=/home/vscode/.config/gh,type=volume` exactly. If the volume IS NOT listed, it was manually removed (`docker volume rm`) and you re-`gh auth login` per Scenario A; the volume is recreated empty on next container creation.

### Scenario C — Git HTTPS operations (separate auth surface)

Git HTTPS operations (`git push`, `git pull`, `git fetch`) use VS Code's injected credential helper proxy, which brokers credentials from the host's GitHub authentication provider. This auth surface is **independent of `gh` auth state** — `gh` could be fully unauthenticated and `git push` would still succeed if VS Code is signed in to GitHub on the host.

**Verify the credential helper is configured** inside the container:

```bash
$ git config --get credential.helper
!f() { /home/vscode/.vscode-server/bin/<SHA>/node /tmp/vscode-remote-containers-<UUID>.js git-credential-helper $*; }; f
```

If the output is empty or does not contain `vscode-remote-containers`, your IDE is not VS Code (JetBrains Gateway / headless `docker run` do not inject this helper), and the recommended path is `gh` HTTPS via Scenario A above.

**Verify git push works** without prompting:

```bash
$ git push --dry-run
To github.com:oddessentials/ado-git-repo-insights.git
 = [up to date] main -> main
```

(No `Username for 'https://github.com'` prompt, no `Password for ...` prompt. The helper resolved your credentials silently.)

**Failure remediation**: if `git push` prompts for credentials, the most common cause is that VS Code is signed out of GitHub on the host. Sign in via the host VS Code's Accounts gear → "Sign in to GitHub", then retry the push without restarting the container. If the prompt persists, restart the container to refresh the credential-helper socket. Reminder: this remediation affects ONLY git; your `gh auth login` state and `entire login` state are unaffected.

### Scenario D — SSH-based git (uncommitted local override)

A contributor needs SSH-based git operations (private repo on a non-GitHub remote, signed commits via SSH key, etc.) instead of the HTTPS-via-credential-helper path. Per FR-007, SSH agent forwarding is an **uncommitted local override**, not a tracked-config default.

**Add the following to your local checkout of `.devcontainer/devcontainer.json`** — DO NOT commit:

```jsonc
{
  // ...
  "mounts": [
    "source=ado-git-repo-insights-gh-config,target=/home/vscode/.config/gh,type=volume",
    "source=ado-git-repo-insights-entire-config,target=/home/vscode/.entire,type=volume",
    // Uncommitted local addition for SSH-based git:
    "source=${env:SSH_AUTH_SOCK},target=/ssh-agent,type=bind,readonly"
  ],
  "containerEnv": {
    "SSH_AUTH_SOCK": "/ssh-agent"
  }
}
```

Rebuild the container, then verify:

```bash
$ ssh-add -l
2048 SHA256:<your-key-fingerprint> /Users/<you>/.ssh/id_rsa (RSA)

$ ssh -T git@github.com
Hi <your-github-username>! You've successfully authenticated, but GitHub does not provide shell access.
```

**Failure remediation**: if `ssh-add -l` reports `The agent has no identities`, ensure the host ssh-agent is running (`launchctl list | grep ssh-agent` on macOS; `systemctl --user status ssh-agent.service` on Linux) and that your keys are loaded (`ssh-add ~/.ssh/id_rsa`). If `ssh -T git@github.com` reports `Permission denied (publickey)`, the host agent IS forwarding but GitHub does not recognize the key — add it via Settings → SSH and GPG keys on github.com. This override is FR-007-governed and requires no constitutional escalation.

### Scenario E — `entire` first-run login (named-volume persistence default)

A contributor wants AI agent sessions (Claude Code, Codex, gemini-cli, opencode, cursor, copilot CLI, FactoryAI) captured and indexed alongside their commits via [entire.io](https://entire.io). The image ships `entire` installed and the husky hooks pre-wired; the contributor enables session capture by running `entire login` once.

**Expected baseline** before login (entire's hooks fire as no-ops; commits work unchanged):

```bash
$ entire --version
entire 0.7.3
```

Run the one-time login:

```bash
$ entire login
==> Authenticating with Entire
   Open this URL in your browser:
   https://entire.io/cli/auth?code=XXXX-XXXX
   Or run: open "https://entire.io/cli/auth?code=XXXX-XXXX"
   Waiting for authorization...
   ✓ Authorization complete.
   ✓ Logged in as <your-entire-account>
```

After login, verify:

```bash
$ entire auth status
✓ Logged in to entire.io as <your-entire-account>

$ ls -l /home/vscode/.entire/
-rw------- 1 vscode vscode  XXX ... auth.json
... (other entire config files)
```

State persists in the named Docker volume `ado-git-repo-insights-entire-config`. Subsequent rebuilds reattach the volume; `entire auth status` reports STILL authenticated without re-login (same persistence model as Scenario B for `gh`).

**Session capture context** — important for transparency:

- Sessions are captured into the `entire/checkpoints/v1` branch IN this repo (not on entire.io's servers by default).
- Repo-level telemetry is **explicitly disabled** via the tracked `.entire/settings.json`.
- If you choose NOT to `entire login`, the `entire` binary is still installed and the husky hooks still fire — but no session data is captured. All commits, pushes, and PR creation succeed unchanged. External fork contributors are not required to authenticate.

**Optional: wire `entire` for an installed AI agent.** Once you've installed your preferred AI agent CLI (Claude Code, Codex, gemini-cli, opencode, cursor, copilot CLI, or FactoryAI — installed via your dotfiles or `npm i -g …` inside the container, **not** shipped in this image per FR-008), run the appropriate `entire` setup command to wire agent-specific hooks beyond what `.husky/_/` already provides. Check `entire enable --help` for the current invocation — at the time of writing, the documented form is:

```bash
$ entire enable --agent <name>     # e.g. claude-code, codex, gemini-cli
```

This step is **intentionally NOT in `postCreateCommand`**. Pre-wiring tracked infrastructure for agents that aren't installed in the image was the PR #416 / #417 failure class (the publish-devcontainer CI job runs `docker build` only, so postCreateCommand never executes in CI — any agent-specific defect stays invisible until the first contributor rebuild). Each contributor wires whichever agents they actually use; skip the step entirely if you don't want agent-specific capture.

**Failure remediation**: if `entire login` fails with `permission denied` writing to `/home/vscode/.entire/`, the `onCreateCommand` chown did not run or did not target the entire mount path — same remediation as Scenario A.

### Enterprise overrides — GPG and `containerEnv` PAT injection

Two additional credential-forwarding mechanisms are permitted ONLY as explicitly documented uncommitted-local recipes (never tracked-config defaults), each requiring stakeholder approval per FR-007:

#### GPG / commit-signing forwarding

For contributors who must sign commits with a host GPG key:

```jsonc
// Uncommitted local addition to .devcontainer/devcontainer.json:
{
  "mounts": [
    // ... tracked entries ...
    "source=/run/user/${localEnv:UID}/gnupg,target=/run/user/1000/gnupg,type=bind"
  ],
  "containerEnv": {
    "GNUPGHOME": "/home/vscode/.gnupg"
  }
}
```

**Verification** after rebuild:

```bash
$ gpg --list-secret-keys --keyid-format LONG
sec   rsa4096/<KEY_ID> 2025-... [SC]
      <fingerprint>
uid                 [ultimate] <your-name> <your-email>
```

Stakeholder approval: confirm the org's commit-signing policy with your team lead before enabling this on shared hosts.

#### `containerEnv` PAT injection

Forwarding a host `GITHUB_TOKEN` (or equivalent) into the container env. This is the path that mirrors `gh`'s OAuth-without-browser model in fully headless / CI contexts.

```jsonc
// Uncommitted local addition to .devcontainer/devcontainer.json:
{
  "containerEnv": {
    "GITHUB_TOKEN": "${localEnv:GITHUB_TOKEN}"
  }
}
```

**Stakeholder approval REQUIRED** (XIX-adjacent risk per Constitution Check):

- The PAT becomes visible to every process inside the container via `env`.
- The PAT scope is whatever the host PAT has — often broader than what an interactive `gh auth login` would request.
- An audit log entry MUST accompany adoption (record approval timestamp, approver, intended use, and revocation timeline).

**Verification** after rebuild (intentionally non-destructive — does NOT reveal the token):

```bash
$ printenv GITHUB_TOKEN | wc -c
41           # if 0, the override did not take effect; if >0, the token is present
```

This path is `containerEnv` PAT injection, not the FR-005 named-volume `gh auth login` model. FR-005 is the default for a reason; this is an override of last resort.

---

## See also

- Spec: [`specs/364-devcontainer-refactor/spec.md`](../specs/364-devcontainer-refactor/spec.md) (FR-001 through FR-021 govern this README's content; FR-016 + FR-017 + FR-018 specifically govern the "What's IN / NOT in the image" and "Authentication and credentials" sections above).
- Contracts: [`specs/364-devcontainer-refactor/contracts/devcontainer.contract.md`](../specs/364-devcontainer-refactor/contracts/devcontainer.contract.md) (Contract 1 schema, Contract 3 named-volume failure modes, Contract 4 verification command set).
- Verifiers: [`./verify-contract.py`](./verify-contract.py) (Contract 1 static verification — Python script), [`./verify-contract-4c.sh`](./verify-contract-4c.sh) (Contract 4c integration — bash script using `devcontainer up`/`exec` against a test-isolated workspace).
- Constitution: [`.specify/memory/constitution.md`](../.specify/memory/constitution.md) (QG-7f governs the entire dispatcher-overwrite asymmetry; QG-35..56 govern local/CI parity invariants; QG-39 governs cross-platform multi-arch).
- Local/CI parity contract: [`LOCAL_CI_PARITY_INVARIANTS.md`](../LOCAL_CI_PARITY_INVARIANTS.md) (row 7f explicitly accepts entire's dispatcher-overwrite; row 33 governs gitleaks parity preserved by this refactor).
