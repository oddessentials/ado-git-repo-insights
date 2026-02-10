# Implementation Plan: Public Marketplace Launch

**Branch**: `027-public-preview` | **Date**: 2026-02-10 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/027-public-preview/spec.md`

## Summary

Transition the Azure DevOps extension from private/shared to a public marketplace listing by adding marketplace metadata (galleryFlags, tags, screenshots, links, badges, galleryBanner, CustomerQnASupport), replacing the mislabeled JPEG icon with a proper 128x128 PNG, rewriting overview.md for enterprise positioning with clear core/optional feature separation, and adding marketplace readiness tests to both Tier A (manifest validation) and Tier B (VSIX artifact inspection) test suites.

## Technical Context

**Language/Version**: TypeScript 5.7.3 (extension), JSON (manifest), Markdown (overview)
**Primary Dependencies**: vss-web-extension-sdk 5.141.0, esbuild 0.27.0, Jest 30.0.0, tfx-cli (VSIX packaging)
**Storage**: N/A (manifest metadata, static assets)
**Testing**: Jest 30.0.0 with ts-jest 29.2.5 (Tier A: `vsix-packaging.test.ts`, Tier B: `vsix-artifact-inspection.test.ts`)
**Target Platform**: VS Marketplace (Azure DevOps extension), CI on ubuntu-latest
**Project Type**: Extension (Azure DevOps)
**Performance Goals**: N/A (static assets and metadata only)
**Constraints**: Icon must be valid PNG ≤128x128; screenshots 1366x768 PNG >50KB on main; description <200 chars; marketplace-allowed badge domains only (img.shields.io)
**Scale/Scope**: 10 files changed, 0 new runtime code, additive manifest fields + test additions

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Relevance | Status |
|-----------|-----------|--------|
| I-IV (CSV Schema) | Not affected — no CSV changes | PASS |
| V (SQLite Source of Truth) | Not affected | PASS |
| VI-VII (Pipeline Artifacts) | Not affected | PASS |
| VIII-XVI (Data Integrity) | Not affected | PASS |
| XVII (Cross-Agent Compat) | Tangential — Node16/20 dual target unchanged, overview updated to say Node 20+ | PASS |
| XVIII (Actionable Failures) | Not affected | PASS |
| XIX (PAT Secrecy) | Not affected | PASS |
| XX (Least Privilege) | Confirmed: scopes unchanged (vso.build, vso.project, vso.settings) | PASS |
| XXI-XXII (Storage Backend) | Not affected | PASS |
| XXIII-XXV (Testing) | New tests are additive; existing tests unmodified | PASS |
| QG-17 (Lint) | New test files must pass ESLint | PASS |
| QG-22 (VSIX builds) | Must verify VSIX builds with new manifest fields | PASS |
| QG-25-29 (Scalability) | Not affected | PASS |

**Result: ALL GATES PASS. No violations. No complexity tracking needed.**

## Project Structure

### Documentation (this feature)

```text
specs/027-public-preview/
├── plan.md              # This file
├── research.md          # Phase 0: marketplace schema research
├── quickstart.md        # Phase 1: implementation quickstart
├── contracts/           # Phase 1: manifest schema contract
│   └── vss-extension-marketplace.json
└── checklists/
    └── requirements.md  # Spec quality checklist
```

### Source Code (repository root)

```text
extension/
├── vss-extension.json              # MODIFY: add marketplace metadata fields
├── overview.md                     # MODIFY: full rewrite for enterprise positioning
├── images/
│   ├── icon.png                    # REPLACE: JPEG → proper 128x128 PNG
│   ├── icon.png.placeholder        # DELETE
│   └── README.md                   # MODIFY: update to reflect actual spec
├── screenshots/                    # CREATE directory
│   ├── dashboard-overview.png      # CREATE: 1366x768 placeholder → real before merge
│   ├── filtering-comparison.png    # CREATE: 1366x768 placeholder → real before merge
│   └── pipeline-task.png           # CREATE: 1366x768 placeholder → real before merge
└── tests/
    ├── vsix-packaging.test.ts      # MODIFY: add Marketplace Readiness describe block
    └── vsix-artifact-inspection.test.ts  # MODIFY: add icon/overview/screenshot VSIX checks
```

**Structure Decision**: No new directories beyond `extension/screenshots/`. All changes are within the existing `extension/` workspace. Tests use the existing Jest configuration.

## Implementation Phases

### Phase A: Manifest & Assets (FR-001 through FR-010)

1. **Replace icon** — Delete `icon.png.placeholder`, replace `icon.png` with valid 128x128 PNG (manual asset creation). Update `images/README.md`.

2. **Create screenshots directory** — Add 3 placeholder PNGs at 1366x768. These MUST be replaced with real screenshots before merging to `main`.

3. **Update vss-extension.json** — Add the following top-level fields:
   - `galleryFlags`: `["Public", "Preview"]`
   - `tags`: 12 search keywords (per spec FR-004)
   - `galleryBanner`: `{ "color": "#0078d4", "theme": "dark" }`
   - `screenshots`: array of 3 paths
   - `links`: home, repository, issues, support, license, getstarted
   - `badges`: version + license from shields.io
   - `CustomerQnASupport`: `{ "enableqna": true, "url": "...github issues..." }`
   - Update `description` to enterprise positioning with "optional" ML/AI qualifier (FR-002, FR-013)
   - Update `categories` to `["Azure Pipelines", "Azure Repos"]` (FR-003)

### Phase B: Overview Rewrite (FR-011 through FR-014)

4. **Rewrite overview.md** — Full rewrite following this structure:
   - Value proposition lead ("What You Get")
   - Core features vs. Optional Add-Ons (visually separated subheadings)
   - Live demo link (immediately after dashboard section)
   - "Previously available via private share" trust note
   - Getting Started with prominent feature flag opt-in callout
   - Pipeline Task Reference
   - CSV Output Schema
   - Requirements (Node.js 20+)
   - Documentation + Support links
   - Remove all emoji from headers
   - Remove "Publisher: OddEssentials" footer

### Phase C: Test Additions (FR-015 through FR-016)

5. **Add Marketplace Readiness tests** to `vsix-packaging.test.ts`:
   - `galleryFlags` contains "Public" AND "Preview"
   - `tags` array has >= 8 entries
   - `galleryBanner` has valid hex color + valid theme
   - All 6 link types exist (home, repository, issues, support, license, getstarted)
   - `CustomerQnASupport` has enableqna + url
   - At least 2 badges exist
   - Description is < 200 characters
   - Description contains "optional" or equivalent qualifier for ML/AI
   - At least 3 screenshots defined
   - All screenshot files exist on disk
   - Screenshot files > 50KB on CI (branch-aware: warn on feature branches, fail on main)
   - Icon is valid PNG (magic bytes `89 50 4E 47`)
   - Icon dimensions are 128x128 (read PNG header bytes 16-23)

6. **Add VSIX artifact inspection tests** to `vsix-artifact-inspection.test.ts`:
   - VSIX contains `images/icon.png`
   - VSIX contains `overview.md`
   - VSIX contains all screenshot files from manifest

### Phase D: Verification

7. **Local verification checklist**:
   - `pnpm test` passes in `extension/` (including new tests)
   - `pnpm run build` succeeds
   - `node -e "JSON.parse(require('fs').readFileSync('extension/vss-extension.json','utf8'))"` validates JSON
   - Manual review of overview.md for emoji absence, feature flag documentation, ML/AI "optional" labeling

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Screenshot placeholder gate | >50KB threshold, branch-aware | Real screenshots are 100KB+; placeholders are <10KB. Feature branches need flexibility; main must be protected. |
| Test threshold alignment | Match spec exactly (8 tags, 3 screenshots, 6 links) | Tech review found test thresholds were too lenient; spec requirements are the source of truth. |
| ML/AI description qualifier | "Optional" must appear in manifest description AND overview | FR-013 requires both surfaces. Prevents marketplace short description from overselling. |
| No CI/CD workflow changes | None needed | galleryFlags auto-publishes via tfx-cli; version stamping preserves new fields; .releaserc.json git assets already include vss-extension.json. |
| Post-publish verification | Manual checklist item for v1 | --no-wait-validation means CI can't detect post-upload marketplace validation failures. Manual verification at marketplace URL is required after each release. |

## Risk Mitigations (from team review)

| Risk | Severity | Mitigation |
|------|----------|------------|
| Feature flag trap (defaultState: false) | CRITICAL | Prominent callout in overview; multiple mentions of Preview Features opt-in; considered for future defaultState change |
| ML/AI over-promise | CRITICAL | "Optional" in manifest description + visual core/optional separation in overview |
| Silent publish failure | CRITICAL | Manual post-publish URL check added to launch checklist |
| Placeholder screenshots shipped | HIGH | >50KB CI gate on main/release branches |
| Publisher not verified | HIGH | Pre-launch operational checklist item; tfx publish fails explicitly on verification error |
