"""Deterministic UI bundle synchronization for local dashboard.

This module provides content-addressed sync from extension/dist/ui/ to ui_bundle/
with atomic replacement and proper rollback on failure.

Dev mode is detected by walking ancestors of THIS module's installed location
looking for extension/package.json. The walk aborts the moment it crosses a
site-packages or dist-packages directory: a marker found above that boundary
belongs to a checkout that happens to contain the venv, not to the source the
package was built from. Only true editable installs (where __file__ resolves
into the source tree above any install boundary) trigger dev mode. The user's
CWD is intentionally NOT consulted.
"""

from __future__ import annotations

import hashlib
import logging
import shutil
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import uuid4

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# Only sync these file types - ignore everything else
ALLOWED_EXTENSIONS = {".js", ".css", ".html"}

# Required entrypoints that must exist for a valid dist
REQUIRED_ENTRYPOINTS = {"index.html", "dashboard.js"}


class SyncError(Exception):
    """UI bundle sync failed."""


def is_dev_mode() -> tuple[bool, Path | None]:
    """Detect if running from a repository checkout (dev mode).

    Walks ancestors of this module's installed location looking for
    extension/package.json. The walk stops at any site-packages or
    dist-packages directory: a marker found above that boundary belongs to
    a checkout that merely contains the venv, not to the source the package
    was built from. This handles the case where a customer creates their
    venv inside a directory that happens to also contain a source checkout.

    Only true editable installs — where __file__ resolves into the source
    tree above any install boundary — trigger dev mode. The current working
    directory is intentionally NOT used as a search anchor.

    Returns:
        (True, repo_root) if dev mode detected (editable install in checkout)
        (False, None) if running as installed package
    """
    module_anchor = Path(__file__).resolve().parent

    for parent in [module_anchor, *module_anchor.parents]:
        if parent.name.lower() in ("site-packages", "dist-packages"):
            return False, None
        marker = parent / "extension" / "package.json"
        if marker.exists():
            return True, parent

    return False, None


def compute_manifest(directory: Path) -> dict[str, str]:
    """Build content manifest: {relative_path: sha256_hash}.

    Only includes files with allowed extensions.
    """
    manifest: dict[str, str] = {}

    if not directory.exists():
        return manifest

    for file_path in directory.rglob("*"):
        if not file_path.is_file():
            continue
        if file_path.suffix.lower() not in ALLOWED_EXTENSIONS:
            continue

        rel_path = file_path.relative_to(directory)
        content = file_path.read_bytes()
        file_hash = hashlib.sha256(content).hexdigest()
        manifest[str(rel_path)] = file_hash

    return manifest


def sync_needed(source: Path, target: Path) -> bool:
    """Check if sync is needed based on content hashes.

    Returns True if source and target have different content.
    """
    source_manifest = compute_manifest(source)
    target_manifest = compute_manifest(target)
    return source_manifest != target_manifest


def validate_dist(dist_path: Path) -> None:
    """Validate that dist directory has all required entrypoints.

    Raises:
        SyncError: If dist is missing or incomplete.
    """
    if not dist_path.exists():
        raise SyncError(
            f"extension/dist/ui not found at {dist_path}. "
            f"Run 'npm run build:ui' in extension/"
        )

    for entry in REQUIRED_ENTRYPOINTS:
        if not (dist_path / entry).exists():
            raise SyncError(
                f"Dist is incomplete: missing {entry}. "
                f"Run 'npm run build:ui' in extension/"
            )


def _copy_with_hash(source: Path, temp: Path) -> dict[str, str]:
    """Copy allowed files from source to temp, computing hashes inline.

    Returns manifest of copied files.
    """
    manifest: dict[str, str] = {}

    for src_file in source.rglob("*"):
        if not src_file.is_file():
            continue
        if src_file.suffix.lower() not in ALLOWED_EXTENSIONS:
            continue

        rel_path = src_file.relative_to(source)
        dst_file = temp / rel_path

        # Create parent directories
        dst_file.parent.mkdir(parents=True, exist_ok=True)

        # Read, hash, and write in one pass
        content = src_file.read_bytes()
        dst_file.write_bytes(content)
        manifest[str(rel_path)] = hashlib.sha256(content).hexdigest()

    return manifest


def _atomic_replace(temp: Path, target: Path) -> None:
    """Cross-platform atomic directory replacement with rollback.

    Algorithm:
    1. Remove any stale backup
    2. Move target to backup (if exists)
    3. Move temp to target
    4. Remove backup on success

    On any failure after step 2, restores backup to target.
    """
    backup = target.parent / f"{target.name}.backup"

    # Clean up any stale backup from previous failed sync
    if backup.exists():
        shutil.rmtree(backup)

    target_existed = target.exists()

    try:
        # Step 1: Move target to backup (if exists)
        if target_existed:
            shutil.move(str(target), str(backup))

        # Step 2: Move temp to target
        shutil.move(str(temp), str(target))

        # Step 3: Remove backup on success
        if backup.exists():
            shutil.rmtree(backup)

    except Exception as e:
        # ROLLBACK: Restore backup if swap failed
        if backup.exists() and not target.exists():
            try:
                shutil.move(str(backup), str(target))
            except Exception as restore_error:
                logger.error(f"Failed to restore backup: {restore_error}")

        # Clean up temp if it still exists
        if temp.exists():
            try:
                shutil.rmtree(temp)
            except Exception as cleanup_err:
                logger.debug(f"Failed to clean up temp during rollback: {cleanup_err}")

        raise SyncError(
            f"UI sync failed during atomic swap: {e}. "
            f"Check file permissions and disk space."
        ) from e


def sync_ui_bundle(source: Path, target: Path) -> dict[str, str]:
    """Atomically sync UI bundle from source to target.

    1. Validates source has required entrypoints
    2. Copies files to temp directory with inline hashing
    3. Atomically swaps temp with target
    4. Rolls back on any failure

    Args:
        source: Path to extension/dist/ui
        target: Path to ui_bundle

    Returns:
        Manifest of synced files {path: hash}

    Raises:
        SyncError: If validation, copy, or swap fails.
    """
    # Validate source is complete
    validate_dist(source)

    # Create temp directory next to target for atomic rename
    temp = target.parent / f"{target.name}.tmp.{uuid4().hex[:8]}"

    try:
        # Copy with inline hashing
        manifest = _copy_with_hash(source, temp)

        if not manifest:
            raise SyncError(
                f"No valid UI files found in {source}. "
                f"Run 'npm run build:ui' in extension/"
            )

        # Atomic swap
        _atomic_replace(temp, target)

        return manifest

    except SyncError:
        raise
    except Exception as e:
        # Clean up temp on any error
        if temp.exists():
            try:
                shutil.rmtree(temp)
            except Exception as cleanup_err:
                logger.debug(f"Failed to clean up temp: {cleanup_err}")
        raise SyncError(f"UI sync failed: {e}") from e
