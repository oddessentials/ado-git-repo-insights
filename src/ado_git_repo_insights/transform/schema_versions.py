"""Shared schema version constants for generated dataset artifacts."""

from __future__ import annotations

MANIFEST_SCHEMA_VERSION = 1
DATASET_SCHEMA_VERSION = 1
AGGREGATES_SCHEMA_VERSION = 2
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
