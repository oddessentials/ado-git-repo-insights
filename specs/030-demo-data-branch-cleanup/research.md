# Research: Demo Data Realism & Branch Cleanup

**Date**: 2026-02-21
**Feature**: 030-demo-data-branch-cleanup

## R1: Demo Data Reviewer/Author Count Formulas

### Decision
Replace the flat `max(1, int(pr_count * ratio))` formulas with a distribution-based approach that produces credible counts bounded by team size and parent rollup values.

### Rationale
The current formula in `generate-demo-data.py` (lines 610-611, 637-638) uses:
- `authors_count = max(1, int(repo_pr_count * 0.3))`
- `reviewers_count = max(1, int(repo_pr_count * 0.45))`

With 23 repos sharing ~30-50 PRs/week, most repos get 1-3 PRs. `int(2 * 0.45) = 0`, clamped to 1. Evidence: across 7 sampled weeks, 85-100% of repos show `reviewers_count: 1`.

A credible formula should:
- Allow `reviewers_count: 1` for single-PR repos (realistic edge case)
- Produce `reviewers_count > 1` for repos with 2+ PRs (typical review duty rotation)
- Never exceed the parent rollup's count for the same week (invariant FR-003/SC-006)
- Scale with PR count but cap at team size or a reasonable maximum

### Alternatives Considered
1. **Hard floor of 2**: Rejected — dishonest for single-PR repos and can create sum > parent violations
2. **Proportional with higher ratio (0.8)**: Would produce larger numbers but still collapses to 1 for `int(1 * 0.8) = 0`
3. **`max(1, pr_count // 2 + 1)` stepped formula**: Better but still deterministic, no natural variation
4. **Distribution-based with seeded RNG**: Chosen — `rng.randint(low, high)` with bounds proportional to PR count and capped by team size. Produces natural variation while maintaining determinism via seed.

---

## R2: Commit Squash Strategy

### Decision
Use `git reset --soft main` + sequential recommits to avoid interactive rebase (which requires manual input). Squash 22 commits into 9 logical groups.

### Rationale
Interactive rebase (`git rebase -i`) is not supported in automated tooling (requires editor input). A soft reset preserves all changes in the index, allowing clean recommits with curated messages. The pre-squash tip is preserved as a tag before any history rewriting.

### Squash Groups (22 → 9)
| Group | Commits | Category | Message Focus |
|-------|---------|----------|---------------|
| 1 | 58a59cb | Feature | Cross-dimensional filter accuracy |
| 2 | 82da17a, 6fc0075 | Fix | Mypy type safety (isinstance guards) |
| 3 | b26c8af, 1816034 | Chore | Documentation & review config |
| 4 | 854cfda, 0b74251 | Fix | Zero-leakage guards & rollup hardening |
| 5 | 1514977, ea99b88 | Fix | Truncation fallback & team dedup |
| 6 | 6e589c6, f3f84c3 | Test | Coverage expansion & security |
| 7 | 88cd0ff, 8e81d87, a52ad7c | Fix | Cross-dim accuracy hardening & optimization |
| 8 | a312ae1, 66e5606, 67a5421 | Test+Fix | Coverage gaps & schema validation |
| 9 | ff23b69, e18fca4, 5474f0e, e436e04, a534e58 | Fix | Leakage guards, date slicing, UI indicators |

### Alternatives Considered
1. **Squash all into 1 commit**: Too aggressive, loses all development narrative
2. **Interactive rebase with fixup**: Requires interactive terminal input, incompatible with tooling
3. **Soft reset + recommit per group**: Chosen — fully scriptable, preserves logical grouping

---

## R3: Compiled Artifact Guard Strategy

### Decision
Add a pre-commit check in `.husky/pre-commit` that rejects staged `.js` files in `extension/ui/` (excluding `VSS.SDK.min.js` which is a vendored dependency). This is preferred over a `.gitignore` rule which could silently hide legitimate hand-written JS.

### Rationale
The existing pre-commit hook (201 lines in `.husky/pre-commit`) already has three sections: formatting checks, VSS SDK sync, and UI build automation. Adding a fourth section — a simple `git diff --cached --name-only` check for `extension/ui/*.js` files (excluding `VSS.SDK.min.js`) — fits naturally into the existing structure.

A blanket `.gitignore` rule for `extension/ui/*.js` would:
- Silently hide any future hand-written JS (vendor shims, quick prototypes)
- Be invisible to developers who don't check `.gitignore`
- Not provide an error message explaining why files are hidden

A pre-commit check:
- Provides a clear error message explaining what happened
- Can be bypassed with `--no-verify` in exceptional cases
- Is visible and auditable in the hook script
- Already has precedent in the existing hook structure

### Alternatives Considered
1. **Blanket `.gitignore`**: Rejected — silently hides future JS files with no error message
2. **CI-only check**: Would catch issues later, not at commit time. Pre-commit is better UX.
3. **Both `.gitignore` + pre-commit**: Over-engineering — the pre-commit check is sufficient
4. **ESLint rule**: Would only catch during lint runs, not at commit time

---

## R4: Pre-Squash Safety

### Decision
Create a tag `pre-squash/029-cross-dimensional-accuracy` pointing to the current branch tip before any history rewriting. Document the tag in the PR description.

### Rationale
Force-pushing rewritten history destroys the old remote branch state. If anyone has based work on the old commits, they need a reference point to reconcile. A tag is lighter than a backup branch and survives the force-push.

### Current branch state
- 22 commits, linear history, cleanly based on main
- No merge commits or other complications
- Remote branch exists at `origin/029-cross-dimensional-accuracy`

---

## R5: Rollup Invariant Preservation

### Decision
Add programmatic assertions to the test suite that validate all rollup invariants after regenerating demo data. These assertions run deterministically and prevent realism changes from breaking cross-dimensional accuracy work.

### Key Invariants
1. No breakdown entry's `reviewers_count` or `authors_count` exceeds its parent rollup's count
2. Cross-dim intersection `pr_count` sums equal the corresponding `by_team` entry total
3. Cross-dim intersection counts never exceed either the `by_team` or `by_repository` entry counts
4. All counts are non-negative integers
5. `authors_count <= pr_count` for every entry (can't have more authors than PRs)
6. `reviewers_count >= 1` for every entry with `pr_count >= 1` (every PR needs at least one reviewer)
