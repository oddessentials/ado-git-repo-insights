# Research: ML Metrics Accuracy Fixes

**Feature**: 005-ml-metrics-fixes
**Date**: 2026-01-27

## Research Topics

### 1. P90 Percentile Calculation in SQLite

**Decision**: Use SQL window function with NTILE or subquery approach

**Rationale**:
- SQLite 3.25+ supports window functions including NTILE
- Pandas `quantile(0.9)` is also available but SQL is preferred per Constitution Principle V
- For small datasets (<100 rows), simple sorted subquery is sufficient
- For larger datasets, NTILE(10) approach provides O(n log n) performance

**Implementation Approach**:
```sql
-- Option A: Subquery with LIMIT/OFFSET (simple, works for all SQLite versions)
SELECT cycle_time_minutes
FROM pull_requests
WHERE cycle_time_minutes IS NOT NULL
ORDER BY cycle_time_minutes
LIMIT 1 OFFSET (
    SELECT CAST(COUNT(*) * 0.9 AS INTEGER)
    FROM pull_requests
    WHERE cycle_time_minutes IS NOT NULL
)

-- Option B: Using pandas (alternative if SQL complexity is too high)
df['cycle_time_minutes'].quantile(0.9)
```

**Selected**: Option A (SQL subquery) - keeps calculation in SQLite per constitution

**Alternatives Considered**:
- NumPy `np.percentile()` - requires loading all data into memory
- Approximate algorithms (t-digest) - overkill for dataset sizes <100k

---

### 2. Review Time Data Availability

**Decision**: Remove review_time_minutes from forecasts; show "unavailable" in dashboard

**Rationale**:
- Current schema does NOT have a dedicated review_time_minutes column
- Review time would require calculating time between first review request and approval
- This is a data collection change that is explicitly OUT OF SCOPE
- Showing cycle time labeled as review time is misleading (current bug)

**Implementation Approach**:
1. Remove `("review_time_minutes", "minutes")` from METRICS list in both forecasters
2. Add dashboard message: "Review time forecasts require review duration data collection"
3. Keep schema version unchanged (removing a metric is backward compatible)

**Alternatives Considered**:
- Calculate review time from existing data - requires complex PR timeline parsing, not reliable
- Keep proxy with disclaimer - still misleading, rejected

---

### 3. Deterministic PRNG for TypeScript

**Decision**: Use mulberry32 seeded PRNG algorithm

**Rationale**:
- `Math.random()` is not seedable in JavaScript
- mulberry32 is a well-tested 32-bit PRNG with good distribution
- Single fixed seed provides consistent preview data
- Algorithm is simple (4 lines) and has no dependencies

**Implementation**:
```typescript
// mulberry32 - fast 32-bit PRNG
function mulberry32(seed: number): () => number {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Usage: const random = mulberry32(12345);
// random() returns consistent values for same seed
```

**Fixed Seed Value**: `0x5EEDF00D` ("seed food" - memorable, consistent)

**Alternatives Considered**:
- seedrandom library - adds npm dependency, overkill for this use case
- xorshift128 - more complex, not needed for preview data quality
- Date-based seed - would change daily, not truly deterministic

---

### 4. Test ResourceWarning Investigation

**Decision**: Warnings come from pytest's garbage collection timing, not fixture leaks

**Rationale**:
- Code review found all fixtures properly close connections
- `test_db_open_failure.py` has explicit `.close()` calls (lines 48, 90, 114)
- Warnings appear during pytest's GC phase after test completion
- Mock objects in unit tests don't have real connections to leak

**Root Cause Analysis**:
- ResourceWarnings occur when Python's garbage collector runs
- Some test modules import real database classes even when mocked
- The warnings reference unrelated code paths (holidays library, pathlib)
- These are "false positive" warnings from import-time side effects

**Implementation Approach**:
1. Add `filterwarnings` to pytest.ini to suppress specific ResourceWarnings
2. Or use `pytest.mark.filterwarnings` on affected test classes
3. Verify no actual connection leaks with explicit connection tracking

**pytest.ini addition**:
```ini
filterwarnings =
    ignore::ResourceWarning:_pytest
```

**Alternatives Considered**:
- Rewrite all fixtures to use context managers - unnecessary, already properly closed
- Disable GC during tests - could mask real issues
- Ignore warnings entirely - could mask future real leaks

---

## Summary of Decisions

| Topic | Decision | Complexity |
|-------|----------|------------|
| P90 Calculation | SQL subquery with LIMIT/OFFSET | Low |
| Review Time | Remove metric, show "unavailable" | Low |
| Deterministic PRNG | mulberry32 with fixed seed | Low |
| ResourceWarnings | pytest filterwarnings config | Low |

**Total Implementation Risk**: Low - all changes are localized and well-understood
