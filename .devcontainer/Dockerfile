# Dev container image for ado-git-repo-insights.
#
# This image absorbs the per-platform runtime + system-library variance that
# native Linux/macOS/Windows setups all encounter (Python 3.12 as the canonical
# interpreter, Playwright's Chromium runtime libs, gitleaks, unzip, the GitHub
# CLI, GitHub Spec Kit, and the entire.io git-observability CLI).
#
# **Important — Dev Containers-ready base, not a standalone testable image.**
# Per FR-009 (spec 364-devcontainer-refactor), Node.js and pnpm are NOT in this
# image. They are provided by the Dev Container Feature
# (`ghcr.io/devcontainers/features/node`) at devcontainer-up time and the
# Corepack activation in `postCreateCommand` (per FR-021). Running
# `docker run` against the raw image and expecting `node` / `pnpm` to work is
# NOT a supported path — only the Dev Containers lifecycle produces the full
# development environment.
#
# This image does NOT pre-install repo dependencies (`pnpm install`,
# `uv sync`, extension Playwright browser download) — those run as
# `postCreateCommand` after the workspace is mounted, so the image stays
# portable across branches.

FROM mcr.microsoft.com/devcontainers/python:3.12-bookworm

# Pinned versions. Bump deliberately, never via "latest".
ARG UV_VERSION=0.11.9
ARG GITLEAKS_VERSION=8.18.4
# Pinned to match the @playwright/test version in extension/package.json
# so `playwright install-deps` resolves the same apt-package list across
# image rebuilds. Bump in lockstep when the extension bumps Playwright.
ARG PLAYWRIGHT_VERSION=1.60.0
# Official SHA256s from `gitleaks_${VERSION}_checksums.txt` published with
# the gitleaks GitHub release. Bump alongside GITLEAKS_VERSION; mismatched
# downloads fail the build at the `sha256sum -c` step.
ARG GITLEAKS_SHA256_AMD64=ba6dbb656933921c775ee5a2d1c13a91046e7952e9d919f9bac4cec61d628e7d
ARG GITLEAKS_SHA256_ARM64=bf5f7f466ebfade1296c8bd32cf7d3f592c2aa78836aa9980ffbe2cadca7a861

# GitHub CLI (FR-001). Apt-installed via signed keyring from cli.github.com
# with apt-mark hold to prevent future apt-get upgrade drift. The exact
# version string must match what cli.github.com publishes for both arches;
# D-1b verifies multi-arch availability at PR time.
ARG GH_VERSION=2.93.0

# GitHub Spec Kit (FR-002). Installed via `uv tool install` from an immutable
# git commit pin against github.com/github/spec-kit. Version 0.9.2 is NOT on
# public PyPI — only available as the git tag v0.9.2. SPECKIT_COMMIT must
# match the dereferenced commit of the tag (D-3a verifies).
ARG SPECKIT_VERSION=0.9.2
ARG SPECKIT_COMMIT=c3194c543b53c67e85d996fe90bc1b26813b0e3b

# entire.io CLI (FR-020). SHA256-verified GitHub release-binary install
# (gitleaks-equivalent pattern) — entire.io's install.sh is disqualified by
# D-1d for lack of version-pin support. SHA256 values come from
# https://github.com/entireio/cli/releases/download/v${ENTIRE_VERSION}/checksums.txt
ARG ENTIRE_VERSION=0.7.3
ARG ENTIRE_SHA256_AMD64=a9a3710855f65726aeec2e5cd55ed3979d883f49a217c5469f1192c9816a9a9d
ARG ENTIRE_SHA256_ARM64=e5e6fee7304b220496af8ac2158ad3bb550958fcade75168e75fc0df6295508e

# Provided automatically by BuildKit/buildx; falls back to dpkg's own
# architecture name when invoked via plain `docker build` (no buildx).
# The case statements below map both Docker (amd64/arm64) and uname
# (x86_64/aarch64) names to per-tool release-asset suffixes.
ARG TARGETARCH

# --- Node.js & pnpm: PROVIDED BY DEV CONTAINER LIFECYCLE, NOT THIS IMAGE -----
# Node 22 arrives via ghcr.io/devcontainers/features/node (digest-pinned in
# devcontainer.json). pnpm 9.15.0 arrives via Corepack activation as the FIRST
# step of postCreateCommand (per FR-021, fail-closed validation against the
# pinned `packageManager` field in root package.json). Do not add Node or
# pnpm install steps here — the previous NodeSource + Corepack RUN blocks were
# removed per FR-003 + FR-021 (Corepack requires Node, which Features install
# at devcontainer-up time, not image-build time).

# --- uv -----------------------------------------------------------------------
# The base Python image ships pip but not uv. Repo's documented setup path
# is uv-driven (uv python install 3.12, uv sync --extra dev), so install
# explicitly. `install -m 0755` puts the binary on PATH for all users.
RUN curl -LsSf "https://astral.sh/uv/${UV_VERSION}/install.sh" | sh \
    && install -m 0755 /root/.local/bin/uv /usr/local/bin/uv \
    && install -m 0755 /root/.local/bin/uvx /usr/local/bin/uvx \
    && rm -rf /root/.local/bin/uv /root/.local/bin/uvx \
    && uv --version

# --- GitHub Spec Kit (specify) ------------------------------------------------
# FR-002: Install from an immutable git commit pin (NOT PyPI — version 0.9.2
# is not published to PyPI). `uv tool install` with explicit UV_TOOL_DIR +
# UV_TOOL_BIN_DIR puts the entrypoint at /usr/local/bin so it's accessible to
# the vscode user without symlink gymnastics. The Dockerfile's specify pin
# (SPECKIT_VERSION + SPECKIT_COMMIT) must match `.specify/init-options.json`
# co-committed with this Dockerfile (FR-002 co-commit invariant).
RUN UV_TOOL_DIR=/opt/uv-tools UV_TOOL_BIN_DIR=/usr/local/bin \
        uv tool install \
            "specify-cli @ git+https://github.com/github/spec-kit.git@${SPECKIT_COMMIT}" \
    && installed="$(specify --version 2>&1 | awk '{print $NF}')" \
    && [ "$installed" = "${SPECKIT_VERSION}" ] \
       || { echo "specify version mismatch: got '$installed', expected '${SPECKIT_VERSION}'" >&2; exit 1; }

# --- GitHub CLI (gh) ----------------------------------------------------------
# FR-001: Install via cli.github.com apt repository with signed keyring,
# pinned version, and apt-mark hold to prevent future apt-get upgrade drift.
# Chosen over the Dev Container Feature for stronger determinism + auditability
# (E-1 decision, research.md). D-1b confirmed gh ${GH_VERSION} is published
# for both linux/amd64 and linux/arm64 by the apt repo.
RUN install -m 0755 -d /usr/share/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod a+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh="${GH_VERSION}*" \
    && apt-mark hold gh \
    && rm -rf /var/lib/apt/lists/* \
    && installed="$(gh --version | awk '/^gh version/ {print $3}')" \
    && [ "$installed" = "${GH_VERSION}" ] \
       || { echo "gh version mismatch: got '$installed', expected '${GH_VERSION}'" >&2; exit 1; }

# --- gitleaks ----------------------------------------------------------------
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

# --- entire.io CLI ------------------------------------------------------------
# FR-020: SHA256-verified GitHub release-binary install (same defense-in-depth
# pattern as gitleaks above). entire.io's install.sh is disqualified per D-1d
# (no version pinning — script always queries GitHub /releases/latest).
#
# Multi-arch: amd64 (x86_64) and arm64 (aarch64) entire tarballs are distinct
# binaries. SHA256s come from
# https://github.com/entireio/cli/releases/download/v${ENTIRE_VERSION}/checksums.txt
# Bump SHA256 ARGs in lockstep with ENTIRE_VERSION; mismatched downloads fail
# the build at the `sha256sum -c` step.
RUN set -eux; \
    ARCH="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    case "$ARCH" in \
        amd64|x86_64) ENTIRE_ARCH="amd64"; ENTIRE_SHA256="$ENTIRE_SHA256_AMD64" ;; \
        arm64|aarch64) ENTIRE_ARCH="arm64"; ENTIRE_SHA256="$ENTIRE_SHA256_ARM64" ;; \
        *) echo "Unsupported architecture for entire: $ARCH" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/entire.tgz \
        "https://github.com/entireio/cli/releases/download/v${ENTIRE_VERSION}/entire_linux_${ENTIRE_ARCH}.tar.gz"; \
    echo "${ENTIRE_SHA256}  /tmp/entire.tgz" | sha256sum -c -; \
    tar -xz -C /usr/local/bin -f /tmp/entire.tgz entire; \
    rm /tmp/entire.tgz; \
    chmod 755 /usr/local/bin/entire; \
    installed="$(entire --version 2>&1 | awk '{print $NF}')"; \
    [ "$installed" = "${ENTIRE_VERSION}" ] \
       || { echo "entire version mismatch: got '$installed', expected '${ENTIRE_VERSION}'" >&2; exit 1; }

# --- Repo-gate system tools --------------------------------------------------
# unzip: required by the VSIX artifact inspection test on Linux.
RUN apt-get update && apt-get install -y --no-install-recommends \
        unzip \
    && rm -rf /var/lib/apt/lists/*

# --- Playwright Chromium runtime libraries -----------------------------------
# Install Playwright's required apt packages so smoke tests have the runtime
# libs available. Playwright's `install-deps` subcommand emits a curated apt
# package list that matches each Playwright release — pinning to
# PLAYWRIGHT_VERSION (which mirrors `extension/package.json::@playwright/test`)
# keeps the apt-package set reproducible across image rebuilds.
#
# Tension with FR-009 ("Dev Containers-ready base, not standalone testable
# image" — Node ships only via the Feature at devcontainer-up time):
# `pnpm dlx playwright install-deps` requires Node + pnpm at the moment the
# command runs. We can't borrow them from the Feature because Features apply
# AFTER the image build.
#
# Resolution: install Node TEMPORARILY for this one build-time step, run
# install-deps, then fully purge Node + its NodeSource apt source list +
# pnpm/npm/Corepack caches. The end-state image has Chromium's apt deps but
# no Node binary, no NodeSource apt source, no Corepack/pnpm artifacts —
# satisfying FR-009 ("Node arrives at devcontainer-up via Feature") while
# preserving the existing Playwright deps reproducibility pattern.
#
# Note: install-deps fetches no browser binary. The actual
# chromium-headless-shell download happens in the extension's `postinstall`
# step after the workspace is mounted (post-lifecycle).
RUN set -eux; \
    # Install temporary Node + pnpm for the Playwright install-deps call. \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -; \
    apt-get install -y --no-install-recommends nodejs; \
    corepack enable; \
    corepack prepare "pnpm@9.15.0" --activate; \
    # Run Playwright's own install-deps so apt list tracks the Playwright pin. \
    pnpm dlx "playwright@${PLAYWRIGHT_VERSION}" install-deps chromium; \
    # Purge temporary Node + NodeSource apt source list + pnpm/npm caches so \
    # the end-state image has no Node, per FR-009. \
    apt-get purge -y --auto-remove nodejs; \
    rm -rf /etc/apt/sources.list.d/nodesource.list \
           /etc/apt/keyrings/nodesource.gpg \
           /usr/share/keyrings/nodesource.gpg \
           /var/lib/apt/lists/* \
           /tmp/* \
           /root/.local/share/pnpm \
           /root/.cache/node \
           /root/.npm; \
    # Sanity-check: no Node binary on PATH; Playwright's runtime libs ARE present. \
    if command -v node >/dev/null 2>&1; then \
      echo "FATAL: Node leaked into final image (FR-009 violation)" >&2; \
      exit 1; \
    fi; \
    dpkg -l libnss3 >/dev/null 2>&1 || { echo "FATAL: Playwright apt deps missing" >&2; exit 1; }

# --- Workspace location -------------------------------------------------------
# Microsoft devcontainer base mounts workspaces at /workspaces/<repo-name>.
# Pre-create the directory so non-root postCreateCommand has write access.
RUN mkdir -p /workspaces && chown vscode:vscode /workspaces
