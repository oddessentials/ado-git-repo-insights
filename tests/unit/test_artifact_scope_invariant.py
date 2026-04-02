"""Verify manage_generated_artifacts.py scope invariants.

The sdk scope must not be a silent no-op while any hook or script
may invoke it. After the VSS SDK migration it bridges to the ui
scope (build_ui + sync_ui_bundle) so artifact staging still works.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def test_sdk_scope_is_not_a_noop():
    """The sdk scope must do real work (bridge to ui), not silently no-op."""
    content = (REPO_ROOT / "scripts" / "manage_generated_artifacts.py").read_text(
        encoding="utf-8"
    )

    # Find the sdk ScopeConfig block and verify it has build_ui=True
    # (the bridge to ui scope). A no-op would have build_ui=False
    # and empty stage_paths/verify_paths.
    assert '"sdk"' in content, "sdk scope not found in manage_generated_artifacts.py"

    # Extract the sdk scope config block (between "sdk": ScopeConfig and the next scope)
    sdk_start = content.index('"sdk"')
    sdk_block = content[sdk_start : sdk_start + 500]

    assert "build_ui=True" in sdk_block, (
        "sdk scope has build_ui=False — this is a silent no-op. "
        "If the scope still exists, it must bridge to ui sync."
    )


def test_run_repo_hook_does_not_invoke_scope_sdk():
    """run_repo_hook.py must not call --scope sdk directly."""
    content = (REPO_ROOT / "scripts" / "run_repo_hook.py").read_text(encoding="utf-8")

    # The hook runner should not contain the exact invocation pattern
    assert '"sdk"' not in content or "scope" not in content, (
        "run_repo_hook.py still invokes --scope sdk. "
        "Remove the invocation — the sdk scope is a bridge only."
    )
