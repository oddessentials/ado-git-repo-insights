#!/usr/bin/env python3
"""Deterministically generate the per-subcommand flag tables in
``docs/reference/cli-reference.md`` from ``create_parser()``.

Run modes:
    --write                    Regenerate marked regions in-place and refresh
                               fixtures (golden SHA, help snapshots).
    --check                    Exit non-zero with a unified diff if any
                               generated region diverges from the parser.
    --update-help-snapshots    Rewrite ``tests/unit/fixtures/help_snapshots/``
                               from the current parser. Only needed when a
                               ``--help`` contract change is intentional.

The generator is the single source of truth; ``docs/reference/cli-reference.md``
carries generated content only between matched ``<!-- BEGIN GENERATED:
cli-reference:<id> -->`` / ``<!-- END GENERATED: cli-reference:<id> -->``
markers. Every other section is hand-written and preserved byte-for-byte.

Cross-OS determinism: all output is written with LF line endings and help
text is rendered with ``COLUMNS=100`` forced so that captured snapshots and
hashes reproduce on Windows, macOS, and Linux without depending on terminal
width.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import re
import sys
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from ado_git_repo_insights.cli import create_parser as _create_parser

_CANONICAL_PYTHON: tuple[int, int] = (3, 12)
"""Python (major, minor) that CI uses for all cli-reference operations.

Kept in sync with the ``test`` matrix in ``.github/workflows/ci.yml``
and the ``cli-reference-drift`` standalone job. argparse help-text
rendering is not byte-stable across Python versions — notably
Python 3.14's usage formatter ignores the ``width`` constructor
argument for the subparser-choices line where 3.12 honors it — so
running this generator on a non-canonical version silently produces
snapshots that pass a local tautological ``--check`` (regen against
own regen) but diverge from CI's regen.  Pinning forces the
drift-detection surface to be the SAME surface CI sees.
"""

REPO_ROOT = Path(__file__).resolve().parent.parent
DOC_PATH = REPO_ROOT / "docs" / "reference" / "cli-reference.md"
SNAPSHOT_DIR = REPO_ROOT / "tests" / "unit" / "fixtures" / "help_snapshots"
GOLDEN_SHA_PATH = (
    REPO_ROOT
    / "tests"
    / "unit"
    / "fixtures"
    / "cli_reference_generated_sections.sha256"
)

MARKER_PREFIX = "cli-reference:"
BEGIN_MARKER_RE = re.compile(
    r"<!-- BEGIN GENERATED: " + re.escape(MARKER_PREFIX) + r"(?P<id>[a-z0-9\-]+) -->"
)
END_MARKER_RE = re.compile(
    r"<!-- END GENERATED: " + re.escape(MARKER_PREFIX) + r"(?P<id>[a-z0-9\-]+) -->"
)

# Performance-claim guard — mirrors test_backfill_doc_parity.py's rate
# pattern and rejects the generation-time emission of any throughput or
# latency language into the tables. The tables describe flag semantics;
# behavioral performance notes belong in hand-written "### Behavior notes"
# prose where the corpus-wide hedge sweep can verify empirical framing.
_PERFORMANCE_CLAIM_RE = re.compile(
    r"(~\s*\d+\s*PRs?\s*/\s*sec"
    r"|one\s+PR\s+per\s+second"
    r"|PRs?\s+per\s+(?:minute|hour|sec(?:ond)?)"
    r"|throughput"
    r"|(?<!\w)latency(?!\s*(?:free|=))"
    r")",
    re.IGNORECASE,
)

DETERMINISTIC_COLUMNS = "100"


@dataclass(frozen=True)
class GeneratedSection:
    """One contiguous region of generated markdown."""

    section_id: str
    body: str  # LF-terminated, does NOT include the marker lines themselves


class GenerationError(RuntimeError):
    """Raised when generation fails a structural or content invariant."""


class MarkerError(RuntimeError):
    """Raised when the doc's marker layout is malformed."""


# ---------- parser loading ----------------------------------------------------


def _load_create_parser() -> argparse.ArgumentParser:
    """Build a fresh top-level parser via ``create_parser()``.

    Wrapped so tests can monkey-patch the binding on this module to inject
    a modified parser (see ``test_cli_reference_generator.py``).
    """
    return _create_parser()


def _get_subparsers_action(
    parser: argparse.ArgumentParser,
) -> argparse._SubParsersAction[argparse.ArgumentParser]:
    for action in parser._actions:
        if isinstance(action, argparse._SubParsersAction):
            return action
    raise GenerationError("top-level parser has no subparsers action")


# ---------- action filtering and rendering ------------------------------------


def _is_auto_action(action: argparse.Action) -> bool:
    """Return True for argparse's auto-added ``--help``/``--version`` actions.

    Matched by ``option_strings`` rather than private action classes so the
    filter is robust to argparse internals changes.
    """
    if action.option_strings in (["-h", "--help"], ["--help"]):
        return True
    if action.option_strings == ["--version"]:
        return True
    return False


def _should_skip_action(action: argparse.Action) -> bool:
    if isinstance(action, argparse._SubParsersAction):
        return True
    if action.help is argparse.SUPPRESS:
        return True
    if _is_auto_action(action):
        return True
    return False


def _guard_no_performance_claim(action: argparse.Action) -> None:
    """Refuse to emit help text that smuggles a performance claim into a table.

    Performance claims are permitted in hand-written prose where the
    corpus-wide hedge sweep (``test_backfill_doc_parity.py``) verifies them,
    but never inside a generated flag row — that would bypass the hedge test.
    """
    if action.help is None or action.help is argparse.SUPPRESS:
        return
    match = _PERFORMANCE_CLAIM_RE.search(action.help)
    if match is None:
        return
    flag = action.option_strings[0] if action.option_strings else action.dest
    raise GenerationError(
        f"Refusing to emit performance claim into generated table for flag "
        f"{flag!r}: help string contains {match.group(0)!r}. Move the "
        f"performance commentary into a hand-written '### Behavior notes' "
        f"block where test_backfill_doc_parity.py can verify hedge framing."
    )


def _option_cell(action: argparse.Action) -> str:
    """Render the Option column cell, e.g. ``--limit N``."""
    flag = action.option_strings[0] if action.option_strings else f"--{action.dest}"
    if isinstance(action, (argparse._StoreTrueAction, argparse._StoreFalseAction)):
        return f"`{flag}`"
    if action.nargs == 0:
        return f"`{flag}`"
    metavar = action.metavar
    if metavar is None:
        metavar = action.dest.upper()
    if isinstance(metavar, tuple):
        metavar = " ".join(metavar)
    return f"`{flag} {metavar}`"


def _default_cell(action: argparse.Action) -> str:
    """Render the Default column cell."""
    value = action.default
    if value is None:
        return "`None`"
    if isinstance(value, bool):
        return f"`{str(value).lower()}`"
    if isinstance(value, Path):
        posix = value.as_posix()
        if not posix.startswith(("/", "./", "../")):
            posix = f"./{posix}"
        return f"`{posix}`"
    if isinstance(value, str):
        if value == "":
            return '`""`'
        return f"`{value}`"
    return f"`{value}`"


def _description_cell(action: argparse.Action) -> str:
    """Render the Description column cell from argparse ``help``."""
    help_text = action.help or ""
    # Single-line cells: argparse help strings are authored as single-line
    # prose; collapse any internal whitespace so the markdown table renders
    # cleanly and snapshot hashing stays stable.
    collapsed = " ".join(help_text.split())
    if isinstance(action, argparse._StoreTrueAction):
        if action.default is not False:
            collapsed = f"{collapsed} (flag)"
    return collapsed


# ---------- section rendering -------------------------------------------------


def _render_options_table(
    actions: Sequence[argparse.Action],
    *,
    include_default: bool,
) -> str:
    if not actions:
        return ""
    lines: list[str] = []
    if include_default:
        lines.append("| Option | Default | Description |")
        lines.append("|--------|---------|-------------|")
    else:
        lines.append("| Option | Description |")
        lines.append("|--------|-------------|")
    for action in actions:
        if include_default:
            lines.append(
                f"| {_option_cell(action)} | {_default_cell(action)} | "
                f"{_description_cell(action)} |"
            )
        else:
            lines.append(f"| {_option_cell(action)} | {_description_cell(action)} |")
    return "\n".join(lines)


def _render_global_options_section(parser: argparse.ArgumentParser) -> GeneratedSection:
    actions = [a for a in parser._actions if not _should_skip_action(a)]
    for action in actions:
        _guard_no_performance_claim(action)
    table = _render_options_table(actions, include_default=True)
    body = table + "\n" if table else ""
    return GeneratedSection("global-options", body)


def _render_subcommand_section(
    name: str, subparser: argparse.ArgumentParser
) -> GeneratedSection:
    actions = [a for a in subparser._actions if not _should_skip_action(a)]
    for action in actions:
        _guard_no_performance_claim(action)
    required = [a for a in actions if a.required]
    optional = [a for a in actions if not a.required]
    parts: list[str] = []
    parts.append("```bash")
    parts.append(f"ado-insights {name} [OPTIONS]")
    parts.append("```")
    if required:
        parts.append("")
        parts.append("### Required Options")
        parts.append("")
        parts.append(_render_options_table(required, include_default=False))
    if optional:
        parts.append("")
        parts.append("### Optional Options")
        parts.append("")
        parts.append(_render_options_table(optional, include_default=True))
    body = "\n".join(parts) + "\n"
    return GeneratedSection(name, body)


def collect_sections(parser: argparse.ArgumentParser) -> list[GeneratedSection]:
    sections: list[GeneratedSection] = [_render_global_options_section(parser)]
    subparsers_action = _get_subparsers_action(parser)
    for name in subparsers_action.choices:
        subparser = subparsers_action.choices[name]
        sections.append(_render_subcommand_section(name, subparser))
    _assert_no_performance_claim_in_output(sections)
    return sections


def _assert_no_performance_claim_in_output(
    sections: Iterable[GeneratedSection],
) -> None:
    """Post-render corpus scan — defensive sweep over the emitted tables."""
    for section in sections:
        match = _PERFORMANCE_CLAIM_RE.search(section.body)
        if match is not None:
            raise GenerationError(
                f"Performance-claim language leaked into generated section "
                f"{section.section_id!r}: matched {match.group(0)!r}. This is "
                f"a generator bug; the per-action guard should have caught "
                f"this upstream."
            )


# ---------- marker parsing and splicing ---------------------------------------


def _split_into_blocks(doc_text: str) -> list[tuple[str, str]]:
    """Split the doc into alternating hand-written/generated blocks.

    Returns a list of ``(kind, content)`` tuples where ``kind`` is either
    ``"prose"`` (unchanged passthrough) or ``"generated:<section_id>"``
    (replaceable region). Content for generated blocks EXCLUDES the marker
    lines themselves so the generator can swap the body without re-emitting
    markers.
    """
    lines = doc_text.splitlines(keepends=False)
    blocks: list[tuple[str, str]] = []
    buffer: list[str] = []
    current_id: str | None = None
    for idx, line in enumerate(lines, start=1):
        begin_match = BEGIN_MARKER_RE.fullmatch(line.strip())
        end_match = END_MARKER_RE.fullmatch(line.strip())
        if begin_match:
            if current_id is not None:
                raise MarkerError(
                    f"Nested BEGIN marker at line {idx}: already inside "
                    f"generated region {current_id!r}."
                )
            blocks.append(("prose", "\n".join(buffer)))
            buffer = []
            current_id = begin_match.group("id")
            blocks.append(("marker-begin", line))
            continue
        if end_match:
            if current_id is None:
                raise MarkerError(
                    f"Orphan END marker at line {idx}: no matching BEGIN."
                )
            if end_match.group("id") != current_id:
                raise MarkerError(
                    f"Mismatched marker at line {idx}: BEGIN was "
                    f"{current_id!r}, END is {end_match.group('id')!r}."
                )
            blocks.append((f"generated:{current_id}", "\n".join(buffer)))
            buffer = []
            blocks.append(("marker-end", line))
            current_id = None
            continue
        buffer.append(line)
    if current_id is not None:
        raise MarkerError(
            f"Unterminated BEGIN marker for region {current_id!r}: file ended "
            f"before its END marker."
        )
    blocks.append(("prose", "\n".join(buffer)))
    return blocks


def _render_doc(original_text: str, sections: Sequence[GeneratedSection]) -> str:
    """Splice generated sections into ``original_text`` between markers.

    Prose blocks, marker lines themselves, and any prose whitespace between
    sections are preserved byte-for-byte. Only content between paired
    BEGIN/END markers is replaced.
    """
    sections_by_id = {s.section_id: s for s in sections}
    seen: set[str] = set()
    blocks = _split_into_blocks(original_text)
    rendered: list[str] = []
    for kind, content in blocks:
        if kind.startswith("generated:"):
            section_id = kind.removeprefix("generated:")
            section = sections_by_id.get(section_id)
            if section is None:
                raise MarkerError(
                    f"Doc contains marker for region {section_id!r} but the "
                    f"parser produced no matching section."
                )
            seen.add(section_id)
            rendered.append(section.body.rstrip("\n"))
        else:
            rendered.append(content)
    missing = set(sections_by_id) - seen
    if missing:
        names = ", ".join(sorted(missing))
        raise MarkerError(
            f"Parser produced sections with no marker in the doc: {names}. "
            f"Add matching '<!-- BEGIN/END GENERATED: cli-reference:<id> -->' "
            f"pairs in docs/reference/cli-reference.md."
        )
    joined = "\n".join(rendered)
    if original_text.endswith("\n") and not joined.endswith("\n"):
        joined += "\n"
    return joined


# ---------- hashing and snapshot capture --------------------------------------


def compute_golden_hash(sections: Sequence[GeneratedSection]) -> str:
    hasher = hashlib.sha256()
    for section in sections:
        hasher.update(section.section_id.encode("utf-8"))
        hasher.update(b"\0")
        hasher.update(section.body.encode("utf-8"))
        hasher.update(b"\0")
    return hasher.hexdigest()


class _HelpFormatterPinnedWidth(argparse.HelpFormatter):
    """HelpFormatter with width pinned to ``DETERMINISTIC_COLUMNS``."""

    def __init__(self, prog: str) -> None:
        super().__init__(prog, width=int(DETERMINISTIC_COLUMNS))


class _RawDescriptionHelpFormatterPinnedWidth(argparse.RawDescriptionHelpFormatter):
    """RawDescriptionHelpFormatter with width pinned to ``DETERMINISTIC_COLUMNS``.

    Preserves the raw-description behavior used by ``cli.py``'s ``extract``
    subparser (``cli.py:250``) so its multi-line description survives
    verbatim, while still forcing the deterministic width uniformly.
    """

    def __init__(self, prog: str) -> None:
        super().__init__(prog, width=int(DETERMINISTIC_COLUMNS))


# Explicit registry: base argparse formatter -> width-pinned subclass.
# argparse ships five concrete HelpFormatter types; only the two used by
# this project's parsers are registered. Unknown types fail fast rather
# than falling back to a silent default, matching the project's
# dispatch-on-unknown-key invariant (see #297 fix in cli.py).
_PINNED_FORMATTERS: dict[type[argparse.HelpFormatter], type[argparse.HelpFormatter]] = {
    argparse.HelpFormatter: _HelpFormatterPinnedWidth,
    argparse.RawDescriptionHelpFormatter: _RawDescriptionHelpFormatterPinnedWidth,
}


def format_help_deterministic(parser: argparse.ArgumentParser) -> str:
    """Render ``--help`` with a fixed width for cross-OS reproducibility.

    argparse's default ``HelpFormatter`` reads width from
    ``shutil.get_terminal_size()``, which respects ``$COLUMNS`` only on
    some Python versions and OSes — Python 3.14 on Windows, for example,
    ignores it and uses the detected console width, producing help
    output wider than intended. Pinning ``width`` via the constructor
    argument (rather than the env var) bypasses the terminal-size
    lookup entirely and is honored uniformly across every Python
    version and platform.

    The temporary ``formatter_class`` swap preserves the parser's
    original class on exit so other call sites (including the CLI's own
    ``--help``) see no behavioral change.
    """
    # argparse types ``formatter_class`` as the opaque internal
    # ``_FormatterClass = Callable[[str], HelpFormatter]`` alias; narrow
    # once at the boundary so the registry lookup is statically typed.
    original = cast(type[argparse.HelpFormatter], parser.formatter_class)
    pinned = _PINNED_FORMATTERS.get(original)
    if pinned is None:
        raise ValueError(
            f"Unsupported HelpFormatter type: {original.__name__}. "
            f"Add a pinned-width subclass to _PINNED_FORMATTERS before "
            f"using it on a parser consumed by this generator. Known "
            f"types: {sorted(cls.__name__ for cls in _PINNED_FORMATTERS)}"
        )
    parser.formatter_class = pinned
    try:
        return parser.format_help()
    finally:
        parser.formatter_class = original


def collect_help_snapshots(
    parser: argparse.ArgumentParser,
) -> dict[str, str]:
    snapshots = {"_root": format_help_deterministic(parser)}
    subparsers_action = _get_subparsers_action(parser)
    for name, subparser in subparsers_action.choices.items():
        snapshots[name] = format_help_deterministic(subparser)
    return snapshots


# ---------- I/O helpers -------------------------------------------------------


def _write_lf(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def _read_lf(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _display_path(path: Path) -> str:
    """Render a repo-relative path with forward slashes for cross-OS logs."""
    return path.relative_to(REPO_ROOT).as_posix()


# ---------- modes -------------------------------------------------------------


def mode_write() -> int:
    _require_canonical_python_for_write("--write")
    parser = _load_create_parser()
    sections = collect_sections(parser)
    current = _read_lf(DOC_PATH)
    rendered = _render_doc(current, sections)
    _write_lf(DOC_PATH, rendered)
    golden = compute_golden_hash(sections)
    _write_lf(GOLDEN_SHA_PATH, golden + "\n")
    snapshots = collect_help_snapshots(parser)
    _write_snapshots(snapshots)
    print(f"[cli-reference-generator] wrote {_display_path(DOC_PATH)}")
    print(f"[cli-reference-generator] wrote {_display_path(GOLDEN_SHA_PATH)}")
    print(
        f"[cli-reference-generator] wrote {len(snapshots)} snapshot(s) to "
        f"{_display_path(SNAPSHOT_DIR)}"
    )
    return 0


def mode_check() -> int:
    skip_code = _check_under_canonical_python_or_skip()
    if skip_code is not None:
        return skip_code
    parser = _load_create_parser()
    sections = collect_sections(parser)
    current = _read_lf(DOC_PATH)
    rendered = _render_doc(current, sections)
    drift_pieces: list[str] = []
    if current != rendered:
        diff = difflib.unified_diff(
            current.splitlines(keepends=True),
            rendered.splitlines(keepends=True),
            fromfile=f"{_display_path(DOC_PATH)} (committed)",
            tofile=f"{_display_path(DOC_PATH)} (regenerated)",
            n=3,
        )
        drift_pieces.append("".join(diff))
    golden_expected = compute_golden_hash(sections)
    golden_current = (
        _read_lf(GOLDEN_SHA_PATH).strip() if GOLDEN_SHA_PATH.exists() else ""
    )
    if golden_current != golden_expected:
        drift_pieces.append(
            f"golden-hash mismatch: committed={golden_current!r} "
            f"expected={golden_expected!r}\n"
        )
    snapshots_expected = collect_help_snapshots(parser)
    for name, expected in snapshots_expected.items():
        snap_path = _snapshot_path(name)
        if not snap_path.exists():
            drift_pieces.append(f"missing help snapshot: {_display_path(snap_path)}\n")
            continue
        actual = _read_lf(snap_path)
        if actual != expected:
            diff = difflib.unified_diff(
                actual.splitlines(keepends=True),
                expected.splitlines(keepends=True),
                fromfile=f"{_display_path(snap_path)} (committed)",
                tofile=f"{_display_path(snap_path)} (regenerated)",
                n=3,
            )
            drift_pieces.append("".join(diff))
    if drift_pieces:
        sys.stdout.write(
            "[cli-reference-generator] drift detected — regenerate with "
            "`python scripts/generate_cli_reference.py --write`\n\n"
        )
        sys.stdout.write("\n".join(drift_pieces))
        return 1
    print("[cli-reference-generator] no drift")
    return 0


def mode_update_help_snapshots() -> int:
    _require_canonical_python_for_write("--update-help-snapshots")
    parser = _load_create_parser()
    snapshots = collect_help_snapshots(parser)
    _write_snapshots(snapshots)
    print(
        f"[cli-reference-generator] wrote {len(snapshots)} snapshot(s) to "
        f"{_display_path(SNAPSHOT_DIR)}"
    )
    return 0


def _snapshot_path(name: str) -> Path:
    return SNAPSHOT_DIR / f"{name}.txt"


def _write_snapshots(snapshots: dict[str, str]) -> None:
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    # Remove snapshots that no longer correspond to a subcommand to avoid
    # orphaned fixtures surviving after a rename or removal.
    valid_names = set(snapshots)
    for existing in SNAPSHOT_DIR.glob("*.txt"):
        if existing.stem not in valid_names:
            existing.unlink()
    for name, content in snapshots.items():
        _write_lf(_snapshot_path(name), content)


# ---------- CLI ---------------------------------------------------------------


def _build_argv_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="generate_cli_reference.py",
        description=(
            "Regenerate the per-subcommand flag tables in "
            "docs/reference/cli-reference.md from create_parser()."
        ),
    )
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--write",
        action="store_true",
        help="Overwrite generated regions, golden SHA, and help snapshots.",
    )
    mode.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero if any generated artifact diverges from the parser.",
    )
    mode.add_argument(
        "--update-help-snapshots",
        action="store_true",
        help="Rewrite tests/unit/fixtures/help_snapshots/ only.",
    )
    return p


def _is_canonical_python() -> bool:
    return sys.version_info[:2] == _CANONICAL_PYTHON


def _non_canonical_python_message(mode_label: str) -> str:
    canonical = ".".join(str(n) for n in _CANONICAL_PYTHON)
    current = f"{sys.version_info.major}.{sys.version_info.minor}"
    return (
        f"[cli-reference-generator] {mode_label}: requires Python {canonical} "
        f"(CI canonical); currently Python {current}.\n"
        f"\n"
        f"argparse help-text rendering is not byte-stable across Python\n"
        f"versions.  Regenerating on {current} produces snapshots that\n"
        f"pass a local --check tautologically (regen matches regen on the\n"
        f"same interpreter) but diverge from CI's Python {canonical} regen,\n"
        f"violating local/CI parity.\n"
        f"\n"
        f"Run via an isolated {canonical} venv:\n"
        f"  uv venv --python {canonical} $TEMP/ado-cli-ref-venv\n"
        f"  uv pip install --python $TEMP/ado-cli-ref-venv/Scripts/python -e .\n"
        f"  $TEMP/ado-cli-ref-venv/Scripts/python scripts/generate_cli_reference.py <args>\n"
    )


def _require_canonical_python_for_write(mode_label: str) -> None:
    """Refuse to regenerate artifacts on a non-canonical interpreter.

    Write-path invariant: snapshots and the generated doc must never be
    produced by anything but the CI-canonical Python.  Any non-canonical
    regen ships bytes that a subsequent CI `--check` will diverge from
    — the same defect that took PR #298 offline.
    """
    if _is_canonical_python():
        return
    sys.stderr.write(_non_canonical_python_message(f"ERROR ({mode_label})"))
    sys.exit(1)


def _check_under_canonical_python_or_skip() -> int | None:
    """Return ``None`` to proceed with the check, or an exit code to short-circuit.

    Read-path invariant: `--check` on a non-canonical interpreter
    cannot produce a CI-parity verdict (argparse renders differently
    across versions regardless of parser edits), so a straight run
    would produce false positives on every invocation.  Instead emit a
    SKIP diagnostic matching the form CI uses for its own "upstream
    dependency failed" cascades — preflight continues, CI performs the
    authoritative check on Python 3.12.

    The write-path guard above still prevents anyone from committing
    non-canonical snapshots, so the only drift this skip can "miss"
    would already have been blocked at regeneration time.
    """
    if _is_canonical_python():
        return None
    canonical = ".".join(str(n) for n in _CANONICAL_PYTHON)
    current = f"{sys.version_info.major}.{sys.version_info.minor}"
    sys.stdout.write(
        f"[SKIP] cli-reference --check skipped on Python {current}; "
        f"canonical Python {canonical} required for authoritative "
        f"local verification. CI remains authoritative.\n"
        f"\n"
        f"To run the check locally on canonical Python:\n"
        f"  uv venv --python {canonical} $TEMP/ado-cli-ref-venv\n"
        f"  uv pip install --python $TEMP/ado-cli-ref-venv/Scripts/python -e .\n"
        f"  $TEMP/ado-cli-ref-venv/Scripts/python scripts/generate_cli_reference.py --check\n"
        f"\n"
        f"Note: the --write guard still refuses non-canonical regeneration,\n"
        f"so committed snapshots remain canonical by construction.\n"
    )
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    # Mode-aware canonical-Python policy lives inside each mode_* function
    # (write/update-help-snapshots hard-fail, check warned-skip), so main()
    # dispatches without an outer guard and every caller — CLI, preflight,
    # unit tests invoking mode_check() directly — gets consistent behavior.
    args = _build_argv_parser().parse_args(argv)
    try:
        if args.write:
            return mode_write()
        if args.check:
            return mode_check()
        if args.update_help_snapshots:
            return mode_update_help_snapshots()
    except (GenerationError, MarkerError) as err:
        sys.stdout.write(f"[cli-reference-generator] ERROR: {err}\n")
        return 2
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
