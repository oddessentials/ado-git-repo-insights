"""Demo-suite conftest — scoped R7 session-scope pid-scratch sweep.

The R7 conjunctive sweep (pid-not-self + pid-not-alive +
mtime-before-boot) is owned by ``scripts/clean_ephemeral`` (issue
#327 step 3). It is crash-resilient across reboots and across
sibling pytest workers — covering what the per-module ``atexit``
hook alone cannot.

This fixture is one half of a two-part cleanup contract for
``tmp_test_work/pid-{os.getpid()}/`` scratch. The other half is a
module-level ``atexit`` in ``test_demo_parity_pipeline.py`` that
fires on every process exit, including peer subprocesses that
import the module directly (peer subprocesses do NOT load pytest
conftest, so this fixture never reaches them).

  * Fixture (this file): session-start R7 sweep to reclaim
    CROSS-BOOT stale scratch, plus self-scratch teardown on the
    parent pytest session's normal exit.
  * atexit (test module): per-process cleanup that also covers
    peer subprocesses. Without it, same-boot peer scratch would
    accumulate because R7's mtime-vs-boot-time guard intentionally
    defers same-boot dead-pid scratch.

The two mechanisms are complementary, not redundant.

The fixture is defined HERE rather than in the root
``tests/conftest.py`` on purpose: importing ``scripts/clean_ephemeral``
triggers the psutil hard-fail guard, and only tests under
``tests/demo/`` create ``pid-*`` scratch. The ``test-base-no-ml``
CI job installs the base package WITHOUT the ``[dev]`` extras (no
psutil) and runs ``pytest tests/unit/...`` only; a root-scoped
fixture would pull psutil into that dep-light path and break the
job. Keeping the fixture here means base-only pytest collection
never imports psutil, while every demo-suite invocation gets the
full R7 setup/teardown.

If a future non-demo test starts creating ``pid-*/`` scratch, copy
the fixture into that directory's conftest.py. Do NOT promote it
back to the root conftest without also promoting psutil from
``[project.optional-dependencies].dev`` to base dependencies.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    # Match the root conftest: reference the bare name under
    # mypy_path=["scripts"] so mypy doesn't see "source file found
    # twice".
    import clean_ephemeral as ce
else:
    from scripts import clean_ephemeral as ce

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent


@pytest.fixture(scope="session", autouse=True)
def _sweep_stale_pid_scratch_session() -> Iterator[None]:
    """Session-scope R7 sweep of ``tmp_test_work/pid-*`` scratch.

    Setup (before any tests under tests/demo/ collect): apply the R7
    conjunctive rule to each ``pid-*`` child of ``tmp_test_work/``.
    Eligible children are removed; live sibling workers, this
    process's own scratch, and post-boot scratch are preserved.

    Teardown (after the demo-suite session finishes): best-effort
    remove this session's own ``pid-{os.getpid()}`` scratch so it
    does not accumulate for future sessions to sweep. Failures here
    are non-fatal — the next session's setup will catch leftovers.
    """
    # Loading ``ce`` triggers psutil's hard-fail import guard. If the
    # dev extra is missing, collection surfaces the actionable error.
    # That is the intended behaviour: no silent skip, no fallback.
    tmp_test_work = _REPO_ROOT / "tmp_test_work"
    ce.sweep_stale_pid_children(tmp_test_work, pid_child_pattern="pid-*")
    yield
    self_scratch = tmp_test_work / f"pid-{os.getpid()}"
    if self_scratch.exists():
        ce.rmtree_resilient(self_scratch)
