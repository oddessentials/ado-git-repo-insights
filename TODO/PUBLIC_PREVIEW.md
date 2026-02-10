CRITICAL NOTES ABOUT BELOW PLAN THAT MUST BE CONSIDERED BEFORE PROCEEDING:

1. Placeholder screenshots are a trust-killer. We are accepting this risk by not committing these changes. They will be manually replaced when the work is done, but will serve to help with dimensions, descriptions, and captions (which must all be prod accurate).

2. ML/AI claims must match out-of-box reality: the new description/overview below leads with ML Predictions + AI Insights, but those are “optional add-on features” requiring extra pipeline config and enterprise regulation permissions. Most will not use this. If they’re visible but commonly “empty,” you’ll get negative reviews fast. Consider labeling them as optional and explicitly “requires additional pipeline step/artifact,” right where they’re introduced.

3. Node 16 messaging + task targets: your overview says Node 20+, but you still mention Node16 execution targets in task.json. That mismatch is a support trap during preview. Either document the dual-target reality crisply or remove Node16 where safe.

4. --no-wait-validation can hide failed marketplace validation: you already flagged this—biggest operational risk. At minimum, add a post-publish step that checks extension publish/validation status (even if it’s a separate “release verification” job) so you don’t think you shipped when you didn’t.

5. Version optics + “Preview Features” opt-in: v5.x with zero reviews plus a hidden dashboard via Preview Features can confuse evaluators. Add a single sentence near the top: “Previously available via private share; now public preview,” and make the opt-in step unmissable.

# Public Marketplace Launch — Git Repo Insights

> Transition the Azure DevOps extension from private/shared to a public marketplace listing,
> presenting as professional and enterprise-grade.

## Context

The extension "Git Repo Insights" (v5.23.1, publisher: OddEssentials) has a minimal
manifest missing marketplace metadata fields (galleryFlags, tags, screenshots, links,
badges, galleryBanner). The icon is a JPEG mislabeled as PNG. The overview.md uses emojis
and positions the extension too narrowly around CSV generation. This plan addresses all gaps.

## Decisions

| Decision                    | Choice                  | Rationale                                                                  |
| --------------------------- | ----------------------- | -------------------------------------------------------------------------- |
| Feature flag `defaultState` | Keep `false`            | Document the opt-in nature clearly in overview.md                          |
| Gallery flags               | `["Public", "Preview"]` | Sets expectations for initial launch; remove "Preview" after stabilization |
| Banner color                | `#0078d4` dark          | Microsoft Fluent blue; matches extension CSS `--primary` color             |

---

## 1. Icon Pack

### Problem

The current `extension/images/icon.png` is a **1024x1024 JPEG** mislabeled with a `.png`
extension (confirmed via file magic bytes: JFIF standard 1.01). The `extension/images/README.md`
says it should be 128x128 PNG. The marketplace requires actual PNG format — JPEG may cause
rejection or rendering issues.

### Actions

| File                                    | Action                              |
| --------------------------------------- | ----------------------------------- |
| `extension/images/icon.png`             | Replace with proper **128x128 PNG** |
| `extension/images/icon.png.placeholder` | Delete                              |
| `extension/images/README.md`            | Update to reflect actual icon spec  |

### Icon Design Specification

- **Dimensions**: 128x128 pixels
- **Format**: PNG with transparency support
- **Background**: Blue-to-purple gradient (#0078d4 → #5c2d91), matching the extension's
  CSS primary color and the GitHub Pages demo banner gradient
- **Foreground**: White chart/graph motif (line graph with data points and bar chart
  elements) — retains the existing design concept
- **Corners**: Rounded (8px radius)
- **Must be legible at 42x42** (marketplace search result thumbnail size)

### Technical Notes

- The `icons.default` manifest reference already points to `images/icon.png` — no path change
- Icons referenced via `icons.default` are auto-included in the VSIX by tfx-cli — no `files`
  array entry needed
- Hub contribution icons: Keep `"iconName": "Chart"` (built-in Fabric UI icon) for the
  dashboard hub — no custom SVG needed
- Settings hub has no icon (standard for `project-admin-hub-group` hubs)

---

## 2. Extension Manifest Updates

**File**: `extension/vss-extension.json`

### 2a. Gallery Flags (required for public listing)

```json
"galleryFlags": ["Public", "Preview"]
```

When `"Public"` is in the manifest, `tfx extension publish` automatically publishes as
public — no `--public` CLI flag needed in release.yml.

**Prerequisite**: The publisher account `OddEssentials` must be **verified** on the VS
Marketplace before a public extension can be published. Attempting to publish without
verification will fail with: `"Publisher 'OddEssentials' is not verified."` This is an
operational step outside of code changes.

### 2b. Description (broader enterprise positioning)

**Current** (too narrow):

> "Extract Azure DevOps Pull Request metrics and generate PowerBI-compatible CSVs."

**New**:

```json
"description": "Pull request analytics for Azure DevOps — built-in dashboard with cycle time, throughput, and reviewer metrics. Includes ML predictions and AI-powered insights."
```

Rationale: Leads with value proposition, mentions the dashboard (primary differentiator),
names specific metrics engineering leaders search for, mentions ML/AI as differentiator,
stays under 200 characters to avoid marketplace truncation.

### 2c. Categories

**Current**: `["Azure Pipelines"]`

**New**:

```json
"categories": ["Azure Pipelines", "Azure Repos"]
```

Rationale: The extension contributes both a pipeline task (Azure Pipelines) and a hub under
`ms.vss-code-web.code-hub-group` (Azure Repos). Dual categories double discoverability.
Valid values: `Azure Repos`, `Azure Boards`, `Azure Pipelines`, `Azure Test Plans`, `Azure Artifacts`.

### 2d. Tags (marketplace search keywords)

```json
"tags": [
    "Pull Requests",
    "PR Metrics",
    "Cycle Time",
    "Code Review",
    "Engineering Metrics",
    "DORA Metrics",
    "Dashboard",
    "Analytics",
    "PowerBI",
    "Pipeline Task",
    "AI Insights",
    "Forecasting"
]
```

Rationale per tag:

- `Pull Requests` / `PR Metrics` — direct feature match, high-intent searches
- `Cycle Time` — most-searched engineering metric term
- `Code Review` — aligns with reviewer activity features
- `Engineering Metrics` / `DORA Metrics` — captures engineering leadership audience
- `Dashboard` / `Analytics` — broad discovery terms
- `PowerBI` — captures data export audience
- `Pipeline Task` — signals automation capability
- `AI Insights` / `Forecasting` — ML differentiators

### 2e. Gallery Banner

```json
"galleryBanner": {
    "color": "#0078d4",
    "theme": "dark"
}
```

Controls the color band behind the extension icon on the marketplace listing page.
`#0078d4` is the extension's CSS `--primary` color and Microsoft's Fluent Design accent
blue. Dark theme ensures white icon motif and text remain legible.

### 2f. Screenshots

```json
"screenshots": [
    { "path": "screenshots/dashboard-overview.png" },
    { "path": "screenshots/filtering-comparison.png" },
    { "path": "screenshots/pipeline-task.png" }
]
```

**Directory**: Create `extension/screenshots/`

**Dimensions**: 1366x768 pixels, PNG format

**Placeholder strategy**: Create 3 placeholder PNG files with descriptive text overlays.
User replaces with real screenshots before commit.

| Screenshot                 | Content Description                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dashboard-overview.png`   | Full Metrics tab: 5 summary cards (Total PRs, Cycle Time P50/P90, Contributors, Reviewers) with sparklines, PR Throughput chart, Cycle Time Trend chart |
| `filtering-comparison.png` | Dashboard with repository/team filters active, comparison mode enabled showing delta indicators                                                         |
| `pipeline-task.png`        | Azure DevOps pipeline editor showing ExtractPullRequests@2 task configuration                                                                           |

Screenshots in the `screenshots` array are automatically bundled by tfx-cli — no `files`
array entry needed. Marketplace supports up to 8 screenshots.

### 2g. Links

```json
"links": {
    "home": {
        "uri": "https://oddessentials.github.io/ado-git-repo-insights/"
    },
    "repository": {
        "uri": "https://github.com/oddessentials/ado-git-repo-insights"
    },
    "issues": {
        "uri": "https://github.com/oddessentials/ado-git-repo-insights/issues"
    },
    "support": {
        "uri": "https://github.com/oddessentials/ado-git-repo-insights/issues"
    },
    "license": {
        "uri": "https://github.com/oddessentials/ado-git-repo-insights/blob/main/LICENSE"
    },
    "getstarted": {
        "uri": "https://github.com/oddessentials/ado-git-repo-insights/blob/main/docs/user-guide/extension.md"
    }
}
```

Note: The existing top-level `repository` field can remain alongside `links.repository` —
both locations are supported. `links.repository` is what shows on the marketplace page.

### 2h. Badges

```json
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
]
```

Badges render at the top of the marketplace detail page. URI must be from an allowed domain
(img.shields.io is on the allowlist).

**Excluded by design**:

- Build status badge — can show red during development, undermining trust
- Download count badge — shows low numbers for new extensions

### 2i. Q&A Redirect

```json
"CustomerQnASupport": {
    "enableqna": true,
    "url": "https://github.com/oddessentials/ado-git-repo-insights/issues"
}
```

Redirects marketplace Q&A to GitHub Issues for centralized issue tracking.

### 2j. Complete Manifest Diff

Fields to **add** (new):

- `galleryFlags`
- `tags`
- `galleryBanner`
- `screenshots`
- `links`
- `badges`
- `CustomerQnASupport`

Fields to **modify** (existing):

- `description` — broaden from CSV focus to analytics positioning
- `categories` — add `"Azure Repos"`

Fields **unchanged**:

- `id`, `name`, `version`, `publisher`, `manifestVersion`, `targets`
- `scopes` — `["vso.build", "vso.project", "vso.settings"]` are sufficient (see Scope Analysis)
- `icons`, `content`, `files`, `contributions`, `repository`

---

## 3. Overview.md Rewrite

**File**: `extension/overview.md`

### Current Problems

- Uses emojis in all section headers (enterprise buyers associate emoji with informal projects)
- Leads with setup instructions, not value proposition
- Does not mention the dashboard's specific capabilities
- Description focuses on PowerBI CSV generation (too narrow)
- References "Node.js 16+" (should be 20+)
- Does not mention feature flag opt-in requirement
- No mention of ML predictions or AI insights

### Proposed Structure

```
# Git Repo Insights

Actionable pull request analytics for Azure DevOps teams.

## What You Get

- **PR Insights Dashboard** — Cycle time, throughput, reviewer activity,
  and distribution charts directly in your Azure DevOps project
- **ML Predictions** — Time-series forecasting for PR volume and
  cycle time trends (Prophet and linear models)
- **AI-Powered Insights** — Severity-graded recommendations with
  priority and effort indicators
- **Automated Extraction** — Pipeline task with incremental daily
  extraction, weekly backfill, and PowerBI-compatible CSV output

## Dashboard

Track key metrics at a glance:
- Total PRs, Cycle Time (P50/P90), Contributors, Reviewers
- Weekly throughput with 4-week moving average trend line
- Cycle time trend with P50 and P90 lines
- Reviewer activity by week
- Cycle time distribution buckets (0-1h through 7d+)

Filter by date range, repository, or team. Compare periods side-by-side
with delta indicators. Export as CSV or shareable link.

## Getting Started

### 1. Install the Extension
Click **Get it free** above to install in your Azure DevOps organization.

### 2. Enable the Dashboard
After installation, an admin must enable the dashboard:
**Project Settings > Preview Features > [GRI] PR Insights Dashboard**

> **Note:** The pipeline extraction task works immediately without this step.
> The feature flag controls only dashboard visibility.

### 3. Create a Personal Access Token
[Same PAT creation instructions, no emoji]

### 4. Store PAT in a Variable Group
[Same variable group instructions, no emoji]

### 5. Add the Pipeline Task
[Same YAML block]

### 6. View the Dashboard
Navigate to your project > Repos > PR Insights.

## Pipeline Task Reference
[Same input table]

## CSV Output Schema
[Same output table]

## Requirements
- Azure DevOps Services (cloud) or Server 2020+
- Hosted agent: ubuntu-latest, windows-latest, or self-hosted with Node.js 20+
- PAT with Code (Read) scope

## Live Demo
Explore the dashboard with synthetic data:
https://oddessentials.github.io/ado-git-repo-insights/

## Documentation
Full documentation: https://github.com/oddessentials/ado-git-repo-insights

## Support
Issues and feature requests: https://github.com/oddessentials/ado-git-repo-insights/issues
```

### Key Changes

1. Remove all emojis from headers
2. Lead with feature summary, not setup
3. Add "Dashboard" section showcasing specific capabilities
4. Add "Enable the Dashboard" step explaining feature flag opt-in
5. Update Node.js version from "16+" to "20+"
6. Add "Requirements" section for enterprise evaluators
7. Add "Live Demo" link to GitHub Pages
8. Remove redundant "Publisher: OddEssentials" footer

---

## 4. VSIX Packaging Test Updates

### 4a. Tier A Tests (`extension/tests/vsix-packaging.test.ts`)

Add a new `describe("Marketplace Readiness")` block after existing tests:

```typescript
describe("Marketplace Readiness", () => {
    it("must have galleryFlags with Public", () => {
        expect(manifest.galleryFlags).toBeDefined();
        expect(manifest.galleryFlags).toContain("Public");
    });

    it("must have tags array with at least 3 tags", () => {
        expect(manifest.tags).toBeDefined();
        expect(Array.isArray(manifest.tags)).toBe(true);
        expect(manifest.tags.length).toBeGreaterThanOrEqual(3);
    });

    it("must have galleryBanner configuration", () => {
        expect(manifest.galleryBanner).toBeDefined();
        expect(manifest.galleryBanner.color).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(["dark", "light"]).toContain(manifest.galleryBanner.theme);
    });

    it("must have links with support and license", () => {
        expect(manifest.links).toBeDefined();
        expect(manifest.links.support?.uri).toBeDefined();
        expect(manifest.links.license?.uri).toBeDefined();
    });

    it("must have at least one screenshot defined", () => {
        expect(manifest.screenshots).toBeDefined();
        expect(manifest.screenshots.length).toBeGreaterThan(0);
    });

    it("all screenshot files must exist", () => {
        for (const screenshot of manifest.screenshots) {
            const filePath = path.join(extensionDir, screenshot.path);
            expect(fs.existsSync(filePath)).toBe(true);
        }
    });

    it("icon file must be valid PNG format", () => {
        const iconPath = path.join(extensionDir, manifest.icons.default);
        expect(fs.existsSync(iconPath)).toBe(true);
        const buffer = fs.readFileSync(iconPath);
        // PNG magic bytes: 89 50 4E 47
        expect(buffer[0]).toBe(0x89);
        expect(buffer[1]).toBe(0x50);
        expect(buffer[2]).toBe(0x4e);
        expect(buffer[3]).toBe(0x47);
    });
});
```

### 4b. Tier B Tests (`extension/tests/vsix-artifact-inspection.test.ts`)

Add to the `"Actual VSIX Contents"` describe block:

```typescript
it("VSIX contains icon file", () => {
    expect(vsixContents.some((f) => f === "images/icon.png")).toBe(true);
});

it("VSIX contains overview.md", () => {
    expect(vsixContents.some((f) => f === "overview.md")).toBe(true);
});

it("VSIX contains screenshot files", () => {
    const screenshotPaths = manifest.screenshots?.map((s: any) => s.path) || [];
    for (const screenshotPath of screenshotPaths) {
        expect(vsixContents.includes(screenshotPath)).toBe(true);
    }
});
```

---

## 5. Feature Flag — No Code Change

Per decision, keep `defaultState: false` and `userConfigurable: false`. The opt-in nature
is documented in the overview.md rewrite (section 3, "Enable the Dashboard" step).

**No changes to**:

- `extension/tests/manifest/feature-flags.test.ts` (line 136 asserts `defaultState: false`)
- `specs/026-discovery-refactor-ff-prefix/contracts/vss-extension-feature-flags.json` (line 13)

---

## 6. Scope Analysis (No Changes Needed)

| Scope          | Used By                       | Purpose                                                                  |
| -------------- | ----------------------------- | ------------------------------------------------------------------------ |
| `vso.build`    | `artifact-client.ts`          | `_apis/build/definitions`, `_apis/build/builds`, `_apis/build/artifacts` |
| `vso.project`  | `settings.ts`                 | Listing projects for cross-project configuration dropdown                |
| `vso.settings` | `dashboard.ts`, `settings.ts` | Extension Data Service for user-scoped settings                          |

**`vso.code` is NOT needed**: The dashboard reads pre-computed aggregates from build
artifacts, not PR data directly. PR extraction happens in the pipeline task using a
user-provided PAT. All three scopes are justified and minimal.

---

## 7. CI/CD Pipeline — No Changes Needed

- `galleryFlags: ["Public"]` in manifest causes tfx-cli to publish as public automatically
- Screenshots/icons referenced in manifest properties are auto-included by tfx-cli
- Version stamping script (`scripts/stamp-extension-version.cjs`) is unaffected by static fields
- `.releaserc.json` already includes `extension/vss-extension.json` in git assets
- No `--public` flag needed in release.yml publish step

---

## 8. CI Guard Risk Assessment

| Change                                 | Guard               | Risk | Notes                                                                           |
| -------------------------------------- | ------------------- | ---- | ------------------------------------------------------------------------------- |
| Replace icon.png (JPEG → PNG)          | `line-ending-guard` | LOW  | Binary files excluded from guard; `.gitattributes` marks `*.png` as binary      |
| Add galleryFlags to manifest           | `version-guard`     | LOW  | Guard checks `version` field, not other fields                                  |
| Update overview.md                     | `paths-ignore`      | LOW  | `.md` changes ignored on push; PR CI runs but no content guards for overview.md |
| Add tags/screenshots/links to manifest | `ui-bundle-sync`    | LOW  | UI build unaffected by manifest metadata                                        |
| Add screenshot files                   | `line-ending-guard` | LOW  | Binary PNG files excluded from line-ending checks                               |

**No blocking guards identified** for these changes (feature flag `defaultState` is NOT
being changed, which would have blocked on `feature-flags.test.ts`).

---

## 9. Devil's Advocate Findings

### Risks to Monitor

1. **Publisher Verification**: `OddEssentials` must be verified on VS Marketplace before
   public publishing succeeds. This is a manual operational step.

2. **Silent Publish Failures**: release.yml uses `--no-wait-validation` (line 256).
   Marketplace validation failures after VSIX upload won't fail the CI pipeline. Consider
   adding a follow-up validation check in a future PR.

3. **Version Optics**: v5.23.1 with zero reviews/ratings may seem odd. Consider adding a
   note in overview.md: "Previously available by private share." Do NOT reset the version.

4. **Node 16 Deprecation**: `task.json` includes both Node20 and Node16 execution targets.
   Node 16 is being deprecated by Azure DevOps. Document that Node 20 is the primary target.

5. **ML Feature Expectations**: Predictions and AI Insights tabs are visible in the
   dashboard but require additional pipeline configuration. The state machine handles
   "unavailable" state gracefully, but the overview.md should set expectations that these
   are optional add-on features.

6. **`.releaserc.json` cleanup**: Line 28 references `package-lock.json` in git assets,
   but the project uses pnpm. Harmless (file doesn't exist) but signals incomplete migration.
   Low priority cleanup.

7. **Rollback**: If public launch goes poorly, removing `"Public"` from galleryFlags and
   publishing a new version will hide the extension from search. Existing installs persist.
   Reviews persist permanently. Consider private-sharing to 3-5 external orgs for a 2-week
   beta before going fully public.

---

## 10. File Change Summary

| File                                               | Action                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `extension/vss-extension.json`                     | Add galleryFlags, tags, galleryBanner, screenshots, links, badges, CustomerQnASupport; update description and categories |
| `extension/images/icon.png`                        | Replace JPEG with proper 128x128 PNG                                                                                     |
| `extension/images/icon.png.placeholder`            | Delete                                                                                                                   |
| `extension/images/README.md`                       | Update to reflect actual spec                                                                                            |
| `extension/overview.md`                            | Full rewrite for enterprise positioning                                                                                  |
| `extension/screenshots/dashboard-overview.png`     | Create placeholder (1366x768 PNG)                                                                                        |
| `extension/screenshots/filtering-comparison.png`   | Create placeholder (1366x768 PNG)                                                                                        |
| `extension/screenshots/pipeline-task.png`          | Create placeholder (1366x768 PNG)                                                                                        |
| `extension/tests/vsix-packaging.test.ts`           | Add marketplace readiness test block                                                                                     |
| `extension/tests/vsix-artifact-inspection.test.ts` | Add icon/screenshot VSIX presence tests                                                                                  |

---

## 11. Verification Checklist

- [ ] Icon is valid PNG: `extension/images/icon.png` starts with bytes `89 50 4E 47`
- [ ] Icon dimensions: 128x128 pixels
- [ ] All screenshot placeholder files exist at expected paths
- [ ] Manifest JSON is valid: `node -e "JSON.parse(require('fs').readFileSync('extension/vss-extension.json','utf8'))"`
- [ ] `pnpm test` passes in `extension/` (including new marketplace readiness tests)
- [ ] `pnpm run build` succeeds in `extension/`
- [ ] overview.md has no emoji section headers
- [ ] overview.md documents the feature flag opt-in step
- [ ] overview.md references Node.js 20+ (not 16+)
- [ ] Optional: `pnpm run package:vsix` and inspect VSIX contents
- [ ] Operational: Verify OddEssentials publisher is verified on VS Marketplace
- [ ] Replace placeholder screenshots with real ones before commit

---

## 12. Commit Convention

Use `feat:` to trigger a minor version bump via semantic-release:

```
feat: add marketplace metadata for public extension listing

Add galleryFlags, tags, screenshots, galleryBanner, links, badges,
and CustomerQnASupport to vss-extension.json. Replace JPEG icon with
proper 128x128 PNG. Rewrite overview.md for enterprise positioning.
Add marketplace readiness VSIX tests.
```

This bumps 5.23.1 → 5.24.0 — appropriate for a feature-level change.
