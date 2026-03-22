# Contract: Dataset Capabilities And Additive Output Boundary

**Feature**: 034-roadmap-closure
**Status**: Draft

## Purpose

Define the non-breaking contract for additive roadmap-closure data surfaces so the loader can detect feature availability safely and preserve compatibility with older datasets.

## Core Rule

There are exactly two output classes:

1. `core-contract-csvs`
2. `auxiliary-additive-outputs`

### Core Contract CSVs

These remain unchanged by this roadmap program:

- `organizations.csv`
- `projects.csv`
- `repositories.csv`
- `pull_requests.csv`
- `users.csv`
- `reviewers.csv`

### Auxiliary Additive Outputs

These may be added or extended by this roadmap program:

- author and author x repository rollup fields
- comments aggregate JSON
- comments auxiliary CSVs
- manifest capability/version metadata
- dashboard-only additive UI behavior

Auxiliary comments CSVs must live only under:

`csv-output/auxiliary/comments/`

Required filenames:

- `pr_threads.csv`
- `pr_comments.csv`

## Loader Capability Contract

The loader must normalize a capability-aware state with equivalent semantics to the following:

```text
author_filters_available: boolean
author_repo_exact_available: boolean
comments_metrics_available: boolean
comments_coverage_status: "disabled" | "full" | "partial"
reviewer_combination_mode: "exact" | "constrained" | "disallowed"
cross_dimensional_available: boolean
```

The exact manifest field names may differ, but the loader must derive these normalized capabilities from explicit metadata or schema-version support, not ad hoc UI inference.

## Capability Source-Of-Truth Precedence

Loader detection must follow this exact precedence:

1. manifest capability flags
2. schema-version support
3. normalized safe defaults

Rules:
- if a manifest capability flag exists, it wins
- schema version is used only when the capability flag is absent
- safe defaults are used only when neither signal exists
- downstream UI modules must consume normalized loader state rather than re-evaluating raw manifest/version combinations

## Additive Rollup Contract

The following weekly rollup fields are additive and optional:

```text
by_author?: Record<author_id, BreakdownEntry>
by_author_and_repo?: Record<author_id, Record<repository_name, BreakdownEntry>>
```

Rules:
- `author_id` is canonical `user_id`
- absence of these fields must not break legacy datasets
- any truncation or bounded exactness loss must be accompanied by explicit capability or metadata signaling

## Comments Coverage Contract

Comments coverage must expose equivalent semantics to:

```json
{
  "status": "disabled | full | partial",
  "threads_fetched": 0,
  "comments_fetched": 0,
  "prs_with_threads": 0,
  "capped": false
}
```

Rules:
- `partial` or `capped=true` must be rendered as incomplete coverage
- coverage must not be guessed solely from non-zero row counts

## Compatibility Rules

- Legacy datasets without additive capability metadata must normalize to safe defaults.
- UI modules consume normalized capability-aware state from the loader rather than probing raw manifest structure directly.
- Unknown additive fields may be warned on in permissive mode, but core contract behavior must remain intact.

## Verification Obligations

- core CSV regression tests remain green
- loader compatibility tests cover legacy and additive datasets
- schema tests validate new additive surfaces without mutating old required surfaces
