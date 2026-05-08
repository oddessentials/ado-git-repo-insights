# UI Bundle Synchronization

The dashboard UI is duplicated between two locations because pip wheels can't preserve symlinks:

| Location | Role |
|---|---|
| `extension/ui/` | **Source of truth.** Edit here. |
| `src/ado_git_repo_insights/ui_bundle/` | Copy bundled into the pip package so `ado-insights dashboard` works after `pip install`. |

---

## Workflow

Edit files in `extension/ui/`, then commit both locations. The pre-commit hook syncs automatically when UI files are staged. To sync manually:

```bash
python scripts/manage_generated_artifacts.py sync --scope ui      # ui_bundle only
python scripts/manage_generated_artifacts.py sync --scope all     # ui_bundle + docs/ demo shell
python scripts/manage_generated_artifacts.py verify --scope ui    # check parity, don't stage
```

After sync, stage both locations:

```bash
git add extension/ui/ src/ado_git_repo_insights/ui_bundle/
```

---

## CI enforcement

The `ui-bundle-sync` CI job fails the build if `extension/ui/` and `src/ado_git_repo_insights/ui_bundle/` diverge. Fix with the manual sync command above and re-commit.

Ignored during sync: `*.map`, `.DS_Store`, editor backups (`*.swp`, `*~`, `*.bak`).
</content>
