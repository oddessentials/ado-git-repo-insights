# ADO Git Repo Insights

<!-- CI & Quality -->

[![AI Review](https://github.com/oddessentials/ado-git-repo-insights/actions/workflows/ai-review.yml/badge.svg)](https://github.com/oddessentials/odd-ai-reviewers/actions/workflows/ai-review.yml)
![CI](https://github.com/oddessentials/ado-git-repo-insights/actions/workflows/ci.yml/badge.svg)
[![Release](https://github.com/oddessentials/ado-git-repo-insights/actions/workflows/release.yml/badge.svg)](https://github.com/oddessentials/ado-git-repo-insights/actions/workflows/release.yml)

<!-- Package -->

[![PyPI version](https://img.shields.io/pypi/v/ado-git-repo-insights?logo=pypi)](https://pypi.org/project/ado-git-repo-insights/)
![Python](https://img.shields.io/badge/python-3.10%20%7C%203.11%20%7C%203.12-blue)
![Python Coverage](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Foddessentials%2Fado-git-repo-insights%2Fbadges%2Fstatus.json&query=%24.python.coverage&label=Python%20Coverage&suffix=%25&color=brightgreen)
![Python Tests](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Foddessentials%2Fado-git-repo-insights%2Fbadges%2Fstatus.json&query=%24.python.tests.display&label=Python%20Tests&color=blue)

<!-- Technology Stack -->

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)
![TypeScript Coverage](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Foddessentials%2Fado-git-repo-insights%2Fbadges%2Fstatus.json&query=%24.typescript.coverage&label=TypeScript%20Coverage&suffix=%25&color=brightgreen)
![TypeScript Tests](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Foddessentials%2Fado-git-repo-insights%2Fbadges%2Fstatus.json&query=%24.typescript.tests.display&label=TypeScript%20Tests&color=blue)

![pnpm](https://img.shields.io/badge/pnpm-%3E%3D9-F69220?logo=pnpm&logoColor=white)
![Node.js](https://img.shields.io/badge/node.js-22-green)

[![Code Style: Prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://prettier.io/)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-yellow.svg)](https://conventionalcommits.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/oddessentials/ado-git-repo-insights/pulls)
[![Last Commit](https://img.shields.io/github/last-commit/oddessentials/odd-ai-reviewers)](https://github.com/oddessentials/ado-git-repo-insights/commits/main)

![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-linux%20%7C%20windows%20%7C%20macos-lightgrey)

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

## 🤖 ML Features (Optional)

The dashboard supports optional ML-powered features for forecasting and insights. These features require additional pipeline configuration.

### Predictions (Time-Series Forecasting)

Enable ML-powered forecasting for PR throughput and cycle times. **Zero-config** — no API key required.

Add to your pipeline YAML:

```yaml
build-aggregates:
    run-predictions: true
```

Features:

- Cycle time forecasts using historical trends
- Throughput predictions for capacity planning
- Confidence intervals for forecast accuracy

### AI Insights (OpenAI-Powered)

Enable AI-powered analysis of your PR patterns. Requires an OpenAI API key.

**Setup:**

1. Get an API key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Add `OPENAI_API_KEY` as a secret variable in your ADO pipeline or variable group
3. Add to your pipeline YAML:

```yaml
build-aggregates:
    run-insights: true
    openai-api-key: $(OPENAI_API_KEY)
```

Features:

- Automated bottleneck identification
- Reviewer workload recommendations
- Process improvement suggestions

**Cost:** Approximately $0.001-0.01 per pipeline run (uses GPT-4o-mini).

**Data Privacy:** Only aggregated metrics are sent to OpenAI. The following are **never sent**:

- PR titles, descriptions, or content
- User identities or email addresses
- Code changes or file contents
- Comments or review feedback

### Troubleshooting ML Features

| State                  | Cause                          | Solution                                                   |
| ---------------------- | ------------------------------ | ---------------------------------------------------------- |
| **Setup Required**     | Artifact file not found        | Enable feature in pipeline YAML and run pipeline           |
| **No Data**            | Empty forecasts/insights array | Accumulate more historical data (min. 4 weeks recommended) |
| **Invalid Artifact**   | JSON parse or validation error | Check pipeline logs for generation errors                  |
| **Unsupported Schema** | Version mismatch               | Update dashboard extension to latest version               |

---

## 🛠️ Developer Setup

### Prerequisites

- Node.js 22+
- Python 3.10+ (for backend/CLI)
- pnpm (for extension development)

### Extension Development

The extension uses **pnpm** exclusively. npm is not supported.

```bash
# Enable Corepack (provides pnpm)
corepack enable

# Install dependencies
cd extension
pnpm install

# Build
pnpm run build

# Run tests
pnpm test

# Package VSIX
pnpm run package:vsix
```

> **Note:** The root `package.json` uses npm for semantic-release tooling. Only the `extension/` directory uses pnpm.

### Python Development

```bash
# Install with development dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Run linting
ruff check .
```

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
