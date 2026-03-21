# Data Model: Roadmap Blocker Resolution

## Reviewer Phase 1

### ReviewerBreakdownEntry

```text
ReviewerBreakdownEntry
├── reviewed_prs: int
├── reviews_count: int
├── approval_rate: float | null
├── authors_count: int
└── repositories_count: int
```

### Notes

- `reviewed_prs` is the primary activity metric.
- `reviews_count` is retained separately to preserve future compatibility if review-event history expands.
- `approval_rate` is nullable only when the denominator is zero.
- No cycle-time or review-latency fields appear in Phase 1.

## Reviewer Phase 2

Reviewer latency metrics become available only after this persisted event model exists:

```text
ReviewEvent
├── pull_request_uid: str
├── user_id: str
├── vote: int
├── reviewed_at: datetime
└── repository_id: str
```

This is not implemented on this branch; it is the unlock condition for later work.

## Comments Phase 1 Aggregate Model

```text
CommentAggregate
├── total_threads: int
├── total_comments: int
├── comments_per_pr: float | null
├── resolved_threads: int
├── unresolved_threads: int
├── resolved_threads_rate: float | null
├── weekly_series: list[WeeklyCommentPoint]
├── by_repository: dict[str, RepositoryCommentEntry]
└── coverage: CommentCoverage
```

```text
WeeklyCommentPoint
├── week: str
├── threads: int
└── comments: int
```

```text
RepositoryCommentEntry
├── threads: int
├── comments: int
└── resolved_threads_rate: float | null
```

```text
CommentCoverage
├── status: "none" | "partial" | "full"
├── capped: bool
└── reason: str | null
```
