# Reviewer Demo Contract

**Branch**: `037-add-reviewer-demo`

## Purpose

Define the canonical reviewer data surfaces that generation, validation, and automated tests must agree on.

## Required Dataset Surfaces

### Weekly Rollups

Each canonical reviewer-covered weekly rollup must expose:

- `by_reviewer`
- reviewer entries with `reviewed_prs`
- reviewer entries with `reviews_count`
- reviewer entries with `approval_rate`
- reviewer entries with `authors_count`
- reviewer entries with `repositories_count`

### Dimensions

The canonical dimensions file must expose:

- `users`
- `authors`
- `reviewers`

The display names represented across these dimensions must be unique realistic human-readable names with no numeric suffixes.

### Manifest Metadata

The canonical manifest must include reviewer fixture metadata for:

- valid reviewer-filter walkthrough examples
- one reviewer-constrained walkthrough example
- one deterministic reviewer-plus-team disallowed example
- minimum active reviewer expectation
- minimum multi-repository reviewer expectation

## Reviewer Fixture Rules

- At least five reviewers must have non-empty canonical reviewer activity.
- At least one canonical reviewer must span two or more repositories.
- The constrained reviewer walkthrough must be discoverable from manifest metadata without inspecting raw rollups manually.
- The disallowed reviewer-plus-team example must be deterministic and described clearly enough for demos and tests to resolve the same case every time.

## Non-Goals

- No new dashboard-only fixture format outside the canonical dataset contract
- No manual editing of `docs/data`
- No weakening of existing author, team, repository, prediction, insight, or comments coverage
