# Team & Reviewer Filter Implementation Status

> Last reviewed: 2026-03-20
> Reviewer blocker decisions (B-04, B-05, B-06) were resolved in `specs/032-roadmap-blocker-resolution/`.

## Summary

| Filter Type | Status | Remaining Work |
|-------------|--------|----------------|
| **Team** | ✅ Complete | None |
| **Reviewer Phase 1** | ✅ Implemented | Follow-through docs and deferred product decisions only |

---

## Team Filters ✅ READY

Team filtering remains fully implemented and production-ready when team data is available.

### Implementation Status

| Layer | Status | Location |
|-------|--------|----------|
| Database Schema | ✅ Complete | `src/ado_git_repo_insights/persistence/models.py` |
| Data Extraction | ✅ Complete | Teams extracted with member counts |
| Backend Aggregation | ✅ Complete | `src/ado_git_repo_insights/transform/aggregators.py` |
| Dimensions Output | ✅ Complete | `aggregates/dimensions.json` contains teams array |
| Weekly Rollup Slices | ✅ Complete | `by_team` dict in each weekly rollup |
| UI Dropdown | ✅ Complete | `extension/ui/index.html` |
| Filter State | ✅ Complete | `extension/ui/modules/filters.ts` |
| Filter Logic | ✅ Complete | `extension/ui/modules/metrics.ts` |
| Feature Gating | ✅ Complete | Hidden when no teams available |
| Tests | ✅ Complete | `tests/unit/test_aggregators.py` and `extension/tests/` |

---

## Reviewer Filters ✅ PHASE 1 IMPLEMENTED

Reviewer filtering is now implemented across the stack for the ADO-first Phase 1 contract.

### Delivered Scope

| Layer | Status | Notes |
|-------|--------|-------|
| Database Schema | ✅ Existing | `reviewers` table reused; no runtime schema migration required |
| Deferred Schema Note | ✅ Added | `reviewed_at` explicitly deferred to Reviewer Phase 2 in `models.py` |
| Dimensions | ✅ Implemented | `dimensions.json` now supports `reviewers[]` |
| Backend Slices | ✅ Implemented | `by_reviewer` weekly rollup slices generated in `aggregators.py` |
| Rollup Schema | ✅ Implemented | Dedicated `ReviewerBreakdownEntry`, not generic `BreakdownEntry` |
| UI Dropdown | ✅ Implemented | Reviewer filter rendered in dashboard HTML |
| Filter State | ✅ Implemented | `reviewers` added to filter state and URL serialization |
| Filter Logic | ✅ Implemented | Reviewer-only aggregation supported in `applyFiltersToRollups()` |
| Tests | ✅ Implemented | Backend + schema + UI + integration coverage added |

### Reviewer Phase 1 Contract

Reviewer filtering now uses a dedicated activity-focused breakdown shape:

- `reviewed_prs`
- `reviews_count`
- `approval_rate`
- `authors_count`
- `repositories_count`

Phase 1 intentionally excludes:

- `cycle_time_p50`
- `cycle_time_p90`
- `review_time_p50`
- `review_time_p90`

Approval-rate semantics are fixed:

- `approval_rate = approved_prs / reviewed_prs`
- approval-equivalent for ADO Phase 1 is `vote == 10`
- denominator is distinct reviewed PRs, not raw review events

### Current UX Behavior

- Reviewer filtering works as a standalone dimension.
- If a reviewer filter is combined with repo or team filters, the dashboard currently sanitizes to reviewer-only behavior rather than inventing unsupported combined semantics.
- Reviewer mode updates the metric labels to reflect review activity rather than authored PR delivery.

### Remaining Reviewer Gaps

These are the only meaningful reviewer follow-through items left:

- Reviewer + repo combined semantics are still unresolved product work.
- Reviewer + team combined semantics are still unresolved product work.
- Review latency remains deferred until a persisted `reviewed_at` field exists and is backfilled.
- Reviewer dropdown scalability UX for very large reviewer sets is still open.

None of those block the current reviewer Phase 1 implementation.

---

## Deferred Reviewer Decisions

### Review Latency

Review latency is explicitly deferred to Reviewer Phase 2.

Prerequisites before implementation:

- add persisted `reviewed_at` to the review model
- update extraction to populate it reliably
- define migration / re-extraction guidance
- version the dashboard/schema additions deliberately

### Combined Filter Semantics

Still unresolved:

- reviewer + repo semantics
- reviewer + team semantics

Until those are decisioned, reviewer filters should remain a standalone exact dimension.

---

## Key Files Reference

### Backend
| Purpose | File |
|---------|------|
| Reviewer schema note | `src/ado_git_repo_insights/persistence/models.py` |
| Aggregators | `src/ado_git_repo_insights/transform/aggregators.py` |
| Aggregator Tests | `tests/unit/test_aggregators.py` |

### Frontend
| Purpose | File |
|---------|------|
| Dashboard HTML | `extension/ui/index.html` |
| Dashboard Logic | `extension/ui/dashboard.ts` |
| Filter State | `extension/ui/modules/filters.ts` |
| Filter Logic | `extension/ui/modules/metrics.ts` |
| Rollup Schema | `extension/ui/schemas/rollup.schema.ts` |
| Dimensions Schema | `extension/ui/schemas/dimensions.schema.ts` |

### Planning
| Purpose | File |
|---------|------|
| Reviewer blocker decisions | `specs/032-roadmap-blocker-resolution/spec.md` |
