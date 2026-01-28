# Data Model: Schema Parity Testing

**Feature**: 009-schema-parity-testing
**Date**: 2026-01-28

## Entities

### 1. ValidationResult

Represents the outcome of a schema validation operation.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| valid | boolean | Yes | Whether validation passed |
| errors | ValidationError[] | Yes | Array of validation errors (empty if valid) |
| warnings | ValidationWarning[] | Yes | Array of warnings (permissive mode unknown fields) |

### 2. ValidationError

Represents a single validation failure.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| field | string | Yes | JSON path to the failing field (e.g., "aggregate_index.weekly_rollups[0].week") |
| expected | string | Yes | Expected type or constraint (e.g., "string", "number >= 0") |
| actual | string | Yes | Actual value or type found |
| message | string | Yes | Human-readable error message |

### 3. ValidationWarning

Represents a non-fatal validation issue (permissive mode).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| field | string | Yes | JSON path to the unexpected field |
| message | string | Yes | Warning message (e.g., "Unknown field 'foo' in rollup data") |

### 4. CacheEntry<T>

Extended cache entry type for DatasetLoader's validate-once-and-cache.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| data | T | Yes | Cached data of type T |
| timestamp | number | Yes | Unix timestamp when cached |
| validated | boolean | Yes | Whether data passed schema validation |

### 5. SchemaValidationError

Error class thrown when schema validation fails in DatasetLoader.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | "SchemaValidationError" |
| message | string | Yes | Summary of validation failure |
| errors | ValidationError[] | Yes | Detailed list of validation errors |
| artifactType | string | Yes | Type of artifact that failed ("manifest", "rollup", etc.) |

## Schema Definitions

### ManifestSchema (Strict Mode)

Based on existing `ManifestSchema` interface in `extension/ui/types.ts`.

```typescript
interface ManifestSchema {
  // Required fields
  manifest_schema_version: number;    // Must be 1

  // Optional fields with type constraints
  dataset_schema_version?: number;
  aggregates_schema_version?: number;
  predictions_schema_version?: number;
  insights_schema_version?: number;
  generated_at?: string;              // ISO 8601 datetime
  run_id?: string;

  defaults?: {
    default_date_range_days?: number; // Must be > 0
  };

  limits?: {
    max_weekly_files?: number;        // Must be > 0
    max_distribution_files?: number;  // Must be > 0
  };

  features?: Record<string, boolean>;

  coverage?: {
    total_prs?: number;               // Must be >= 0
    date_range?: {
      min?: string;                   // ISO 8601 date
      max?: string;                   // ISO 8601 date
    };
    comments?: string;
  };

  aggregate_index?: {
    weekly_rollups?: Array<{
      week: string;                   // ISO week format (YYYY-Www)
      path: string;
      pr_count?: number;
      size_bytes?: number;
    }>;
    distributions?: Array<{
      year: string;                   // YYYY format
      path: string;
      total_prs?: number;
      size_bytes?: number;
    }>;
    predictions?: { path: string };
    ai_insights?: { path: string };
  };

  warnings?: string[];
}
```

**Validation Rules (Strict)**:
- Unknown fields → ValidationError
- Missing `manifest_schema_version` → ValidationError
- Invalid date formats → ValidationError
- Negative counts → ValidationError

### RollupSchema (Permissive Mode)

Based on existing `Rollup` interface in `extension/ui/dataset-loader.ts`.

```typescript
interface RollupSchema {
  // Required fields
  week: string;                       // ISO week format (YYYY-Www)

  // Optional fields with defaults
  pr_count?: number;                  // Default: 0
  cycle_time_p50?: number | null;     // Default: null
  cycle_time_p90?: number | null;     // Default: null
  authors_count?: number;             // Default: 0
  reviewers_count?: number;           // Default: 0
  by_repository?: Record<string, number> | null;  // Default: null
  by_team?: Record<string, number> | null;        // Default: null
}
```

**Validation Rules (Permissive)**:
- Unknown fields → ValidationWarning (logged, validation passes)
- Missing `week` → ValidationError
- Invalid week format → ValidationError
- Negative counts → ValidationError

### DimensionsSchema (Strict Mode)

Based on existing `DimensionsData` interface in `extension/ui/types.ts`.

```typescript
interface DimensionsSchema {
  repositories?: Array<{
    id: string;
    name: string;
    project?: string;
  }>;

  users?: Array<{
    id: string;
    displayName: string;
    uniqueName?: string;
  }>;

  projects?: Array<{
    id: string;
    name: string;
  }>;

  teams?: Array<{
    id: string;
    name: string;
    projectId?: string;
  }>;

  date_range?: {
    min: string;                      // ISO 8601 date
    max: string;                      // ISO 8601 date
  };
}
```

**Validation Rules (Strict)**:
- Unknown fields → ValidationError
- Array items must have `id` and appropriate name field → ValidationError
- Invalid date formats in date_range → ValidationError

### PredictionsSchema (Permissive Mode, Optional File)

Based on existing `PredictionsData` interface in `extension/ui/types.ts`.

```typescript
interface PredictionsSchema {
  state: "disabled" | "missing" | "auth" | "ok" | "error" | "invalid" | "unavailable";
  data?: unknown;                     // Flexible payload
  error?: string;
  message?: string;
}
```

**Validation Rules (Permissive)**:
- File may be absent (handled at DatasetLoader level)
- If present and `state` is invalid enum value → ValidationError
- Unknown fields → ValidationWarning (logged, validation passes)

## State Transitions

### Validation State Machine

```
┌─────────────────┐
│   Unvalidated   │ ← Initial state (data loaded but not validated)
└────────┬────────┘
         │ validate()
         ▼
    ┌────────────┐     ┌──────────────┐
    │  Validating │────►│   Invalid    │ (ValidationError thrown)
    └────────┬───┘     └──────────────┘
             │ success
             ▼
    ┌────────────┐
    │  Validated  │ ← Cached with validated=true
    └────────────┘
```

### Cache Entry Lifecycle

```
1. Cache miss → Fetch data → Validate → Cache with validated=true
2. Cache hit (validated=true) → Return immediately (skip validation)
3. Cache hit (validated=false) → Re-validate → Update cache
4. Cache expiry (TTL) → Remove entry → Next access triggers fetch
```

## Relationships

```
DatasetLoader
    │
    ├── uses ──► SchemaValidator (validates all 4 artifact types)
    │                │
    │                ├── validateManifest(data, strict=true)
    │                ├── validateRollup(data, strict=false)
    │                ├── validateDimensions(data, strict=true)
    │                └── validatePredictions(data, strict=false)
    │
    └── stores ──► CacheEntry<T>
                       │
                       └── validated: boolean (tracks validation state)
```

## Constraints

1. **Strictness by file type**: Manifest and Dimensions use strict validation; Rollup and Predictions use permissive validation
2. **Optional file handling**: Predictions file may be absent; absence is not a validation error
3. **Validation timing**: Validate only on first load; cached data skips validation
4. **Error specificity**: All errors must include field path, expected type, actual value
5. **Warning logging**: Permissive mode logs warnings for unknown fields but does not fail
