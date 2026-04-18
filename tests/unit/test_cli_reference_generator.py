"""Tests for ``scripts/generate_cli_reference.py``.

These tests lock the generator's structural behavior against ``create_parser()``.
Doc-level parity tests (generated regions byte-exact against the committed
``docs/reference/cli-reference.md``, golden-hash fixture check, marker-layout
checks) are added alongside the initial doc regeneration in a later commit so
every intermediate commit keeps a green test suite.
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
    expected = snapshot_path.read_text(encoding="utf-8")
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
