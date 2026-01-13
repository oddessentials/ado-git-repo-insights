# NOTICE: Usage Options

This tool provides **two ways** to extract Azure DevOps Pull Request metrics. Choose the one that fits your workflow.

---

## Option 1: Python CLI (Direct Installation)

Install the package and run commands directly in your pipeline or locally.

```bash
pip install ado-git-repo-insights

# Extract PR data
ado-insights extract \
  --organization MyOrg \
  --projects "Project1,Project2" \
  --pat $ADO_PAT \
  --database ./ado-insights.sqlite

# Generate PowerBI-compatible CSVs
ado-insights generate-csv \
  --database ./ado-insights.sqlite \
  --output ./csv_output
```

**Best for:**
- Users comfortable with Python/pip
- Custom scripts and automation
- Non-ADO CI/CD systems (GitHub Actions, Jenkins, etc.)

**Example pipeline:** See [sample-pipeline.yml](sample-pipeline.yml) for a complete Azure DevOps pipeline template.

---

## Option 2: Azure DevOps Extension (Task-Based)

Install the extension from the Azure DevOps Marketplace and use it as a drag-and-drop task.

```yaml
steps:
  - task: ExtractPullRequests@1
    inputs:
      organization: 'MyOrg'
      projects: 'Project1,Project2'
      pat: '$(PAT_SECRET)'
      database: '$(Pipeline.Workspace)/data/ado-insights.sqlite'
      outputDir: '$(Pipeline.Workspace)/csv_output'
```

**Best for:**
- Teams that prefer the ADO pipeline editor UI
- Organizations that want a self-contained task
- Users who don't want to manage Python dependencies

**Installation:**
1. Download the `.vsix` from [GitHub Releases](https://github.com/oddessentials/ado-git-repo-insights/releases)
2. Install in your ADO organization: Organization Settings → Extensions → Browse local extensions

---

## What's the Difference?

| Aspect | CLI (Option 1) | Extension (Option 2) |
|--------|----------------|----------------------|
| **Requires Python** | Yes | No (bundled) |
| **Installation** | `pip install` | Upload VSIX to ADO |
| **Pipeline syntax** | Script steps | Task step |
| **Works outside ADO** | Yes | No (ADO only) |
| **Flexibility** | Higher | Standard |

---

## About `sample-pipeline.yml`

The `sample-pipeline.yml` file is a **reference template**, not a prerequisite. It demonstrates:

- Scheduled daily extraction (6 AM UTC)
- Weekly backfill for data convergence
- Artifact publishing with failure safety
- Incremental vs. backfill mode selection

You can copy and adapt it for your own pipelines, regardless of whether you use the CLI or the extension.

---

## Questions?

See [README.md](README.md) for full documentation or the [runbook](docs/runbook.md) for operational details.
