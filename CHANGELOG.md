# [101.6.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v101.5.0...v101.6.0) (2026-04-14)


### Bug Fixes

* **#272:** canonical test:coverage + fail-closed parser + absolute-path anchoring ([3c876ee](https://github.com/oddessentials/ado-git-repo-insights/commit/3c876ee1ca794a6e040c6e69d297192260ce9f05)), closes [#273](https://github.com/oddessentials/ado-git-repo-insights/issues/273) [#274](https://github.com/oddessentials/ado-git-repo-insights/issues/274)
* **#272:** reject EOF inside an open SF block as SETUP, not co-change ([2d24650](https://github.com/oddessentials/ado-git-repo-insights/commit/2d24650ee7766d6f94419662e8b0609d28a6c11b)), closes [#272](https://github.com/oddessentials/ado-git-repo-insights/issues/272)


### Features

* **#272:** enforce per-file partial-branch count as fail-closed ratchet ([6af1f0b](https://github.com/oddessentials/ado-git-repo-insights/commit/6af1f0b3bb5054dbc38a1127e5783419c73dc720)), closes [#271](https://github.com/oddessentials/ado-git-repo-insights/issues/271) [#273](https://github.com/oddessentials/ado-git-repo-insights/issues/273) [#274](https://github.com/oddessentials/ado-git-repo-insights/issues/274) [#272](https://github.com/oddessentials/ado-git-repo-insights/issues/272)

# [101.5.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v101.4.0...v101.5.0) (2026-04-13)


### Bug Fixes

* **task:** replace env-var entrypoint guard with require.main === module ([1f8881e](https://github.com/oddessentials/ado-git-repo-insights/commit/1f8881e749b76810870dc2168445e0ce784b83b3))


### Features

* **task:** wire --include-comments through ExtractPullRequests@2 ([#260](https://github.com/oddessentials/ado-git-repo-insights/issues/260)) ([ff8e468](https://github.com/oddessentials/ado-git-repo-insights/commit/ff8e4681168350ac72cdfd786750ad5bcffe1d60))


### Reverts

* **task:** undo manual version bump — semantic-release owns versioning ([e7860b1](https://github.com/oddessentials/ado-git-repo-insights/commit/e7860b1f02ca1b47e317149a79cf0bb9431838a4))

# [101.4.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v101.3.0...v101.4.0) (2026-04-08)


### Bug Fixes

* **#217:** add review-time backfill to cmd_build_aggregates entry point ([949a260](https://github.com/oddessentials/ado-git-repo-insights/commit/949a260cabaf53ba1ec185e848b1d9f8041ec7c7)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** address 3 confirmed bugs + 2 gaps from implementation review ([695315f](https://github.com/oddessentials/ado-git-repo-insights/commit/695315ff314e67cc0cf78745f9498f52dcd273d6)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** align demo review_time gating with cycle_time threshold ([0fcf591](https://github.com/oddessentials/ado-git-repo-insights/commit/0fcf591cdbc26b527a615435d25dc5f1bcc58e9f)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** atomically widen schema across all producers and guards ([57cef59](https://github.com/oddessentials/ado-git-repo-insights/commit/57cef590521818697ec73817917eaffec1b3a695)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** backfill all completed PRs on uncapped extraction in v2→v3 ([3e315ba](https://github.com/oddessentials/ado-git-repo-insights/commit/3e315ba5b2ce9b99eba7748837d135bed9965555)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** base coverage on processed PRs not thread presence ([fdd712e](https://github.com/oddessentials/ado-git-repo-insights/commit/fdd712ef205dc1908be44c02dba2977a9078b277)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** branch review fixes — upsert preservation, transaction safety, test boundaries, dev-ex ([3573145](https://github.com/oddessentials/ado-git-repo-insights/commit/357314514e3c6e97e12ee46419be91800a1e51a8))
* **#217:** clear stale coverage stamps on truncated thread reruns ([f4de2d0](https://github.com/oddessentials/ado-git-repo-insights/commit/f4de2d082517bacce6a08720afa7f8af500aab7c)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** convergence, trigger scope, and synthetic ordering correctness ([d67817f](https://github.com/oddessentials/ado-git-repo-insights/commit/d67817f6e81666442e2c0f3d59999ba6ea083b10)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** couple root review_time P50/P90 gating to match production contract ([0428baf](https://github.com/oddessentials/ado-git-repo-insights/commit/0428baf20e8b581d490c3391194ad319b09b39f2)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** coverage requires content + isolate review-time RNG from demo stream ([a14fb73](https://github.com/oddessentials/ado-git-repo-insights/commit/a14fb732293d5baa6d68b31e738a23fdb83b2034)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** coverage status precedence — metadata before thread_count ([c631395](https://github.com/oddessentials/ado-git-repo-insights/commit/c631395d778ae153a460c9ae4cb93279d80b3274)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** derive coverage from per-PR markers, not batch metadata ([d23e5de](https://github.com/oddessentials/ado-git-repo-insights/commit/d23e5de1773451fc2f0ff4db0f420bd990923f62)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** derive review_time solely from pr_comments, not stale reviewers table ([b06ec2e](https://github.com/oddessentials/ado-git-repo-insights/commit/b06ec2e499689e1cc9900dbfb273e9187ab7d321)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** downgrade comment coverage to partial when extraction skips threads ([433d4e2](https://github.com/oddessentials/ado-git-repo-insights/commit/433d4e2d8af6d3929d547d6ea67115bcb43ff624)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** drop post-close approvals and gate coverage on untruncated fetches ([a26ae45](https://github.com/oddessentials/ado-git-repo-insights/commit/a26ae451cca5c3a7b3dab8461bb0c58ec402a3e4))
* **#217:** eliminate module-global review-time RNG for deterministic reruns ([fd767f4](https://github.com/oddessentials/ado-git-repo-insights/commit/fd767f445b5779fa56660a23143c943c370dfbcb)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** evidence-based migration backfill with metadata-independent fallback ([054f87c](https://github.com/oddessentials/ado-git-repo-insights/commit/054f87c0205943a4c96759f607b6c79145922685)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** exclude withdrawn approvals + ground-truth coverage parity ([ee2f62d](https://github.com/oddessentials/ado-git-repo-insights/commit/ee2f62dbb098649fbcce4a537adb861d11bbc404)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** gate review_time aggregation on complete comment coverage ([5d2981c](https://github.com/oddessentials/ado-git-repo-insights/commit/5d2981c5afd463e87a77a12cb64c29866247d2d7)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** ground-truth coverage, coupled demo P50/P90, preserve metadata ([8880ce3](https://github.com/oddessentials/ado-git-repo-insights/commit/8880ce34c420377445ae1f49087d2c8c9f469871)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** guard legacy DB crash + gate synthetic review_time on --include-comments ([5bac303](https://github.com/oddessentials/ado-git-repo-insights/commit/5bac3039981cb88c3972fc963ce3acf34fa0e338)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** guard v3→v4 migration against partial comment schemas ([a36b47e](https://github.com/oddessentials/ado-git-repo-insights/commit/a36b47e458bfc4344dd365606594738c86d21f80)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** harden backfill helper, coverage logic, and test fixtures ([2f50b1d](https://github.com/oddessentials/ado-git-repo-insights/commit/2f50b1d7dcfe65dc1e620a040645b4a2046a5d18)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** harden v3→v4 migration safety, coverage fallback, and test gaps ([8e98320](https://github.com/oddessentials/ado-git-repo-insights/commit/8e983200cc7b27b5aa2581a29a1f4b584cd2dd81)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** independent author P50/P90 accumulation + synthetic threshold parity ([5b6816f](https://github.com/oddessentials/ado-git-repo-insights/commit/5b6816f0eb1a72fad21121f7b0250b0c2c2c01ea)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** per-thread incremental sync prevents skipping never-fetched threads ([df46c26](https://github.com/oddessentials/ado-git-repo-insights/commit/df46c26f52c48ab18173054f04b16f3862258962)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** populate non-null review_time values in all generators and demo data ([0bbc469](https://github.com/oddessentials/ado-git-repo-insights/commit/0bbc46974b9bf57a4121eb0b48dbb703a4bd54cb)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** preserve coverage stamps on truncated reruns with no unseen updates ([b861826](https://github.com/oddessentials/ado-git-repo-insights/commit/b86182672c0778896fa9c983efa6d175c0b5fbd5)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** resolve 9 mypy strict errors in test type annotations ([9f8aa41](https://github.com/oddessentials/ado-git-repo-insights/commit/9f8aa41f151b29097b5ac9d2ad9a4fc6a501551a))
* **#217:** run review-time backfill in aggregate generation path ([7eed440](https://github.com/oddessentials/ado-git-repo-insights/commit/7eed44003349faf1f44d38f404059eec97b63fb3)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** scope coverage downgrade to runs that actually add uncovered PRs ([46f9958](https://github.com/oddessentials/ado-git-repo-insights/commit/46f9958776e405b9aa3fa140b2da2f23e2de750a)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** scope thread identity by PR, rebuild pr_threads with composite PK ([2c57557](https://github.com/oddessentials/ado-git-repo-insights/commit/2c575578ad210253880ff7674502bbf58a8f5e04)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** sync artifact-client.ts SUPPORTED_AGGREGATES_VERSION to 3 [version-override-acknowledged] ([b7db63e](https://github.com/oddessentials/ado-git-repo-insights/commit/b7db63eb2773d737f36e322047c43e6c58c0d039)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** use ground-truth dataset coverage instead of run-scope proxy ([58bf127](https://github.com/oddessentials/ado-git-repo-insights/commit/58bf12731f50927d74dad65b99d6cbb27d26dc8e)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** use production 2-PR threshold for single-dim demo review_time ([c82760b](https://github.com/oddessentials/ado-git-repo-insights/commit/c82760b39a2dcb52eda87d9f7b6334639ad19f13)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** validate dropped threads at thread level, not PR-wide max ([0bdbbe8](https://github.com/oddessentials/ado-git-repo-insights/commit/0bdbbe892aa7f64c593a8f024804643aeecfdb50)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** warn on partial review-time runs + synthetic root threshold parity ([ddbfe64](https://github.com/oddessentials/ado-git-repo-insights/commit/ddbfe64708a34a4e97cd6b6e43c2a9991200fa78)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)


### Features

* **#217:** add review timestamp extraction from PR thread system comments ([1288d24](https://github.com/oddessentials/ado-git-repo-insights/commit/1288d24a3ed8645fad8fdee3af790f177798201f)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** add review_time percentile aggregation to base rollup and all dimension slices ([6a35554](https://github.com/oddessentials/ado-git-repo-insights/commit/6a3555474acd334428cfa877ab27835f973f14c7)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** add review_time type definitions and utility function ([a574600](https://github.com/oddessentials/ado-git-repo-insights/commit/a574600d3b9116f10267b94e8a9e5c3941cb0340)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)
* **#217:** add schema migration v1→v2 and bump AGGREGATES_SCHEMA_VERSION to 3 ([a63fd97](https://github.com/oddessentials/ado-git-repo-insights/commit/a63fd97faa68081aad2a51abd81ba15e2e2f0ebe)), closes [#217](https://github.com/oddessentials/ado-git-repo-insights/issues/217)

# [101.3.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v101.2.0...v101.3.0) (2026-04-04)


### Bug Fixes

* **#223:** add ts-node CommonJS override to prevent __dirname crash ([749c46d](https://github.com/oddessentials/ado-git-repo-insights/commit/749c46df109aa1a967d3b0e1f4024f66e9acbeb3)), closes [#223](https://github.com/oddessentials/ado-git-repo-insights/issues/223)
* **#223:** check parsed.errors in build output format guard resolveConfig ([3605f1c](https://github.com/oddessentials/ado-git-repo-insights/commit/3605f1c68a2079b9ef6e3b0a5d6ea53ab9222cd2)), closes [#223](https://github.com/oddessentials/ado-git-repo-insights/issues/223)
* **#223:** correct false-positive in husky dispatcher corruption check ([51f69cf](https://github.com/oddessentials/ado-git-repo-insights/commit/51f69cf8f5e47d1a70f2410c8bf5948b0360c187)), closes [#223](https://github.com/oddessentials/ado-git-repo-insights/issues/223)
* **#223:** scope build config to Node-only paths, exclude ui/ from tsc emit ([7ccb060](https://github.com/oddessentials/ado-git-repo-insights/commit/7ccb060e7acfe69874223c99f58e199d66665564)), closes [#223](https://github.com/oddessentials/ado-git-repo-insights/issues/223)
* **#223:** update tsconfig pathspec test for new tsconfig.build.json ([d0cfafd](https://github.com/oddessentials/ado-git-repo-insights/commit/d0cfafd0404752aff4287e8c88e2e163995c67f6)), closes [#223](https://github.com/oddessentials/ado-git-repo-insights/issues/223)


### Features

* **#223:** upgrade TypeScript 5.9 → 6.0 with split build/typecheck configs ([61bad2d](https://github.com/oddessentials/ado-git-repo-insights/commit/61bad2d6b362bed9c7a7b61cfc8ed4c02aff3668)), closes [#223](https://github.com/oddessentials/ado-git-repo-insights/issues/223)

# [101.2.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v101.1.0...v101.2.0) (2026-04-04)


### Bug Fixes

* **#248:** remove skipLibCheck: true from all tsconfig files ([b844a97](https://github.com/oddessentials/ado-git-repo-insights/commit/b844a97d4685ab19e0b478bf7eeebf0e983f154a)), closes [#248](https://github.com/oddessentials/ado-git-repo-insights/issues/248) [#243](https://github.com/oddessentials/ado-git-repo-insights/issues/243) [#248](https://github.com/oddessentials/ado-git-repo-insights/issues/248)
* **QG-40:** replace silent isinstance filtering with fail-fast validation ([50fbcbe](https://github.com/oddessentials/ado-git-repo-insights/commit/50fbcbe0664aa1d861ac46f67c1a9ea62ef652c8))
* test the dispatcher git executes, not the tracked hook file ([94261a7](https://github.com/oddessentials/ado-git-repo-insights/commit/94261a7565e4a1530a356b1f4a3676f9e34ca8f7))


### Features

* enforce conventional commit messages via CI gate and local health check ([0e0f0a1](https://github.com/oddessentials/ado-git-repo-insights/commit/0e0f0a126c62f986e9e08396e8d85f84f23dbddf)), closes [#7](https://github.com/oddessentials/ado-git-repo-insights/issues/7)

# [101.1.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v101.0.1...v101.1.0) (2026-04-04)


### Bug Fixes

* **QG-40:** broaden fail-fast isinstance recognition to full body ([2b0400c](https://github.com/oddessentials/ado-git-repo-insights/commit/2b0400cea6157b86143d2aa7ea94717c66da6aa0))
* **QG-40:** close fail-open regressions from narrowing changes ([d919f42](https://github.com/oddessentials/ado-git-repo-insights/commit/d919f421865bea3808acf6fdc69cbc47f1d06d51))
* **QG-40:** eliminate typing.Any from audit-suppressions.py ([3378378](https://github.com/oddessentials/ado-git-repo-insights/commit/33783784cff11d97e72bb1e65443b109c270c8fe)), closes [#243](https://github.com/oddessentials/ado-git-repo-insights/issues/243)
* **QG-40:** eliminate typing.Any from build-demo-dataset.py ([a2b5f55](https://github.com/oddessentials/ado-git-repo-insights/commit/a2b5f553907c906b61d64ad7b1612d5c30ede27e)), closes [#243](https://github.com/oddessentials/ado-git-repo-insights/issues/243)
* **QG-40:** eliminate typing.Any from demo_generation_common.py ([74202df](https://github.com/oddessentials/ado-git-repo-insights/commit/74202df5ccf6390b12fd89de34689058a2787f53)), closes [#243](https://github.com/oddessentials/ado-git-repo-insights/issues/243)
* **QG-40:** eliminate typing.Any from generate-demo-data.py ([199b24d](https://github.com/oddessentials/ado-git-repo-insights/commit/199b24dd03115afee65706b0107427c1c8f837bb)), closes [#243](https://github.com/oddessentials/ado-git-repo-insights/issues/243)
* **QG-40:** eliminate typing.Any from generate-demo-predictions.py ([5869129](https://github.com/oddessentials/ado-git-repo-insights/commit/58691292d189c80ed812358b5bd7e21ae414163b)), closes [#243](https://github.com/oddessentials/ado-git-repo-insights/issues/243)
* **QG-40:** eliminate typing.Any from generate-synthetic-dataset.py ([3121ded](https://github.com/oddessentials/ado-git-repo-insights/commit/3121ded478d6c65e0c8130ee888bb61e2bd66b7a)), closes [#243](https://github.com/oddessentials/ado-git-repo-insights/issues/243)
* **QG-40:** eliminate typing.Any from validate_demo_generation_contract.py ([f297400](https://github.com/oddessentials/ado-git-repo-insights/commit/f297400808f0ac3e82dad9adc441e07ec5d8478c)), closes [#243](https://github.com/oddessentials/ado-git-repo-insights/issues/243)
* **QG-40:** harden AST guards — structural isinstance + qualified calls ([2004128](https://github.com/oddessentials/ado-git-repo-insights/commit/2004128510c5605beddfb7fb17579346f0998114))
* **QG-40:** narrow ast.AST to ast.expr before isinstance guard call ([2702aa3](https://github.com/oddessentials/ado-git-repo-insights/commit/2702aa36b6f5ee3d6e70343772d10a39fbc5aa1f))
* **QG-40:** only allow sys.exit as terminal, reject bare exit ([3193fb4](https://github.com/oddessentials/ado-git-repo-insights/commit/3193fb4d795656629ad732177945dcc4a75ca1e5))
* **QG-40:** replace regex guards with AST-based narrowing enforcement ([add5782](https://github.com/oddessentials/ado-git-repo-insights/commit/add57821fee379a073043d2595c74be9b13c144d))
* **QG-40:** require unconditional exit in fail-fast isinstance guard ([e9a0f51](https://github.com/oddessentials/ado-git-repo-insights/commit/e9a0f518c152bae02b7cd96f2a6bd8f1ff7732e8))
* **QG-40:** restrict terminal-call recognition to sys.exit only ([a93f56a](https://github.com/oddessentials/ado-git-repo-insights/commit/a93f56aea4405544de0a6778ca9ad79859249037))


### Features

* **QG-40:** add CI guards for JSON narrowing discipline ([a2a2528](https://github.com/oddessentials/ado-git-repo-insights/commit/a2a25283f94f8ab1896e311cc84655eb081b76a6))
* **QG-40:** enable cross-file mypy enforcement for scripts/ ([f0c570b](https://github.com/oddessentials/ado-git-repo-insights/commit/f0c570b52bbf24f254c4a9ff009a3f11d8db3217))
* **QG-40:** extend Any-type ratchet scanner to cover scripts/ ([83e31ce](https://github.com/oddessentials/ado-git-repo-insights/commit/83e31ce9fda928d6b189e988dc36157d7ae9d48c)), closes [#243](https://github.com/oddessentials/ado-git-repo-insights/issues/243)

## [101.0.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v101.0.0...v101.0.1) (2026-04-03)


### Bug Fixes

* ACL probe covers .tmp/pytest/, subset detection handles node IDs ([#242](https://github.com/oddessentials/ado-git-repo-insights/issues/242)) ([aa101f8](https://github.com/oddessentials/ado-git-repo-insights/commit/aa101f87b4f9b3002e17e6fb7a6ba8591f46f119))
* add run_pytest.py launcher for per-run coverage isolation ([#242](https://github.com/oddessentials/ado-git-repo-insights/issues/242)) ([a9d9e25](https://github.com/oddessentials/ado-git-repo-insights/commit/a9d9e25b4c5761ecdda2b6bb5e6a029e8e17c0be))
* catch ACL scan enumeration failures as probe errors ([9a0a3ad](https://github.com/oddessentials/ado-git-repo-insights/commit/9a0a3ada3800dfdfd1db4e6f3ed41d43ad09e5b4))
* codex ([60a94d8](https://github.com/oddessentials/ado-git-repo-insights/commit/60a94d820dba40d4333164f8b23cb9b2607db2fd))
* eliminate cleanup-sensitive shared targets from pytest paths ([#242](https://github.com/oddessentials/ado-git-repo-insights/issues/242)) ([83ce322](https://github.com/oddessentials/ado-git-repo-insights/commit/83ce322ec16ffad1bded11948771838fe898c8ca))
* parallel coverage + no cleanup to survive Windows file locks ([#242](https://github.com/oddessentials/ado-git-repo-insights/issues/242)) ([fbd32e2](https://github.com/oddessentials/ado-git-repo-insights/commit/fbd32e23150dd04e1688940beee799168e8a762d))
* per-run isolated pytest paths under repo-owned .tmp/ ([#242](https://github.com/oddessentials/ado-git-repo-insights/issues/242)) ([709a537](https://github.com/oddessentials/ado-git-repo-insights/commit/709a537697ac9910bde70b1d3628f47209cc65fa))
* treat selector-only pytest runs as subset invocations ([270bad9](https://github.com/oddessentials/ado-git-repo-insights/commit/270bad96281ccc194d3480aa45641e491a7d435b))
* treat selector-only pytest runs as subset invocations ([30f1552](https://github.com/oddessentials/ado-git-repo-insights/commit/30f15522a7e98813dc017c5123d2c14303eabc82))
* Windows pytest friction and Node engine enforcement ([#242](https://github.com/oddessentials/ado-git-repo-insights/issues/242)) ([9d8ef29](https://github.com/oddessentials/ado-git-repo-insights/commit/9d8ef29cd231c95ae62dfdc4a6c17fe1af644813))

# [101.0.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v100.0.0...v101.0.0) (2026-04-03)


* feat!: drop Python 3.11 support, add 3.14 to CI matrix ([f7d0467](https://github.com/oddessentials/ado-git-repo-insights/commit/f7d04670044bcb3facb2477b3609e83d080e5d9c))


### BREAKING CHANGES

* Python 3.11 is no longer supported. Minimum version is 3.12.
Entire-Checkpoint: bcad6fc0368d

# [100.0.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v99.34.0...v100.0.0) (2026-04-03)


* feat!: drop Python 3.10 support, add 3.13 to CI matrix ([837544a](https://github.com/oddessentials/ado-git-repo-insights/commit/837544ad20afc61ac9d606fac2229f1f691f3421))
* feat!: drop Python 3.10 support, add 3.13 to CI matrix ([d38f546](https://github.com/oddessentials/ado-git-repo-insights/commit/d38f54644685f10196ca92d38a335bfc4d32a6d4))


### Bug Fixes

* code review ([727433e](https://github.com/oddessentials/ado-git-repo-insights/commit/727433e1e0d5ec0c6c7ad01235f953acc68446c5))
* eliminate 54 of 100 typing.Any usages in src/ (QG-40) ([767c90a](https://github.com/oddessentials/ado-git-repo-insights/commit/767c90a0a0fa0a0d3cbb7ed031559a901065a2f9)), closes [#235](https://github.com/oddessentials/ado-git-repo-insights/issues/235)
* python 3.11 upgrade cleanup ([12424e8](https://github.com/oddessentials/ado-git-repo-insights/commit/12424e8b18010690d19d102064f0ed2f7921b2fa))
* python verson gate to 11 ([444cdbe](https://github.com/oddessentials/ado-git-repo-insights/commit/444cdbe55fbb403d92c4b0efe11c0234b15647fe))


### BREAKING CHANGES

* Python 3.10 is no longer supported. Minimum version is 3.11.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
Entire-Checkpoint: 248993c31b99
* Minimum Python version is now 3.11.

- pyproject.toml: requires-python >= 3.11, classifiers updated,
  pandas conditional deps simplified to >= 3.0.0 only,
  mypy python_version = 3.11, ruff target-version = py311
- CI matrix: [3.11, 3.12, 3.13] (was [3.10, 3.11, 3.12])
- Demo pipeline: all jobs use Python 3.11, baseline constants
  and version checks updated in demo_generation_common.py,
  build-demo.sh, and demo.yml
- types.py: removed sys.version_info guard, imports NotRequired
  directly from typing (available in 3.11+)
- Preflight: BASELINE_PYTHON = 3.11
- ADO pipeline samples: versionSpec 3.11
- Docs: README, CONTRIBUTING, setup, testing, local-cli,
  manual-walkthrough, enable-ml-features all updated
- Committed demo manifest provenance updated to 3.11.x

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
Entire-Checkpoint: 3cc5a78d66fa

# [99.34.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v99.33.2...v99.34.0) (2026-04-03)


### Bug Fixes

* accurate new-file delta counting and IndentationError handling in audit ([#232](https://github.com/oddessentials/ado-git-repo-insights/issues/232)) ([9351b41](https://github.com/oddessentials/ado-git-repo-insights/commit/9351b41f27ded6e7cfac1bc3ed83b2d78071d39d))
* close local-ci suppression parity gaps and harden audit tests ([218b37f](https://github.com/oddessentials/ado-git-repo-insights/commit/218b37fddb4b31e27334bdf91dadec737c28695d))
* close suppression parity gaps for renames and ci baseline loading ([35707ab](https://github.com/oddessentials/ado-git-repo-insights/commit/35707abd6fed03c7e5a9face5269f179d103f981))
* code review ([86f9fb8](https://github.com/oddessentials/ado-git-repo-insights/commit/86f9fb85c47256141b9fc30ba34b920724e2c31e))
* codex ([688155b](https://github.com/oddessentials/ado-git-repo-insights/commit/688155bf9835726d323ea5eaefc17fdcc18641ca))
* codex errors ([37e3787](https://github.com/oddessentials/ado-git-repo-insights/commit/37e3787ad5728d889d06d96742ead168256cfb6f))
* enable check_untyped_defs for tests/ and scripts/ — catch real type errors ([#232](https://github.com/oddessentials/ado-git-repo-insights/issues/232)) ([2da4341](https://github.com/oddessentials/ado-git-repo-insights/commit/2da43417e0f15d2907d22e025a39a4c544e650e4))
* fail suppression diff on missing baseline scopes ([a7b9f52](https://github.com/oddessentials/ado-git-repo-insights/commit/a7b9f52e636086b0d95b69c0847aa24742b7f9d5))
* harden local/CI parity — 12-step quality gate enforcement ([#232](https://github.com/oddessentials/ado-git-repo-insights/issues/232)) ([733f8d4](https://github.com/oddessentials/ado-git-repo-insights/commit/733f8d458beb50ece63a680c7e51de9e42154c85))
* harden quality gates — importlib migration, semantic artifact verify, diff-mode Any ratchet ([#232](https://github.com/oddessentials/ado-git-repo-insights/issues/232)) ([2d5d18c](https://github.com/oddessentials/ado-git-repo-insights/commit/2d5d18c5d41dfd4d8c746f8ce88fc3454cc73404))
* harden subprocess allowlist with (file,line,code) triples and fix shell=True false positive ([#232](https://github.com/oddessentials/ado-git-repo-insights/issues/232)) ([a59fbca](https://github.com/oddessentials/ado-git-repo-insights/commit/a59fbcae0664ae9bcf6d4e7b86593aaa458738ef))
* make scripts/ mypy override effective by adding __init__.py ([#232](https://github.com/oddessentials/ado-git-repo-insights/issues/232)) ([4892649](https://github.com/oddessentials/ado-git-repo-insights/commit/489264974dc588b58d39ae7218a2ef5f2208ae23))
* preflight fails closed, TS ratchets to zero, lint covers all scopes ([#232](https://github.com/oddessentials/ado-git-repo-insights/issues/232)) ([48ddb1a](https://github.com/oddessentials/ado-git-repo-insights/commit/48ddb1aafadcc1fec98b31649e3c6542f500cdde))
* prevent scan_codebase scope overlap from dropping child-scope suppressions and restore preflight parity ([#232](https://github.com/oddessentials/ado-git-repo-insights/issues/232)) ([2961864](https://github.com/oddessentials/ado-git-repo-insights/commit/2961864188f7c7f2dd29802bb0eb0474a8bd50f6))
* relax artifact verification to ignore line drift, add check_test_patterns to ScopeConfig ([#232](https://github.com/oddessentials/ado-git-repo-insights/issues/232)) ([8ea7ffe](https://github.com/oddessentials/ado-git-repo-insights/commit/8ea7ffe486f5d6d158dfa280637c7be5a4c35e9b))
* remove rename double-count bypass in staged suppression delta ([#232](https://github.com/oddessentials/ado-git-repo-insights/issues/232)) ([b535446](https://github.com/oddessentials/ado-git-repo-insights/commit/b53544617e342a7a1d92ca606c99fda13ba47272))
* restore delete-safe hooks and fetch main baseline in ci ([7135a1d](https://github.com/oddessentials/ado-git-repo-insights/commit/7135a1d686d0241d321af1b1208b8f0037d35cc3))
* restore script bootstraps and fail on missing proof artifacts ([#232](https://github.com/oddessentials/ado-git-repo-insights/issues/232)) ([f2c7433](https://github.com/oddessentials/ado-git-repo-insights/commit/f2c74337802103b84348996fa1c1dc6dc25c44dd))
* strengthen guardrails to cover dynamic subprocess, module-level random, and full artifact content ([#232](https://github.com/oddessentials/ado-git-repo-insights/issues/232)) ([c064ba0](https://github.com/oddessentials/ado-git-repo-insights/commit/c064ba02f75f38fd72a1c9391fe5f1227a6e9a8a))
* tolerate legacy zero-count suppression scopes in main baseline ([ecd6318](https://github.com/oddessentials/ado-git-repo-insights/commit/ecd631889e2dbeddf322a82ed429b1e230a81712))
* tolerate legacy zero-count suppression scopes in main baseline ([25f0ea9](https://github.com/oddessentials/ado-git-repo-insights/commit/25f0ea9b7c937af0df6eea1be3c4e58ac3c30bae))


### Features

* disable S603/S607/S311 with proof artifacts and compensating guardrails ([#232](https://github.com/oddessentials/ado-git-repo-insights/issues/232)) ([f24d1ff](https://github.com/oddessentials/ado-git-repo-insights/commit/f24d1ff7a5c4a492eff78081aeb3b56f0e5aa9f4))
* expand suppression audit with tokenize scanner, file coverage, and two-phase gating ([#232](https://github.com/oddessentials/ado-git-repo-insights/issues/232)) ([629c9ee](https://github.com/oddessentials/ado-git-repo-insights/commit/629c9ee6bacefde65f1f29d141268818a73e7b17))
* extend mypy to tests/ and scripts/ — zero errors across 153 files ([#232](https://github.com/oddessentials/ado-git-repo-insights/issues/232)) ([fcce6bb](https://github.com/oddessentials/ado-git-repo-insights/commit/fcce6bb7acb8f33694ea8564d7544ca6766366c2))
* reach baseline 0 — resolve final 10 suppressions, activate all gates, staleness check ([#232](https://github.com/oddessentials/ado-git-repo-insights/issues/232)) ([018bd59](https://github.com/oddessentials/ado-git-repo-insights/commit/018bd59d90611a85ef19c9a6679923750a32cf30))
* register scope coverage in all entry points — pre-commit, preflight, CI ([#232](https://github.com/oddessentials/ado-git-repo-insights/issues/232)) ([84c4055](https://github.com/oddessentials/ado-git-repo-insights/commit/84c40554a29760ee8a871603244bf76a7fd41ea9))
* replace bare ModuleType with typed subclasses — remove 7 type:ignore[attr-defined] ([#232](https://github.com/oddessentials/ado-git-repo-insights/issues/232)) ([3896c59](https://github.com/oddessentials/ado-git-repo-insights/commit/3896c597b784782d6ac8d503b8ff66aada4d3461))
* resolve 35 suppressions — S105 renames, dead S603, N817, F841, F401, S110, type guards ([#232](https://github.com/oddessentials/ado-git-repo-insights/issues/232)) ([ae7235b](https://github.com/oddessentials/ado-git-repo-insights/commit/ae7235b257eed4028dac238f900a420514b55534))

## [5.33.2](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.33.1...v5.33.2) (2026-03-30)


### Bug Fixes

* avoid deadlock and thread-safety regression in SIGINT dashboard shutdown ([74e02b6](https://github.com/oddessentials/ado-git-repo-insights/commit/74e02b622cd65c4d17108743477a0d73e07229f5))
* move SIGINT override after browser launch, chain to prior handlers ([24b015c](https://github.com/oddessentials/ado-git-repo-insights/commit/24b015c3d9143f4791ce91bba77e355e7c412652))
* resolve mypy error in SIGINT handler closure ([1e4edda](https://github.com/oddessentials/ado-git-repo-insights/commit/1e4eddac2ccff131e9a834b31f2e224bf27711c6))
* respect SIG_IGN/SIG_DFL — skip SIGINT override when caller configured signal policy ([a3f9f55](https://github.com/oddessentials/ado-git-repo-insights/commit/a3f9f5535922bf80221894cc9237ad7d2dfaa806))
* use SIGINT signal handler for reliable dashboard shutdown ([b2ba5fb](https://github.com/oddessentials/ado-git-repo-insights/commit/b2ba5fb1b5f29db592b6d2f0cd7d1b44c14cae9c)), closes [#225](https://github.com/oddessentials/ado-git-repo-insights/issues/225)

## [5.33.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.33.0...v5.33.1) (2026-03-30)


### Bug Fixes

* disconnect stale observer on re-init miss, cancel queued rAF on teardown ([2a8d763](https://github.com/oddessentials/ado-git-repo-insights/commit/2a8d7639fc1e35bba2863a80fdb18c0b3aecf38f))
* extract host-resize module, remove redundant manual calls, harden tests ([9ff2857](https://github.com/oddessentials/ado-git-repo-insights/commit/9ff2857f48634b2f23260d353a35b9f0409b5c71))
* start host-resize sync before async init to cover startup/error paths ([056f132](https://github.com/oddessentials/ado-git-repo-insights/commit/056f132f48d22ec61e81e8d4c345f9c7e2c927b0))

# [5.33.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.32.0...v5.33.0) (2026-03-30)


### Bug Fixes

* **045:** aria-live mutations, stale text cleanup, in-flight dedup, safe dates ([056e2dc](https://github.com/oddessentials/ado-git-repo-insights/commit/056e2dcf54d64db30b94a68b8a3916e32907e58d))
* **045:** correct three loading-state invariant violations ([5a88e25](https://github.com/oddessentials/ado-git-repo-insights/commit/5a88e252cac27866359ab23bcf9ba12ec0005b4e))
* **045:** guard announce microtask with generation counter ([6222b49](https://github.com/oddessentials/ado-git-repo-insights/commit/6222b49789c72a184b82a76297e3fefdd5e8805e))
* **045:** reject invalid URL date params at restore, not just serialize ([e504d27](https://github.com/oddessentials/ado-git-repo-insights/commit/e504d27e29858c47b4d8806aa669ee7c6bb86e3a))
* **045:** render spinner elements and cancel stale announcement timers ([89b7d6c](https://github.com/oddessentials/ado-git-repo-insights/commit/89b7d6cffdaabf2ad436c164a60c16b5b1623a52))


### Features

* **045:** add refresh-cycle loading state for Metrics tab ([3811e39](https://github.com/oddessentials/ado-git-repo-insights/commit/3811e397370432fcb48164f05bcf44b9a7ed5f8a))

# [5.32.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.31.0...v5.32.0) (2026-03-29)


### Bug Fixes

* **044:** approval badge label uses metric-specific coverage, not chart window ([41cfa8a](https://github.com/oddessentials/ado-git-repo-insights/commit/41cfa8a69d834389750cfc43853268e4f01b6b21))
* **044:** approval-rate time label, no-data styling, reviewer tooltip switch ([25ab814](https://github.com/oddessentials/ado-git-repo-insights/commit/25ab814eb60a5e823fe044704b1b9d38a3cfeabf))
* **044:** approval-rate weighting, reviewer scope, review-time visibility ([b5f6cce](https://github.com/oddessentials/ado-git-repo-insights/commit/b5f6cce7fb364341b41381cbbcb12265a1596d1f))
* **044:** cache review-time element IDs so summary cards render ([68c820b](https://github.com/oddessentials/ado-git-repo-insights/commit/68c820bfd8266d2cf88075db514d4f6b137a1bcf))
* **044:** correct approval-rate weighting and review-time card visibility ([b730acb](https://github.com/oddessentials/ado-git-repo-insights/commit/b730acb4a00d257d0dd1aeb786814cea0ad44330))
* **044:** correct card class selector, per-metric sample size, plotted-data labels ([16fa3bf](https://github.com/oddessentials/ado-git-repo-insights/commit/16fa3bfd201547893c54ba6d637aa4ae4bc64cea))
* **044:** hide review-time cards when dataset lacks review_time fields ([1cbe164](https://github.com/oddessentials/ado-git-repo-insights/commit/1cbe164ed04b149f817a5cda7f3b0aa42ea0aaa7))
* **044:** independent P50/P90 sample counts + calendar-span sparkline labels ([f2ec531](https://github.com/oddessentials/ado-git-repo-insights/commit/f2ec53151dc654824af6706a889f50ec41820742))
* **044:** independent P50/P90 week counts for sample-size accuracy ([044c1cc](https://github.com/oddessentials/ado-git-repo-insights/commit/044c1cc25fa24acbc607857b9ef3bc8ee3afcdb0))
* **044:** metric-specific source labels + approval rate window alignment ([37272f1](https://github.com/oddessentials/ado-git-repo-insights/commit/37272f10e712a687702bf2604cb9a712b6d77bb2))
* **044:** metric-specific sparkline and delta labels for sparse series ([25e6330](https://github.com/oddessentials/ado-git-repo-insights/commit/25e6330ce81f1edd18a01a541520045f19085155))
* **044:** propagate review_time through all filtered-rollup paths ([c0dfc8c](https://github.com/oddessentials/ado-git-repo-insights/commit/c0dfc8c3113a7c16f15010c464d1faec4300033b))
* **044:** remove off-by-one tolerance from delta labels for sparse metrics ([cf12c32](https://github.com/oddessentials/ado-git-repo-insights/commit/cf12c32858861ab7ebea2aa199ab15bf35f9e3f3))
* **044:** scope truncation badge CSS to chart indicators only ([da33692](https://github.com/oddessentials/ado-git-repo-insights/commit/da33692856b7548117f4844e61f9bc9d8125b83e))
* **044:** shared sparkline labels, 1-week support, approval-rate no-data state ([9f5e250](https://github.com/oddessentials/ado-git-repo-insights/commit/9f5e25028a840674517ec7bf71cf4cf349534f00))
* **044:** toggle review-time P50/P90 cards independently ([c2ac653](https://github.com/oddessentials/ado-git-repo-insights/commit/c2ac653ac9e3f9e4d84a4144374e470dc4f331b3))
* **044:** uniform PR-based sample-size subtitles, stale sparkline label cleanup ([e845cfe](https://github.com/oddessentials/ado-git-repo-insights/commit/e845cfe79b570136eefc51c0a6d0d171e1bc9c10))
* **044:** use non-temporal labels for sparse metric series ([0c05279](https://github.com/oddessentials/ado-git-repo-insights/commit/0c052794104d283cddfb1874d76afaa2a44684f5))


### Features

* **044:** add approval rate to reviewer activity chart (US2, T022-T028) ([15b0b26](https://github.com/oddessentials/ado-git-repo-insights/commit/15b0b266be1e18cf853175f99de27a3b2fe6bb4c))
* **044:** add sample size indicator and sparkline time labels (US3+US4, T029-T039) ([3501493](https://github.com/oddessentials/ado-git-repo-insights/commit/35014939890c1df15c88f86f2ff1b69b8cea543a))
* **044:** add spec, plan, and Phase 1 setup for dashboard transparency polish ([9af11fb](https://github.com/oddessentials/ado-git-repo-insights/commit/9af11fb453ff3486c41a180cf0cc3837f0a680ac)), closes [#204](https://github.com/oddessentials/ado-git-repo-insights/issues/204)
* **044:** color-coded distribution, legend opacity, truncation badges (US5-US7, T040-T053) ([1ca617d](https://github.com/oddessentials/ado-git-repo-insights/commit/1ca617d4d6c69d21b328db3c73deaba282f08d5f))
* **044:** metric-specific sample tiers, delta labels, tooltip disclosure, T042/T050 ([d749380](https://github.com/oddessentials/ado-git-repo-insights/commit/d7493807e9d67f3774e99946d30d6b996523ce4d))
* **044:** Phase 11 invariant tests + insertBefore fix + badge CSS reset ([d3aeb98](https://github.com/oddessentials/ado-git-repo-insights/commit/d3aeb98e4eaf66c9e1f816d26d5667c63e2873eb))
* **044:** wire review time P50/P90 into dashboard UI (US1, T011-T021) ([261ce2a](https://github.com/oddessentials/ado-git-repo-insights/commit/261ce2abc55830e552f2000d8ba56a3d509db9dd))

# [5.31.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.30.1...v5.31.0) (2026-03-29)


### Bug Fixes

* catch non-ImportError Prophet failures and guard eslint config drift ([baf758d](https://github.com/oddessentials/ado-git-repo-insights/commit/baf758d07eb1fad535314645ae2f962660eca761))
* harden test:ci pytest path, restore Prophet runtime check, close coverage gaps ([c8a527c](https://github.com/oddessentials/ado-git-repo-insights/commit/c8a527c0707d2a177360fae89738f40094e61afd))
* include eslint.config.mjs in UI trigger and clean-snapshot guard ([52564ff](https://github.com/oddessentials/ado-git-repo-insights/commit/52564ffb8d86453f855536356f0dca16065fe283))
* resolve audit migration regression, git SHA resolution, and test:ci parity gaps ([29ff7ea](https://github.com/oddessentials/ado-git-repo-insights/commit/29ff7eaa0d3dae94635ff990203dcc10383b91a2))
* resolve linked-worktree ref lookup via commondir ([1575486](https://github.com/oddessentials/ado-git-repo-insights/commit/1575486cdc0fafaf42e42f34f044eb59e5dede8e))
* unblock insights dry-run, align build-aggregates ML flags, fix stale audit tests ([acf6811](https://github.com/oddessentials/ado-git-repo-insights/commit/acf6811788951c468e0d320fd7333d0248fd3a6c))


### Features

* eliminate all 50 suppression comments and harden enforcement to zero baseline ([#211](https://github.com/oddessentials/ado-git-repo-insights/issues/211)) ([2a474a5](https://github.com/oddessentials/ado-git-repo-insights/commit/2a474a5e8f006a64f6de3527073c2aed2e4bb148))
* enforce test ESLint as hard gate in all enforcement paths ([c49396d](https://github.com/oddessentials/ado-git-repo-insights/commit/c49396d22920c92ab688e9477103095a0f196dea))

## [5.30.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.30.0...v5.30.1) (2026-03-29)


### Bug Fixes

* add suppression count guard to pre-commit ([7df6035](https://github.com/oddessentials/ado-git-repo-insights/commit/7df6035af249fb51031c466095afba1397be060e))
* broaden pre-commit trigger scope to match test compilation scope ([4dfb726](https://github.com/oddessentials/ado-git-repo-insights/commit/4dfb72675f1876e485e355f52adb0619ec8de00c))
* close types/vss.d.ts trigger gap and codify trigger-to-compilation contract ([f05f1aa](https://github.com/oddessentials/ado-git-repo-insights/commit/f05f1aae35cf1165d865654c2a95c47789a3a7f8))
* correct tsconfig guard pathspec to match actual files ([4dc7c86](https://github.com/oddessentials/ado-git-repo-insights/commit/4dc7c8657c06636e5a22f3b024ac21de244f2371))
* guard test typecheck against unstaged UI sources and wire into test:ci ([e170a6d](https://github.com/oddessentials/ado-git-repo-insights/commit/e170a6dbdbbc8075c1d3efa24150594371c43eaf))
* guard test typecheck and config parity against full compilation scope ([ba789ac](https://github.com/oddessentials/ado-git-repo-insights/commit/ba789ac785a89e10a1ba187fb22912bf5237e4bb))
* include tsconfig files in test compilation scope guard ([0313e13](https://github.com/oddessentials/ado-git-repo-insights/commit/0313e131abb100dc80b90dd9bf270e79cae21a61))
* limit parity check to explicit flag set and add resolution tests ([0d49aea](https://github.com/oddessentials/ado-git-repo-insights/commit/0d49aeac0acff5a7fdb8f3e30b1b544d4250cdff))
* remove eslint suppression from config-parity-resolution test ([d08b1e2](https://github.com/oddessentials/ado-git-repo-insights/commit/d08b1e237043e768a054b15dde6aeff9d3585b2f))
* use direct process execution in parity script and fail on missing configs ([23fd4c7](https://github.com/oddessentials/ado-git-repo-insights/commit/23fd4c7cbb454772f6fe74b4eb3be62a530dea25))
* use TypeScript API in-process for config parity — no child processes ([3b2b1e8](https://github.com/oddessentials/ado-git-repo-insights/commit/3b2b1e8838c4dc1602120a7089600b2fa3cf0fb9))

# [5.30.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.29.0...v5.30.0) (2026-03-28)


### Features

* **dashboard:** show "All selected" placeholder when all filter options chosen ([89cd2fa](https://github.com/oddessentials/ado-git-repo-insights/commit/89cd2fa0b52163fd5324a6e6f9c30233dd307401))

# [5.29.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.28.3...v5.29.0) (2026-03-28)


### Bug Fixes

* **ci:** close tsc parity gap — add type check to pre-commit, align test config, fix errors ([5d18b31](https://github.com/oddessentials/ado-git-repo-insights/commit/5d18b3187ac48f8c139d7006fa877c63bbeaf36a))
* **ci:** smoke test selectors, strict suppression audit, data-testid on typeahead ([db5b04b](https://github.com/oddessentials/ado-git-repo-insights/commit/db5b04bd722bc4d08305d1b7c8b39e0b8792b83a)), closes [#207](https://github.com/oddessentials/ado-git-repo-insights/issues/207) [#207](https://github.com/oddessentials/ado-git-repo-insights/issues/207)
* **dashboard:** address review feedback — memory leak, pointer events, accessibility ([c72359b](https://github.com/oddessentials/ado-git-repo-insights/commit/c72359b8a92d490e37a4ae1d8601066b2e01e9d2))
* **dashboard:** address US2 review — URL encoding, debounce race, dead code, a11y ([504771d](https://github.com/oddessentials/ado-git-repo-insights/commit/504771d5d356962266aa1d84c087b9ae6a8c508e))
* **dashboard:** author param regression, filter_caused classifier, comprehensive test coverage ([643fd5b](https://github.com/oddessentials/ado-git-repo-insights/commit/643fd5bd31e1b7aae54f7cb2b3ca3c28a94cab49)), closes [#207](https://github.com/oddessentials/ado-git-repo-insights/issues/207) [#207](https://github.com/oddessentials/ado-git-repo-insights/issues/207)
* **dashboard:** complete typeahead state transitions and notice routing ([ab02403](https://github.com/oddessentials/ado-git-repo-insights/commit/ab02403ee8279e53a8f0aedf5449273f5e8e0fe5))
* **dashboard:** correct empty-state classifier inputs for reviewer and distribution charts ([258fcf4](https://github.com/oddessentials/ado-git-repo-insights/commit/258fcf4a2cdaa042a48927ad761c30a86865162e))
* **dashboard:** prevent author+reviewer coexistence, fix normalization and clear perf ([08091b5](https://github.com/oddessentials/ado-git-repo-insights/commit/08091b5c2ff221319c59c619b9ff1ec5e7f008ac))
* **dashboard:** restore filter semantics — last-interaction-wins and team retention ([dfea4c3](https://github.com/oddessentials/ado-git-repo-insights/commit/dfea4c389a47ccfba29d34eec2c00f3aaec97dc1))
* **dashboard:** typeahead state parity, blur restore, canonical URL serialization ([9fa8530](https://github.com/oddessentials/ado-git-repo-insights/commit/9fa8530ca3e31d22001bb5492bef046b7d428964))
* **dashboard:** wire classifier into live renders, add scroll dismiss, fix info tooltip click ([ebece7f](https://github.com/oddessentials/ado-git-repo-insights/commit/ebece7fb8e6a2bfc862a3ad226638acd8677482b))


### Features

* **dashboard:** metrics tab UX improvements — tooltips, filters, empty states, info icons ([f99921a](https://github.com/oddessentials/ado-git-repo-insights/commit/f99921a11aeac685696adc6ec1dcbe4a6ed02660))
* **dashboard:** unified typeahead filter component replacing 4 inconsistent filter UIs ([2abf42a](https://github.com/oddessentials/ado-git-repo-insights/commit/2abf42a2f52324d0f9e6670dbdfa1804a11925c7))

## [5.28.3](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.28.2...v5.28.3) (2026-03-27)


### Bug Fixes

* raise NOISE_FLOOR_MS to 5 ms to eliminate CI flakiness ([8a9857d](https://github.com/oddessentials/ado-git-repo-insights/commit/8a9857db16b682bb02a8518dfc93ef48fcc84ef5)), closes [#202](https://github.com/oddessentials/ado-git-repo-insights/issues/202)

## [5.28.2](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.28.1...v5.28.2) (2026-03-27)


### Bug Fixes

* harden CLI — add --version, __main__.py, lazy imports, parse validation, PATH fix ([ba46899](https://github.com/oddessentials/ado-git-repo-insights/commit/ba46899af5085d2bc4eded2b41b96bdb60f76d43)), closes [#200](https://github.com/oddessentials/ado-git-repo-insights/issues/200)
* resolve version from checkout when metadata is stale ([b935abc](https://github.com/oddessentials/ado-git-repo-insights/commit/b935abcce1cf0847d97f98e82eddeae8901fe2b5))

## [5.28.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.28.0...v5.28.1) (2026-03-26)


### Bug Fixes

* add --junit-xml to preflight pytest for test count validation ([93e6faa](https://github.com/oddessentials/ado-git-repo-insights/commit/93e6faa0259442709edaf9d915e47275a4347028))
* add build dep, match CI threshold logic, generate fresh coverage.xml ([5875215](https://github.com/oddessentials/ado-git-repo-insights/commit/5875215b3c73ad30c8ee840ccdd78d2d97a2a2f0))
* close 18 CI parity gaps with local pre-commit and pre-push guards ([3247874](https://github.com/oddessentials/ado-git-repo-insights/commit/3247874771bca0ee966b0451216b5a0bd847ed9d))
* replace non-null assertions with type casts and gate ESLint in pre-commit ([7264576](https://github.com/oddessentials/ado-git-repo-insights/commit/7264576b4dd53e061356c402a15a1cf0d093814b))
* rewrite pre-commit guards to staged-only and fix build --check ([1c0a874](https://github.com/oddessentials/ado-git-repo-insights/commit/1c0a87472882ddaabf3a9fc51a7851451c4b6b42))
* scope npm guard to all manifests and remove full-tree lint from pre-commit ([e8f95ab](https://github.com/oddessentials/ado-git-repo-insights/commit/e8f95abfbaf0e49d9910a73d2821a17ff67d9e73))

# [5.28.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.27.3...v5.28.0) (2026-03-26)


### Bug Fixes

* **ci:** eliminate 12 test skips by using committed artifacts only ([16c4aea](https://github.com/oddessentials/ado-git-repo-insights/commit/16c4aea4bf8a383907b365231cf5b4514f0033b2))
* dynamic chart legends for missing metrics + trend line visibility ([9027fe7](https://github.com/oddessentials/ado-git-repo-insights/commit/9027fe710ca5e2c030dde7a62ca626815f8223a6))
* predictions NaN from undefined bounds + sparkline filtering + global NaN invariant ([6107442](https://github.com/oddessentials/ado-git-repo-insights/commit/6107442a6173d32450388a2fc48dd305bfaf469d))


### Features

* add reviewer-activity truncation indicator + prod-shape tests (P4) ([7aae114](https://github.com/oddessentials/ado-git-repo-insights/commit/7aae1141ba78cf58a7c9f6ba5dd252b836ca2642))

## [5.27.3](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.27.2...v5.27.3) (2026-03-25)


### Bug Fixes

* **ci:** raise perf gate base threshold to 45s for CI runner headroom ([3e0401f](https://github.com/oddessentials/ado-git-repo-insights/commit/3e0401f4e6ca56d7f7bc516d5b188cc0798a9022))
* **ci:** resolve all 3 CI failures with cross-platform parity safeguards ([c0a63bc](https://github.com/oddessentials/ado-git-repo-insights/commit/c0a63bc51beff990371e9759e05ada1905297216))
* **ci:** resolve remaining type errors and add vsix test to preflight ([88ed3b7](https://github.com/oddessentials/ado-git-repo-insights/commit/88ed3b7e050fc94d280c7faeca9aff66efbd6338))

## [5.27.2](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.27.1...v5.27.2) (2026-03-25)


### Bug Fixes

* guard entire hook with command check and remove unrelated UPDATES.md ([75e3c62](https://github.com/oddessentials/ado-git-repo-insights/commit/75e3c62ae08806507b8d135125436862a788ca94))

## [5.27.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.27.0...v5.27.1) (2026-03-21)


### Bug Fixes

* validate hook bootstrap interpreter ([9b4bb9c](https://github.com/oddessentials/ado-git-repo-insights/commit/9b4bb9c412d5caeaffa1377bd1a64e804e0014af))

# [5.27.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.26.0...v5.27.0) (2026-03-21)


### Bug Fixes

* harden reviewer filters and local preflight ([b6f4747](https://github.com/oddessentials/ado-git-repo-insights/commit/b6f4747a8b933e233d6f1193281d9f430d1e1c01))


### Features

* add reviewer filter and breakdown support ([738e30e](https://github.com/oddessentials/ado-git-repo-insights/commit/738e30ea35b39b2813d5ea39e797b1f292b76c6c))

# [5.26.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.25.0...v5.26.0) (2026-03-20)


### Bug Fixes

* auto-detect predictions/insights files in manifest feature flags ([1fafc6a](https://github.com/oddessentials/ado-git-repo-insights/commit/1fafc6a6f4e0cb5d2f0c7514fb3f7da85115dc51))
* demo data realism and compiled artifact guard ([e9e7ce3](https://github.com/oddessentials/ado-git-repo-insights/commit/e9e7ce38c49923da1c0a679db1c50192b7e8a365))
* **demo:** decouple schema version import from numpy deps ([004edf9](https://github.com/oddessentials/ado-git-repo-insights/commit/004edf9aead65b9e3aa345324af6cf1ad8a71a73))
* handle null cycle times in dashboard sparklines and summary cards ([bfbc205](https://github.com/oddessentials/ado-git-repo-insights/commit/bfbc2050aea1af9ade0cb4eeb48ec9f8d27e8ce8))
* make esbuild launcher cross-platform ([bc7f65b](https://github.com/oddessentials/ado-git-repo-insights/commit/bc7f65b2a7aecdd468ec631e2cdab3520d229d9c))
* reconcile demo cross-dim allocations ([b03ca8d](https://github.com/oddessentials/ado-git-repo-insights/commit/b03ca8dfe023d333a7c9bf4cf4b1a6215da3f8c6))
* support python 3.10 in tool parity guard ([8d89a1d](https://github.com/oddessentials/ado-git-repo-insights/commit/8d89a1d2247fd9e080ea7ddc66e5ea43687b0318))
* unblock local and artifact demo validation ([2ab1880](https://github.com/oddessentials/ado-git-repo-insights/commit/2ab18805218da38d3a153276ef46ff51f5be78f2))
* use platform esbuild binary in bundle script ([33b473a](https://github.com/oddessentials/ado-git-repo-insights/commit/33b473a3c7a7ba2f1180ff99bda51f9b6e17a980))
* **ux:** prevent accuracy footnote from shifting summary card layout ([c6c85b3](https://github.com/oddessentials/ado-git-repo-insights/commit/c6c85b3341cb3159f14bbe1d45a1174c7f1bffe1))
* **ux:** rewrite accuracy and overlap footnotes for clarity ([c3e8390](https://github.com/oddessentials/ado-git-repo-insights/commit/c3e8390dfb3f831d8bd37359a57a67d585630781))
* zero-leakage guards, rollup hardening, and cross-dim optimization ([63074db](https://github.com/oddessentials/ado-git-repo-insights/commit/63074db21e035a260a1f12b5acc039272a5d65b1))


### Features

* **029:** cross-dimensional filter accuracy with exact team-repo breakdowns ([1843a0b](https://github.com/oddessentials/ado-git-repo-insights/commit/1843a0bbb10f777fc3aaa5bd514ecdbe377e4e92))
* realistic demo data with cross-dimensional breakdowns and quality hardening ([c6916fc](https://github.com/oddessentials/ado-git-repo-insights/commit/c6916fc16e54c38437e78480153e155128b73263))

# [5.25.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.24.0...v5.25.0) (2026-02-11)


### Features

* add ML predictions and AI insights screenshots to marketplace listing ([ca7fcdb](https://github.com/oddessentials/ado-git-repo-insights/commit/ca7fcdb6404aed7add75272c0f08c92ca70f6c39))

# [5.24.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.23.1...v5.24.0) (2026-02-10)


### Bug Fixes

* compare mode off-by-one bug, add filter context banner, and integration tests ([7263538](https://github.com/oddessentials/ado-git-repo-insights/commit/7263538e442a95f22e695d79264179642404e249))
* replace screenshot size heuristic with PNG dimension validation ([04640f3](https://github.com/oddessentials/ado-git-repo-insights/commit/04640f3fea1754e8d525dbff61c96477a074726d))
* replace xxd with node for PNG magic bytes check in pre-push hook ([d7befc0](https://github.com/oddessentials/ado-git-repo-insights/commit/d7befc0aa74335704980e1e918d79481b92000a2))
* simplify marketplace description wording ([ac31aba](https://github.com/oddessentials/ado-git-repo-insights/commit/ac31aba39b1866ce0b227fcbd55a8bd04740fa5d))
* **test:** remove stale TODO file assertion from scalability invariants ([a1cb47b](https://github.com/oddessentials/ado-git-repo-insights/commit/a1cb47b40a5f7b77ea9e348b4cd5cfd6d1ad62fd))


### Features

* marketplace readiness for public preview ([eaab618](https://github.com/oddessentials/ado-git-repo-insights/commit/eaab618bc51a38ab20c62a3c9f3c58c97d4a7cca))

## [5.23.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.23.0...v5.23.1) (2026-02-07)


### Bug Fixes

* add managed-features target so feature flags appear in Preview Features dropdown ([8a68308](https://github.com/oddessentials/ado-git-repo-insights/commit/8a68308395b14201b9580c9a3bd17efb126b8404))

# [5.23.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.22.2...v5.23.0) (2026-02-07)


### Features

* add [GRI] dashboard feature flag with manifest contract tests ([d247a44](https://github.com/oddessentials/ado-git-repo-insights/commit/d247a44959e35e969f5467861d8868fc78d62850))
* add getDefinitions() and getBuilds() to ArtifactClient ([c7c71f3](https://github.com/oddessentials/ado-git-repo-insights/commit/c7c71f3673f8a6ff068bf846430e4aed043411be))
* replace legacy discovery in settings with ArtifactClient direct REST ([028f99a](https://github.com/oddessentials/ado-git-repo-insights/commit/028f99aeba833c44a8314ec15baca06d426c4547))

## [5.22.2](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.22.1...v5.22.2) (2026-02-07)


### Bug Fixes

* use undefined instead of null for optional VSS REST client params ([0640ee7](https://github.com/oddessentials/ado-git-repo-insights/commit/0640ee7f03dccf813d225e6e6c23b5b543d82fc6))

## [5.22.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.22.0...v5.22.1) (2026-02-07)


### Bug Fixes

* discover pipelines against effective project in auto-discovery mode ([a2d2d0b](https://github.com/oddessentials/ado-git-repo-insights/commit/a2d2d0b45a1f08f7e7032129cc785c3db281f8d6))
* enable download button in auto-discovery mode ([22935e1](https://github.com/oddessentials/ado-git-repo-insights/commit/22935e18d03e6d6e58c97034a72009579af26d4c))

# [5.22.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.21.0...v5.22.0) (2026-02-07)


### Bug Fixes

* clear stale validation before async pipeline re-validate ([7599b51](https://github.com/oddessentials/ado-git-repo-insights/commit/7599b51c58286b525ddee19652856f084ebbb30b))
* harden download URL validation and improve code quality ([60b197e](https://github.com/oddessentials/ado-git-repo-insights/commit/60b197e824f04e873251d38c79489cd20a1389a3))
* harden downloadRawData with input validation and deferred revoke ([d45a144](https://github.com/oddessentials/ado-git-repo-insights/commit/d45a144060032be293246c6c63ffd5b3ed3c7e81))
* point settings page docs link to extension user guide ([404e242](https://github.com/oddessentials/ado-git-repo-insights/commit/404e24273cdad2e121344697067448140e32aeb4))


### Features

* add Download Raw Data button to settings page ([dae2d0d](https://github.com/oddessentials/ado-git-repo-insights/commit/dae2d0d095de979b953a599625961a6c798933af))

# [5.21.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.20.2...v5.21.0) (2026-02-07)


### Bug Fixes

* add missing CSS for .truncation-indicator (T040) ([3f16efc](https://github.com/oddessentials/ado-git-repo-insights/commit/3f16efc7be982179bd01274ad71d68705c7b6852))
* address 4 dashboard issues — reviewer cap, team filter, overflow, panel clarity ([34ae5c2](https://github.com/oddessentials/ado-git-repo-insights/commit/34ae5c2e0859c7c548bbced0e40cdbcc685c1e4f))
* address 8 code review items for dashboard scalability ([d61e4e8](https://github.com/oddessentials/ado-git-repo-insights/commit/d61e4e8f66989ab9e16c069cd5b62c010a3ae738))
* apply both repo and team filters together via proportional intersection ([8b8816f](https://github.com/oddessentials/ado-git-repo-insights/commit/8b8816f1342de8d6b28ebf5f4806f931b6b5b927))
* clamp team share to [0,1] to prevent overflow from multi-team overlap ([3551cf9](https://github.com/oddessentials/ado-git-repo-insights/commit/3551cf9f859a102c78bf626c7d732bb12ffb06df))
* exclude null/missing cycle-time entries from weighted average denominator ([aaefeda](https://github.com/oddessentials/ado-git-repo-insights/commit/aaefedaca9937fc5847896a6504b97bd21c7e0cd))
* guard against NaN when p90s is empty in combined filter cycle time ([48ad378](https://github.com/oddessentials/ado-git-repo-insights/commit/48ad37858aa138eb3f92559eff6fed16367754ed))
* regenerate demo data with 200 users/260 weeks and close test coverage gaps ([7d2b83b](https://github.com/oddessentials/ado-git-repo-insights/commit/7d2b83bb2e2609e13a3d4ebd0f638d283e1f91e4))
* regenerate docs/data from canonical demo generator (260 weeks) ([fbf0cee](https://github.com/oddessentials/ado-git-repo-insights/commit/fbf0cee9697e94d1dab64e5c36154fcb5a0feeb2))
* replace non-null assertions with type-narrowing variables in metrics.ts ([0e0f8de](https://github.com/oddessentials/ado-git-repo-insights/commit/0e0f8de5c2f06c333b971b9da3751e62f0034a47))
* resolve extensionRoot scoping bug and create unit test directory ([ba49ee3](https://github.com/oddessentials/ado-git-repo-insights/commit/ba49ee371c2dd7c73b09cb41269bfc9d2dedcdf3))
* scale Cycle Time Trend SVG viewBox width to data point count ([dc3924a](https://github.com/oddessentials/ado-git-repo-insights/commit/dc3924a84f373bd7e30b0578041d2c288f326034))
* update tests and regenerate predictions/insights for team data ([34ed24b](https://github.com/oddessentials/ado-git-repo-insights/commit/34ed24b6705464a7cb802163ec2cba3d8fdf2265))


### Features

* add --users, --include-comments args and remove generator caps ([181e31f](https://github.com/oddessentials/ado-git-repo-insights/commit/181e31fa5b393e32c1a97300c77099a49e570804))
* add by_repository to generator, full repo filter aggregation, and docs/ sync automation ([a23ddc7](https://github.com/oddessentials/ado-git-repo-insights/commit/a23ddc7a293e421934ff8fb5e8d792a8d7c344c8))
* add CI scalability test job and harden invariant assertions ([b2ec479](https://github.com/oddessentials/ado-git-repo-insights/commit/b2ec47914a2c299dfa660c12ffe7b38bbc2249f3))
* add comment generation to synthetic data generator ([6bfa240](https://github.com/oddessentials/ado-git-repo-insights/commit/6bfa240f19965a178362ed0aeeba5fc3fc473730))
* add cycle-time chart data cap with truncation indicator ([5fcb031](https://github.com/oddessentials/ado-git-repo-insights/commit/5fcb031d591a1f6432d659b1cb19eb44edb50b13))
* add deterministic team data to demo generator ([2aa23cb](https://github.com/oddessentials/ado-git-repo-insights/commit/2aa23cb1a5b50f2ca15a5a44bf6246c5d02552c9))
* add full per-team metric breakdowns so all charts react to team filter ([9a6cf55](https://github.com/oddessentials/ado-git-repo-insights/commit/9a6cf5558c69bf0133edc5e0aac819bad833fbc2))
* add reviewer panel scalability support for 200+ users ([2667228](https://github.com/oddessentials/ado-git-repo-insights/commit/26672288e5cc73dc5fd6c13b1ee94431b50139a2))
* add throughput chart data cap with truncation indicator ([0c1a396](https://github.com/oddessentials/ado-git-repo-insights/commit/0c1a396d757b2e85637886d6a6657bcebf42df6d))

## [5.20.2](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.20.1...v5.20.2) (2026-02-05)


### Bug Fixes

* **ci:** resolve mypy [no-any-return] errors in ML forecasters ([509b862](https://github.com/oddessentials/ado-git-repo-insights/commit/509b86251a748246e29b5a72106a6af711fa826d))
* **code-review:** remediate verified findings from CRITICAL_NEXT_STEPS.md ([5e33dac](https://github.com/oddessentials/ado-git-repo-insights/commit/5e33dac3baa2a5235adc1a76c623aa33282aea75))

## [5.20.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.20.0...v5.20.1) (2026-02-03)


### Bug Fixes

* **023:** remove any suppressions and document threshold additions [threshold-update] ([73eeb88](https://github.com/oddessentials/ado-git-repo-insights/commit/73eeb8844951d779d047b784174d2649660c9a1d))

# [5.20.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.19.0...v5.20.0) (2026-02-03)


### Features

* comprehensive coverage initiative ([f886963](https://github.com/oddessentials/ado-git-repo-insights/commit/f8869633719ed8d3007cc501badfa48c66fa55db))

# [5.19.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.18.2...v5.19.0) (2026-02-03)


### Bug Fixes

* **ci:** exclude entry point files from Codecov patch coverage ([41e1e9a](https://github.com/oddessentials/ado-git-repo-insights/commit/41e1e9a6137f10c0b3bf804a1d446d89d98dee71))
* **ci:** update Playwright to 1.50.0 and add glob dependency ([bcbae1e](https://github.com/oddessentials/ado-git-repo-insights/commit/bcbae1e5be71947694e86512cc6b94d741248aa3))
* **ci:** use pnpm exec for Playwright and exclude type-tests from suppression audit ([aa60ee7](https://github.com/oddessentials/ado-git-repo-insights/commit/aa60ee707ac1b3bffb42afbd4139603da56ed12a))


### Features

* **ci:** integrate smoke tests into CI pipeline (T049-T051) ([8dbe430](https://github.com/oddessentials/ado-git-repo-insights/commit/8dbe4304e8a5c8dfcf26be2c8d772a4a84121dd6))
* **testing:** add audit-suppressions test coverage and auto-install Playwright ([2a03c2e](https://github.com/oddessentials/ado-git-repo-insights/commit/2a03c2e12e125d796fc3d9149166bd84971609e9))
* **testing:** add edge case tests and traceability enforcement (US3 T041-T047, US4 T048) ([6d93513](https://github.com/oddessentials/ado-git-repo-insights/commit/6d9351344448169a634566a756a17eb59680229b))
* **testing:** add Playwright smoke test infrastructure (US2 T031-T040) ([56c0257](https://github.com/oddessentials/ado-git-repo-insights/commit/56c02578d447536ba91c0dc9b10a4d2fcfa2fc9c))
* **testing:** add type test infrastructure for compile-time regression detection ([ba50ddb](https://github.com/oddessentials/ado-git-repo-insights/commit/ba50ddbd3af8467e5da3388712b0242bca13b791))
* **testing:** address spec-task coverage gaps with enterprise-grade rigor ([b041724](https://github.com/oddessentials/ado-git-repo-insights/commit/b04172446489e56e0818f6e378706649d55cde48))
* **testing:** implement deterministic smoke test infrastructure ([23621cf](https://github.com/oddessentials/ado-git-repo-insights/commit/23621cff8cbd579db419ca09ee7c4285e6fdc897))

## [5.18.2](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.18.1...v5.18.2) (2026-02-01)


### Bug Fixes

* **dashboard:** extract pr_count from BreakdownEntry in filter aggregation ([da0e114](https://github.com/oddessentials/ado-git-repo-insights/commit/da0e11442724db1f907e1df254c1a97060b2a292))

## [5.18.1](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.18.0...v5.18.1) (2026-01-31)


### Bug Fixes

* **ado-client:** harden parse_retry_after per RFC 7231 ([f72341f](https://github.com/oddessentials/ado-git-repo-insights/commit/f72341f9aa38ba5fb4d46766e35a98e11e79fa93))
* **ado-client:** improve error handling and security hardening ([2da31cf](https://github.com/oddessentials/ado-git-repo-insights/commit/2da31cf60d3e5aab89c6f0f82613be6918e768ee))

# [5.18.0](https://github.com/oddessentials/ado-git-repo-insights/compare/v5.17.0...v5.18.0) (2026-01-31)


### Bug Fixes

* **demo:** correct spec contradictions before Phase 5 ([3a81fe2](https://github.com/oddessentials/ado-git-repo-insights/commit/3a81fe29d3dfde4980366f0c4790cddcb0be6a53))
* **demo:** remove null by_team field from weekly rollups ([bb31438](https://github.com/oddessentials/ado-git-repo-insights/commit/bb31438e3b1983a41aa22da2bfb3443d8408d864))
* **demo:** resolve CI regressions in predictions and pytest ([67591c1](https://github.com/oddessentials/ado-git-repo-insights/commit/67591c11f81ac09166f66a3bc35491b6d2066736))
* **schema:** resolve demo regression with AffectedEntity format and breakdown fields ([6de77ff](https://github.com/oddessentials/ado-git-repo-insights/commit/6de77ff84ea9d824c9115520c9b6d904ca43198e))


### Features

* **demo:** add CI workflow and validation tests (Phase 7) ([40bbc0e](https://github.com/oddessentials/ado-git-repo-insights/commit/40bbc0e78062a550d2c0630eb3b63fad1b8acaa2))
* **demo:** implement GitHub Pages demo dashboard (Phases 1-4) ([e34c67b](https://github.com/oddessentials/ado-git-repo-insights/commit/e34c67b7a5cce9688ab01231fd3487549cbd05d8))
* **demo:** implement Predictions and AI Insights tabs (Phases 5-6) ([4038a47](https://github.com/oddessentials/ado-git-repo-insights/commit/4038a473db4126c56c5f95769721ed814aa050bd))

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
