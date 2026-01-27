# Research: CLI Distribution Hardening

**Feature Branch**: `003-cli-distribution`
**Created**: 2026-01-26

## Research Summary

This document captures technical research and decisions for CLI distribution hardening. Research focused on cross-platform shell detection, PATH manipulation best practices, and installation method detection.

---

## R1: Cross-Platform Shell Detection

**Question**: How to reliably detect the user's shell across Windows, macOS, and Linux?

**Decision**: Multi-signal detection with platform-specific fallbacks

**Rationale**:
- No single method works across all platforms
- `$SHELL` is reliable on Unix but doesn't exist on Windows
- Process inspection is fragile and platform-specific
- Environment variables are the most portable approach

**Detection Algorithm**:
```python
def detect_shell():
    # 1. Check if running in PowerShell (cross-platform)
    if os.environ.get("PSModulePath"):
        return "powershell"

    # 2. Check SHELL env var (Unix/macOS)
    shell_path = os.environ.get("SHELL", "")
    if "zsh" in shell_path:
        return "zsh"
    if "bash" in shell_path:
        return "bash"

    # 3. Windows-specific checks
    if sys.platform == "win32":
        if os.environ.get("PSModulePath"):
            return "powershell"
        return "cmd"  # Best-effort for CMD

    # 4. Default fallback
    return "bash"
```

**Alternatives Considered**:
| Alternative | Why Rejected |
|------------|--------------|
| Parse `ps` output | Platform-specific, requires subprocess |
| Check parent process | Unreliable in nested shells, complex |
| Read `/etc/passwd` | Only works on Unix, may not be accurate |

---

## R2: Shell Configuration File Locations

**Question**: Where are shell configuration files located on each platform?

**Decision**: Use standard locations with fallbacks

**Configuration Files**:

| Shell | Primary | Fallback | Notes |
|-------|---------|----------|-------|
| bash (Linux) | `~/.bashrc` | `~/.bash_profile` | `.bashrc` for interactive, `.bash_profile` for login |
| bash (macOS) | `~/.bash_profile` | `~/.bashrc` | macOS defaults to login shells |
| zsh | `~/.zshrc` | None | Standard location, macOS default since Catalina |
| PowerShell (Win) | `$PROFILE` | `$HOME\Documents\PowerShell\Microsoft.PowerShell_profile.ps1` | `$PROFILE` may not exist |
| PowerShell (Unix) | `$PROFILE` | `~/.config/powershell/Microsoft.PowerShell_profile.ps1` | Cross-platform PS Core |

**Implementation**:
```python
def get_shell_config_path(shell: str) -> Path:
    home = Path.home()

    if shell == "zsh":
        return home / ".zshrc"

    if shell == "bash":
        if sys.platform == "darwin":
            # macOS uses .bash_profile for login shells
            profile = home / ".bash_profile"
            if profile.exists():
                return profile
        return home / ".bashrc"

    if shell == "powershell":
        # Check $PROFILE first, then default
        profile_env = os.environ.get("PROFILE")
        if profile_env:
            return Path(profile_env)
        if sys.platform == "win32":
            return home / "Documents" / "PowerShell" / "Microsoft.PowerShell_profile.ps1"
        return home / ".config" / "powershell" / "Microsoft.PowerShell_profile.ps1"

    raise UnsupportedShellError(shell)
```

---

## R3: PATH Modification Format

**Question**: How to format PATH modifications that are safe, idempotent, and removable?

**Decision**: Use sentinel comments with shell-specific syntax

**Rationale**:
- Sentinel comments enable idempotent operations and clean removal
- Shell-specific syntax required for portability
- Single-line format preferred over multi-line blocks

**Format by Shell**:

**bash/zsh**:
```bash
# >>> ado-insights setup-path >>>
export PATH="$PATH:/path/to/scripts"
# <<< ado-insights setup-path <<<
```

**PowerShell**:
```powershell
# >>> ado-insights setup-path >>>
$env:PATH = "$env:PATH;C:\path\to\scripts"
# <<< ado-insights setup-path <<<
```

**Benefits**:
- Grep-able pattern for detection and removal
- Human-readable
- Works with `--remove` flag
- Pattern inspired by conda/mamba

---

## R4: Scripts Directory Detection

**Question**: How to determine the console scripts directory for pip installations?

**Decision**: Use `sysconfig` module for reliable cross-platform detection

**Rationale**:
- `sysconfig.get_path("scripts")` is the official way
- Works across pip, pipx, uv, virtualenvs
- Handles user vs system installs correctly

**Implementation**:
```python
import sysconfig

def get_scripts_directory() -> Path:
    """Get the directory where console scripts are installed."""
    # For user installs, need to use the 'posix_user' or 'nt_user' scheme
    scripts_path = sysconfig.get_path("scripts")

    # For user installs (pip install --user)
    if "--user" in sys.prefix or "site-packages" not in scripts_path:
        scheme = "posix_user" if sys.platform != "win32" else "nt_user"
        scripts_path = sysconfig.get_path("scripts", scheme)

    return Path(scripts_path)
```

**Platform-Specific Paths**:
| Platform | Typical Path |
|----------|--------------|
| Linux (user) | `~/.local/bin` |
| macOS (user) | `~/.local/bin` or `/usr/local/bin` |
| Windows (user) | `%APPDATA%\Python\Python3X\Scripts` |
| pipx | `~/.local/pipx/venvs/ado-git-repo-insights/bin` |
| uv | `~/.local/share/uv/tools/ado-git-repo-insights/bin` |

---

## R5: Installation Method Detection

**Question**: How to detect whether the tool was installed via pipx, uv, or pip?

**Decision**: Path-based heuristics with environment inspection

**Detection Logic**:

```python
def detect_installation_method() -> str:
    """Detect how ado-insights was installed."""
    exe_path = Path(sys.executable).resolve()
    exe_str = str(exe_path).lower()

    # pipx creates venvs in ~/.local/pipx/venvs/
    if "pipx" in exe_str and "venvs" in exe_str:
        return "pipx"

    # uv creates tools in ~/.local/share/uv/tools/
    if "uv" in exe_str and "tools" in exe_str:
        return "uv"

    # Check if in a virtualenv (but not pipx/uv)
    if hasattr(sys, "real_prefix") or (
        hasattr(sys, "base_prefix") and sys.base_prefix != sys.prefix
    ):
        return "pip (virtualenv)"

    # Check for user install markers
    user_site = Path(sysconfig.get_path("purelib", "posix_user" if sys.platform != "win32" else "nt_user"))
    if str(exe_path).startswith(str(user_site.parent)):
        return "pip (user)"

    # System-wide or unknown
    return "pip (system)" if "site-packages" in exe_str else "unknown"
```

**Alternatives Considered**:
| Alternative | Why Rejected |
|------------|--------------|
| Check `pip show` output | Requires subprocess, slow |
| Read `INSTALLER` file in dist-info | Not always present |
| Check for `pipx` command | User may have pipx without using it for this package |

---

## R6: Conflict Detection Algorithm

**Question**: How to detect conflicting installations of ado-insights?

**Decision**: Search PATH for all matching executables and compare resolved paths

**Algorithm**:
```python
def find_all_installations() -> list[tuple[Path, str]]:
    """Find all ado-insights installations on PATH."""
    exe_name = "ado-insights.exe" if sys.platform == "win32" else "ado-insights"
    installations = []

    for path_dir in os.environ.get("PATH", "").split(os.pathsep):
        exe_path = Path(path_dir) / exe_name
        if exe_path.exists():
            resolved = exe_path.resolve()
            method = detect_installation_method_for_path(resolved)
            installations.append((resolved, method))

    # Deduplicate by resolved path
    seen = set()
    unique = []
    for path, method in installations:
        if path not in seen:
            seen.add(path)
            unique.append((path, method))

    return unique
```

**Conflict Resolution Recommendations**:
| Conflict | Recommendation |
|----------|----------------|
| pipx + pip | Remove pip install: `pip uninstall ado-git-repo-insights` |
| uv + pip | Remove pip install: `pip uninstall ado-git-repo-insights` |
| pipx + uv | Keep one, remove other based on user preference |
| Multiple pip | Remove all, reinstall with preferred method |

---

## R7: PATH Check Without Installation

**Question**: How to check if scripts directory is on PATH before recommending setup-path?

**Decision**: Simple string membership check with normalization

**Implementation**:
```python
def is_on_path(directory: Path) -> bool:
    """Check if a directory is on the system PATH."""
    dir_str = str(directory.resolve())
    path_dirs = os.environ.get("PATH", "").split(os.pathsep)

    for path_dir in path_dirs:
        try:
            if str(Path(path_dir).resolve()) == dir_str:
                return True
        except (OSError, ValueError):
            # Invalid path entry, skip
            continue

    return False
```

**Note**: Resolution handles symlinks and case differences on Windows.

---

## R8: Idempotent setup-path Implementation

**Question**: How to ensure setup-path is idempotent?

**Decision**: Check for sentinel comments before modifying

**Algorithm**:
1. Read existing config file content
2. Search for `# >>> ado-insights setup-path >>>` marker
3. If found, report "already configured" and exit
4. If not found, append the PATH modification block
5. Write back to file

**Edge Cases**:
- File doesn't exist: Create it with appropriate permissions
- File is read-only: Report error with manual instructions
- Marker exists but path is wrong: Remove old block, add new one (upgrade scenario)

---

## R9: --print-only Implementation

**Question**: How should `setup-path --print-only` work for scripting?

**Decision**: Output only the shell command, no extra text

**Rationale**:
- Scripts can capture output directly: `$(ado-insights setup-path --print-only)`
- No parsing required
- Follows Unix philosophy of composable tools

**Output Format**:
```bash
# For bash/zsh
export PATH="$PATH:/home/user/.local/bin"

# For PowerShell
$env:PATH = "$env:PATH;C:\Users\user\AppData\Roaming\Python\Python312\Scripts"
```

**No header, no footer, just the command.**

---

## Conclusion

All research items resolved. Technical approach validated through cross-platform considerations. Ready to proceed to task generation.
