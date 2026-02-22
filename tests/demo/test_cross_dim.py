"""Cross-dimensional completeness tests (Contract 4, SC-001, SC-010, FR-016).

These tests verify that every weekly rollup contains valid by_team_and_repo
cross-dimensional breakdowns satisfying sum-equality and completeness invariants.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

ROLLUPS_DIR = (
    Path(__file__).parent.parent.parent
    / "docs"
    / "data"
    / "aggregates"
    / "weekly_rollups"
)


def _load_all_rollups() -> list[tuple[str, dict]]:
    """Load all weekly rollup files, returning (filename, data) pairs."""
    rollups = []
    for f in sorted(ROLLUPS_DIR.glob("*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        rollups.append((f.name, data))
    return rollups


@pytest.fixture(scope="module")
def all_rollups():
    """Load all rollups once for the test module."""
    rollups = _load_all_rollups()
    assert len(rollups) >= 260, f"Expected >= 260 rollups, got {len(rollups)}"
    return rollups


class TestCrossDimPresence:
    """SC-001: Every rollup has non-null by_team_and_repo."""

    def test_by_team_and_repo_exists(self, all_rollups):
        missing = []
        for fname, data in all_rollups:
            if "by_team_and_repo" not in data or data["by_team_and_repo"] is None:
                missing.append(fname)
        assert not missing, (
            f"Missing by_team_and_repo in {len(missing)} rollups: {missing[:5]}"
        )

    def test_by_team_and_repo_has_entries(self, all_rollups):
        empty = []
        for fname, data in all_rollups:
            btar = data.get("by_team_and_repo", {})
            if not btar:
                empty.append(fname)
        # Some weeks might have all teams with 0 PRs (unlikely but possible)
        # At minimum, most weeks should have entries
        assert len(empty) < len(all_rollups) * 0.1, (
            f"Too many empty by_team_and_repo: {len(empty)}"
        )


class TestCrossDimSumEquality:
    """Contract 4: sum(by_team_and_repo[team][*].pr_count) == by_team[team].pr_count."""

    def test_pr_count_sum_equality(self, all_rollups):
        errors = []
        for fname, data in all_rollups:
            by_team = data.get("by_team", {})
            btar = data.get("by_team_and_repo", {})
            for team, team_entry in by_team.items():
                if team_entry["pr_count"] == 0:
                    continue
                if team not in btar:
                    errors.append(
                        f"{fname}: team '{team}' missing from by_team_and_repo"
                    )
                    continue
                repo_sum = sum(r["pr_count"] for r in btar[team].values())
                if repo_sum != team_entry["pr_count"]:
                    errors.append(
                        f"{fname}: {team} sum={repo_sum} != by_team={team_entry['pr_count']}"
                    )
        assert not errors, f"{len(errors)} sum-equality violations:\n" + "\n".join(
            errors[:10]
        )


class TestCrossDimCompleteness:
    """Contract 4: Every team with pr_count >= 1 must exist in by_team_and_repo."""

    def test_team_presence(self, all_rollups):
        errors = []
        for fname, data in all_rollups:
            by_team = data.get("by_team", {})
            btar = data.get("by_team_and_repo", {})
            for team, team_entry in by_team.items():
                if team_entry["pr_count"] >= 1 and team not in btar:
                    errors.append(
                        f"{fname}: team '{team}' has {team_entry['pr_count']} PRs but missing from by_team_and_repo"
                    )
        assert not errors, f"{len(errors)} completeness violations:\n" + "\n".join(
            errors[:10]
        )

    def test_no_zero_pr_repo_entries(self, all_rollups):
        """Sparse representation: repos with 0 PRs for a team are omitted."""
        errors = []
        for fname, data in all_rollups:
            btar = data.get("by_team_and_repo", {})
            for team, repos in btar.items():
                for repo, entry in repos.items():
                    if entry["pr_count"] == 0:
                        errors.append(
                            f"{fname}: {team}/{repo} has 0 PRs but is present"
                        )
        assert not errors, f"{len(errors)} sparse violations:\n" + "\n".join(
            errors[:10]
        )


class TestCycleTimeThreshold:
    """SC-010 / Contract 3: No entry with pr_count < 5 has non-null cycle times."""

    def _check_entry(self, fname: str, level: str, entry: dict) -> list[str]:
        errors = []
        if entry.get("pr_count", 0) < 5:
            if entry.get("cycle_time_p50") is not None:
                errors.append(
                    f"{fname} {level}: pr_count={entry['pr_count']} but cycle_time_p50={entry['cycle_time_p50']}"
                )
            if entry.get("cycle_time_p90") is not None:
                errors.append(
                    f"{fname} {level}: pr_count={entry['pr_count']} but cycle_time_p90={entry['cycle_time_p90']}"
                )
        return errors

    def test_root_level(self, all_rollups):
        errors = []
        for fname, data in all_rollups:
            errors.extend(self._check_entry(fname, "root", data))
        assert not errors, (
            f"{len(errors)} root-level threshold violations:\n" + "\n".join(errors[:10])
        )

    def test_by_repository_level(self, all_rollups):
        errors = []
        for fname, data in all_rollups:
            for repo, entry in data.get("by_repository", {}).items():
                errors.extend(self._check_entry(fname, f"repo/{repo}", entry))
        assert not errors, (
            f"{len(errors)} repo-level threshold violations:\n" + "\n".join(errors[:10])
        )

    def test_by_team_level(self, all_rollups):
        errors = []
        for fname, data in all_rollups:
            for team, entry in data.get("by_team", {}).items():
                errors.extend(self._check_entry(fname, f"team/{team}", entry))
        assert not errors, (
            f"{len(errors)} team-level threshold violations:\n" + "\n".join(errors[:10])
        )

    def test_by_team_and_repo_level(self, all_rollups):
        errors = []
        for fname, data in all_rollups:
            for team, repos in data.get("by_team_and_repo", {}).items():
                for repo, entry in repos.items():
                    errors.extend(
                        self._check_entry(fname, f"team-repo/{team}/{repo}", entry)
                    )
        assert not errors, (
            f"{len(errors)} team-repo-level threshold violations:\n"
            + "\n".join(errors[:10])
        )


class TestAuthorReviewerCaps:
    """FR-016: Team-repo counts <= parent team-level counts."""

    def test_team_repo_authors_capped(self, all_rollups):
        errors = []
        for fname, data in all_rollups:
            by_team = data.get("by_team", {})
            btar = data.get("by_team_and_repo", {})
            for team, repos in btar.items():
                team_authors = by_team.get(team, {}).get("authors_count", 0)
                for repo, entry in repos.items():
                    if entry["authors_count"] > team_authors:
                        errors.append(
                            f"{fname}: {team}/{repo} authors={entry['authors_count']} > team={team_authors}"
                        )
        assert not errors, f"{len(errors)} author cap violations:\n" + "\n".join(
            errors[:10]
        )

    def test_team_repo_reviewers_capped(self, all_rollups):
        errors = []
        for fname, data in all_rollups:
            by_team = data.get("by_team", {})
            btar = data.get("by_team_and_repo", {})
            for team, repos in btar.items():
                team_reviewers = by_team.get(team, {}).get("reviewers_count", 0)
                for repo, entry in repos.items():
                    if entry["reviewers_count"] > team_reviewers:
                        errors.append(
                            f"{fname}: {team}/{repo} reviewers={entry['reviewers_count']} > team={team_reviewers}"
                        )
        assert not errors, f"{len(errors)} reviewer cap violations:\n" + "\n".join(
            errors[:10]
        )
