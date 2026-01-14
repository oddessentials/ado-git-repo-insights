# [2.2.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v2.1.3...v2.2.0) (2026-01-14)


### Features

* **phase3:** add chunked aggregates generator and CLI command ([4d319c7](https://github.com/oddessentials/ado-git-repo-insights/commit/4d319c77fe7ac2894d79dd81a309d6bc9c036636))
* **phase3:** add dataset-driven PR Insights UI hub ([1ee608e](https://github.com/oddessentials/ado-git-repo-insights/commit/1ee608ecec6af5a3507b441cebdbdaca5104fe92))
* **phase3:** add generateAggregates option to extension task ([4ac877d](https://github.com/oddessentials/ado-git-repo-insights/commit/4ac877d8c9fecc5b51e58c36cf274c070e6a98d4))

## [2.1.3](https://github.com/oddessentials/ado-git-repo-insights/compare/v2.1.2...v2.1.3) (2026-01-14)


### Bug Fixes

* correct database input name mismatch in extension task ([cfafb3a](https://github.com/oddessentials/ado-git-repo-insights/commit/cfafb3affb05a14a27f1648a4062e31652a87282))

## [2.1.2](https://github.com/oddessentials/ado-git-repo-insights/compare/v2.1.1...v2.1.2) (2026-01-14)


### Bug Fixes

* use ASCII symbols for Windows cp1252 compatibility ([f7bc5f8](https://github.com/oddessentials/ado-git-repo-insights/commit/f7bc5f83a3d8fd48c1ed6fb166f6f7b78d27b601))

## [2.1.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v2.1.0...v2.1.1) (2026-01-14)


### Bug Fixes

* catch JSONDecodeError in API retry logic ([a7008d6](https://github.com/oddessentials/ado-git-repo-insights/commit/a7008d65c89e70bbd6b5b12732b963fec1577210))

# [2.1.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v2.0.1...v2.1.0) (2026-01-14)


### Features

* enterprise-grade task versioning with decoupled Major ([641b350](https://github.com/oddessentials/ado-git-repo-insights/commit/641b3505c89e300aefde6f20d6f9190006dd8c38))

## [2.0.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v2.0.0...v2.0.1) (2026-01-14)


### Bug Fixes

* upgrade tfx-cli to latest for private extension publish fix ([9c57688](https://github.com/oddessentials/ado-git-repo-insights/commit/9c57688eb2fcbb9ad6b7d0db537abe8365719326))

# [2.0.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v1.3.0...v2.0.0) (2026-01-14)


* feat!: v2.0.0 release automation and marketplace publishing ([b9c7c15](https://github.com/oddessentials/ado-git-repo-insights/commit/b9c7c159d764ef6f4e5bc8b5833702fa3e3f0a81))


### Bug Fixes

* enterprise-grade Marketplace publish with retries and validation ([5881a6a](https://github.com/oddessentials/ado-git-repo-insights/commit/5881a6ac71844e74be95df936b00055de9d279b1))


### BREAKING CHANGES

* Extension release automation is now the sole version authority.
Manual version edits to vss-extension.json or task.json are no longer permitted.

- Automated version stamping via semantic-release
- VSIX published to VS Marketplace on release
- VERSION file synced for run_summary.py
- Ruff version consistency enforced in CI

# [1.3.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v1.2.2...v1.3.0) (2026-01-14)


### Bug Fixes

* add Node16 fallback and UseNode task for Windows compatibility ([f60094c](https://github.com/oddessentials/ado-git-repo-insights/commit/f60094cdf442c4b7cc7031dccec437ba76f9491e))
* correct artifact download logic ([cc0c6dd](https://github.com/oddessentials/ado-git-repo-insights/commit/cc0c6dd27520dbaff06ce9357f256703ed0f7ee9))
* handle whitespace in ruff version comparison ([91681b2](https://github.com/oddessentials/ado-git-repo-insights/commit/91681b2a2d351587d2ba28f8e18e4f5c5d0776b9))
* stamp script now writes VERSION file for run_summary.py ([4618c26](https://github.com/oddessentials/ado-git-repo-insights/commit/4618c26ef299ce5d606cb125abdc97fdd8c194d2))
* update pre-commit ruff to v0.14.11 and fix lint errors ([b7c0724](https://github.com/oddessentials/ado-git-repo-insights/commit/b7c0724a8b981d4e89505d52d7014877a9fd35f1))


### Features

* add extension release automation ([0951a6f](https://github.com/oddessentials/ado-git-repo-insights/commit/0951a6fdc066498b9c6fd2aa50ad3e6a949b7b22))

## [1.2.2](https://github.com/oddessentials/ado-git-repo-insights/compare/v1.2.1...v1.2.2) (2026-01-14)


### Bug Fixes

* cross-platform pipeline with proper first-run handling ([0c9e692](https://github.com/oddessentials/ado-git-repo-insights/commit/0c9e69206866cdba9738913870ae357b79597cb6))
* use PowerShell for Windows self-hosted agent ([b4bc030](https://github.com/oddessentials/ado-git-repo-insights/commit/b4bc03090d7333e00f75e536ac58d6ff18cb6e1c))

## [1.2.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v1.2.0...v1.2.1) (2026-01-14)


### Bug Fixes

* handle corrupt extraction metadata with warn+fallback ([e0792a1](https://github.com/oddessentials/ado-git-repo-insights/commit/e0792a1c55a3ca3e8011805e8808229a79cce0dc))

# [1.2.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v1.1.0...v1.2.0) (2026-01-13)


### Bug Fixes

* address P1 and P2 CI gate failures ([2d772e4](https://github.com/oddessentials/ado-git-repo-insights/commit/2d772e457c022d3573f84b1cdd2ef6d41df55ebd))
* correct test case for 52-char ADO PAT format ([41b8a3d](https://github.com/oddessentials/ado-git-repo-insights/commit/41b8a3db7dec61e398acf6588a7f8842845ab7db))
* harden monitoring implementation with production-readiness fixes ([002e0cc](https://github.com/oddessentials/ado-git-repo-insights/commit/002e0ccd450cc6f4e3f2cc5e753bee6518167b2f))
* remove empty parentheses from pytest fixtures (PT001) ([5ce0a06](https://github.com/oddessentials/ado-git-repo-insights/commit/5ce0a068bb9b8fe4a82a88c12175b3a539d359ee))


### Features

* implement monitoring and logging infrastructure ([5e6eb39](https://github.com/oddessentials/ado-git-repo-insights/commit/5e6eb39ed47115e15fe383ccf900f6e83ae55727))

# [1.1.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v1.0.6...v1.1.0) (2026-01-13)


### Features

* expand CI matrix for cross-platform testing and consolidate docs ([8d88fb4](https://github.com/oddessentials/ado-git-repo-insights/commit/8d88fb4980de07ef83de35babd8c574a83eef6c1))

## [1.0.6](https://github.com/oddessentials/ado-git-repo-insights/compare/v1.0.5...v1.0.6) (2026-01-13)


### Bug Fixes

* Resolve deprecation warnings and add coverage threshold ([139cc7e](https://github.com/oddessentials/ado-git-repo-insights/commit/139cc7ea0643bfac9a2ed88d8742e2a9b2e15727))

## [1.0.5](https://github.com/oddessentials/ado-git-repo-insights/compare/v1.0.4...v1.0.5) (2026-01-13)


### Bug Fixes

* Match PyPI environment name to trusted publisher config ([f106638](https://github.com/oddessentials/ado-git-repo-insights/commit/f106638d18a141ecd9825eeeb12949b5294d16bc))

## [1.0.4](https://github.com/oddessentials/ado-git-repo-insights/compare/v1.0.3...v1.0.4) (2026-01-13)


### Bug Fixes

* Add pandas-stubs to dev dependencies for CI mypy ([902045c](https://github.com/oddessentials/ado-git-repo-insights/commit/902045cdf7ec71348918bc2abd116fd4be587283))

## [1.0.3](https://github.com/oddessentials/ado-git-repo-insights/compare/v1.0.2...v1.0.3) (2026-01-13)


### Bug Fixes

* Fix formatting and add pre-push quality gates ([3c4399e](https://github.com/oddessentials/ado-git-repo-insights/commit/3c4399e324fd4fc37611b28a6211cad87ae5ddb2))

## [1.0.2](https://github.com/oddessentials/ado-git-repo-insights/compare/v1.0.1...v1.0.2) (2026-01-13)


### Bug Fixes

* Re-enable PyPI publishing after trusted publisher setup ([83285e8](https://github.com/oddessentials/ado-git-repo-insights/commit/83285e8f59fe171166024b4fb39dba28f77fd6e7))

## [1.0.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v1.0.0...v1.0.1) (2026-01-13)


### Bug Fixes

* Make PyPI publishing optional with continue-on-error ([21ef435](https://github.com/oddessentials/ado-git-repo-insights/commit/21ef4358888e9a9c808cb46acc6e7cb58cc299d9))

# 1.0.0 (2026-01-13)


### Bug Fixes

* Add explicit generic type parameters for mypy strict mode ([fc0dd3b](https://github.com/oddessentials/ado-git-repo-insights/commit/fc0dd3b84a6ad561111a5ed4d6984ce037724c89))


### Features

* Add semantic-release for automated versioning ([8e61606](https://github.com/oddessentials/ado-git-repo-insights/commit/8e61606608c24bf296dd6297eb979e7d0fddacf2))
* Close all implementation gaps ([a13b5f0](https://github.com/oddessentials/ado-git-repo-insights/commit/a13b5f0b92cd7142349749f410a22583d9bed3dd))
* Integration tests for Victory Gates 1.3-1.5 ([7ba49af](https://github.com/oddessentials/ado-git-repo-insights/commit/7ba49afb176e3a3c62d486c5ed42644648dd0987))
* phase 1 & 2 ([f922a03](https://github.com/oddessentials/ado-git-repo-insights/commit/f922a03661db0ac49ea53c382c6d24e10eb70ae0))
* Phase 1 & 2 - Repository foundation and persistence layer ([a0a3fe9](https://github.com/oddessentials/ado-git-repo-insights/commit/a0a3fe99d2d9ec664376b5186c52cfd19e0616fd))
* Phase 11 - Extension metadata, icon, and Node20 upgrade ([4ac18bf](https://github.com/oddessentials/ado-git-repo-insights/commit/4ac18bf553478e7210115b29f9945d30cc3cdcbf))
* Phase 3 - Extraction strategy with ADO client ([570e0ee](https://github.com/oddessentials/ado-git-repo-insights/commit/570e0ee086cf45263137e3cbb2c73cea2dd40726))
* Phase 4 - CSV generation with deterministic output ([6a95612](https://github.com/oddessentials/ado-git-repo-insights/commit/6a95612cdaf243b27d304942c7e14e2bf3767b27))
* Phase 5 - CLI integration and secret redaction ([0ed0cce](https://github.com/oddessentials/ado-git-repo-insights/commit/0ed0cce375b78b393e30f11bdf41ed23b50b003f))
* Phase 7 CI/CD and Phase 10 rollout ([d22e548](https://github.com/oddessentials/ado-git-repo-insights/commit/d22e5488d32276a169d701e78758f250f66a77be))
