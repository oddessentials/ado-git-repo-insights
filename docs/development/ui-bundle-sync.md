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

The pre-commit hook runs sync automatically when UI files are staged:

```bash
# Just commit normally — sync runs if UI files changed
git add extension/ui/something.js
git commit -m "Update dashboard"
# → sync_ui_bundle.py runs automatically
```

### Manual Sync

```bash
# Cross-platform Python script
python scripts/sync_ui_bundle.py

# Check sync status
./scripts/check-ui-bundle-sync.sh        # Linux/macOS
powershell -ExecutionPolicy Bypass -File scripts\check-ui-bundle-sync.ps1  # Windows
```

---

## Workflow

1. **Edit files in `extension/ui/`** — This is the source of truth
2. **Run sync** — Either via pre-commit hook or manually
3. **Commit both locations** — Always commit together

```bash
# Example workflow
vim extension/ui/dashboard.js
python scripts/sync_ui_bundle.py
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
python scripts/sync_ui_bundle.py
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
python scripts/sync_ui_bundle.py
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
python scripts/sync_ui_bundle.py
```

---

## See Also

- [Development Setup](setup.md) — Environment setup
- [Contributing Guide](../../CONTRIBUTING.md) — Contribution workflow
