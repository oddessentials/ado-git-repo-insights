# Data Model: Synthetic Demo Exercises PR-Level Detail

**Feature**: `309-demo-pr-drilldown`
**Date**: 2026-04-20

This document defines the entities this feature introduces or extends, with field types, relationships, validation rules, and lifecycle transitions.

## 1. Synthetic PR Record

**Description**: An entry in the `prs` array of a weekly rollup, representing one synthesized pull request. Conforms to the aggregator's existing `PrRecord` TypedDict shape — the synthetic generator imports this type from `src/ado_git_repo_insights/types.py:289` and MUST NOT redefine it.

**Fields** (all required, no optional fields):

| Field | Type | Validation |
|---|---|---|
| `id` | `int` | Positive integer. Unique within the entire synthetic dataset (not only per-week). |
| `title` | `str` | Non-empty. Sampled from the token bank in `scripts/demo-distributions/title-tokens.json`. MUST NOT contain any tenant-identifying substring. |
| `author_id` | `str` | Non-empty. Matches a synthetic user id from the existing `SyntheticUser` generator. |
| `repository_id` | `str` | Non-empty. Matches a synthetic repository id from the existing `REPO_*` name tables. |
| `cycle_time` | `float` | Finite, non-negative. Drawn from the per-repo lognormal distribution already parameterized at `REPO_CYCLE_TIME_CATEGORY`. |

**Shape invariant**: `set(pr.keys()) == {"id", "title", "author_id", "repository_id", "cycle_time"}` for every PR record. Static check via `mypy --strict` on the synthetic generator; runtime check via `test_synthetic_pr_contract.py`.

**Relationships**:
- Each record belongs to exactly one weekly rollup (the rollup in whose `prs` array it appears).
- `author_id` points into `dimensions.json#users[*].user_id`.
- `repository_id` points into `dimensions.json#repositories[*].repository_id`.
- `cycle_time` is one sample from the same distribution the rollup's `cycle_time_p50`/`cycle_time_p90` are derived from, but the rollup stats are computed across ALL qualified PRs (including those truncated out) so the PR list is not a population of the stats.

**Lifecycle**: born during `generate_pr_records()`; serialized as part of the rollup JSON; never mutated after emission. Stripped at publish boundary when sentinel is absent.

## 2. Synthetic-Authorization Signal (Sentinel)

**Description**: A zero-length file at `artifacts/demo-enterprise/data/aggregates/.synthetic-prs-authorized` whose presence attests that the source artifact's PR-level content is synthesized and may be published.

**Fields**: no structured fields; existence of the file IS the signal. File content (if any) is ignored.

**Validation rules**:
- MUST be written by `scripts/build-demo-dataset.py` ONLY. Every other code surface under `src/**`, `scripts/**` (except the orchestrator), or any CLI module invoked by `ado-insights` MUST NOT write a file with this name at this path. Enforced by `test_tenant_provenance_negative.py`.
- MUST NOT appear anywhere under `docs/data/`. Enforced by the pre-push sentinel-absence guard and the CI first-step guard.
- MUST be present at `promote_data` invocation time IFF the source artifact's PR-level content is synthetic and intended for public publication.

**Lifecycle**:
1. **Written**: by `scripts/build-demo-dataset.py` immediately after `generate-demo-data.py` completes (before `promote_data` runs). One and only one writer.
2. **Read**: by `promote_data` as the first step of the gate. `Path.exists()` returns True → enter sentinel-present branch.
3. **Consumed**: `sentinel.unlink()` is the FIRST mutation inside the sentinel-present branch, before any `destination.mkdir()`, `shutil.copytree()`, or shape verification.
4. **Absent at destination**: after promotion, the sentinel is gone from the source AND never copied to the destination. Pre-push + CI guards verify absence in `docs/data/` at every push boundary.

**Relationships**:
- Paired one-to-one with the synthetic source artifact tree. Never stands alone.
- Adjacent to `weekly_rollups/` under the same `aggregates/` parent directory.

## 3. Statistical Distribution Fixture

**Description**: Committed JSON files under `scripts/demo-distributions/` carrying anonymized statistical summaries derived one-time from a real tenant extract. The synthetic generator reads these at runtime to produce realistic PR volume, author/repo concentration, title-token frequency, and cycle-time distributions.

**Files** (each a top-level JSON object):

### 3.1 `title-tokens.json`

| Field | Type | Description |
|---|---|---|
| `tokens` | `list[object]` | Token frequency table. |
| `tokens[i].token` | `str` | Lowercased word/phrase bigram, max 24 chars. |
| `tokens[i].weight` | `float` | Relative frequency weight in [0.0, 1.0]. |
| `source_sample_size` | `int` | Number of tenant PRs sampled for derivation. |
| `privacy_review_date` | `str` | ISO-8601 date when privacy review passed. |

**Privacy invariant**: tokens MUST NOT include tenant team names, repo names, author login fragments, or email-address-shaped patterns. Enforced by `test_distribution_fixture_privacy.py` at commit time.

### 3.2 `cycle-time-per-repo-size.json`

| Field | Type | Description |
|---|---|---|
| `categories` | `dict[str, object]` | Keyed by repo-size category label (`small`, `medium`, `large`). |
| `categories[cat].mu` | `float` | Lognormal μ (location). |
| `categories[cat].sigma` | `float` | Lognormal σ (scale). Must be > 0. |
| `source_sample_size` | `int` | PRs sampled per category. |

### 3.3 `author-concentration.json`

| Field | Type | Description |
|---|---|---|
| `authors_per_week` | `object` | Quantile distribution of distinct authors per week. |
| `authors_per_week.p50` | `float` | Median. |
| `authors_per_week.p90` | `float` | 90th percentile. |
| `author_repo_concentration` | `float` | Gini-style concentration coefficient in [0.0, 1.0]. |

### 3.4 `pr-count-per-week-per-repo.json`

| Field | Type | Description |
|---|---|---|
| `repos` | `dict[str, object]` | Per-repo-category PR volume stats. |
| `repos[cat].weekly_mean` | `float` | Mean PRs/week. |
| `repos[cat].weekly_std` | `float` | Stdev. |

### 3.5 `truncation-exercise-week.json`

| Field | Type | Description |
|---|---|---|
| `week` | `str` | ISO-week label, literally `"2025-W26"`. |
| `target_qualified_pr_count` | `int` | Target PR count; MUST be > 500 (locked: 520). |
| `contrast_weeks` | `list[str]` | Literal `["2025-W25", "2025-W27"]`. |
| `contrast_max_pr_count` | `int` | Max PR count on contrast weeks; MUST be ≤ 500 (locked: 300). |

**Shape invariant across all five fixtures**: no tenant-identifying strings. Enforced by commit-time privacy-review test.

## 4. Demo Contract Version

**Description**: A semantic version identifier on `dataset-manifest.json` signaling the synthetic demo schema revision. Bumps atomically with every schema-visible change; serves as the single drift-detection signal for downstream consumers.

**Location**:
- `scripts/build-demo-dataset.py:54` — Python constant `DEMO_PROFILE_VERSION`
- `artifacts/demo-enterprise/data/dataset-manifest.json` — `demo_profile.version` field
- `docs/data/dataset-manifest.json` — same field, post-promotion copy

**Transition (this feature)**:
- Before: `"2.0.0"` (feature-060 state)
- After (slice 2d atomic commit): `"2.1.0"`

**Validation rule**: Python constant and manifest field MUST match byte-for-byte. `test_demo_parity_pipeline.py::test_manifest_declares_canonical_generation_provenance` (existing) validates.

## 5. Weekly Rollup (extended)

**Description**: Existing aggregated demo artifact (one JSON per ISO week). Extended by this feature with three new top-level keys when the source is synthetic.

**Added fields** (appended LAST in dict insertion order):

| Field | Type | Invariant |
|---|---|---|
| `prs` | `list[PrRecord]` | `len(prs) <= _prs_cap`. Sorted by `(-cycle_time, id)` stable. Subset of qualified PRs for the week (i.e., non-null, finite `cycle_time`). |
| `_prs_truncated` | `bool` | `True` iff total qualified PRs for the week exceeded `_prs_cap`. |
| `_prs_cap` | `int` | Constant `500` across all rollups. |

**Invariant preservation**: Existing fields (`pr_count`, `by_author`, `by_repository`, etc.) are UNCHANGED by this feature. Regen byte-equality test (`test_regen_byte_stability.py`) verifies every non-PR-field byte-matches the committed state.

**Per-week contract for the contracted weeks**:

| Week | `_prs_truncated` | `len(prs)` |
|---|---|---|
| `2025-W26` | `True` | `500` (capped; total qualified is 520) |
| `2025-W25` | `False` | actual qualified PR count (≤ 500) |
| `2025-W27` | `False` | actual qualified PR count (≤ 500) |

## 6. Public Demo Surface

**Description**: The subset of the repository published to the GitHub Pages endpoint at https://oddessentials.github.io/ado-git-repo-insights/. Privacy invariant applies only here; private tenant artifacts are unaffected.

**Contents this feature affects**:
- `docs/data/aggregates/weekly_rollups/*.json` — 260 files; each gains `prs`/`_prs_truncated`/`_prs_cap` when the source is synthetic-authorized.
- `docs/data/dataset-manifest.json` — `demo_profile.version` bumps to `"2.1.0"`.

**Contents this feature does NOT affect**:
- `docs/data/aggregates/dimensions.json` — unchanged (existing dims include the users / repositories the PR records reference).
- `docs/data/aggregates/distributions/*.json` — unchanged.
- `docs/data/aggregates/comments/*.json` — unchanged (separate aggregation).
- `docs/data/index.html`, `docs/data/*.css` — unchanged (no UI work).

**Absence invariant**: `.synthetic-prs-authorized` MUST NOT appear anywhere under `docs/data/` at any time. Pre-push + CI guards enforce.

## 7. Entity Relationship Summary

```text
Statistical Distribution Fixture (scripts/demo-distributions/*.json)
                │
                ▼
      generate_pr_records()  (scripts/generate-demo-data.py)
                │
                ▼
   Synthetic PR Record (list[PrRecord])
                │
                │  appended LAST to
                ▼
   Weekly Rollup (artifacts/demo-enterprise/data/aggregates/weekly_rollups/*.json)
                │                                     ▲
                │                                     │  paired with
                ▼                                     │
   promote_data()  ←── reads ──  Synthetic-Authorization Signal
                │                 (.synthetic-prs-authorized)
                │
                ▼
        Public Demo Surface (docs/data/)
                │
                ▼
   Demo Contract Version  (dataset-manifest.json / DEMO_PROFILE_VERSION)
```

## 8. Validation Summary

| Invariant | Enforced by | Source of truth |
|---|---|---|
| `PrRecord` shape locked | `mypy --strict` on synthetic generator + contract test | `src/ado_git_repo_insights/types.py:289` |
| Sentinel written by orchestrator only | `test_tenant_provenance_negative.py` | `git ls-files --cached src/ scripts/` grep |
| Sentinel never in `docs/data/` | Pre-push + CI guards | `run_pre_push_hook()` (via `run_sentinel_absence_check`) + `demo.yml` first-step (`python scripts/run_repo_hook.py sentinel-absence`) |
| Cap = 500 | `test_synthetic_pr_contract.py` | `_PR_DETAIL_CAP` constant in aggregator |
| 2025-W26 truncated, W25/W27 not | `test_truncation_exercise_week_locked` | Hard-coded literal in test |
| Byte-determinism for non-PR content | `test_regen_byte_stability.py` | Prior committed rollup bytes |
| Distribution fixtures tenant-safe | `test_distribution_fixture_privacy.py` | Blocklist + positive-shape checks |
| Gate binary (no third path) | Runtime `assert not sentinel.exists()` + atomicity tests | `promote_data` source |
| Staged + worktree clean before promote | `test_assert_inputs_clean.py` | Dual `git diff --cached` + `git diff` |
| Entrypoint-command parity | `test_strip_gate_entrypoint_parity.py` | `subprocess.run` on both invocations |
