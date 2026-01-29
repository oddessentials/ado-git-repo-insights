# Research: Enable ML Features & Migrate to pnpm

**Branch**: `010-pnpm-ml-enablement` | **Date**: 2026-01-28

## Research Tasks

### 1. pnpm Corepack Integration

**Decision**: Use `pnpm/action-setup@v4` for GitHub Actions, enable Corepack in all CI jobs

**Rationale**:
- `pnpm/action-setup` is the official pnpm GitHub Action with built-in caching support
- Corepack is bundled with Node.js 16.9+ and provides transparent pnpm version management
- `packageManager` field in package.json enforces version consistency

**Alternatives Considered**:
- Manual pnpm installation via npm: Rejected (adds npm dependency we're trying to remove)
- Direct Corepack only: Viable but action provides better caching integration

**Implementation Pattern**:
```yaml
# GitHub Actions
- uses: pnpm/action-setup@v4
  with:
    version: 9
- uses: actions/setup-node@v4
  with:
    node-version: '22'
    cache: 'pnpm'
- run: pnpm install --frozen-lockfile

# Azure DevOps (for reference)
- script: |
    corepack enable
    corepack prepare pnpm@latest --activate
    pnpm install --frozen-lockfile
  displayName: 'Install dependencies'
```

### 2. State Machine Patterns for UI Gating

**Decision**: Implement discriminated union type with explicit state resolution function

**Rationale**:
- TypeScript's discriminated unions provide compile-time exhaustiveness checking
- Single `resolveArtifactState()` function ensures first-match-wins semantics
- State is immutable once resolved—no fallthrough or mixed states possible

**Alternatives Considered**:
- Class-based state pattern: Rejected (over-engineering for 5 simple states)
- Redux-style reducer: Rejected (adds unnecessary indirection for read-only state)
- Enum with switch: Rejected (less type-safe than discriminated unions)

**Implementation Pattern**:
```typescript
// Discriminated union for type safety
type ArtifactState =
  | { type: 'setup-required' }
  | { type: 'no-data'; quality?: 'insufficient' }
  | { type: 'invalid-artifact'; error: string }
  | { type: 'unsupported-schema'; version: number; supported: [number, number] }
  | { type: 'ready'; data: PredictionsRenderData | InsightsRenderData };

// First-match-wins resolver
function resolveArtifactState(result: LoadResult): ArtifactState {
  // Check order per FR-004: existence → validity → fields → version → data
  if (result.notFound) return { type: 'setup-required' };
  if (result.parseError) return { type: 'invalid-artifact', error: result.parseError };
  if (result.missingFields) return { type: 'invalid-artifact', error: 'Missing required fields' };
  if (!isSchemaVersionSupported(result.schemaVersion)) {
    return { type: 'unsupported-schema', version: result.schemaVersion, supported: SUPPORTED_RANGE };
  }
  if (isEmpty(result.data)) return { type: 'no-data', quality: result.dataQuality };
  return { type: 'ready', data: result.data };
}
```

### 3. Schema Validation Boundaries

**Decision**: Validate schema_version in DatasetLoader, render states in dashboard

**Rationale**:
- Loader is responsible for data integrity (parsing, validation)
- Dashboard is responsible for UX (rendering appropriate state UI)
- Separation allows loader to be used in non-UI contexts (CLI, tests)

**Alternatives Considered**:
- Validation in renderer: Rejected (renderer shouldn't know about schema versions)
- Validation in both: Rejected (violates DRY, risks inconsistency)
- Separate validator service: Rejected (unnecessary abstraction for this scope)

**Implementation Boundary**:
```
DatasetLoader                    Dashboard
─────────────                    ─────────
loadPredictions() ─────────────→ resolveArtifactState()
  ├─ fetch file                    ├─ check state type
  ├─ parse JSON                    └─ render appropriate UI
  ├─ validate schema
  ├─ validate fields
  └─ return LoadResult
```

### 4. pnpm Enforcement in CI

**Decision**: Multi-layer enforcement with explicit failure modes

**Rationale**:
- `packageManager` field + Corepack prevents accidental npm usage
- CI guard job explicitly fails on `package-lock.json` presence
- Fresh-clone job proves determinism without cache

**Implementation Layers**:
1. **package.json**: `"packageManager": "pnpm@9.15.0"`
2. **.npmrc**: `engine-strict=true` (optional, for npm rejection)
3. **CI Guard Job**: `test -f package-lock.json && exit 1`
4. **CI Install Command**: `pnpm install --frozen-lockfile`
5. **Fresh-Clone Job**: No cache, proves from-scratch works

### 5. Insights Schema Definition

**Decision**: Create `insights.schema.ts` mirroring predictions pattern

**Rationale**:
- Existing `predictions.schema.ts` provides proven validation pattern
- Insights schema has similar structure (schema_version, generated_at, array of items)
- Consistent approach reduces cognitive load and enables code reuse

**Schema Structure**:
```typescript
interface InsightsArtifact {
  schema_version: number;  // Required, must be in supported range
  generated_at: string;    // Required, ISO 8601
  insights: InsightItem[]; // Required, may be empty
}

interface InsightItem {
  id: string | number;     // Required for ordering
  category: string;        // Required for grouping
  severity: 'critical' | 'warning' | 'info';  // Required for ordering
  title: string;           // Required for display
  description: string;     // Required for display
  data?: InsightData;      // Optional
  affected_entities?: AffectedEntity[];  // Optional
  recommendation?: Recommendation;  // Optional
}
```

## Resolved Unknowns

| Unknown | Resolution |
|---------|------------|
| pnpm CI setup | Use pnpm/action-setup@v4 with Corepack |
| State machine pattern | Discriminated union with resolver function |
| Schema validation location | DatasetLoader validates, dashboard renders states |
| pnpm enforcement | Multi-layer: packageManager + CI guard + frozen-lockfile |
| Insights schema | Mirror predictions pattern with severity ordering |

## Next Steps

1. Create `data-model.md` with entity definitions
2. Create JSON schema contracts in `contracts/`
3. Create `quickstart.md` for developer setup
4. Run agent context update script
