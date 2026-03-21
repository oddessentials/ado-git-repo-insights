#!/usr/bin/env python3
"""Deterministic helpers for the published demo dashboard shell."""

from __future__ import annotations

import re
from pathlib import Path

BASE_TAG = '    <base href="./">'
CONFIG_SCRIPT = """    <!-- Demo Mode Configuration -->
    <script>
      window.LOCAL_DASHBOARD_MODE = true;
      window.DATASET_PATH = "./data";
    </script>"""
DEMO_BANNER = """    <!-- Synthetic Data Disclaimer Banner -->
    <style>
      .demo-banner {
        background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%);
        color: white;
        padding: 8px 16px;
        text-align: center;
        font-size: 14px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        position: relative;
        z-index: 1000;
      }
      .demo-banner a {
        color: #93c5fd;
        text-decoration: underline;
      }
      .demo-banner a:hover {
        color: white;
      }
      .demo-banner-icon {
        margin-right: 8px;
      }
    </style>
    <div class="demo-banner">
      <span class="demo-banner-icon">&#128202;</span>
      <strong>Demo Mode:</strong> This dashboard displays fully synthetic data for illustration purposes only.
      Data is deterministically generated and does not represent any real organization.
      <a href="https://github.com/oddessentials/ado-git-repo-insights" target="_blank">Learn more</a>
    </div>"""


def render_demo_html(source_html: str) -> str:
    """Transform the extension shell into the published docs demo shell."""
    content = source_html

    if '<base href="./">' not in content:
        content = re.sub(
            r'(<meta charset="UTF-8">)',
            r"\1\n" + BASE_TAG,
            content,
            count=1,
        )

    if "LOCAL_DASHBOARD_MODE" not in content:
        if "<!-- LOCAL_CONFIG_PLACEHOLDER" in content:
            content = re.sub(
                r"<!-- LOCAL_CONFIG_PLACEHOLDER.*?-->",
                CONFIG_SCRIPT,
                content,
                count=1,
            )
        else:
            content = re.sub(
                r'(<script src="dashboard\.js"></script>)',
                CONFIG_SCRIPT + "\n    \\1",
                content,
                count=1,
            )

    if "demo-banner" not in content:
        content = re.sub(
            r"(<body>)",
            r"\1\n" + DEMO_BANNER,
            content,
            count=1,
        )

    return content


def render_demo_html_from_path(source_path: Path) -> str:
    """Read an extension shell file and render the published demo version."""
    return render_demo_html(source_path.read_text(encoding="utf-8"))


def write_demo_html(source_path: Path, destination_path: Path) -> None:
    """Render the published demo shell from source_path into destination_path."""
    destination_path.write_text(
        render_demo_html_from_path(source_path),
        encoding="utf-8",
        newline="\n",
    )
