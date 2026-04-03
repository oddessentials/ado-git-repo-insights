"""Launcher-only pytest plugin for Windows-safe local coverage runs.

The documented local entrypoint (scripts/run_pytest.py) keeps pytest-cov as the
coverage engine so local reporting stays aligned with CI. On Windows, coverage
combine can fail deleting freshly written shard files, so the launcher loads
this plugin to preserve shard files during combine.
"""

from __future__ import annotations

import coverage


def pytest_configure() -> None:
    """Keep coverage shard files during pytest-cov combine.

    pytest-cov central mode always calls ``Coverage.combine()`` during session
    shutdown. On Windows, deleting the shard files can raise ``PermissionError``
    even though the combine itself succeeded. Force ``keep=True`` for the
    launcher path so reporting still works and the temporary shard files are
    left behind.
    """

    original_combine = coverage.Coverage.combine

    if getattr(original_combine, "_ado_launcher_keep", False):
        return

    def combine_keep(
        self: coverage.Coverage, *args: object, **kwargs: object
    ) -> object:
        kwargs.setdefault("keep", True)
        return original_combine(self, *args, **kwargs)

    combine_keep._ado_launcher_keep = True
    coverage.Coverage.combine = combine_keep
