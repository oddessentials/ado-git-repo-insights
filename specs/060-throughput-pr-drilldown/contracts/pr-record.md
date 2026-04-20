# Contract: PR Record Rollup JSON Shape

**Scope**: producer (`aggregators.py`) + consumer (extension `rollup.schema.ts`, `dataset-loader.ts`). Governs the on-disk weekly-rollup JSON surface and the parity validator.

**Authoritative spec refs**: FR-001, FR-002, FR-003, FR-012, FR-013, FR-015, FR-025. Data-model: `data-model.md` §1 / §2.

## Producer contract (Python aggregator)

### Where it lives

`src/ado_git_repo_insights/transform/aggregators.py`, inside the existing `_generate_weekly_rollups` per-week groupby loop (line 648 onward as of base branch).

### Behavior

For every week `W` with at least one qualified PR, the aggregator MUST:

1. Compute the qualified PR set: `[pr for pr in W_prs if pr.cycle_time_minutes is not None]`.
2. Sort qualified set by `(-cycle_time_minutes, pull_request_id)` (cycle_time desc, id asc tiebreak).
3. Record `_prs_truncated = len(qualified) > _prs_cap` BEFORE truncating.
4. Truncate via `qualified[:_prs_cap]` where `_prs_cap = 500` (locked in FR-002).
5. Serialize each remaining PR to a `PrRecord` dict with exactly the five fields defined in data-model §1.
6. Attach three fields to the rollup dict: `prs`, `_prs_truncated`, `_prs_cap`.

If the qualified set is empty, the aggregator MUST NOT emit any of the three fields (absence = no PR-level detail available for that week, consumed cleanly by the permissive validator).

### Determinism invariants

- Sort comparator is a tuple; Python `list.sort` is stable; the output byte sequence MUST be byte-identical across two aggregator runs against the same database state.
- JSON serialization MUST use the existing `json.dump` convention in the aggregator (sorted keys are NOT required — but key ordering MUST be stable run-to-run, which the existing dict assembly pattern already guarantees).
- `cycle_time` MUST be serialized as a finite float. PRs with NaN/Inf `cycle_time_minutes` (if any ever occur) MUST be excluded from the qualified set the same way `NULL` is.

### Failure modes

- If a PR row has `cycle_time_minutes` present but any of `title`, `user_id`, `repository_id`, `pull_request_id` is missing: the aggregator MUST log a warning and EXCLUDE that PR from the `prs` array. The aggregate `pr_count` is unaffected (counts the PR for the aggregate slice but not for the PR array). This is consistent with existing aggregator resilience to partial rows.

## Consumer contract (extension TypeScript)

### Where it lives

- `extension/ui/schemas/rollup.schema.ts` — `PrRecord` interface + validator extension.
- `extension/ui/dataset-loader.ts` — `Rollup` interface extended with optional `prs`, `_prs_truncated`, `_prs_cap`.

### Validator semantics

The rollup schema validator remains PERMISSIVE. Validation contract for new fields:

- `prs` absent: valid (demo/public surface case; old-version tenant artifact case).
- `prs` present + empty array: valid but unusual; renders as "supported-empty" content state in UI.
- `prs` present + `_prs_truncated` absent + `_prs_cap` absent: validator logs a warning (partial emission detected) but does NOT fail the load. Missing marker fields are treated as `_prs_truncated = false`, `_prs_cap = null` at the UI site.
- `prs` present + any element missing any of the 5 required fields: validator logs a warning and UI treats the malformed element as absent (no partial render). Prevents silent corruption of derived URL paths.
- `_prs_truncated` present without `prs`: validator logs a warning and the flag is ignored at UI.
- `_prs_cap` present without `prs`: validator logs a warning and the field is ignored at UI.

Rationale: permissive validator matches Phase 1 convention for forward/backward-compat with optional fields. Hard failures would block demo-stripped artifacts from loading cleanly in the extension.

### Example emitted rollup (truncated)

```jsonc
{
  "week": "2025-W28",
  "start_date": "2025-07-07",
  "end_date": "2025-07-13",
  "pr_count": 151,
  "cycle_time_p50": 427.359,
  "cycle_time_p90": 3464.623,
  // ... other existing Phase 1 fields unchanged ...
  "prs": [
    { "id": 12345, "title": "feat: add oauth flow", "author_id": "abc-...", "repository_id": "def-...", "cycle_time": 4732.1 },
    { "id": 12340, "title": "fix: null guard in aggregator", "author_id": "abc-...", "repository_id": "ghi-...", "cycle_time": 2114.8 }
    // ... up to 500 total records ...
  ],
  "_prs_truncated": false,
  "_prs_cap": 500
}
```

### Example demo-surface rollup (stripped)

```jsonc
{
  "week": "2025-W28",
  "start_date": "2025-07-07",
  "end_date": "2025-07-13",
  "pr_count": 151,
  // ... identical to above EXCEPT the three new fields are absent ...
  // NO "prs", NO "_prs_truncated", NO "_prs_cap"
}
```

## Tests that assert this contract

- `tests/unit/test_aggregators_pr_records.py` — shape, order, truncation boundary, `_prs_truncated` computation, `_prs_cap` emission.
- `tests/integration/test_golden_outputs.py` (extended) — byte-identical rollup JSON across two runs including PR arrays.
- `tests/integration/test_pr_record_snapshot_cadence.py` — title-edit → re-aggregate → updated title in new rollup.
- `extension/tests/modules/drilldown/pr-list-count-parity.test.ts` — consumer parity (rendered count vs filtered pr_count under supported filters).
- Schema validator tests in `extension/tests/schemas/` (extending existing rollup schema test pattern).
