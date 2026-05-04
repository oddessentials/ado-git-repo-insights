"""Structural import-block isolation test for the SC-05 reconciliation test.

Feature 333 (comments-trend-chart) — task T008. Implements the round-9 mechanism
pinned in ADR T002. Closes the structural side of FR-2-04 (b)'s "no shared code
with EITHER aggregator"
constraint.

The SC-05 reconciliation test (`tests/integration/test_comments_trend_reconciliation.py`)
performs an INDEPENDENT re-computation of `rollup[W].comments` from source data so the
test is not coupled to the aggregator's correctness (round-9 finding: if the test
imports either the comments aggregator or the throughput aggregator from
`src/ado_git_repo_insights/transform/aggregators.py`, a bug in either aggregator's
PR-set assembly would silently propagate into the test's "expected" values, defeating
the purpose of independent re-computation).

This test enforces that constraint structurally at the import-block level (not by
code-organization convention). It walks the SC-05 reconciliation test module's
TRANSITIVE import graph via `ast` (stdlib) + `importlib.util.find_spec()` and asserts
the aggregators module appears nowhere in the resolved import set.

Round-9 extension: a single negative containment assertion against
`transform/aggregators.py` covers BOTH the comments aggregator and the throughput
aggregator because both live in that same file.

Mechanism (per ADR T002):

1. Locate the SC-05 reconciliation test file (sibling: `test_comments_trend_reconciliation.py`).
2. Parse it with `ast.parse()`; collect `Import` and `ImportFrom` nodes.
3. Recursively walk imports of imports (transitive), bounded by:
   - skip stdlib modules (origin = `built-in`, `frozen`, or under `sys.base_prefix`),
   - skip third-party packages (origin under `sys.prefix/Lib/site-packages`),
   - only recurse into modules whose source file is under the repo's `src/` tree.
4. Maintain a `visited` set keyed by resolved module dotted-name to break cycles.
5. Assert `transform/aggregators.py` is NOT in the resolved file-path set AND the
   dotted name `ado_git_repo_insights.transform.aggregators` (and the `src.`-prefixed
   variant the spec uses verbatim) is NOT in the resolved dotted-name set.

If the SC-05 reconciliation test file does not yet exist (parallel scaffolding), this
test SKIPS with a clear reason — it cannot meaningfully run without the target. The
SKIP is collection-stable (Principle XXVI): the test still collects and reports a
known-pending state rather than ERRORing on missing fixture.

Why negative containment is sufficient (no allow-list needed): any stdlib import
(`sqlite3`, `json`, `pathlib`) and any third-party import (`pandas`, `pytest`) the
SC-05 test legitimately uses passes this assertion trivially because the assertion
only forbids `aggregators.py`. New stdlib/third-party imports added by future
maintenance of the SC-05 test require zero changes here.

Edge cases out of scope (acknowledged by ADR T002):

- Dynamic imports (`__import__("...")` with non-literal strings,
  `importlib.import_module(<computed>)`) are invisible to AST analysis. These are a
  code-smell that should fail review independently; if smuggled through, the SC-05
  reconciliation test's own assertions would silently degrade to tautology and the
  FR-2-05 meta-test (T009) would no longer prove FR-2-04 is real on a wrong codebase.
"""

from __future__ import annotations

import ast
import importlib.util
import sys
from pathlib import Path

import pytest

# --------------------------------------------------------------------------- #
# Paths & constants                                                            #
# --------------------------------------------------------------------------- #

# Repo root: this file lives at <repo>/tests/integration/<this_file>.py
_REPO_ROOT: Path = Path(__file__).resolve().parents[2]
_SRC_ROOT: Path = (_REPO_ROOT / "src").resolve()

# The SC-05 reconciliation test (T007), authored in parallel.
_RECONCILIATION_TEST_PATH: Path = (
    Path(__file__).resolve().parent / "test_comments_trend_reconciliation.py"
)

# Forbidden module — both aggregators live in this single source file.
_FORBIDDEN_FILE_RELPATH: str = "src/ado_git_repo_insights/transform/aggregators.py"
_FORBIDDEN_DOTTED_NAMES: frozenset[str] = frozenset(
    {
        # Resolved dotted name under the actual installed package layout
        # (pyproject.toml [tool.setuptools.packages.find] where = ["src"], so
        # src/ado_git_repo_insights becomes the importable `ado_git_repo_insights`
        # package).
        "ado_git_repo_insights.transform.aggregators",
        # Spec FR-2-04 (b) uses the verbatim `src.ado_git_repo_insights.*` form.
        # Catch it too in case a future packaging change exposes that name.
        "src.ado_git_repo_insights.transform.aggregators",
    }
)

# Stdlib boundary: modules under base_prefix's stdlib are skipped from recursion.
# In a venv, base_prefix points at the underlying interpreter install where
# stdlib lives; sys.prefix points at the venv (which contains site-packages).
_STDLIB_PREFIX: Path = Path(sys.base_prefix).resolve()
_VENV_PREFIX: Path = Path(sys.prefix).resolve()


# --------------------------------------------------------------------------- #
# AST walk                                                                     #
# --------------------------------------------------------------------------- #


def _extract_imported_names(tree: ast.AST, *, source_dotted: str | None) -> list[str]:
    """Collect every absolute dotted module name referenced by `Import` /
    `ImportFrom` nodes in the AST.

    `source_dotted` is the dotted name of the module owning the AST (used to
    resolve relative `from . import X` / `from .. import X` references).
    Top-level `ast.parse(file_text)` of a test file passes `source_dotted=None`
    because pytest test files are not part of an importable package — and they
    do not use relative imports (they use absolute `from ado_git_repo_insights...`).
    """

    names: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            # `import X` and `import X.Y.Z` — record the full dotted name.
            for alias in node.names:
                names.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            level = node.level
            if level == 0:
                # Absolute `from PKG import A, B, C`. Record the package name
                # AND `PKG.A` / `PKG.B` / `PKG.C` because each `A` may be
                # either an attribute of `PKG` (we'll resolve the package
                # itself, and find_spec on `PKG.A` will return None) OR a
                # sub-module (find_spec on `PKG.A` will resolve it). Recording
                # both forms lets find_spec disambiguate without us having to
                # second-guess the AST.
                if module:
                    names.append(module)
                    for alias in node.names:
                        if alias.name == "*":
                            continue
                        names.append(f"{module}.{alias.name}")
                continue
            # Relative import — resolve against source_dotted.
            if source_dotted is None:
                # Cannot resolve relative imports without package context.
                # Test files do not use relative imports, so this is fine; if
                # one ever does, we surface it as the literal relative form so
                # the failure (if any later) is debuggable.
                continue
            parts = source_dotted.split(".")
            # Strip `level` trailing components from the package path of the
            # importing module. Note: source_dotted is the MODULE name; its
            # package is one level up.
            base_parts = parts[:-1] if "." in source_dotted else []
            if level - 1 > len(base_parts):
                # Out-of-tree relative import (over-dotted) — skip.
                continue
            anchor = (
                base_parts[: len(base_parts) - (level - 1)] if level > 1 else base_parts
            )
            resolved = ".".join([*anchor, module]) if module else ".".join(anchor)
            if resolved:
                names.append(resolved)
                # Same sub-module-vs-attribute disambiguation as the absolute
                # branch above.
                for alias in node.names:
                    if alias.name == "*":
                        continue
                    names.append(f"{resolved}.{alias.name}")
    return names


def _is_under(path: Path, root: Path) -> bool:
    """Return True if `path` is `root` or a descendant of `root`."""
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def _classify_origin(origin: str | None) -> str:
    """Categorize a `ModuleSpec.origin` for filtering purposes.

    Returns one of: "builtin", "frozen", "stdlib", "third_party", "in_repo",
    "namespace", "unknown".
    """
    if origin is None:
        # Namespace package (PEP 420) — has no `__init__.py` source file.
        return "namespace"
    if origin == "built-in":
        return "builtin"
    if origin == "frozen":
        return "frozen"
    origin_path = Path(origin).resolve()
    # Repo first — short-circuit if it's our own source.
    if _is_under(origin_path, _SRC_ROOT):
        return "in_repo"
    # Site-packages (third-party): under venv prefix's site-packages.
    venv_site_packages = (_VENV_PREFIX / "Lib" / "site-packages").resolve()
    if _is_under(origin_path, venv_site_packages):
        return "third_party"
    # Stdlib: under the base_prefix install (where the interpreter's Lib/ lives).
    if _is_under(origin_path, _STDLIB_PREFIX):
        return "stdlib"
    return "unknown"


def _collect_transitive_imports(
    *,
    seed_path: Path,
    seed_dotted: str | None,
) -> tuple[set[str], set[Path], dict[str, str]]:
    """Walk the transitive import graph from `seed_path` (a Python file).

    Returns:
        - resolved_dotted: every dotted module name encountered (including
          stdlib and third-party — for diagnostic completeness; the assertion
          tests negative containment, not allow-listing).
        - resolved_files: every resolved source file path (absolute) for
          modules whose `origin` was a real path.
        - import_chain: parent_dotted_name -> child_dotted_name mapping for the
          first-discovered path to each child (used to build a human-readable
          chain in the failure message).
    """

    resolved_dotted: set[str] = set()
    resolved_files: set[Path] = set()
    import_chain: dict[str, str] = {}
    visited: set[str] = set()  # cycle-break key: dotted name (None marker for seed)

    # Stack entries: (file_path_to_parse, dotted_name_of_module, parent_dotted_or_None)
    seed_label = seed_dotted if seed_dotted is not None else f"<file:{seed_path.name}>"
    stack: list[tuple[Path, str, str | None]] = [(seed_path, seed_label, None)]

    while stack:
        file_path, dotted_name, parent = stack.pop()
        if dotted_name in visited:
            continue
        visited.add(dotted_name)

        if parent is not None and dotted_name not in import_chain:
            import_chain[dotted_name] = parent

        try:
            file_text = file_path.read_text(encoding="utf-8")
        except OSError:
            # Cannot read source — record name only, do not recurse.
            resolved_dotted.add(dotted_name)
            continue

        try:
            tree = ast.parse(file_text, filename=str(file_path))
        except SyntaxError:
            # Cannot parse (vendor-shipped syntax outside our Python version) —
            # record name and stop recursing into this branch.
            resolved_dotted.add(dotted_name)
            continue

        # Use None for source_dotted on the seed (test file isn't a package
        # member); use the actual dotted name otherwise.
        ast_source_dotted = dotted_name if dotted_name != seed_label else None
        for child_name in _extract_imported_names(
            tree, source_dotted=ast_source_dotted
        ):
            if not child_name:
                continue
            resolved_dotted.add(child_name)
            if child_name in visited:
                if child_name not in import_chain:
                    import_chain[child_name] = dotted_name
                continue

            # Resolve the child via importlib.util.find_spec.
            try:
                spec = importlib.util.find_spec(child_name)
            except (ImportError, ModuleNotFoundError, ValueError):
                # Unresolvable (e.g., conditional import on an extra not
                # installed). Recording the dotted name is enough — we cannot
                # walk into a module that does not resolve.
                if child_name not in import_chain:
                    import_chain[child_name] = dotted_name
                continue

            if spec is None:
                if child_name not in import_chain:
                    import_chain[child_name] = dotted_name
                continue

            if child_name not in import_chain:
                import_chain[child_name] = dotted_name

            classification = _classify_origin(spec.origin)
            if classification != "in_repo":
                # Skip recursion for stdlib / third-party / built-in / frozen /
                # namespace / unknown. They cannot import aggregators.py, and
                # walking them would explode the search space.
                if spec.origin and spec.has_location:
                    resolved_files.add(Path(spec.origin).resolve())
                continue

            # In-repo source file — record and recurse.
            assert spec.origin is not None  # in_repo classification implies a path
            child_path = Path(spec.origin).resolve()
            resolved_files.add(child_path)
            stack.append((child_path, child_name, dotted_name))

    return resolved_dotted, resolved_files, import_chain


def _build_chain_string(target: str, import_chain: dict[str, str]) -> str:
    """Reconstruct the discovery chain leading from the seed to `target`."""
    chain: list[str] = [target]
    cur = target
    seen: set[str] = {cur}
    while cur in import_chain:
        nxt = import_chain[cur]
        if nxt in seen:  # Defensive: cycle in the chain dict (shouldn't happen).
            break
        chain.append(nxt)
        seen.add(nxt)
        cur = nxt
    return " <- ".join(chain)


# --------------------------------------------------------------------------- #
# The test                                                                     #
# --------------------------------------------------------------------------- #


def test_reconciliation_test_does_not_import_aggregators() -> None:
    """SC-05 reconciliation test must share NO transitive code with either
    aggregator (comments or throughput).

    Round-9 finding: both aggregators live in
    `src/ado_git_repo_insights/transform/aggregators.py`. A single negative
    containment assertion against that file covers both surfaces.
    """

    if not _RECONCILIATION_TEST_PATH.exists():
        pytest.skip(
            "SC-05 reconciliation test "
            f"({_RECONCILIATION_TEST_PATH.name}) does not yet exist on disk; "
            "isolation test cannot meaningfully run without its target. "
            "Once T007 lands, this test will activate automatically."
        )

    resolved_dotted, resolved_files, import_chain = _collect_transitive_imports(
        seed_path=_RECONCILIATION_TEST_PATH,
        seed_dotted=None,
    )

    # --- Assertion 1: dotted name not in the transitive import set --------- #
    forbidden_dotted_hits = sorted(
        resolved_dotted.intersection(_FORBIDDEN_DOTTED_NAMES)
    )

    # --- Assertion 2: file path not in the transitive resolved-file set ---- #
    forbidden_file_hits: list[Path] = sorted(
        path
        for path in resolved_files
        if path.as_posix().endswith(_FORBIDDEN_FILE_RELPATH.split("/", 1)[1])
        # The `.split("/", 1)[1]` strips the leading "src/" so we match against
        # `ado_git_repo_insights/transform/aggregators.py` — the suffix of the
        # absolute resolved path regardless of where the repo is checked out.
    )

    if not forbidden_dotted_hits and not forbidden_file_hits:
        return  # PASS

    # Build a clear, actionable failure message.
    message_lines: list[str] = [
        "SC-05 reconciliation test transitively imports the aggregators module.",
        "",
        "FR-2-04 (b) (round-9) requires that "
        f"`{_RECONCILIATION_TEST_PATH.name}` share NO code with either the "
        "comments aggregator or the throughput aggregator. Both live in "
        f"`{_FORBIDDEN_FILE_RELPATH}`, so any transitive import of that file "
        "violates the constraint.",
        "",
        "Why this matters: the SC-05 reconciliation test grounds its expected "
        "values via DIRECT SQL against `pull_requests`. If the test (even "
        "transitively) reuses aggregator code, a bug in the aggregator could "
        "silently propagate into the test's expected values — both surfaces "
        "would agree by virtue of sharing the same bug, defeating independent "
        "re-computation.",
        "",
        "Violations found:",
    ]

    for dotted in forbidden_dotted_hits:
        chain = _build_chain_string(dotted, import_chain)
        message_lines.append(f"  - dotted name `{dotted}` reached via: {chain}")

    for path in forbidden_file_hits:
        # Map back to the dotted name that resolved to this file so we can
        # reconstruct the discovery chain.
        matched_dotted_name: str | None = None
        for dotted in sorted(resolved_dotted):
            try:
                spec = importlib.util.find_spec(dotted)
            except (ImportError, ModuleNotFoundError, ValueError):
                continue
            if spec is None or spec.origin is None:
                continue
            try:
                if Path(spec.origin).resolve() == path:
                    matched_dotted_name = dotted
                    break
            except OSError:
                continue
        if matched_dotted_name is not None:
            chain = _build_chain_string(matched_dotted_name, import_chain)
            message_lines.append(
                f"  - file `{path}` reached via dotted `{matched_dotted_name}`: {chain}"
            )
        else:
            message_lines.append(
                f"  - file `{path}` resolved in the transitive set "
                "(dotted-name chain unavailable)"
            )

    message_lines.extend(
        [
            "",
            "How to fix: remove the offending import from "
            f"`{_RECONCILIATION_TEST_PATH.name}` (or from whichever transitively "
            "imported in-repo module first pulled in `aggregators.py`). The "
            "test must depend only on stdlib (`ast`, `sqlite3`, `pathlib`, "
            "`json`, `importlib.util`), test infrastructure (`pytest`), and "
            "non-aggregator helpers (e.g., `DatabaseManager` is fine — it "
            "does NOT import aggregators.py; aggregators.py imports IT).",
        ]
    )

    pytest.fail("\n".join(message_lines))
