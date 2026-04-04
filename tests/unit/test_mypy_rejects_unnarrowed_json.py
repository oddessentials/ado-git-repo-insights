"""Prove mypy rejects direct JSONValue access without narrowing.

Runs mypy on a deliberately bad fixture file and asserts it produces
the expected union-attr error.  This locks in the cross-file enforcement:
if someone reverts the mypy config (re-adds ignore_missing_imports or
removes mypy_path), the fixture would pass under Any and this test fails.
"""

from __future__ import annotations

import subprocess
import sys
import textwrap
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_mypy_rejects_chained_get_on_json_value(tmp_path: Path) -> None:
    """A file that chains .get() on load_json_file() must fail mypy.

    This is the exact pattern that used to pass silently when
    demo_generation_common was in ignore_missing_imports (all exports = Any).
    With the fix, mypy sees dict[str, JSONValue] and rejects .get() on the
    JSONValue union member without narrowing.
    """
    bad_fixture = tmp_path / "bad_json_access.py"
    bad_fixture.write_text(
        textwrap.dedent("""\
            from demo_generation_common import load_json_file
            from pathlib import Path

            def bad_access() -> object:
                data = load_json_file(Path("x.json"))
                # This chains .get() on JSONValue without narrowing — must fail
                return data.get("nested", {}).get("key")
        """),
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "mypy",
            "--config-file",
            str(REPO_ROOT / "pyproject.toml"),
            str(bad_fixture),
        ],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
        check=False,
    )

    assert result.returncode != 0, (
        "mypy should reject unnarrowed .get() on JSONValue, but it passed. "
        "This means demo_generation_common exports are being treated as Any — "
        "check that ignore_missing_imports does not include demo_generation_common."
    )
    assert "union-attr" in result.stdout or "has no attribute" in result.stdout, (
        f"Expected union-attr error for unnarrowed .get(), got:\n{result.stdout}"
    )
