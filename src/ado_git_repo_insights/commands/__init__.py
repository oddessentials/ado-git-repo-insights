"""CLI commands package for ado-insights distribution hardening.

This package contains implementations for:
- setup-path: Automated PATH configuration for pip users
- doctor: Installation diagnostics and conflict detection
"""

from .doctor import cmd_doctor
from .setup_path import cmd_setup_path

__all__ = ["cmd_setup_path", "cmd_doctor"]
