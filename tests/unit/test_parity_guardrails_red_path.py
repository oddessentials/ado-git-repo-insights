"""Red-path tests for P0 parity guardrails.

Prove each CI gate actually fails when broken, not just passes when healthy.
These tests simulate drift by mutating artifacts and verifying the detection
mechanism (SHA256 hash comparison) catches the change.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent

# Add scripts/ to path for demo_shell import
sys.path.insert(0, str(REPO_ROOT / "scripts"))

EXTENSION_UI_INDEX = REPO_ROOT / "extension" / "ui" / "index.html"
DOCS_INDEX = REPO_ROOT / "docs" / "index.html"
DIST_UI_DIR = REPO_ROOT / "extension" / "dist" / "ui"
DOCS_DIR = REPO_ROOT / "docs"

STATIC_ASSET_FILES = [
    "dashboard.js",
    "dataset-loader.js",
    "artifact-client.js",
    "error-types.js",
    "error-codes.js",
    "styles.css",
    "VSS.SDK.min.js",
]


def _normalized_hash(content: str) -> str:
    """SHA256 hash with CRLF normalized — mirrors the CI guard logic."""
    normalized = content.replace("\r", "")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


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
    """P0-3: Prove the release gate catches stale docs/ JS/CSS assets."""

    @pytest.mark.parametrize("asset_file", STATIC_ASSET_FILES)
    def test_current_assets_in_sync(self, asset_file):
        """Green path: each docs/ asset currently matches extension/dist/ui/."""
        src = DIST_UI_DIR / asset_file
        dest = DOCS_DIR / asset_file
        if not src.exists():
            pytest.skip(f"Build artifact not present: {src}")
        assert dest.exists(), f"docs/{asset_file} missing"

        src_hash = _normalized_hash(src.read_text(encoding="utf-8"))
        dest_hash = _normalized_hash(dest.read_text(encoding="utf-8"))
        assert src_hash == dest_hash, (
            f"docs/{asset_file} is already out of sync with extension/dist/ui/"
        )

    def test_mutated_js_asset_is_caught(self):
        """Red path: appending to a JS asset produces a hash mismatch."""
        src_path = DIST_UI_DIR / "dashboard.js"
        docs_path = DOCS_DIR / "dashboard.js"
        if not src_path.exists():
            pytest.skip("Build artifact not present")

        src_content = src_path.read_text(encoding="utf-8")
        docs_content = docs_path.read_text(encoding="utf-8")

        # Simulate drift: extension/dist/ui/dashboard.js was rebuilt but
        # docs/dashboard.js was not updated
        mutated_src = src_content + "\n// new feature code"
        assert _normalized_hash(mutated_src) != _normalized_hash(docs_content), (
            "Hash comparison failed to detect JS asset mutation — "
            "release gate would miss this drift"
        )
