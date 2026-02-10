# Feature Specification: Public Marketplace Launch

**Feature Branch**: `027-public-preview`
**Created**: 2026-02-10
**Status**: Draft
**Input**: User description: "Transition Azure DevOps extension from private/shared to public marketplace listing with enterprise-grade metadata, icon, screenshots, overview rewrite, and marketplace readiness tests"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Marketplace Discovery (Priority: P1)

An engineering leader searching the Azure DevOps Marketplace for "PR metrics" or "cycle time" discovers Git Repo Insights, reads a professional listing with clear value proposition, screenshots, and badges, and installs it with confidence.

**Why this priority**: Without discoverability and a trustworthy listing, no one finds or installs the extension. This is the gateway to all other value.

**Independent Test**: Can be fully tested by searching marketplace keywords and verifying the listing renders with all metadata (banner, icon, description, tags, screenshots, links, badges). Delivers discoverability and first-impression trust.

**Acceptance Scenarios**:

1. **Given** the extension is published publicly, **When** a user searches for "PR metrics", "cycle time", "DORA metrics", or "code review analytics", **Then** Git Repo Insights appears in search results with its icon, short description, and publisher name.
2. **Given** a user opens the extension detail page, **When** the page loads, **Then** they see a professional gallery banner, at least 3 screenshots, links to documentation/support/license, version and license badges, and a Q&A section redirecting to GitHub Issues.
3. **Given** a user views the extension detail page, **When** they read the description, **Then** it clearly communicates the value proposition (dashboard, cycle time, throughput, reviewer metrics) without jargon or emoji.

---

### User Story 2 - Informed Evaluation (Priority: P1)

A potential adopter reads the overview page and understands exactly what the extension offers, what is included out-of-the-box vs. what requires additional configuration (ML/AI features), and how to get started, allowing them to make an informed install decision.

**Why this priority**: The overview page is the primary sales document. Unclear or misleading content leads to negative reviews and uninstalls — especially around optional ML/AI features that require extra pipeline setup.

**Independent Test**: Can be tested by reading the overview and verifying that: (a) core features are clearly described, (b) ML/AI features are explicitly marked as optional with requirements, (c) the feature flag opt-in step is documented, (d) a live demo link is provided, and (e) Node.js 20+ is referenced (not 16+).

**Acceptance Scenarios**:

1. **Given** a user reads the overview, **When** they look for setup instructions, **Then** they find a step-by-step guide that includes enabling the dashboard via Preview Features (feature flag opt-in).
2. **Given** a user reads the overview, **When** they encounter ML Predictions or AI Insights sections, **Then** these are clearly labeled as optional add-on features requiring additional pipeline configuration.
3. **Given** a user reads the overview, **When** they check system requirements, **Then** they see Node.js 20+ (not 16+), and the overview contains no emoji in section headers.

---

### User Story 3 - Professional Visual Identity (Priority: P2)

The extension presents a consistent, professional visual identity across the marketplace listing — proper PNG icon, branded gallery banner, and representative screenshots — that signals enterprise readiness.

**Why this priority**: Visual polish directly impacts trust. A JPEG mislabeled as PNG, missing screenshots, or unbranded listing signals amateur quality to enterprise evaluators.

**Independent Test**: Can be tested by verifying the icon is a valid 128x128 PNG file (correct magic bytes), the gallery banner renders with the correct brand color, and screenshot files exist at the declared paths and are the correct dimensions.

**Acceptance Scenarios**:

1. **Given** the extension icon file, **When** inspected, **Then** it is a valid PNG (magic bytes `89 50 4E 47`), 128x128 pixels, with the specified blue-to-purple gradient and white chart motif.
2. **Given** the extension listing page, **When** rendered, **Then** the gallery banner displays with color `#0078d4` and dark theme, providing contrast for the white icon and text.
3. **Given** the screenshots array in the manifest, **When** the VSIX is built, **Then** all screenshot files are present, are 1366x768 PNG images, and accurately represent the extension's dashboard, filtering, and pipeline task features.

---

### User Story 4 - Automated Marketplace Readiness Validation (Priority: P2)

The CI pipeline automatically validates that all marketplace metadata is present and correct before any release, preventing accidental publication of an extension missing required fields.

**Why this priority**: Manual verification of marketplace fields is error-prone. Automated tests guard against regressions and ensure every release meets marketplace requirements.

**Independent Test**: Can be tested by running the test suite and verifying that new marketplace readiness tests pass (galleryFlags, tags, banner, links, screenshots, icon format) and that VSIX artifact inspection tests confirm all referenced files are bundled.

**Acceptance Scenarios**:

1. **Given** the test suite, **When** `pnpm test` runs, **Then** marketplace readiness tests verify: galleryFlags contains "Public" and "Preview", at least 8 tags exist (per FR-004), galleryBanner has valid hex color and theme, all 6 link types exist (per FR-008), at least 3 screenshots are defined (per FR-007), description is under 200 characters and contains "optional" qualifier (per FR-013), and the icon is valid 128x128 PNG.
2. **Given** a VSIX package is built, **When** VSIX artifact inspection tests run, **Then** they verify the icon, overview, and all screenshot files are present inside the VSIX archive.

---

### User Story 5 - Safe Rollback Path (Priority: P3)

If the public launch results in negative feedback or issues, the team can revert to a non-public listing by removing "Public" from galleryFlags and publishing a new version, while existing installs continue working.

**Why this priority**: A rollback plan is essential for any public launch, but it's lower priority because the other stories prevent most issues that would require rollback.

**Independent Test**: Can be tested by verifying that removing "Public" from galleryFlags and publishing hides the extension from search while existing installations continue to function.

**Acceptance Scenarios**:

1. **Given** the extension is published publicly, **When** the team decides to revert, **Then** removing "Public" from galleryFlags and publishing a new version hides the extension from marketplace search results.
2. **Given** the extension has been installed by organizations, **When** a rollback occurs, **Then** existing installations continue to work without interruption.

---

### Edge Cases

- What happens if the publisher account `OddEssentials` is not verified when attempting public publish? The `tfx extension publish` command will fail with an explicit verification error, and that failure will propagate to the CI job. However, if the publish succeeds but post-upload marketplace validation fails, `--no-wait-validation` means CI will still report success. A post-publish verification step (manual checklist item for v1, automated in a future improvement) is required to close this gap.
- What happens if `--no-wait-validation` causes a silent marketplace validation failure? The team should have a way to verify publish status post-release (even if manual in v1).
- What happens if placeholder screenshots are accidentally committed to a release? CI MUST fail on `main` and release branches if any screenshot file is below a minimum file size threshold (50KB — a real 1366x768 dashboard screenshot will be 100KB+, a placeholder will be under 10KB). On feature branches, tests MAY warn instead of fail to allow development with placeholders.
- What happens if the icon file is replaced with another non-PNG format mislabeled as `.png`? The icon PNG magic bytes test catches this at CI time.
- How does a v5.23.1 extension with zero reviews appear to evaluators? The overview should note "Previously available by private share" to set expectations.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The extension listing MUST include `galleryFlags` with `["Public", "Preview"]` to appear in marketplace search and signal preview status.
- **FR-002**: The extension description MUST communicate the value proposition (dashboard, cycle time, throughput, reviewer metrics) in under 200 characters, leading with user value rather than technical capability.
- **FR-003**: The extension MUST be categorized under both "Azure Pipelines" and "Azure Repos" to maximize discoverability.
- **FR-004**: The extension MUST include at least 8 relevant search tags covering PR metrics, cycle time, code review, DORA metrics, dashboard, analytics, PowerBI, and ML/AI capabilities.
- **FR-005**: The extension icon MUST be a valid 128x128 pixel PNG file (not a mislabeled JPEG) that is legible at 42x42 thumbnail size.
- **FR-006**: The extension MUST include a gallery banner with brand color `#0078d4` and dark theme for consistent visual identity.
- **FR-007**: The extension MUST include at least 3 screenshots (1366x768 PNG) showing the dashboard overview, filtering/comparison mode, and pipeline task configuration.
- **FR-008**: The extension MUST include links for home page, repository, issues, support, license, and getting started documentation.
- **FR-009**: The extension MUST include badges for version and license from an approved badge domain (shields.io).
- **FR-010**: The extension MUST redirect marketplace Q&A to GitHub Issues for centralized issue tracking.
- **FR-011**: The overview page MUST lead with the value proposition, not setup instructions, and MUST NOT use emoji in section headers.
- **FR-012**: The overview page MUST document the feature flag opt-in step for enabling the dashboard (Preview Features toggle).
- **FR-013**: Both the manifest `description` field AND the overview page MUST explicitly label ML Predictions and AI Insights as optional features requiring additional pipeline configuration. The word "optional" (or equivalent qualifier such as "configurable" or "add-on") MUST appear in any mention of ML/AI capabilities in user-facing text.
- **FR-014**: The overview page MUST reference Node.js 20+ as the requirement (not 16+) and link to the live demo.
- **FR-015**: The CI test suite MUST include marketplace readiness tests that validate all required metadata fields and file formats.
- **FR-016**: The CI test suite MUST include VSIX artifact inspection tests confirming icon, overview, and screenshot files are bundled.

### Key Entities

- **Extension Manifest**: The `vss-extension.json` file containing all marketplace metadata fields (galleryFlags, tags, description, categories, screenshots, links, badges, galleryBanner, CustomerQnASupport).
- **Extension Icon**: A 128x128 PNG image file representing the extension in marketplace search results and detail pages.
- **Screenshots**: PNG images (1366x768) showing key extension features, referenced by the manifest and bundled in the VSIX.
- **Overview Page**: The `overview.md` markdown file rendered as the extension's detail page on the marketplace.
- **Gallery Banner**: Color and theme configuration controlling the visual header of the marketplace detail page.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The extension manifest contains 8+ search tags and the listing is confirmed visible via manual keyword search verification (checklist item) after publish. Marketplace search ranking and indexing timing are outside our control and are not gated as an automated success criterion.
- **SC-002**: The extension listing page displays all metadata: icon, banner, description, 3+ screenshots, 5+ links, 2+ badges, and Q&A redirect — with no broken images or missing sections.
- **SC-003**: A first-time visitor can understand what the extension does, whether ML/AI features are included, and how to get started within 2 minutes of reading the overview page.
- **SC-004**: All marketplace readiness tests pass in CI (`pnpm test`) with zero failures across metadata validation, icon format, and VSIX artifact inspection.
- **SC-005**: The extension icon passes PNG magic byte validation and renders correctly at both 128x128 (detail page) and 42x42 (search thumbnail) sizes.
- **SC-006**: Zero negative marketplace reviews attributable to misleading ML/AI feature claims or unclear setup requirements within the first 30 days of public launch.
- **SC-007**: The overview page passes a peer review against these explicit criteria: (1) no emoji in any heading, (2) professional tone throughout, (3) feature flag opt-in documented as a blockquote before Getting Started, (4) live demo link appears immediately after the Dashboard section, (5) ML/AI labeled under "Optional Add-Ons" subheading with "optional" qualifier, (6) Node.js 20+ listed in Requirements, (7) no "Publisher: OddEssentials" footer.

## Assumptions

- The publisher account `OddEssentials` will be verified on the VS Marketplace before public publishing is attempted (operational prerequisite outside of code changes).
- Placeholder screenshots will be manually replaced with real screenshots before merging to main. CI enforces a hard gate on `main`/release branches (screenshot files must be > 50KB); feature branches allow placeholders with a warning.
- The `--no-wait-validation` behavior in `release.yml` is accepted as-is for this feature; a post-publish validation check is a future improvement.
- The existing scopes (`vso.build`, `vso.project`, `vso.settings`) are sufficient and no scope changes are needed.
- The version will bump from 5.23.1 to 5.24.0 via semantic-release when merged, which is appropriate for a feature-level change.
- The `"Preview"` flag in galleryFlags will be removed in a future release after the extension stabilizes with public users.

## Dependencies

- Publisher verification on VS Marketplace (operational, external to codebase).
- Real screenshots must be captured from a working dashboard instance before final release.
- The existing feature flag tests (`feature-flags.test.ts`) and CI guards must not be disrupted by these changes.
