# Quickstart: Enable ML Features & Migrate to pnpm

**Branch**: `010-pnpm-ml-enablement` | **Date**: 2026-01-28

## Prerequisites

- Node.js 22+ (includes Corepack)
- pnpm 9.x (installed via Corepack)

## Local Development Setup

### 1. Enable Corepack

Corepack is bundled with Node.js 16.9+ but disabled by default.

```bash
# Enable Corepack (one-time setup)
corepack enable

# Verify pnpm is available
pnpm --version
```

### 2. Clone and Install

```bash
# Clone the repository
git clone https://github.com/oddessentials/ado-git-repo-insights.git
cd ado-git-repo-insights

# Install dependencies (Corepack uses packageManager field)
pnpm install

# For CI/frozen lockfile
pnpm install --frozen-lockfile
```

### 3. Verify Installation

```bash
# Run extension tests
cd extension
pnpm test

# Build extension
pnpm build
```

## Migration from npm

If you have an existing clone with npm artifacts:

```bash
# Remove npm artifacts
rm -rf node_modules package-lock.json
rm -rf extension/node_modules

# Enable Corepack and install with pnpm
corepack enable
pnpm install
```

## CI Configuration

### GitHub Actions

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run tests
        working-directory: extension
        run: pnpm test
```

### Azure DevOps

```yaml
steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '22.x'
    displayName: 'Install Node.js'

  - script: |
      corepack enable
      corepack prepare pnpm@latest --activate
      pnpm install --frozen-lockfile
    displayName: 'Install dependencies'

  - script: pnpm test
    displayName: 'Run tests'
    workingDirectory: extension
```

## Enabling ML Features

### Predictions Tab

Add to your Azure DevOps pipeline YAML:

```yaml
- task: ExtractPRs@5
  inputs:
    # ... existing inputs ...
    runPredictions: true
```

This generates `predictions/trends.json` in the pipeline artifacts.

### AI Insights Tab

1. Create a secret variable for your OpenAI API key:
   - Pipeline Settings → Variables → Add `OPENAI_API_KEY`
   - Mark as secret

2. Add to your pipeline YAML:

```yaml
- task: ExtractPRs@5
  inputs:
    # ... existing inputs ...
    runInsights: true
  env:
    OPENAI_API_KEY: $(OPENAI_API_KEY)
```

This generates `ai_insights/summary.json` in the pipeline artifacts.

## Troubleshooting

### pnpm command not found

```bash
# Ensure Corepack is enabled
corepack enable

# Or install pnpm directly
npm install -g pnpm
```

### Lockfile out of sync

```bash
# Update lockfile (local development only)
pnpm install

# Never use in CI - CI should fail if lockfile is out of sync
```

### CI fails on package-lock.json

This is intentional. Delete `package-lock.json` and commit:

```bash
rm package-lock.json
git add -A
git commit -m "chore: remove npm lockfile (pnpm migration)"
```

### ML tabs show "Setup Required"

1. Verify pipeline has `runPredictions: true` or `runInsights: true`
2. Check pipeline artifacts for `predictions/trends.json` or `ai_insights/summary.json`
3. Verify artifact schema_version matches supported version (currently: 1)

### ML tabs show "Invalid Data Format"

1. Check that artifact is valid JSON
2. Verify required fields are present:
   - `schema_version` (integer)
   - `generated_at` (ISO 8601 string)
   - `forecasts` or `insights` (array)

### ML tabs show "Unsupported Schema Version"

Update your pipeline task to generate compatible artifacts. Check the error message for supported version range.
