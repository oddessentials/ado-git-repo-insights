"""Shared schema version constants for generated dataset artifacts."""

from __future__ import annotations

MANIFEST_SCHEMA_VERSION = 1
DATASET_SCHEMA_VERSION = 1
# v3 → v4 (#356): rollup-level comments-aggregate sites grew an additive
# 5th field ``vote_event_count`` (the subset of ``comment_count`` matching
# the shared vote-event regex).  Bump signals consumers that the new field
# may appear; the schema validator treats ``vote_event_count`` as optional
# at consumption time so v3 artifacts (4-field comments shape) continue to
# load gracefully on v4-aware consumers.  Producers at v4 always emit the
# 5-field shape (Python tests at
# ``tests/unit/test_aggregators_*comments*.py`` enforce the producer-side
# atomicity contract).
AGGREGATES_SCHEMA_VERSION = 4
PREDICTIONS_SCHEMA_VERSION = 1
INSIGHTS_SCHEMA_VERSION = 1

# Capability metadata keys emitted in dataset-manifest.json.
# These are additive manifest fields and do not change the core CSV contract.
MANIFEST_CAPABILITY_KEYS = (
    "author_filters",
    "author_repo_exact",
    "comments_metrics",
    "reviewer_repository_mode",
    "reviewer_team_mode",
    "cross_dimensional_available",
)
