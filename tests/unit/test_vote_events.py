"""Parser-equivalence tests for the shared vote-event helper.

These tests lock the contract that:

1. ``ado_git_repo_insights.extraction.vote_events.is_vote_event`` and
   ``ado_git_repo_insights.extraction.vote_events.VOTE_PATTERN`` classify
   the canonical truth table of ADO PR system-comment shapes correctly,
   including incidental "voted" prose and trailing-text negatives.
2. The same helper, registered as a SQLite scalar function, classifies
   every fixture string identically to its Python counterpart — proving
   the SQLite-side aggregator path used by ``transform/aggregators.py``
   for ``vote_event_count`` cannot drift from the Python-side parser
   used by ``extraction/review_time.py``.
3. Integer extraction via the shared ``VOTE_PATTERN`` matches the
   historical ``populate_review_timestamps`` semantic — proving the
   helper-lift did not subtly shift Approve / Reject / Reset detection
   or vote-value parsing.
4. ``review_time.py`` no longer carries a private duplicate of the
   regex.

Authoritative fixture set lives in :data:`VOTE_FIXTURES`; every test
parametrizes over the same table so a future addition lands in one
place and exercises every surface uniformly.
"""

from __future__ import annotations

import sqlite3
from typing import Final

import pytest

from ado_git_repo_insights.extraction import review_time, vote_events
from ado_git_repo_insights.extraction.vote_events import (
    VOTE_PATTERN,
    is_vote_event,
)

# Canonical truth table.  Each row: ``(content, expected_is_vote_event,
# expected_int_or_None)``.  The integer column is None for negatives.
# Test ids are stable so failure output points at the specific shape.
VOTE_FIXTURES: Final = [
    # Positive cases — every ADO vote action.
    pytest.param("PM P voted 10", True, 10, id="approve"),
    pytest.param(
        "admin@oddessentials.com voted 5", True, 5, id="approve-with-suggestions"
    ),
    pytest.param("PM P voted 0", True, 0, id="reset"),
    pytest.param("admin@oddessentials.com voted -5", True, -5, id="wait-for-author"),
    pytest.param("admin@oddessentials.com voted -10", True, -10, id="reject"),
    pytest.param("José García voted 10", True, 10, id="unicode-name-approve"),
    pytest.param("user@example.com voted -10", True, -10, id="email-style-reject"),
    pytest.param("X voted 10", True, 10, id="single-char-name"),
    # Negative cases — must NOT match.
    pytest.param("PM P voted 10 today", False, None, id="trailing-text-after-int"),
    pytest.param("I have voted in the past", False, None, id="incidental-voted-prose"),
    # PR #360 review (Codex P2): explicit guards that the canonical
    # classifier rejects the two looser-GLOB false-positive shapes the
    # reconciliation test used to admit before #356 align-reconciliation
    # switched it to call this same helper as a SQLite UDF.
    pytest.param(
        "I have voted 2 times", False, None, id="trailing-text-i-have-voted-N-times"
    ),
    pytest.param(
        "alice voted 10 today", False, None, id="trailing-text-alice-voted-N-today"
    ),
    pytest.param("voted 10", False, None, id="no-name-prefix"),
    pytest.param("PM P voted abc", False, None, id="non-integer-suffix"),
    pytest.param("PM P voted", False, None, id="no-integer"),
    pytest.param("PM P voted ", False, None, id="trailing-space-no-int"),
    pytest.param("", False, None, id="empty-string"),
    pytest.param("   ", False, None, id="whitespace-only"),
]


@pytest.mark.parametrize(("content", "expected_bool", "_expected_int"), VOTE_FIXTURES)
def test_python_helper_classifies_vote_events(
    content: str, expected_bool: bool, _expected_int: int | None
) -> None:
    """``is_vote_event`` must match the canonical truth table for every fixture."""
    assert is_vote_event(content) is expected_bool


def test_python_helper_handles_none() -> None:
    """``is_vote_event(None)`` must return False without raising.

    SQLite passes NULL through as Python None when invoking registered
    scalar functions; the helper has to tolerate that without raising
    or the aggregator's ``SUM(CASE WHEN is_vote_event(content)`` path
    would crash on NULL ``pr_comments.content`` rows.
    """
    assert is_vote_event(None) is False


@pytest.mark.parametrize(("content", "expected_bool", "_expected_int"), VOTE_FIXTURES)
def test_sqlite_function_matches_python_helper(
    content: str, expected_bool: bool, _expected_int: int | None
) -> None:
    """SQLite-registered ``is_vote_event`` must classify identically to the Python helper.

    This is the parser-equivalence guarantee: register the same helper
    on a fresh in-memory connection and prove the SQL-side classification
    matches the Python-side classification on every fixture.  If a
    future change lands a SQL-only refinement (e.g., a bespoke ``LIKE``
    pattern), this test will fail until the same change is applied to
    the Python helper too.
    """
    conn = sqlite3.connect(":memory:")
    try:
        conn.create_function("is_vote_event", 1, is_vote_event, deterministic=True)
        cur = conn.execute("SELECT is_vote_event(?)", (content,))
        result_raw = cur.fetchone()[0]
        # SQLite stores Python bool returns as 0 / 1 integers; bool()
        # collapses both representations safely.
        result_bool = bool(result_raw)
        assert result_bool == is_vote_event(content)
        assert result_bool is expected_bool
    finally:
        conn.close()


def test_sqlite_function_handles_null() -> None:
    """``SELECT is_vote_event(NULL)`` must return falsey, matching ``is_vote_event(None)``."""
    conn = sqlite3.connect(":memory:")
    try:
        conn.create_function("is_vote_event", 1, is_vote_event, deterministic=True)
        cur = conn.execute("SELECT is_vote_event(NULL)")
        result_raw = cur.fetchone()[0]
        assert bool(result_raw) is False
    finally:
        conn.close()


@pytest.mark.parametrize(("content", "expected_bool", "expected_int"), VOTE_FIXTURES)
def test_review_time_integer_extraction_parity(
    content: str, expected_bool: bool, expected_int: int | None
) -> None:
    """Integer extraction via the shared ``VOTE_PATTERN`` matches review_time semantics.

    ``populate_review_timestamps`` previously matched
    ``re.compile(r"^(.+) voted (-?\\d+)$")`` and called
    ``int(match.group(2))`` on the second capture group.  After the
    lift, the same pattern object is reused — but this test asserts the
    integer extraction yields the same value on the canonical fixture
    set, so a regression in either direction (regex change or
    capture-group reorder) fails loud.
    """
    match = VOTE_PATTERN.match(content)
    if expected_bool:
        assert match is not None, f"Expected vote-event match on {content!r}"
        assert int(match.group(2)) == expected_int
    else:
        assert match is None, f"Did NOT expect vote-event match on {content!r}"


def test_review_time_imports_shared_pattern() -> None:
    """``review_time`` must consume the lifted helper, not duplicate the regex.

    Asserts:

    * ``vote_events.VOTE_PATTERN`` exists (canonical compiled pattern).
    * ``vote_events.is_vote_event`` exists (canonical boolean helper).
    * ``review_time._VOTE_PATTERN`` does NOT exist — proves the lift
      didn't leave a stale duplicate behind.
    """
    assert hasattr(vote_events, "VOTE_PATTERN")
    assert hasattr(vote_events, "is_vote_event")
    assert not hasattr(review_time, "_VOTE_PATTERN"), (
        "review_time.py still defines _VOTE_PATTERN; the helper-lift left "
        "a duplicate.  Remove it and import VOTE_PATTERN from "
        "ado_git_repo_insights.extraction.vote_events instead."
    )
