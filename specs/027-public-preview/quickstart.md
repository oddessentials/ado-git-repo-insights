# Quickstart: Public Marketplace Launch (027-public-preview)

## Prerequisites

- Branch `027-public-preview` checked out
- `pnpm install` run in `extension/`
- A 128x128 PNG icon file ready (or use placeholder during development)

## Step-by-Step Implementation

### 1. Replace the Icon (5 min)

```bash
# Delete the placeholder marker
rm extension/images/icon.png.placeholder

# Replace icon.png with a proper 128x128 PNG
# (manual: create or obtain the PNG, copy to extension/images/icon.png)

# Verify it's actually PNG (not JPEG):
# PowerShell: [System.IO.File]::ReadAllBytes("extension/images/icon.png")[0..3]
# Expected: 137, 80, 78, 71 (which is 0x89, 0x50, 0x4E, 0x47)
```

Update `extension/images/README.md` to reflect actual spec.

### 2. Create Screenshots Directory (5 min)

```bash
mkdir -p extension/screenshots
# Create 3 placeholder PNGs (will be replaced with real screenshots before merge):
# - extension/screenshots/dashboard-overview.png    (1366x768)
# - extension/screenshots/filtering-comparison.png  (1366x768)
# - extension/screenshots/pipeline-task.png         (1366x768)
```

### 3. Update vss-extension.json (15 min)

Add these fields to `extension/vss-extension.json` (after `categories`):

```json
"galleryFlags": ["Public", "Preview"],
"tags": [
    "Pull Requests", "PR Metrics", "Cycle Time", "Code Review",
    "Engineering Metrics", "DORA Metrics", "Dashboard", "Analytics",
    "PowerBI", "Throughput", "AI Insights", "Forecasting"
],
"galleryBanner": {
    "color": "#0078d4",
    "theme": "dark"
},
"screenshots": [
    { "path": "screenshots/dashboard-overview.png" },
    { "path": "screenshots/filtering-comparison.png" },
    { "path": "screenshots/pipeline-task.png" }
],
"links": {
    "home":       { "uri": "https://oddessentials.github.io/ado-git-repo-insights/" },
    "repository": { "uri": "https://github.com/oddessentials/ado-git-repo-insights" },
    "issues":     { "uri": "https://github.com/oddessentials/ado-git-repo-insights/issues" },
    "support":    { "uri": "https://github.com/oddessentials/ado-git-repo-insights/issues" },
    "license":    { "uri": "https://github.com/oddessentials/ado-git-repo-insights/blob/main/LICENSE" },
    "getstarted": { "uri": "https://github.com/oddessentials/ado-git-repo-insights/blob/main/docs/user-guide/extension.md" }
},
"badges": [
    {
        "href": "https://github.com/oddessentials/ado-git-repo-insights/releases",
        "uri": "https://img.shields.io/github/v/release/oddessentials/ado-git-repo-insights?label=version",
        "description": "Latest release version"
    },
    {
        "href": "https://github.com/oddessentials/ado-git-repo-insights/blob/main/LICENSE",
        "uri": "https://img.shields.io/github/license/oddessentials/ado-git-repo-insights",
        "description": "MIT License"
    }
],
"CustomerQnASupport": {
    "enableqna": true,
    "url": "https://github.com/oddessentials/ado-git-repo-insights/issues"
}
```

Update existing fields:
- `description`: `"Pull request analytics for Azure DevOps — built-in dashboard with cycle time, throughput, and reviewer metrics. Optional ML predictions and AI insights via pipeline add-on."`
- `categories`: `["Azure Pipelines", "Azure Repos"]`

### 4. Rewrite overview.md (30 min)

Replace `extension/overview.md` entirely. Key structure:

1. Title + tagline (no emoji)
2. "Previously available via private share" trust note
3. "What You Get" — Core features (dashboard, extraction) + Optional Add-Ons (ML, AI) with subheadings
4. Dashboard section with metric details
5. Live Demo link (prominent, right after Dashboard)
6. Getting Started (6 steps, feature flag callout as blockquote BEFORE step 1)
7. Pipeline Task Reference table
8. CSV Output Schema table
9. Requirements (Node.js 20+, Azure DevOps Services/Server 2020+)
10. Documentation + Support links

### 5. Add Marketplace Readiness Tests (20 min)

Add a `describe("Marketplace Readiness")` block to `extension/tests/vsix-packaging.test.ts` after existing tests. See `plan.md` Phase C for the full test list.

### 6. Add VSIX Artifact Inspection Tests (10 min)

Add 3 tests to the `"Actual VSIX Contents"` block in `extension/tests/vsix-artifact-inspection.test.ts`. See `plan.md` Phase C for details.

### 7. Verify (10 min)

```bash
cd extension
pnpm test          # All tests pass including new marketplace readiness
pnpm run build     # Extension builds cleanly
```

Validate manifest JSON:
```bash
node -e "JSON.parse(require('fs').readFileSync('extension/vss-extension.json','utf8')); console.log('Valid JSON')"
```

## Before Merging to Main

- [ ] Replace all 3 placeholder screenshots with real ones (>50KB each)
- [ ] Verify icon is actual PNG, 128x128
- [ ] Verify `OddEssentials` publisher is verified on VS Marketplace
- [ ] Review overview.md: no emoji, feature flag documented, ML/AI labeled "optional", Node 20+, live demo linked
- [ ] After publish: manually verify listing at https://marketplace.visualstudio.com/items?itemName=OddEssentials.ado-git-repo-insights

## Rollback Procedure

If the public launch needs to be reverted:

1. **Hide from search**: Remove `"Public"` from `galleryFlags` in `extension/vss-extension.json` (keep `"Preview"`) and publish a new version. The extension will no longer appear in marketplace search.
2. **Existing installs continue working**: Organizations that already installed the extension will retain full functionality. Removal from search does not uninstall from existing organizations.
3. **Reviews are permanent**: Marketplace reviews and ratings cannot be deleted once submitted. Plan for this before going public.

## Estimated Total: ~1.5 hours (excluding icon/screenshot asset creation)
