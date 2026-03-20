# TODO Roadmap

> Generated: 2026-02-11 | Reviewed by: Architect, Planner, QA agents
> Post Feature 029 (cross-dimensional accuracy -- shipped)

## Remaining Features (Priority Order)

| # | Feature | TODO File | Size | Est. Days | Status | Hard Blockers |
|---|---------|-----------|------|-----------|--------|---------------|
| 1 | Author & Contributor Filters | AUTHOR_CONTRIBUTOR_FILTERS.md | M | 5-7 | Ready | None |
| 2 | Reviewer Filters | TEAM_REVIEWER_FILTERS.md (reviewer section) | L | 7-9 | Ready (partial) | B-04, B-05, B-06 |
| 3 | Author x Repo Cross-Dim (T020/T021) | AUTHOR_CONTRIBUTOR_FILTERS.md (deferred section) | S | 2-3 | Blocked on #1 | Author slices must exist |
| 4 | Comments Pipeline Completion | COMMENTS.md | M-L | 6-10 | Ready | None for Phases 1-2 |
| 5 | GitHub Platform Support | GITHUB.md | XL | 12-18 | Blocked on all above | B-01, B-02, B-03 |

**Total estimated effort: 32-47 days (single engineer) | 24-30 days (two engineers)**

---

## Dependency Graph

```
  +--------------------------+     +--------------------------+
  |  #1 Author Filters       |     |  #2 Reviewer Filters     |
  |  5-7 days                |     |  7-9 days                |
  |  Blockers: none          |     |  Blockers: B-04,B-05,B-06|
  |  CAN RUN IN PARALLEL <---+-----+---> CAN RUN IN PARALLEL  |
  +------------+-------------+     +------------+-------------+
               |                                |
               | unlocks                        | validates vote model
               v                                |
  +--------------------------+                  |
  |  #3 Author x Repo        |                  |
  |  Cross-Dim (T020/T021)   |                  |
  |  2-3 days                |                  |
  |  Blocked on: #1 Phase 1  |                  |
  +------------+-------------+                  |
               |                                |
               |         +---------------------+
               |         |
               |         |     +--------------------------+
               |         |     |  #4 Comments Pipeline     |
               |         |     |  6-10 days                |
               |         |     |  Blockers: none (Ph 1-2)  |
               |         |     |  CAN RUN IN PARALLEL      |
               |         |     |  with #1 and #2           |
               |         |     +------------+-------------+
               |         |                  |
               |         |                  | validates threading model
               v         v                  v
  +-----------------------------------------------------+
  |              #5 GitHub Platform Support               |
  |              12-18 days                              |
  |              BLOCKED ON: all of the above            |
  +-----------------------------------------------------+
```

**Critical path: 27-39 working days** (Author Filters -> Reviewer Filters -> Comments -> GitHub)

---

## Parallel Execution Strategy

### Two Engineers (Recommended -- 44% time reduction)

```
Engineer A                            Engineer B
-------------------------------------+--------------------------------------
Week 1-2:  #1 Author Filters (5-7d)  | Week 1-2:  #4 Comments Pipeline (6-10d)
Week 2-3:  #3 Author x Repo (2-3d)   | Week 2-3:  [available]
Week 3-5:  #2 Reviewer Filters (7-9d) | Week 3-5:  #5 GitHub 5.1 (2-3d)
Week 5-8:  #5 GitHub 5.2-5.3 (4-6d)  | Week 5-8:  #5 GitHub 5.4-5.5 (4-6d)
-------------------------------------+--------------------------------------
Total: ~24-30 days
```

### Single Engineer

```
Week 1-2:   #1 Author Filters              [5-7 days]
Week 2-3:   #3 Author x Repo Cross-Dim     [2-3 days]
Week 3-5:   #2 Reviewer Filters            [7-9 days]
Week 5-6:   #4 Comments Pipeline           [3-5 days]
Week 6-10:  #5 GitHub Platform             [12-18 days]
                                            ----------
Total:                                      32-47 days
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
| B-04 | Reviewer Filters | "Avg Time to Review" requires `reviewed_at` timestamp -- column missing from `reviewers` table | Schema migration + re-extraction plan. Consider deferring this metric to Phase 2. |
| B-05 | Reviewer Filters | "Approval Rate" has no formula definition | Product decision: `count(vote==10) / count(all_reviews)` per reviewer? per week? |
| B-06 | Reviewer Filters | `BreakdownEntry` type incompatible with reviewer metrics (cycle_time N/A, new `reviews_count` field) | Type design: extend BreakdownEntry with optional fields or create ReviewerBreakdownEntry |

### MEDIUM (prevents test writing for specific scenarios)

| ID | Feature | Blocker | Resolution |
|----|---------|---------|------------|
| B-07 | Author Filters | Author + Team combined filter semantics undefined (intersection or union?) | Product decision before frontend tests |
| B-08 | Author Filters | Scalability UX for 200+ authors (search/autocomplete vs multi-select) | UX design decision |
| B-09 | Reviewer Filters | Reviewer + Repo combined filter semantics undefined | Product decision |
| B-10 | Reviewer Filters | Multi-reviewer overlap not explicitly addressed (PR appears in all reviewer slices) | Document as intentional (same as team overlap) |
| B-11 | Comments | Dashboard visualization has no spec (metrics, layout, chart types) | Wireframe / metric list needed |
| B-12 | Comments | Phase 3 (sentiment, engagement) is research, not implementation -- should be a separate TODO | Reclassify or remove |
| B-13 | GitHub | Vote mapping (CHANGES_REQUESTED -> -5 vs -10) is a product decision | User validation |
| B-14 | GitHub | GraphQL vs REST extraction strategy not finalized | Architecture decision |

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

### #2 Reviewer Filters (Priority: HIGH)

**Why second:** Same structural pattern as author filters but with more complexity (vote semantics, new dimension extraction needed). Validates ADO vote normalization model before GitHub adds a different vote model.

**Phases:**
1. Backend: reviewer dimension extraction + `_generate_reviewer_slice()` + tests (3-4 days)
2. Frontend: schema + filter state + UI + filter logic (2-3 days)
3. Integration & testing (2 days)

**Key differences from author/team filters:**
- No `reviewers` list in `dimensions.json` yet -- needs new extraction query
- Metrics differ: "PRs reviewed" not "PRs authored"; cycle_time is N/A
- Vote breakdown adds complexity (ADO scale -10 to +10)
- New `reviews_count` metric not in existing `BreakdownEntry` type

**QA flags:**
- B-04: "Avg Time to Review" requires schema migration -- consider deferring to Phase 2
- B-05: Approval rate formula undefined
- B-06: BreakdownEntry type needs design decision
- Reviewer metric shape differs fundamentally from author/team metrics

---

### #3 Author x Repo Cross-Dimensional (T020/T021)

**Why third (after #1):** Blocked on author slices existing. Pattern is 100% established from Feature 029's `_generate_team_repo_slice()`. Only 2 tasks, well-scoped, 2-3 days.

**Tasks:**
- T020: `_generate_author_repo_slice()` in aggregators.py -- change `team_name` to `user_id` in groupby
- T021: Add `by_author_and_repo` to frontend types, KNOWN_ROOT_FIELDS, validateNestedBreakdown(), exact lookup branch

**Verification:** `sum(by_author_and_repo[A][*].pr_count) == by_author[A].pr_count`

---

### #4 Comments Pipeline Completion (Priority: MEDIUM)

**Why fourth:** Backend is fully complete (DB schema, API client, extraction, CLI) but delivers zero user value -- no CSV export, no dashboard visualization. Must validate ADO threading model end-to-end before GitHub's 3-endpoint comment model.

**Phases:**
1. Data pipeline: CSV export + JSON aggregations + coverage tracking (1-2 days)
2. Dashboard integration: TypeScript types + comment stats panel (2-3 days)
3. CLI documentation: Document --include-comments flags (0.5 days)

**Phase 3 (sentiment, engagement scoring) should be deferred to a separate TODO -- these are research tasks, not implementation.**

**QA flags:**
- Dashboard visualization has no spec (B-11) -- needs wireframe before Phase 2
- Forward-compatibility risk: ADO thread resolution status model may need redesign for GitHub

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
| `src/.../persistence/models.py` | #2 (reviewer schema), #4 (CSV schemas) |
| `src/.../transform/csv_generator.py` | #4 |
| `src/.../extractor/ado_client.py` | #5 (refactor to protocol) |
| `src/.../cli.py` | #4 (docs), #5 (--source flag) |
| `scripts/generate-synthetic-dataset.py` | #1, #3 |
| `tests/unit/test_aggregators.py` | #1, #2, #3 |

### Frontend (TypeScript) -- touched by multiple features

| File | Features |
|------|----------|
| `extension/ui/modules/metrics.ts` | #1, #2, #3 |
| `extension/ui/modules/filters.ts` | #1, #2 |
| `extension/ui/schemas/rollup.schema.ts` | #1, #2, #3 |
| `extension/ui/dataset-loader.ts` | #1, #2, #3 |
| `extension/ui/index.html` | #1, #2, #4 |

### Merge Conflict Risk

Features #1 (Author) and #2 (Reviewer) modify the same files (`aggregators.py`, `metrics.ts`, `rollup.schema.ts`, `filters.ts`). If parallelized, coordinate carefully or run sequentially.

---

## Test Pattern Reuse Summary

| Pattern | Source | Reusable By |
|---------|--------|-------------|
| `_generate_*_slice()` groupby testing | `test_aggregators.py:TestTeamSlicing` | #1, #2 |
| Cross-dim consistency invariant | `test_aggregators.py:TestTeamRepoSlicing:1724` | #3 |
| Truncation + min sample size guards | `test_aggregators.py:1826-1929` | #3 |
| Performance gate (30s budget) | `test_aggregators.py:2181` | #1, #2, #5 |
| API client mocking | `test_comments_extraction.py` | #5 |
| CSV schema contract | `test_csv_contract.py` | #4 |
| FilterState URL serialization | `filters.test.ts:71-80` | #1, #2 |
| Cross-dim exact lookup tests | `metrics.test.ts:982-1294` | #3 |
| Legacy backward compatibility | `extension/tests/fixtures/legacy-datasets/` | All |
| Cross-stack round-trip | `synthetic-fixtures.test.ts` | #3, #5 |
