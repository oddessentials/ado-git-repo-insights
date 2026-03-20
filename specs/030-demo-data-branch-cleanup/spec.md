# Feature Specification: Demo Data Realism & Branch Cleanup

**Feature Branch**: `030-demo-data-branch-cleanup`
**Target Branch**: `029-cross-dimensional-accuracy` (cleanup before merge)
**Created**: 2026-02-21
**Status**: Draft
**Input**: User description: "Fix demo data realism, squash branch commits, and remove accidental compiled artifact"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Credible Filtered Dashboard Metrics (Priority: P1)

A prospective user or stakeholder opens the demo dashboard and filters by a single repository or team. The summary cards show credible metric counts — reviewer and author numbers that reflect how a real engineering team operates. The dashboard tells a believable story about team activity regardless of which filter combination is applied. A single-PR repo might plausibly show 1 reviewer, but the overall distribution across repos and weeks avoids the current pathology where nearly every filtered view shows exactly 1.

**Why this priority**: This is the original mission of the cross-dimensional accuracy branch. The current demo shows "1 Active Reviewer" for 85-100% of repos in every sampled week, which makes the product look broken. This is the highest-value fix because it directly impacts how the product is perceived by evaluators.

**Independent Test**: Can be tested both visually (open the demo dashboard, filter by several repos, confirm counts look credible) and programmatically (run the generator, assert JSON properties across all weeks/repos/teams). The programmatic assertions prevent realism from drifting when the generator changes.

**Acceptance Scenarios**:

1. **Given** the demo dashboard is loaded with generated data, **When** a user filters by any single repository that has 2+ PRs in a week, **Then** the "Active Reviewers" count is greater than 1 for that week.
2. **Given** the demo dashboard is loaded, **When** a user filters by any single team, **Then** the "Active Reviewers" count reflects a credible proportion of team activity (not uniformly 1 for teams with multiple PRs).
3. **Given** the demo dashboard is loaded with no filters, **When** a user views the summary cards, **Then** the total reviewer and author counts remain unchanged from their current correct values.
4. **Given** the demo data spans 5 years, **When** a user scrolls through the sparkline charts with a repo filter applied, **Then** the reviewer/author trend lines show variation across weeks (not a flat line at 1).
5. **Given** any breakdown entry (by_repository, by_team, by_team_and_repo), **When** its counts are compared to the parent rollup, **Then** no slice's reviewer or author count exceeds the parent rollup's count for that same week.

---

### User Story 2 - Clean Merge-Ready Commit History (Priority: P2)

A maintainer reviewing the pull request for branch 029 sees a clean, logical commit history. Related changes are grouped together, self-inflicted regression fixes are folded into the commits that introduced the bugs, and the history tells a coherent story of the feature's development. The commit count is reduced from 22 to a manageable number of logical units. The pre-squash state is preserved as a tag or backup branch so no work is lost.

**Why this priority**: A clean history makes the PR reviewable, supports future `git bisect`, and demonstrates engineering discipline. However, it doesn't affect end-user experience, so it ranks below the demo data fix.

**Independent Test**: Can be verified by running `git log --oneline main..HEAD` on the 029 branch and confirming that commits are logically grouped, no commit fixes a bug introduced by an earlier commit on the same branch, and the total count is significantly reduced.

**Acceptance Scenarios**:

1. **Given** the 029 branch has 22+ commits, **When** squashing is complete, **Then** the commit count is reduced to 10 or fewer logical units.
2. **Given** the squashed history, **When** a reviewer reads the commit log, **Then** each commit represents a coherent, independently meaningful change (no "fix the fix" chains).
3. **Given** the squashed history, **When** all pre-push quality gates are run, **Then** all tests pass (968+ Python, 1583+ JS, 4 Playwright smoke tests, mypy, ruff).
4. **Given** the pre-squash branch tip, **When** squashing is about to begin, **Then** the pre-squash tip is preserved as a tag or backup branch (e.g., `029-cross-dimensional-accuracy-pre-squash`) so the original history can be recovered if needed.
5. **Given** the squash is complete, **When** `git diff main..HEAD` is compared to the pre-squash diff, **Then** the diff hashes match for all tracked source files (excluding generated outputs whose content may differ due to rebuild timing).

---

### User Story 3 - No Compiled Artifacts in Source Control (Priority: P3)

The repository does not contain compiled/bundled JavaScript files in source-controlled directories meant for TypeScript source. The accidental `extension/ui/dashboard.js` (5,719 lines of compiled output) is removed. A guard prevents it from being re-committed — either via a pre-commit check or a CI validation step, rather than a blanket `.gitignore` rule that could hide legitimate hand-written JS files in the future.

**Why this priority**: This is a hygiene issue. The compiled file inflates diffs, confuses contributors about what to edit, and wastes review time. Lower priority because it doesn't affect runtime behavior.

**Independent Test**: Can be verified by confirming `extension/ui/dashboard.js` does not exist in the repository and that a pre-commit or CI check rejects any attempt to commit `.js` files to `extension/ui/`.

**Acceptance Scenarios**:

1. **Given** the current branch has `extension/ui/dashboard.js` committed, **When** the cleanup is complete, **Then** the file is removed from the repository.
2. **Given** `extension/ui/dashboard.js` is removed, **When** a developer runs the UI build, **Then** the compiled output goes to `extension/dist/ui/` (not `extension/ui/`) and the source directory stays clean.
3. **Given** a guard is in place, **When** a developer accidentally stages a `.js` file in `extension/ui/`, **Then** the pre-commit hook or CI check flags it with a clear error message explaining that compiled output belongs in `extension/dist/ui/`.
4. **Given** a developer adds a legitimate hand-written `.js` file to `extension/ui/` in the future, **When** they need to commit it, **Then** the guard mechanism provides a way to explicitly allow it (e.g., adding it to an allowlist) rather than silently hiding it.

---

### Edge Cases

- What happens when a repo has exactly 1 PR in a week? A `reviewers_count` of 1 is valid in this case — a single PR may only have one reviewer. The realism fix should ensure this is the exception (matching its natural rarity), not the universal default.
- What happens when the sum of breakdown `reviewers_count` across repos exceeds the rollup total? This is valid — the same reviewer can review PRs in multiple repos, so counts are non-additive. But individual slices must never exceed their parent rollup's count.
- What happens when squashing commits that touched the same file? The squash preserves the final state. Verification compares tracked-file diff hashes, not byte-for-byte `git diff` output (which can differ due to line endings, file modes, or JSON formatting in generated files).
- What happens to the existing remote branch after squashing? The remote is force-pushed. The pre-squash tip is preserved as a tag or backup branch. The PR description documents the rebase.
- What happens if someone has based work off branch 029? The backup tag allows them to reconcile. This risk is mitigated by preserving the pre-squash history and documenting the force-push in the PR.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The demo data generator MUST produce credible `reviewers_count` values for breakdown entries: at least 1 for any entry with activity, and distributed such that repos/teams with 2+ PRs typically (but not always) show more than 1 reviewer. The distribution should be proportional to PR count and bounded by team size.
- **FR-002**: The demo data generator MUST produce `authors_count` values that scale proportionally with PR count but never drop below 1 for entries with activity, and never exceed the PR count for that entry.
- **FR-003**: All breakdown slices MUST remain internally consistent with their parent rollup: no breakdown entry's `reviewers_count` or `authors_count` may exceed the parent rollup's count for the same week. Cross-dimensional intersections (`by_team_and_repo`) must not exceed either the corresponding `by_team` or `by_repository` entry's counts.
- **FR-004**: The commit history on branch 029 MUST be squashed into logically grouped commits where no commit fixes a bug introduced by an earlier commit on the same branch.
- **FR-005**: The squashed history MUST preserve the final code state. Verification: compute a diff hash of all tracked source files against main before and after squashing — the hashes must match (excluding generated outputs that may be rebuilt).
- **FR-006**: The file `extension/ui/dashboard.js` MUST be removed from version control.
- **FR-007**: A guard MUST prevent compiled `.js` files from being committed to `extension/ui/`. This guard should be a pre-commit check or CI validation (not a blanket `.gitignore`) so that legitimate hand-written JS files can be explicitly allowed if needed in the future.
- **FR-008**: All existing quality gates MUST pass after all changes are applied (pytest, jest, Playwright, mypy, ruff, baseline integrity, bundle parity).
- **FR-009**: The pre-squash branch tip MUST be preserved as a tag or backup branch before any history rewriting begins.
- **FR-010**: A deterministic generator run MUST produce a dataset that passes programmatic assertions validating realism invariants (e.g., property tests over all repos/teams/weeks checking count distributions), not just visual inspection.

### Key Entities

- **Weekly Rollup**: Contains `pr_count`, `authors_count`, `reviewers_count`, and breakdown entries (`by_repository`, `by_team`, `by_team_and_repo`). Each breakdown entry mirrors these same fields for a filtered slice. Rollup counts are the ceiling — no child slice may exceed them.
- **Breakdown Entry**: A metrics slice for a specific repository, team, or team-repo intersection. Must have credible `authors_count` and `reviewers_count` relative to its `pr_count`, bounded by the parent rollup and team/repo size.
- **Demo Dataset**: Generated JSON files in `docs/data/aggregates/weekly_rollups/` that power the public demo dashboard. Must present a credible view of engineering team activity and pass programmatic realism assertions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Across all generated weekly rollup files, fewer than 20% of breakdown entries with 2+ PRs show `reviewers_count` of exactly 1 (currently 85-100%). The distribution should look natural — some 1s are fine, but they should be the minority.
- **SC-002**: The commit count on branch 029 is reduced from 22+ to 10 or fewer logically grouped commits.
- **SC-003**: A tracked-file diff hash computed against main is identical before and after squashing, confirming no unintended code changes. Generated outputs (JSON data, compiled bundles) may differ and are excluded from the hash comparison.
- **SC-004**: All quality gates pass: 968+ Python tests, 1583+ JS tests, 4 Playwright smoke tests, mypy clean, ruff clean, bundle parity verified.
- **SC-005**: `extension/ui/dashboard.js` is absent from the repository, and a pre-commit or CI check prevents re-introduction.
- **SC-006**: No breakdown entry in the generated dataset has `reviewers_count` or `authors_count` exceeding its parent rollup's value for the same week. Programmatic assertions verify this invariant across all weeks.
- **SC-007**: The pre-squash branch tip is preserved and reachable (via tag or backup branch) after the force-push.

## Assumptions

- The demo data fix targets `scripts/generate-demo-data.py`, which is the generator used for the public demo site dataset. The separate `scripts/generate-synthetic-dataset.py` (used for performance testing) is out of scope.
- The squash will happen on branch 029 via soft reset and recommit (not interactive rebase, to avoid interactive prompts). The remote branch will need a force-push after squashing.
- `reviewers_count` counts reviewers specifically (people who reviewed PRs), not all participants. The author is counted separately in `authors_count`. The UI card label "Active Reviewers" is correct as-is.
- The scope-creep changes (CLI, ML, CI modifications in commit 88cd0ff) will remain in the branch as-is per user decision.
- The pre-commit hook infrastructure already exists (`.husky/pre-commit`) and can be extended with an additional check for `extension/ui/*.js` files.
