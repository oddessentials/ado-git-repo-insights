# Research: Public Marketplace Launch

**Feature**: 027-public-preview
**Date**: 2026-02-10

## R-001: VS Marketplace Extension Manifest Schema

**Decision**: All proposed manifest fields follow the documented VS Marketplace extension manifest schema.

**Rationale**: Verified against the current manifest (`extension/vss-extension.json`) and marketplace documentation. The following fields are supported at the top level:

- `galleryFlags`: `string[]` — valid values include `"Public"`, `"Preview"`, `"Paid"`, `"Free"`
- `tags`: `string[]` — up to 20 tags for search optimization
- `galleryBanner`: `{ color: string, theme: "dark" | "light" }` — controls marketplace detail page header
- `screenshots`: `{ path: string }[]` — up to 8, auto-bundled by tfx-cli
- `links`: object with named subkeys (`home`, `repository`, `issues`, `support`, `license`, `getstarted`, `learn`), each with `{ uri: string }`
- `badges`: `{ href: string, uri: string, description: string }[]` — badge image URI must be from allowed domains (img.shields.io is approved)
- `CustomerQnASupport`: `{ enableqna: boolean, url?: string }` — redirects Q&A tab

**Alternatives considered**: None — this is the only schema for Azure DevOps extensions.

## R-002: galleryFlags Auto-Publish Behavior

**Decision**: Including `"Public"` in `galleryFlags` causes `tfx extension publish` to publish as public automatically. No `--public` CLI flag needed.

**Rationale**: Verified in `release.yml` (line 253-257). The publish command uses `--no-prompt --no-wait-validation` but does NOT include `--public`. With `galleryFlags: ["Public"]` in the manifest, tfx-cli reads the flag and publishes publicly. This is the documented behavior.

**Risk**: `--no-wait-validation` (line 257) means post-upload marketplace validation failures are silent. The CI job reports success as long as the upload completes. Publisher verification errors DO cause `tfx extension publish` to fail immediately (before upload), so those are caught.

**Alternatives considered**: Adding `--public` to the CLI command — redundant and adds maintenance burden.

## R-003: Version Stamping Compatibility

**Decision**: The `stamp-extension-version.cjs` script (lines 137-144) is non-destructive to new manifest fields.

**Rationale**: The script reads the full JSON via `JSON.parse`, modifies only `vss.version`, then writes back via `JSON.stringify(data, null, 4) + '\n'`. All other keys (including new `galleryFlags`, `tags`, `screenshots`, etc.) are preserved in the serialized output. 4-space indentation matches the current manifest formatting.

**Alternatives considered**: None — the existing script is correct.

## R-004: tfx-cli Auto-Bundling Behavior

**Decision**: Files referenced by `screenshots`, `icons.default`, and `content.details.path` are automatically included in the VSIX by tfx-cli. No `files` array entries needed.

**Rationale**: tfx-cli resolves paths relative to the manifest's location (`extension/`). Screenshot paths `screenshots/dashboard-overview.png` resolve to `extension/screenshots/dashboard-overview.png`. The `files` array is only needed for content that isn't referenced by a manifest property (like `tasks/extract-prs` and `dist/ui`).

**Risk**: Case sensitivity on Linux (CI runs ubuntu-latest). All paths use lowercase consistently.

**Alternatives considered**: Adding screenshots to `files` array — unnecessary and creates dual maintenance.

## R-005: .gitattributes Binary Protection

**Decision**: `.gitattributes` line 57 (`*.png binary`) prevents Git from applying line-ending normalization to PNG files. The icon replacement (JPEG → PNG) and new screenshot files are safe.

**Rationale**: The `binary` attribute tells Git to treat files as non-text, bypassing `* text=auto eol=lf` (line 2). The CI `line-ending-guard` job does NOT check `extension/images/` or `extension/screenshots/`. No interference.

**Alternatives considered**: None — configuration is correct.

## R-006: Existing Test Architecture

**Decision**: New marketplace readiness tests go in the existing `vsix-packaging.test.ts` (Tier A) and `vsix-artifact-inspection.test.ts` (Tier B) test files as new `describe` blocks.

**Rationale**: Tier A tests validate manifest JSON and local file existence — runs on every `pnpm test`. Tier B tests inspect actual VSIX contents — runs only when a VSIX is present (CI build job or local `pnpm run package:vsix`). Both files already load the manifest via `JSON.parse(fs.readFileSync(...))` in `beforeAll`. New tests can reuse the existing `manifest` variable.

**Test gap analysis** (from tech review):
- Original plan had tag threshold >= 3 (spec says >= 8) — FIXED in plan
- Original plan had screenshot threshold >= 1 (spec says >= 3) — FIXED in plan
- Original plan checked only 2/6 link types — FIXED to check all 6
- Missing: CustomerQnASupport, badges, description length, "Preview" flag, icon dimensions, placeholder detection — ALL added to plan

**Alternatives considered**: Separate test file for marketplace readiness — rejected because tests share the same manifest loading pattern and would duplicate boilerplate.

## R-007: Semantic Release Git Assets

**Decision**: `.releaserc.json` already lists `extension/vss-extension.json` in git assets (line 29). No changes needed.

**Rationale**: After semantic-release stamps the version, the manifest (with all new marketplace fields intact) is committed. The `package-lock.json` on line 28 is a no-op (file doesn't exist; pnpm project). This is pre-existing technical debt unrelated to this feature.

**Alternatives considered**: Removing `package-lock.json` from assets — out of scope for this feature, low priority cleanup.

## R-008: Icon Format Migration

**Decision**: Replace the current `extension/images/icon.png` (JPEG, 343KB, 1024x1024) with a proper 128x128 PNG.

**Rationale**: Confirmed via file inspection that the current icon is a JPEG mislabeled as PNG (magic bytes FF D8 FF E0, not 89 50 4E 47). The marketplace requires actual PNG format. A 128x128 PNG with transparency will be approximately 5-15KB, significantly smaller than the current 343KB JPEG.

**Alternatives considered**: Converting the existing JPEG to PNG in-place — rejected because the source is 1024x1024 and needs to be redesigned for 128x128 legibility (42x42 thumbnail size).

## R-009: Branch-Aware Placeholder Detection

**Decision**: Screenshot placeholder detection uses a file size threshold (>50KB) with branch-aware behavior: fail on `main`/release branches, warn on feature branches.

**Rationale**: A real 1366x768 dashboard screenshot at reasonable PNG compression is 100-500KB. A text-overlay placeholder is typically 1-10KB. The 50KB threshold provides comfortable margin. Branch awareness allows development with placeholders while preventing accidental release.

**Implementation approach**: Check `process.env.GITHUB_REF` or `process.env.CI` + `git branch --show-current` to determine if running on main. In local dev without CI env vars, default to warn behavior.

**Alternatives considered**: Pixel-scanning for "PLACEHOLDER" text — too complex and fragile. Hash-based detection — requires maintaining known placeholder hashes.
