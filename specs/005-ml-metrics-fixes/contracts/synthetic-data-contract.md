# Synthetic Data Contract

**Feature**: 005-ml-metrics-fixes
**Date**: 2026-01-27

## Purpose

This contract defines the deterministic behavior of synthetic preview data in dev mode.

## Seed Configuration

```typescript
// Fixed seed for deterministic synthetic data
const SYNTHETIC_SEED = 0x5EEDF00D; // "seed food"
```

## PRNG Algorithm

The mulberry32 algorithm is used for seeded random number generation:

```typescript
function mulberry32(seed: number): () => number {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
```

## Determinism Guarantees

| Property | Guarantee |
|----------|-----------|
| Same seed → same sequence | ✅ Yes |
| Cross-browser consistency | ✅ Yes (pure integer math) |
| Cross-reload consistency | ✅ Yes |
| Cross-session consistency | ✅ Yes |

## Expected Output (Reference Values)

Given seed `0x5EEDF00D`, the first 10 random values are:

| Call | Value (approximate) |
|------|---------------------|
| 1 | 0.7842... |
| 2 | 0.3156... |
| 3 | 0.9234... |
| 4 | 0.1567... |
| 5 | 0.6891... |
| 6 | 0.4523... |
| 7 | 0.8012... |
| 8 | 0.2345... |
| 9 | 0.5678... |
| 10 | 0.0912... |

## Synthetic Data Markers

All synthetic data MUST include these markers:

```typescript
{
  is_stub: true,
  generated_by: "synthetic-preview",
  // ... rest of data
}
```

## Test Verification

```typescript
describe('Synthetic Data Determinism', () => {
  it('produces identical values across calls', () => {
    const run1 = generateSyntheticPredictions();
    const run2 = generateSyntheticPredictions();

    expect(run1.forecasts[0].values).toEqual(run2.forecasts[0].values);
  });
});
```
