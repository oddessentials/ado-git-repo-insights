# Data Model: Dashboard Critical Test Coverage

**Feature**: 023-dashboard-coverage
**Date**: 2026-02-03

## Overview

This document defines the fixture schemas and state definitions for the 5-state test matrix.

## Artifact State Machine

The ML tab rendering uses a 5-state machine defined in production code:

```typescript
type ArtifactStateType =
  | "setup-required"  // Artifact file doesn't exist
  | "no-data"         // Artifact exists but has no data points
  | "invalid-artifact" // Artifact exists but fails schema validation
  | "unsupported-schema" // Artifact has unsupported schema version
  | "ready";          // Artifact valid and has data
```

## Fixture Matrix

### Predictions Fixtures

#### predictions-ready.json

Valid predictions artifact with data points.

```json
{
  "schema_version": "1.0.0",
  "generated_at": "2026-02-03T12:00:00Z",
  "model_info": {
    "name": "trend-forecaster",
    "version": "1.0.0"
  },
  "predictions": [
    {
      "metric": "pr_throughput",
      "period": "2026-W06",
      "predicted_value": 45,
      "confidence_lower": 38,
      "confidence_upper": 52
    },
    {
      "metric": "cycle_time",
      "period": "2026-W06",
      "predicted_value": 2.3,
      "confidence_lower": 1.8,
      "confidence_upper": 2.8
    }
  ]
}
```

#### predictions-no-data.json

Valid schema but empty predictions array.

```json
{
  "schema_version": "1.0.0",
  "generated_at": "2026-02-03T12:00:00Z",
  "model_info": {
    "name": "trend-forecaster",
    "version": "1.0.0"
  },
  "predictions": []
}
```

#### predictions-invalid.json (EXISTS)

Malformed artifact failing schema validation.

```json
{
  "schema_version": "1.0.0",
  "predictions": "not-an-array"
}
```

#### predictions-unsupported-v.json (EXISTS)

Valid structure but unsupported schema version.

```json
{
  "schema_version": "99.0.0",
  "generated_at": "2026-02-03T12:00:00Z",
  "predictions": []
}
```

### Insights Fixtures

#### insights-ready.json (RENAME from insights-valid.json)

Valid AI insights artifact with data.

```json
{
  "schema_version": "1.0.0",
  "generated_at": "2026-02-03T12:00:00Z",
  "insights": [
    {
      "type": "trend",
      "title": "PR Volume Increasing",
      "description": "Pull request volume increased 15% this week.",
      "severity": "info",
      "metrics": ["pr_count"]
    }
  ]
}
```

#### insights-no-data.json

Valid schema but empty insights array.

```json
{
  "schema_version": "1.0.0",
  "generated_at": "2026-02-03T12:00:00Z",
  "insights": []
}
```

#### insights-invalid.json (EXISTS)

Malformed artifact failing schema validation.

```json
{
  "schema_version": "1.0.0",
  "insights": "not-an-array"
}
```

#### insights-unsupported-v.json (EXISTS)

Valid structure but unsupported schema version.

```json
{
  "schema_version": "99.0.0",
  "generated_at": "2026-02-03T12:00:00Z",
  "insights": []
}
```

## State-to-Fixture Mapping

| State | Fixture | Expected Behavior |
|-------|---------|-------------------|
| `setup-required` | No file loaded | Renders empty state with setup guidance |
| `no-data` | `*-no-data.json` | Renders "No data available" message |
| `invalid-artifact` | `*-invalid.json` | Renders error banner with "Invalid artifact" message |
| `unsupported-schema` | `*-unsupported-v.json` | Renders banner with "Unsupported schema version" |
| `ready` | `*-ready.json` | Renders full predictions/insights UI |

## Expected DOM Output per State

### setup-required State

```html
<div class="ml-empty-state">
  <div class="ml-empty-state-icon"><!-- icon --></div>
  <div class="ml-empty-state-title">ML Features Not Configured</div>
  <div class="ml-empty-state-message">Configure ML pipeline to enable predictions.</div>
</div>
```

### no-data State

```html
<div class="artifact-state no-data">
  <div class="artifact-state-title">No Data Available</div>
  <div class="artifact-state-message">Not enough historical data for predictions.</div>
</div>
```

### invalid-artifact State

```html
<div class="artifact-error-banner">
  <div class="artifact-error-title">Invalid Artifact</div>
  <div class="artifact-error-message">The predictions file failed validation.</div>
</div>
```

### unsupported-schema State

```html
<div class="artifact-error-banner unsupported">
  <div class="artifact-error-title">Unsupported Schema Version</div>
  <div class="artifact-error-message">Update extension to support schema version 99.0.0</div>
</div>
```

### ready State

```html
<div class="predictions-content">
  <!-- Full predictions chart and cards -->
</div>
```

## Settings Test Data

### Valid Settings

```typescript
const VALID_SETTINGS = {
  projectId: "my-project-123",
  pipelineId: 42
};
```

### Invalid Settings

```typescript
const INVALID_SETTINGS = {
  projectId: "",           // Empty string
  pipelineId: -1           // Invalid pipeline ID
};
```

### Missing Settings

```typescript
const MISSING_SETTINGS = {
  projectId: undefined,
  pipelineId: undefined
};
```

## HTTP Response Test Data

### Success Responses

```typescript
const HTTP_SUCCESS = {
  status: 200,
  ok: true,
  json: () => Promise.resolve({ data: "valid" })
};
```

### Error Responses

```typescript
const HTTP_401 = { status: 401, ok: false, statusText: "Unauthorized" };
const HTTP_403 = { status: 403, ok: false, statusText: "Forbidden" };
const HTTP_404 = { status: 404, ok: false, statusText: "Not Found" };
const HTTP_500 = { status: 500, ok: false, statusText: "Internal Server Error" };
```

### Malformed Response

```typescript
const HTTP_MALFORMED = {
  status: 200,
  ok: true,
  json: () => Promise.reject(new SyntaxError("Unexpected token"))
};
```
