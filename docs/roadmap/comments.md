# PR Comment Collection Feature - Implementation Status

> Status snapshot. For verification timing, see the git history of this file
> rather than a duplicated date here.

## Summary

| Scope | Status | Notes |
|-------|--------|-------|
| Extraction and storage | Complete | Comments remain opt-in via `--include-comments` |
| Auxiliary CSV export | Complete | Written only to `csv-output/auxiliary/comments/` |
| Coverage signaling | Complete | Manifest and loader support `disabled`, `full`, and `partial` with capped state |
| Dashboard/operator messaging | Complete | Coverage is surfaced in dashboard run info and filter-bar messaging |

## Delivered

- SQLite-backed comment extraction persists capped-state metadata for deterministic coverage reporting.
- Auxiliary comment CSVs are emitted only under:
  - `csv-output/auxiliary/comments/pr_threads.csv`
  - `csv-output/auxiliary/comments/pr_comments.csv`
- Manifest capability and coverage metadata expose comment availability without changing the core PowerBI CSV contract.
- Dashboard surfaces comments coverage status and whether extraction was capped.
- CLI documentation covers `--include-comments`, `--comments-max-prs-per-run`, and `--comments-max-threads-per-pr`.

## Contract Boundary

- Comments remain auxiliary for roadmap closure.
- No core PowerBI-facing CSV schema, header, or column-order changes are allowed for this feature.

## Post-Roadmap

The following remain future work, not roadmap blockers:

- raw thread browsing or full-text comment search
- sentiment analysis
- engagement scoring
- advanced comment analytics beyond the shipped coverage/availability surfaces

## Verification

- Backend tests cover auxiliary-path placement, determinism, coverage-state persistence, and aggregate behavior.
- Extension tests cover manifest validation and dashboard coverage messaging.
- Closure evidence is tracked in `specs/034-roadmap-closure/evidence/003-comments-evidence.md`.
