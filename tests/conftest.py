"""Root test conftest — platform-conditional collection and shared typed doubles.

Excludes Windows-only test files from collection on non-Windows
platforms so they are never counted as skipped (CI zero-skip policy).
The glob patterns come from :mod:`scripts._platform_test_filters` so
this conftest and :mod:`scripts.check_ratchet_bump` share one source of
truth — a drift between them would make the ratchet-bump gate's
"cross-platform minimum" diverge from what pytest actually collects on
Linux/macOS. The shared constant is enforced by
``tests/unit/test_platform_conditional_collection.py``.

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
from typing import TYPE_CHECKING
from unittest.mock import MagicMock

if TYPE_CHECKING:
    # mypy resolves the helper under its top-level name via
    # pyproject.toml ``mypy_path = ["scripts"]``. Using the bare name
    # here avoids the "source file found twice" dual-name error that
    # ``from scripts._platform_test_filters import ...`` would
    # otherwise trigger when mypy walks both this file AND
    # ``scripts/_platform_test_filters.py``.
    from _platform_test_filters import PLATFORM_CONDITIONAL_IGNORE_GLOBS
else:
    # Runtime: ``scripts`` is an importable PEP 420 namespace package
    # from the project root. The dotted form is what pytest actually
    # executes when it loads this conftest during collection.
    from scripts._platform_test_filters import PLATFORM_CONDITIONAL_IGNORE_GLOBS

_REPO_ROOT = Path(__file__).resolve().parent.parent
_TMP_ROOT = _REPO_ROOT / ".tmp" / "pytest"

# Ensure the static bare-pytest coverage fallback directory exists.
(_TMP_ROOT / "coverage").mkdir(parents=True, exist_ok=True)


collect_ignore_glob: list[str] = []

if sys.platform != "win32":
    collect_ignore_glob.extend(PLATFORM_CONDITIONAL_IGNORE_GLOBS)


class FakeProphetModule(ModuleType):
    """Typed fake for the ``prophet`` module — declares ``Prophet`` attribute."""

    Prophet: MagicMock


class FakeOpenAIModule(ModuleType):
    """Typed fake for the ``openai`` module — declares ``OpenAI`` attribute."""

    OpenAI: MagicMock
