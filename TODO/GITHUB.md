# GitHub Platform Support

This branch intentionally defers GitHub platform work.

The active roadmap on `032-roadmap-blocker-resolution` is ADO-first:
- author filters
- author x repo
- comments completion
- reviewer follow-through

If GitHub support is revisited later, it should start from a fresh planning branch and a new spec rather than carrying stale assumptions from this roadmap-cleanup branch.

---

## Market Analysis

### GitHub Native Capabilities (Gap Assessment)

GitHub provides basic repository-level PR activity summaries (Pulse) and has shipped some
org-level Insights metrics (DORA-style), but **lacks dedicated PR turnaround / review-cycle
analytics** comparable to this tool:

| Capability | GitHub Native | This Tool | Gap Severity |
|------------|--------------|-----------|--------------|
| PR throughput (weekly) | Basic (Pulse: repo-level open/merged counts) | Automated weekly rollups with cross-repo aggregation | HIGH |
| Cycle time (P50/P90) | None | Full percentile analysis | CRITICAL |
| Reviewer activity | None | Per-reviewer vote tracking | HIGH |
| Team-based filtering | None | Team slicing/filtering | HIGH |
| Multi-repo aggregation | None | Cross-project rollups | CRITICAL |
| Period comparison | None | Period-over-period | HIGH |
| PowerBI CSV export | None | Full CSV schema | HIGH (enterprise) |
| ML predictions | None | Prophet-based forecasting | MEDIUM |
| AI insights | None | GPT-4o-mini analysis | MEDIUM |
| Local data storage | N/A (cloud only) | SQLite local storage | HIGH (regulated) |
| Interactive dashboard | Pulse (basic repo-level activity view) | Full embedded dashboard with filtering | MEDIUM |

**Community demand signal**: GitHub Community Discussion #13037 ("Pull Analytics: PR
turnaround time, lead time for code review and changes") has been open since March 2022
with 48+ votes, no official GitHub response. Still unaddressed as of Feb 2026.

### Competitive Landscape

| Tier | Examples | Price | This Tool's Advantage |
|------|----------|-------|----------------------|
| Enterprise | LinearB, Jellyfish, Pluralsight Flow | ~$35-46/dev/month (LinearB Pro: ~$35; Enterprise: ~$46) | Free, local storage, PowerBI |
| Developer | Swarmia, Graphite, Sleuth | 20-39 EUR/dev/month (Swarmia Lite: 20 EUR; Standard: 39 EUR) | Free, ML/AI, multi-surface |
| Open Source | Apache DevLake, GrimoireLab, Augur, Middleware | Free | SQLite-local workflow, PowerBI export, extension parity, ML/AI predictions |

**No competitor offers this specific bundle**: SQLite-local data storage + PowerBI CSV export
contract + multi-surface deployment (CLI + Extension + Dashboard) + embedded ML predictions
+ AI insights. OSS tools like Apache DevLake provide PR cycle-time metrics with Grafana
dashboards, but lack the local-first architecture, PowerBI integration, and ADO+GitHub
hybrid enterprise support that this tool is uniquely positioned to fill.

### Enterprise Value Proposition

- **Multi-repo aggregation**: enterprises (50+ repos) need org-wide visibility
- **PowerBI integration**: CSV export schema is unique -- competitors lock data in SaaS
- **Data sovereignty**: SQLite local storage for regulated industries (finance, healthcare)
- **Dashboard parity**: CLI + Extension + Dev Dashboard showing identical data
- **Zero per-seat licensing**: free alternative to ~$20-46/dev/month commercial platforms and richer than OSS alternatives (DevLake, GrimoireLab) in PowerBI integration and multi-surface deployment

---

## DevOps Analysis

### ADO API Endpoints and GitHub Equivalents

| ADO Endpoint | GitHub Equivalent | Notes |
|-------------|-------------------|-------|
| `GET pullrequests?status=completed&minTime=...&maxTime=...` | REST Search `GET /search/issues?q=is:pr+is:merged+merged:YYYY-MM-DD..YYYY-MM-DD` or GraphQL `search(query: "is:pr is:merged merged:YYYY-MM-DD..YYYY-MM-DD")` | Both REST Search and GraphQL support date-range filtering via the `merged:` qualifier; basic `GET /repos/{o}/{r}/pulls` does NOT have a date filter. **Warning**: Search API returns max 1,000 results per query (see Invariant 12 risk) |
| `GET repositories` | `GET /orgs/{org}/repos` | Direct mapping |
| `GET teams` | `GET /orgs/{org}/teams` | ADO: project-scoped; GitHub: org-scoped |
| `GET teams/{id}/members` | `GET /orgs/{org}/teams/{slug}/members` | Direct mapping |
| `GET pullRequests/{id}/threads` | Three separate endpoints: (1) `GET /repos/{o}/{r}/pulls/{n}/reviews` for review objects, (2) `GET /repos/{o}/{r}/pulls/{n}/reviews/{id}/comments` for inline review comments (tied to diffs), (3) `GET /repos/{o}/{r}/issues/{n}/comments` for top-level discussion comments. GraphQL `pullRequest.reviews` and `pullRequest.comments` can retrieve both in fewer round trips. | GitHub has three distinct comment types vs ADO's unified thread model; normalization must collect from all three endpoints. Note: Issues endpoint uses issue number, not PR ID. |
| Connection test via `GET repositories` | `GET /orgs/{org}/repos` (validates org access + token) or `GET /repos/{owner}/{repo}` (validates specific repo access) | `GET /user` only validates the token, not org/repo access; prefer org/repo-scoped endpoint to match ADO behavior |

### Authentication Differences

| Aspect | ADO | GitHub |
|--------|-----|--------|
| Auth header | `Basic base64(":PAT")` | `Bearer {token}` |
| Token types | PAT only | Classic PAT, Fine-grained PAT, GitHub App, OAuth |
| Scopes needed | `Code (Read)` | Classic: `repo`, `read:org`. Fine-grained: "Metadata" repository permission (read) for repo listing, "Pull requests" repository permission (read) for PR/review access, "Members" organization permission (read) for org teams. Permissions are endpoint-specific (see `X-Accepted-GitHub-Permissions` response header). |

### Rate Limiting Differences

| Aspect | ADO | GitHub |
|--------|-----|--------|
| Rate limit | Undocumented; Retry-After on 429 | 5,000 req/hour (REST core); 5,000 pts/hour (GraphQL); 30 req/min (REST Search, code search 10/min) |
| Headers | `Retry-After` only | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` |
| Approach | Sleep between requests | Proactive tracking via remaining count |

### Concept Mapping

| ADO Concept | GitHub Equivalent | Mapping Strategy |
|-------------|-------------------|-----------------|
| Organization | Organization | Direct |
| Project | No equivalent | Config-based: default to org name |
| Repository | Repository | Direct (`repo_id` cast to string) |
| Team (project-scoped) | Team (org-scoped) | Map org teams to configured project |
| PR ID (global) | PR Number (per-repo) | UID formula identical: `{repo_id}-{pr_number}`. **Warning**: GitHub Issues endpoints return PRs with an `id` that is the *issue* ID, not the PR number. The client must always use the `number` field from PR-specific endpoints, never the `id` from Issues/Search endpoints, to preserve Invariant 14 (stable identifiers) and UPSERT convergence (Invariant 8). |
| `user_id` (GUID) | `user.id` (numeric) | Cast to string consistently |
| `vote` (-10 to 10) | Review state (string) | Map: APPROVED=10, CHANGES_REQUESTED=-5 (configurable; see note), COMMENTED=0, DISMISSED=0 |
| `closedDate` | `merged_at` / `closed_at` | Use `merged_at` for completed; `closed_at` for abandoned |
| `status: completed` | `merged: true` | Normalize to `completed` for merged PRs |

> **Vote mapping note**: GitHub `CHANGES_REQUESTED` maps to ADO `-5` ("waiting for author")
> by default because both semantically mean "author needs to address feedback." In workflows
> where `CHANGES_REQUESTED` functions as a hard block, configure the mapping to `-10`
> ("rejected"). The current analytics pipeline treats votes as opaque integers (no code
> interprets specific vote values), so this only affects downstream PowerBI reports that
> filter on vote thresholds. `DISMISSED` maps to `0` (no vote) since the review was
> withdrawn. This mapping is a **product decision** -- validate with users before finalizing.

### Pipeline Task Mapping

| ADO Extension Component | GitHub Equivalent |
|--------------------------|-------------------|
| `vss-extension.json` manifest | GitHub App manifest / Marketplace listing |
| `tasks/extract-prs/task.json` | GitHub Actions `action.yml` |
| `tasks/extract-prs/index.js` (Node wrapper) | Composite action calling Python CLI |
| Pipeline Artifacts | `actions/upload-artifact@v4` (note: 90-day retention on free/team plans) |
| Extension Hub (in-browser dashboard) | GitHub Pages or GitHub App dashboard URL |
| Extension Settings Hub | Config file in repo or GitHub App settings |

---

## Architecture Plan

### Current Vendor Lock-in (6 Files)
<!-- validated by internal audit, 2026-02-11 -->

| File | ADO-Specific Code |
|------|-------------------|
| `src/.../extractor/ado_client.py` | REST API URLs, Basic auth, continuation tokens, field names |
| `src/.../extractor/pr_extractor.py:15` | Imports `ADOClient` and `ExtractionError` directly |
| `src/.../extractor/pagination.py` | ADO continuation token header (`x-ms-continuationtoken`) extraction |
| `src/.../config.py:28-29` | `base_url: "https://dev.azure.com"`, `version: "7.1-preview.1"` |
| `src/.../cli.py:15,570-571` | Imports/instantiates `ADOClient`, hardcodes ADO base URL |
| `src/.../persistence/repository.py:288-374` | `upsert_pr_with_related()` parses ADO JSON shapes |

**All other components are vendor-agnostic** (validated by internal audit, 2026-02-11):
models.py (schema is generic; ADO references are comments only), aggregators.py,
csv_generator.py, all dashboard TypeScript (rollup.schema.ts, dimensions.schema.ts,
metrics.ts, filters.ts). Note: `raw_json` column in `pull_requests` stores
platform-specific JSON shapes; any tooling reading this column must handle both formats.

### Recommended Pattern: Protocol-Based Provider

```python
# New: src/ado_git_repo_insights/extractor/base_client.py

@dataclass
class NormalizedPR:
    """Vendor-neutral PR data -- maps to existing SQLite schema exactly."""
    pull_request_id: int
    repository_id: str
    repository_name: str
    author_id: str
    author_display_name: str
    author_email: str | None
    title: str
    status: str           # Always "completed" or "abandoned"
    description: str | None
    creation_date: str    # ISO 8601
    closed_date: str | None
    reviewers: list[NormalizedReviewer]

@dataclass
class NormalizedReviewer:
    user_id: str
    display_name: str
    email: str | None
    vote: int             # Mapped to ADO scale (-10 to 10)

class GitPlatformClient(Protocol):
    def get_pull_requests(
        self, project: str, start_date: date, end_date: date
    ) -> Iterator[NormalizedPR]: ...

    def get_teams(self, project: str) -> list[NormalizedTeam]: ...
    def test_connection(self, project: str) -> bool: ...
```

Note: `ExtractionError` must move from `ado_client.py` to `base_client.py` so both
clients raise the same exception type.

### Pipeline Impact

| Stage | Impact | Changes |
|-------|--------|---------|
| **1. Extract** | MAJOR | New `GitHubClient`, refactor `PRExtractor` to accept protocol, new pagination module |
| **2. Persist** | MINOR | Refactor `upsert_pr_with_related()` (lines 288-374) to accept `NormalizedPR` instead of raw ADO dict |
| **3. Aggregate** | NONE | Pure SQL on generic schema, no vendor references |
| **4. Dashboard** | NONE | JSON-driven, vendor-agnostic schemas |

Note: "NONE" for Stages 3-4 applies to the core computation path. Config validation,
error messages, logging, and documentation all need updates across the codebase.

### Normalization Decisions

The Protocol-Based Provider pattern normalizes all GitHub data into the existing ADO data
model. This is a deliberate design choice with known trade-offs:

**GitHub review states mapped:**
| GitHub State | ADO Vote | Rationale |
|-------------|----------|-----------|
| `APPROVED` | 10 | Direct equivalent |
| `CHANGES_REQUESTED` | -5 (configurable) | "Author needs to address feedback"; use -10 if blocking semantics needed |
| `COMMENTED` | 0 | Non-blocking review activity |
| `DISMISSED` | 0 | Review withdrawn; no ADO equivalent |
| `PENDING` | (not stored) | Draft review not yet submitted |

**GitHub features intentionally excluded from v1:**
- GitHub Checks (CI status on PRs)
- GitHub Deployments (post-merge deploy tracking)
- Draft PR state (GitHub has explicit draft; ADO does not)
- PR labels (widely used for categorization in GitHub)
- Linked issues (closing-issue references)
- Code owner automatic reviews (CODEOWNERS)
- Review dismissal history (beyond current state)
- Suggested changes (inline code suggestions in reviews)

These may be added in future phases but are out of scope for initial GitHub support.

### Schema Impact: NO CHANGES NEEDED

The existing SQLite schema supports GitHub data without modification:

| Table | GitHub Compatibility |
|-------|---------------------|
| `organizations` | GitHub org = ADO org |
| `projects` | Use org name or configurable mapping |
| `repositories` | `repository_id` = GitHub repo ID (string cast) |
| `users` | `user_id` = GitHub user ID, `display_name` = login |
| `pull_requests` | `pull_request_id` = GH PR number, status normalized |
| `reviewers` | Review states mapped to ADO vote scale |
| `teams` | GitHub org teams map cleanly |
| `extraction_metadata` | Works as-is, scoped by org+project |

### Configuration Extension

```yaml
# Existing ADO config (remains valid, backward compatible)
source: ado           # NEW field, defaults to "ado"
organization: MyOrg
projects:
  - ProjectOne

# GitHub config
source: github
organization: my-github-org
projects:
  - my-github-org     # Org name as project label
github_token: ghp_xxxx
repos:                # NEW: explicit repo list
  - owner/repo-one
  - owner/repo-two
```

### Invariant Compliance

| Invariant | Impact | Risk |
|-----------|--------|------|
| 1-4 (CSV contract) | SAFE -- no CSV schema changes | None |
| 5-9 (Persistence) | SAFE -- same SQLite, same UPSERT | None |
| 10-11 (Incremental + backfill) | NEEDS CARE -- GitHub has no native date filter on PR list endpoint; Search API date filtering subject to 1,000-result cap; `merged:` qualifier is date-only (no time-of-day); abandoned PRs require separate `closed:` query; backfill across many repos compounds query volume | Medium |
| 12 (Complete pagination) | NEEDS CARE -- Search API capped at 1,000 results; requires per-repo or time-window chunking with truncation detection to avoid silent data loss | High |
| 13 (Bounded retry) | SAFE -- reuse existing retry infrastructure | None |
| 14 (Stable identifiers) | NEEDS CARE -- GitHub Issues endpoints return issue IDs, not PR numbers; UID must use PR `number` field exclusively | Medium |
| 15 (Org+project scoping) | NEEDS DESIGN -- GitHub has no "project" concept; config-based mapping using org name as project label. **May require a formal invariant amendment** to define platform-dependent scoping (ADO: org→project→repo; GitHub: org→repo). | High |
| 16-22 (Names, runtime, security, storage) | SAFE | None |
| 23-25 (Testing) | NEEDS WORK -- new GitHub test fixtures required | Required |

---

## Implementation Phases

### Phase 5.1: Provider Abstraction (~2-3 days)

| Step | File | Change |
|------|------|--------|
| 1.1 | `src/.../extractor/base_client.py` | NEW: `GitPlatformClient` protocol + `NormalizedPR`, `NormalizedReviewer`, `NormalizedTeam` dataclasses + `ExtractionError` (moved from ado_client) |
| 1.2 | `src/.../extractor/ado_client.py` | Add normalization methods to produce `NormalizedPR` from raw ADO JSON |
| 1.3 | `src/.../extractor/pr_extractor.py` | Accept `GitPlatformClient` protocol instead of `ADOClient` |
| 1.4 | `src/.../persistence/repository.py` | Add `upsert_pr_with_normalized()` alongside existing method |
| 1.5 | `tests/unit/test_client_protocol.py` | NEW: validate ADOClient satisfies protocol |

### Phase 5.2: GitHub Client (~3-4 days)

| Step | File | Change |
|------|------|--------|
| 2.1 | `src/.../extractor/github_client.py` | NEW: GitHub REST/GraphQL client implementing protocol |
| 2.2 | -- | GitHub pagination (Link headers + 1,000-result truncation detection + window chunking) |
| 2.3 | -- | GitHub auth (Bearer token, classic and fine-grained PAT support) |
| 2.4 | -- | Proactive rate limit tracking (`X-RateLimit-Remaining`); Search API 30 req/min limit |
| 2.5 | -- | PR normalization (status, votes, dates); identity mapping (PR number, not issue ID) |
| 2.6 | -- | Team fetching from GitHub org API |
| 2.7 | -- | Comment collection from three separate endpoints (reviews, review comments, issue comments) |

### Phase 5.3: Config & CLI (~1-2 days)

| Step | File | Change |
|------|------|--------|
| 3.1 | `src/.../config.py` | Add `source: str = "ado"` field, GitHub-specific options |
| 3.2 | `src/.../cli.py` | Add `--source ado\|github` flag, factory for client instantiation |
| 3.3 | `config.example.yaml` | Add GitHub config examples |

### Phase 5.4: Testing (~3-4 days)

| Step | File | Change |
|------|------|--------|
| 4.1 | `tests/unit/test_github_client_pagination.py` | NEW: Link header pagination, rate limits, auth |
| 4.2 | `tests/unit/test_github_pr_mapping.py` | NEW: response normalization (status, votes, dates, cycle time); parametrized CHANGES_REQUESTED mapping (-5 vs -10) |
| 4.3 | `tests/integration/test_multi_source_scoping.py` | NEW: no UID collisions between ADO and GitHub PRs |
| 4.4 | `tests/unit/test_config_github.py` | NEW: GitHub config validation |
| 4.5 | `tests/unit/test_github_search_cap.py` | NEW: 1,000-result truncation detection, time-window subdivision, no silent PR loss (Invariant 12) |
| 4.6 | `tests/unit/test_github_comment_collection.py` | NEW: dual-endpoint comment collection, thread normalization, no duplicates |
| 4.7 | `tests/unit/test_github_identity.py` | NEW: issue ID vs PR number disambiguation, UID correctness (Invariant 14) |
| 4.8 | `tests/unit/test_github_auth_errors.py` | NEW: classic PAT vs fine-grained PAT error differentiation, actionable messages (Invariant 18) |
| 4.9 | `test_secret_redaction.py` extension | GitHub token redaction |
| 4.10 | `tests/unit/test_client_protocol.py` | NEW: both clients satisfy `GitPlatformClient` |
| 4.11 | Existing golden output tests | Verify unchanged (source-agnostic) |
| 4.12 | Existing UPSERT convergence tests | Verify unchanged |

### Phase 5.5: Documentation & Error Handling (~1-2 days)

| Step | Description |
|------|-------------|
| 5.1 | README updates, GitHub installation guide, CLI help text |
| 5.2 | Config example files for GitHub-only and hybrid setups |
| 5.3 | Error handling for GitHub-specific API shapes (GraphQL nested errors, token permission errors) |
| 5.4 | Migration guide for existing ADO users adding GitHub |

### Phase 5.6 (Future): GitHub Actions + Dashboard Hosting

| Step | Description |
|------|-------------|
| 6.1 | GitHub Actions composite action wrapping the Python CLI |
| 6.2 | `GitHubArtifactClient` implementing `IDatasetLoader` interface (note: 90-day artifact retention on free/team plans) |
| 6.3 | GitHub Pages deployment of static aggregates |
| 6.4 | GitHub App / Marketplace listing (if demand warrants) |

---

## QA Strategy

### Existing Test Infrastructure Readiness

| Aspect | Status | Reusability |
|--------|--------|-------------|
| Python tests (312+ tests, 75% coverage) | Production-grade | HIGH |
| TypeScript tests (642+ tests) | Production-grade | HIGH |
| API client mocking pattern | `mock.patch` + `make_mock_response()` | DIRECT REUSE |
| Integration fixtures | `tempfile` + `DatabaseManager` + `Config` | DIRECT REUSE |
| Golden output / contract tests | Source-agnostic (validates CSV from SQLite) | AS-IS |
| UPSERT convergence tests | Source-agnostic (validates stable keys) | AS-IS |
| CSV schema contract tests | Source-agnostic | AS-IS |
| Extension fetch mocking | `mockFetchResponse()` helpers | DIRECT REUSE |
| Scalability tests (10K PRs) | Source-agnostic | AS-IS |

### New Tests Required

**Python (~120-180 new tests across ~15-20 files):**
- `test_github_client_pagination.py` -- Link header pagination, rate limits, auth
- `test_github_pr_mapping.py` -- Response normalization (status, votes, dates, cycle time); parametrized CHANGES_REQUESTED vote mapping (-5 vs -10) with analytics consistency validation
- `test_config_github.py` -- GitHub config validation
- `test_multi_source_scoping.py` -- No UID collisions between sources
- `test_github_incremental_run.py` -- GitHub incremental extraction
- `test_github_backfill_convergence.py` -- Review state change correction
- `test_client_protocol.py` -- Both clients satisfy `GitPlatformClient`
- `test_secret_redaction.py` extension -- GitHub token redaction
- `test_github_search_cap.py` -- Search API 1,000-result truncation detection, automatic time-window subdivision, verification that no PRs are lost during chunking (Invariant 12)
- `test_github_comment_collection.py` -- Dual-endpoint comment collection (PR review comments + issue comments), normalization into internal thread model, no lost or duplicated comments
- `test_github_identity.py` -- Issue ID vs PR number disambiguation, UID generation uses PR number not issue ID, mixed endpoint responses do not corrupt identity (Invariant 14, 16)
- `test_github_auth_errors.py` -- Classic PAT 403 vs fine-grained PAT 404 error differentiation, GitHub App token scenarios, actionable error messages per token type (Invariant 18)

**TypeScript (~30-50 new tests across ~5-8 files):**
- Multi-source filter tests (if source dimension added to UI)
- GitHub artifact loading tests
- Schema parity tests for GitHub-sourced aggregates

### Risk Areas

| Risk | Severity | Mitigation |
|------|----------|------------|
| CSV schema change (adding `source` column) | CRITICAL | Keep source-agnostic CSVs; differentiate only in extraction/config |
| ADO client coupling in `PRExtractor` | HIGH | Protocol abstraction in Phase 5.1 |
| Config model backward compatibility | HIGH | Additive fields only, defaults preserve ADO behavior |
| Search API 1,000-result cap | HIGH | Time-window subdivision with truncation detection; repo-level chunking fallback |
| Issue ID vs PR number identity confusion | HIGH | Never use issue ID for UID; extract PR number from `number` field; integration test with mixed endpoint responses |
| UID collision between sources | MEDIUM | Same formula `{repo_id}-{pr_number}` with distinct repo IDs |
| Mixed-source aggregation edge cases | MEDIUM | Separate databases per platform for v1 |
| GitHub rate limits more restrictive | MEDIUM | Proactive `X-RateLimit-Remaining` tracking |
| PR review comments vs issue comments (dual endpoint) | MEDIUM | Separate collection from both endpoints; deduplication by comment ID before normalization |
| CHANGES_REQUESTED vote mapping ambiguity (-5 vs -10) | MEDIUM | Parametrized testing of both mappings; document chosen mapping with rationale; validate analytics consistency |
| Fine-grained token permission error differentiation | MEDIUM | Inspect `X-Accepted-GitHub-Permissions` header; map 403/404 to actionable messages per token type |

### Definition of Done Impact

| DoD Section | GitHub Impact | New Tests Needed |
|-------------|--------------|-----------------|
| 1.1 Schema Contract | None if no CSV changes | Existing tests auto-validate |
| 1.2 Deterministic Output | None | Same pipeline, same determinism |
| 1.3 Golden Fixture | MEDIUM | Extend golden DB with GitHub PRs |
| 3.1 Pagination | CRITICAL | GitHub search cap tests (1,000-result truncation + window subdivision) |
| 3.2 Bounded Retry | MEDIUM | GitHub rate limit header tests |
| 3.3 Incremental Mode | HIGH | GitHub `since` parameter tests; dual-endpoint comment collection |
| 3.4 Backfill Convergence | MEDIUM | GitHub review state change tests |
| 4.1 Stable Keys | CRITICAL | Issue ID vs PR number identity tests, UID generation correctness |
| 4.2 Org/Project Scoping | HIGH | Multi-source scoping tests |
| 5.2 Secrets | HIGH | Token-type-specific error message tests (classic vs fine-grained vs GitHub App) |

### CI Impact

Adding GitHub support doubles the API client test surface. Recommended CI changes:
- Add `test-github-client` job (can be optional/conditional initially)
- Extend `--min-collected` threshold as new tests are added
- Consider `test-multi-source` integration test job
- Monitor CI time budget -- GitHub tests should run in parallel with ADO tests

---

## Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| GitHub "project" mapping breaks Invariant 15 | HIGH | MEDIUM | Config-based mapping with clear docs; may require formal invariant amendment |
| Search API 1,000-result cap causes silent data loss | HIGH | MEDIUM | Truncation detection + window chunking; per-repo extraction fallback |
| GitHub artifact retention (90 days on free/team plans) | HIGH | MEDIUM | Document retention limits; recommend Azure Storage fallback or scheduled extraction |
| GitHub reviewer votes incompatible with ADO vote scale | MEDIUM | LOW | Configurable mapping with documented rationale; parametrized testing |
| GitHub rate limits more restrictive than ADO | MEDIUM | MEDIUM | Proactive rate limit handler with X-RateLimit headers |
| Mixed ADO+GitHub data creates key collisions | HIGH | LOW | Separate DB per platform for v1; prefix UIDs if mixed |
| Dashboard parity violation | HIGH | LOW | Dashboard is already vendor-agnostic; no changes needed |
| CSV contract breakage (Invariant 1-4) | CRITICAL | VERY LOW | No schema changes; GitHub PRs produce identical CSVs |
| GitHub could build native PR analytics | MEDIUM | LOW | 4-year community request gap (Discussion #13037, 48+ votes) suggests low near-term priority |
| Premature normalization decisions | MEDIUM | MEDIUM | Complete all TODO items first to stabilize the data model |
| Scope creep after launch (cross-platform dashboards, identity linking) | MEDIUM | HIGH | Explicitly out of scope for v1 (see below) |
| Ongoing maintenance burden (two API clients) | MEDIUM | HIGH | Two sets of API versioning, deprecation, auth lifecycle, rate limit policy changes |

---

## Explicitly Out of Scope (v1)

The following features are anticipated user requests after GitHub support launches but
are **not part of the initial implementation**:

1. **Cross-platform aggregation**: unified dashboards showing ADO + GitHub data together
2. **Identity linking**: matching the same person across ADO and GitHub accounts
3. **Platform-specific enrichment**: GitHub Checks, Deployments, branch protection, labels
4. **Mixed-source databases**: ADO and GitHub PRs in the same SQLite file (v1 uses separate databases)
5. **GitHub-specific dashboard features**: draft PR tracking, label-based filtering

---

## Code Reuse Estimate

| Component | Lines of Code | Reusability | Notes |
|-----------|---------------|-------------|-------|
| CLI framework | ~500 | 90% | Add `--source` option, factory pattern, new imports |
| API Client | ~1500 | 0% | Completely new for GitHub |
| Extraction orchestration | ~300 | 80% | Adjustments for GitHub concepts, error types |
| Persistence/repository | ~2000 | 80% | Same schema; `upsert_pr_with_related` needs refactor for normalized input |
| Config/validation/error handling | ~500 | 60% | GitHub-specific validation, error messages, help text |
| Aggregation/analytics | ~3000 | 100% | Fully vendor-agnostic |
| CSV generation | ~500 | 100% | Downstream of DB |
| Dashboard (TypeScript) | ~15000 | 100% | Completely vendor-agnostic |
| Documentation | ~300 | 0% | New GitHub docs needed |
| **Total** | **~23600** | **~55-60%** | ~13-14K reusable, ~9-10K new |

### Maintenance Burden

Supporting two platforms introduces ongoing costs beyond initial implementation:
- Two sets of API versioning concerns (ADO `api-version` vs GitHub API versions)
- Two sets of auth token lifecycle management (GitHub fine-grained PATs expire)
- Two sets of rate limit policy changes to monitor
- Two sets of deprecation timelines (e.g., GitHub deprecated REST PR comments in favor of GraphQL)
- CI pipeline runs both ADO and GitHub test suites for every change
