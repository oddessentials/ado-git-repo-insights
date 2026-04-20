# Data Model (Phase 1)

**Status**: authoritative data-model specification for feature 060. Complements the natural-language requirements in `spec.md` with formal shapes and invariants.

Nothing in this document introduces new behavioral decisions. Every shape is derived from the spec's locked FRs.

## Entities

### 1. `PrRecord`

A single pull request attributed to a weekly rollup. Exactly five fields — no more, no less (FR-001, locked scope).

**Shape (Python `TypedDict` in `src/ado_git_repo_insights/types.py`)**:

```python
class PrRecord(TypedDict):
    id: int             # Source: pull_requests.pull_request_id (existing column)
    title: str          # Source: pull_requests.title (existing column)
    author_id: str      # Source: pull_requests.user_id (existing column, UUID string)
    repository_id: str  # Source: pull_requests.repository_id (existing column, UUID string)
    cycle_time: float   # Source: pull_requests.cycle_time_minutes (existing column)
```

**Shape (TypeScript `interface` in `extension/ui/schemas/rollup.schema.ts`)**:

```typescript
export interface PrRecord {
  readonly id: number;
  readonly title: string;
  readonly author_id: string;
  readonly repository_id: string;
  readonly cycle_time: number;
}
```

**Invariants**:
- All five fields are REQUIRED. No PR record may be emitted with any field missing.
- `cycle_time` is in minutes (float). PRs with `NULL` `cycle_time_minutes` in the DB are excluded from the list entirely (cannot be ordered; not part of the closed-PR population).
- `title` is emitted verbatim — no truncation, no escaping, no mutation. XSS prevention happens at render time via the existing `escapeHtml` / `createElement` pattern (Phase 1 `render.ts`).
- `id`, `author_id`, `repository_id` are stable identifiers. Identity (QG-13) uses them unchanged.

### 2. Weekly Rollup (extended)

Extends the existing `WeeklyRollup` dataclass (`aggregators.py:85`). Three new optional fields at the rollup level. All Phase 1 fields remain unchanged (FR-015 / FR-019).

**New fields**:

```python
# Appended to the serialized rollup dict (after existing fields)
prs: list[PrRecord]     # Optional. Present iff the week has ≥1 contributing PR with non-null cycle_time.
_prs_truncated: bool    # Optional. TRUE iff the week's unfiltered PR population at aggregation time exceeded _prs_cap.
_prs_cap: int           # Optional. The numeric cap the aggregator applied; always emitted when `prs` is present.
```

**TypeScript mirror (in `Rollup` interface at `dataset-loader.ts:113`)**:

```typescript
export interface Rollup {
  // ... all existing fields unchanged ...
  readonly prs?: readonly PrRecord[];
  readonly _prs_truncated?: boolean;
  readonly _prs_cap?: number;
}
```

**Invariants**:
- `prs` is OPTIONAL at the schema level (permissive validator allows absence — critical for demo-stripped artifacts).
- When `prs` is present, it contains 0 to `_prs_cap` records, ordered by `(-cycle_time, id)` lexicographically (cycle_time desc, id asc tiebreak).
- `_prs_cap = 500` in this release (FR-002). Future cap changes are self-describing in the artifact (FR-003).
- `_prs_truncated = True` iff the unfiltered week PR population with non-null cycle_time exceeded `_prs_cap`.
- No rollup may contain `_prs_truncated` or `_prs_cap` without also containing `prs` — the three fields form an atomic set when present.
- **Demo / public-surface artifacts contain NONE of the three fields** (FR-013 / FR-023).

### 3. Filter State Classification

Classification enum returned by the single authoritative predicate (FR-024 / FR-026).

**Shape (TypeScript union)**:

```typescript
export type FilterClassification =
  | { readonly classification: "comparison" }
  | { readonly classification: "team" }
  | { readonly classification: "reviewer" }
  | { readonly classification: "supported" };
```

**Precedence (FR-026 — fixed)**:
1. If comparison mode active → `"comparison"` (regardless of other filters).
2. Else if team filter active → `"team"` (regardless of reviewer filter).
3. Else if reviewer filter active → `"reviewer"`.
4. Else → `"supported"`.

**Invariants**:
- Total classifier: every possible filter state maps to exactly one classification.
- No other classification value is valid (sealed union).
- Call-site reconstruction of precedence from boolean helpers is FORBIDDEN.

### 4. Derived display-state values

Computed at the UI render site; never persisted or independently recomputed.

```typescript
// Computed inside the throughput drilldown rendering path.
const rendered_count: number = filtered_prs.length;
const actual_filtered_count: number = filtered_rollup.pr_count;
const show_truncation_indicator: boolean = rendered_count < actual_filtered_count;
```

**Invariants**:
- `rendered_count` is derived from the output of `applyFiltersToRollups` (same invocation as `filtered_rollup.pr_count`).
- `actual_filtered_count` is read from the filtered rollup returned by that same call — not recomputed.
- `show_truncation_indicator` is the ONLY driver of truncation-indicator visibility (FR-017). `_prs_truncated` alone does NOT drive visibility.

### 5. PR-detail Container (UI structural entity)

The stable DOM container defined by FR-020. Not a runtime data object — a structural invariant over the rendered DOM.

**Shape**:
- Always a single `<section>` element with stable attributes (`id="pr-detail"`, `class="detail-panel-section detail-panel-section--pr-detail"`, ARIA identity carried forward across all four states).
- Position: always appended after the existing Phase 1 aggregate-breakdown sections within `PanelContent.sections`.
- Content: swapped via the `contentState` discriminant on the new `PrListSection` variant.

**Discriminant values**:

| `contentState` | Rendered under | Content |
|---|---|---|
| `"pr-list"` | `supported` classification + non-empty filtered array | Ordered list of PR rows + truncation indicator (when `show_truncation_indicator = true`) |
| `"supported-empty"` | `supported` classification + empty filtered array | "No PRs match the active filter in this week." |
| `"team-inline"` | `team` classification | "Clear the team filter to view PR-level detail." |
| `"reviewer-inline"` | `reviewer` classification | "Clear the reviewer filter to view PR-level detail." |

Note: `comparison` classification does NOT reach this container; the panel does not open in that case (FR-007a preserves Phase 1 toast-denial).

## State transitions

### Aggregation-time transitions (Python side)

```text
Raw DB week data
  ↓  (pandas groupby at aggregators.py:648)
Per-week group
  ↓  Exclude PRs with NULL cycle_time_minutes
Qualified PR set
  ↓  Sort by (-cycle_time, id)
Ordered PR set
  ↓  Truncate to _prs_cap (if exceeds)
Top-cap PR set
  ↓  Serialize to PrRecord dicts
prs array
  ↓  Assemble into rollup dict at line 697
Rollup with `prs` + `_prs_truncated` + `_prs_cap`
  ↓  Write to aggregate output
Weekly rollup JSON
```

### Publish-boundary transitions

```text
Rollup with `prs` + `_prs_truncated` + `_prs_cap`
  ↓  Invoke strip_pr_arrays helper (FR-023)
Strip step: remove prs, _prs_truncated, _prs_cap
  ↓  Re-verify (strip-and-re-verify semantics)
Fail-on-residue check
  ↓  (if any residue → fail the build)
Clean rollup (Phase 1 shape exactly)
  ↓  atomic_replace_docs_data
docs/data/aggregates/weekly_rollups/YYYY-Www.json
```

### Runtime transitions (Extension UI)

```text
User clicks throughput bar
  ↓  throughput-drilldown.ts:activate()
Check: isDrilldownDisabledByComparison()?
  ↓  TRUE → showComparisonAdvisoryToast(); return
  ↓  FALSE → proceed
Invoke classifyFilterState(currentFilters, comparisonActive = false)
  ↓  returns FilterClassification
buildPanelContent(rollup, classification)
  ↓  Always includes PrListSection variant with matching contentState
openDetailPanel(context)
  ↓  Panel renders; stable container present regardless of state
```

## Relationships

```text
pull_requests (existing DB table)
  ──→ WeeklyRollup (aggregator output, extended with prs array)
         ──→ Rollup (TypeScript, loaded by dataset-loader.ts)
                ──→ applyFiltersToRollups (returns filtered rollup with filtered prs in same invocation)
                       ──→ buildPanelContent (consumes filtered rollup)
                              ──→ PrListSection (content-state selection via classifyFilterState)
                                     ──→ Stable <section id="pr-detail"> with one of 4 content states

RepositoryRecord (existing dimensions artifact)
  ──→ repo_id → repo_name lookup
         ──→ resolvePrUrl(pr, repositoriesDimension, webContext)
                ──→ Per-PR navigation URL (derived, never persisted)
```

## Validation rules

### Python (aggregator side)

- `_generate_weekly_rollups` MUST exclude PRs with `NULL cycle_time_minutes` from the PR array but NOT from the `pr_count` aggregate (pr_count continues to follow the existing Phase 1 definition).
- Sort comparator MUST be tuple-based `(-cycle_time, id)` to ensure stability and byte-identical output across runs.
- Truncation MUST be applied via `[:_prs_cap]` slice on the sorted list, not via conditional sort-then-decide.
- `_prs_truncated` MUST be computed BEFORE truncation (from the unfiltered qualified set size) so the flag reflects the aggregator's truncation action, not post-hoc list length.

### TypeScript (extension side)

- `applyFiltersToRollups` MUST filter `prs` array in the same map-callback that rebuilds the rollup's aggregate fields — one pass, one pair of predicates (`author_id === filter.authors[0]` AND/OR `repository_id === filter.repos[0]`).
- When an unsupported filter is active (team / reviewer), the filtered rollup returned by `applyFiltersToRollups` MUST either preserve the original `prs` array unchanged OR strip it — implementation choice, but MUST NOT apply a team/reviewer predicate that the function's filter-path doesn't support.
- The render path MUST NOT consult the filter state directly — it MUST receive the classification from `classifyFilterState` and only branch on that.

### Demo / publish side

- `strip_pr_arrays` MUST remove all three fields (`prs`, `_prs_truncated`, `_prs_cap`) from every weekly-rollup JSON under the output directory.
- After strip, a re-scan MUST confirm zero residue across the entire output tree.
- A fail-on-residue assertion MUST block the build if ANY rollup retains any of the three fields after the strip pass.

### Privacy

- The privacy-posture section in `docs/reference/dataset-contract.md` MUST explicitly declare:
  1. `prs` / `_prs_truncated` / `_prs_cap` are tenant-sensitive.
  2. Private tenant artifacts consumed inside ADO MAY contain them.
  3. Promoted demo / public artifacts MUST NOT contain them.
  4. The policy extends by default to future tenant-sensitive fields.

## Cross-reference

| Entity | FRs | SCs |
|---|---|---|
| `PrRecord` | FR-001 | — |
| Weekly Rollup (extended) | FR-001, FR-002, FR-003, FR-012 | SC-005, SC-014 |
| Filter State Classification | FR-024, FR-026, FR-018 | SC-015 |
| Derived display-state values | FR-008, FR-017, FR-021 | SC-002, SC-003, SC-007 |
| PR-detail Container | FR-020, FR-011 | SC-010 |
| `strip_pr_arrays` / demo contract | FR-013, FR-023, FR-014 | SC-004, SC-013 |
| `resolvePrUrl` / repo mapping | FR-005, FR-005a | SC-009 |
| Snapshot semantics | FR-022 | SC-012 |
