# [3.1.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v3.0.4...v3.1.0) (2026-01-17)


### Features

* **dashboard:** add comparison mode and export functionality (Sprint 5) ([e3fde36](https://github.com/oddessentials/ado-git-repo-insights/commit/e3fde3600f8fd67b13086333abe0c4b54b9b8412))
* **dashboard:** add cycle time trend and reviewer activity charts (Sprint 4) ([93e14dd](https://github.com/oddessentials/ado-git-repo-insights/commit/93e14dd3118d61922293edacc43762ddc0f21fdc))
* **dashboard:** add dimension filter bar with dropdowns (Sprint 2) ([393ede3](https://github.com/oddessentials/ado-git-repo-insights/commit/393ede3b8b44f8e9270bbabd03d9146d5f231385))
* **dashboard:** add raw data ZIP download for pipeline CSV artifacts ([5785d18](https://github.com/oddessentials/ado-git-repo-insights/commit/5785d18aaa33eda95c7c252e266e2cd9c87fd9e2))
* **dashboard:** add sparklines and trend line overlay (Sprint 3) ([8781ddb](https://github.com/oddessentials/ado-git-repo-insights/commit/8781ddb7bbaab71cd9e2dcd5de383a1563f41a7c))
* **dashboard:** add trend deltas and reviewers card (Sprint 1) ([660546d](https://github.com/oddessentials/ado-git-repo-insights/commit/660546d526632998f184c3d698a5c030e7f46d82))

## [3.0.4](https://github.com/oddessentials/ado-git-repo-insights/compare/v3.0.3...v3.0.4) (2026-01-17)


### Bug Fixes

* white spacing ([29f5f4d](https://github.com/oddessentials/ado-git-repo-insights/commit/29f5f4d413492f0e41b486d2762932e754b1e95d))

## [3.0.3](https://github.com/oddessentials/ado-git-repo-insights/compare/v3.0.2...v3.0.3) (2026-01-17)


### Bug Fixes

* **artifact:** use downloadUrl with format=file&subPath (verified working) ([be53de4](https://github.com/oddessentials/ado-git-repo-insights/commit/be53de426619285a782f97f96556cb41836c3846))

## [3.0.2](https://github.com/oddessentials/ado-git-repo-insights/compare/v3.0.1...v3.0.2) (2026-01-17)


### Bug Fixes

* **artifact:** remove duplicated aggregates/ prefix from file paths ([d19688e](https://github.com/oddessentials/ado-git-repo-insights/commit/d19688eb27652de571273922ed496f56c5d6410f))
* **artifact:** try Container API for PipelineArtifacts first ([63376ca](https://github.com/oddessentials/ado-git-repo-insights/commit/63376caf8aca5b0aee281b10b7f7e9f53aa4ceb4))

## [3.0.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v3.0.0...v3.0.1) (2026-01-17)


### Bug Fixes

* **artifact:** correct Pipeline Artifact file URL construction ([9eb9b3c](https://github.com/oddessentials/ado-git-repo-insights/commit/9eb9b3c28406c0307d1704d71d25ff94700ec5a3))

# [3.0.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v2.8.2...v3.0.0) (2026-01-17)


### Bug Fixes

* **artifact:** use getArtifacts lookup instead of broken SDK getArtifact ([6f6ad55](https://github.com/oddessentials/ado-git-repo-insights/commit/6f6ad559eb6c7f5f2f98840122b95b61b119153e))


### BREAKING CHANGES

* **artifact:** Replaced SDK-based artifact metadata retrieval with
direct API lookup. This fixes cross-project artifact access but changes
the internal implementation approach.

## [2.8.2](https://github.com/oddessentials/ado-git-repo-insights/compare/v2.8.1...v2.8.2) (2026-01-17)


### Bug Fixes

* **artifact:** use resource.url directly for container file access ([92f6f85](https://github.com/oddessentials/ado-git-repo-insights/commit/92f6f8523fd4bc219f2b0108d5727b7f2990b9d2))

## [2.8.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v2.8.0...v2.8.1) (2026-01-17)


### Bug Fixes

* **artifact:** use SDK-based file access to resolve 401 errors ([f81c884](https://github.com/oddessentials/ado-git-repo-insights/commit/f81c884cbdf39589e2a877885bed5e328c07e63d))

# [2.8.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v2.7.6...v2.8.0) (2026-01-16)


### Features

* **dashboard:** use configured source project for cross-project access ([54fa822](https://github.com/oddessentials/ado-git-repo-insights/commit/54fa822231dc5f00ed32fa2aeb74206bef2bca48))
* **settings:** add cross-project support with graceful degradation ([bfb8009](https://github.com/oddessentials/ado-git-repo-insights/commit/bfb8009087dd21605a617ec0699109c42df88811))

## [2.7.6](https://github.com/oddessentials/ado-git-repo-insights/compare/v2.7.5...v2.7.6) (2026-01-16)


### Bug Fixes

* **extension:** add queryOrder to all getDefinitions calls ([b74be8a](https://github.com/oddessentials/ado-git-repo-insights/commit/b74be8a0ea42d4b8bf81e73e31d088a504133ecd))

## [2.7.5](https://github.com/oddessentials/ado-git-repo-insights/compare/v2.7.4...v2.7.5) (2026-01-16)


### Bug Fixes

* **extension:** correct queryOrder parameter position ([3d6efb3](https://github.com/oddessentials/ado-git-repo-insights/commit/3d6efb368ebbcdfdf8b168076f4fe3539f5b2d6f))

## [2.7.4](https://github.com/oddessentials/ado-git-repo-insights/compare/v2.7.3...v2.7.4) (2026-01-16)


### Bug Fixes

* **extension:** add queryOrder to prevent pagination error ([d56480b](https://github.com/oddessentials/ado-git-repo-insights/commit/d56480bb937e63dce49c85c998e8d1f8fcf2b051))

## [2.7.3](https://github.com/oddessentials/ado-git-repo-insights/compare/v2.7.2...v2.7.3) (2026-01-16)


### Bug Fixes

* **extension:** use VSS.getAccessToken() instead of broken AuthTokenService ([ccc65aa](https://github.com/oddessentials/ado-git-repo-insights/commit/ccc65aae98e4063b401e150e437ac166ba67c028))

## [2.7.2](https://github.com/oddessentials/ado-git-repo-insights/compare/v2.7.1...v2.7.2) (2026-01-16)


### Bug Fixes

* **ui:** correct hub target and settings API call ([c60eb82](https://github.com/oddessentials/ado-git-repo-insights/commit/c60eb82201913c60adf80384b99224c57b4c10bc))

## [2.7.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v2.7.0...v2.7.1) (2026-01-16)


### Bug Fixes

* **ui:** bundle VSS SDK locally to avoid CDN version drift ([25065aa](https://github.com/oddessentials/ado-git-repo-insights/commit/25065aad4d9c9593c175920735bfce84df7b8a81))

# [2.7.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v2.6.0...v2.7.0) (2026-01-16)


### Bug Fixes

* **pipeline:** add aggregates artifact for dashboard discovery (Phase 5) ([8032d92](https://github.com/oddessentials/ado-git-repo-insights/commit/8032d929c272259ed7cc92571f4a7f84daaf4282))


### Features

* **extension:** move hub to project-level and add settings ([6430866](https://github.com/oddessentials/ado-git-repo-insights/commit/64308663b3b2fbdc846f4132337674938a951144))
* **pipeline:** add production pipeline template (Phase 4) ([d64d417](https://github.com/oddessentials/ado-git-repo-insights/commit/d64d4178de25ff526adfa356626772bf6ad93136))
* **task:** enable generateAggregates by default ([66201e9](https://github.com/oddessentials/ado-git-repo-insights/commit/66201e928c336ec6a78acd252e67bc2280d09ea6))
* **ui:** add SDK integration and settings page (Phase 3) ([91c82a4](https://github.com/oddessentials/ado-git-repo-insights/commit/91c82a47e3da55ab2883724aebed6356af95e155))


### Reverts

* remove manual version bump (let semantic-release handle it) ([88ca261](https://github.com/oddessentials/ado-git-repo-insights/commit/88ca261ed6dfa83ab151c51f9aade5aa54f62e3f))

# [2.6.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v2.5.0...v2.6.0) (2026-01-16)


### Bug Fixes

* add noqa comments for XML parsing security warnings ([b14381a](https://github.com/oddessentials/ado-git-repo-insights/commit/b14381a2ee58c392dac89801d8132ce5607ecb6f))
* **ci:** disable coverage for test-base-no-ml subset tests ([673aad3](https://github.com/oddessentials/ado-git-repo-insights/commit/673aad38103a885f4b90b0b1b2ff8ca0f7610e79))
* **ci:** improve baseline integrity check for PR merge context ([12e4b85](https://github.com/oddessentials/ado-git-repo-insights/commit/12e4b8535bc5c3674aa1902277f9e6c8846f2ae1))
* **ci:** increase fetch-depth for baseline integrity check ([aac976f](https://github.com/oddessentials/ado-git-repo-insights/commit/aac976ffac6e03b04593b05f5c067a31c278f124))
* **phase4:** add performance API polyfill and fix synthetic fixture tests ([6672b82](https://github.com/oddessentials/ado-git-repo-insights/commit/6672b8210ad433ba131628722f12b5a49e993f1e))


### Features

* Phase 5 Advanced Analytics & ML implementation ([5f2dd30](https://github.com/oddessentials/ado-git-repo-insights/commit/5f2dd307f5acc41bde81cab57056dd0531fe8fa0))
* **phase4:** add automated date-range warning UX with tests ([002626d](https://github.com/oddessentials/ado-git-repo-insights/commit/002626decd01c69201585004f9c2feb1bb467226))
* **phase4:** add baseline performance tests (simplified) ([841d8d9](https://github.com/oddessentials/ado-git-repo-insights/commit/841d8d9aa6ae82845a02fc4b640cbaa10c63781a))
* **phase4:** add chunked loading with progress and caching ([10f8c1f](https://github.com/oddessentials/ado-git-repo-insights/commit/10f8c1fd6cc5d5e5694add488b250a69746fd72c))
* **phase4:** add CI scaling gates at 1k/5k/10k PRs ([455c821](https://github.com/oddessentials/ado-git-repo-insights/commit/455c8215ea97747b074581ade0e44006e54f8039))
* **phase4:** add contract-validated synthetic generator ([4cd9d11](https://github.com/oddessentials/ado-git-repo-insights/commit/4cd9d116ba21db95ee5b3ed1fe159e0be7edefd5))
* **phase4:** add structured rendering metrics ([1fcdbd9](https://github.com/oddessentials/ado-git-repo-insights/commit/1fcdbd93ec304ddbe019a66fbd303d3c17960cc1))
* **phase5:** add ID stability edge-case tests and base-no-ML CI job ([63d02d7](https://github.com/oddessentials/ado-git-repo-insights/commit/63d02d71f5e1beb960286c42ed0fae73c83ac4ec))
* **phase5:** add ID stability tests and harden base-no-ML CI ([0c7b3a2](https://github.com/oddessentials/ado-git-repo-insights/commit/0c7b3a23d630d732fa1b345903004fad47c92bbf))
* **phase5:** harden ML implementation with contract tests and deterministic IDs ([884e579](https://github.com/oddessentials/ado-git-repo-insights/commit/884e57945e9d8e8d6e89748b5235c101e43be406))


### Performance Improvements

* **ci:** optimize test-base-no-ml job ([4a84332](https://github.com/oddessentials/ado-git-repo-insights/commit/4a84332301818b804a597aa0f8cc691a8fba833b))

# [2.5.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v2.4.0...v2.5.0) (2026-01-14)


### Features

* **phase4:** implement Phase 4 gap closures ([d2ed889](https://github.com/oddessentials/ado-git-repo-insights/commit/d2ed889d60f721646c0e3110774f15910a06e745))

# [2.4.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v2.3.0...v2.4.0) (2026-01-14)


### Bug Fixes

* **manifest:** add predictions/insights schema versions to DatasetManifest ([d4886c0](https://github.com/oddessentials/ado-git-repo-insights/commit/d4886c07ca4cdcf86febd4ece427494f388a26ff))
* **phase3.5:** implement typed state returns per contract ([5d81311](https://github.com/oddessentials/ado-git-repo-insights/commit/5d81311116b57ebd3b449d467e77aed2641d3139))


### Features

* **phase3.5:** implement predictions + AI insights rendering ([6a85b47](https://github.com/oddessentials/ado-git-repo-insights/commit/6a85b47522efc2abb8d1558fe8b4b869aee471d4))

# [2.3.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v2.2.0...v2.3.0) (2026-01-14)


### Bug Fixes

* address reviewer concerns P1 & P2 ([eba807f](https://github.com/oddessentials/ado-git-repo-insights/commit/eba807fb6f64ff2950e6eeffabf0b43c5a20e48f))


### Features

* **phase3.3:** implement team dimension extraction ([0894eb2](https://github.com/oddessentials/ado-git-repo-insights/commit/0894eb240f7e1a3e835a4e4f1e22129e071f1ee3))
* **phase3.4:** implement --include-comments CLI flag with rate limits ([2053b23](https://github.com/oddessentials/ado-git-repo-insights/commit/2053b23b07722ea760bd7c5ab4f69e9e22909fd2))
* **phase3.4:** implement comments/threads extraction ([2b29632](https://github.com/oddessentials/ado-git-repo-insights/commit/2b296325fd245cf99b8038c968332c56afdbb32e))

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
