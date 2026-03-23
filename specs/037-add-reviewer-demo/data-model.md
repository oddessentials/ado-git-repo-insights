# Data Model: Reviewer Demo Coverage

**Branch**: `037-add-reviewer-demo` | **Date**: 2026-03-23

This feature extends the deterministic demo dataset contract without changing the dashboard's runtime architecture. The primary model changes are synthetic identity quality, reviewer fixture metadata, and stronger validation evidence.

## Core Entities

### Synthetic User Identity

Represents a demo-facing person used across user, author, and reviewer dimensions.

| Field | Type | Description |
|------|------|-------------|
| `user_id` | UUID string | Stable deterministic identifier for the synthetic user |
| `display_name` | string | Unique realistic human-readable name with no numeric suffixes |
| `author_name` | string | Same human-readable identity when surfaced through author dimensions |
| `reviewer_name` | string | Same human-readable identity when surfaced through reviewer dimensions |

**Invariants**:
- Exactly 200 users are generated
- Every display name is unique
- No display name ends with a numeric suffix or contains placeholder numbering

### Weekly Reviewer Breakdown

Represents reviewer-specific aggregate activity for a single ISO week.

| Field | Type | Description |
|------|------|-------------|
| `reviewed_prs` | integer | Pull requests touched by the reviewer in that week |
| `reviews_count` | integer | Review actions associated with the reviewer in that week |
| `approval_rate` | decimal | Reviewer approval ratio for the week |
| `authors_count` | integer | Number of authors whose pull requests were reviewed |
| `repositories_count` | integer | Number of repositories spanned by the reviewer in that week |

**Invariants**:
- `by_reviewer` is present for canonical reviewer-covered weeks
- At least five reviewers have non-empty activity in the canonical demo
- At least one reviewer spans two or more repositories

### Reviewer Fixture Metadata

Represents canonical walkthrough and validation fixtures stored in the dataset manifest.

| Field | Type | Description |
|------|------|-------------|
| `reviewer_filter_examples` | list | Reviewer selections that should produce valid reviewer-filtered demos |
| `reviewer_constrained_example` | object | Canonical reviewer-focused constrained walkthrough metadata |
| `reviewer_team_disallowed_example` | object | Canonical reviewer-plus-team combination that must be rejected |
| `minimum_active_reviewers` | integer | Minimum reviewer count expected by validation |
| `minimum_multi_repo_reviewers` | integer | Minimum number of reviewers that span multiple repositories |

**Invariants**:
- Every documented example resolves to data present in the canonical dataset
- The disallowed example is deterministic and easy to discover
- Validation reads the same fixture metadata that demos and tests use

### Publication Validation Result

Represents the build-time readiness outcome for canonical demo artifacts.

| Field | Type | Description |
|------|------|-------------|
| `all_passed` | boolean | Whether the canonical reviewer contract and other capabilities pass |
| `failed_capabilities` | list | Failed reviewer or parity capability identifiers |
| `error_reason` | string | Clear blocking reason when reviewer contract data is missing |
| `artifact_scope` | list | Canonical files and directories included in determinism comparison |

## Relationships

- One `Synthetic User Identity` can appear in `users`, `authors`, and `reviewers` dimensions.
- One weekly rollup contains many `Weekly Reviewer Breakdown` entries keyed by reviewer identity.
- `Reviewer Fixture Metadata` references reviewer identities and constraint examples that must be representable by the generated rollups and dimensions.
- `Publication Validation Result` is derived from the canonical dataset and its fixture metadata before promotion to `docs/data`.
