#!/usr/bin/env python3
"""
Inject demo mode configuration into docs/index.html.

This script:
1. Adds <base href="./"> for relative path resolution
2. Injects LOCAL_DASHBOARD_MODE and DATASET_PATH configuration
3. Adds synthetic data disclaimer banner

Usage:
    python scripts/inject-demo-config.py [index_html_path]
"""

import re
import sys
from pathlib import Path


def inject_config(index_path: Path) -> None:
    """Inject demo configuration into index.html."""
    content = index_path.read_text(encoding="utf-8")

    # Add <base href="./"> after <meta charset>
    if '<base href="./">' not in content:
        content = re.sub(
            r'(<meta charset="UTF-8">)',
            r'\1\n    <base href="./">',
            content,
        )
        print('  Added: <base href="./">')

    # Add configuration script before dashboard.js (replace placeholder if present)
    config_script = """    <!-- Demo Mode Configuration -->
    <script>
      window.LOCAL_DASHBOARD_MODE = true;
      window.DATASET_PATH = "./data";
    </script>"""

    if "LOCAL_DASHBOARD_MODE" not in content:
        # Replace the placeholder comment or add before dashboard.js
        if "<!-- LOCAL_CONFIG_PLACEHOLDER" in content:
            content = re.sub(
                r"<!-- LOCAL_CONFIG_PLACEHOLDER.*?-->",
                config_script,
                content,
            )
        else:
            content = re.sub(
                r'(<script src="dashboard\.js"></script>)',
                config_script + "\n    \\1",
                content,
            )
        print("  Added: LOCAL_DASHBOARD_MODE configuration")

    # Add synthetic data banner after <body>
    banner_html = """    <!-- Synthetic Data Disclaimer Banner -->
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

    if "demo-banner" not in content:
        content = re.sub(
            r"(<body>)",
            r"\1\n" + banner_html,
            content,
        )
        print("  Added: Synthetic data disclaimer banner")

    # Write back with LF line endings
    index_path.write_text(content, encoding="utf-8", newline="\n")
    print("  Configuration injected successfully.")


def main() -> int:
    """Main entry point."""
    if len(sys.argv) > 1:
        index_path = Path(sys.argv[1])
    else:
        # Default path
        index_path = Path(__file__).parent.parent / "docs" / "index.html"

    if not index_path.exists():
        print(f"Error: {index_path} not found")
        return 1

    inject_config(index_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
