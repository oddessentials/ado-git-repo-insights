# TODO Roadmap

> Last reviewed: 2026-03-21
> Roadmap closure is tracked through `specs/034-roadmap-closure/` and its checked-in evidence pack.

## Closure Status

| Item | Status | Evidence |
|------|--------|----------|
| Author filter | Closed | `specs/034-roadmap-closure/evidence/001-author-filters-evidence.md` |
| Author x repository | Closed | `specs/034-roadmap-closure/evidence/002-author-repo-evidence.md` |
| Comments completion | Closed | `specs/034-roadmap-closure/evidence/003-comments-evidence.md` |
| Reviewer follow-through | Closed | `specs/034-roadmap-closure/evidence/004-reviewer-followthrough-evidence.md` |
| Final roadmap verification | In progress until final verification command set is complete | `specs/034-roadmap-closure/evidence/005-roadmap-finalization-evidence.md` |

## Resolved Roadmap Decisions

- Author + team is constrained and author-dominant.
- Reviewer + repository is constrained.
- Reviewer + team is disallowed with explicit UX signaling.
- Comments remain auxiliary and do not mutate the core PowerBI CSV contract.
- Review latency remains explicit future work until persisted `reviewed_at` exists.

## Post-Roadmap Work

These items are not blockers for roadmap closure:

- review latency / `reviewed_at` implementation
- advanced comments analytics such as sentiment or engagement scoring
- optional reviewer scalability UX improvements
