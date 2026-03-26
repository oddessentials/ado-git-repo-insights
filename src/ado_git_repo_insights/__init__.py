"""ado-git-repo-insights: Azure DevOps PR metrics extraction and CSV generation."""

import logging as _logging

try:
    from importlib.metadata import PackageNotFoundError, version

    __version__ = version("ado-git-repo-insights")
except PackageNotFoundError:
    __version__ = "unknown (dev)"
    _logging.getLogger(__name__).warning(
        "Package metadata not found. Version will report as 'unknown (dev)'. "
        "Run: pip install -e ."
    )
