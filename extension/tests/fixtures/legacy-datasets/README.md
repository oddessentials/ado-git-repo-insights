# Legacy Dataset Fixtures

Test fixtures for backward compatibility testing of the version adapter pattern.

## Fixture Files

| File               | Schema Version | Missing Fields                                                        | Protected Behavior                         |
| ------------------ | -------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| `v1.0-rollup.json` | Minimal (v1.0) | by*team, by_repository, authors_count, reviewers_count, cycle_time*\* | Dashboard renders without team/repo slices |
| `v1.1-rollup.json` | +cycle_time    | by_team, by_repository, authors_count, reviewers_count                | Cycle time charts display correctly        |
| `v1.2-rollup.json` | +contributors  | by_team, by_repository                                                | Contributor metrics without team filtering |
| `manifest.json`    | Current        | N/A                                                                   | Manifest loading for integration tests     |

## Purpose

These fixtures verify that `dataset-loader.js` normalizes old data via the version adapter
when loaded through `DatasetLoader.getWeeklyRollups()`. Tests must never call
`normalizeRollup()` directly—only via the real loader path.

## Adding New Fixtures

When adding a new schema version:

1. Create a minimal fixture with only the fields that existed at that version
2. Update this README with the missing fields
3. Add a corresponding test case in `version-adapter-integration.test.js`
