```md
# agents/invariants.md — ado-git-repo-insights

This document defines the non-negotiable invariants for ado-git-repo-insights.
All implementation choices must preserve these properties. If an invariant cannot be met,
the change must be treated as a design break and escalated.

---

## 1) Output Contract Invariants (PowerBI Compatibility)

1. **CSV schema is a hard contract.**
   Each CSV must have exactly the expected columns, in exactly the expected order, with stable names.

2. **No breaking changes to CSVs without an explicit version bump and migration plan.**
   Adding/removing/renaming/reordering columns is a breaking change unless the downstream contract is updated intentionally.

3. **CSV output must be deterministic.**
   For the same SQLite contents, CSV bytes should be stable across runs:

   - deterministic row ordering (stable sort keys)
   - deterministic null/empty-string handling
   - stable formatting for datetimes and numbers

4. **PowerBI imports must remain frictionless.**
   The CSVs must remain loadable into the existing PowerBI model without manual fixes.

---

## 2) Persistence & State Invariants (SQLite via Pipeline Artifacts)

5. **SQLite is the source of truth for derived outputs.**
   CSVs are generated from SQLite, not from raw API JSON directly.

6. **Pipeline Artifacts are the primary persistence mechanism.**
   The standard run downloads the prior SQLite artifact, updates it, and re-uploads it.

7. **No publish-on-failure.**
   If extraction or CSV generation fails, the pipeline must not publish a mutated SQLite artifact or partial CSV set.

8. **State updates must be idempotent and converge.**
   Re-running the same date range must not create duplicate logical entities; it must converge via stable keys and UPSERT semantics.

9. **Persistence must be recoverable.**
   If the SQLite artifact is missing/expired:
   - the system must initialize a fresh DB
   - the run must be explicit about “first-run/backfill” behavior
   - the resulting outputs must still satisfy the CSV contract

---

## 3) Extraction Invariants (Correctness Over Time)

10. **Daily incremental extraction is the default mode.**
    Standard scheduled runs should extract the minimal incremental range.

11. **Periodic backfill is required to prevent drift.**
    The system must support a bounded “backfill window” mode (e.g., weekly) that re-fetches and UPSERTs the last N days (e.g., 30–90).
    This is the primary mechanism to handle late PR changes (review votes, reopen/close cycles, metadata edits) without complex change detection.

12. **No silent data loss.**
    Pagination must be complete (continuation tokens) and failures must fail the run rather than produce incomplete “successful” outputs.

13. **Rate limiting and retry must be bounded and predictable.**
    Retries, sleeps, and backoff must be configurable and must never lead to infinite loops.

---

## 4) Identity & Key Invariants (No Collisions)

14. **Stable identifiers are required for UPSERT keys.**
    Primary keys must be stable across runs (e.g., repository_id + pull_request_id → pull_request_uid).

15. **All entities must be scoped to organization + project where applicable.**
    No table row or CSV row may be ambiguous across org/project boundaries.

16. **Names are labels; IDs are identity.**
    Support name changes without breaking identity or duplicating entities.

---

## 5) Runtime & Packaging Invariants (ADO Task Extension)

17. **The Azure DevOps Pipeline Task must run in hosted and self-hosted agents.**
    Any runtime assumptions (Python version, install method, working directory) must be explicit and tested.

18. **Clear failures with actionable logs.**
    If configuration is invalid, auth fails, or runtime dependencies are missing, the task must fail fast with a direct error message.

---

## 6) Security Invariants (Secrets & Access)

19. **PATs are secrets and must never be logged.**
    Do not print PATs or Authorization headers; scrub values in debug output.

20. **Least privilege by default.**
    PAT requirements must be documented and limited to what’s necessary (Code Read).

---

## 7) Optional Storage Backend Invariants (Azure Storage Fallback)

21. **Azure Storage fallback is opt-in and must be single-authority.**
    When enabled, Azure Storage becomes the persistence source of truth for SQLite.
    Mixed-mode (artifact + blob both writing state) is forbidden.

22. **Migration must be explicit and one-way.**
    If switching to Azure Storage, the plan must define a controlled cutover that prevents split-brain state.

---

## 8) Testing & Verification Invariants

23. **CSV contract validation must be automated.**
    CI must verify CSV schemas and column order against expected definitions.

24. **End-to-end extraction → SQLite → CSV must be testable.**
    At least one integration test must validate:

    - mocked ADO API responses
    - SQLite UPSERT convergence
    - CSV deterministic output

25. **Backfill mode must be tested.**
    There must be a test proving that a late change (e.g., reviewer vote update) is corrected after a backfill run.

---

## Decision Log (Locked)

- Primary persistence: **Azure DevOps Pipeline Artifacts (SQLite file)**
- Historical migration: **No MongoDB migration** (fresh extraction from configured start date)
- Output compatibility: **100% PowerBI CSV parity is mandatory**
```
