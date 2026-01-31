# [5.17.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.16.0...v5.17.0) (2026-01-31)


### Bug Fixes

* **ci:** exclude test_stage_artifacts from pagination guard ([8ffa151](https://github.com/oddessentials/ado-git-repo-insights/commit/8ffa1518d496597861d7127694993205f984877b))
* **pagination:** integrate extract_continuation_token in ado_client ([0f30d55](https://github.com/oddessentials/ado-git-repo-insights/commit/0f30d551c3c8d9ab87ca1ff74decfa5c95fd84d8))
* **security:** add Windows drive letter detection and improve CI guard ([e643ad4](https://github.com/oddessentials/ado-git-repo-insights/commit/e643ad42f1fd7f2f9eaa123cc48b4d91acc57694))


### Features

* **ci:** add pagination token guard and security regression tests ([7088e20](https://github.com/oddessentials/ado-git-repo-insights/commit/7088e20962eccf9b9a8f46426d23a4788cbb6301))
* **security:** implement Zip Slip protection and pagination token encoding ([a90c466](https://github.com/oddessentials/ado-git-repo-insights/commit/a90c466cea4f354a3730465736a34e60617a0ff4))

# [5.16.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.15.2...v5.16.0) (2026-01-30)


### Bug Fixes

* **hooks:** exclude __pycache__ from CRLF guard in pre-push ([5ac8460](https://github.com/oddessentials/ado-git-repo-insights/commit/5ac84602c19d4e2c81af56fb87f4f6111f193487))


### Features

* **ci:** add get-coverage-actuals.py script ([5286a4b](https://github.com/oddessentials/ado-git-repo-insights/commit/5286a4b381ac420cada984b65b3a96b6fafd0370))
* **ci:** add threshold-change-guard and canonical leg comments ([29c6353](https://github.com/oddessentials/ado-git-repo-insights/commit/29c63530f2d170883d0732e89747151b07642f8a))
* **coverage:** update thresholds using ratchet formula [threshold-update] ([67914d9](https://github.com/oddessentials/ado-git-repo-insights/commit/67914d9c3b6e0f95e317b987902d135278192cbc))

## [5.15.2](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.15.1...v5.15.2) (2026-01-30)


### Bug Fixes

* **ci:** preserve verify script before badges branch switch ([2324cdd](https://github.com/oddessentials/ado-git-repo-insights/commit/2324cdd065402f472ce9d309ed67aa1168f489fa))

## [5.15.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.15.0...v5.15.1) (2026-01-30)


### Bug Fixes

* **ci:** enable coverage in test:ci for badge artifacts ([e58d483](https://github.com/oddessentials/ado-git-repo-insights/commit/e58d4834d87bd21cd609f6a4874599304430ea1e))

# [5.15.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.14.0...v5.15.0) (2026-01-30)


### Bug Fixes

* **ci:** correct script verification and pnpm messaging ([4a443bd](https://github.com/oddessentials/ado-git-repo-insights/commit/4a443bd6927c47bfdcc7b365ba21ddb3d1946255))
* **ci:** extract URL verification to separate script ([8d7a87a](https://github.com/oddessentials/ado-git-repo-insights/commit/8d7a87ab21b1dca18e8cd3e1dc1c64e564109449))
* **ci:** harden badge-publish error handling ([953bdb0](https://github.com/oddessentials/ado-git-repo-insights/commit/953bdb09a59afc18500530c8465699f1c9da21cc))


### Features

* **ci:** add dynamic CI badges with Shields.io ([cca002b](https://github.com/oddessentials/ado-git-repo-insights/commit/cca002b45f72068babe3ce2abbec4818532c4dad))

# [5.14.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.13.0...v5.14.0) (2026-01-30)


### Bug Fixes

* **ci:** complete pnpm migration with zero exclusions ([ec53312](https://github.com/oddessentials/ado-git-repo-insights/commit/ec53312accc3c6b93ef09c5442c743ef496eb4fa))
* **ci:** correct pnpm detection in preinstall guard ([1286ff9](https://github.com/oddessentials/ado-git-repo-insights/commit/1286ff96b25b6140b9f63e2db6cfc9803e9eebd6))
* **ci:** harden CI guards with explicit error handling ([794f957](https://github.com/oddessentials/ado-git-repo-insights/commit/794f9578bbd2e3c6bf30deceda1e9cb4915e9207))


### Features

* **root:** migrate from npm to pnpm with defense-in-depth blocking ([435b7e8](https://github.com/oddessentials/ado-git-repo-insights/commit/435b7e846fe206eb722db53cc112fef1cff785f5))

# [5.13.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.12.0...v5.13.0) (2026-01-29)


### Bug Fixes

* **ci:** close review gaps - complete enforcement parity ([45324e3](https://github.com/oddessentials/ado-git-repo-insights/commit/45324e39b2b7e9234930121b96cc61ce155790df)), closes [#3](https://github.com/oddessentials/ado-git-repo-insights/issues/3) [#1](https://github.com/oddessentials/ado-git-repo-insights/issues/1) [#2](https://github.com/oddessentials/ado-git-repo-insights/issues/2)
* **lint:** scope production lint to ui/ only ([628e6ad](https://github.com/oddessentials/ado-git-repo-insights/commit/628e6ad6ec706cf1539583e3432369c3a4d3e67f))
* **security:** harden suppression audit and fix log forging ([b90434c](https://github.com/oddessentials/ado-git-repo-insights/commit/b90434c420edebc2ebde43b97649a5c8c969931e))
* **types:** remove type: ignore comment in database.py ([f37a941](https://github.com/oddessentials/ado-git-repo-insights/commit/f37a9414b52c6684517bea563f8d3ee12d207247))
* **types:** remove unsafe non-null assertions in TypeScript ([b48428b](https://github.com/oddessentials/ado-git-repo-insights/commit/b48428ba08e7cf6768adc8ffa50f9f6cbc9270ad))
* **types:** replace any with specific type for DOM cache in dashboard ([6080b0f](https://github.com/oddessentials/ado-git-repo-insights/commit/6080b0f9bf095410dd4ce202a59836a7f5a22911))
* **types:** resolve mypy errors in ML modules ([8ed7193](https://github.com/oddessentials/ado-git-repo-insights/commit/8ed7193dea4925712839f0c7ea90147c32b48733))
* **types:** separate DOM element caches for type safety ([65d5f35](https://github.com/oddessentials/ado-git-repo-insights/commit/65d5f35d2b3b15625bfcc96b641a83e2a88bd755))


### Features

* **ci:** add mypy type checking to pre-push and CI (Phase 3 - US1) ([87c3bd4](https://github.com/oddessentials/ado-git-repo-insights/commit/87c3bd4bc6bea07b64506d2bcde58fa62ed901c4))
* **ci:** add suppression audit CI job (Phase 5 - US3) ([6b420be](https://github.com/oddessentials/ado-git-repo-insights/commit/6b420bed210a2d7a911b3669e52cfa7a130b5753))
* **ci:** add suppression audit script and baseline (Phase 2) ([f0a4408](https://github.com/oddessentials/ado-git-repo-insights/commit/f0a44080855bbb7448c20eb5ee97c4fcf05ef002))
* **ci:** enforce non-null assertion rule (Phase 4 - US2) ([468c4b8](https://github.com/oddessentials/ado-git-repo-insights/commit/468c4b8600b490decb156e613496fde12007a7ae))
* **ci:** standardize Python suppression format (Phase 7 - US5) ([f737fea](https://github.com/oddessentials/ado-git-repo-insights/commit/f737fea611fd76d9a8f4e6bb5fff5e8a5e8ef57e))

# [5.12.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.11.0...v5.12.0) (2026-01-29)


### Bug Fixes

* **ci:** add packageManager to root package.json for pnpm/action-setup@v4 ([bd03eee](https://github.com/oddessentials/ado-git-repo-insights/commit/bd03eeed7ed314e9c4f17759a27186b2a00e898e))
* **ci:** resolve build-extension and fresh-clone-verify failures ([0b75094](https://github.com/oddessentials/ado-git-repo-insights/commit/0b750949689a2d7cc2bfaf142c7e9de9b69e9da7))
* correct all remaining scriptPath references in performance.test.ts ([9dd46f5](https://github.com/oddessentials/ado-git-repo-insights/commit/9dd46f5900e33b53da50b8e717246b0f127f8be9))
* correct relative paths in moved performance test and update gitignore ([e5f4893](https://github.com/oddessentials/ado-git-repo-insights/commit/e5f4893d325d919cf9d9a3f349a252dccd196db8))
* **test:** increase timing threshold for flaky waitForDom test ([e1ab4c6](https://github.com/oddessentials/ado-git-repo-insights/commit/e1ab4c6fc7ca4c431f20e46ffa1972e09848a58c))
* **test:** remove @jest/globals import in favor of global jest ([09c3cac](https://github.com/oddessentials/ado-git-repo-insights/commit/09c3cacfee3306bbe9406d5e6bc8420d431a11d4))
* **test:** resolve @jest/globals module resolution for CI ([4724b38](https://github.com/oddessentials/ado-git-repo-insights/commit/4724b38003c1d4373fbd6a89b8af4de1ad84008d))


### Features

* **ci:** add regression guards, documentation, and job separation ([f770fae](https://github.com/oddessentials/ado-git-repo-insights/commit/f770fae8704fbe448621d0c6f5bd825ecd29c258))
* **ci:** add shared pnpm setup action and isolate Python tests ([c6454dd](https://github.com/oddessentials/ado-git-repo-insights/commit/c6454dd62d4c2044946966ba2afb69639d20a402))
* **ml:** enable ML features with 5-state gating and migrate to pnpm ([0a2d012](https://github.com/oddessentials/ado-git-repo-insights/commit/0a2d012c5fce776420fb1f517b2822e5c4928252))

# [5.11.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.10.0...v5.11.0) (2026-01-29)


### Bug Fixes

* add undefined check for manifest_schema_version ([b6d52e3](https://github.com/oddessentials/ado-git-repo-insights/commit/b6d52e3608ec044666a4242c994e8abef252801e))


### Features

* **schema:** add runtime schema validation with DatasetLoader integration ([756828f](https://github.com/oddessentials/ado-git-repo-insights/commit/756828fff9ab2cf945248e0ab16f44272bc18c7e))
* **test:** add test harnesses and tiered coverage thresholds ([843f07e](https://github.com/oddessentials/ado-git-repo-insights/commit/843f07ed8a38fc0de5c637ea0e7dea4b5faebbfa))

# [5.10.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.9.0...v5.10.0) (2026-01-28)


### Bug Fixes

* **test:** fix VSIX artifact inspection on Windows ([72be951](https://github.com/oddessentials/ado-git-repo-insights/commit/72be9513a0f7a7d661d9e140dc520f03832b031d))


### Features

* **coverage:** add Codecov flags and local/CI parity ([9cfe3db](https://github.com/oddessentials/ado-git-repo-insights/commit/9cfe3db27154b0800ebae2ad95e4d1aab14f6ab3))
* **security:** complete 008 security hardening implementation ([6f40e78](https://github.com/oddessentials/ado-git-repo-insights/commit/6f40e7881e27e046fb12da932a3015663aeac2ca))
* **security:** Phase 1-2 setup and foundational changes ([dafb955](https://github.com/oddessentials/ado-git-repo-insights/commit/dafb9557b84e8bea6feaa44d1195b8c567094ac0))

# [5.9.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.8.0...v5.9.0) (2026-01-28)


### Features

* **compliance:** upgrade to @oddessentials/repo-standards v7.1.1 ([c07fc38](https://github.com/oddessentials/ado-git-repo-insights/commit/c07fc382e221b74d450ffe898e98278beb22c9ba))

# [5.8.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.7.0...v5.8.0) (2026-01-28)


### Bug Fixes

* address static analysis feedback and flaky CI test ([0d086bf](https://github.com/oddessentials/ado-git-repo-insights/commit/0d086bfebf4dc0f08e753b751df54cfd9b24ca80))


### Features

* **ml:** harden forecaster against edge cases ([c9194e5](https://github.com/oddessentials/ado-git-repo-insights/commit/c9194e530ce2013bcdf193bc9cf757b7e13a27fd))

# [5.7.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.6.0...v5.7.0) (2026-01-28)


### Bug Fixes

* **ml:** accuracy fixes for P90 calculation, review time, and synthetic data ([81f84c1](https://github.com/oddessentials/ado-git-repo-insights/commit/81f84c1da6deecb4590ef3b92dd73cdb64954d38))
* **ml:** use ceiling-based rank for P90 on small datasets ([1e19c3a](https://github.com/oddessentials/ado-git-repo-insights/commit/1e19c3a0734ef3ef75549af101f140af4bbdb8f9))
* **ui:** display historical data in forecast charts (US1 Acceptance Scenario 4) ([de0e51c](https://github.com/oddessentials/ado-git-repo-insights/commit/de0e51cf9dd3f4fc887c9a6f6db67faf92a6105c))


### Features

* **insights:** add deterministic sorting and rich insight cards (Phase 4: US2) ([6c44912](https://github.com/oddessentials/ado-git-repo-insights/commit/6c44912efe497647ffdb18a2d44c10399f834d34))
* **ml:** add dev mode preview with synthetic data fallback (Phase 5: US3) ([71e3688](https://github.com/oddessentials/ado-git-repo-insights/commit/71e36881a9ebd7b8e5133a145b56932a428d3824))
* **ml:** add FallbackForecaster for zero-config predictions ([8088921](https://github.com/oddessentials/ado-git-repo-insights/commit/80889218dbaf93908e5e416578374c09d15cf20b))
* **ml:** add in-dashboard setup guides for ML features (Phase 6: US4) ([bf1c7f6](https://github.com/oddessentials/ado-git-repo-insights/commit/bf1c7f6f4a684839d160ecddf1fe8561ebc44399))
* **ml:** add v2 type definitions for enhanced insights and predictions ([1f87eab](https://github.com/oddessentials/ado-git-repo-insights/commit/1f87eabd10428f41983260f525640ceeebe45f25))
* **ml:** use get_forecaster() factory for zero-config predictions (T020) ([1f9bb55](https://github.com/oddessentials/ado-git-repo-insights/commit/1f9bb55ff96d8d61b0c686a1ce2432d6b17cc769))
* **ui:** add forecast charts with confidence bands (T021-T028) ([6a24635](https://github.com/oddessentials/ado-git-repo-insights/commit/6a24635bf30921f4c4cd638a3c33e446dda5cca1))

# [5.6.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.5.0...v5.6.0) (2026-01-27)


### Bug Fixes

* defense-in-depth improvements for CLI distribution ([8cc5e46](https://github.com/oddessentials/ado-git-repo-insights/commit/8cc5e46e08c7648b39848c0e7cf6232aac533e39))


### Features

* **cli:** implement T018 PATH guidance at CLI startup ([7a12f55](https://github.com/oddessentials/ado-git-repo-insights/commit/7a12f55a5f3c6ac5332072f4876b83fad7206477))

# [5.5.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.4.0...v5.5.0) (2026-01-26)


### Bug Fixes

* address code review feedback for serve-related code ([24080c4](https://github.com/oddessentials/ado-git-repo-insights/commit/24080c4c6ea8832967787de9dd8bd2315c0b124d))


### Features

* **002:** Address review feedback for --serve feature ([45895e2](https://github.com/oddessentials/ado-git-repo-insights/commit/45895e251e918cce1be70d7c8de8de3dd5edac62))

# [5.4.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.3.0...v5.4.0) (2026-01-26)


### Features

* **cli:** implement --serve, --open, --port flags for build-aggregates (Flight 260127A) ([668151e](https://github.com/oddessentials/ado-git-repo-insights/commit/668151e98484f2fb311fe6c6f2b2966407c3047d))

# [5.3.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.2.0...v5.3.0) (2026-01-26)


### Bug Fixes

* **build:** add clean-before-build to prevent stale file accumulation ([1fa603e](https://github.com/oddessentials/ado-git-repo-insights/commit/1fa603e82184f7ccc7f03b68860f704d206a98a5))
* **ci:** align test thresholds and add Python 3.10 pandas support (Flight 5 Phases 2-3) ([e59e47e](https://github.com/oddessentials/ado-git-repo-insights/commit/e59e47ea102ea37099208c03c1319be466073c26))
* **ci:** replace Unicode symbols with ASCII for Windows encoding safety ([f92e4d8](https://github.com/oddessentials/ado-git-repo-insights/commit/f92e4d8192d0c9f0b7c8fb4c5bda281c7fb76f4a))
* **depcruise:** add targeted chart module exceptions (Flight 5 Phase 1) ([1982217](https://github.com/oddessentials/ado-git-repo-insights/commit/19822179971ccc56fe6df5a232c17646cc773c58))
* **extension:** update test:vsix to use Jest 30 --testPathPatterns ([f9fcb27](https://github.com/oddessentials/ado-git-repo-insights/commit/f9fcb27e3489406260f00196835ca96145618d1e))
* remove unused type ignore comment (mypy cleanup) ([d06ac2a](https://github.com/oddessentials/ado-git-repo-insights/commit/d06ac2a4262c0c0400cd4cf0c656721d9a789198))
* **security:** harden GitHub Actions against command injection ([758f2d8](https://github.com/oddessentials/ado-git-repo-insights/commit/758f2d8c9382ad035c705861bdc7b3f14962147e))
* **security:** remediate DOM XSS via escapeHtml ([5a6c188](https://github.com/oddessentials/ado-git-repo-insights/commit/5a6c188d72b2aaab83b4ee1001767aabb75fe735))


### Features

* **security:** add preventative enforcement for XSS patterns ([5f38539](https://github.com/oddessentials/ado-git-repo-insights/commit/5f38539e84772ee1de65d733c06d55e0f158e4c5))

# [5.2.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.1.0...v5.2.0) (2026-01-24)


### Bug Fixes

* **modules:** address code quality feedback ([53a0c1e](https://github.com/oddessentials/ado-git-repo-insights/commit/53a0c1e5b3f7f844601c73551172ca3d7d887d6c))


### Features

* **ci:** add dependency-cruiser for one-way rule enforcement ([c5a774a](https://github.com/oddessentials/ado-git-repo-insights/commit/c5a774ae34ebece776263acbf774ac0eb23b1326))
* **dashboard:** add filters, comparison, and export modules ([cfe1eab](https://github.com/oddessentials/ado-git-repo-insights/commit/cfe1eaba8f24d3c778375f81429219308174a5f3))
* **dashboard:** add modular architecture for dashboard refactor ([0aaf161](https://github.com/oddessentials/ado-git-repo-insights/commit/0aaf1617952d406de8e10aceeda3d2d67cd9ade4))

# [5.1.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.0.0...v5.1.0) (2026-01-24)


### Bug Fixes

* **types:** remediate no-explicit-any warnings in Phase 2A/2B/2D ([09375bf](https://github.com/oddessentials/ado-git-repo-insights/commit/09375bfc103c1fea7619652284d07446ad333677))


### Features

* **artifact-client:** add public authenticatedFetch() method ([7ed074e](https://github.com/oddessentials/ado-git-repo-insights/commit/7ed074ee23025de827c4a50dfb50f56d3b0d3939))
* **types:** add dashboard typing interfaces for strict type remediation ([b324fb5](https://github.com/oddessentials/ado-git-repo-insights/commit/b324fb58274937612322648e4fcd87b7faa98dfd))

# [5.0.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v4.2.3...v5.0.0) (2026-01-24)


* feat!: harden stage-artifacts contract with strict layout enforcement ([a03432d](https://github.com/oddessentials/ado-git-repo-insights/commit/a03432d504308110e345b741377a5358d6ddd877))


### Bug Fixes

* **ci:** add Python setup to ui-bundle-sync job ([9854c7d](https://github.com/oddessentials/ado-git-repo-insights/commit/9854c7ddd63c9b11bba803b7b18c85eab322b6e4))
* **ci:** resolve TypeScript declaration conflicts causing test collection failure ([1dd821e](https://github.com/oddessentials/ado-git-repo-insights/commit/1dd821e70b27f53efe82ce4e77f0fc2ae105b405))
* **lint:** replace error: any catches with type-safe error narrowing ([e47bbcf](https://github.com/oddessentials/ado-git-repo-insights/commit/e47bbcfb5268d9c8b467172706610c93ca23e97b))
* **lint:** resolve floating promise warnings in dashboard.ts and settings.ts ([8908ac1](https://github.com/oddessentials/ado-git-repo-insights/commit/8908ac12610b52931c13381ae0c96c6a973d4268))
* **lint:** use typed window augmentation for global exports ([01791c4](https://github.com/oddessentials/ado-git-repo-insights/commit/01791c487266b9a0f9978817c387d8795d87da6c))
* prevent artifact double-nesting at source + harden cli.py ([13d4ae1](https://github.com/oddessentials/ado-git-repo-insights/commit/13d4ae1976dedb4b5360420beaf4d2141e7d9e1f))
* **types:** correct return types in cli.py ([e8fa8be](https://github.com/oddessentials/ado-git-repo-insights/commit/e8fa8be565945682d3c4704d7da3df748b0c5c7a))
* **types:** guard optional openai/prophet imports for mypy ([bcc1366](https://github.com/oddessentials/ado-git-repo-insights/commit/bcc13661c451fef35c7041361fec4a827be124c4))
* **types:** remediate no-explicit-any warnings in dataset-loader and artifact-client ([143ab07](https://github.com/oddessentials/ado-git-repo-insights/commit/143ab070827286e77ee75aa8673bf682ce038a4b))
* **types:** remove circular typeof import() in Window augmentation ([0c111c9](https://github.com/oddessentials/ado-git-repo-insights/commit/0c111c92067a749c6e13c165cd99a2cb34f50e4a))
* **types:** remove stale type-ignore comments in aggregators ([c9c9321](https://github.com/oddessentials/ado-git-repo-insights/commit/c9c9321ef57e07d5e184113880e42715ec745ef7))


### Features

* deterministic UI bundle sync for local dashboard ([959350e](https://github.com/oddessentials/ado-git-repo-insights/commit/959350e2fb901b2449adb27cf393cdc3f4615463))
* **types:** add shared type definitions for VSS SDK and data structures ([533912b](https://github.com/oddessentials/ado-git-repo-insights/commit/533912bcb3baeafc5ffd07426144db720893d288))


### BREAKING CHANGES

* Legacy 'aggregates/' fallback path removed from dataset discovery.
Staged artifacts must now have dataset-manifest.json at root (flat layout).
Use 'ado-insights stage-artifacts' to normalize legacy artifacts.

Changes:
- Deterministic build selection: sort by finishTime, not API order
- Accept 'partiallySucceeded' builds (artifacts are valid)
- Bounded lookback: maximum 10 builds checked per invocation
- Layout normalization: flatten aggregates/aggregates at extraction time
- Versioned validation: check manifest_schema_version (v1 only)
- Fail-fast contract validation before dashboard launch
- Structured JSON summary: STAGE_SUMMARY={...} for automation parsing
- New CONTRACT.md documenting all invariants

New tests:
- 22 tests in test_stage_artifacts.py (build selection, normalization, validation)
- 3 mutation tests for layout enforcement (prevents re-introduction)
- Fixed test fixtures for offline testing

Updated tests:
- test_dataset_discovery.py updated for strict flat-layout-only behavior

## [4.2.3](https://github.com/oddessentials/ado-git-repo-insights/compare/v4.2.2...v4.2.3) (2026-01-23)


### Reverts

* Revert "Merge pull request [#73](https://github.com/oddessentials/ado-git-repo-insights/issues/73) from oddessentials/fix/node16-eol-warning" ([5f4ffa8](https://github.com/oddessentials/ado-git-repo-insights/commit/5f4ffa8609858be91b68a4ab1c1ce87058e30703))

## [4.2.2](https://github.com/oddessentials/ado-git-repo-insights/compare/v4.2.1...v4.2.2) (2026-01-23)


### Bug Fixes

* remove deprecated Node16 handler to fix EOL warning ([c6730c0](https://github.com/oddessentials/ado-git-repo-insights/commit/c6730c008d25f39794a4606f0bc281bbadafd3cd))

## [4.2.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v4.2.0...v4.2.1) (2026-01-23)


### Bug Fixes

* add build steps to release workflow before VSIX packaging ([d5d45b4](https://github.com/oddessentials/ado-git-repo-insights/commit/d5d45b43205faf344434e8d22ba094f80fe9a58d))

# [4.2.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v4.1.1...v4.2.0) (2026-01-23)


### Bug Fixes

* add VSS SDK sync guard to pre-commit hook ([a950256](https://github.com/oddessentials/ado-git-repo-insights/commit/a950256e2c645688af7dc4530d50aa6596224f4f))
* **ci:** add pretest:ci hook to build UI before test:ci ([273620e](https://github.com/oddessentials/ado-git-repo-insights/commit/273620eced85125e90c34a6bd6673d884cb5e529))
* **ci:** correct build-extension step order and add shipping invariant ([977ea05](https://github.com/oddessentials/ado-git-repo-insights/commit/977ea05db9871c9aaa49d0a6e2f409ecda582885))
* **extension:** package dist/ui instead of ui source files ([7922e01](https://github.com/oddessentials/ado-git-repo-insights/commit/7922e01e1f0e3bc9b91011b1863a4506a3708ce4))
* **gitignore:** remove misleading task node_modules un-ignore ([b8ec7d4](https://github.com/oddessentials/ado-git-repo-insights/commit/b8ec7d48db469e25ce6e407c23b1b7817842ccd4))
* package ([def8315](https://github.com/oddessentials/ado-git-repo-insights/commit/def8315cbf39c5d36ed5034ae09036cb3c3bcc7a))
* restructure git hooks and CI test validation ([ac4924c](https://github.com/oddessentials/ado-git-repo-insights/commit/ac4924c88736b69e92d707103fc1d29eae1a9d5f))
* sync VSS.SDK.min.js with current npm package version ([15b2e27](https://github.com/oddessentials/ado-git-repo-insights/commit/15b2e27e56354591455aebc606f16131827dfb9d))


### Features

* **ci:** implement two-tier VSIX test enforcement ([2c1d731](https://github.com/oddessentials/ado-git-repo-insights/commit/2c1d7318b768d0b5ddb7bfd95a5bd83a6ebf5c60))

## [4.1.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v4.1.0...v4.1.1) (2026-01-23)


### Bug Fixes

* BREAKING CHANGE, fix extension ([63b12f0](https://github.com/oddessentials/ado-git-repo-insights/commit/63b12f068cf2bb4ac6eee291a16fa9fb6d7a7ce5))
* BREAKING CHANGE, fix extension ([d6465ea](https://github.com/oddessentials/ado-git-repo-insights/commit/d6465ea5738db9a8b2ea1f28e61021ecc96f0a93))

# [4.1.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v4.0.2...v4.1.0) (2026-01-23)


### Features

* **extension:** add VSIX packaging pipeline with task dependency staging ([a07f59f](https://github.com/oddessentials/ado-git-repo-insights/commit/a07f59f7871997f8f744b43f3b528231a9fe42ff))

## [4.0.2](https://github.com/oddessentials/ado-git-repo-insights/compare/v4.0.1...v4.0.2) (2026-01-23)


### Bug Fixes

* **extension:** bundle task node_modules for VSIX packaging ([8422be0](https://github.com/oddessentials/ado-git-repo-insights/commit/8422be07e247c06dff8a3a39ce1dffeec70584f6))

## [4.0.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v4.0.0...v4.0.1) (2026-01-22)


### Bug Fixes

* **build:** auto-build UI bundles in pre-commit hook ([3893243](https://github.com/oddessentials/ado-git-repo-insights/commit/3893243487a923ea8a70e19128d88800bdd2ca38))
* **dashboard:** use correct property names for filter dropdowns ([f20e6b0](https://github.com/oddessentials/ado-git-repo-insights/commit/f20e6b05e726991d40cc45270453e02933833a89))

# [4.0.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v3.8.3...v4.0.0) (2026-01-22)


### Bug Fixes

* address reviewer feedback on cli and dependencies ([edb86ce](https://github.com/oddessentials/ado-git-repo-insights/commit/edb86cec9520a31975ddc0bc0bc79bfb96176ea9))
* **aggregates:** move manifest to artifact root and cut over discovery ([7a569df](https://github.com/oddessentials/ado-git-repo-insights/commit/7a569df1fbc57b70b35a53a5ba6d846b6d5daeca))
* **build:** cross-platform CRLF→LF normalization for VSS.SDK.min.js ([eb4de2b](https://github.com/oddessentials/ado-git-repo-insights/commit/eb4de2beec685a93c0b748b8d4de9a37c7ea63a7))
* **build:** update ui_bundle and harden sync script ([d94f482](https://github.com/oddessentials/ado-git-repo-insights/commit/d94f48275aace2975f6dd904242fb3cf43800d1c))
* **ci:** resolve 4 CI pipeline failures ([c94318a](https://github.com/oddessentials/ado-git-repo-insights/commit/c94318aed5aaa4d86d60aae9d7b83995fff912ec))
* **cli:** add UTF-8 encoding for dashboard HTML read/write on Windows ([bf1442a](https://github.com/oddessentials/ado-git-repo-insights/commit/bf1442a9a34c46256c0608e67518c3667e89c340))
* **release:** compile TypeScript stamp script before execution ([a121be3](https://github.com/oddessentials/ado-git-repo-insights/commit/a121be36c4d766e68a3d92ad034cc9e243cef7ac))
* **release:** harden semantic-release script and dashboard caching ([ae12c4b](https://github.com/oddessentials/ado-git-repo-insights/commit/ae12c4b79c607a408a3038787e4b49b9a25b3e40))
* resolve merge conflict in vss-extension.json ([4c69c14](https://github.com/oddessentials/ado-git-repo-insights/commit/4c69c14367d3995c4c8912e39dfb8a513dca96c1))
* resolve merge conflicts from main merge ([55d5d0c](https://github.com/oddessentials/ado-git-repo-insights/commit/55d5d0c84940ee5defd2614a9cfd6a02c434db61))
* sync package-lock.json with package.json ([7b7807d](https://github.com/oddessentials/ado-git-repo-insights/commit/7b7807dd054a0aaef87d67c4284eb5f45f2b8629))
* **tests:** align LOCAL_DASHBOARD_MODE type declarations ([fd43cc6](https://github.com/oddessentials/ado-git-repo-insights/commit/fd43cc658059ed26e8251f7b1c0fe8f4e09512dc))
* **validation:** align schema field check with DatasetManifest contract ([c509439](https://github.com/oddessentials/ado-git-repo-insights/commit/c50943982467bb7e36d0ae8c4f2c9840dc4b4c32))


### Features

* **ci:** guards for no TS/ESM in ui_bundle + sync enforcement ([707e4ac](https://github.com/oddessentials/ado-git-repo-insights/commit/707e4aca101eb6e3cdbc4decd82ef9c68bb7ab10))
* **cli:** label local-db aggregates as DEV mode and stage-artifacts as recommended ([048803e](https://github.com/oddessentials/ado-git-repo-insights/commit/048803e90f130870296dc3c649388dcd8d9e9e3d))
* **cli:** stage pipeline artifacts to ./run_artifacts + dataset root discovery ([683e53a](https://github.com/oddessentials/ado-git-repo-insights/commit/683e53a98276a2b9def549c186121f5eb50e96c1))
* **extension:** complete TypeScript conversion and standards alignment ([d990a2f](https://github.com/oddessentials/ado-git-repo-insights/commit/d990a2f62c69f0ba1a30cf49e44b761ac24a6c83))
* **ui-build:** esbuild IIFE bundling + sync_ui_bundle copies dist JS ([768f251](https://github.com/oddessentials/ado-git-repo-insights/commit/768f251dc931b6f7ee9e237a5836d8697cef0668))
* **ui:** DatasetLoader root resolution + tests for nested layouts ([9d2087e](https://github.com/oddessentials/ado-git-repo-insights/commit/9d2087ed9267fbcf1230c92833b2cadb8b0ded91))


### BREAKING CHANGES

* **aggregates:** Old pipeline runs using nested aggregates/aggregates layout
will now fail with guidance to re-run the pipeline and re-stage artifacts.
* **extension:** All extension JavaScript files converted to TypeScript

Phase 1: Tooling Baseline
- Add root tsconfig.json with strict mode
- Add extension/tsconfig.json and scripts/tsconfig.json
- Add types/vss.d.ts for Azure DevOps Extension SDK types

Phase 2: Extension UI Conversion
- Convert error-codes.js → .ts
- Convert error-types.js → .ts
- Convert artifact-client.js → .ts
- Convert dataset-loader.js → .ts
- Convert settings.js → .ts
- Convert dashboard.js → .ts

Phase 3: Extension Tests Conversion
- Convert jest.config.js → .ts with ts-jest
- Convert setup.js → .ts
- Convert all 19 test files to TypeScript
- Add tsconfig.test.json with relaxed settings for tests
- All 374 tests passing

Phase 4: Root Scripts Conversion
- Convert stamp-extension-version.js → .ts
- Convert validate-task-inputs.js → .ts
- Convert update-perf-baseline.js → .ts

Phase 5: CI & Quality Gates
- Add TypeScript type checking step to CI
- Add ESLint step with @typescript-eslint
- Update min test count from 125 to 374
- ESLint passes with 0 errors (150 warnings for transition)

Phase 6: Repo Standards
- Install @oddessentials/repo-standards v6.0.0
- Add standards:ts and standards:py npm scripts

## [3.8.3](https://github.com/oddessentials/ado-git-repo-insights/compare/v3.8.2...v3.8.3) (2026-01-21)


### Bug Fixes

* set Claude model and increase token limit for large PRs ([65f9bd8](https://github.com/oddessentials/ado-git-repo-insights/commit/65f9bd8e7cbe85a0d295115f552034a117560a94))

## [3.8.2](https://github.com/oddessentials/ado-git-repo-insights/compare/v3.8.1...v3.8.2) (2026-01-21)


### Bug Fixes

* add permissions for reusable workflow ([5f64b61](https://github.com/oddessentials/ado-git-repo-insights/commit/5f64b61a20f18e5729e2ec02266c2c088d3a491d))

## [3.8.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v3.8.0...v3.8.1) (2026-01-21)


### Bug Fixes

* remove linux label from runs_on to fix case-sensitivity mismatch ([66adc6c](https://github.com/oddessentials/ado-git-repo-insights/commit/66adc6c050afa608f4e814eedf4d244f960183b7))

# [3.8.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v3.7.1...v3.8.0) (2026-01-21)


### Features

* add AI review integration with OSCR and odd-ai-reviewers ([5e6290b](https://github.com/oddessentials/ado-git-repo-insights/commit/5e6290bfe1a5ddb7900ba0cc9203a2f7913007e6))

## [3.7.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v3.7.0...v3.7.1) (2026-01-19)


### Bug Fixes

* lint and format issues from pre-commit ([5cf98c0](https://github.com/oddessentials/ado-git-repo-insights/commit/5cf98c006ff6749c8a9ccdebdcb624008a850635))
* trailing whitespace and EOF newlines ([0321c80](https://github.com/oddessentials/ado-git-repo-insights/commit/0321c80c01f6f8fe8f6309bcdc4615db8265bb44))

# [3.7.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v3.6.0...v3.7.0) (2026-01-19)


### Features

* **phase7:** complete local mode improvements and version adapter ([402db57](https://github.com/oddessentials/ado-git-repo-insights/commit/402db57e81cf053fdeda5fc5ece2e2cf4460669b))

# [3.6.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v3.5.1...v3.6.0) (2026-01-19)


### Bug Fixes

* **ci:** add two-phase test validation for robust diagnostics ([ea1585a](https://github.com/oddessentials/ado-git-repo-insights/commit/ea1585ae173b8aa68640e6bc70036cf128e50b36))
* **tests:** add last_updated column to teams test fixtures ([f376e6f](https://github.com/oddessentials/ado-git-repo-insights/commit/f376e6f63fa2952f49bb45e6adacf0c483ebb792))


### Features

* **aggregators:** implement by_team dimension slices (Phase 7.2) ([02c0728](https://github.com/oddessentials/ado-git-repo-insights/commit/02c07284a50c150c99fb5591a03da25771c484fd))
* **ci:** add UI bundle sync verification (Phase 7.1) ([0309a5b](https://github.com/oddessentials/ado-git-repo-insights/commit/0309a5b9ac36435f4679892555e04d544b8a3fd2))

## [3.5.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v3.5.0...v3.5.1) (2026-01-19)


### Bug Fixes

* replace ui_bundle symlink with actual files for pip packaging ([6cb3504](https://github.com/oddessentials/ado-git-repo-insights/commit/6cb35048f21805e9cb28bbc47007faeb4eb0bc62))

# [3.5.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v3.4.0...v3.5.0) (2026-01-19)


### Bug Fixes

* use relative symlink for ui_bundle (CI compatibility) ([2d27fcd](https://github.com/oddessentials/ado-git-repo-insights/commit/2d27fcd832b45ffc2f74282a9da2453b05d35a76))


### Features

* **phase6:** add local dashboard and build-aggregates commands ([3233dcd](https://github.com/oddessentials/ado-git-repo-insights/commit/3233dcde7447ec48f71fa7c19b903ca1501e58be))

# [3.4.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v3.3.0...v3.4.0) (2026-01-19)


### Features

* **dashboard:** fix reviewer count bug and implement client-side filtering ([4f0526e](https://github.com/oddessentials/ado-git-repo-insights/commit/4f0526e62ae6ea18372ff7a0adb58fb9cd6b8fd5))

# [3.3.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v3.2.0...v3.3.0) (2026-01-18)


### Bug Fixes

* revert manual version bump, remove obsolete planning doc ([df019c0](https://github.com/oddessentials/ado-git-repo-insights/commit/df019c0738ddc0b3b684e940ed8fcd272e879dec))
* **tests:** resolve ruff linting errors in Phase 5 ML tests ([d816e36](https://github.com/oddessentials/ado-git-repo-insights/commit/d816e3697d1993369f4be82df563faad7d8b435e))


### Features

* **dashboard:** enable Phase 5 features (Predictions & AI Insights tabs) ([649f39e](https://github.com/oddessentials/ado-git-repo-insights/commit/649f39e17ca7c778133aed2dba8df0bf360d4b03))
* **task:** add Phase 5 ML inputs to pipeline task (v2.3.0) ([314c560](https://github.com/oddessentials/ado-git-repo-insights/commit/314c56045ecc531cec7cf60d94b180dc9655b2ea))

# [3.2.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v3.1.0...v3.2.0) (2026-01-18)


### Bug Fixes

* **dashboard:** accept PartiallySucceeded builds and handle stale settings ([f6c3135](https://github.com/oddessentials/ado-git-repo-insights/commit/f6c3135012a857b74c3d8d22a3a8032a470bde56))


### Features

* **dashboard:** add feature flag for Phase 5 tabs with Coming Soon state ([a604462](https://github.com/oddessentials/ado-git-repo-insights/commit/a604462a8edf1f2059a8d23f736d4b26486154a4))

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
