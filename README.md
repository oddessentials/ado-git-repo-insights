# ADO Git Repo Insights

<!-- CI & Quality -->

![CI](https://github.com/oddessentials/ado-git-repo-insights/actions/workflows/ci.yml/badge.svg)
[![Python Coverage](https://codecov.io/gh/oddessentials/ado-git-repo-insights/graph/badge.svg?flag=python)](https://codecov.io/gh/oddessentials/ado-git-repo-insights?flags[0]=python)
[![TypeScript Coverage](https://codecov.io/gh/oddessentials/ado-git-repo-insights/graph/badge.svg?flag=typescript)](https://codecov.io/gh/oddessentials/ado-git-repo-insights?flags[0]=typescript)
![Python Tests](https://img.shields.io/badge/python_tests-passing-brightgreen)
![Extension Tests](https://img.shields.io/badge/extension_tests-passing-brightgreen)

<!-- Technology Stack -->

![Python](https://img.shields.io/badge/python-3.10%20%7C%203.11%20%7C%203.12-blue)
![Node.js](https://img.shields.io/badge/node.js-22-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)
![Platform](https://img.shields.io/badge/platform-linux%20%7C%20windows%20%7C%20macos-lightgrey)
![License](https://img.shields.io/badge/license-MIT-green)

> [!NOTE]
> **Python Compatibility:** Python 3.10 uses pandas 2.x; Python 3.11+ uses pandas 3.x.
> Python 3.10 support will be evaluated in a future release.

Extract Azure DevOps Pull Request metrics to SQLite and generate PowerBI-compatible CSVs.

---

## 🚀 Quick Start

**Choose your path:**

| I want to...                                        | Use                                      |
| --------------------------------------------------- | ---------------------------------------- |
| Analyze PRs for my team via Azure DevOps pipelines  | [ADO Extension](#azure-devops-extension) |
| Run analysis locally or integrate into custom CI/CD | [Python CLI](#python-cli)                |

---

## ☁️ Azure DevOps Extension

The ADO Extension provides a self-contained pipeline task with a built-in **PR Insights Dashboard** directly in your Azure DevOps project.

[![Install from Marketplace](https://img.shields.io/badge/Install-Azure%20DevOps%20Marketplace-blue?logo=azure-devops)](https://marketplace.visualstudio.com/items?itemName=OddEssentials.ado-git-repo-insights)

**What you get:**

- Pipeline task that extracts PR metrics automatically
- Interactive dashboard in your ADO project navigation
- No Python installation required
- PowerBI-compatible CSV exports

**Get started:** [Extension User Guide](docs/user-guide/extension.md)

### Minimal Pipeline Example

```yaml
variables:
    - group: ado-insights-secrets # Contains PAT_SECRET

steps:
    - task: ExtractPullRequests@2
      inputs:
          organization: "MyOrg"
          projects: "Project1,Project2"
          pat: "$(PAT_SECRET)"

    - publish: $(Pipeline.Workspace)/aggregates
      artifact: aggregates
```

---

## 🐍 Python CLI

The Python CLI provides full control for local analysis, custom scripts, and non-ADO CI/CD systems.

### Installation

**Recommended: pipx** (handles PATH automatically)

```bash
pipx install ado-git-repo-insights
```

**Alternative: uv** (fast, modern)

```bash
uv tool install ado-git-repo-insights
```

**Advanced: pip** (manual PATH setup may be needed)

```bash
pip install ado-git-repo-insights
# If 'ado-insights' not found, run: ado-insights setup-path
```

Verify installation: `ado-insights --version`

Diagnose issues: `ado-insights doctor`

**Get started:** [CLI User Guide](docs/user-guide/local-cli.md)

### Basic Usage

```bash
# Extract PR data
ado-insights extract \
  --organization MyOrg \
  --projects "Project1,Project2" \
  --pat $ADO_PAT \
  --database ./ado-insights.sqlite

# Generate CSVs for PowerBI
ado-insights generate-csv \
  --database ./ado-insights.sqlite \
  --output ./csv_output

# View local dashboard
ado-insights build-aggregates --db ./ado-insights.sqlite --out ./dataset
ado-insights dashboard --dataset ./dataset --open
```

---

## 📚 Documentation

### 👤 For End Users

| Document                                              | Description                            |
| ----------------------------------------------------- | -------------------------------------- |
| [Extension User Guide](docs/user-guide/extension.md)  | Complete setup for ADO Extension users |
| [CLI User Guide](docs/user-guide/local-cli.md)        | Complete setup for Python CLI users    |
| [Troubleshooting](docs/user-guide/troubleshooting.md) | Common issues and solutions            |

### 📖 Reference

| Document                                                 | Description                          |
| -------------------------------------------------------- | ------------------------------------ |
| [CLI Command Reference](docs/reference/cli-reference.md) | All CLI commands and options         |
| [Task Input Reference](docs/reference/task-reference.md) | Extension task configuration         |
| [CSV Schema](docs/reference/csv-schema.md)               | PowerBI-compatible output format     |
| [Dataset Contract](docs/reference/dataset-contract.md)   | Dashboard data format specification  |
| [Architecture](docs/reference/architecture.md)           | System design and data flow diagrams |

### ⚙️ Operations

| Document                                            | Description                                      |
| --------------------------------------------------- | ------------------------------------------------ |
| [Runbook](docs/operations/runbook.md)               | Monitoring, recovery, and operational procedures |
| [Data Retention](docs/operations/data-retention.md) | Storage model and security posture               |

### 🛠️ For Developers

| Document                                             | Description                            |
| ---------------------------------------------------- | -------------------------------------- |
| [Contributing Guide](CONTRIBUTING.md)                | How to contribute to this project      |
| [Development Setup](docs/development/setup.md)       | Setting up the development environment |
| [Testing Guide](docs/development/testing.md)         | Running and writing tests              |
| [UI Bundle Sync](docs/development/ui-bundle-sync.md) | Dashboard UI synchronization process   |
| [Changelog](CHANGELOG.md)                            | Version history and release notes      |

### 📋 Governance

| Document                                           | Description                         |
| -------------------------------------------------- | ----------------------------------- |
| [Invariants](agents/INVARIANTS.md)                 | 25 non-negotiable system invariants |
| [Definition of Done](agents/definition-of-done.md) | Completion criteria for features    |
| [Victory Gates](agents/victory-gates.md)           | Verification checkpoints            |

---

## ⚖️ Feature Comparison

| Feature                   | CLI                   | Extension       |
| ------------------------- | --------------------- | --------------- |
| **Installation**          | `pip install`         | ADO Marketplace |
| **Requires Python**       | Yes                   | No (bundled)    |
| **Pipeline syntax**       | Script steps          | Task step       |
| **Works outside ADO**     | Yes                   | No              |
| **PR Insights Dashboard** | Local server          | Built into ADO  |
| **Configuration**         | YAML file or CLI args | Task inputs     |
| **Flexibility**           | Higher                | Standard        |

---

## ⚡ How It Works

1. **Extract** — Fetches completed PRs from Azure DevOps REST API
2. **Store** — Persists data in SQLite with UPSERT semantics
3. **Generate** — Produces PowerBI-compatible CSVs and dashboard aggregates
4. **Visualize** — View metrics in the PR Insights Dashboard

The system uses **incremental extraction** by default (daily) with optional **backfill mode** to catch late changes (reviewer votes, status updates).

![PR Insights Dashboard](docs/dashboard-default.png)

---

## 🔒 Security

- **PAT with Code (Read) scope** — Minimum required permission
- **PATs are never logged** — Secrets are redacted from all output
- **No secrets stored at rest** — Database contains only PR metadata
- **Dashboard access** — Requires Build Read permission on the analytics pipeline

---

## 💬 Support

- **Issues & Features:** [GitHub Issues](https://github.com/oddessentials/ado-git-repo-insights/issues)
- **Publisher:** OddEssentials

---

## 📄 License

MIT
