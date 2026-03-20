# Quickstart: Realistic Demo Data

**Branch**: `031-realistic-demo-data` | **Date**: 2026-02-21

## Running the Generators

### Full Pipeline (Recommended)

```bash
python scripts/regenerate-demo.py
```

Runs all three generators in dependency order:
1. `generate-demo-data.py` — weekly rollups, dimensions, distributions, manifest
2. `generate-demo-predictions.py` — trend forecasts (reads rollups)
3. `generate-demo-insights.py` — AI insights (reads rollups)

### Individual Generators

```bash
python scripts/generate-demo-data.py
python scripts/generate-demo-predictions.py
python scripts/generate-demo-insights.py
```

Order matters. Predictions and insights depend on data generator output.

## Verifying Output

### Quick Verification

```bash
# Check a sample rollup has by_team_and_repo
python -c "
import json
from pathlib import Path
data = json.loads((Path('docs/data/aggregates/weekly_rollups/2025-W26.json')).read_text())
print('by_team_and_repo present:', 'by_team_and_repo' in data)
for team, repos in data.get('by_team_and_repo', {}).items():
    print(f'  {team}: {len(repos)} repos, {sum(r[\"pr_count\"] for r in repos.values())} PRs')
"
```

### Running Tests

```bash
# Demo-specific tests (determinism, schema guard, invariants)
cd src && pytest ../tests/demo/ -v

# Full test suite
cd src && pytest

# JS tests
cd extension && pnpm test:unit
```

### Schema Completeness Guard

The schema completeness test reads field names from `extension/ui/schemas/rollup.schema.ts` at test time and asserts all non-deprecated fields appear in generated demo data.

To verify: Add a dummy field to `KNOWN_ROOT_FIELDS` in `rollup.schema.ts`, run the guard test, confirm it fails naming the missing field.

```bash
cd src && pytest ../tests/demo/test_schema_guard.py -v
```

## Key Paths

| File | Purpose |
|------|---------|
| `scripts/generate-demo-data.py` | Main demo data generator |
| `scripts/generate-demo-predictions.py` | Prediction/trend generator |
| `scripts/generate-demo-insights.py` | AI insights generator |
| `scripts/regenerate-demo.py` | Orchestrator (runs all three) |
| `docs/data/` | Generated output directory |
| `docs/data/dataset-manifest.json` | Dataset manifest |
| `docs/data/aggregates/weekly_rollups/` | 260 weekly rollup JSON files |
| `extension/ui/schemas/rollup.schema.ts` | Canonical schema (Contract 1) |
| `src/ado_git_repo_insights/transform/aggregators.py` | Schema version constants |
| `tests/demo/test_regeneration.py` | Determinism tests |
| `tests/demo/test_schema_guard.py` | Schema completeness guard (NEW) |
| `tests/demo/test_realism_invariants.py` | Frozen demo invariants (NEW) |
| `tests/demo/test_cross_dim.py` | Cross-dimensional completeness (NEW) |

## Frozen Demo Invariants

The following thresholds are tied to the demo org shape (23 repos, 4 teams, 50 users, 260 weeks) per Contract 5:

| Invariant | Threshold | Verification |
|-----------|-----------|--------------|
| Top-3 repo share | >= 40% | `test_realism_invariants.py::test_top3_repo_share` |
| YoY growth | final/first >= 1.3x | `test_realism_invariants.py::test_yoy_growth` |
| Holiday dip | week 52 <= 60% of year avg | `test_realism_invariants.py::test_holiday_dip` |
| Idle repo-weeks | >= 20% | `test_realism_invariants.py::test_idle_repo_weeks` |
| Team affinity | >= 60% in primary repos | `test_realism_invariants.py::test_team_affinity` |
| Cycle time ratio | utility/data-ML <= 0.5 | `test_realism_invariants.py::test_cycle_time_ratio` |
| Determinism | byte-identical across runs | `test_regeneration.py` |

## Debugging

### Check Cross-Dimensional Consistency

```bash
python -c "
import json
from pathlib import Path

rollups_dir = Path('docs/data/aggregates/weekly_rollups')
errors = []
for f in sorted(rollups_dir.glob('*.json')):
    data = json.loads(f.read_text())
    by_team = data.get('by_team', {})
    by_team_and_repo = data.get('by_team_and_repo', {})

    if not by_team_and_repo:
        errors.append(f'{f.name}: missing by_team_and_repo')
        continue

    for team, team_entry in by_team.items():
        if team not in by_team_and_repo:
            errors.append(f'{f.name}: team {team} missing from by_team_and_repo')
            continue
        repo_sum = sum(r['pr_count'] for r in by_team_and_repo[team].values())
        if repo_sum != team_entry['pr_count']:
            errors.append(f'{f.name}: {team} sum={repo_sum} != {team_entry[\"pr_count\"]}')

if errors:
    print(f'{len(errors)} errors found:')
    for e in errors[:10]:
        print(f'  {e}')
else:
    print('All 260 rollups pass cross-dimensional consistency check.')
"
```
