# Quickstart: Feature 309 Synthetic Demo PR-Level Detail

**Feature**: `309-demo-pr-drilldown`
**Audience**: developers onboarding onto this feature, reviewers, release engineers.

## What this feature does

Makes the public demo at https://oddessentials.github.io/ado-git-repo-insights/ exercise every user-visible surface of feature 060's throughput drill-down (PR rows, truncation indicator, filter-consistent counts, link composition) WITHOUT using tenant data. Narrows FR-023's privacy gate from destination-identity-based to provenance-based via a sentinel-file mechanism.

## TL;DR — what changes

- `docs/data/aggregates/weekly_rollups/*.json`: each gains three new top-level keys (`prs`, `_prs_truncated`, `_prs_cap`) after slice 2d regen.
- `scripts/build-demo-dataset.py::promote_data`: becomes a binary fail-closed gate keyed on a sentinel file.
- `scripts/demo-distributions/*.json`: five new committed fixtures derived from a one-time tenant extract.
- `scripts/generate-demo-data.py`: gains a `generate_pr_records()` helper.
- 13 new test modules across `tests/demo/` and `tests/unit/`.

No extension UI code changes. No aggregator (`src/ado_git_repo_insights/transform/` or `types.py`) changes. No new runtime or dev dependencies.

## Slice sequence (shippable, revertible)

| Slice | What lands | Observable effect |
|---|---|---|
| 2a | Distribution fixtures + derivation script + privacy-review test + `.gitignore` entry | Fixtures committed; privacy test green; no behavior change to demo build |
| 2b | Feature-060 FR-023 narrowed to binary gate (dead-code sentinel branch) + atomicity tests + negative-provenance test + pre-push `sentinel-absence` subcommand + CI first-step guard (via `demo.yml`) + dataset-contract doc update + feature-060 contract supersedure note | Gate reshaped; sentinel-present branch unreachable (no writer yet); all existing tests green |
| 2c | `generate_pr_records()` helper (unit-testable) + isolated `pr_record_rng` + `PrRecord` import + inputs-clean guard + cap/sort/boundary contract tests at unit level + entrypoint-parity test against the `sentinel-absence` subcommand. **NO emission wired; NO sentinel write; artifact tree and committed `docs/data/` UNCHANGED** | Helpers scaffolded; no artifact shape change; existing `test_docs_promotion_matches_canonical_bytes` passes on every interpreter lane |
| 2d (atomic) | ATOMIC: wire emission into rollup loop + apply 2025-W26 override + orchestrator writes sentinel + flip `test_demo_stripped_fields_are_absent` → `test_synthetic_demo_has_prs` + bump `DEMO_PROFILE_VERSION` 2.0.0 → 2.1.0 + regen all 260 rollup JSONs + add byte-equality regen test + add truncation-week-literal and key-order tests | Public demo surface exercises feature 060; schema-guard enforces new contract |

Each slice commits separately. Only slice 2d contains a breaking schema change; the commit message carries the pre-commit self-checklist (Changed / Could-break / Proven-by / Surfaces-moved).

## One-time setup (developer, before slice 2a)

```bash
# Set PAT for tenant extract (environment variable ONLY — never argv, never committed)
export ADO_PAT=<your-oddessentials-PAT>

# Ensure .tmp/ exists and is gitignored
mkdir -p .tmp
grep -q "^\.tmp/" .gitignore || echo ".tmp/" >> .gitignore

# Run the tenant extract (one-time, manual, local only)
python -m ado_git_repo_insights.cli extract-prs --org oddessentials --db .tmp/oddessentials-extract.sqlite

# Derive the statistical distribution fixtures
python scripts/extract_distribution_fixtures.py --db .tmp/oddessentials-extract.sqlite --output scripts/demo-distributions/

# Rotate the PAT after derivation (standing operating procedure)
```

After derivation, commit the generated fixtures. The `.tmp/` SQLite stays out of git.

## Regenerating the demo (slice 2d and later)

```bash
# On baseline Python 3.12.x
python scripts/build-demo-dataset.py
```

This runs the full pipeline: generators → sentinel write → promote_data (sentinel-present branch) → shape verify → unlink → copytree to docs/data/.

## Verifying the gates

```bash
# Pre-push gate chain (authoritative readiness check)
python scripts/run_repo_hook.py pre-push

# Or targeted checks
python scripts/run_pytest.py tests/demo/test_synthetic_pr_contract.py
python scripts/run_pytest.py tests/unit/test_tenant_provenance_negative.py
python scripts/run_pytest.py tests/unit/test_promote_data_unlink_ordering.py
python scripts/run_pytest.py tests/demo/test_regen_byte_stability.py
```

## Browser verification (after slice 2d)

```bash
pnpm --dir extension run serve:docs
```

Navigate to https://localhost:<port>/ and:

1. Click a throughput bar for week 2025-W26 → expect PR list + truncation indicator (showing 500 of 520).
2. Click the adjacent week 2025-W25 → expect PR list with NO truncation indicator.
3. Apply a repository filter → expect PR count to match the chart's filtered count.
4. Click any PR link → expect Azure DevOps URL that resolves to 404 (synthetic org; this is intentional).

## Key invariants (never regress)

1. **Aggregator lockup**: never edit `src/ado_git_repo_insights/transform/*.py` or `src/ado_git_repo_insights/types.py`.
2. **Single gate site**: `promote_data` is the ONLY place the strip gate fires.
3. **Binary gate**: exactly two branches; `else: assert not sentinel.exists()` is load-bearing.
4. **Unlink ordering**: `sentinel.unlink()` is the FIRST mutation after the branch decision.
5. **Sentinel absence in `docs/data/`**: enforced by pre-push + CI first-step guards.
6. **Byte-determinism**: regen non-PR content byte-matches committed state.
7. **Atomic slice 2d**: version bump + test flip + 260 rollup regen in ONE commit.
8. **Cross-OS**: pathlib, UTF-8, no shell invocations, git subprocess with forward-slash paths.
9. **PAT secrecy**: env var only, never argv, never committed, rotate post-use.
10. **Privacy-review test**: committed distribution fixtures contain zero tenant tokens.

## Where to look

| Question | File |
|---|---|
| What are the user-visible outcomes? | [`spec.md`](./spec.md) — User Stories |
| What decisions were made and why? | [`research.md`](./research.md) |
| What shape do the entities take? | [`data-model.md`](./data-model.md) |
| How does the binary gate work? | [`contracts/demo-strip-gate-v2.md`](./contracts/demo-strip-gate-v2.md) |
| When and how is the sentinel written/consumed? | [`contracts/synthetic-authorization-signal.md`](./contracts/synthetic-authorization-signal.md) |
| What's in the committed distribution fixtures? | [`contracts/distribution-fixture-schema.md`](./contracts/distribution-fixture-schema.md) |
| How do we prove byte-determinism? | [`contracts/byte-determinism-regen.md`](./contracts/byte-determinism-regen.md) |
| What are the tasks to execute? | `tasks.md` (generated by `/speckit.tasks`, NOT yet present) |

## Gotchas

- **Do NOT commit `.tmp/oddessentials-extract.sqlite`.** `.gitignore` blocks it, but `git add -f` would override. Don't do that.
- **Do NOT hard-code the PAT anywhere.** Environment variable only.
- **Do NOT redefine `PrRecord`.** Import it from `src/ado_git_repo_insights/types.py:289`.
- **Do NOT edit the aggregator.** Zero edits under `src/ado_git_repo_insights/transform/`.
- **Do NOT skip the ratchet bump.** Every slice that adds N tests bumps `.test-floor-contract.json` by exactly N in the same commit.
- **Do NOT split slice 2d.** The version bump + test flip + artifact regen MUST land in one commit; otherwise the schema-guard misreports contract drift.

## Contacts / references

- **Issue**: https://github.com/oddessentials/ado-git-repo-insights/issues/315
- **Related**: https://github.com/oddessentials/ado-git-repo-insights/issues/318
- **Supersedes contract**: `specs/060-throughput-pr-drilldown/contracts/demo-strip-gate.md` (feature 060's destination-identity gate)
- **Constitution**: `.specify/memory/constitution.md` v1.5.0
