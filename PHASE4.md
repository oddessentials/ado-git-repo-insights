# Phase 4 — Extension Test & Operations Hardening

**Implementation Plan**

## Objective

Harden the Azure DevOps extension so it behaves predictably under real-world enterprise conditions: permission issues, missing artifacts, schema drift, and large datasets. Phase 4 focuses on testability, contract enforcement, recovery UX, performance stability, and operational visibility.

---

## 1. Extension-side Test Harness

Implement a deterministic UI test harness that exercises the extension without requiring a live Azure DevOps pipeline.

### Requirements

* Mock the Azure DevOps Extension SDK authentication flow used in production.
* Mock Azure DevOps REST API responses for:

  * latest successful pipeline run discovery
  * artifact metadata lookup
  * artifact file download
* Support simulated responses for:

  * no successful runs
  * missing artifacts
  * permission denied (401/403)
  * pipeline or project not found (404)
  * transient server failures (5xx)

### Fixtures

* Create golden JSON fixtures containing:

  * `dataset-manifest.json`
  * representative aggregate datasets
* Tests must load fixtures through the same loader code paths used in production.

### Definition of Done

* UI tests run fully in CI with no live ADO dependencies.
* Loader behavior is verified across success and failure cases.

---

## 2. Producer–Consumer Contract Enforcement

Establish strict, versioned contracts between Python outputs and extension inputs.

### Scope

Define JSON schemas for:

* `dataset-manifest.json`
* `dimensions.json`
* `weekly_rollups/*.json`
* `distributions/*.json`

### Requirements

* Each schema includes:

  * `schema_version`
  * `dataset_version`
* Breaking changes require a dataset version bump.
* The extension must support the current and immediately previous dataset version.

### Tests

* Python-side tests validate generated output against schemas.
* Extension-side tests validate loaded datasets against the same schemas.

### Definition of Done

* Any schema-breaking change fails CI immediately.
* Python and extension stay compatible without lockstep deployment.

---

## 3. Permission & Recovery UX Hardening

Eliminate blank or ambiguous UI states caused by runtime failures.

### Error Model

Define a single typed error model with at least:

* `NO_PERMISSION`
* `NOT_FOUND`
* `NO_RUNS`
* `NO_ARTIFACTS`
* `VERSION_MISMATCH`
* `TRANSIENT_ERROR`

### UI Behavior

* Map each error type to:

  * deterministic user-facing messaging
  * available recovery actions (Retry, Open Pipeline Run, etc.)
* All loader failures must resolve to a defined UI state.

### Definition of Done

* No blank screens under any failure condition.
* Users always receive a clear explanation and next step.

---

## 4. Performance Guardrails for Large Organizations

Ensure UI remains responsive with large datasets.

### Requirements

* Implement chunked data loading with:

  * capped concurrent fetches
  * caching of previously loaded chunks
* Warn users on very large date ranges before loading.
* Progressive rendering: partial data renders while loading continues.

### Testing

* Create a large synthetic dataset fixture.
* Add a performance test that:

  * loads the fixture
  * verifies first meaningful render within a fixed time budget
  * ensures no unbounded memory growth

### Definition of Done

* UI remains responsive with large fixtures.
* Performance regressions fail CI.

---

## 5. Operational Visibility & Drift Detection

Provide operators with immediate insight into dataset health and scale.

### Pipeline Output

Emit a structured operational summary that includes:

* artifact size
* row counts per dataset
* coverage indicators (teams, comments, etc.)
* retention guidance reminders

### Constraints

* Output must be non-sensitive and follow existing redaction rules.
* Format must be consistent and machine-parseable.

### Definition of Done

* Operators can detect scale, retention, and data-quality issues from logs or manifest alone.

---

## Completion Criteria

Phase 4 is complete when:

* Extension tests run in CI without live ADO dependencies
* Producer–consumer schema enforcement is active on both sides
* All runtime failures map to deterministic UI states
* Large datasets render without UI degradation
* Operational summaries reliably surface drift and scale issues
