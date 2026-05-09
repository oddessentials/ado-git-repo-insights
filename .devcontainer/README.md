# Dev container

This directory provisions a reproducible development environment that absorbs
the per-platform runtime + system-library variance native setups encounter
(Node major version selection, pnpm activation through Corepack, Python
3.12 as the canonical interpreter, Playwright's Chromium runtime libs,
gitleaks, unzip).

## Recommended use — Dev Containers extension

Open the repo in any IDE that supports the
[Dev Containers spec](https://containers.dev/) (VS Code with the
**Dev Containers** extension, JetBrains Gateway, etc.). The IDE handles
user mapping, `postCreateCommand`, port forwarding, and SSH-agent
forwarding automatically.

`devcontainer.json` declares `"remoteUser": "vscode"`. Microsoft's base
image creates `vscode` with `uid:gid 1000:1000`, which matches the
typical host user uid on Linux/macOS. Files written through the bind
mount end up owned by the host user — no root pollution.

## Container runtime — pick any

The dev container image is runtime-agnostic. Any
[Dev Containers-compatible runtime](https://containers.dev/supporting)
works:

- Docker Desktop (Mac, Windows, Linux)
- OrbStack (Mac)
- Rancher Desktop (cross-platform)
- Podman with Dev Containers integration

## Image source — GHCR by default

`devcontainer.json` references the multi-arch image published to GHCR by
the [`publish-devcontainer` CI job](../.github/workflows/ci.yml) on every
merge to `main`:

```
ghcr.io/oddessentials/ado-git-repo-insights-dev:main
```

Fresh clones pull this image (~30s on a warm cache) instead of building
locally (~5 min, ~849 MB compressed / 3.24 GB uncompressed). Both
`linux/amd64` and `linux/arm64` are published, so Apple Silicon hosts
get a native-arch image without QEMU emulation.

### When to fall back to a local build

Two scenarios require a local rebuild. Both involve editing
`devcontainer.json` in your local checkout — **do not commit** these
edits:

- **GHCR unreachable or the package is private** and you don't have
  pull access. VS Code will surface a clear pull error.
- **Iterating on `Dockerfile`** — the `:main` tag only reflects merged
  changes, so an in-progress Dockerfile edit will not appear there.

In either case, replace the `"image"` line with:

```jsonc
"build": { "dockerfile": "Dockerfile" }
```

and rebuild via the manual recipe below.

## Ad-hoc `docker run` verification — `--user` is mandatory

If you want to verify the container outside the IDE flow (debugging
a build issue, re-running gates manually), follow this pattern:

### Use a temp clone, never the live workspace

```bash
tmp_clone=$(mktemp -d /tmp/ado-verify-XXXXXX)
git clone --no-local /path/to/your/checkout "$tmp_clone"
git -C "$tmp_clone" checkout <branch>
```

Bind-mounting the live workspace into a container that runs as **root**
(Docker's default when `--user` is omitted) leaves root-owned files
scattered through your checkout — `node_modules/`, `.husky/_/`,
`extension/test-artifacts/`, `extension/playwright-report/`, etc. — and
your subsequent host-side `pnpm install` / `git commit` / preflight runs
fail with `EACCES` until you `sudo chown` them back. A temp clone
sidesteps this entirely: when verification finishes, `rm -rf "$tmp_clone"`
cleans up cleanly.

### Always pass `--user "$(id -u):$(id -g)"`

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "$tmp_clone":/workspaces/ado-git-repo-insights \
  -w /workspaces/ado-git-repo-insights \
  ado-git-repo-insights-dev:test \
  bash -lc 'git config --global --add safe.directory /workspaces/ado-git-repo-insights && \
            git config core.autocrlf false && \
            pnpm install --frozen-lockfile && \
            uv sync --locked --extra dev && \
            pnpm --dir extension install --frozen-lockfile && \
            <your gate command>'
```

`--user` makes the container process run as your host uid/gid. Anything
written through the bind mount is owned by you, not root. Microsoft's
Python base image already provisions `vscode` at uid 1000, so on the
typical Linux/macOS host `id -u` matches and the container behaves
identically to a real Dev Containers session.

The first line inside the shell — `git config --global --add safe.directory ...` —
is required because git refuses to operate on a checkout whose ownership
doesn't match the running uid. The bind mount preserves host ownership,
which `git` flags as "dubious" until you allowlist it. Inside an
ephemeral container, this is harmless.

## Build the image manually (fallback)

Use this when GHCR is unreachable or you are iterating on the
Dockerfile (see [When to fall back to a local build](#when-to-fall-back-to-a-local-build)):

```bash
docker build -t ado-git-repo-insights-dev:test -f .devcontainer/Dockerfile .devcontainer/
```

No build context is needed beyond the `.devcontainer/` directory itself —
the Dockerfile is self-contained.

## What's NOT in the image

- Repo Python deps (`numpy`, `pandas`, `ado_git_repo_insights`, etc.) —
  installed by `postCreateCommand` via `uv sync --locked --extra dev`.
- Node deps (`pnpm install` at root and in `extension/`) — same.
- The Playwright Chromium browser binary — downloaded by the extension's
  `postinstall` script, which runs as part of `pnpm --dir extension install`.

The image carries the deterministic *system* layer (interpreters, system
libraries, package managers); the project-specific layer is rebuilt on
each container creation so the image stays portable across branches.
