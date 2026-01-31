# Demo Data Versioning Policy

**Version**: 1.0
**Last Updated**: 2026-01-31

## Overview

This document defines the versioning policy for the demo dashboard's synthetic data, ensuring backward compatibility for users who may have bookmarked or referenced specific demo URLs.

## Versioning Principles

### 1. Backward-Compatible Changes Only

All changes to the demo data structure MUST be backward-compatible. This means:

- **New fields may be added** to JSON objects at any level
- **Existing fields must not be removed** without explicit versioning
- **Field types must not change** (e.g., number to string)
- **Enum values may be added** but not removed
- **Array ordering may change** only if consumers don't depend on order

### 2. Schema Version Tracking

Each data file type has an explicit schema version in `dataset-manifest.json`:

```json
{
  "manifest_schema_version": 1,
  "dataset_schema_version": 1,
  "aggregates_schema_version": 1,
  "predictions_schema_version": 1,
  "insights_schema_version": 1
}
```

### 3. When to Bump Versions

| Change Type | Action |
|------------|--------|
| Add optional field | No version bump needed |
| Add new insight category | No version bump needed |
| Remove field | Bump major version, document migration |
| Change field type | Bump major version, document migration |
| Change date format | Bump major version, document migration |

## Breaking Change Procedure

If a breaking change is absolutely necessary:

1. **Document the change** in this file under "Breaking Changes History"
2. **Bump the schema version** in the manifest
3. **Update the dashboard** to handle both old and new formats
4. **Announce the change** in the release notes
5. **Provide migration guidance** for any affected workflows

## File Stability Guarantees

### Stable (No Breaking Changes)

These files have stable structures that won't change:

- `dataset-manifest.json` - Core manifest structure
- `aggregates/weekly_rollups/*.json` - Weekly metric rollups
- `aggregates/distributions/*.json` - Yearly distributions

### Semi-Stable (Additive Changes Only)

These files may gain new fields but won't lose existing ones:

- `predictions/trends.json` - Forecast data (may add new metrics)
- `insights/summary.json` - Insights data (may add new categories)

### Evolving (May Change)

These files are considered internal and may change:

- `aggregates/dimensions.json` - Entity listings (structure may evolve)

## Determinism Guarantee

All demo data is deterministically generated with `seed=42`. This means:

- Running the generators produces **byte-identical output**
- PR counts, cycle times, and all metrics are reproducible
- Any change to output constitutes a schema change

## Breaking Changes History

### Version 1.0 (2026-01-31)

- Initial release
- No breaking changes from prior versions (this is the baseline)

---

## For Maintainers

When modifying demo data generators:

1. **Preserve field names** - Use the same JSON keys
2. **Preserve field types** - Don't change number to string, etc.
3. **Test regeneration** - Run `git diff --exit-code docs/data/` after generation
4. **Update this document** if adding new fields

## Contact

For questions about demo data versioning, open an issue at:
https://github.com/oddessentials/ado-git-repo-insights/issues
