"""ado-git-repo-insights: Azure DevOps PR metrics extraction and CSV generation."""

try:
    from ado_git_repo_insights.utils.version import resolve_version

    __version__ = resolve_version()
except ImportError:
    __version__ = "unknown (dev)"
