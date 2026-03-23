# UI Bundle Synchronization

The dashboard UI files must be kept synchronized between two locations.

---

## Why Two Locations?

| Location | Purpose |
|----------|---------|
| `extension/ui/` | **Source of truth** for Azure DevOps extension |
| `src/ado_git_repo_insights/ui_bundle/` | Copy for Python pip package |

**Why not symlinks?** Symlinks don't work with pip packages. When building Python wheels with setuptools, symlinks are not preserved — the wheel would contain broken symlinks instead of actual files.

**Why needed?** The `ado-insights dashboard` command requires bundled UI files. When users install via `pip install ado-git-repo-insights`, the UI files must be physically present in the package.

---

## Synchronization Process

### Automatic (Pre-commit Hook)

The repo-owned pre-commit hook runs sync automatically when UI files are staged.
The hook is launched by Husky, but the source of truth is the Python
orchestrator in [`scripts/run_repo_hook.py`](../../scripts/run_repo_hook.py).

```bash
# Just commit normally — sync runs if UI files changed
git add extension/ui/modules/metrics.ts
git commit -m "Update dashboard"
# → managed generated artifact sync runs automatically
```

### Manual Sync

```bash
# Sync VSS SDK + build UI + refresh ui_bundle
python scripts/manage_generated_artifacts.py sync --scope ui

# Sync the full managed surface, including docs/ and broken-docs fixture outputs
python scripts/manage_generated_artifacts.py sync --scope all

# Verify parity without staging changes
python scripts/manage_generated_artifacts.py verify --scope ui
python scripts/manage_generated_artifacts.py verify --scope all
```

---

## Workflow

1. **Edit files in `extension/ui/`** — This is the source of truth
2. **Run sync** — Either via the repo-owned pre-commit hook or manually
3. **Commit both locations** — Always commit together

```bash
# Example workflow
vim extension/ui/modules/metrics.ts
python scripts/manage_generated_artifacts.py sync --scope ui
git add extension/ui/ src/ado_git_repo_insights/ui_bundle/
git commit -m "Update dashboard UI"
```

---

## CI Enforcement

The `ui-bundle-sync` CI job verifies synchronization on every PR.

**If out of sync, the job will:**
1. Fail the build
2. Show a patch-format diff of differences
3. Provide instructions to fix

**To fix:**
```bash
python scripts/manage_generated_artifacts.py sync --scope ui
git add extension/ui/ src/ado_git_repo_insights/ui_bundle/
git commit --amend  # or new commit
```

---

## Ignored Files

The following patterns are ignored during sync:

| Pattern | Reason |
|---------|--------|
| `*.map` | Source maps (not needed in package) |
| `.DS_Store` | macOS metadata |
| `*.swp`, `*~`, `*.bak` | Editor backup files |

---

## Troubleshooting

### "UI bundle out of sync" CI failure

```bash
python scripts/manage_generated_artifacts.py sync --scope ui
git add -A
git commit --amend
git push --force-with-lease
```

### Files differ unexpectedly

1. Check for whitespace/line-ending differences
2. Verify you edited `extension/ui/` (not `ui_bundle/`)
3. Re-run sync and inspect the diff

### Sync script not found

Ensure you're in the repository root:
```bash
cd /path/to/ado-git-repo-insights
python scripts/manage_generated_artifacts.py sync --scope ui
```

### Which command should I use?

| Goal | Command |
|------|---------|
| Refresh only the pip package UI copy | `python scripts/manage_generated_artifacts.py sync --scope ui` |
| Refresh UI bundle plus published demo shell/assets | `python scripts/manage_generated_artifacts.py sync --scope all` |
| Verify parity without staging | `python scripts/manage_generated_artifacts.py verify --scope ui` or `--scope all` |

---

## See Also

- [Development Setup](setup.md) — Environment setup
- [Contributing Guide](../../CONTRIBUTING.md) — Contribution workflow
