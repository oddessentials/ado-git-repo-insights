"""Doc-coverage parity: every CommandSpec name in run_pr_preflight.py must
appear as a double-quoted string in LOCAL_CI_PARITY_INVARIANTS.md.

Scope is intentionally narrow: **verbatim name presence only**. The test does
NOT care where the cite lives, whether it is in a Tier 1 or Tier 2 row, or
how the surrounding prose is written. That deliberately preserves the parts
of the doc that are authoritative (the named-gate contract) without locking
prose, row structure, or formatting — issue #286.

Adversarial tests prove the checker catches both a fabricated new
CommandSpec without a doc cite and a removed cite for an existing
CommandSpec.
"""

from __future__ import annotations

import ast
import re
import textwrap
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
PREFLIGHT_SCRIPT = REPO_ROOT / "scripts" / "run_pr_preflight.py"
PARITY_DOC = REPO_ROOT / "LOCAL_CI_PARITY_INVARIANTS.md"


def _extract_command_spec_names(source: str) -> set[str]:
    """AST-walk source; return every ``CommandSpec(...)`` first-positional
    string-literal argument.

    Implementation mirrors the helper pattern in ``test_ci_parity_drift.py``
    but stays local so this file is self-contained on source and can be run
    without the sibling module's fixtures.
    """
    tree = ast.parse(source)
    names: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not isinstance(func, ast.Name) or func.id != "CommandSpec":
            continue
        if not node.args:
            continue
        first = node.args[0]
        if isinstance(first, ast.Constant) and isinstance(first.value, str):
            names.add(first.value)
    return names


_QUOTED_STRING_RE = re.compile(r'"([^"\n]+)"')


def _extract_quoted_strings(doc: str) -> set[str]:
    """Return every double-quoted string in the doc.

    Handles both ``CommandSpec "X"`` and compound
    ``CommandSpecs "A" and "B"`` forms — the regex pulls each quoted token
    individually, so compound forms contribute both names.
    """
    return set(_QUOTED_STRING_RE.findall(doc))


def test_every_command_spec_name_is_cited_in_parity_doc() -> None:
    """Subset check: ``names(preflight) ⊆ quoted_strings(doc)``.

    Failure message prints the missing names with a suggested one-line cite
    template so the remediation is obvious.
    """
    preflight_source = PREFLIGHT_SCRIPT.read_text(encoding="utf-8")
    doc_text = PARITY_DOC.read_text(encoding="utf-8")
    spec_names = _extract_command_spec_names(preflight_source)
    assert spec_names, "AST walk of run_pr_preflight.py found zero CommandSpecs"
    quoted = _extract_quoted_strings(doc_text)
    missing = sorted(name for name in spec_names if name not in quoted)
    if missing:
        lines = [
            f'  - CommandSpec "{name}" — add a verbatim citation to the'
            " relevant row in LOCAL_CI_PARITY_INVARIANTS.md"
            for name in missing
        ]
        raise AssertionError(
            "CommandSpec names missing from LOCAL_CI_PARITY_INVARIANTS.md:\n"
            + "\n".join(lines)
            + "\n\nEach preflight CommandSpec must appear verbatim as a "
            "double-quoted string somewhere in the doc. This is a "
            "name-presence check only — row location, prose, and "
            "formatting are not enforced."
        )


class TestParityDocCoverageAdversarial:
    """Standing-invariant requirement: never claim enforcement without proof.

    These tests prove the checker catches (a) a fabricated new CommandSpec
    without a doc cite and (b) a removed cite for an existing CommandSpec.
    They operate on in-memory strings so they cannot touch the live files.
    """

    def _real_sources(self) -> tuple[str, str]:
        return (
            PREFLIGHT_SCRIPT.read_text(encoding="utf-8"),
            PARITY_DOC.read_text(encoding="utf-8"),
        )

    def _subset_fails(self, preflight_source: str, doc_text: str) -> list[str]:
        names = _extract_command_spec_names(preflight_source)
        quoted = _extract_quoted_strings(doc_text)
        return sorted(name for name in names if name not in quoted)

    def test_real_sources_pass_baseline(self) -> None:
        """Sanity: on the real files, the subset check has zero missing
        names. If this regresses, something else has gone wrong — the
        adversarial cases below cannot be trusted otherwise.
        """
        preflight_source, doc_text = self._real_sources()
        assert self._subset_fails(preflight_source, doc_text) == []

    def test_catches_fabricated_new_command_spec_without_cite(self) -> None:
        """Append a bogus ``CommandSpec`` to the source with a name that the
        doc cannot possibly contain. The check must flag it.
        """
        preflight_source, doc_text = self._real_sources()
        fabricated = (
            '__SENTINEL_NOT_IN_DOC_'
            'xyzzy_unique_marker_286__'
        )
        tampered_source = preflight_source + textwrap.dedent(
            f'''

            # Adversarial fabrication — not part of the real command list.
            _ = CommandSpec(
                "{fabricated}",
                ("__PYTHON__", "scripts/does_not_exist.py"),
            )
            '''
        )
        missing = self._subset_fails(tampered_source, doc_text)
        assert fabricated in missing, (
            "Fabricated CommandSpec not detected — the checker would let "
            "a new gate ship without a doc cite."
        )

    def test_catches_removed_cite_for_existing_command_spec(self) -> None:
        """Remove every double-quoted occurrence of an existing CommandSpec
        name from the doc; the check must now report it as missing.
        """
        preflight_source, doc_text = self._real_sources()
        # Pick a canonical, stable name that we know is cited today.
        target = "Python type check"
        assert f'"{target}"' in doc_text, (
            f"Precondition broken: expected doc to cite \"{target}\"."
        )
        tampered_doc = doc_text.replace(f'"{target}"', '"<removed-for-test>"')
        missing = self._subset_fails(preflight_source, tampered_doc)
        assert target in missing, (
            "Removed doc cite not detected — the checker would let a "
            "citation drop silently."
        )


class TestParityDocCoverageHelpers:
    """Direct-unit coverage for the extraction primitives. Keeps the
    adversarial tests honest by pinning the shape of the helpers they use.
    """

    def test_extract_command_spec_names_pulls_first_positional_literal(
        self,
    ) -> None:
        source = textwrap.dedent(
            '''
            CommandSpec("Alpha", ("python", "x"))
            CommandSpec("Beta", ("python", "y"))
            CommandSpec(name_var, ("python", "z"))  # dynamic — ignored
            '''
        )
        names = _extract_command_spec_names(source)
        assert names == {"Alpha", "Beta"}

    def test_extract_quoted_strings_handles_compound_citation(self) -> None:
        doc = (
            'Row uses CommandSpec "Extension build check" alone and '
            'CommandSpecs "Alpha Gate" and "Beta Gate" compounded.'
        )
        quoted = _extract_quoted_strings(doc)
        assert {"Extension build check", "Alpha Gate", "Beta Gate"} <= quoted


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
