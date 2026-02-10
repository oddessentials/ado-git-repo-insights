# Tasks: Public Marketplace Launch

**Input**: Design documents from `/specs/027-public-preview/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, contracts/vss-extension-marketplace.json, quickstart.md

**Tests**: Included — spec FR-015 and FR-016 explicitly require marketplace readiness tests and VSIX artifact inspection tests.

**Organization**: Tasks grouped by user story. US1 (Marketplace Discovery) and US3 (Visual Identity) are combined because their manifest/asset changes are inseparable. US2 (Informed Evaluation) is independent. US4 (Automated Validation) is independent. US5 (Rollback) is documentation-only.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1, US2, US3, US4, US5)
- All paths are relative to repository root

---

## Phase 1: Setup

**Purpose**: Create directory structure and prepare asset placeholders

- [ ] T001 Create `extension/screenshots/` directory and add a `.gitkeep` file
- [ ] T002 [P] Update `extension/images/README.md` to document icon spec: 128x128 PNG, blue-to-purple gradient, white chart motif, must be legible at 42x42

**Checkpoint**: Directory structure ready for asset and manifest work

---

## Phase 2: Foundational (Assets)

**Purpose**: Replace the mislabeled JPEG icon and create screenshot placeholders. These assets BLOCK manifest changes (US1/US3) and test additions (US4).

**CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 Replace `extension/images/icon.png` with a valid 128x128 PNG file (magic bytes must be `89 50 4E 47`). The current file is a 343KB JPEG mislabeled as PNG.
- [ ] T004 Delete `extension/images/icon.png.placeholder`
- [ ] T005 [P] Create placeholder `extension/screenshots/dashboard-overview.png` (1366x768 PNG) — MUST be replaced with real screenshot before merging to main
- [ ] T006 [P] Create placeholder `extension/screenshots/filtering-comparison.png` (1366x768 PNG) — MUST be replaced with real screenshot before merging to main
- [ ] T007 [P] Create placeholder `extension/screenshots/pipeline-task.png` (1366x768 PNG) — MUST be replaced with real screenshot before merging to main

**Checkpoint**: Icon is valid PNG, screenshot placeholders exist. Manifest and tests can now reference these files.

---

## Phase 3: User Story 1 + User Story 3 — Marketplace Discovery + Visual Identity (Priority: P1/P2) MVP

**Goal**: The extension listing appears in marketplace search with professional metadata, branded banner, proper icon, screenshots, badges, links, and Q&A redirect. Covers FR-001 through FR-010.

**Independent Test**: Validate JSON with `node -e "JSON.parse(require('fs').readFileSync('extension/vss-extension.json','utf8'))"`. Verify all referenced files exist on disk. Confirm description is under 200 characters and contains "optional" qualifier for ML/AI.

### Implementation

- [ ] T008 [US1] Add `galleryFlags: ["Public", "Preview"]` to `extension/vss-extension.json` (top-level field after `categories`)
- [ ] T009 [US1] Update `description` field in `extension/vss-extension.json` to: `"Pull request analytics for Azure DevOps — built-in dashboard with cycle time, throughput, and reviewer metrics. Optional ML predictions and AI insights via pipeline add-on."` (must be under 200 chars, must contain "optional" per FR-013)
- [ ] T010 [US1] Update `categories` in `extension/vss-extension.json` from `["Azure Pipelines"]` to `["Azure Pipelines", "Azure Repos"]`
- [ ] T011 [US1] Add `tags` array to `extension/vss-extension.json` with 12 keywords: `["Pull Requests", "PR Metrics", "Cycle Time", "Code Review", "Engineering Metrics", "DORA Metrics", "Dashboard", "Analytics", "PowerBI", "Throughput", "AI Insights", "Forecasting"]`
- [ ] T012 [US3] Add `galleryBanner` to `extension/vss-extension.json`: `{ "color": "#0078d4", "theme": "dark" }`
- [ ] T013 [US1] Add `screenshots` array to `extension/vss-extension.json` referencing the 3 screenshot paths: `screenshots/dashboard-overview.png`, `screenshots/filtering-comparison.png`, `screenshots/pipeline-task.png`
- [ ] T014 [US1] Add `links` object to `extension/vss-extension.json` with 6 entries: `home` (GitHub Pages), `repository`, `issues`, `support` (both → GitHub Issues), `license`, `getstarted` (docs/user-guide/extension.md) — exact URIs in quickstart.md
- [ ] T015 [US1] Add `badges` array to `extension/vss-extension.json` with 2 entries: version badge and license badge from `img.shields.io` — exact values in quickstart.md
- [ ] T016 [US1] Add `CustomerQnASupport` to `extension/vss-extension.json`: `{ "enableqna": true, "url": "https://github.com/oddessentials/ado-git-repo-insights/issues" }`
- [ ] T017 [US1] Validate final `extension/vss-extension.json` is valid JSON and all referenced files exist on disk

**Checkpoint**: Manifest has all marketplace metadata. `extension/vss-extension.json` is valid JSON, description < 200 chars, all 3 screenshot files and icon file exist.

---

## Phase 4: User Story 2 — Informed Evaluation (Priority: P1)

**Goal**: The overview page leads with value proposition, clearly separates core vs. optional features, documents the feature flag opt-in, references Node.js 20+, and links to the live demo. Covers FR-011 through FR-014.

**Independent Test**: Read `extension/overview.md` and verify: no emoji in headers, "What You Get" is the first content section, ML/AI labeled under "Optional Add-Ons" subheading, feature flag callout is a blockquote before Getting Started, "Node.js 20+" appears in Requirements, live demo link appears after Dashboard section, no "Publisher: OddEssentials" footer.

### Implementation

- [ ] T018 [US2] Rewrite `extension/overview.md` — replace entire file with new structure:
  - Title: `# Git Repo Insights` + tagline (no emoji)
  - Trust note: "Previously available via private share to select organizations; now in public preview."
  - `## What You Get` section with two subheadings:
    - `### Core (works immediately after install)` — PR Insights Dashboard, Automated Extraction
    - `### Optional Add-Ons (requires additional pipeline configuration)` — ML Predictions (note: requires `enablePredictions: true` + Prophet), AI-Powered Insights (note: requires OpenAI API key)
  - `## Dashboard` section — list metrics: Total PRs, Cycle Time P50/P90, Contributors, Reviewers, weekly throughput, cycle time trend, reviewer activity, distribution buckets
  - `## Live Demo` section (immediately after Dashboard) — link to `https://oddessentials.github.io/ado-git-repo-insights/`
  - Feature flag callout blockquote: `> **Important**: After installing, a project administrator must enable the dashboard via **Project Settings > Preview Features > [GRI] PR Insights Dashboard**.`
  - `## Getting Started` — 6 steps: Install, Enable Dashboard (with callout), Create PAT, Store PAT, Add Pipeline Task, View Dashboard
  - `## Pipeline Task Reference` — same input table as current (no emoji header)
  - `## CSV Output Schema` — same output table as current (no emoji header)
  - `## Requirements` — Azure DevOps Services (cloud) or Server 2020+, Node.js 20+, PAT with Code (Read) scope. Add: "Git Repo Insights is open source (MIT License) with full source code on GitHub."
  - `## Documentation` — link to GitHub repo
  - `## Support` — link to GitHub Issues
  - NO emoji in any header. NO "Publisher: OddEssentials" footer.

**Checkpoint**: Overview.md is complete, enterprise-ready, no emoji, feature flag documented, ML/AI clearly optional, live demo prominent, Node.js 20+.

---

## Phase 5: User Story 4 — Automated Marketplace Readiness Validation (Priority: P2)

**Goal**: CI test suite validates all marketplace metadata fields and file formats, preventing accidental publication of incomplete listings. Covers FR-015 and FR-016.

**Independent Test**: Run `pnpm test` in `extension/` — all new marketplace readiness tests and VSIX artifact inspection tests pass.

### Tier A Tests (Manifest + File Validation)

- [ ] T019 [US4] Add `describe("Marketplace Readiness")` block to `extension/tests/vsix-packaging.test.ts` after the existing `"HTML References Correct JS Files"` describe block. Add tests:
  - `galleryFlags` is defined and contains both `"Public"` and `"Preview"`
  - `tags` array has >= 8 entries
  - `galleryBanner` has valid hex color (`/^#[0-9a-fA-F]{6}$/`) and theme is `"dark"` or `"light"`
  - All 6 link types exist: `links.home.uri`, `links.repository.uri`, `links.issues.uri`, `links.support.uri`, `links.license.uri`, `links.getstarted.uri`
  - `CustomerQnASupport.enableqna` is `true` and `CustomerQnASupport.url` is defined
  - `badges` array has >= 2 entries
  - `manifest.description.length` is <= 200
  - `manifest.description` matches `/optional|configurable|add-on/i` (ML/AI qualifier check per FR-013)
  - `manifest.screenshots` has >= 3 entries
  - All screenshot files exist on disk (`fs.existsSync` for each `screenshot.path` joined with `extensionDir`)
  - Icon file exists and has PNG magic bytes (`0x89, 0x50, 0x4E, 0x47`)
  - Icon file has 128x128 dimensions (read PNG IHDR chunk: width at bytes 16-19, height at bytes 20-23, big-endian uint32)
- [ ] T020 [US4] Add screenshot placeholder detection test to `extension/tests/vsix-packaging.test.ts` in the Marketplace Readiness block:
  - For each screenshot file, check `fs.statSync(filePath).size > 50 * 1024`
  - If `process.env.GITHUB_REF` matches `refs/heads/main` or `refs/heads/release`: `expect` (hard fail)
  - Otherwise: `console.warn` and skip assertion (allow placeholders on feature branches)

### Tier B Tests (VSIX Artifact Inspection)

- [ ] T021 [US4] Add 3 tests to the `"Actual VSIX Contents"` describe block in `extension/tests/vsix-artifact-inspection.test.ts`:
  - `"VSIX contains icon file"` — `vsixContents.some(f => f === "images/icon.png")` is `true`
  - `"VSIX contains overview.md"` — `vsixContents.some(f => f === "overview.md")` is `true`
  - `"VSIX contains screenshot files"` — for each `manifest.screenshots`, verify `vsixContents.includes(screenshot.path)` is `true`

**Checkpoint**: `pnpm test` passes in `extension/` with all marketplace readiness and VSIX artifact tests green.

---

## Phase 6: User Story 5 + Polish — Rollback & Cross-Cutting Concerns

**Goal**: Document rollback path, perform final verification, ensure everything is ready for merge. Covers US5 acceptance scenarios and cross-cutting polish.

- [ ] T022 [US5] Add rollback instructions to `specs/027-public-preview/quickstart.md` — document that removing `"Public"` from `galleryFlags` and publishing a new version hides the extension from search, that existing installs continue working, and that reviews are permanent (cannot be deleted).
- [ ] T023 Verify `pnpm run build` succeeds in `extension/` with all manifest changes
- [ ] T024 Validate `extension/vss-extension.json` is parseable: `node -e "JSON.parse(require('fs').readFileSync('extension/vss-extension.json','utf8'))"`
- [ ] T025 Manual review: verify `extension/overview.md` has no emoji in headers, documents feature flag opt-in, labels ML/AI as optional, references Node.js 20+, links live demo
- [ ] T026 Run `pnpm test` in `extension/` — all tests pass (existing + new marketplace readiness + VSIX inspection)

**Checkpoint**: All code changes verified, tests pass, ready for screenshot replacement and merge.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (directory must exist for screenshots) — BLOCKS all user stories
- **US1+US3 (Phase 3)**: Depends on Phase 2 (icon and screenshots must exist for manifest references)
- **US2 (Phase 4)**: Depends on Phase 2 only (overview.md is independent of manifest changes) — CAN RUN IN PARALLEL with Phase 3
- **US4 (Phase 5)**: Depends on Phase 3 AND Phase 4 (tests validate the manifest and file state produced by prior phases)
- **Polish (Phase 6)**: Depends on all prior phases

### User Story Dependencies

- **US1 + US3 (P1/P2)**: Can start after Foundational (Phase 2). No dependency on other stories.
- **US2 (P1)**: Can start after Foundational (Phase 2). No dependency on US1/US3 — overview.md is a separate file.
- **US4 (P2)**: Depends on US1/US3 (tests validate manifest fields) and US2 (tests reference overview). Must run AFTER Phase 3 and Phase 4.
- **US5 (P3)**: Minimal — documentation only, can be done anytime after Phase 3.

### Within Each Phase

- Tasks marked [P] can run in parallel (they modify different files)
- Non-[P] tasks depend on prior tasks in the same phase

### Parallel Opportunities

- **Phase 2**: T005, T006, T007 (screenshot placeholders) can all run in parallel
- **Phase 3**: T008-T016 all modify `vss-extension.json` — must be done sequentially or as a single batch edit (NOT parallel)
- **Phase 3 and Phase 4**: Can run in parallel (different files: vss-extension.json vs overview.md)
- **Phase 5**: T019 and T021 can run in parallel (different test files)

---

## Parallel Example: Phase 3 + Phase 4

```
# These can run simultaneously (different files):
Agent A: T008-T017 (manifest changes in extension/vss-extension.json)
Agent B: T018 (overview rewrite in extension/overview.md)

# After both complete:
Agent A or B: T019-T021 (test additions, depends on manifest + overview being done)
```

---

## Implementation Strategy

### MVP First (US1 + US3 — Marketplace Listing)

1. Complete Phase 1: Setup (2 tasks)
2. Complete Phase 2: Foundational assets (5 tasks)
3. Complete Phase 3: Manifest metadata (10 tasks)
4. **STOP and VALIDATE**: JSON valid, all files exist, description < 200 chars
5. Extension can be published with updated manifest (even before overview rewrite)

### Incremental Delivery

1. Phase 1 + 2 → Assets ready
2. Phase 3 (US1+US3) → Manifest complete → validate JSON
3. Phase 4 (US2) → Overview complete → peer review for enterprise readiness
4. Phase 5 (US4) → Tests added → `pnpm test` passes
5. Phase 6 → Final verification → replace screenshots → merge to main

### Pre-Merge Checklist

- [ ] All 3 placeholder screenshots replaced with real ones (>50KB each)
- [ ] Icon is actual PNG, 128x128 pixels
- [ ] Publisher `OddEssentials` verified on VS Marketplace
- [ ] `pnpm test` passes (all tests including new marketplace readiness)
- [ ] `pnpm run build` succeeds
- [ ] After publish: manually verify listing at `https://marketplace.visualstudio.com/items?itemName=OddEssentials.ado-git-repo-insights`

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- US1 and US3 are combined because their manifest/asset changes are inseparable (same file + same assets)
- Screenshot files are placeholders during development — CI hard-fails on main if any screenshot < 50KB
- The icon file is a manual asset — it cannot be generated by code. T003 requires a real PNG file.
- Total: 26 tasks across 6 phases
