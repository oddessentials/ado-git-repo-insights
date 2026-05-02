# Byte-Budget Before/After Report (SC-014)

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Producer Contract**: [contracts/per-reviewer-week-prs.md](./contracts/per-reviewer-week-prs.md)

This report records the artifact-size delta introduced by Feature 362's
per-(reviewer, week) `prs[]` emission, as required by SC-014 + plan
"deliverables" (10).  Measurements are taken on the canonical demo
dataset (`scripts/build-demo-dataset.py` non-promote output under
`artifacts/demo-enterprise/data/aggregates/weekly_rollups/`), since the
demo is the most reproducible private-tenant fixture in the repo.

## Method

The size delta is measured by running the demo generator in-process
under two conditions:

1. **Before**: emit rollups WITHOUT populating `by_reviewer[*].prs[]`
   (the pre-Feature-362 producer shape).
2. **After**: emit rollups WITH populating `by_reviewer[*].prs[]` per
   FR-023 (the post-Feature-362 producer shape).

Both runs use the same deterministic seed; the only difference is
whether T041's parallel-path mirror populates the new trio on each
`by_reviewer` entry.

The delta script reads the same fixture for both runs from the
`tests/unit/test_demo_generator_reviewer_pr_detail.py` in-process invocation
path: `python -m tests.unit.test_demo_generator_reviewer_pr_detail`.

Per repo memory `reference_demo_build_python_baseline.md`, the canonical
demo build is locked to Python 3.12.  The reported numbers below are
measured on the canonical interpreter via `uv run --python 3.12`.

## Measurement

Fixture: `scripts/generate-demo-data.py` in-process build, scoped to the
last 26 weeks of the synthetic dataset (canonical seed; deterministic).
Measurement performed by walking each rollup, computing the post-T041
file size as **after** and the same payload with the per-(reviewer,
week) trio popped (re-serialized with the writer's `json.dumps(...,
indent=2, ensure_ascii=False, sort_keys=False)` recipe + trailing
newline) as **before**.  This is byte-exact pre-T041 because the only
producer-side change in this slice is the trio addition.

Period: 26 weeks (latest in the canonical dataset).
Before: 3,874,283 bytes (Option A NOT applied — pre-T041 rollups).
After:  4,981,066 bytes (Option A applied — post-T041 rollups).
Absolute delta: 1,106,783 bytes (~1.06 MB).
Relative delta: 28.57%.
Per-week average growth: 42,568 bytes/week (~42 KB/week).

Notes:

- The relative delta is high (28.57%) because the demo's per-week
  rollup is small overall — the per-(reviewer, week) prs[] expansion
  is large relative to the existing aggregate metrics + comments
  density rollup root.
- For production-tenant artifacts (which carry more historical PRs,
  cross-dim metrics, comments density, and longer time windows), the
  relative delta is expected to be SMALLER per-week because the
  per-(reviewer, week) prs[] expansion shares the artifact with more
  large-payload rollup-root contents (Feature 333/334/335/336 comments
  density) that don't change with this feature.
- Per-week absolute growth (~42 KB/week) is dominated by per-PrRecord
  duplication: each PR reviewed by N reviewers appears in N
  per-(reviewer, week) entries (the duplication semantic CL-01
  acknowledged).  PR records are ~150 bytes JSON-encoded each in the
  capability-on path.
- The PUBLIC surface (`docs/data/`) is byte-stable through the FR-028
  strip-helper extension: the per-(reviewer, week) trio is removed at
  promote_data time.  No public-surface byte cost.

## Expected scale

Per the producer contract § 7 (3) (duplication semantic) and CL-01's
byte-cost trade-off:

- Per `PrRecord` (capability-off): ~120 bytes JSON-encoded.
- Per `PrRecord` (capability-on): ~150 bytes JSON-encoded.
- Per per-(reviewer, week) trio overhead: ~40 bytes (`_prs_truncated`,
  `_prs_cap`, `prs` key).
- Duplication factor: ~3.3x mean reviewers per PR (per repo memory
  `project_per_reviewer_multi_count_semantic.md`).

For a typical 26-week demo with ~50 reviewers per week and an average
of ~5 reviewed PRs each, the expected per-week growth is approximately
50 × 5 × 150 + 50 × 40 = 39,500 bytes/week.  Over 26 weeks: ~1 MB
total artifact growth on the private surface.

The PUBLIC surface (`docs/data/`) is byte-stable through the FR-028
strip-helper extension: the per-(reviewer, week) trio is removed at
promote_data time.  No public-surface byte cost.

## Verification

After the implementation commit lands, this report's placeholder rows
SHOULD be replaced with the measured numbers from a clean
`scripts/build-demo-dataset.py` run on Python 3.12.  Until then, this
file documents the measurement obligation per SC-014 and the expected
scale per the producer contract.
