"""PR-record title refresh cadence (feature 060 FR-022 / SC-012).

When a pull-request title is edited in Azure DevOps between two extracts,
the rollup ``prs`` array MUST reflect the NEW title on the next aggregator
run, and the previous title MUST NOT be carried forward. The aggregator
writes the rollup fresh each run against the current DB state; this test
locks that invariant against a real re-aggregate path (not a mock).
"""

from __future__ import annotations

import json
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest

from ado_git_repo_insights.persistence.database import DatabaseManager
from ado_git_repo_insights.persistence.repository import PRRepository
from ado_git_repo_insights.transform.aggregators import AggregateGenerator

PR_UID = "repo-snap-1"
PR_ID = 42
REPO_ID = "repo-snap"
USER_ID = "user-snap"
OLD_TITLE = "feat: original title"
NEW_TITLE = "feat: updated title after edit"


@pytest.fixture
def seeded_db() -> Iterator[tuple[DatabaseManager, Path]]:
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        db_path = tmp_path / "snapshot.sqlite"
        manager = DatabaseManager(db_path)
        manager.connect()

        repo = PRRepository(manager)
        repo.upsert_organization("Acme")
        repo.upsert_project("Acme", "Platform")
        repo.upsert_repository(REPO_ID, "snap-repo", "Platform", "Acme")
        repo.upsert_user(USER_ID, "Snap User", "snap@acme.com")
        repo.upsert_pull_request(
            pull_request_uid=PR_UID,
            pull_request_id=PR_ID,
            organization_name="Acme",
            project_name="Platform",
            repository_id=REPO_ID,
            user_id=USER_ID,
            title=OLD_TITLE,
            status="completed",
            description=None,
            creation_date="2025-01-01T08:00:00Z",
            closed_date="2025-01-06T10:00:00Z",
            cycle_time_minutes=120.0,
        )

        yield manager, tmp_path

        manager.close()


def _find_pr_in_rollups(rollup_dir: Path, pr_id: int) -> dict[str, object] | None:
    for path in sorted((rollup_dir / "aggregates" / "weekly_rollups").glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            continue
        prs = payload.get("prs")
        if not isinstance(prs, list):
            continue
        for row in prs:
            if isinstance(row, dict) and row.get("id") == pr_id:
                return row
    return None


def _collect_all_titles(rollup_dir: Path) -> list[str]:
    titles: list[str] = []
    for path in sorted((rollup_dir / "aggregates" / "weekly_rollups").glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            continue
        prs = payload.get("prs")
        if not isinstance(prs, list):
            continue
        for row in prs:
            if isinstance(row, dict) and isinstance(row.get("title"), str):
                titles.append(row["title"])
    return titles


def test_pr_title_edit_flows_to_next_rollup_and_previous_title_absent(
    seeded_db: tuple[DatabaseManager, Path],
) -> None:
    """FR-022: title edit between extracts surfaces in the next rollup."""
    manager, tmp_path = seeded_db

    # Run 1: baseline rollup carries the OLD title.
    out1 = tmp_path / "snap_run1"
    AggregateGenerator(manager, out1, run_id="snap-v1").generate_all()
    row = _find_pr_in_rollups(out1, PR_ID)
    assert row is not None, "baseline rollup missing the seeded PR"
    assert row["title"] == OLD_TITLE

    # SQL UPDATE the PR title to simulate an ADO edit between extracts.
    manager.execute(
        "UPDATE pull_requests SET title = ? WHERE pull_request_uid = ?",
        (NEW_TITLE, PR_UID),
    )
    manager.connection.commit()

    # Run 2: fresh aggregate against the mutated DB state.
    out2 = tmp_path / "snap_run2"
    AggregateGenerator(manager, out2, run_id="snap-v2").generate_all()
    row2 = _find_pr_in_rollups(out2, PR_ID)
    assert row2 is not None, "post-edit rollup missing the seeded PR"
    assert row2["title"] == NEW_TITLE, (
        "PR title in the new rollup MUST reflect the updated DB state. "
        f"Expected {NEW_TITLE!r}, got {row2['title']!r}."
    )

    # The previous title MUST NOT appear anywhere in the new rollup tree.
    all_titles_new = _collect_all_titles(out2)
    assert OLD_TITLE not in all_titles_new, (
        "Stale title leaked into the post-edit rollup. The aggregator must "
        "write prs fresh from current DB state each run (FR-022)."
    )
