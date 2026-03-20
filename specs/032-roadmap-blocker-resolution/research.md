# Research: Roadmap Blocker Resolution

## Decision 1: Defer Review Latency Until `reviewed_at` Exists

### Findings

- The current `reviewers` table stores `pull_request_uid`, `user_id`, `vote`, and `repository_id`.
- There is no persisted review timestamp.
- The roadmap blocker B-04 correctly identifies that "Avg Time to Review" cannot be implemented honestly from the current model.

### Decision

Defer all reviewer latency metrics to Reviewer Phase 2 instead of forcing a schema migration into Phase 1.

### Why

- It keeps reviewer filter delivery small and reliable.
- It avoids pseudo-precision from inferring review timing indirectly.
- It allows the initial reviewer feature to ship on metrics the system already stores correctly.

## Decision 2: Use Final Reviewer Outcome Per PR For Approval Rate

### Findings

- `reviewers` currently has a uniqueness constraint on `(pull_request_uid, user_id)`.
- That means the current persisted model already behaves like one final reviewer outcome per PR per reviewer.

### Decision

Approval rate is `count(vote == 10) / count(reviewed_prs)` for ADO Phase 1.

### Why

- It matches the current storage model.
- It is easy to explain to users.
- It avoids inventing multi-event semantics the database does not yet preserve.

## Decision 3: Create `ReviewerBreakdownEntry`

### Findings

- Existing `BreakdownEntry` is built around PR-delivery metrics like `pr_count` and cycle-time percentiles.
- Reviewer analytics answer different questions: review activity, approvals, breadth of repositories, and potentially latency later.

### Decision

Introduce a dedicated `ReviewerBreakdownEntry` schema instead of bolting reviewer fields onto the generic breakdown type.

### Why

- Cleaner contracts
- Fewer null-heavy fields
- Easier dashboard rendering and validation
- Lower backward-compatibility risk

## Decision 4: Comments UI Should Start As Aggregate Metrics

### Findings

- Backend comment extraction already exists.
- CSV export and aggregate JSON are still missing.
- No dashboard spec exists today for comments, which is blocker B-11.

### Decision

Phase 1 comments completion is a metrics dashboard, not a raw-discussion explorer.

### Minimum metrics

- total threads
- total comments
- comments per PR
- resolved thread rate
- weekly comment trend
- repository comment breakdown
- coverage/capped status

## Decision 5: GitHub Uses REST First, But Last In Sequence

### Findings

- `TODO/GITHUB.md` already argues GitHub should come after author, reviewer, and comments work.
- The current codebase is ADO-specific in the extractor layer but generic downstream.
- Both REST and GraphQL are viable, but GraphQL increases early complexity.

### Decision

Document GitHub v1 as:
- roadmap priority last
- REST-first implementation
- GraphQL deferred unless a concrete API limitation requires it

### Why

- Keeps the initial provider abstraction narrower
- Aligns with current fixture/test patterns
- Avoids mixing architecture exploration with unresolved ADO-first product work
