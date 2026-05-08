# Dev container image for ado-git-repo-insights.
#
# This image absorbs the per-platform runtime + system-library variance that
# native Linux/macOS/Windows setups all encounter (Node major version
# selection, pnpm activation through Corepack, Python 3.12 as the canonical
# interpreter, Playwright's Chromium runtime libs, gitleaks, unzip). It does
# NOT pre-install repo dependencies (`pnpm install`, `uv sync`, extension
# Playwright browser download) — those are run as `postCreateCommand` after
# the workspace is mounted, so the image stays portable across branches.

FROM mcr.microsoft.com/devcontainers/python:3.12-bookworm

# Pinned versions. Bump deliberately, never via "latest".
ARG UV_VERSION=0.11.9
ARG GITLEAKS_VERSION=8.18.4
ARG PNPM_VERSION=9.15.0

# --- Node.js 22 (NodeSource) ----------------------------------------------
# NodeSource is the canonical apt distribution channel for Node on Debian.
# We pin the major (22) here; the exact patch ships from NodeSource and
# tracks Node 22 LTS. Matches the `engines.node: ">=22"` field in
# `package.json` and the CI workflow's `node-version: '22'`.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && node --version

# --- pnpm 9.15.0 via Corepack ---------------------------------------------
# Matches the `packageManager: "pnpm@9.15.0"` field in root package.json.
# Corepack is shipped with Node 22 by default; we just enable + activate.
RUN corepack enable \
    && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
    && pnpm --version

# --- uv -------------------------------------------------------------------
# The base Python image ships pip but not uv. Repo's documented setup path
# is uv-driven (uv python install 3.12, uv sync --extra dev), so install
# explicitly. `install -m 0755` puts the binary on PATH for all users.
RUN curl -LsSf "https://astral.sh/uv/${UV_VERSION}/install.sh" | sh \
    && install -m 0755 /root/.local/bin/uv /usr/local/bin/uv \
    && install -m 0755 /root/.local/bin/uvx /usr/local/bin/uvx \
    && rm -rf /root/.local/bin/uv /root/.local/bin/uvx \
    && uv --version

# --- gitleaks ------------------------------------------------------------
# The Debian apt repo's gitleaks lags upstream by 2+ years; install the
# official release binary instead so the version is deterministic.
# Preflight fails closed if gitleaks is missing — no silent skip.
RUN curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
    | tar -xz -C /usr/local/bin gitleaks \
    && gitleaks version

# --- Repo-gate system tools ----------------------------------------------
# unzip: required by the VSIX artifact inspection test on Linux.
RUN apt-get update && apt-get install -y --no-install-recommends \
        unzip \
    && rm -rf /var/lib/apt/lists/*

# --- Playwright Chromium runtime libraries -------------------------------
# Use Playwright's own install-deps logic so the apt list stays in sync
# with each Playwright release. The `pnpm dlx` invocation pulls Playwright
# transiently into a cache; the package is not retained.
# Note: install-deps requires apt, runs as root, fetches no browser binary.
# The actual chromium-headless-shell download happens as part of the
# extension's `postinstall` step after the workspace is mounted.
RUN pnpm dlx playwright install-deps chromium \
    && rm -rf /var/lib/apt/lists/* /tmp/* \
    && rm -rf /root/.local/share/pnpm/store \
    && rm -rf /root/.cache/node

# --- Workspace location ---------------------------------------------------
# Microsoft devcontainer base mounts workspaces at /workspaces/<repo-name>.
# Pre-create the directory so non-root postCreateCommand has write access.
RUN mkdir -p /workspaces && chown vscode:vscode /workspaces
