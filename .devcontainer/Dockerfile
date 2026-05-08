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
# Pinned to match the @playwright/test version in extension/package.json
# so `playwright install-deps` resolves the same apt-package list across
# image rebuilds. Bump in lockstep when the extension bumps Playwright.
ARG PLAYWRIGHT_VERSION=1.59.1
# Official SHA256s from `gitleaks_${VERSION}_checksums.txt` published with
# the gitleaks GitHub release. Bump alongside GITLEAKS_VERSION; mismatched
# downloads fail the build at the `sha256sum -c` step.
ARG GITLEAKS_SHA256_AMD64=ba6dbb656933921c775ee5a2d1c13a91046e7952e9d919f9bac4cec61d628e7d
ARG GITLEAKS_SHA256_ARM64=bf5f7f466ebfade1296c8bd32cf7d3f592c2aa78836aa9980ffbe2cadca7a861
# Provided automatically by BuildKit/buildx; falls back to dpkg's own
# architecture name when invoked via plain `docker build` (no buildx).
# The case statement maps both Docker (amd64/arm64) and uname (x86_64/
# aarch64) names to gitleaks's release-asset suffixes.
ARG TARGETARCH

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
#
# Multi-arch: the amd64 (x86_64) and arm64 (aarch64) gitleaks tarballs are
# distinct binaries. We must select by build platform — Apple Silicon Mac
# / Linux ARM hosts default to a `linux/arm64` base image, where the
# `linux_x64` tarball would fail with "Exec format error" at the
# `gitleaks version` validation line.
#
# The download is tee'd to a temp file so we can verify the SHA256 against
# the upstream checksums file BEFORE extracting. Defense-in-depth: a
# corrupted or substituted release would fail the sha256sum check.
RUN set -eux; \
    ARCH="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    case "$ARCH" in \
        amd64|x86_64) GITLEAKS_ARCH="linux_x64"; GITLEAKS_SHA256="$GITLEAKS_SHA256_AMD64" ;; \
        arm64|aarch64) GITLEAKS_ARCH="linux_arm64"; GITLEAKS_SHA256="$GITLEAKS_SHA256_ARM64" ;; \
        *) echo "Unsupported architecture for gitleaks: $ARCH" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/gitleaks.tgz \
        "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${GITLEAKS_ARCH}.tar.gz"; \
    echo "${GITLEAKS_SHA256}  /tmp/gitleaks.tgz" | sha256sum -c -; \
    tar -xz -C /usr/local/bin -f /tmp/gitleaks.tgz gitleaks; \
    rm /tmp/gitleaks.tgz; \
    gitleaks version

# --- Repo-gate system tools ----------------------------------------------
# unzip: required by the VSIX artifact inspection test on Linux.
RUN apt-get update && apt-get install -y --no-install-recommends \
        unzip \
    && rm -rf /var/lib/apt/lists/*

# --- Playwright Chromium runtime libraries -------------------------------
# Use Playwright's own install-deps logic so the apt list stays in sync
# with each Playwright release. The `pnpm dlx` invocation pulls Playwright
# transiently into a cache; the package is not retained.
#
# Pinned to PLAYWRIGHT_VERSION (matching extension/package.json) so the
# image's apt-package set is reproducible — without the pin, `pnpm dlx`
# resolves to whatever Playwright is current at build time, drifting the
# system-deps list across image rebuilds. Bump PLAYWRIGHT_VERSION in
# lockstep with the extension's @playwright/test bump.
#
# Note: install-deps requires apt, runs as root, fetches no browser binary.
# The actual chromium-headless-shell download happens as part of the
# extension's `postinstall` step after the workspace is mounted.
RUN pnpm dlx "playwright@${PLAYWRIGHT_VERSION}" install-deps chromium \
    && rm -rf /var/lib/apt/lists/* /tmp/* \
    && rm -rf /root/.local/share/pnpm/store \
    && rm -rf /root/.cache/node

# --- Workspace location ---------------------------------------------------
# Microsoft devcontainer base mounts workspaces at /workspaces/<repo-name>.
# Pre-create the directory so non-root postCreateCommand has write access.
RUN mkdir -p /workspaces && chown vscode:vscode /workspaces
