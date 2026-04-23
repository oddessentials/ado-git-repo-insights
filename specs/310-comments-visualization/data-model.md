# Data Model: Comment visualization — Drill-down extension (Feature 310)

**Phase**: 1 (Design & Contracts)
**Scope**: extends the Feature 060 PrRecord data shape across producer (Python) and consumer (TypeScript) with three new per-PR numeric fields, plus the invariant mappings onto test anchors.

This document is paired with [`contracts/pr-record-comments-fields.md`](./contracts/pr-record-comments-fields.md) (the 310-owned sibling extending `specs/060-throughput-pr-drilldown/contracts/pr-record.md`) and [`contracts/schema-parity-gate.md`](./contracts/schema-parity-gate.md) (DIRECTIVE 2 enforcement).

The inclusion rules referenced throughout are defined ONCE in [spec.md §Requirements → "Shared inclusion-rule contract (C1)"](./spec.md). This document and the contract files reference that subsection; they do NOT re-declare C1 rules (DIRECTIVE 7).

---

## §1 — Extended PrRecord

The Feature 060 PrRecord contract (5 fields) is extended by 3 fields for a total of 8 fields when `capabilities.comments_metrics=true`. When `false`, only the original 5 fields are emitted (INV-01 / INV-08 / FR-3-06).

| Field | Type (Python) | Type (TypeScript) | Emitted when `comments_metrics=true` | Partial sentinel | Notes |
|---|---|---|---|---|---|
| `id` | `int` | `number` | yes (existing; always emitted) | n/a | Feature 060 — PR identifier. |
| `title` | `str` | `string` | yes (existing; always emitted) | n/a | Feature 060. |
| `author_id` | `str` | `string` | yes (existing; always emitted) | n/a | Feature 060. |
| `repository_id` | `str` | `string` | yes (existing; always emitted) | n/a | Feature 060. |
| `cycle_time` | `float` | `number` | yes (existing; always emitted) | n/a | Feature 060, minutes. |
| **`thread_count`** | **`NotRequired[int \| None]`** | **`?: number \| null`** | **yes (new — 310; absent when capability off)** | **`null`** | Count of threads on this PR after applying C1 inclusion rules. |
| **`comment_count`** | **`NotRequired[int \| None]`** | **`?: number \| null`** | **yes (new — 310; absent when capability off)** | **`null`** | Count of comments on this PR after applying C1 inclusion rules. |
| **`active_thread_count`** | **`NotRequired[int \| None]`** | **`?: number \| null`** | **yes (new — 310; absent when capability off)** | **`null`** | Subset of `thread_count` — threads where `pr_threads.status = 'active'`. |

**Python typing semantics**: the three new fields use `typing.NotRequired[int | None]` (Python 3.11+; baseline is 3.12 per [`plan.md`](./plan.md) Technical Context). `NotRequired[X]` encodes **optional presence** — the field may be absent entirely from the `TypedDict` instance. The inner `int | None` encodes the value type when present. This matches TypeScript's `?: number | null` (optional field + nullable value) exactly. The capability-off serialization path omits all three fields entirely; both Python and TypeScript accept this shape without type violation. The `Emitted when comments_metrics=true` column documents the producer's runtime emission obligation and is NOT parsed by the parity gate — presence-requirement is derived solely from the type annotations and the `PR_RECORD_REQUIRED_FIELDS` array (see [`contracts/schema-parity-gate.md`](./contracts/schema-parity-gate.md)).

**Atomicity rules** (INV-08):

- When `capabilities.comments_metrics=true`, a serialized PR record MUST carry all three fields. A record carrying `thread_count` + `comment_count` but omitting `active_thread_count` is a producer contract violation.
- When `capabilities.comments_metrics=false`, a serialized PR record MUST omit all three fields. Emitting any one without the other two is a producer contract violation.
- Within the `true` case, for any single PR, all three fields MUST be of the same kind — all numeric, or all `null`. A record carrying `thread_count = 0, comment_count = null, active_thread_count = 0` is a producer contract violation (INV-10 partial-state consistency).

**Ordering rule** (INV-09):

- `active_thread_count <= thread_count` when both are numeric. The renderer / aggregator MUST NOT produce any PR record where `active_thread_count > thread_count` (correctness bug, not a coverage-partial condition).

**Serialization order** (Principle III / QG-04 determinism):

When emitted in rollup JSON, the 8 keys MUST appear in this exact order for byte-stability:

```json
{
  "id": 12345,
  "title": "feat: add oauth flow",
  "author_id": "abc-...",
  "repository_id": "def-...",
  "cycle_time": 4732.1,
  "thread_count": 7,
  "comment_count": 23,
  "active_thread_count": 2
}
```

The Python aggregator builds the dict in this key order; the TS consumer does not re-order. Byte-stability is covered by the existing `tests/integration/test_golden_outputs.py` extended with a fixture carrying `pr_threads` + `pr_comments` data.

---

## §2 — Inclusion rules (by reference)

The rules governing `thread_count`, `comment_count`, `active_thread_count` are defined by [spec.md's "Shared inclusion-rule contract (C1)"](./spec.md). This section does NOT re-declare them; the contract's five rules (pr_threads deletion, pr_threads status-unknown, pr_comments comment_type=system, pr_comments deletion, author-missing sentinel) govern computation across this feature AND the follow-on feature (#322).

Any contract or implementation file that requires a machine-checkable form of the rules MUST link to the C1 subsection rather than re-state the rule set.

---

## §3 — Per-PR partial coverage state

### Derivation

A PR emits the three fields as `null` (partial sentinel) iff `pull_requests.comments_extracted_at IS NULL`. Otherwise the fields emit non-negative integers computed per §2.

### Examples

| `pull_requests.comments_extracted_at` | `pr_threads` rows (non-deleted) | Emitted `thread_count` | Emitted `comment_count` | Emitted `active_thread_count` |
|---|---|---|---|---|
| `NULL` | any | `null` | `null` | `null` |
| `"2025-07-10T14:22:00Z"` | 0 rows | `0` | `0` | `0` |
| `"2025-07-10T14:22:00Z"` | 5 rows (3 active, 2 fixed) | `5` | per C1 | `3` |
| `"2025-07-10T14:22:00Z"` | 3 rows (2 unknown, 1 active) | `3` | per C1 | `1` |

### Renderer contract

`extension/ui/modules/shared/detail-panel.ts::renderPrListSection` displays the three fields when `PrListSectionWithRows.commentsMetricsAvailable === true`. Per row:

- All three numeric → display the three counts.
- All three `null` → display a "coverage partial" indicator across all three columns (exact presentation is implementation detail per FR-3-05; INV-10 requires the three columns enter that state together).
- Mixed numeric + null → IMPOSSIBLE under the producer contract; test asserts this is never reached.

When `PrListSectionWithRows.commentsMetricsAvailable === false`, the three columns are not rendered (no DOM nodes added). Baseline-DOM parity test locks this (SC-03).

---

## §4 — Relationships (read-only)

```text
pull_requests (existing, INV-06 frozen)
├── pull_request_uid : primary key
├── comments_extracted_at : TEXT NULL — per-PR coverage signal (R-01)
└── [other existing fields]

pr_threads (existing from Feature 058, INV-06 frozen)
├── pull_request_uid : FK → pull_requests
├── status : TEXT ('active' | 'fixed' | 'wontFix' | 'closed' | 'byDesign' | 'pending' | 'unknown')
├── is_deleted : INT (0/1) — C1 filter
└── [other existing fields]

pr_comments (existing from Feature 058, INV-06 frozen)
├── pull_request_uid : FK → pull_requests
├── author_id : FK → users (may be NULL per C1 sentinel case)
├── comment_type : TEXT (includes 'system')
├── is_deleted : INT (0/1) — C1 filter
└── [other existing fields]

users (existing, INV-06 frozen)
└── [author_id may be missing per C1 sentinel case]
```

**Writes**: NONE. This feature reads only. No schema migrations, no new columns, no new tables.

**Query scope**: bounded to `pull_request_uid IN (top-500 capped slice)` per R-05 / user constraint. No full-table scans of `pr_threads` or `pr_comments`.

---

## §5 — Invariants → test anchors

| Invariant | Where asserted | Test |
|---|---|---|
| INV-01 (capability gating) | Aggregator: `capabilities.comments_metrics=false` ⇒ no fields emitted. Renderer: `commentsMetricsAvailable=false` ⇒ no columns. | `tests/unit/test_aggregators_pr_records_comments.py::test_no_fields_when_capability_off`<br>`extension/tests/modules/drilldown/pr-list-capability-off-baseline.test.ts` |
| INV-02 (top-500 slice inheritance) | Aggregator: join happens AFTER qualified+sorted+capped (R-05). | `tests/unit/test_aggregators_pr_records_comments.py::test_join_scoped_to_capped_slice` |
| INV-03 (no team dimension) | Structural: no team-scoped code paths added. | `extension/tests/modules/drilldown/pr-list-comments-spread-guard.test.ts` (grep-based) |
| INV-05 (CSV contract frozen) | Structural: no CSV producer changes. | Existing `tests/unit/test_csv_contract.py` unchanged |
| INV-06 (extractor frozen) | Structural: no extractor files modified. | Reviewer verification — no file in `src/ado_git_repo_insights/extract/` touched |
| INV-07 (inclusion-rule coherence) | Producer-side: C1 rules applied in aggregator SQL (see contracts/pr-record-comments-fields.md). | `tests/unit/test_aggregators_pr_records_comments.py::test_c1_inclusion_rules_applied`<br>(Consumer-side reconciliation is #322's obligation — SC-05 deferred) |
| INV-08 (field atomicity) | Producer: all three present or all three absent per record. | `tests/unit/test_aggregators_pr_records_comments.py::test_field_atomicity` (capability on, capability off; also mixed-field rejection)<br>`extension/tests/schemas/pr-record-comments-fields.test.ts::test_field_atomicity_validator_warns` |
| INV-09 (`active_thread_count <= thread_count`) | Producer: invariant held by SQL (active subset of all). Property test on random shapes. | `tests/unit/test_aggregators_pr_records_comments.py::test_active_bounded_by_total` (property test) |
| INV-10 (coverage-partial consistency) | Producer: all three `null` together iff `comments_extracted_at IS NULL`. | `tests/unit/test_aggregators_pr_records_comments.py::test_partial_state_triplet_null`<br>`tests/unit/test_aggregators_pr_records_comments.py::test_partial_state_no_mixed_null_numeric` |
| Demo-variant byte-identity (R-08) | Producer: serialization-layer gating in `scripts/generate-demo-data.py` ensures `artifacts/demo-enterprise/` (capability-on) and `artifacts/demo-enterprise-comments-off/` (capability-off) are byte-identical across every file EXCEPT the five gated keys (`manifest.capabilities.comments_metrics`, `manifest.features.comments`, `manifest.coverage.comments`, `prs[*].thread_count`, `prs[*].comment_count`, `prs[*].active_thread_count`). Generation layer is single code path — the flag affects only the serialize step, not RNG draws, not PR construction, not rollup construction. | `tests/integration/test_demo_variants_byte_identity.py::test_sorted_key_equality_excluding_gated_set` (first, structural)<br>`tests/integration/test_demo_variants_byte_identity.py::test_canonicalized_byte_equality_after_gated_removal` (second, content)<br>`tests/integration/test_demo_variants_byte_identity.py::test_array_order_parity_including_prs` (explicit — fails if any non-gated element differs in position or content within ordering-sensitive arrays like `prs[]`) |

SC-05 cross-feature reconciliation is explicitly NOT in the test grid above; that obligation is #322's per DIRECTIVE 6 / R-07.

---

## §6 — Schema parity gate

Four surfaces define this data model:

1. Python TypedDict `PrRecord` (`src/ado_git_repo_insights/types.py`).
2. TypeScript interface `PrRecord` (`extension/ui/schemas/rollup.schema.ts`).
3. `PR_RECORD_REQUIRED_FIELDS` (same file).
4. The 310 sibling contract at [`contracts/pr-record-comments-fields.md`](./contracts/pr-record-comments-fields.md).

Drift between any two of the four surfaces is forbidden and enforced by the parity gate specified in [`contracts/schema-parity-gate.md`](./contracts/schema-parity-gate.md).

`KNOWN_ROOT_FIELDS` is not in scope (it governs rollup-root keys, not PR element keys; verified in R-03).

`KNOWN_PR_RECORD_FIELDS` is not introduced in this pass (R-03 / user Q1 guard).
