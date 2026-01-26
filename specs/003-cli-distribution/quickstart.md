# Installation Quickstart: ado-insights

This guide covers the recommended installation methods for ado-insights.

## Recommended: pipx (Frictionless)

pipx is the recommended installation method. It automatically handles PATH configuration and isolates dependencies.

```bash
# Install pipx if you don't have it
# macOS/Linux
python -m pip install --user pipx
pipx ensurepath

# Windows (PowerShell)
py -m pip install --user pipx
pipx ensurepath

# Install ado-insights
pipx install ado-git-repo-insights

# Verify installation
ado-insights --version
```

## Alternative: uv tool (Frictionless)

uv is a fast, modern alternative to pipx with similar frictionless installation.

```bash
# Install uv if you don't have it
# macOS/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows (PowerShell)
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"

# Install ado-insights
uv tool install ado-git-repo-insights

# Verify installation
ado-insights --version
```

## Advanced: pip (Requires PATH Setup)

For developers who prefer pip directly. This method requires manual PATH configuration.

```bash
# Install
pip install ado-git-repo-insights

# If ado-insights is not found, the installer will display PATH guidance.
# You can either:

# Option 1: Run the automatic setup
ado-insights setup-path

# Option 2: Get the command to run manually
ado-insights setup-path --print-only

# Then restart your terminal and verify
ado-insights --version
```

## Troubleshooting

### Check Installation Status

```bash
ado-insights doctor
```

This command shows:
- Executable location
- Python environment
- Installation method
- Any conflicts or PATH issues
- Recommended fix commands

### Common Issues

**"ado-insights: command not found"**
- If installed via pip: Run `ado-insights setup-path` or follow the PATH guidance displayed during install
- If installed via pipx/uv: Try `pipx ensurepath` or `uv tool update-shell`

**Multiple versions installed**
- Run `ado-insights doctor` to see all installations
- Follow the recommended uninstall commands to clean up

### Supported Shells

Full support (automatic PATH configuration):
- bash
- zsh
- PowerShell

Best-effort guidance (manual configuration may be needed):
- fish
- nushell
- other shells

## Upgrade

```bash
# pipx
pipx upgrade ado-git-repo-insights

# uv
uv tool upgrade ado-git-repo-insights

# pip
pip install --upgrade ado-git-repo-insights
```

## Uninstall

```bash
# pipx
pipx uninstall ado-git-repo-insights

# uv
uv tool uninstall ado-git-repo-insights

# pip (if you used setup-path, remove it first)
ado-insights setup-path --remove
pip uninstall ado-git-repo-insights
```
