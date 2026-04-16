# Author & Contributor Filter Implementation Status

> Status snapshot. For verification timing, see the git history of this file
> rather than a duplicated date here.

## Summary

| Scope | Status | Notes |
|-------|--------|-------|
| Author filter | Complete | Canonical `user_id` identity and searchable single-select UX are shipped |
| Author + team | Complete | Locked constrained mode: author metrics win while team state remains visible |
| Author + repository | Complete | Exact bounded support with deterministic truncation and fallback |

## Delivered

- Weekly rollups include additive `by_author` and bounded `by_author_and_repo` slices.
- Author identity is keyed by canonical immutable `user_id`.
- Dashboard supports searchable single-select author filtering with URL-backed state.
- Author + team behavior is explicitly constrained and signaled in the UI.
- Author + repository uses exact nested lookup when available.

## Verification

- Backend aggregation, determinism, and contract tests cover author slicing and author x repository behavior.
- Extension schema, metrics, and dashboard tests cover author filter state, exactness, and constrained behavior.
- Closure evidence is tracked in `specs/034-roadmap-closure/evidence/001-author-filters-evidence.md` and `specs/034-roadmap-closure/evidence/002-author-repo-evidence.md`.

## Post-Roadmap

- No open author-filter work remains in the roadmap.
- Future author enhancements should be treated as new product work, not roadmap blockers.
