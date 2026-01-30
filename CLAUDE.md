# ado-git-repo-insights Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-01-27

## Active Technologies
- TypeScript 5.7.3 (extension), Python 3.10+ (backend) + ESLint 9.18.0, Jest 30.0.0, typescript-eslint 8.53.1 (007-repo-standards-v7-compliance)
- N/A (configuration changes only) (007-repo-standards-v7-compliance)
- Bash (for pre-push hook), Python 3.10+ (for env_guard.py), TypeScript/JavaScript (for ESLint config) + GNU coreutils (find, xargs), Git, ESLint with eslint-plugin-security (008-security-hardening-fixes)
- N/A (configuration files only) (008-security-hardening-fixes)
- TypeScript 5.7.3 + Jest 30.0.0, ts-jest 29.2.5, vss-web-extension-sdk 5.141.0 (009-schema-parity-testing)
- JSON files (artifacts from ADO pipeline or local fixtures) (009-schema-parity-testing)
- TypeScript 5.7.3 (extension), Python 3.10+ (backend) + Jest 30.0.0, esbuild 0.27.0, vss-web-extension-sdk 5.141.0, pnpm 9.x (010-pnpm-ml-enablement)
- JSON artifacts (`predictions/trends.json`, `ai_insights/summary.json`) from pipeline (010-pnpm-ml-enablement)
- JSON (package.json), YAML (GitHub Actions workflows) + pnpm@9.15.0 (already in use per extension/package.json) (011-fix-ci-pnpm-version)
- YAML (GitHub Actions), TypeScript 5.7.3 (test configuration), JSON (package.json) + pnpm@9.15.0, Node.js 22, Python 3.11 (for integration tests only) (012-ci-pnpm-test-isolation)
- Python 3.10+ (backend), TypeScript 5.7.3 (extension) + mypy (Python), typescript-eslint 8.53.1 (TypeScript), eslint 9.18.0, pre-commit (013-ci-quality-hardening)
- N/A (CI configuration + scripts only) (013-ci-quality-hardening)
- YAML (GitHub Actions), JSON (package.json, .npmrc), Bash (scripts) + pnpm@9.15.0 (declared in packageManager field), semantic-release@25.0.0 (014-root-pnpm-migration)
- Bash (CI scripts), Python 3.11 (JSON generation script) + GitHub Actions, GitHub Pages, Shields.io dynamic JSON badges (015-dynamic-badges)
- GitHub Pages (`gh-pages` branch) - single JSON file (015-dynamic-badges)

-\ Python\ 3\.10\+\ \(backend\),\ TypeScript\ \(frontend/extension\)\ \+\ numpy,\ pandas\ \(Python\);\ esbuild\ \(TypeScript\ bundling\)\ \(006-forecaster-edge-hardening\)

## Project Structure

```text
src/
tests/
```

## Commands

cd\ src;\ pytest;\ ruff\ check\ \.

## Code Style

Python\ 3\.10\+\ \(backend\),\ TypeScript\ \(frontend/extension\):\ Follow\ standard\ conventions

## Recent Changes
- 015-dynamic-badges: Added Bash (CI scripts), Python 3.11 (JSON generation script) + GitHub Actions, GitHub Pages, Shields.io dynamic JSON badges
- 014-root-pnpm-migration: Added YAML (GitHub Actions), JSON (package.json, .npmrc), Bash (scripts) + pnpm@9.15.0 (declared in packageManager field), semantic-release@25.0.0
- 013-ci-quality-hardening: Added Python 3.10+ (backend), TypeScript 5.7.3 (extension) + mypy (Python), typescript-eslint 8.53.1 (TypeScript), eslint 9.18.0, pre-commit

-\ 006-forecaster-edge-hardening:\ Added\ Python\ 3\.10\+\ \(backend\),\ TypeScript\ \(frontend/extension\)\ \+\ numpy,\ pandas\ \(Python\);\ esbuild\ \(TypeScript\ bundling\)

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
