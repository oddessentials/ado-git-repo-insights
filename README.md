<p align="left">
  <img src="extension/images/icon.png" alt="Git Repo Insights" width="128" height="128">
</p>

# ADO Git Repo Insights

<!-- Status & CI -->

![CI](https://github.com/oddessentials/ado-git-repo-insights/actions/workflows/ci.yml/badge.svg)
[![Release](https://github.com/oddessentials/ado-git-repo-insights/actions/workflows/release.yml/badge.svg)](https://github.com/oddessentials/ado-git-repo-insights/actions/workflows/release.yml)
[![AI Review](https://github.com/oddessentials/ado-git-repo-insights/actions/workflows/ai-review.yml/badge.svg)](https://github.com/oddessentials/odd-ai-reviewers/actions/workflows/ai-review.yml)
![Maintained](https://img.shields.io/badge/maintained-yes-brightgreen)
[![Last Commit](https://img.shields.io/github/last-commit/oddessentials/ado-git-repo-insights/main)](https://github.com/oddessentials/ado-git-repo-insights/commits/main)

<!-- Python -->

[![PyPI version](https://img.shields.io/pypi/v/ado-git-repo-insights?logo=pypi)](https://pypi.org/project/ado-git-repo-insights/)
![Python](https://img.shields.io/badge/python-3.12%20%7C%203.13%20%7C%203.14-blue)
![Python Coverage](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Foddessentials%2Fado-git-repo-insights%2Fbadges%2Fstatus.json&query=%24.python.coverage&label=Python%20Coverage&suffix=%25&color=brightgreen)
![Python Tests](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Foddessentials%2Fado-git-repo-insights%2Fbadges%2Fstatus.json&query=%24.python.tests.display&label=Python%20Tests&color=blue)

<!-- TypeScript -->

![TypeScript](https://img.shields.io/badge/TypeScript-6.x-blue?logo=typescript)
![TypeScript Coverage](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Foddessentials%2Fado-git-repo-insights%2Fbadges%2Fstatus.json&query=%24.typescript.coverage&label=TypeScript%20Coverage&suffix=%25&color=brightgreen)
![TypeScript Tests](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Foddessentials%2Fado-git-repo-insights%2Fbadges%2Fstatus.json&query=%24.typescript.tests.display&label=TypeScript%20Tests&color=blue)

<!-- Toolchain & Standards -->

![Node.js](https://img.shields.io/badge/node.js-22-green)
![pnpm](https://img.shields.io/badge/pnpm-%3E%3D9-F69220?logo=pnpm&logoColor=white)
[![Code Style: Prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://prettier.io/)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-yellow.svg)](https://conventionalcommits.org)

<!-- Project -->

![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-linux%20%7C%20windows%20%7C%20macos-lightgrey)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/oddessentials/ado-git-repo-insights/pulls)
[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen?logo=github)](https://oddessentials.github.io/ado-git-repo-insights/)

> [!NOTE]
> **Python Compatibility:** Requires Python 3.12 or later. Uses pandas 3.x.

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

<img src="extension/images/icon.png" alt="Git Repo Insights" width="42" height="42" align="left" style="margin-right: 8px;"> [![Install from Marketplace](https://img.shields.io/badge/Install-Azure%20DevOps%20Marketplace-blue?logo=azure-devops)](https://marketplace.visualstudio.com/items?itemName=OddEssentials.ado-git-repo-insights)

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
    - task: ExtractPullRequests@3
      inputs:
          organization: "MyOrg"
          projects: "Project1,Project2"
          pat: "$(PAT_SECRET)"

    - publish: $(Pipeline.Workspace)/aggregates
      artifact: aggregates
```

![ExtractPullRequests pipeline task configuration in Azure DevOps](extension/screenshots/pipeline-task.png)

---

## 🐍 Python CLI

The Python CLI provides full control for local analysis, custom scripts, and non-ADO CI/CD systems.

```bash
# Install (recommended)
pipx install ado-git-repo-insights

# Extract → CSV → dashboard
ado-insights extract --organization MyOrg --projects "Project1,Project2" --pat $ADO_PAT --database ./ado-insights.sqlite
ado-insights generate-csv --database ./ado-insights.sqlite --output ./csv_output
ado-insights build-aggregates --db ./ado-insights.sqlite --out ./dataset
ado-insights dashboard --dataset ./dataset --open
```

**Get started:** [CLI User Guide](docs/user-guide/local-cli.md) — covers `uv` and `pip` install paths, configuration files, and CI/CD integration.

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
| [Demo Data Versioning](docs/DEMO-DATA-VERSIONING.md) | Canonical demo build and parity policy |
| [UI Bundle Sync](docs/development/ui-bundle-sync.md) | Dashboard UI synchronization process   |
| [Changelog](CHANGELOG.md)                            | Version history and release notes      |

### 📋 Governance

| Document                                           | Description                         |
| -------------------------------------------------- | ----------------------------------- |
| [Invariants](agents/INVARIANTS.md)                 | Non-negotiable system invariants |
| [Definition of Done](agents/definition-of-done.md) | Completion criteria for features    |
| [Verification Gates](agents/definition-of-done.md#end-to-end-verification-gates) | Verification checkpoints            |

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

Comment extraction is opt-in via `--include-comments` on extract; to cover PR comments for history that predates enabling it, run the one-time `backfill-comments` subcommand — see the [extension guide](docs/user-guide/extension.md#backfilling-historical-pr-comments) or [CLI guide](docs/user-guide/local-cli.md#backfill-historical-comments).

![PR Insights Dashboard showing cycle time trends, throughput charts, and reviewer activity](extension/screenshots/dashboard-overview.png)

---

## 🤖 ML Features (Optional)

The dashboard supports optional ML-powered features: **time-series forecasting** for cycle time and throughput (zero-config, no API key) and **AI insights** for bottleneck analysis (requires an OpenAI API key, ~$0.001–0.01 per pipeline run, only aggregated metrics sent — never PR content, identities, or code).

**Setup and troubleshooting:** [Enable ML Features](docs/user-guide/enable-ml-features.md)

---

## 🛠️ Developer Setup

- **Recommended**: open in a [Dev Container](.devcontainer/) — handles all per-platform tooling automatically.
- **Native setup (advanced)**: [`docs/development/setup.md`](docs/development/setup.md).
- **Contributing**: [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## 🔒 Security

PATs use minimum **Code (Read)** scope, are never logged, and are never persisted at rest. Full posture: [docs/SECURITY.md](docs/SECURITY.md).

---

## 💬 Support

- **Issues & Features:** [GitHub Issues](https://github.com/oddessentials/ado-git-repo-insights/issues)
- **Publisher:** OddEssentials

---

## 📄 License

MIT
