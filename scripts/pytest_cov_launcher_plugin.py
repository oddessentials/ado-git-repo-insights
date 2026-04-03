"""Launcher-only pytest plugin for Windows-safe local coverage runs.

The documented local entrypoint (scripts/run_pytest.py) keeps pytest-cov as the
coverage engine so local reporting stays aligned with CI. On Windows, coverage
combine can fail deleting freshly written shard files, so the launcher loads
this plugin to preserve shard files during combine.
"""

from __future__ import annotations

import functools
from collections.abc import Callable, Iterable
from typing import cast

from coverage import Coverage

CombineFunc = Callable[
    [Coverage, Iterable[str] | None, bool, bool],
    None,
]
_PATCHED: bool = False
_ORIGINAL_COMBINE: CombineFunc | None = None


def pytest_configure() -> None:
    """Keep coverage shard files during pytest-cov combine.

    pytest-cov central mode always calls ``Coverage.combine()`` during session
    shutdown. On Windows, deleting the shard files can raise ``PermissionError``
    even though the combine itself succeeded. Force ``keep=True`` for the
    launcher path so reporting still works and the temporary shard files are
    left behind.
    """

    global _PATCHED
    global _ORIGINAL_COMBINE
    if _PATCHED:
        return

    original_combine = Coverage.combine
    _ORIGINAL_COMBINE = original_combine

    @functools.wraps(original_combine)
    def patched_combine(
        self: Coverage,
        data_paths: Iterable[str] | None = None,
        strict: bool = False,
        keep: bool = False,
    ) -> None:
        if not keep:
            keep = True
        return original_combine(self, data_paths, strict, keep)

    Coverage.combine = cast(CombineFunc, patched_combine)
    _PATCHED = True
