# Contract: PrRecord comments fields (Feature 310 sibling extending Feature 060)

**Scope**: producer (`src/ado_git_repo_insights/transform/aggregators.py`) + consumer (`extension/ui/schemas/rollup.schema.ts`, `extension/ui/modules/shared/detail-panel.ts`, `extension/ui/modules/drilldown/throughput-drilldown.ts`, `extension/ui/dashboard.ts`).

**Parent contract**: [`specs/060-throughput-pr-drilldown/contracts/pr-record.md`](../../060-throughput-pr-drilldown/contracts/pr-record.md) — the Feature 060 PrRecord shape (5 fields).

**Relationship**: this contract is a 310-owned sibling of the 060 contract. It EXTENDS the 060 contract with three new optional fields governed by `capabilities.comments_metrics`. The 060 contract remains the authority for the original 5 fields; this file is the authority for the 3 new fields and the atomicity rules between them. The 060 contract file gets a short pointer to this sibling (no inline re-declaration).

**Inclusion rules**: the five C1 rules that govern `thread_count`, `comment_count`, and `active_thread_count` are defined ONCE in [spec.md § "Shared inclusion-rule contract (C1)"](../spec.md). This contract file REFERENCES that subsection; it does NOT re-declare the rules (DIRECTIVE 7).

**Authoritative spec refs**: [spec.md](../spec.md) — FR-3-01 through FR-3-06, FR-4-01 through FR-4-05, INV-01, INV-02, INV-07, INV-08, INV-09, INV-10. Data model: [`data-model.md`](../data-model.md) §1 / §3 / §5.

---

## §1 Canonical field declaration (parity-gate-parseable)

This is the **authoritative schema declaration** for the extended PrRecord. The parity gate (`scripts/check_pr_record_schema_parity.py`; see [`schema-parity-gate.md`](./schema-parity-gate.md)) parses this table and asserts field-name + type parity against the Python TypedDict and the TypeScript interface. Drift fails the gate.

| Field | Python type | TypeScript type | Emitted when `comments_metrics=true` |
|---|---|---|---|
| `id` | `int` | `number` | yes (always) |
| `title` | `str` | `string` | yes (always) |
| `author_id` | `str` | `string` | yes (always) |
| `repository_id` | `str` | `string` | yes (always) |
| `cycle_time` | `float` | `number` | yes (always) |
| `thread_count` | `NotRequired[int \| None]` | `?: number \| null` | yes (absent when capability off) |
| `comment_count` | `NotRequired[int \| None]` | `?: number \| null` | yes (absent when capability off) |
| `active_thread_count` | `NotRequired[int \| None]` | `?: number \| null` | yes (absent when capability off) |

**Reading rules for the parity gate**:

- Each row's `Field` cell is a bareword identifier (backticked for rendering; the parser strips backticks before comparison).
- Each row's `Python type` and `TypeScript type` cells declare the types in a compatibility table defined by [`schema-parity-gate.md`](./schema-parity-gate.md) (e.g., `int ↔ number`, `NotRequired[int | None] ↔ ?: number | null`). The Python `NotRequired[X]` wrapper encodes optional presence (Python 3.11+ `typing.NotRequired`; baseline is 3.12); the inner `X` governs the value type when present. It matches TS `?: X` (optional field) — both allow the field to be absent entirely, which is the capability-off serialization path.
- `Emitted when comments_metrics=true` column is **informational narrative only** — it documents the producer's runtime emission obligation (INV-08 atomicity: all three fields emitted together when capability is on). **It is NOT machine-parsed by the parity gate** and **does NOT drive `PR_RECORD_REQUIRED_FIELDS` extension**. The TypeScript `PR_RECORD_REQUIRED_FIELDS` constant stays at 5 entries, corresponding to the Python fields **without** `NotRequired` — see the separate `PR_RECORD_REQUIRED_FIELDS` section below. The parity gate enforces this separately by comparing the Python non-`NotRequired` fields against `PR_RECORD_REQUIRED_FIELDS` (5 = 5).

**INV-01 / INV-08 encoding**: When `capabilities.comments_metrics=false`, the last three fields (`thread_count`, `comment_count`, `active_thread_count`) are **absent entirely** from the serialized record (omitted keys, not `null`). Absence is legal under `NotRequired[int | None]` in Python and `?: number | null` in TS — no type violation. When `true`, all three MUST be emitted and follow the "all numeric together or all `null` together" atomicity rule at runtime (INV-10).

**INV-09 encoding**: `active_thread_count <= thread_count` when both are numeric — a subset relationship, not a schema shape. Enforced by property tests, not by the schema declaration itself.

---

## Producer contract (Python aggregator)

### Where it lives

`src/ado_git_repo_insights/transform/aggregators.py`, inside the existing `_generate_weekly_rollups` per-week PrRecord serialization loop (line 797 onward in the current base).

### Behavior

For every week `W` where the qualified+sorted+capped slice is non-empty (Feature 060 step 4 complete, `qualified` truncated to `_PR_DETAIL_CAP = 500`):

1. Read `capabilities.comments_metrics` via the existing `_has_comments()` method at `aggregators.py:1485` (already equal to `self._has_comments()`).
2. **If `_has_comments()` returns `False`**: serialize each PR into the existing 5-field PrRecord. Do NOT emit any of the three new fields. Stop — rest of this contract does not apply.
3. **If `_has_comments()` returns `True`**: collect `pull_request_uid` values from the capped slice into a set `slice_uids`.
4. Issue one SQL query scoped to `slice_uids` (top-500 only, per R-05 / user constraint):
   ```sql
   SELECT
     pr.pull_request_uid,
     pr.comments_extracted_at,
     COALESCE(t.thread_count, 0) AS thread_count,
     COALESCE(t.active_thread_count, 0) AS active_thread_count,
     COALESCE(c.comment_count, 0) AS comment_count
   FROM pull_requests pr
   LEFT JOIN (
     SELECT
       pull_request_uid,
       COUNT(*) AS thread_count,
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_thread_count
     FROM pr_threads
     WHERE is_deleted = 0
     GROUP BY pull_request_uid
   ) t ON t.pull_request_uid = pr.pull_request_uid
   LEFT JOIN (
     SELECT
       pull_request_uid,
       COUNT(*) AS comment_count
     FROM pr_comments
     WHERE is_deleted = 0
     GROUP BY pull_request_uid
   ) c ON c.pull_request_uid = pr.pull_request_uid
   WHERE pr.pull_request_uid IN (:slice_uids);
   ```
   The inner subqueries apply the C1 inclusion rules (see [spec.md § Shared inclusion-rule contract (C1)](../spec.md) for the full authoritative rule set; the SQL above is the machine form — it excludes `is_deleted = 1` rows for both `pr_threads` and `pr_comments`, counts `status = 'unknown'` rows in `thread_count` but excludes them from `active_thread_count` by the `status = 'active'` predicate, counts `comment_type = 'system'` rows in `comment_count` naturally since there is no `comment_type` filter, and counts rows with author missing from `users` naturally since there is no JOIN to `users`).
5. Build a lookup `by_uid: dict[int, tuple[int | None, int | None, int | None]]`:
   - If `comments_extracted_at IS NULL` for the PR: `by_uid[uid] = (None, None, None)` (partial sentinel).
   - Else: `by_uid[uid] = (thread_count, comment_count, active_thread_count)` (non-negative ints).
6. In the PrRecord serialization loop (`aggregators.py:797-834`), after the existing `prs.append({...5 fields...})` construction, attach the three new fields:
   ```python
   counts = by_uid.get(uid, (None, None, None))
   prs[-1]["thread_count"] = counts[0]
   prs[-1]["comment_count"] = counts[1]
   prs[-1]["active_thread_count"] = counts[2]
   ```
   Alternative implementation detail: include the three fields in the initial `prs.append({...})` call in the fixed key order (id → title → author_id → repository_id → cycle_time → thread_count → comment_count → active_thread_count). Either shape is acceptable; the determinism contract only requires the final dict preserve insertion order matching §1 data-model.md.

### Determinism invariants

- Stable sort + stable truncate (existing, Feature 060).
- Deterministic key order in the emitted dict (§1 data-model.md).
- The inner SQL joins use `GROUP BY` with a single numeric result per `pull_request_uid`; no ordering concerns.
- `CASE WHEN status = 'active' THEN 1 ELSE 0 END` aggregates in `active_thread_count` — SUM is deterministic.
- Lookup-map key lookup is idempotent.

### Failure modes

- If `pr_threads` or `pr_comments` tables do not exist on a legacy DB: `_has_comments()` returns `False` (existing catch at aggregators.py:1491) and no new fields are emitted. Capability flag reads `False` in the manifest. Renderer shows no columns. SC-03 byte-identical baseline holds.
- If a PR's `comments_extracted_at` value is non-NULL but inner JOIN subqueries return zero rows for that `pull_request_uid`: emit `(0, 0, 0)` (true zeros per Acceptance Scenario 2.2). The partial sentinel is reserved for `comments_extracted_at IS NULL`.
- If a PR appears in `slice_uids` but has no row in `pull_requests`: IMPOSSIBLE under the existing extractor invariant (qualified PR set originates from `pull_requests` itself). Defensive programming not required.

### Cross-capability atomicity (INV-08)

- Emit all three fields or none. No mixed emission per record.
- The aggregator implementation achieves this by a single serialization site: either all three `prs[-1][...] = ...` lines run (capability on) or none do (capability off).

### Coverage-partial consistency (INV-10)

- Emit all three as `null` (partial) or all three as numeric (covered). No mixed null / numeric within a record.
- The aggregator implementation achieves this by sourcing the triplet from one `by_uid[uid]` tuple (single-source-of-truth for partial state).

---

## Consumer contract (extension TypeScript)

### Where it lives

- `extension/ui/schemas/rollup.schema.ts` — `PrRecord` interface + `PR_RECORD_REQUIRED_FIELDS` + validator behavior.
- `extension/ui/modules/shared/detail-panel.ts` — `PrListRow` interface + `PrListSectionWithRows` + `PrListSectionInput` + `renderPrListSection`.
- `extension/ui/modules/drilldown/throughput-drilldown.ts` — `ThroughputDrilldownOptions` + `buildPrListSection` + `installThroughputDrilldown`.
- `extension/ui/dashboard.ts` — call site that wires `capabilityState.commentsMetricsAvailable` into `installThroughputDrilldown`.

### `PrRecord` interface extension (`rollup.schema.ts`)

Extended to 8 fields:

```ts
export interface PrRecord {
  id: number;
  title: string;
  author_id: string;
  repository_id: string;
  cycle_time: number;
  thread_count?: number | null;          // Feature 310 — null = coverage partial
  comment_count?: number | null;         // Feature 310 — null = coverage partial
  active_thread_count?: number | null;   // Feature 310 — null = coverage partial
}
```

The three new fields are `?:` (optional) so the 5-field and 8-field shapes both satisfy the type. Runtime atomicity is asserted by tests (INV-08 / INV-10), not by the type system.

### `PR_RECORD_REQUIRED_FIELDS`

Stays at 5 entries. The three new fields are NOT added to the required set because:

- When `capabilities.comments_metrics=false`, they are legitimately absent.
- When `capabilities.comments_metrics=true`, they are required but the rollup validator does not have access to the capability flag at validation time.
- Required-ness is enforced at the capability-aware consumer site (throughput-drilldown.ts buildPrListSection) and at the producer test site (test_aggregators_pr_records_comments.py), not at the JSON-level validator.

### Validator behavior (`validatePrRecordArray`)

Extended with three optional-field type checks (permissive warnings, never errors, consistent with existing pattern):

```ts
// In the existing validatePrRecordArray loop, after the existing cycle_time check:
if (pr.thread_count !== undefined && pr.thread_count !== null && !isNumber(pr.thread_count)) {
  warnings.push(createWarning(buildPath(prPath, "thread_count"),
    `expected number or null, got ${getTypeName(pr.thread_count)}`));
}
// ...same for comment_count, active_thread_count
```

Permissive rationale matches the existing contract at `specs/060-throughput-pr-drilldown/contracts/pr-record.md` line 45-52.

Field atomicity at the validator level (warn if one or two of the three are present but not all three) is covered in `extension/tests/schemas/pr-record-comments-fields.test.ts` but does NOT fail the load (permissive).

### `PrListRow` interface extension (`detail-panel.ts`)

Extended to carry the three optional fields:

```ts
export interface PrListRow {
  readonly id: number;
  readonly title: string;
  readonly cycleTimeMinutes: number;
  readonly url: string;
  // Feature 310 — comments metrics. All three enter and exit together per
  // INV-08; per-PR coverage-partial encoded as null. Absent entirely when
  // capabilities.comments_metrics is false (PrListSectionWithRows carries
  // the capability flag at section level; rows carry the per-PR data).
  readonly threadCount?: number | null;
  readonly commentCount?: number | null;
  readonly activeThreadCount?: number | null;
}
```

### `PrListSectionWithRows` extension (`detail-panel.ts`)

Gains a new required discriminator field at the section level:

```ts
export interface PrListSectionWithRows {
  readonly type: "pr-list";
  readonly contentState: "pr-list";
  readonly rows: readonly PrListRow[];
  readonly renderedCount: number;
  readonly actualFilteredCount: number;
  readonly capValue: number;
  readonly commentsMetricsAvailable: boolean;  // Feature 310 — gates column rendering
}
```

### `PrListSectionInput` extension (`detail-panel.ts`)

The `"pr-list"` variant of the input union gains `commentsMetricsAvailable: boolean` as a required field. The three message variants (`supported-empty`, `team-inline`, `reviewer-inline`) do NOT carry the flag — they never render rows.

### `renderPrListSection` behavior

When `section.contentState === "pr-list"`:

- If `section.commentsMetricsAvailable === false`: render the existing 4-column-equivalent `<li>` shape byte-identically to pre-310. Do NOT emit additional `<span>` nodes for threadCount / commentCount / activeThreadCount. SC-03 byte-identical baseline locked by `pr-list-capability-off-baseline.test.ts`.
- If `section.commentsMetricsAvailable === true`: append three additional `<span>` nodes per `<li>`, each carrying one of the three values (or a "coverage partial" presentation when the value is `null`). Exact HTML shape is an implementation detail; the baseline test is capability-off only (user constraint).

Column headers (if the existing DOM has any): add three header nodes when `commentsMetricsAvailable === true`, matching the row additions.

Sort + filter UI (FR-3-02, FR-3-03, FR-4-02): an implementation-detail surface. Must preserve the existing panel's sort/filter semantics on the non-comments columns.

### `ThroughputDrilldownOptions` extension (`throughput-drilldown.ts`)

```ts
export interface ThroughputDrilldownOptions {
  readonly filters?: FilterState;
  readonly repositoriesDimension?: readonly PrUrlRepositoryEntry[] | null | undefined;
  readonly webContext?: PrUrlWebContext;
  readonly authorsDimension?: readonly AuthorEntry[] | null | undefined;
  readonly commentsMetricsAvailable?: boolean;  // Feature 310 — default false when absent
}
```

`buildPrListSection` reads `options.commentsMetricsAvailable ?? false` and:

- Maps each `PrRecord` to a `PrListRow` including `threadCount: pr.thread_count ?? null`, `commentCount: pr.comment_count ?? null`, `activeThreadCount: pr.active_thread_count ?? null` when the flag is true; omits those fields on the row when the flag is false.
- Passes `commentsMetricsAvailable` into `makePrListSection({...})`.

### `dashboard.ts` wiring

At the install site (dashboard.ts:1085-1102), add:

```ts
commentsMetricsAvailable: capabilityState?.commentsMetricsAvailable ?? false,
```

`capabilityState` is already computed at dashboard.ts:2329 for the banner; pass it through or derive separately. The single-source-of-truth is `DatasetCapabilityState.commentsMetricsAvailable` at types.ts:385 (normalized at dataset-loader.ts:590-591).

### Spread guard (user constraint)

`extension/tests/modules/drilldown/pr-list-comments-spread-guard.test.ts` scans every file in `extension/ui/modules/drilldown/*.ts` and fails when:

- Any drilldown file outside `throughput-drilldown.ts` references `threadCount`, `commentCount`, `activeThreadCount`, `thread_count`, `comment_count`, or `active_thread_count`.
- Any drilldown file outside `throughput-drilldown.ts` constructs a `PrListSectionWithRows` or calls `makePrListSection({contentState: "pr-list", ...})`.

Catches accidental spread without capability gating (user constraint).

---

## Validator semantics summary

| Scenario | Validator behavior |
|---|---|
| `prs[]` present; each record carries all 5 original fields + three new numeric fields | valid |
| `prs[]` present; each record carries all 5 original + three new `null` fields | valid (partial-state, §3 data-model.md) |
| `prs[]` present; records carry ONLY the 5 original fields | valid (capability-off case) |
| `prs[]` present; a record carries 5 original + `thread_count` only (omitting two) | warning (INV-08 atomicity), element NOT rejected (permissive) |
| `prs[]` present; a record carries mixed numeric + `null` among the three new fields | warning (INV-10 consistency), element NOT rejected (permissive) |
| `prs[]` present; a record has `active_thread_count > thread_count` | warning (INV-09), element NOT rejected (permissive) |

Permissive rationale: consumers (renderer) enforce the invariants visually by treating malformed records as best-effort or absent; hard validator failures would block demo-stripped artifacts. Invariant enforcement at the TEST level is strict (failing production builds), at the VALIDATOR level is warn-only (survives malformed inputs).

---

## Example emitted PR record (8 fields)

```jsonc
{
  "id": 12345,
  "title": "feat: add oauth flow",
  "author_id": "abc-123-...",
  "repository_id": "def-456-...",
  "cycle_time": 4732.1,
  "thread_count": 7,
  "comment_count": 23,
  "active_thread_count": 2
}
```

## Example emitted PR record (partial coverage)

```jsonc
{
  "id": 12340,
  "title": "fix: null guard in aggregator",
  "author_id": "abc-123-...",
  "repository_id": "ghi-789-...",
  "cycle_time": 2114.8,
  "thread_count": null,
  "comment_count": null,
  "active_thread_count": null
}
```

## Example emitted PR record (capability off)

Identical to Feature 060's 5-field shape; no mention of the three new fields at all.

```jsonc
{
  "id": 12345,
  "title": "feat: add oauth flow",
  "author_id": "abc-123-...",
  "repository_id": "def-456-...",
  "cycle_time": 4732.1
}
```

---

## Tests that assert this contract

**Producer side**:

- `tests/unit/test_aggregators_pr_records_comments.py` — INV-01 (capability-off = no fields), INV-02 (join scoped to capped slice), INV-07 (C1 inclusion rules applied), INV-08 (field atomicity), INV-09 (active bounded by total; property test), INV-10 (partial-state triplet consistency).
- `tests/integration/test_golden_outputs.py` (extended with comments-data fixture) — byte-stable rollup JSON with the three new fields.
- `tests/integration/test_demo_variants_byte_identity.py` (new) — demo-variant byte-identity invariant. Asserts `artifacts/demo-enterprise/` (capability-on) and `artifacts/demo-enterprise-comments-off/` (capability-off) are byte-identical EXCEPT for the five gated keys (`manifest.capabilities.comments_metrics`, `manifest.features.comments`, `manifest.coverage.comments`, `prs[*].thread_count`, `prs[*].comment_count`, `prs[*].active_thread_count`). Test shape is ordered: (1) sorted key-set equality excluding the gated set across every JSON file in both trees; (2) canonicalized byte equality after the gated keys are removed from both; (3) explicit array-order parity on `prs[]` (and any other ordering-sensitive arrays) — fails if any non-gated array element differs in position or content. See R-08 in `research.md` for the serialization-layer gating rationale.

**Consumer side**:

- `extension/tests/schemas/pr-record-comments-fields.test.ts` — validator parity, permissive warnings on INV-08 / INV-09 / INV-10 violations.
- `extension/tests/modules/drilldown/pr-list-comments-columns.test.ts` — capability-on render, sort + filter on the new columns, INV-09 visible ordering.
- `extension/tests/modules/drilldown/pr-list-capability-off-baseline.test.ts` — byte-identical DOM vs `fixtures/throughput-drilldown-capability-off-baseline.html` (SC-03).
- `extension/tests/modules/drilldown/pr-list-comments-spread-guard.test.ts` — no other drilldown consumes the new fields.
- `extension/tests/modules/drilldown/pr-list-count-parity.test.ts` (extended) — rendered count vs `actualFilteredCount` unaffected by the new columns.

**Cross-schema parity**:

- `tests/unit/test_pr_record_schema_parity.py` (pytest wrapper around `scripts/check_pr_record_schema_parity.py`; see [`schema-parity-gate.md`](./schema-parity-gate.md)).

---

## What this contract does NOT govern

- SC-05 cross-feature reconciliation (thread_count parity with #322's aggregator trend-series bucket). Deferred to #322 per DIRECTIVE 6 / R-07.
- Team-dimension surfaces. Forbidden by INV-03 / #321.
- Extractor behavior. Frozen by INV-06.
- AI-summarization of review content. Out of scope per spec's Out of Scope.
- Weekly aggregate (`thread_count` / `comment_count` / `active_thread_count` at the rollup root level). Deferred to #322.
