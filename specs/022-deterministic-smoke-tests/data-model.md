# Data Model: Deterministic Smoke Tests

**Feature Branch**: `022-deterministic-smoke-tests`
**Date**: 2026-02-02

## Data Model Status

**N/A** - This feature is a test infrastructure refactoring with no data model changes.

## Rationale

This feature modifies:
- Smoke test wait strategies (code patterns, not data)
- Screenshot artifact paths (file system, not data model)
- Timeout constant centralization (TypeScript constants)
- Deep clone utility replacement (runtime behavior)
- Type-test file headers (documentation)
- CI meta-tests (test infrastructure)

None of these changes affect:
- Database schemas
- API contracts
- Data entity definitions
- Data validation rules
- State transitions

The existing data contracts from previous features remain unchanged:
- `WeeklyRollup` schema
- `BreakdownEntry` schema
- `ManifestFixture` schema (for test fixtures)

## Related Schemas (Reference Only)

For reference, the smoke tests interact with these existing schemas:

### ManifestFixture (from filter-display.smoke.ts)

```typescript
interface ManifestFixture {
  aggregate_index: {
    weekly_rollups: Array<{
      path: string;
      pr_count: number;
      week: string;
    }>;
  };
  aggregates_schema_version: number;
  coverage: {
    total_prs: number;
  };
}
```

This schema is used for fixture validation in `beforeAll` hooks but is not modified by this feature.

### data-testid Selectors (UI Contract)

| Selector | Element | Type |
|----------|---------|------|
| `total-prs` | Total PRs display | `<div>` |
| `filter-repository` | Repository dropdown | `<select>` |
| `filter-team` | Team dropdown | `<select>` |
| `error-generic` | Error panel | `<div>` |
| `error-setup-required` | Setup panel | `<div>` |

These selectors are a UI contract validated by `tests/meta/data-testid-validation.test.ts` and are not modified by this feature.
