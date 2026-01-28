# Next Steps

Outstanding work items for the PR Insights dashboard.

---

## Task 1: Schema Parity Test (Priority: High)

**Goal:** Ensure dashboard renders identically across extension, local prod, and local dev modes.

### Problem

The dashboard loads the same JavaScript code in all modes (enforced by CI `ui-bundle-sync` job), but data could differ:
- Extension mode: Loads JSON from ADO pipeline artifacts
- Local mode: Loads JSON from local files

If the JSON schemas drift, the same code could produce different output.

### Solution

Create a schema parity test that validates:

1. **dataset-manifest.json** - Manifest structure matches between local fixtures and ADO artifacts
2. **Rollup JSON** - Weekly rollup structure is identical
3. **dimensions.json** - Repository/team/user dimension structure matches
4. **predictions.json** - ML prediction output structure (if enabled)

### Implementation Options

| Approach | Pros | Cons |
|----------|------|------|
| JSON Schema (ajv) | Industry standard, reusable | Additional dependency |
| TypeScript interfaces | Already have types | Runtime validation needed |
| Zod schemas | Type inference + runtime | New dependency |

### Acceptance Criteria

- [ ] Shared schema definition exists for all JSON artifacts
- [ ] Local fixtures validated against schema in tests
- [ ] DatasetLoader validates incoming data against schema
- [ ] CI fails if schema validation fails

---

## Task 2: TypeScript Coverage to 70% (Priority: Medium)

**Blocked by:** Task 1 (Schema Parity Test)

**Goal:** Increase TypeScript test coverage from ~44% to 70% enterprise-grade threshold.

### Current State

| Metric | Current | Target |
|--------|---------|--------|
| Statements | 44% | 70% |
| Branches | 38% | 70% |
| Functions | 50% | 70% |
| Lines | 45% | 70% |

### Coverage Gaps

Modules with 0% coverage requiring DOM mocking infrastructure:

| Module | Lines | Why Untested |
|--------|-------|--------------|
| dashboard.ts | 1634 | Heavy DOM manipulation, SDK initialization |
| settings.ts | 722 | DOM forms, SDK storage APIs |
| modules/comparison.ts | 73 | DOM rendering |
| modules/errors.ts | 215 | DOM error panels |
| modules/index.ts | 45 | DOM initialization |

### Implementation Strategy

1. **Create DOM test utilities** - Reusable JSDOM setup with common mocks
2. **Mock VSS SDK** - Extend existing smoke-render mocks for unit tests
3. **Test pure functions first** - Extract testable logic from DOM code
4. **Add integration tests** - Full render cycle with mocked DOM

### Why Blocked by Schema Parity

Schema parity tests will:
- Create fixture data that's guaranteed valid
- Enable confident testing of data-dependent rendering
- Prevent false positives from malformed test data

### Acceptance Criteria

- [ ] Coverage threshold set to 70% in jest.config.ts
- [ ] All coverage metrics exceed 70%
- [ ] No test skips in CI
- [ ] DOM test utilities documented for future use

---

## Execution Order

```
[Task 1: Schema Parity] ──blocks──> [Task 2: TypeScript Coverage 70%]
```

Complete schema parity first to establish reliable test fixtures, then use those fixtures to write comprehensive DOM tests.
