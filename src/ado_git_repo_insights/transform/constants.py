"""Module-scoped constants for the transform package.

This module holds constants that BOTH ``aggregators.py`` and the
Feature 333 + 334 reconciliation tests must agree on.  Keeping them
here (instead of inside ``aggregators.py``) lets the reconciliation
test in ``tests/integration/test_comments_trend_reconciliation.py``
import the constants without violating the Feature 333 round-9
import-block isolation rule (``aggregators.py`` import is forbidden
by file from that test).

Spec anchors:
- ``specs/334-comments-author-density/spec.md`` FR-1-03, CL-03, ADR T006
- ``specs/310-comments-visualization/spec.md`` "Shared inclusion-rule
  contract (C1)" — single-sentinel-identity rule for unknown authors.
"""

from typing import Final

# Reserved bucket key for ALL PRs whose ``author_id`` is absent from the
# ``users`` table.  The leading-double-underscore namespace cannot collide
# with author_id UUID strings (32 hex chars + 4 hyphens per the existing
# extractor) — see Feature 334 spec Assumption A-07.
#
# Renderer-side label is the fixed English string
# ``"Former / unavailable author"`` (CL-03), kept hard-coded in the
# extension chart module per ADR T006 (renderer-self-contained).
FORMER_OR_UNAVAILABLE_AUTHOR_SENTINEL: Final[str] = "__former_or_unavailable_author__"
