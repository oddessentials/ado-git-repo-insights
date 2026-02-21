# Research: Realistic Demo Data

**Branch**: `031-realistic-demo-data` | **Date**: 2026-02-21

## Decision 1: Locked RNG Implementation (Contract 2)

**Decision**: Use Box-Muller transform with `random.Random.random()` base for all distribution sampling.

**Rationale**: Python's `random.lognormvariate()` calls `random.gauss()` internally, whose implementation changed between Python 3.11 and 3.12 (the Kinderman-Monahan algorithm was replaced). This makes cross-version output non-identical. The Box-Muller transform uses only `random()` (contractually stable), `math.sqrt`, `math.log`, `math.cos`, and `math.pi` — all of which are IEEE 754 deterministic operations.

**Implementation**:
```python
def _box_muller_normal(rng: random.Random) -> float:
    """Generate standard normal variate using Box-Muller transform.

    Uses only rng.random() and stable math operations.
    Contractually deterministic on Python 3.12+ (Contract 2).
    """
    u1 = rng.random()
    u2 = rng.random()
    # Avoid log(0) — random() returns [0.0, 1.0), so u1 could be 0
    while u1 == 0.0:
        u1 = rng.random()
    return math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)


def _log_normal(rng: random.Random, mu: float, sigma: float) -> float:
    """Generate log-normal variate using locked Box-Muller implementation."""
    return math.exp(mu + sigma * _box_muller_normal(rng))
```

**Alternatives considered**:
- `random.lognormvariate()`: Not stable across Python versions (rejected).
- NumPy `Generator(PCG64(seed))`: Adds external dependency to a zero-dependency generator script (rejected).
- Inverse-CDF with `math.erfinv()`: `erfinv` is not in Python stdlib; would need manual implementation (more complex, no benefit over Box-Muller).

## Decision 2: Schema Completeness Guard Strategy (Contract 1)

**Decision**: Python test reads `extension/ui/schemas/rollup.schema.ts` at test time, extracts `KNOWN_ROOT_FIELDS` and `KNOWN_BREAKDOWN_FIELDS` via regex, and asserts all non-deprecated fields appear in a sample generated rollup.

**Rationale**: The TypeScript schema file (`rollup.schema.ts`) is the single source of truth per Contract 1. The test must read from that file, not maintain a duplicate list. Regex extraction is fragile but fails visibly if the file format changes (which is the desired behavior — the test should break loudly on schema changes).

**Implementation**:
```python
import re

def _extract_ts_set_fields(ts_source: str, set_name: str) -> set[str]:
    """Extract field names from a TypeScript `new Set([...])` or `Set([...])` declaration."""
    pattern = rf'{set_name}\s*=\s*new\s+Set\(\[\s*(.*?)\s*\]\)'
    match = re.search(pattern, ts_source, re.DOTALL)
    if not match:
        raise ValueError(f"Could not find {set_name} in schema source")
    fields_str = match.group(1)
    return set(re.findall(r'"(\w+)"', fields_str))
```

**Deprecated fields** (excluded from guard): `review_time_p50`, `review_time_p90` — present in schema for forward compatibility but explicitly out of scope per spec assumptions.

**Alternatives considered**:
- Shared JSON schema file read by both Python and TypeScript: Would require refactoring the TypeScript schema validator to read from JSON instead of hardcoded `Set()`. Higher coupling, more churn (rejected).
- Node.js subprocess to extract fields: Adds Node.js runtime dependency to Python tests (rejected).
- Manual field list in Python test: Violates Contract 1 — creates a second copy of the field list (rejected).

## Decision 3: Power-Law Repository Activity Distribution (Contract 5)

**Decision**: Use Pareto-weighted repo activity with per-repo weight constants, not runtime Pareto sampling.

**Rationale**: True `random.paretovariate()` would produce different ranks each run even with the same seed (since rankings emerge from sampling). Instead, we assign fixed weight constants to each of the 23 repos at definition time, following a power-law decay (weight ∝ 1/rank^α where α ≈ 0.8). The top 3 repos get ~45% of total weight, satisfying the ≥40% invariant (SC-002).

**Repo categories and weights**:
- **High-traffic** (3 repos): `user-service`, `react-shell`, `ios-app` — weights 1.0, 0.9, 0.85
- **Medium-traffic** (8 repos): `auth-service`, `gateway-core`, `android-app`, etc. — weights 0.5–0.7
- **Low-traffic** (7 repos): `rate-limiter`, `ci-scripts`, `terraform-modules`, etc. — weights 0.15–0.3
- **Idle** (5 repos): `monitoring-stack`, `shared-core`, `forms-lib`, etc. — weights 0.05–0.1

These weights are normalized per week and fed to `_largest_remainder_allocate()`.

**Alternatives considered**:
- Runtime Pareto sampling: Produces correct distribution shape but unstable rankings across seeds (rejected).
- Zipf's law (1/rank): Too steep — the top repo would dominate unrealistically (rejected).
- Uniform weights (current): Fails SC-002 — no repo concentration (rejected, the whole point).

## Decision 4: Team-Repo Affinity Matrix (Contract 5, FR-007)

**Decision**: Each team has 2–3 designated primary repos defined as constants. Team PR allocation uses a two-phase approach: (1) allocate 65% of team PRs to primary repos, (2) distribute remaining 35% across all repos weighted by repo activity.

**Affinity mapping**:
```python
TEAM_PRIMARY_REPOS = {
    "Platform Team": ["user-service", "auth-service", "notification-service"],
    "Frontend Team": ["react-shell", "design-system", "ios-app"],
    "Data Team": ["etl-jobs", "data-warehouse", "stream-processor"],
    "ML Team": ["model-training", "inference-service", "feature-store"],
}
```

**Rationale**: Real engineering teams work primarily on repos owned by their team but occasionally contribute to shared repos. A 65/35 split ensures ≥60% affinity (SC-009) while allowing realistic cross-team contributions.

**Alternatives considered**:
- 100% affinity (teams only contribute to their own repos): Unrealistic — no cross-team collaboration (rejected).
- Soft affinity via weight multipliers: Harder to guarantee the ≥60% threshold deterministically (rejected).

## Decision 5: Cycle Time Variation by Repo Category (FR-008)

**Decision**: Assign cycle time multipliers per repo category. Utility/devops repos are 2–3x faster than data/ML repos.

**Category multipliers** (applied to base cycle time mu):
- **Utility/DevOps**: `ci-scripts`, `terraform-modules`, `monitoring-stack`, `rate-limiter` — mu_factor = 0.5 (faster)
- **Frontend**: `react-shell`, `design-system`, `ios-app`, `android-app`, `forms-lib` — mu_factor = 0.8
- **Backend**: `user-service`, `auth-service`, `gateway-core`, `notification-service`, `dashboard-api` — mu_factor = 1.0
- **Data/ML**: `etl-jobs`, `data-warehouse`, `stream-processor`, `model-training`, `inference-service`, `feature-store`, `metrics-collector`, `report-generator` — mu_factor = 1.3 (slower)

With base mu=6.0, utility repos get mu=3.0 and data/ML repos get mu=7.8, giving ≥2x ratio (SC, FR-008).

## Decision 6: Year-over-Year Growth Model (FR-005)

**Decision**: Apply a linear growth multiplier to `BASE_PR_COUNT` per year. Year 1 (2021) uses 1.0x, Year 5 (2025) uses ~1.5x.

**Formula**: `growth_factor = 1.0 + GROWTH_RATE_PER_YEAR * (year - START_YEAR)` where `GROWTH_RATE_PER_YEAR = 0.12`.

This gives: 2021=1.0x, 2022=1.12x, 2023=1.24x, 2024=1.36x, 2025=1.48x.
Final-year/first-year ratio = 1.48x, satisfying the ≥1.3x invariant (SC-003).

**Alternatives considered**:
- Exponential growth: Too aggressive for 5 years — would make early years look empty (rejected).
- Step function: Unrealistic — real orgs grow gradually (rejected).

## Decision 7: Holiday Week Suppression (FR-006)

**Decision**: Apply a suppression multiplier for week 52 of each year. Multiplier = 0.35 (35% of normal activity).

**Rationale**: Week 52 (late December) typically has 60–80% fewer PRs due to holidays. A 0.35 multiplier ensures the count is ≤60% of the year's average (SC-008), accounting for the fact that the year's average includes the dip itself.

The existing seasonal sinusoidal model already creates a mild dip around week 52, but it's not strong enough to meet the ≤60% threshold. The explicit holiday multiplier overrides the sinusoidal for week 52.

## Decision 8: Orchestrator Design (FR-012)

**Decision**: Create a thin Python orchestrator script `scripts/regenerate-demo.py` that runs all three generators in sequence.

**Rationale**: A Python script (not shell) ensures cross-platform compatibility (Windows + Linux + macOS). It imports and calls each generator's `main()` function directly, avoiding subprocess overhead and ensuring the same Python interpreter is used.

**Implementation**:
```python
#!/usr/bin/env python3
"""Regenerate all demo data in dependency order (FR-012)."""
from generate_demo_data import main as gen_data
from generate_demo_predictions import main as gen_predictions
from generate_demo_insights import main as gen_insights

def main() -> int:
    for step, gen in [("data", gen_data), ("predictions", gen_predictions), ("insights", gen_insights)]:
        print(f"\n{'='*60}\nStep: {step}\n{'='*60}")
        rc = gen()
        if rc != 0:
            print(f"FAILED: {step} returned {rc}")
            return rc
    print("\nAll generators completed successfully.")
    return 0
```

**Alternatives considered**:
- Shell script orchestrator: Not cross-platform (Windows requires separate `.ps1`) (rejected).
- Makefile: Adds build system dependency, not commonly used in this project (rejected).
- Modifying `build-demo.sh`: That script handles UI build + asset copying, not data generation. Mixing concerns (rejected).

## Decision 9: File I/O Standardization (FR-014)

**Decision**: All three generators use `path.write_bytes(content.encode("utf-8"))` for binary-mode output.

**Rationale**: The demo data generator already uses binary mode. The predictions and insights generators use `write_text(newline="\n")`, which is functionally equivalent on all platforms but differs in implementation. Standardizing to binary mode makes the contract explicit and eliminates any platform-dependent behavior.

**Files to update**: `generate-demo-predictions.py` (line 101), `generate-demo-insights.py` (line 122).

## Decision 10: Manifest Version Update (FR-010, FR-018)

**Decision**: Set `aggregates_schema_version: 2` in the demo data generator. Read the value from the Python backend constant `AGGREGATES_SCHEMA_VERSION` in `aggregators.py`.

**Rationale**: The dashboard expects version 2 (`SUPPORTED_AGGREGATES_VERSION = 2` in `dataset-loader.ts`). The generator currently writes version 1. Per FR-018, the dashboard is authoritative, and the generator must reference its expected version.

**Implementation**: Import `AGGREGATES_SCHEMA_VERSION` from `src/ado_git_repo_insights/transform/aggregators.py` (which is 2). The generator script already has `sys.path` manipulation patterns (see `generate-synthetic-dataset.py` lines 19-21).

Also add `features.cross_dimensional: true` to the manifest after generating `by_team_and_repo` data.
