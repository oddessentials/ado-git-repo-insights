# Data Model: Dashboard weekly discussion-volume trend chart

**Feature**: 333-comments-trend-chart
**Phase**: 1 (design)
**Created**: 2026-04-26

## §1 Existing entities (referenced, not modified)

### Pull Request (`pull_requests` table)
- Existing per Feature 058. Per-PR record with `pull_request_uid` primary key, plus the `comments_extracted_at: TIMESTAMP | NULL` column that this feature reads to determine the per-week extracted-subset. Frozen — no schema changes.

### Comment Thread (`pr_threads` table)
- Existing per Feature 058. Per-PR thread record with `status` ∈ {`active`, `fixed`, `wontFix`, `closed`, `byDesign`, `pending`, `unknown`} and `is_deleted` flag. Read by the comments aggregator under C1's inclusion rules (per `specs/310-comments-visualization/spec.md` lines 75–87). Frozen.

### Comment (`pr_comments` table)
- Existing per Feature 058. Per-thread comment record with `comment_type` (including `system`), `is_deleted`, `author_id`. Read by the comments aggregator under C1. Frozen.

### User (`users` table)
- Existing. Referenced by `pr_comments.author_id`. Frozen.

### Capability flag — `capabilities.comments_metrics`
- Existing per Feature 310. Boolean field on the manifest (consumer schema: `extension/ui/schemas/manifest.schema.ts` `Capabilities.comments_metrics`). Producer-side: emitted by `aggregators.py:_has_comments()` evaluation. **Both the new aggregator emission AND the new chart rendering MUST be gated on this flag** (INV-1-01).

### PrRecord (per-PR drill-down field set)
- Existing per Feature 310 + Feature 060. Lives at `extension/ui/schemas/rollup.schema.ts:96–98` (the three numeric fields `thread_count?: number | null`, `comment_count?: number | null`, `active_thread_count?: number | null` declared on the per-PR PrRecord interface). Locked by 310's schema-parity gate. **NOT modified by this feature.** The new weekly aggregate MUST live in a separate namespace (sub-object) to avoid name shadowing — see §2.

### Throughput Rollup (existing weekly emission)
- Existing per Feature 060 + earlier. Emitted per week to `docs/data/aggregates/weekly_rollups/YYYY-Www.json` by `aggregators.py:_generate_weekly_rollups()`. Already carries fields like `pr_count`, `cycle_time_p50`, `cycle_time_p90`, `by_repository`, `by_team`, `prs[]` (per-PR records), `_prs_truncated`, `_prs_cap`, etc. **This feature ADDS one new optional sibling field to the rollup root: the `comments` sub-object (§2).**

## §2 New entity — Weekly Comments Aggregate

**Path**: `rollup[W].comments` (sibling of `pr_count`, `cycle_time_p50`, etc. on the rollup root).

**Optionality**: present only when `capabilities.comments_metrics === true`. Absent entirely (key omitted) when capability-off (FR-3-03).

**Atomicity (INV-1-08)**: when present, ALL FOUR fields below are present together. No partial `comments` object — never `{}`, never partial-fielded.

**Field declarations** (the parity-gate-parseable shape contract is in `contracts/weekly-comments-aggregate.md`):

| Field | Type | Required when `comments` exists | Computation |
|---|---|---|---|
| `thread_count` | `number` (non-null) | yes | Sum over W's extracted-subset of per-PR `thread_count` (C1-applied per FR-2-02). Unextracted PRs contribute zero. |
| `comment_count` | `number` (non-null) | yes | Sum over W's extracted-subset of per-PR `comment_count` (C1-applied). Unextracted PRs contribute zero. |
| `active_thread_count` | `number` (non-null) | yes | Sum over W's extracted-subset of per-PR `active_thread_count` (C1-applied). Unextracted PRs contribute zero. |
| `coverage_partial` | `boolean` | yes | `true` iff at least one PR in W's canonical throughput PR set has `pull_requests.comments_extracted_at IS NULL`. No threshold — even one such PR triggers `true`. |

**Set definitions** (per FR-2-03):

- **W's canonical throughput PR set** = the set of `pull_request_uid` values the throughput aggregator attributes to week W (using throughput's week-attribution rule — see Decision 7 in research.md for the parity guard).
- **W's extracted-subset** = subset of W's canonical throughput PR set with `pull_requests.comments_extracted_at IS NOT NULL`.

**Validation rules**:

- INV-1-06: `active_thread_count <= thread_count` (a subset relationship — propagation of 310 INV-09).
- INV-1-07: when `coverage_partial === true`, the consumer-side renderer (FR-1-04) MUST visibly qualify the week. The data contract itself doesn't enforce rendering; it provides the signal.
- INV-1-08: schema-level atomicity — validator MUST treat partial `comments` objects as a violation. Either all four fields present or the entire object absent.

**Cross-feature relationship**:

- The per-PR `thread_count` / `comment_count` / `active_thread_count` fields on PrRecord (310 contract) and the rollup-root `comments.{thread_count, comment_count, active_thread_count}` fields (this feature) are RELATED via FR-2-01:
  - For every PR P in the drill-down's top-500-by-cycle-time slice for W AND in W's extracted-subset, the per-PR drill-down value for P equals P's per-PR contribution to the corresponding numeric field of `rollup[W].comments` as computed by the aggregator.
  - PRs in the drill-down's slice that are NOT in W's extracted-subset are NOT pairwise-compared (they reconcile via different sentinels: drill-down null + aggregator zero-contribution).

## §3 State transitions / lifecycle

**Aggregator emission lifecycle** (per rollup file generation):

1. `_generate_weekly_rollups()` enters per-week emission for week W.
2. `_has_comments()` evaluated → if `false`, emit rollup WITHOUT the `comments` key. STOP.
3. If `true`:
   a. Determine W's canonical throughput PR set (using throughput's week-attribution function — FR-2-03 (a) reuse OR (b) parity test).
   b. Filter to W's extracted-subset (PRs with `comments_extracted_at IS NOT NULL`).
   c. For each PR in the extracted-subset, query `pr_threads` + `pr_comments` and apply C1.
   d. Sum per-PR contributions → `thread_count`, `comment_count`, `active_thread_count`.
   e. Compute `coverage_partial = (|W's canonical set| != |W's extracted-subset|)`.
   f. Emit `comments: { thread_count, comment_count, active_thread_count, coverage_partial }` on the rollup root.

**Renderer consumption lifecycle** (per chart render):

1. `comments-trend.ts` reads `rollup[W].comments` for each week in the visible range.
2. If `comments` key absent → SKIP that week (capability flag must be off, or week pre-dates extraction). The capability-gate at the dashboard level (FR-3-01) ensures the chart container itself doesn't render when capability-off, so this branch is only for forward-compat.
3. If present:
   - Render bar with stack: lower segment = `thread_count - active_thread_count` (resolved); upper segment = `active_thread_count` (unresolved).
   - Render line value = `comment_count` overlaid via SVG path.
   - If `coverage_partial === true`: apply visual qualifier (FR-1-04 — hatched fill / dimmed color, plus legend item explaining).
   - If `coverage_partial === false`: render normally (no qualifier).
4. Bind click/keyboard activation on bar → open existing Feature 060 drill-down panel for W.

## §4 Demo dataset interaction

The demo dataset (managed at `docs/data/`, regenerated via `manage_generated_artifacts.py sync --scope all --stage`) has two variants:

- **Capability-on demo** (`comments_metrics: true`): every week's rollup emits the `comments` object with the four fields populated.
- **Capability-off demo** (`comments_metrics: false`): no week's rollup emits the `comments` key at all. Byte-identity test gates this (FR-3-03).

Per A-03, the demo MUST contain ≥ 8 weeks of comment-bearing data so first-glance readability of the chart is exercised in acceptance testing. Per the round-7 extracted-subset rule, the demo SHOULD include at least one week with mixed extraction (some PRs unextracted) so the partial-coverage visual qualifier and `coverage_partial = true` path are exercised. Optionally a fully-unextracted week to exercise FR-2-06 case (iii). These fixture choices are tasks-level.
