"""Canonical version resolver. Single source of truth for all version reporting.

All version access across the package MUST delegate to resolve_version().
Do not add version logic elsewhere.
"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Repo-root VERSION file relative to this module's location.
# utils/ -> ado_git_repo_insights/ -> src/ -> repo_root/
_REPO_VERSION_FILE = Path(__file__).parent.parent.parent.parent / "VERSION"


def resolve_version() -> str:
    """Resolve the package version using strict precedence.

    Precedence contract:
    1. If running from a source checkout (VERSION file exists at repo root)
       AND installed metadata is absent or stale: use VERSION file.
    2. If installed metadata is present and not overridden: use metadata.
    3. If neither is available: return "unknown (dev)" and log a warning.

    "Stale" means the metadata base version (stripping .devN+gHASH suffixes)
    differs from the VERSION file content, indicating the editable install has
    not been refreshed since the checkout changed (e.g., branch switch, tag bump).
    """
    metadata_version = _read_metadata_version()
    repo_version = _read_repo_version()

    if repo_version:
        # Running from a source checkout
        if not metadata_version:
            return repo_version
        if _is_metadata_stale(metadata_version, repo_version):
            return repo_version
        return metadata_version

    if metadata_version:
        return metadata_version

    logger.warning(
        "Package metadata not found. Version will report as 'unknown (dev)'. "
        "Run: pip install -e ."
    )
    return "unknown (dev)"


def _read_metadata_version() -> str | None:
    """Read version from installed package metadata, or None."""
    try:
        from importlib.metadata import PackageNotFoundError, version

        return version("ado-git-repo-insights")
    except PackageNotFoundError:
        return None


def _read_repo_version() -> str | None:
    """Read version from repo-root VERSION file, or None."""
    if _REPO_VERSION_FILE.exists():
        content = _REPO_VERSION_FILE.read_text().strip()
        if content:
            return content
    return None


def _is_metadata_stale(metadata_version: str, repo_version: str) -> bool:
    """Check if metadata version is stale relative to repo VERSION.

    Compares base versions only (stripping .devN+gHASH suffixes).

    Version contract: resolve_version() provides semantic version identity.
    The +gHASH local segment (PEP 440) is informational and MUST NOT be
    treated as authoritative commit identity by any consumer. Commit
    identity is always sourced from get_git_sha() in run_summary.py,
    which calls git rev-parse HEAD directly.

    When base versions match (e.g., metadata 5.28.1.dev2+gOLDHASH vs
    VERSION 5.28.1), metadata is considered fresh and returned as-is.
    The +gOLDHASH suffix may reference a prior commit within the same
    release cycle. This is by design.
    """
    # Extract base: "5.27.2.dev89+g3bf5b3ba7" -> "5.27.2"
    base = metadata_version.split(".dev")[0].split("+")[0]
    repo_base = repo_version.split(".dev")[0].split("+")[0]
    return base != repo_base
