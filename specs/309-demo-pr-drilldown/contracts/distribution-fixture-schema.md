# Contract: Statistical Distribution Fixture Schema

**Feature**: `309-demo-pr-drilldown`

Defines the JSON schemas for committed fixtures under `scripts/demo-distributions/`, the derivation procedure, and the privacy-review gate that protects the commit boundary.

**Authoritative spec refs**: FR-007, FR-024 (from [`spec.md`](../spec.md)).

## 1. File inventory

Five JSON files, each at `scripts/demo-distributions/<name>.json`:

1. `title-tokens.json` — PR title token frequency
2. `cycle-time-per-repo-size.json` — per-repo-category cycle time distribution
3. `author-concentration.json` — author-per-week / author-per-repo concentration
4. `pr-count-per-week-per-repo.json` — weekly PR volume per repo category
5. `truncation-exercise-week.json` — deterministic spike configuration

Each file is a top-level JSON object. Field-level schemas below.

## 2. Schemas

### 2.1 `title-tokens.json`

```json
{
  "tokens": [
    { "token": "<word-or-short-bigram>", "weight": <float in [0.0, 1.0]> }
  ],
  "source_sample_size": <int>,
  "privacy_review_date": "<ISO-8601 date>"
}
```

**Constraints**:
- `tokens` is non-empty, unbounded length.
- Every `token` value is lowercase, length ≤ 24, contains only `[a-z0-9\-]` after normalization (stopwords, numbers, and hyphens allowed; any other punctuation stripped during derivation).
- `weight` values sum to 1.0 ± 0.01 (normalized frequency).
- Privacy invariant: no token in the token list matches ANY of:
  - A tenant team name (matched against the tenant's `dimensions.json#teams[*].team_name`)
  - A tenant repo name (matched against `dimensions.json#repositories[*].repository_name`)
  - A tenant author login fragment (any substring ≥ 6 chars of any real `user_id`)
  - An email-address-shaped pattern (regex `\S+@\S+\.\S+`)
  - A URL-like pattern (regex `https?://\S+`)
- Privacy enforcement: `tests/unit/test_distribution_fixture_privacy.py` at commit time.

### 2.2 `cycle-time-per-repo-size.json`

```json
{
  "categories": {
    "small":  { "mu": <float>, "sigma": <float>, "source_sample_size": <int> },
    "medium": { "mu": <float>, "sigma": <float>, "source_sample_size": <int> },
    "large":  { "mu": <float>, "sigma": <float>, "source_sample_size": <int> }
  },
  "privacy_review_date": "<ISO-8601 date>"
}
```

**Constraints**:
- Exactly three categories: `small`, `medium`, `large`.
- `mu` is the lognormal location parameter; `sigma > 0` is the scale.
- `source_sample_size >= 50` per category (statistical stability floor).

### 2.3 `author-concentration.json`

```json
{
  "authors_per_week": {
    "p50": <float>,
    "p90": <float>,
    "p99": <float>
  },
  "author_repo_concentration": <float in [0.0, 1.0]>,
  "privacy_review_date": "<ISO-8601 date>"
}
```

**Constraints**:
- `p50 <= p90 <= p99` (monotonic).
- `author_repo_concentration` in [0.0, 1.0] (Gini-style coefficient; higher = more concentrated).

### 2.4 `pr-count-per-week-per-repo.json`

```json
{
  "repos": {
    "high-volume":   { "weekly_mean": <float>, "weekly_std": <float> },
    "medium-volume": { "weekly_mean": <float>, "weekly_std": <float> },
    "low-volume":    { "weekly_mean": <float>, "weekly_std": <float> }
  },
  "privacy_review_date": "<ISO-8601 date>"
}
```

**Constraints**:
- Three volume categories: `high-volume`, `medium-volume`, `low-volume`.
- `weekly_mean > 0`; `weekly_std >= 0`.

### 2.5 `truncation-exercise-week.json`

```json
{
  "week": "2025-W26",
  "target_qualified_pr_count": 520,
  "contrast_weeks": ["2025-W25", "2025-W27"],
  "contrast_max_pr_count": 300
}
```

**Constraints** (LOCKED LITERALS):
- `week` MUST equal `"2025-W26"` exactly.
- `target_qualified_pr_count` MUST be `520` exactly (> 500 to exercise truncation; close enough to cap that the spike is recognizable in the data).
- `contrast_weeks` MUST equal `["2025-W25", "2025-W27"]` exactly.
- `contrast_max_pr_count` MUST be `300` exactly (well under cap, visually contrasting).

## 3. Derivation procedure (one-time)

**Scope statement**: the tenant SQLite is a minimal provenance/blocklist seed for shape-safe derivation — not a representative tenant population sample. Sparse dimensions (e.g., a tenant with 3 users) are acceptable inputs: the derivation path and privacy-gate logic are real and deterministic regardless of tenant size. Synthetic richness is the product surface (see `byte-determinism-regen.md` §4 and the generator helper in `scripts/generate-demo-data.py`), not the seed.

**Script**: `scripts/extract_distribution_fixtures.py` (new; standalone).

**Inputs**:
- Local SQLite at `.tmp/oddessentials-extract.sqlite` (developer-only, gitignored).
- Environment variable `ADO_PAT` for the extract step.

**Workflow**:

1. Run `ado-insights extract-prs --org oddessentials --db .tmp/oddessentials-extract.sqlite` with `ADO_PAT` env var. One-time, manual.
2. Run `python scripts/extract_distribution_fixtures.py --db .tmp/oddessentials-extract.sqlite --output scripts/demo-distributions/`. This script:
   - Aggregates PR titles into tokens (stopwords filter, lowercase, length clip).
   - Fits lognormal params per repo-size category (bins computed at derivation time).
   - Computes author concentration and volume percentiles.
   - Emits the five JSON files with `privacy_review_date` set to today's date.
   - Runs an in-process privacy-review assertion before writing: if ANY token, mu/sigma pair, or category key matches a tenant-identifying pattern, the script aborts with a diagnostic.
3. Commit the five JSON files in slice 2a. The commit-time `test_distribution_fixture_privacy.py` re-runs the privacy-review assertion as a CI gate.

**PAT handling**:
- PAT is passed to `ado-insights` via environment variable only.
- The extract-fixtures script does NOT receive the PAT (it reads only the local SQLite).
- Neither script stores the PAT, writes it to a file, or logs it.
- After derivation completes, the developer rotates the PAT (standing operating procedure).

## 4. Privacy-review gate

**What this gate proves**: no blocked tenant tokens/fragments from the selected extract appear in committed fixture files. It does NOT prove "all privacy risk is eliminated" — the upper bound of the guarantee is the completeness of the blocklist source dimensions present in the tenant SQLite at derivation time. Source-dimension sparsity (e.g., 3-user tenants, empty-teams tenants) narrows the gate proportionally; it does not change the gate's contract.

**Test**: `tests/unit/test_distribution_fixture_privacy.py`.

**Checks**:
1. `title-tokens.json` tokens blocklist check (team/repo/login/email/URL).
2. `cycle-time-per-repo-size.json` keys are exactly `{"small", "medium", "large"}`.
3. `author-concentration.json` keys follow the schema exactly.
4. `pr-count-per-week-per-repo.json` keys follow the schema exactly.
5. `truncation-exercise-week.json` literal values match the locked constants (2025-W26, 520, ["2025-W25", "2025-W27"], 300).
6. Every file has a `privacy_review_date` ≤ today and ≥ 2026-04-01.

**Failure mode**: any check failure blocks commit via pre-commit hook AND fails CI. No override marker is accepted.

## 5. Schema stability

These schemas are COMMITTED CONTRACTS for the synthetic demo. Changes require:
1. A schema-version bump (embedded as `schema_version` field — NEW field added in a future revision, not in this feature's initial commit).
2. `DEMO_PROFILE_VERSION` bump (atomic with schema change, per FR-017).
3. Regeneration of all 260 rollup artifacts.
4. Updated privacy-review gate to match new field constraints.

For this feature's initial landing, the schemas above are the locked baseline. No `schema_version` field is added yet — that's future #318 slice territory.

## 6. Cross-OS invariants (QG-39)

- Files written with `json.dump(..., indent=2, ensure_ascii=False, sort_keys=True)` + trailing `\n` (canonical formatting; sort_keys=True for cross-OS stability of dict iteration).
- UTF-8 explicit on every open.
- No OS-specific path separators; JSON content uses only forward-compatible primitives.

## 7. Typing invariants (QG-40)

Derivation script uses precise types:
- `dict[str, list[dict[str, float | int | str]]]` for `tokens` structure
- `dict[str, dict[str, float | int]]` for `categories` / `repos`
- `Literal["2025-W26"]` etc. for locked string constants
- No `typing.Any`.
