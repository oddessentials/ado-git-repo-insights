# Team & Reviewer Filter Implementation Status

> Status snapshot. For verification timing, see the git history of this file
> rather than a duplicated date here.

## Summary

| Scope | Status | Notes |
|-------|--------|-------|
| Team filter | Complete | No remaining roadmap work |
| Reviewer filter | Complete for roadmap scope | Combination behavior is locked and shipped |

## Reviewer Contract

Reviewer filtering is complete for the roadmap-closure contract with these locked behaviors:

- reviewer-only: exact single-reviewer activity filtering
- reviewer + repository: `constrained`
- reviewer + team: `disallowed-with-ux-signal`

No reviewer combination uses proportional fallback.

## Delivered

- Reviewer activity uses dedicated `by_reviewer` slices with `reviewed_prs`, `reviews_count`, `approval_rate`, `authors_count`, and `repositories_count`.
- Reviewer + repository keeps repository state visible but computes reviewer-only metrics.
- Reviewer + team is blocked in the UI with explicit signaling and deterministic team-state cleanup.
- Reviewer metric labels continue to reflect review activity rather than authored PR delivery.

## Explicitly Deferred

Review latency remains out of scope until a real persisted `reviewed_at` field exists and is backfilled. Reviewer dropdown scalability improvements are also future enhancement work, not roadmap blockers.

## Verification

- Extension metrics tests cover reviewer-only and constrained combined behavior.
- Closure evidence is tracked in `specs/034-roadmap-closure/evidence/004-reviewer-followthrough-evidence.md`.
