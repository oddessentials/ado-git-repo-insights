from __future__ import annotations

import importlib.util
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
AUDIT_SCRIPT = REPO_ROOT / "scripts" / "audit-suppressions.py"

_spec = importlib.util.spec_from_file_location("audit_suppressions_smoke", AUDIT_SCRIPT)
assert _spec is not None
assert _spec.loader is not None
_audit_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_audit_module)

cmd_check_coverage = _audit_module.cmd_check_coverage


def test_real_repo_scope_coverage_smoke() -> None:
    """Real-repo smoke guard against scope/config drift."""
    assert cmd_check_coverage(REPO_ROOT) == 0
