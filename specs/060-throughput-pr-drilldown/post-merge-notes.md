# Post-merge follow-ups for 060

Items to handle when this branch merges to `main`. Not part of the spec contract; coordination notes only.

## Issue #182 — comment visualization (forward reference already posted)

A forward-reference comment was posted on #182 during Pass 4 hardening (https://github.com/oddessentials/ado-git-repo-insights/issues/182#issuecomment-4281577590). On merge, post a short follow-up that converts the "not yet merged" forward-reference into a concrete shipped-pattern reference.

**Suggested follow-up text (post on #182 after merge):**

> 060 merged as commit `<MERGE_COMMIT_SHA>` (PR #<PR_NUMBER>). The PR-level-detail pattern, privacy posture, and unsupported-filter predicate referenced above are now on `main` at:
> - `extension/ui/modules/shared/detail-panel.ts` — `PrListSection` variant with four-state `contentState` discriminant
> - `extension/ui/modules/drilldown/filter-support.ts` — `classifyFilterState` predicate (FR-024 locked precedence)
> - `docs/reference/dataset-contract.md` — privacy posture section (FR-014)
> - `scripts/strip_pr_arrays.py` (or wherever the FR-023 helper lands) — strip-at-publish gate
>
> A future #182 slice can import or extend these as needed. No #300 deferred item is a blocker either way.

(Replace `<MERGE_COMMIT_SHA>`, `<PR_NUMBER>`, and the actual file path for the FR-023 helper with the real values from the merged branch.)

## Issue #300 — Phase 2 deferred-items tracker

User decision earlier in this branch's planning session was to keep #300 open and add the WSJF priority grid to its body. The grid edit was deferred until "spec text is stable." The spec is now hardened through 4 passes plus the Codex-caught truncation-contract fix; if the user agrees the spec is stable, the grid edit can be applied at any time and is independent of merge.

**Suggested grid (drafted earlier in the session, ready to paste at the bottom of #300's body):**

```markdown
## Priority grid (WSJF — user value ÷ size)

| Deferred item | User value | Size | Notes |
|---|---|---|---|
| PR-level detail in rollups | HIGH | L–XL | Owner principle: "every data point is an entry point into an explanation" (#205 comment 2026-03-29). Pipeline + schema + all rollup consumers. **First slice delivered by 060** (throughput, 5 fields, 4 supported filter states). |
| Cross-dim aggregates (reviewer×repo, per-week distribution) | MED | L | Enables richer drill-down tables; marginal standalone. |
| Advanced a11y / SR narration beyond Tab/Enter/Esc | MED | S–M | WCAG hardening above Phase 1 baseline. |
| Bucket exploration (distribution click) | LOW | M | Owner-flagged lowest priority in #205; static percentages likely suffice. |
| Comparison-mode drill-down | LOW | L | Phase 1 "disabled + cue" already clean UX; preserved unchanged by 060. |
| URL-bookmarkable drill-down state | LOW | M | No user complaint; ephemeral state works. |
| Drag-zoom on cycle-time trend | LOW | M–L | Overlaps with global date-range filter. |
```

Also at merge time: post a separate "first slice delivered" comment on #300 noting which row of the grid 060 addresses (the PR-level-detail row, partially) and which deferrals are now explicitly tracked in 060's own Out-of-Scope section (team-filter PR support, reviewer-filter PR support, cycle-time / reviewer / sparkline PR detail, comparison-mode PR detail, URL-bookmarkable, CSV/PowerBI PR detail, PR-record field expansion).
