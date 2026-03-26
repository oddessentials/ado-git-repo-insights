"""Red-path tests for P0 parity guardrails.

Prove each CI gate actually fails when broken, not just passes when healthy.
These tests simulate drift by mutating artifacts and verifying the detection
mechanism (SHA256 hash comparison) catches the change.

Transitive coverage model:
  dist/ui ↔ ui_bundle   (CI: ui-bundle-sync job rebuilds + git diff)
  ui_bundle ↔ docs      (these tests)
  ∴ dist/ui ↔ docs      (transitive)
"""

from __future__ import annotations

import hashlib
import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent

# Add scripts/ to path for demo_shell import
sys.path.insert(0, str(REPO_ROOT / "scripts"))

# Import the canonical asset list from the single source of truth
_spec = importlib.util.spec_from_file_location(
    "publish_demo_surface", REPO_ROOT / "scripts" / "publish-demo-surface.py"
)
assert _spec
assert _spec.loader
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
STATIC_ASSET_FILES: list[str] = _mod.STATIC_ASSET_FILES

EXTENSION_UI_INDEX = REPO_ROOT / "extension" / "ui" / "index.html"
DOCS_INDEX = REPO_ROOT / "docs" / "index.html"
UI_BUNDLE_DIR = REPO_ROOT / "src" / "ado_git_repo_insights" / "ui_bundle"
DOCS_DIR = REPO_ROOT / "docs"


def _normalized_hash(content: str) -> str:
    """SHA256 hash with CRLF normalized — mirrors the CI guard logic."""
    normalized = content.replace("\r", "")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


class TestAssetListSanity:
    """Guard against empty or corrupted asset allowlist."""

    def test_static_asset_files_is_non_empty(self):
        assert STATIC_ASSET_FILES, "STATIC_ASSET_FILES allowlist must not be empty"


class TestHtmlTemplateDriftDetection:
    """P0-1: Prove the docs/index.html CI guard catches template drift."""

    def test_current_docs_matches_transformation(self):
        """Green path: docs/index.html currently matches demo_shell.py output."""
        from demo_shell import render_demo_html_from_path

        expected = render_demo_html_from_path(EXTENSION_UI_INDEX)
        actual = DOCS_INDEX.read_text(encoding="utf-8")
        assert _normalized_hash(expected) == _normalized_hash(actual), (
            "docs/index.html is already out of sync — run publish-demo-surface.py"
        )

    def test_mutated_template_is_caught(self):
        """Red path: injecting content into the template produces a hash mismatch."""
        from demo_shell import render_demo_html_from_path

        expected = render_demo_html_from_path(EXTENSION_UI_INDEX)
        actual = DOCS_INDEX.read_text(encoding="utf-8")

        # Simulate drift: a developer changes the source template
        mutated = expected.replace("</body>", "<div>UNSYNCED CHANGE</div></body>")
        assert _normalized_hash(mutated) != _normalized_hash(actual), (
            "Hash comparison failed to detect HTML template mutation — "
            "CI guard would miss this drift"
        )


class TestDocsAssetDriftDetection:
    """P0-3: Prove the release gate catches stale docs/ JS/CSS assets.

    Tests ui_bundle ↔ docs parity. The dist/ui ↔ ui_bundle link is verified
    separately by CI's ui-bundle-sync job (ci.yml "Check UI Bundle Synchronization").
    """

    @pytest.mark.parametrize("asset_file", STATIC_ASSET_FILES)
    def test_current_assets_in_sync(self, asset_file):
        """Green path: each docs/ asset matches ui_bundle/."""
        src = UI_BUNDLE_DIR / asset_file
        dest = DOCS_DIR / asset_file

        assert src.exists(), f"ui_bundle/{asset_file} missing"
        assert dest.exists(), f"docs/{asset_file} missing"
        assert src.stat().st_size > 0, f"ui_bundle/{asset_file} is empty"
        assert dest.stat().st_size > 0, f"docs/{asset_file} is empty"

        src_hash = _normalized_hash(src.read_text(encoding="utf-8"))
        dest_hash = _normalized_hash(dest.read_text(encoding="utf-8"))
        assert src_hash == dest_hash, (
            f"docs/{asset_file} is out of sync with ui_bundle/{asset_file}"
        )

    def test_mutated_js_asset_is_caught(self):
        """Red path: appending to a JS asset produces a hash mismatch."""
        src_path = UI_BUNDLE_DIR / "dashboard.js"
        docs_path = DOCS_DIR / "dashboard.js"

        assert src_path.stat().st_size > 0, "ui_bundle/dashboard.js is empty"

        src_content = src_path.read_text(encoding="utf-8")
        docs_content = docs_path.read_text(encoding="utf-8")

        mutated_src = src_content + "\n// new feature code"
        assert _normalized_hash(mutated_src) != _normalized_hash(docs_content), (
            "Hash comparison failed to detect JS asset mutation — "
            "release gate would miss this drift"
        )
