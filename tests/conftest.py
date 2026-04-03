"""Root test conftest — platform-conditional collection and shared typed doubles.

Excludes Windows-only test files from collection on non-Windows
platforms so they are never counted as skipped (CI zero-skip policy).

The documented local entrypoint (scripts/run_pytest.py) isolates coverage via
``COVERAGE_FILE`` before pytest starts. Plain local pytest runs intentionally
use pytest's default basetemp handling because overriding basetemp inside the
repo triggers Windows teardown failures during session finish.

Typed ModuleType subclasses (FakeProphetModule, FakeOpenAIModule) declare
attributes that bare ModuleType lacks, eliminating type: ignore[attr-defined]
when assigning mock objects to fake module attributes. See research.md R-006.
"""

import sys
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock

_REPO_ROOT = Path(__file__).resolve().parent.parent
_TMP_ROOT = _REPO_ROOT / ".tmp" / "pytest"

# Ensure the static bare-pytest coverage fallback directory exists.
(_TMP_ROOT / "coverage").mkdir(parents=True, exist_ok=True)


collect_ignore_glob: list[str] = []

if sys.platform != "win32":
    collect_ignore_glob.append("**/test_*_windows.py")


class FakeProphetModule(ModuleType):
    """Typed fake for the ``prophet`` module — declares ``Prophet`` attribute."""

    Prophet: MagicMock


class FakeOpenAIModule(ModuleType):
    """Typed fake for the ``openai`` module — declares ``OpenAI`` attribute."""

    OpenAI: MagicMock
