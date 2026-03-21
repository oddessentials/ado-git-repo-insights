# TODO Roadmap

> Generated: 2026-02-11 | Reviewed by: Architect, Planner, QA agents
> Post Feature 029 (cross-dimensional accuracy -- shipped)

## Remaining Features (Priority Order)

| # | Feature | TODO File | Size | Est. Days | Status | Hard Blockers |
|---|---------|-----------|------|-----------|--------|---------------|
| 1 | Author & Contributor Filters | AUTHOR_CONTRIBUTOR_FILTERS.md | M | 5-7 | Ready | None |
| 2 | Author x Repo Cross-Dim (T020/T021) | AUTHOR_CONTRIBUTOR_FILTERS.md (deferred section) | S | 2-3 | Blocked on #1 | Author slices must exist |
| 3 | Comments Pipeline Completion | COMMENTS.md | M-L | 6-10 | Ready (decisioned in `specs/032-roadmap-blocker-resolution/`) | None for Phases 1-2 |
| 4 | Reviewer Phase 2 / Combined Semantics Follow-Through | TEAM_REVIEWER_FILTERS.md | S-M | 2-4 | Partially ready | B-09, B-10 |
| 5 | GitHub Platform Support | GITHUB.md | XL | 12-18 | Explicitly deferred until #1-#4 complete (`specs/032-roadmap-blocker-resolution/`) | B-01, B-02, B-03 |

**Total estimated effort: 27-41 days (single engineer) | 20-27 days (two engineers)**

---

## Dependency Graph

```
  +--------------------------+     +--------------------------+
  |  #1 Author Filters       |     |  #3 Comments Pipeline    |
  |  5-7 days                |     |  6-10 days               |
  |  Blockers: none          |     |  Blockers: none          |
  |  CAN RUN IN PARALLEL <---+-----+---> CAN RUN IN PARALLEL  |
  +------------+-------------+     +------------+-------------+
               |                                |
               | unlocks                        | validates threading model
               v                                |
  +--------------------------+                  |
  |  #2 Author x Repo        |                  |
  |  Cross-Dim (T020/T021)   |                  |
  |  2-3 days                |                  |
  |  Blocked on: #1 Phase 1  |                  |
  +------------+-------------+                  |
               |                                |
               |         +---------------------+
               |                               |
               v                               v
  +--------------------------+     +--------------------------+
  |  #4 Reviewer Follow-Through |  |                          |
  |  2-4 days                |     |                          |
  |  Blocked on decisions     |     |                          |
  +------------+-------------+     +--------------------------+
               |
               v
  +-----------------------------------------------------+
  |              #5 GitHub Platform Support               |
  |              12-18 days                              |
  |              BLOCKED ON: all of the above            |
  +-----------------------------------------------------+
```

**Critical path: 25-35 working days** (Author Filters -> Author x Repo -> Comments -> Reviewer follow-through -> GitHub)

---

## Parallel Execution Strategy

### Two Engineers (Recommended -- 44% time reduction)

```
Engineer A                            Engineer B
-------------------------------------+--------------------------------------
Week 1-2:  #1 Author Filters (5-7d)  | Week 1-2:  #3 Comments Pipeline (6-10d)
Week 2-3:  #2 Author x Repo (2-3d)   | Week 2-3:  #3 Comments follow-through
Week 3-4:  #4 Reviewer follow-through | Week 3-4:  parallel polish / integration
Week 5-8:  #5 GitHub 5.1-5.3 (4-6d)  | Week 5-8:  #5 GitHub 5.4-5.5 (4-6d)
-------------------------------------+--------------------------------------
Total: ~20-27 days
```

### Single Engineer

```
Week 1-2:   #1 Author Filters              [5-7 days]
Week 2-3:   #2 Author x Repo Cross-Dim     [2-3 days]
Week 3-5:   #3 Comments Pipeline           [6-10 days]
Week 5-6:   #4 Reviewer Follow-Through     [2-4 days]
Week 6-10:  #5 GitHub Platform             [12-18 days]
                                            ----------
Total:                                      27-41 days
```

---

## Blocker Register

### CRITICAL (prevents implementation from starting)

| ID | Feature | Blocker | Resolution |
|----|---------|---------|------------|
| B-01 | GitHub | All prior TODOs must complete first (~18-25 days) | Complete dependency chain |
| B-02 | GitHub | Invariant 15 (org/project scoping) needs formal amendment -- GitHub has no "project" concept | Architecture design document |
| B-03 | GitHub | Search API 1,000-result cap chunking algorithm not designed | Algorithm specification |

### HIGH (prevents specific tasks within a feature)

| ID | Feature | Blocker | Resolution |
|----|---------|---------|------------|
| B-04 | Reviewer Filters | "Avg Time to Review" requires `reviewed_at` timestamp -- column missing from `reviewers` table | Resolved in Phase 1: defer review latency to Reviewer Phase 2 until schema/storage add `reviewed_at` (`specs/032-roadmap-blocker-resolution/`) |
| B-05 | Reviewer Filters | "Approval Rate" has no formula definition | Resolved in Phase 1: `approved_prs / reviewed_prs` using final stored reviewer outcome per PR (`specs/032-roadmap-blocker-resolution/`) |
| B-06 | Reviewer Filters | `BreakdownEntry` type incompatible with reviewer metrics (cycle_time N/A, new `reviews_count` field) | Resolved in Phase 1: introduce dedicated `ReviewerBreakdownEntry` (`specs/032-roadmap-blocker-resolution/`) |

### MEDIUM (prevents test writing for specific scenarios)

| ID | Feature | Blocker | Resolution |
|----|---------|---------|------------|
| B-07 | Author Filters | Author + Team combined filter semantics undefined (intersection or union?) | Product decision before frontend tests |
| B-08 | Author Filters | Scalability UX for 200+ authors (search/autocomplete vs multi-select) | UX design decision |
| B-09 | Reviewer Filters | Reviewer + Repo combined filter semantics undefined | Open follow-through task after Reviewer Phase 1 |
| B-10 | Reviewer Filters | Multi-reviewer overlap not explicitly addressed (PR appears in all reviewer slices) | Document as intentional follow-through |
| B-11 | Comments | Dashboard visualization has no spec (metrics, layout, chart types) | Resolved: metrics-first comments dashboard contract defined in `specs/032-roadmap-blocker-resolution/` |
| B-12 | Comments | Phase 3 (sentiment, engagement) is research, not implementation -- should be a separate TODO | Reclassify or remove |
| B-13 | GitHub | Vote mapping (CHANGES_REQUESTED -> -5 vs -10) is a product decision | User validation |
| B-14 | GitHub | GraphQL vs REST extraction strategy not finalized | Resolved for v1: REST-first, GraphQL deferred; implementation still last (`specs/032-roadmap-blocker-resolution/`) |

---

## Feature Details

### #1 Author & Contributor Filters (Priority: HIGHEST)

**Why first:** Highest code reuse ratio (near-copy of team filter pattern), all data already exists (`pull_requests.user_id`, `users` table, `dimensions.json:users[]`), unlocks deferred cross-dim work (T020/T021), smaller scope than reviewer filters.

**Phases:**
1. Backend `_generate_author_slice()` -- group PRs by `user_id`, compute per-author metrics (2-3 days)
2. Frontend: rollup schema + filter state + UI dropdown + dashboard wiring (2-3 days)
3. Testing: Jest + integration (1 day)

**Key patterns to reuse:**
- `_generate_team_slice()` at `aggregators.py:624-690` -- nearly identical groupby
- `FilterState.teams` pattern for `FilterState.authors`
- Team dropdown HTML/wiring pattern

**QA flags:**
- Author + Team combined filter semantics need product decision (B-07)
- Missing formal acceptance criteria -- recommend adding before implementation
- Scalability UX decision needed for 200+ authors (B-08)

---

### #2 Author x Repo Cross-Dimensional (T020/T021)

**Why third (after #1):** Blocked on author slices existing. Pattern is 100% established from Feature 029's `_generate_team_repo_slice()`. Only 2 tasks, well-scoped, 2-3 days.

**Tasks:**
- T020: `_generate_author_repo_slice()` in aggregators.py -- change `team_name` to `user_id` in groupby
- T021: Add `by_author_and_repo` to frontend types, KNOWN_ROOT_FIELDS, validateNestedBreakdown(), exact lookup branch

**Verification:** `sum(by_author_and_repo[A][*].pr_count) == by_author[A].pr_count`

---

### #3 Comments Pipeline Completion (Priority: MEDIUM)

**Why fourth:** Backend is fully complete (DB schema, API client, extraction, CLI) but delivers zero user value -- no CSV export, no dashboard visualization. Must validate ADO threading model end-to-end before GitHub's 3-endpoint comment model.

**Phases:**
1. Data pipeline: CSV export + JSON aggregations + coverage tracking (1-2 days)
2. Dashboard integration: TypeScript types + comment stats panel (2-3 days)
3. CLI documentation: Document --include-comments flags (0.5 days)

**Phase 3 (sentiment, engagement scoring) should be deferred to a separate TODO -- these are research tasks, not implementation.**

**QA flags:**
- B-11 resolved: comments Phase 1 is metrics-first (summary cards, trend, repo breakdown, coverage/capped state)
- Forward-compatibility risk: ADO thread resolution status model may need redesign for GitHub

---

### #4 Reviewer Phase 2 / Combined Semantics Follow-Through (Priority: LOW)

**Why fourth:** Reviewer Phase 1 is already implemented. What remains is cleanup and product follow-through, not foundational feature work.

Remaining items:
1. decide reviewer + repo combined semantics
2. decide reviewer + team combined semantics
3. document multi-reviewer overlap explicitly
4. optionally design reviewer dropdown scalability improvements
5. defer review-latency work until `reviewed_at` is a real persisted field

This is intentionally smaller than the original reviewer implementation tranche.

---

### #5 GitHub Platform Support (Priority: LOWEST -- do last)

**Why last:**
1. Every feature added after GitHub ships requires dual-platform testing (doubles ongoing cost)
2. Provider abstraction protocol benefits from knowing all filter dimensions first
3. Vote normalization should be validated with ADO data before GitHub's different model
4. Comment threading model should be proven end-to-end before GitHub's 3-endpoint model
5. Schema stability should be achieved before introducing a second data source

**Phases:**
1. Provider abstraction: `GitPlatformClient` protocol + NormalizedPR dataclasses (2-3 days)
2. GitHub client: REST/GraphQL + pagination + auth + rate limiting + Search API chunking (3-4 days)
3. Config and CLI: `--source ado|github` flag, factory pattern (1-2 days)
4. Testing: ~120-180 new Python tests, ~30-50 TypeScript tests (3-4 days)
5. Documentation: README, config examples, migration guide (1-2 days)

**Key risks:**
- Search API 1,000-result cap (HIGH) -- forces time-window subdivision
- Issue ID vs PR number identity confusion (HIGH) -- corrupts UPSERT convergence if wrong ID used
- Invariant 15: GitHub has no "project" concept (HIGH) -- requires formal invariant amendment
- Dual-platform maintenance burden (MEDIUM-HIGH) -- every future change needs both-platform testing

**ADO vendor lock-in is isolated to 6 files** (confirmed by codebase audit):
- `ado_client.py`, `pr_extractor.py`, `pagination.py`, `config.py`, `cli.py`, `repository.py`

**Vendor-agnostic components** (no changes needed):
- `aggregators.py` (pure SQL on generic schema)
- `csv_generator.py` (downstream of DB)
- All dashboard TypeScript (works on JSON structures, no platform awareness)

---

## Deleted TODOs (Feature Complete)

| File | Reason | Date |
|------|--------|------|
| CROSS-DIMENSIONAL-ACCURACY.md | All 5 phases implemented, tested, and shipped in Feature 029. Team x repo cross-dimensional breakdowns complete. Author x repo (US3) properly deferred to AUTHOR_CONTRIBUTOR_FILTERS.md tasks T020/T021. | 2026-02-11 |
| GITHUB_MARKET_RESEARCH.md | All corrections incorporated into GITHUB.md (rate limits, native capabilities, competitive landscape, PAT permissions, comment threading, Search API cap, pricing). Served as verification artifact. | 2026-02-11 |

---

## Key Files Reference (Cross-Feature)

### Backend (Python) -- touched by multiple features

| File | Features |
|------|----------|
| `src/.../transform/aggregators.py` | #1, #2, #3, #4 |
| `src/.../persistence/models.py` | #3 (CSV schemas), #4 (`reviewed_at` Phase 2 note) |
| `src/.../transform/csv_generator.py` | #3 |
| `src/.../extractor/ado_client.py` | #5 (refactor to protocol) |
| `src/.../cli.py` | #4 (docs), #5 (--source flag) |
| `scripts/generate-synthetic-dataset.py` | #1, #3 |
| `tests/unit/test_aggregators.py` | #1, #2, #4 |

### Frontend (TypeScript) -- touched by multiple features

| File | Features |
|------|----------|
| `extension/ui/modules/metrics.ts` | #1, #2, #4 |
| `extension/ui/modules/filters.ts` | #1, #4 |
| `extension/ui/schemas/rollup.schema.ts` | #1, #2, #4 |
| `extension/ui/dataset-loader.ts` | #1, #2, #4 |
| `extension/ui/index.html` | #1, #3, #4 |

### Merge Conflict Risk

Features #1 (Author) and #4 (Reviewer follow-through) still touch overlapping files (`aggregators.py`, `metrics.ts`, `rollup.schema.ts`, `filters.ts`). Coordinate if parallelized.

---

## Test Pattern Reuse Summary

| Pattern | Source | Reusable By |
|---------|--------|-------------|
| `_generate_*_slice()` groupby testing | `test_aggregators.py:TestTeamSlicing` | #1, #4 |
| Cross-dim consistency invariant | `test_aggregators.py:TestTeamRepoSlicing:1724` | #3 |
| Truncation + min sample size guards | `test_aggregators.py:1826-1929` | #3 |
| Performance gate (30s budget) | `test_aggregators.py:2181` | #1, #4, #5 |
| API client mocking | `test_comments_extraction.py` | #5 |
| CSV schema contract | `test_csv_contract.py` | #4 |
| FilterState URL serialization | `filters.test.ts:71-80` | #1, #4 |
| Cross-dim exact lookup tests | `metrics.test.ts:982-1294` | #3 |
| Legacy backward compatibility | `extension/tests/fixtures/legacy-datasets/` | All |
| Cross-stack round-trip | `synthetic-fixtures.test.ts` | #3, #5 |
