"""Shared vote-event classification for Azure DevOps PR system comments.

Azure DevOps emits ``commentType="system"`` rows on PR threads for every
reviewer vote action.  Each such row's ``content`` matches the literal
shape ``"<name> voted <integer>"`` (e.g., ``"PM P voted 10"``,
``"admin@oddessentials.com voted -10"``).  Vote integers map to:

* ``10``  — Approve
* ``5``   — Approve with suggestions
* ``0``   — Reset (no vote)
* ``-5``  — Waiting for author
* ``-10`` — Reject

This module owns the authoritative regex and the boolean classifier so
that every consumer — review-time extraction (``review_time.py``),
aggregator emissions (``transform/aggregators.py``), and tests —
shares one definition.  Adding a second copy anywhere is a contract
violation: the parser-equivalence tests at
``tests/unit/test_vote_events.py`` enforce that the Python helper and
the SQLite-registered counterpart classify identical fixture strings
identically.
"""

from __future__ import annotations

import re
from typing import Final

# Authoritative compiled regex for ADO vote-event content.  Anchored to
# both ends so trailing text after the integer (e.g.,
# ``"PM P voted 10 today"``) and incidental ``voted`` prose
# (e.g., ``"I have voted in the past"``) are correctly rejected.
VOTE_PATTERN: Final[re.Pattern[str]] = re.compile(r"^(.+) voted (-?\d+)$")


def is_vote_event(content: str | None) -> bool:
    """Return True iff ``content`` matches the ADO vote-event shape.

    Returns False for ``None``, empty strings, whitespace-only strings,
    and any non-vote content (including system messages that mention
    ``voted`` incidentally).  Safe to register as a SQLite scalar
    function; SQLite passes ``NULL`` through as Python ``None``.
    """
    if content is None:
        return False
    return VOTE_PATTERN.match(content) is not None
