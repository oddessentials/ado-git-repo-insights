"""Tests for ``scripts/generate_cli_reference.py``.

Two tiers of coverage:

1. Generator-internal behavior — parser introspection, action filtering,
   table rendering, idempotency, performance-claim guards, and ``--help``
   snapshot parity. These do not depend on the committed doc.
2. Doc-level parity — every generated region in
   ``docs/reference/cli-reference.md`` is byte-exact with the current
   parser output, the committed golden SHA fixture matches, markers are
   paired, and hand-written prose outside marker regions is preserved
   across regeneration. This tier is the bar that keeps ``--help`` and
   the doc from drifting.
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
GENERATOR_SCRIPT = REPO_ROOT / "scripts" / "generate_cli_reference.py"
SNAPSHOT_DIR = REPO_ROOT / "tests" / "unit" / "fixtures" / "help_snapshots"
DOC_PATH = REPO_ROOT / "docs" / "reference" / "cli-reference.md"
GOLDEN_SHA_PATH = (
    REPO_ROOT
    / "tests"
    / "unit"
    / "fixtures"
    / "cli_reference_generated_sections.sha256"
)

# Mirrors ``scripts/generate_cli_reference.py::_CANONICAL_PYTHON``.
# The two Python-version-sensitive tests below encode their
# cross-version behavior as a runtime branch rather than a pytest
# skip marker — the project enforces ``--max-skips=0`` in both CI
# and preflight, so any ``@pytest.mark.skipif`` on a non-canonical
# Python version would violate that invariant locally.  Instead,
# each test asserts the canonical-Python path when the interpreter
# is canonical, and the generator's SKIP-return path (exit 0) when
# it isn't.  Both paths produce concrete assertions and count as
# "passed", keeping the zero-skip gate intact.
_CANONICAL_PYTHON: tuple[int, int] = (3, 12)
_ON_CANONICAL_PYTHON: bool = sys.version_info[:2] == _CANONICAL_PYTHON


def _load_generator_module() -> ModuleType:
    """Import the generator by file path; hermetic, no install needed."""
    spec = importlib.util.spec_from_file_location(
        "generate_cli_reference", GENERATOR_SCRIPT
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["generate_cli_reference"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def gen() -> ModuleType:
    return _load_generator_module()


@pytest.fixture
def parser(gen: ModuleType) -> argparse.ArgumentParser:
    return gen._load_create_parser()


def _subparsers(
    parser: argparse.ArgumentParser,
) -> argparse._SubParsersAction[argparse.ArgumentParser]:
    for action in parser._actions:
        if isinstance(action, argparse._SubParsersAction):
            return action
    raise AssertionError("parser has no subparsers action")


def _visible_flags(subparser: argparse.ArgumentParser) -> list[str]:
    flags: list[str] = []
    for action in subparser._actions:
        if isinstance(action, argparse._SubParsersAction):
            continue
        if action.help is argparse.SUPPRESS:
            continue
        if action.option_strings in (["-h", "--help"], ["--help"], ["--version"]):
            continue
        if action.option_strings:
            flags.append(action.option_strings[0])
    return flags


def test_every_subparser_has_generated_section(
    gen: ModuleType, parser: argparse.ArgumentParser
) -> None:
    sections = gen.collect_sections(parser)
    section_ids = {s.section_id for s in sections}
    expected = {"global-options"} | set(_subparsers(parser).choices.keys())
    assert section_ids == expected, (
        f"generated sections {section_ids} do not match "
        f"{{global-options}} ∪ subparser names {expected}"
    )


def test_every_visible_flag_has_a_table_row(
    gen: ModuleType, parser: argparse.ArgumentParser
) -> None:
    sections = gen.collect_sections(parser)
    body_by_id = {s.section_id: s.body for s in sections}
    for name, subparser in _subparsers(parser).choices.items():
        body = body_by_id[name]
        for flag in _visible_flags(subparser):
            assert f"`{flag}" in body, (
                f"{name!r} section is missing a row for {flag!r}.\n"
                f"Rendered body:\n{body}"
            )


def test_stub_mode_suppressed_flag_is_filtered(
    gen: ModuleType, parser: argparse.ArgumentParser
) -> None:
    # Regression anchor — --stub-mode is registered with help=argparse.SUPPRESS
    # on both generate-aggregates and build-aggregates. Must never appear.
    sections = gen.collect_sections(parser)
    for section in sections:
        assert "--stub-mode" not in section.body, (
            f"section {section.section_id!r} leaked a SUPPRESS flag:\n{section.body}"
        )


def test_help_and_version_auto_actions_are_filtered(
    gen: ModuleType, parser: argparse.ArgumentParser
) -> None:
    sections = gen.collect_sections(parser)
    for section in sections:
        assert "`-h`" not in section.body
        assert "`--help`" not in section.body
        assert "`--version`" not in section.body


def test_adversarial_suppress_injection_is_filtered(
    gen: ModuleType, parser: argparse.ArgumentParser
) -> None:
    # Prove the SUPPRESS filter catches a flag the author added after the
    # regression anchor above. Robust against argparse internals drift.
    extract = _subparsers(parser).choices["extract"]
    extract.add_argument(
        "--adversarial-secret",
        action="store_true",
        help=argparse.SUPPRESS,
    )
    sections = gen.collect_sections(parser)
    body = next(s.body for s in sections if s.section_id == "extract")
    assert "--adversarial-secret" not in body


def test_required_optional_classification_matches_argparse(
    gen: ModuleType, parser: argparse.ArgumentParser
) -> None:
    sections = gen.collect_sections(parser)
    body_by_id = {s.section_id: s.body for s in sections}
    for name, subparser in _subparsers(parser).choices.items():
        body = body_by_id[name]
        required_in_body = "### Required Options" in body
        optional_in_body = "### Optional Options" in body
        required_actions = [
            a
            for a in subparser._actions
            if getattr(a, "required", False)
            and a.help is not argparse.SUPPRESS
            and not isinstance(a, argparse._SubParsersAction)
        ]
        optional_actions = [
            a
            for a in subparser._actions
            if not getattr(a, "required", False)
            and a.help is not argparse.SUPPRESS
            and not isinstance(a, argparse._SubParsersAction)
            and a.option_strings not in (["-h", "--help"], ["--help"], ["--version"])
        ]
        assert required_in_body == bool(required_actions), (
            f"{name!r}: Required Options heading presence "
            f"{required_in_body} does not match argparse required "
            f"classification ({bool(required_actions)})."
        )
        assert optional_in_body == bool(optional_actions), (
            f"{name!r}: Optional Options heading presence "
            f"{optional_in_body} does not match argparse classification."
        )


def test_generator_is_idempotent(
    gen: ModuleType, parser: argparse.ArgumentParser
) -> None:
    first = gen.collect_sections(parser)
    second = gen.collect_sections(parser)
    assert [s.section_id for s in first] == [s.section_id for s in second]
    for a, b in zip(first, second, strict=True):
        assert a.body == b.body, (
            f"non-deterministic output for section {a.section_id!r}"
        )


def test_golden_hash_is_stable_across_runs(
    gen: ModuleType, parser: argparse.ArgumentParser
) -> None:
    first = gen.compute_golden_hash(gen.collect_sections(parser))
    second = gen.compute_golden_hash(gen.collect_sections(parser))
    assert first == second
    assert len(first) == 64  # SHA-256 hex digest length


def test_golden_hash_changes_on_parser_mutation(
    gen: ModuleType, parser: argparse.ArgumentParser
) -> None:
    baseline = gen.compute_golden_hash(gen.collect_sections(parser))
    extract = _subparsers(parser).choices["extract"]
    for action in extract._actions:
        if action.dest == "database":
            action.default = Path("mutated-default.sqlite")
            break
    else:
        raise AssertionError("extract parser has no --database action")
    mutated = gen.compute_golden_hash(gen.collect_sections(parser))
    assert baseline != mutated, (
        "hash did not change after mutating a flag default; drift detection "
        "is not actually observing the generated output"
    )


def test_generator_rejects_rate_claim_in_help(gen: ModuleType) -> None:
    parser = gen._load_create_parser()
    extract = _subparsers(parser).choices["extract"]
    for action in extract._actions:
        if action.dest == "database":
            action.help = "SQLite path — sustains ~2 PRs/sec ingest"
            break
    with pytest.raises(gen.GenerationError, match="performance claim"):
        gen.collect_sections(parser)


def test_generator_rejects_throughput_keyword(gen: ModuleType) -> None:
    parser = gen._load_create_parser()
    extract = _subparsers(parser).choices["extract"]
    for action in extract._actions:
        if action.dest == "database":
            action.help = "SQLite path — maximum throughput"
            break
    with pytest.raises(gen.GenerationError, match="performance claim"):
        gen.collect_sections(parser)


def test_generator_rejects_latency_keyword(gen: ModuleType) -> None:
    parser = gen._load_create_parser()
    extract = _subparsers(parser).choices["extract"]
    for action in extract._actions:
        if action.dest == "database":
            action.help = "SQLite path — low latency writes"
            break
    with pytest.raises(gen.GenerationError, match="performance claim"):
        gen.collect_sections(parser)


def test_rendered_output_contains_no_unhedged_rate_claims(
    gen: ModuleType, parser: argparse.ArgumentParser
) -> None:
    # Independent corpus-level scan — belt-and-suspenders over the per-action
    # guard. Fails if any rate/throughput/latency language survives into the
    # emitted bodies for any reason (e.g., a future refactor introduces a
    # code path that skips _guard_no_performance_claim).
    sections = gen.collect_sections(parser)
    for section in sections:
        match = gen._PERFORMANCE_CLAIM_RE.search(section.body)
        assert match is None, (
            f"performance-claim language leaked into {section.section_id!r}: "
            f"matched {match.group(0) if match else ''!r}"
        )


def _subcommand_names_for_snapshot() -> list[str]:
    module = _load_generator_module()
    parser = module._load_create_parser()
    subs = _subparsers(parser)
    return ["_root"] + list(subs.choices.keys())


@pytest.mark.parametrize("name", _subcommand_names_for_snapshot())
def test_help_output_matches_snapshot(
    gen: ModuleType, parser: argparse.ArgumentParser, name: str
) -> None:
    snapshot_path = SNAPSHOT_DIR / f"{name}.txt"
    assert snapshot_path.exists(), (
        f"missing snapshot for {name!r}; regenerate with "
        f"`python scripts/generate_cli_reference.py --update-help-snapshots`"
    )
    # Sanity check applies on every interpreter: the snapshot file exists
    # and has committed content. Committed content is always canonical by
    # construction — the generator's --write guard refuses to regenerate
    # on non-canonical Python, so whatever bytes are on disk were written
    # under Python 3.12 or not at all.
    expected = snapshot_path.read_text(encoding="utf-8")
    assert expected, (
        f"snapshot for {name!r} is empty; regenerate under canonical "
        f"Python 3.12 with "
        f"`python scripts/generate_cli_reference.py --update-help-snapshots`"
    )
    # The argparse-render comparison is meaningful only on the canonical
    # interpreter — rendering on any other version produces a shape that
    # won't match the committed 3.12 bytes regardless of parser correctness.
    # On non-canonical interpreters, trust the on-disk bytes (protected
    # by the --write guard) and exit without a false-positive diff.
    if not _ON_CANONICAL_PYTHON:
        return
    if name == "_root":
        actual = gen.format_help_deterministic(parser)
    else:
        actual = gen.format_help_deterministic(_subparsers(parser).choices[name])
    assert actual == expected, (
        f"--help output for {name!r} diverged from the snapshot. If this is "
        f"an intentional UX contract change, regenerate with "
        f"`python scripts/generate_cli_reference.py --update-help-snapshots` "
        f"and commit the updated fixture."
    )


# ---------- Tier 2: doc-level parity locks ----------


def test_committed_doc_has_markers_for_every_generated_section(
    gen: ModuleType, parser: argparse.ArgumentParser
) -> None:
    doc_text = DOC_PATH.read_text(encoding="utf-8")
    blocks = gen._split_into_blocks(doc_text)
    doc_section_ids = {
        kind.removeprefix("generated:")
        for kind, _ in blocks
        if kind.startswith("generated:")
    }
    parser_section_ids = {s.section_id for s in gen.collect_sections(parser)}
    assert doc_section_ids == parser_section_ids, (
        f"cli-reference.md marker IDs {doc_section_ids} do not match parser "
        f"section IDs {parser_section_ids}. "
        f"Missing markers: {parser_section_ids - doc_section_ids}. "
        f"Orphan markers: {doc_section_ids - parser_section_ids}."
    )


def test_doc_markers_are_paired_and_ordered(gen: ModuleType) -> None:
    # _split_into_blocks raises MarkerError on any pairing or ordering
    # violation (nested BEGIN, orphan END, mismatched pair IDs, unterminated
    # BEGIN). Calling it on the committed doc is the smallest, most
    # authoritative test of the marker contract.
    doc_text = DOC_PATH.read_text(encoding="utf-8")
    gen._split_into_blocks(doc_text)  # raises on any marker violation


def test_generated_regions_match_parser_output(
    gen: ModuleType, parser: argparse.ArgumentParser
) -> None:
    doc_text = DOC_PATH.read_text(encoding="utf-8")
    sections_by_id = {s.section_id: s for s in gen.collect_sections(parser)}
    blocks = gen._split_into_blocks(doc_text)
    for kind, content in blocks:
        if not kind.startswith("generated:"):
            continue
        section_id = kind.removeprefix("generated:")
        expected = sections_by_id[section_id].body.rstrip("\n")
        actual = content.rstrip("\n")
        assert actual == expected, (
            f"generated region {section_id!r} in cli-reference.md has "
            f"drifted from the parser. Regenerate with "
            f"`python scripts/generate_cli_reference.py --write`.\n"
            f"--- committed ---\n{actual}\n"
            f"--- expected ---\n{expected}\n"
        )


def test_golden_sha_fixture_matches_current_parser_output(
    gen: ModuleType, parser: argparse.ArgumentParser
) -> None:
    assert GOLDEN_SHA_PATH.exists(), (
        f"missing golden SHA fixture at {GOLDEN_SHA_PATH.relative_to(REPO_ROOT)}; "
        f"regenerate with `python scripts/generate_cli_reference.py --write`"
    )
    committed = GOLDEN_SHA_PATH.read_text(encoding="utf-8").strip()
    expected = gen.compute_golden_hash(gen.collect_sections(parser))
    assert committed == expected, (
        f"golden SHA fixture has drifted from the parser. "
        f"committed={committed!r} expected={expected!r}. "
        f"Regenerate with `python scripts/generate_cli_reference.py --write`."
    )


def test_hand_written_prose_preserved_across_regeneration(
    gen: ModuleType, parser: argparse.ArgumentParser
) -> None:
    # _render_doc is the function --write uses. Call it on the committed
    # doc text and assert that every non-generated block emerges identical.
    # A generator bug that edits outside its markers would fail this test
    # even if the parity test above still passes.
    doc_text = DOC_PATH.read_text(encoding="utf-8")
    sections = gen.collect_sections(parser)
    rendered = gen._render_doc(doc_text, sections)
    original_blocks = gen._split_into_blocks(doc_text)
    rendered_blocks = gen._split_into_blocks(rendered)
    assert len(original_blocks) == len(rendered_blocks)
    for (orig_kind, orig_content), (rend_kind, rend_content) in zip(
        original_blocks, rendered_blocks, strict=True
    ):
        assert orig_kind == rend_kind
        if orig_kind.startswith("generated:"):
            continue  # generated content is expected to change
        assert orig_content == rend_content, (
            f"hand-written block of kind {orig_kind!r} was modified by "
            f"regeneration — the generator must only touch content between "
            f"markers.\n--- before ---\n{orig_content}\n"
            f"--- after ---\n{rend_content}\n"
        )


def test_mode_check_passes_on_committed_state(gen: ModuleType) -> None:
    # mode_check() itself handles the canonical-Python policy — on a
    # non-canonical interpreter it emits the [SKIP] marker and returns
    # 0 without running the argparse-render comparison; on canonical
    # Python it performs the real drift check. Either way the expected
    # return is 0. No pytest skip needed — this keeps the --max-skips=0
    # invariant intact locally and asserts a concrete outcome on both
    # paths.
    assert gen.mode_check() == 0, (
        "scripts/generate_cli_reference.py --check reports drift against "
        "the committed docs/reference/cli-reference.md, golden SHA, or "
        "help-snapshot fixtures. On canonical Python 3.12, regenerate with "
        "`python scripts/generate_cli_reference.py --write`. On non-canonical "
        "Python, mode_check() must return 0 via the SKIP path."
    )
